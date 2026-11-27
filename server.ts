import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

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

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(`nr_salt_${pw}`).digest('hex');
}

// Authoritative Multiplayer Room State
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

const rooms = new Map<string, GameRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
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
  app.use(express.json({ limit: '256kb' }));

  // REST API Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, roomsActive: rooms.size, playersOnline: Array.from(rooms.values()).reduce((a, r) => a + r.players.size, 0) });
  });

  app.get('/api/leaderboard', (_req, res) => {
    const sorted = [...store.leaderboard].sort((a, b) => b.fanPoints - a.fanPoints).slice(0, 20);
    res.json({ leaderboard: sorted });
  });

  app.post('/api/auth/register', (req, res) => {
    const username = String(req.body?.username || '').trim().slice(0, 20);
    const password = String(req.body?.password || '');
    if (username.length < 3 || password.length < 4) {
      res.status(400).json({ error: 'Username (3+ chars) and password (4+ chars) required.' });
      return;
    }
    const key = username.toLowerCase();
    if (store.users[key]) {
      res.status(409).json({ error: 'Username already registered.' });
      return;
    }
    const user: StoredUser = {
      id: `usr_${crypto.randomBytes(4).toString('hex')}`,
      username,
      passwordHash: hashPassword(password),
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
    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.post('/api/auth/login', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const user = store.users[username.toLowerCase()];
    if (!user || user.passwordHash !== hashPassword(password)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    const { passwordHash: _omit, ...safeUser } = user;
    res.json({ user: safeUser });
  });

  app.post('/api/race/complete', (req, res) => {
    const username = String(req.body?.username || 'DRIVER_01').trim().slice(0, 20);
    const fanPoints = Math.max(0, Math.min(500000, Number(req.body?.fanPoints || 0)));
    const wins = Math.max(0, Math.min(10000, Number(req.body?.wins || 0)));
    const vehicle = String(req.body?.vehicle || 'STREET FALCON').slice(0, 24);

    const existing = store.leaderboard.find((e) => e.username.toLowerCase() === username.toLowerCase());
    if (existing) {
      existing.fanPoints = Math.max(existing.fanPoints, fanPoints);
      existing.wins = Math.max(existing.wins, wins);
      existing.vehicle = vehicle;
      existing.updatedAt = new Date().toISOString();
    } else {
      store.leaderboard.push({ username, fanPoints, wins, vehicle, updatedAt: new Date().toISOString() });
    }
    saveStore(store);
    res.json({ ok: true });
  });

  const server = http.createServer(app);

  // Real-Time WebSocket Multiplayer Server on /ws
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const playerId = `net_${crypto.randomBytes(4).toString('hex')}`;
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
      // Rate limiting against WebSocket flooding (max 60 msgs / sec)
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        msgCountWindow = 0;
      }
      msgCountWindow += 1;
      if (msgCountWindow > 65) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
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
        const room: GameRoom = {
          code,
          hostId: playerId,
          trackId: String(msg.trackId || 'neon_city'),
          mode: String(msg.mode || 'combat_race'),
          laps: Math.max(1, Math.min(5, Number(msg.laps || 3))),
          status: 'lobby',
          players: new Map(),
        };
        room.players.set(playerId, {
          id: playerId,
          name: String(msg.name || 'DRIVER').slice(0, 18),
          vehicleId: String(msg.vehicleId || 'street_falcon'),
          customization: (msg.customization as Record<string, unknown>) || {},
          ready: true,
          isHost: true,
          ws,
          lastStateAt: now,
          lastX: 0,
          lastZ: 0,
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
            // Auto-create a public room if none open
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
          name: String(msg.name || 'DRIVER').slice(0, 18),
          vehicleId: String(msg.vehicleId || 'street_falcon'),
          customization: (msg.customization as Record<string, unknown>) || {},
          ready: isHost,
          isHost,
          ws,
          lastStateAt: now,
          lastX: 0,
          lastZ: 0,
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

      if (msg.type === 'racer_state' && room.status === 'racing') {
        const st = msg.state as Record<string, number | boolean> | undefined;
        if (!st) return;
        // Anti-cheat server speed & HP sanity clamping
        const clampedSpeed = Math.max(-30, Math.min(125, Number(st.speed || 0)));
        const clampedHp = Math.max(0, Math.min(140, Number(st.hp || 100)));
        const x = Number(st.x || 0);
        const z = Number(st.z || 0);
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
              heading: Number(st.heading || 0),
              speed: clampedSpeed,
              hp: clampedHp,
              lap: Math.max(1, Math.min(10, Number(st.lap || 1))),
              totalProgress: Number(st.totalProgress || 0),
              shieldTimer: Math.max(0, Math.min(5, Number(st.shieldTimer || 0))),
              nitroTimer: Math.max(0, Math.min(5, Number(st.nitroTimer || 0))),
              destroyed: Boolean(st.destroyed),
            },
          },
          playerId,
        );
        return;
      }

      if (msg.type === 'combat_use' && room.status === 'racing') {
        broadcastRoom(
          room,
          {
            type: 'combat_event',
            ownerId: playerId,
            powerUpType: String(msg.typeName || msg.powerUpType || msg.type || 'BOLT'),
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
