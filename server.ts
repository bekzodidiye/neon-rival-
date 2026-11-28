import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  JsonDevPersistenceAdapter,
  type PersistenceAdapter,
  type StoredUser,
} from './server/persistence/PersistenceAdapter';
import { RoomManager } from './server/game/RoomManager';
import {
  validateCreateRoomPayload,
  validateJoinRoomPayload,
  validatePlayerInput,
} from './shared/protocol/validation';

const scryptAsync = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

// Cryptographic signing key for Bearer session tokens (env override or fresh per-process CSPRNG key)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LEN = 6;
const MAX_PASSWORD_LEN = 128;

export interface AppServerOptions {
  port?: number;
  host?: string;
  enableVite?: boolean;
  persistence?: PersistenceAdapter;
  persistToDisk?: boolean;
  storePath?: string;
  simHz?: number;
  snapshotHz?: number;
  countdownSeconds?: number;
  maxPlayersPerRoom?: number;
  reconnectGraceMs?: number;
  compactSnapshotsByDefault?: boolean;
  allowedOrigins?: string[];
}

export interface RunningAppServer {
  app: express.Express;
  server: http.Server;
  wss: WebSocketServer;
  persistence: PersistenceAdapter;
  roomManager: RoomManager;
  port: number;
  url: string;
  wsUrl: string;
  close: () => Promise<void>;
}

/**
 * Asynchronous per-user random-salt scrypt password hashing (never blocks Node event loop).
 */
export async function hashPasswordScryptAsync(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

export async function verifyPasswordAsync(
  password: string,
  storedHash: string,
): Promise<{ valid: boolean; needsMigration: boolean }> {
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return { valid: false, needsMigration: false };
    const [, salt, expectedHex] = parts;
    const derived = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return { valid: false, needsMigration: false };
    return { valid: crypto.timingSafeEqual(derived, expected), needsMigration: false };
  }

  // Legacy SHA-256 compatibility check -> automatically upgrades to scrypt on valid login
  const legacyHex = crypto.createHash('sha256').update(`nr_salt_${password}`).digest('hex');
  const legacyBuf = Buffer.from(legacyHex, 'hex');
  const storedBuf = Buffer.from(storedHash, 'hex');
  if (legacyBuf.length === storedBuf.length && crypto.timingSafeEqual(legacyBuf, storedBuf)) {
    return { valid: true, needsMigration: true };
  }
  return { valid: false, needsMigration: false };
}

function isOriginAllowed(origin: string | undefined, host: string | undefined, allowList: string[]): boolean {
  // Non-browser clients (e.g., native WS tests or curl) may omit Origin
  if (!origin) return true;
  if (allowList.includes('*')) return true;
  if (allowList.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    if (host && parsed.host === host) return true;
    if (!isProd && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
  } catch {
    return false;
  }
  return false;
}

export async function createAppServer(options: AppServerOptions = {}): Promise<RunningAppServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? '0.0.0.0';
  const enableVite = options.enableVite ?? true;
  const persistence =
    options.persistence ??
    new JsonDevPersistenceAdapter({
      storePath: options.storePath,
      persistToDisk: options.persistToDisk ?? true,
    });

  const allowedOrigins =
    options.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : []);

  const roomManager = new RoomManager({
    persistence,
    maxPlayersPerRoom: options.maxPlayersPerRoom ?? 20,
    simHz: options.simHz ?? 60,
    snapshotHz: options.snapshotHz ?? 20,
    countdownSeconds: options.countdownSeconds ?? 2.2,
    reconnectGraceMs: options.reconnectGraceMs ?? 20_000,
    compactSnapshotsByDefault: options.compactSnapshotsByDefault ?? false,
  });

  const authRateLimiter = new Map<string, { count: number; resetAt: number }>();

  function checkAuthRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = authRateLimiter.get(ip);
    if (!entry || now > entry.resetAt) {
      authRateLimiter.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= 25;
  }

  function issueSessionToken(user: StoredUser, userKey: string): string {
    const jti = crypto.randomBytes(18).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const payload = Buffer.from(
      JSON.stringify({ jti, uid: user.id, uk: userKey, exp: expiresAt }),
      'utf-8',
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const token = `${payload}.${sig}`;
    persistence.saveSession({
      jti,
      userId: user.id,
      userKey,
      username: user.username,
      expiresAt,
    });
    return token;
  }

  function verifyRawToken(token: string | undefined) {
    if (!token) return null;
    const trimmed = token.trim();
    const dotIdx = trimmed.indexOf('.');
    if (dotIdx <= 0) return null;
    const payload = trimmed.slice(0, dotIdx);
    const sig = trimmed.slice(dotIdx + 1);
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
        jti?: string;
        exp?: number;
      };
      if (!parsed.jti || !parsed.exp || parsed.exp < Date.now()) {
        if (parsed.jti) persistence.revokeSession(parsed.jti);
        return null;
      }
      const rec = persistence.getSession(parsed.jti);
      if (!rec || rec.expiresAt < Date.now()) {
        persistence.revokeSession(parsed.jti);
        return null;
      }
      return { jti: parsed.jti, session: rec };
    } catch {
      return null;
    }
  }

  function verifyBearerHeader(authHeader: string | undefined) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    return verifyRawToken(authHeader.slice(7));
  }

  const app = express();
  app.use(express.json({ limit: '128kb' }));

  // Basic security headers & explicit CORS/Origin enforcement
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin, req.headers.host, allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // REST API Endpoints
  app.get('/api/health', (_req, res) => {
    const stats = roomManager.getStats();
    res.json({
      ok: true,
      authoritativeMultiplayer: true,
      persistenceKind: persistence.kind,
      roomsActive: stats.roomsActive,
      playersOnline: stats.playersOnline,
      racesRunning: stats.racesRunning,
    });
  });

  app.get('/api/ready', (_req, res) => {
    const stats = roomManager.getStats();
    res.json({
      ready: true,
      persistenceKind: persistence.kind,
      uptimeSec: Math.round(process.uptime()),
      roomsActive: stats.roomsActive,
    });
  });

  // Strictly verified leaderboard (zero fabricated competitive accounts — V6.0 Section 22)
  app.get('/api/leaderboard', (_req, res) => {
    const leaderboard = persistence.getVerifiedLeaderboard(20);
    res.json({
      verifiedOnly: true,
      leaderboard,
    });
  });

  app.get('/api/matches/:matchId/result', (req, res) => {
    const matchId = String(req.params.matchId || '').trim().slice(0, 64);
    const result = persistence.getMatchResult(matchId);
    if (!result) {
      res.status(404).json({ error: 'Verified match result not found.' });
      return;
    }
    res.json({ result });
  });

  app.get('/api/auth/me', (req, res) => {
    const auth = verifyBearerHeader(req.headers.authorization);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const user = persistence.getUserByKey(auth.session.userKey);
    if (!user) {
      res.status(401).json({ error: 'Session account no longer exists.' });
      return;
    }
    const { passwordHash: _omit, ...safeUser } = user;
    const rewardLedger = persistence.getRewardLedgerForUser(user.id);
    res.json({ user: safeUser, verifiedMatchesCount: rewardLedger.length });
  });

  app.post('/api/auth/register', async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkAuthRateLimit(clientIp)) {
      res.status(429).json({ error: 'Too many authentication attempts. Please wait a minute.' });
      return;
    }
    const username = String(req.body?.username || '').trim().slice(0, 20);
    const password = String(req.body?.password || '');
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      res.status(400).json({ error: 'Username must be 3-20 alphanumeric, underscore, or dash characters.' });
      return;
    }
    if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
      res.status(400).json({ error: `Password must be between ${MIN_PASSWORD_LEN} and ${MAX_PASSWORD_LEN} characters.` });
      return;
    }
    const key = username.toLowerCase();
    if (persistence.getUserByKey(key)) {
      res.status(409).json({ error: 'Username already registered.' });
      return;
    }
    const passwordHash = await hashPasswordScryptAsync(password);
    const user: StoredUser = {
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      username,
      passwordHash,
      level: 1,
      xp: 0,
      credits: 3000,
      fanPoints: 0,
      racesCompleted: 0,
      wins: 0,
      takedowns: 0,
      ownedVehicles: ['street_falcon'],
      selectedVehicleId: 'street_falcon',
      createdAt: new Date().toISOString(),
    };
    persistence.createUser(key, user);
    const token = issueSessionToken(user, key);
    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  app.post('/api/auth/login', async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkAuthRateLimit(clientIp)) {
      res.status(429).json({ error: 'Too many authentication attempts. Please wait a minute.' });
      return;
    }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (password.length < 1 || password.length > MAX_PASSWORD_LEN) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    const key = username.toLowerCase();
    const user = persistence.getUserByKey(key);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    const check = await verifyPasswordAsync(password, user.passwordHash);
    if (!check.valid) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    if (check.needsMigration) {
      user.passwordHash = await hashPasswordScryptAsync(password);
      persistence.updateUser(key, user);
    }
    const token = issueSessionToken(user, key);
    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  app.post('/api/auth/logout', (req, res) => {
    const auth = verifyBearerHeader(req.headers.authorization);
    if (auth) {
      persistence.revokeSession(auth.jti);
    }
    res.json({ ok: true });
  });

  /**
   * V6.0 Section 2 & 19 CRITICAL SECURITY BLOCKER REMEDIATION:
   * Client-submitted race completion claims are explicitly DISABLED for competitive progression.
   * Verified credits, XP, fan points, wins, and leaderboard rankings are issued EXCLUSIVELY
   * by server-finished authoritative matches in RoomManager -> PersistenceAdapter.recordVerifiedMatchResult().
   */
  app.post('/api/race/complete', (_req, res) => {
    res.status(403).json({
      error:
        'Unverified client-reported race results are disabled. Competitive rewards and rankings are issued exclusively by server-authoritative multiplayer matches.',
      code: 'CLIENT_RACE_CLAIM_DISABLED',
    });
  });

  const server = http.createServer(app);

  // Real-Time Authoritative WebSocket Server on /ws (with Origin check & payload cap)
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 16 * 1024,
    verifyClient: (info, done) => {
      const ok = isOriginAllowed(info.origin, info.req.headers.host, allowedOrigins);
      done(ok, ok ? undefined : 403, ok ? undefined : 'Origin not allowed');
    },
  });

  wss.on('connection', (ws, req) => {
    let playerId = `net_${crypto.randomBytes(6).toString('hex')}`;
    let authenticatedUserId: string | null = null;
    let authenticatedUsername: string | null = null;
    let prefersCompactSnapshots = Boolean(options.compactSnapshotsByDefault);
    let msgCountWindow = 0;
    let windowStart = Date.now();

    // Check optional Bearer token on WebSocket upgrade header
    const headerAuth = verifyBearerHeader(req.headers.authorization);
    if (headerAuth) {
      authenticatedUserId = headerAuth.session.userId;
      authenticatedUsername = headerAuth.session.username;
    }

    ws.send(
      JSON.stringify({
        type: 'welcome',
        playerId,
        authoritative: true,
        authenticated: Boolean(authenticatedUserId),
        username: authenticatedUsername,
      }),
    );

    ws.on('message', (raw) => {
      // Rate limiting against WebSocket flooding (max 120 msgs / sec to comfortably allow 60Hz inputs + control frames)
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        msgCountWindow = 0;
      }
      msgCountWindow += 1;
      if (msgCountWindow > 120) {
        ws.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Input rate limit exceeded.' }));
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'MALFORMED_JSON', message: 'Invalid JSON frame.' }));
        return;
      }

      const msgType = typeof msg.type === 'string' ? msg.type : '';

      if (msgType === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', serverTime: now }));
        return;
      }

      if (msgType === 'auth') {
        const token = typeof msg.token === 'string' ? msg.token : undefined;
        const verified = verifyRawToken(token);
        if (!verified) {
          ws.send(JSON.stringify({ type: 'auth_result', ok: false, error: 'Invalid or expired session token.' }));
          return;
        }
        authenticatedUserId = verified.session.userId;
        authenticatedUsername = verified.session.username;
        ws.send(
          JSON.stringify({
            type: 'auth_result',
            ok: true,
            userId: authenticatedUserId,
            username: authenticatedUsername,
          }),
        );
        return;
      }

      if (msgType === 'list_rooms') {
        ws.send(JSON.stringify({ type: 'rooms_list', rooms: roomManager.listPublicRooms() }));
        return;
      }

      if (msgType === 'set_protocol') {
        prefersCompactSnapshots = Boolean(msg.compactSnapshots);
        ws.send(JSON.stringify({ type: 'protocol_ack', compactSnapshots: prefersCompactSnapshots }));
        return;
      }

      if (msgType === 'reconnect') {
        const matchId = typeof msg.matchId === 'string' ? msg.matchId.trim() : '';
        const reconnectToken = typeof msg.reconnectToken === 'string' ? msg.reconnectToken.trim() : '';
        const res = roomManager.reconnectPlayer({
          matchId,
          reconnectToken,
          userId: authenticatedUserId,
          ws,
          compactSnapshots:
            msg.compactSnapshots !== undefined ? Boolean(msg.compactSnapshots) : prefersCompactSnapshots,
        });
        if (!res.ok) {
          ws.send(JSON.stringify({ type: 'error', code: 'RECONNECT_FAILED', message: res.error }));
          return;
        }
        playerId = res.playerId;
        return;
      }

      if (msgType === 'create_room') {
        const check = validateCreateRoomPayload(msg);
        if (!check.ok) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_PAYLOAD', message: check.reason }));
          return;
        }
        roomManager.createRoom(
          {
            id: playerId,
            userId: authenticatedUserId,
            name: authenticatedUsername || check.payload.name,
            vehicleId: check.payload.vehicleId,
            customization: (check.payload.customization as Record<string, unknown>) || {},
            ws,
            compactSnapshots:
              msg.compactSnapshots !== undefined ? Boolean(msg.compactSnapshots) : prefersCompactSnapshots,
          },
          {
            trackId: check.payload.trackId,
            mode: check.payload.mode,
            laps: check.payload.laps,
            fillWithAi: check.payload.fillWithAi,
          },
        );
        return;
      }

      if (msgType === 'join_room' || msgType === 'quick_match') {
        const check = validateJoinRoomPayload(msg);
        if (!check.ok) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_PAYLOAD', message: check.reason }));
          return;
        }
        const res = roomManager.joinRoom(
          {
            id: playerId,
            userId: authenticatedUserId,
            name: authenticatedUsername || check.payload.name,
            vehicleId: check.payload.vehicleId,
            customization: (check.payload.customization as Record<string, unknown>) || {},
            ws,
            compactSnapshots:
              msg.compactSnapshots !== undefined ? Boolean(msg.compactSnapshots) : prefersCompactSnapshots,
          },
          msgType === 'quick_match' ? undefined : check.payload.code,
        );
        if (!res.ok) {
          ws.send(JSON.stringify({ type: 'error', code: 'JOIN_FAILED', message: res.error }));
        }
        return;
      }

      if (msgType === 'leave_room') {
        roomManager.leaveRoom(playerId, true);
        ws.send(JSON.stringify({ type: 'room_left' }));
        return;
      }

      if (msgType === 'toggle_ready') {
        roomManager.toggleReady(playerId);
        return;
      }

      if (msgType === 'start_match') {
        const res = roomManager.startMatch(playerId);
        if (!res.ok) {
          ws.send(JSON.stringify({ type: 'error', code: 'START_FAILED', message: res.error }));
        }
        return;
      }

      if (msgType === 'input') {
        const lastSeq = roomManager.getLastSequence(playerId);
        const check = validatePlayerInput(msg, lastSeq);
        if (!check.ok) {
          ws.send(JSON.stringify({ type: 'error', code: 'INVALID_INPUT', message: check.reason }));
          return;
        }
        const res = roomManager.handlePlayerInput(playerId, check.input);
        if (res.ok) {
          ws.send(JSON.stringify({ type: 'input_ack', sequence: check.input.sequence, serverTime: now }));
        }
        return;
      }

      // V6.0 Section 15 & 18: Explicitly REJECT legacy client-authoritative racer_state and arbitrary combat_use!
      if (msgType === 'racer_state' || msgType === 'combat_use') {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'AUTHORITATIVE_ONLY',
            message: `Message '${msgType}' is rejected in authoritative rooms. Send sequenced 'input' commands only.`,
          }),
        );
        return;
      }

      ws.send(JSON.stringify({ type: 'error', code: 'UNKNOWN_MESSAGE', message: `Unknown message type '${msgType}'.` }));
    });

    ws.on('close', () => {
      // Allow grace-period reconnection during active races
      roomManager.leaveRoom(playerId, false);
    });
  });

  let viteServer: Awaited<ReturnType<typeof createViteServer>> | null = null;
  if (enableVite) {
    if (isProd) {
      const distDir = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } else {
      viteServer = await createViteServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(viteServer.middlewares);
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host;

  const close = async (): Promise<void> => {
    roomManager.shutdown();
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    if (viteServer) {
      await viteServer.close();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    app,
    server,
    wss,
    persistence,
    roomManager,
    port: actualPort,
    url: `http://${connectHost}:${actualPort}`,
    wsUrl: `ws://${connectHost}:${actualPort}/ws`,
    close,
  };
}

// Auto-start only when executed directly as entry point (tsx server.ts / node server.ts)
const isDirectMain = (() => {
  try {
    const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const selfPath = path.resolve(fileURLToPath(import.meta.url));
    return entryPath === selfPath;
  } catch {
    return false;
  }
})();

if (isDirectMain) {
  createAppServer()
    .then((running) => {
      console.log(`[NEON RIVALS] Authoritative Server listening on http://0.0.0.0:${running.port}`);
      const shutdown = async () => {
        await running.close();
        process.exit(0);
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('[NEON RIVALS] Failed to start server:', err);
      process.exit(1);
    });
}
