import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

// Cryptographic signing key for Bearer session tokens (env override or fresh per-process CSPRNG key)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Persistent JSON data store for accounts, profiles, and global leaderboard
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  level: number;
  xp: number;
  credits: number;
  fanPoints: number;
  racesCompleted: number;
  wins: number;
  takedowns: number;
  ownedVehicles: string[];
  selectedVehicleId: string;
}

interface DataStore {
  users: Record<string, StoredUser>;
  leaderboard: { username: string; fanPoints: number; wins: number; vehicle: string; updatedAt: string }[];
}

interface SessionRecord {
  userId: string;
  userKey: string;
  username: string;
  expiresAt: number;
}

function loadStore(): DataStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8')) as DataStore;
    }
  } catch {
    // fallback to seed store
  }
  return {
    users: {},
    leaderboard: [
      { username: 'NOVA_APEX', fanPoints: 14850, wins: 29, vehicle: 'PHANTOM X', updatedAt: new Date().toISOString() },
      { username: 'KAZUYA_GT', fanPoints: 12120, wins: 24, vehicle: 'CYBER GT-R', updatedAt: new Date().toISOString() },
      { username: 'VALKYRIE_X', fanPoints: 9840, wins: 19, vehicle: 'NIGHT VIPER', updatedAt: new Date().toISOString() },
      { username: 'TASHKENT_DRIFT', fanPoints: 8420, wins: 15, vehicle: 'CYBER GT-R', updatedAt: new Date().toISOString() },
      { username: 'RAZOR_VOLT', fanPoints: 6790, wins: 11, vehicle: 'STREET FALCON', updatedAt: new Date().toISOString() },
    ],
  };
}

function saveStore(store: DataStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
  } catch {
    // ignore read-only disk environments
  }
}

const store = loadStore();

// Active signed sessions & replay-protection ledger
const activeSessions = new Map<string, SessionRecord>();
const claimedRaceTransactions = new Set<string>();
const authRateLimiter = new Map<string, { count: number; resetAt: number }>();

/**
 * Per-user random-salt scrypt password hashing (replaces legacy static-salt SHA-256).
 */
function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, storedHash: string): { valid: boolean; needsMigration: boolean } {
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return { valid: false, needsMigration: false };
    const [, salt, expectedHex] = parts;
    const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
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

function issueSessionToken(user: StoredUser, userKey: string): string {
  const jti = crypto.randomBytes(18).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ jti, uid: user.id, uk: userKey, exp: expiresAt }),
    'utf-8',
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const token = `${payload}.${sig}`;
  activeSessions.set(jti, { userId: user.id, userKey, username: user.username, expiresAt });
  return token;
}

function verifyBearerSession(authHeader: string | undefined): { jti: string; session: SessionRecord } | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
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
      if (parsed.jti) activeSessions.delete(parsed.jti);
      return null;
    }
    const rec = activeSessions.get(parsed.jti);
    if (!rec || rec.expiresAt < Date.now()) {
      activeSessions.delete(parsed.jti);
      return null;
    }
    return { jti: parsed.jti, session: rec };
  } catch {
    return null;
  }
}

function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = authRateLimiter.get(ip);
  if (!entry || now > entry.resetAt) {
    authRateLimiter.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 15;
}

function computeAuthoritativeRaceRewards(input: {
  position: number;
  totalRacers: number;
  hitsLanded: number;
  takedowns: number;
  blocksLanded: number;
  difficulty: string;
}): { credits: number; xp: number; fanPoints: number } {
  const pos = Math.max(1, Math.min(8, Math.round(input.position)));
  const hits = Math.max(0, Math.min(35, Math.round(input.hitsLanded)));
  const takedowns = Math.max(0, Math.min(12, Math.round(input.takedowns)));
  const blocks = Math.max(0, Math.min(25, Math.round(input.blocksLanded)));
  const diffMult = input.difficulty === 'pro' ? 1.5 : input.difficulty === 'easy' ? 0.85 : 1.0;

  const positionTable = [1800, 1300, 950, 700, 520, 400, 320, 260];
  const baseCredits = positionTable[Math.min(pos - 1, positionTable.length - 1)] ?? 260;
  const credits = Math.round((baseCredits + hits * 45 + takedowns * 220 + blocks * 60) * diffMult);
  const xp = Math.round((260 + (9 - pos) * 55 + hits * 20 + takedowns * 90) * diffMult);
  const fanPoints = Math.round((180 + (9 - pos) * 65 + hits * 35 + takedowns * 140 + blocks * 50) * diffMult);
  return { credits, xp, fanPoints };
}

// Authoritative Multiplayer Room State
interface ValidatedInputState {
  sequence: number;
  throttle: number;
  brake: number;
  steering: number;
  drift: boolean;
  firePowerUp: boolean;
  rearFire: boolean;
  receivedAt: number;
}

interface RoomPlayer {
  id: string;
  name: string;
  vehicleId: string;
  customization: Record<string, unknown>;
  ready: boolean;
  isHost: boolean;
  ws: WebSocket;
  lastStateAt: number;
  lastX: number;
  lastZ: number;
  lastInputSeq: number;
  lastInput: ValidatedInputState | null;
}

interface GameRoom {
  code: string;
  hostId: string;
  trackId: string;
  mode: string;
  laps: number;
  status: 'lobby' | 'countdown' | 'racing' | 'finished';
  players: Map<string, RoomPlayer>;
}

const ALLOWED_TRACKS = new Set(['neon_city', 'coastal_highway', 'desert_canyon']);
const ALLOWED_MODES = new Set(['combat_race', 'elimination', 'time_trial', 'destruction']);
const ALLOWED_POWERUPS = new Set(['NITRO', 'SHUNT', 'BOLT', 'MINE', 'SHOCK', 'BARGE', 'SHIELD', 'REPAIR']);

const rooms = new Map<string, GameRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[crypto.randomInt(0, chars.length)];
  }
  return rooms.has(out) ? generateRoomCode() : out;
}

function serializeRoom(room: GameRoom) {
  return {
    code: room.code,
    hostId: room.hostId,
    trackId: room.trackId,
    mode: room.mode,
    laps: room.laps,
    status: room.status,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      vehicleId: p.vehicleId,
      customization: p.customization,
      ready: p.ready,
      isHost: p.isHost,
    })),
  };
}

function broadcastRoom(room: GameRoom, payload: unknown, excludeId?: string) {
  const raw = JSON.stringify(payload);
  for (const p of room.players.values()) {
    if (excludeId && p.id === excludeId) continue;
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(raw);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '128kb' }));

  // REST API Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      roomsActive: rooms.size,
      playersOnline: Array.from(rooms.values()).reduce((a, r) => a + r.players.size, 0),
    });
  });

  app.get('/api/leaderboard', (_req, res) => {
    const sorted = [...store.leaderboard].sort((a, b) => b.fanPoints - a.fanPoints).slice(0, 20);
    res.json({ leaderboard: sorted });
  });

  app.get('/api/auth/me', (req, res) => {
    const auth = verifyBearerSession(req.headers.authorization);
    if (!auth) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    const user = store.users[auth.session.userKey];
    if (!user) {
      res.status(401).json({ error: 'Session account no longer exists.' });
      return;
    }
    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.post('/api/auth/register', (req, res) => {
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
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    const key = username.toLowerCase();
    if (store.users[key]) {
      res.status(409).json({ error: 'Username already registered.' });
      return;
    }
    const user: StoredUser = {
      id: `usr_${crypto.randomBytes(6).toString('hex')}`,
      username,
      passwordHash: hashPasswordScrypt(password),
      level: 1,
      xp: 0,
      credits: 3000,
      fanPoints: 350,
      racesCompleted: 0,
      wins: 0,
      takedowns: 0,
      ownedVehicles: ['street_falcon'],
      selectedVehicleId: 'street_falcon',
    };
    store.users[key] = user;
    saveStore(store);
    const token = issueSessionToken(user, key);
    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  app.post('/api/auth/login', (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkAuthRateLimit(clientIp)) {
      res.status(429).json({ error: 'Too many authentication attempts. Please wait a minute.' });
      return;
    }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const key = username.toLowerCase();
    const user = store.users[key];
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    const check = verifyPassword(password, user.passwordHash);
    if (!check.valid) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    // Seamlessly upgrade legacy SHA-256 accounts to salted scrypt
    if (check.needsMigration) {
      user.passwordHash = hashPasswordScrypt(password);
      saveStore(store);
    }
    const token = issueSessionToken(user, key);
    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser, token });
  });

  app.post('/api/auth/logout', (req, res) => {
    const auth = verifyBearerSession(req.headers.authorization);
    if (auth) {
      activeSessions.delete(auth.jti);
    }
    res.json({ ok: true });
  });

  // Authenticated, replay-protected, server-computed race reward submission
  app.post('/api/race/complete', (req, res) => {
    const auth = verifyBearerSession(req.headers.authorization);
    if (!auth) {
      res.status(401).json({ error: 'Authentication required to record ranked race results.' });
      return;
    }

    const user = store.users[auth.session.userKey];
    if (!user) {
      res.status(401).json({ error: 'Account not found.' });
      return;
    }

    const transactionId = String(req.body?.transactionId || '').trim().slice(0, 64);
    if (!transactionId || transactionId.length < 8) {
      res.status(400).json({ error: 'Valid race transactionId is required.' });
      return;
    }
    if (claimedRaceTransactions.has(transactionId)) {
      res.status(409).json({ error: 'Race result already recorded.' });
      return;
    }

    const position = Number(req.body?.position);
    const totalRacers = Number(req.body?.totalRacers || 8);
    const hitsLanded = Number(req.body?.hitsLanded || 0);
    const takedowns = Number(req.body?.takedowns || 0);
    const blocksLanded = Number(req.body?.blocksLanded || 0);
    const difficulty = String(req.body?.difficulty || 'normal');
    const vehicle = String(req.body?.vehicle || 'STREET FALCON').trim().slice(0, 24);

    if (!Number.isFinite(position) || position < 1 || position > 8) {
      res.status(400).json({ error: 'Invalid race position.' });
      return;
    }

    claimedRaceTransactions.add(transactionId);
    if (claimedRaceTransactions.size > 5000) {
      const oldest = claimedRaceTransactions.values().next().value;
      if (oldest) claimedRaceTransactions.delete(oldest);
    }

    // Compute rewards strictly server-side (ignore any client-sent fanPoints / wins / credits)
    const earned = computeAuthoritativeRaceRewards({
      position,
      totalRacers,
      hitsLanded,
      takedowns,
      blocksLanded,
      difficulty,
    });

    user.credits += earned.credits;
    user.xp += earned.xp;
    user.fanPoints += earned.fanPoints;
    user.racesCompleted += 1;
    if (Math.round(position) === 1) user.wins += 1;
    user.takedowns += Math.max(0, Math.min(12, Math.round(takedowns)));

    const existing = store.leaderboard.find((e) => e.username.toLowerCase() === user.username.toLowerCase());
    if (existing) {
      existing.fanPoints = user.fanPoints;
      existing.wins = user.wins;
      existing.vehicle = vehicle;
      existing.updatedAt = new Date().toISOString();
    } else {
      store.leaderboard.push({
        username: user.username,
        fanPoints: user.fanPoints,
        wins: user.wins,
        vehicle,
        updatedAt: new Date().toISOString(),
      });
    }
    saveStore(store);

    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ ok: true, earned, user: safeUser });
  });

  const server = http.createServer(app);

  // Real-Time WebSocket Multiplayer Server on /ws (with payload cap)
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    const playerId = `net_${crypto.randomBytes(6).toString('hex')}`;
    let currentRoomCode: string | null = null;
    let msgCountWindow = 0;
    let windowStart = Date.now();

    ws.send(JSON.stringify({ type: 'welcome', playerId }));

    const leaveCurrentRoom = () => {
      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (room) {
        room.players.delete(playerId);
        if (room.players.size === 0) {
          rooms.delete(currentRoomCode);
        } else {
          if (room.hostId === playerId) {
            const nextHost = Array.from(room.players.values())[0];
            if (nextHost) {
              nextHost.isHost = true;
              room.hostId = nextHost.id;
            }
          }
          broadcastRoom(room, { type: 'room_state', room: serializeRoom(room) });
        }
      }
      currentRoomCode = null;
    };

    ws.on('message', (raw) => {
      // Rate limiting against WebSocket flooding (max 70 msgs / sec)
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        msgCountWindow = 0;
      }
      msgCountWindow += 1;
      if (msgCountWindow > 70) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', serverTime: now }));
        return;
      }

      if (msg.type === 'list_rooms') {
        const list = Array.from(rooms.values())
          .filter((r) => r.status === 'lobby' && r.players.size < 8)
          .map((r) => ({
            code: r.code,
            trackId: r.trackId,
            mode: r.mode,
            playerCount: r.players.size,
            status: r.status,
          }));
        ws.send(JSON.stringify({ type: 'rooms_list', rooms: list }));
        return;
      }

      if (msg.type === 'create_room') {
        leaveCurrentRoom();
        const code = generateRoomCode();
        const rawTrack = String(msg.trackId || 'neon_city');
        const rawMode = String(msg.mode || 'combat_race');
        const room: GameRoom = {
          code,
          hostId: playerId,
          trackId: ALLOWED_TRACKS.has(rawTrack) ? rawTrack : 'neon_city',
          mode: ALLOWED_MODES.has(rawMode) ? rawMode : 'combat_race',
          laps: Math.max(1, Math.min(5, Math.round(Number(msg.laps || 3)))),
          status: 'lobby',
          players: new Map(),
        };
        room.players.set(playerId, {
          id: playerId,
          name: String(msg.name || 'DRIVER').replace(/[^\w\s-]/g, '').trim().slice(0, 18) || 'DRIVER',
          vehicleId: String(msg.vehicleId || 'street_falcon').slice(0, 32),
          customization: (msg.customization as Record<string, unknown>) || {},
          ready: true,
          isHost: true,
          ws,
          lastStateAt: now,
          lastX: 0,
          lastZ: 0,
          lastInputSeq: 0,
          lastInput: null,
        });
        rooms.set(code, room);
        currentRoomCode = code;
        ws.send(JSON.stringify({ type: 'room_state', room: serializeRoom(room) }));
        return;
      }

      if (msg.type === 'join_room' || msg.type === 'quick_match') {
        leaveCurrentRoom();
        let room: GameRoom | undefined;
        if (msg.type === 'quick_match') {
          room = Array.from(rooms.values()).find((r) => r.status === 'lobby' && r.players.size < 8);
          if (!room) {
            const code = generateRoomCode();
            room = {
              code,
              hostId: playerId,
              trackId: 'neon_city',
              mode: 'combat_race',
              laps: 3,
              status: 'lobby',
              players: new Map(),
            };
            rooms.set(code, room);
          }
        } else {
          const code = String(msg.code || '').trim().toUpperCase();
          room = rooms.get(code);
        }

        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room code not found.' }));
          return;
        }
        if (room.players.size >= 8) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full (8/8).' }));
          return;
        }
        if (room.status !== 'lobby') {
          ws.send(JSON.stringify({ type: 'error', message: 'Race already in progress.' }));
          return;
        }

        const isHost = room.players.size === 0;
        if (isHost) room.hostId = playerId;

        room.players.set(playerId, {
          id: playerId,
          name: String(msg.name || 'DRIVER').replace(/[^\w\s-]/g, '').trim().slice(0, 18) || 'DRIVER',
          vehicleId: String(msg.vehicleId || 'street_falcon').slice(0, 32),
          customization: (msg.customization as Record<string, unknown>) || {},
          ready: isHost,
          isHost,
          ws,
          lastStateAt: now,
          lastX: 0,
          lastZ: 0,
          lastInputSeq: 0,
          lastInput: null,
        });
        currentRoomCode = room.code;
        broadcastRoom(room, { type: 'room_state', room: serializeRoom(room) });
        return;
      }

      if (msg.type === 'leave_room') {
        leaveCurrentRoom();
        ws.send(JSON.stringify({ type: 'room_left' }));
        return;
      }

      if (!currentRoomCode) return;
      const room = rooms.get(currentRoomCode);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;

      if (msg.type === 'toggle_ready') {
        player.ready = !player.ready;
        broadcastRoom(room, { type: 'room_state', room: serializeRoom(room) });
        return;
      }

      if (msg.type === 'start_match') {
        if (room.hostId !== playerId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only the host can start the race.' }));
          return;
        }
        room.status = 'racing';
        broadcastRoom(room, { type: 'race_start', room: serializeRoom(room) });
        return;
      }

      // V5.0 Stage 9: Validated authoritative PlayerInputMessage command protocol
      if (msg.type === 'input' && room.status === 'racing') {
        const seq = Number(msg.sequence);
        if (!Number.isFinite(seq) || seq <= player.lastInputSeq) return;
        const throttle = Number(msg.throttle);
        const brake = Number(msg.brake);
        const steering = Number(msg.steering);
        if (!Number.isFinite(throttle) || !Number.isFinite(brake) || !Number.isFinite(steering)) return;

        player.lastInputSeq = seq;
        player.lastInput = {
          sequence: seq,
          throttle: Math.max(0, Math.min(1, throttle)),
          brake: Math.max(0, Math.min(1, brake)),
          steering: Math.max(-1, Math.min(1, steering)),
          drift: Boolean(msg.drift),
          firePowerUp: Boolean(msg.firePowerUp),
          rearFire: Boolean(msg.rearFire),
          receivedAt: now,
        };
        ws.send(JSON.stringify({ type: 'input_ack', sequence: seq, serverTime: now }));
        return;
      }

      if (msg.type === 'racer_state' && room.status === 'racing') {
        const st = msg.state as Record<string, number | boolean> | undefined;
        if (!st) return;
        const x = Number(st.x);
        const z = Number(st.z);
        const heading = Number(st.heading);
        if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(heading)) return;

        // Anti-cheat velocity & teleportation sanity clamping
        const dtSec = Math.max(0.03, (now - player.lastStateAt) / 1000);
        const dist = player.lastX === 0 && player.lastZ === 0 ? 0 : Math.hypot(x - player.lastX, z - player.lastZ);
        if (dist > Math.max(25, 130 * dtSec)) {
          // Reject impossible teleport spike
          return;
        }

        const clampedSpeed = Math.max(-30, Math.min(115, Number(st.speed || 0)));
        const clampedHp = Math.max(0, Math.min(160, Number(st.hp || 100)));
        player.lastX = x;
        player.lastZ = z;
        player.lastStateAt = now;

        broadcastRoom(
          room,
          {
            type: 'racer_snapshot',
            racer: {
              id: playerId,
              name: player.name,
              vehicleId: player.vehicleId,
              customization: player.customization,
              x,
              z,
              heading,
              speed: clampedSpeed,
              hp: clampedHp,
              lap: Math.max(1, Math.min(10, Math.round(Number(st.lap || 1)))),
              totalProgress: Number(st.totalProgress || 0),
              shieldTimer: Math.max(0, Math.min(6, Number(st.shieldTimer || 0))),
              nitroTimer: Math.max(0, Math.min(5, Number(st.nitroTimer || 0))),
              destroyed: Boolean(st.destroyed),
            },
          },
          playerId,
        );
        return;
      }

      if (msg.type === 'combat_use' && room.status === 'racing') {
        const rawPowerUp = String(msg.powerUpType || msg.typeName || 'BOLT');
        const safePowerUp = ALLOWED_POWERUPS.has(rawPowerUp) ? rawPowerUp : 'BOLT';
        broadcastRoom(
          room,
          {
            type: 'combat_event',
            ownerId: playerId,
            powerUpType: safePowerUp,
            rearFired: Boolean(msg.rearFired),
          },
          playerId,
        );
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom();
    });
  });

  if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[NEON RIVALS] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
