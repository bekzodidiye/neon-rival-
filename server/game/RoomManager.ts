import crypto from 'crypto';
import { WebSocket } from 'ws';
import type { GameModeId, TrackId, VehicleCustomization } from '../../src/game/types';
import { AI_DRIVER_NAMES } from '../../src/game/ai';
import { VEHICLES } from '../../src/game/vehicles';
import type {
  AuthoritativeMatchResult,
  PlayerInputPayload,
} from '../../shared/protocol/messages';
import type { SimParticipantConfig } from '../../shared/simulation/RaceSimulation';
import type { PersistenceAdapter } from '../persistence/PersistenceAdapter';
import { AuthoritativeRace } from './AuthoritativeRace';

export interface RoomPlayer {
  id: string;
  userId: string | null;
  name: string;
  vehicleId: string;
  customization: Partial<VehicleCustomization>;
  ready: boolean;
  isHost: boolean;
  ws: WebSocket;
  reconnectToken?: string;
  disconnected?: boolean;
  compactSnapshots?: boolean;
}

interface DisconnectedSlot {
  roomCode: string;
  matchId: string;
  playerId: string;
  userId: string | null;
  reconnectToken: string;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

export interface RaceRoom {
  code: string;
  hostId: string;
  trackId: TrackId;
  mode: GameModeId;
  laps: number;
  fillWithAi: boolean;
  status: 'lobby' | 'racing' | 'finished';
  players: Map<string, RoomPlayer>;
  race: AuthoritativeRace | null;
  lastResult: AuthoritativeMatchResult | null;
}

export interface RoomManagerOptions {
  persistence: PersistenceAdapter;
  maxPlayersPerRoom?: number;
  simHz?: number;
  snapshotHz?: number;
  countdownSeconds?: number;
  reconnectGraceMs?: number;
  compactSnapshotsByDefault?: boolean;
}

/**
 * Authoritative multiplayer RoomManager (V7.0 Sections 35–40):
 * - Supports up to 20 simultaneous players per room across multiple isolated rooms.
 * - Issues per-player reconnect tokens on match start and preserves disconnected slots
 *   during the grace period without spawning duplicate vehicles.
 * - Broadcasts compact quantized/delta snapshots to capable clients (and full snapshots to legacy clients).
 */
export class RoomManager {
  private readonly rooms = new Map<string, RaceRoom>();
  private readonly playerToRoom = new Map<string, string>();
  private readonly disconnectedSlots = new Map<string, DisconnectedSlot>(); // key: reconnectToken
  private readonly persistence: PersistenceAdapter;
  private readonly maxPlayersPerRoom: number;
  private readonly simHz: number;
  private readonly snapshotHz: number;
  private readonly countdownSeconds: number;
  private readonly reconnectGraceMs: number;
  private readonly compactSnapshotsByDefault: boolean;

  constructor(options: RoomManagerOptions) {
    this.persistence = options.persistence;
    this.maxPlayersPerRoom = options.maxPlayersPerRoom ?? 20;
    this.simHz = options.simHz ?? 60;
    this.snapshotHz = options.snapshotHz ?? 20;
    this.countdownSeconds = options.countdownSeconds ?? 2.2;
    this.reconnectGraceMs = options.reconnectGraceMs ?? 20_000;
    this.compactSnapshotsByDefault = options.compactSnapshotsByDefault ?? false;
  }

  public getStats(): { roomsActive: number; playersOnline: number; racesRunning: number } {
    let playersOnline = 0;
    let racesRunning = 0;
    for (const r of this.rooms.values()) {
      for (const p of r.players.values()) {
        if (!p.disconnected) playersOnline += 1;
      }
      if (r.status === 'racing' && r.race) racesRunning += 1;
    }
    return { roomsActive: this.rooms.size, playersOnline, racesRunning };
  }

  public listPublicRooms() {
    return Array.from(this.rooms.values())
      .filter((r) => r.status === 'lobby' && r.players.size < this.maxPlayersPerRoom)
      .map((r) => ({
        code: r.code,
        trackId: r.trackId,
        mode: r.mode,
        playerCount: r.players.size,
        maxPlayers: this.maxPlayersPerRoom,
        status: r.status,
      }));
  }

  public serializeRoom(room: RaceRoom) {
    return {
      code: room.code,
      hostId: room.hostId,
      trackId: room.trackId,
      mode: room.mode,
      laps: room.laps,
      status: room.status,
      authoritative: true,
      matchId: room.race?.matchId ?? room.lastResult?.matchId ?? null,
      players: Array.from(room.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        vehicleId: p.vehicleId,
        customization: p.customization,
        ready: p.ready,
        isHost: p.isHost,
        authenticated: Boolean(p.userId),
        disconnected: Boolean(p.disconnected),
      })),
    };
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) {
      out += chars[crypto.randomInt(0, chars.length)];
    }
    return this.rooms.has(out) ? this.generateRoomCode() : out;
  }

  public broadcastRoom(room: RaceRoom, payload: unknown, excludeId?: string): void {
    const raw = JSON.stringify(payload);
    for (const p of room.players.values()) {
      if (excludeId && p.id === excludeId) continue;
      if (!p.disconnected && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(raw);
      }
    }
  }

  public getRoomForPlayer(playerId: string): RaceRoom | null {
    const code = this.playerToRoom.get(playerId);
    if (!code) return null;
    return this.rooms.get(code) ?? null;
  }

  public createRoom(
    player: Omit<RoomPlayer, 'ready' | 'isHost'>,
    config: { trackId: TrackId; mode: GameModeId; laps: number; fillWithAi?: boolean },
  ): RaceRoom {
    this.leaveRoom(player.id, true);
    const code = this.generateRoomCode();
    const room: RaceRoom = {
      code,
      hostId: player.id,
      trackId: config.trackId,
      mode: config.mode,
      laps: config.laps,
      fillWithAi: config.fillWithAi ?? true,
      status: 'lobby',
      players: new Map(),
      race: null,
      lastResult: null,
    };
    room.players.set(player.id, {
      ...player,
      ready: true,
      isHost: true,
      compactSnapshots: player.compactSnapshots ?? this.compactSnapshotsByDefault,
    });
    this.rooms.set(code, room);
    this.playerToRoom.set(player.id, code);
    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
    return room;
  }

  public joinRoom(
    player: Omit<RoomPlayer, 'ready' | 'isHost'>,
    codeOrQuickMatch?: string,
  ): { ok: true; room: RaceRoom } | { ok: false; error: string } {
    this.leaveRoom(player.id, true);
    let room: RaceRoom | undefined;
    if (!codeOrQuickMatch) {
      room = Array.from(this.rooms.values()).find(
        (r) => r.status === 'lobby' && r.players.size < this.maxPlayersPerRoom,
      );
      if (!room) {
        const created = this.createRoom(player, {
          trackId: 'neon_city',
          mode: 'combat_race',
          laps: 3,
          fillWithAi: true,
        });
        return { ok: true, room: created };
      }
    } else {
      room = this.rooms.get(codeOrQuickMatch.trim().toUpperCase());
    }

    if (!room) return { ok: false, error: 'Room code not found.' };
    if (room.players.size >= this.maxPlayersPerRoom) {
      return { ok: false, error: `Room is full (${this.maxPlayersPerRoom}/${this.maxPlayersPerRoom}).` };
    }
    if (room.status !== 'lobby') {
      return { ok: false, error: 'Race already in progress.' };
    }

    const isHost = room.players.size === 0;
    if (isHost) room.hostId = player.id;

    room.players.set(player.id, {
      ...player,
      ready: isHost,
      isHost,
      compactSnapshots: player.compactSnapshots ?? this.compactSnapshotsByDefault,
    });
    this.playerToRoom.set(player.id, room.code);
    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
    return { ok: true, room };
  }

  /**
   * Handles explicit leave (`forceRemove = true`) vs socket disconnect (`forceRemove = false`).
   * During an active authoritative race, a disconnect holds the player slot for `reconnectGraceMs`
   * so they can reconnect without losing progress or spawning a duplicate vehicle.
   */
  public leaveRoom(playerId: string, forceRemove = true): void {
    const code = this.playerToRoom.get(playerId);
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) {
      this.playerToRoom.delete(playerId);
      return;
    }

    const player = room.players.get(playerId);
    if (!forceRemove && room.status === 'racing' && room.race && player && player.reconnectToken) {
      player.disconnected = true;
      const token = player.reconnectToken;
      const existingSlot = this.disconnectedSlots.get(token);
      if (existingSlot) clearTimeout(existingSlot.timer);

      const timer = setTimeout(() => {
        this.disconnectedSlots.delete(token);
        if (player.disconnected) {
          this.leaveRoom(playerId, true);
        }
      }, this.reconnectGraceMs);

      this.disconnectedSlots.set(token, {
        roomCode: room.code,
        matchId: room.race.matchId,
        playerId,
        userId: player.userId,
        reconnectToken: token,
        expiresAt: Date.now() + this.reconnectGraceMs,
        timer,
      });
      this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
      return;
    }

    this.playerToRoom.delete(playerId);
    if (player?.reconnectToken) {
      const slot = this.disconnectedSlots.get(player.reconnectToken);
      if (slot) {
        clearTimeout(slot.timer);
        this.disconnectedSlots.delete(player.reconnectToken);
      }
    }
    room.players.delete(playerId);
    room.race?.inputQueue.removePlayer(playerId);

    const activeHumans = Array.from(room.players.values()).filter((p) => !p.disconnected);
    if (room.players.size === 0 || (activeHumans.length === 0 && room.status === 'lobby')) {
      room.race?.stop();
      room.race = null;
      this.rooms.delete(code);
      return;
    }

    if (room.hostId === playerId) {
      const nextHost = activeHumans[0] ?? Array.from(room.players.values())[0];
      if (nextHost) {
        nextHost.isHost = true;
        room.hostId = nextHost.id;
      }
    }
    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
  }

  /**
   * Rebinds a reconnecting WebSocket to its preserved active race slot (V7.0 Section 39).
   * Prevents duplicate vehicles and immediately sends the latest authoritative keyframe snapshot.
   */
  public reconnectPlayer(params: {
    matchId: string;
    reconnectToken: string;
    userId: string | null;
    ws: WebSocket;
    compactSnapshots?: boolean;
  }): { ok: true; playerId: string; room: RaceRoom; lastSequence: number } | { ok: false; error: string } {
    const slot = this.disconnectedSlots.get(params.reconnectToken);
    if (!slot || slot.matchId !== params.matchId) {
      return { ok: false, error: 'Reconnect token invalid or expired.' };
    }
    if (slot.userId && params.userId && slot.userId !== params.userId) {
      return { ok: false, error: 'Authenticated account does not match original match participant.' };
    }

    const room = this.rooms.get(slot.roomCode);
    if (!room || !room.race || room.race.matchId !== params.matchId) {
      clearTimeout(slot.timer);
      this.disconnectedSlots.delete(params.reconnectToken);
      return { ok: false, error: 'Match is no longer active.' };
    }

    const player = room.players.get(slot.playerId);
    if (!player) {
      clearTimeout(slot.timer);
      this.disconnectedSlots.delete(params.reconnectToken);
      return { ok: false, error: 'Player slot no longer exists.' };
    }

    clearTimeout(slot.timer);
    this.disconnectedSlots.delete(params.reconnectToken);

    // Close any stale socket safely before rebinding
    if (player.ws !== params.ws && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.close(4001, 'Superseded by reconnected session');
      } catch {
        // ignore
      }
    }

    player.ws = params.ws;
    player.disconnected = false;
    if (params.compactSnapshots !== undefined) {
      player.compactSnapshots = params.compactSnapshots;
    }

    const lastSequence = room.race.inputQueue.getLastSequence(player.id);
    const { full, compact } = room.race.buildKeyframeSnapshot();
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(
        JSON.stringify({
          type: 'reconnected',
          playerId: player.id,
          matchId: room.race.matchId,
          room: this.serializeRoom(room),
          lastSequence,
        }),
      );
      player.ws.send(JSON.stringify(player.compactSnapshots ? compact : full));
    }

    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
    return { ok: true, playerId: player.id, room, lastSequence };
  }

  public toggleReady(playerId: string): void {
    const room = this.getRoomForPlayer(playerId);
    if (!room || room.status !== 'lobby') return;
    const p = room.players.get(playerId);
    if (!p) return;
    p.ready = !p.ready;
    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
  }

  public startMatch(
    playerId: string,
    overrides?: { countdownSeconds?: number; seed?: number },
  ): { ok: true; matchId: string } | { ok: false; error: string } {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return { ok: false, error: 'Not in a room.' };
    if (room.hostId !== playerId) return { ok: false, error: 'Only the host can start the race.' };
    if (room.status !== 'lobby') return { ok: false, error: 'Match already started.' };

    const participants: SimParticipantConfig[] = [];
    for (const p of room.players.values()) {
      p.reconnectToken = `rct_${crypto.randomBytes(16).toString('hex')}`;
      p.disconnected = false;
      participants.push({
        id: p.id,
        userId: p.userId,
        name: p.name,
        vehicleId: p.vehicleId,
        customization: p.customization,
        isAi: false,
      });
    }

    // Backfill up to 8 grid slots with AI opponents when enabled (up to 20 humans supported without cap!)
    if (room.fillWithAi && room.mode !== 'time_trial' && room.mode !== 'checkpoint') {
      const targetGrid = Math.max(participants.length, 8);
      let aiIdx = 0;
      while (participants.length < targetGrid && participants.length < this.maxPlayersPerRoom) {
        const car = VEHICLES[(aiIdx + 1) % VEHICLES.length];
        participants.push({
          id: `ai_${aiIdx + 1}`,
          userId: null,
          name: AI_DRIVER_NAMES[aiIdx % AI_DRIVER_NAMES.length],
          vehicleId: car.id,
          isAi: true,
        });
        aiIdx += 1;
      }
    }

    room.status = 'racing';
    room.lastResult = null;
    room.race = new AuthoritativeRace({
      roomCode: room.code,
      trackId: room.trackId,
      mode: room.mode,
      laps: room.laps,
      difficulty: 'normal',
      participants,
      simHz: this.simHz,
      snapshotHz: this.snapshotHz,
      countdownSeconds: overrides?.countdownSeconds ?? this.countdownSeconds,
      seed: overrides?.seed,
      onSnapshot: (snap, compact) => {
        let fullJson: string | null = null;
        let compactJson: string | null = null;
        for (const p of room.players.values()) {
          if (p.disconnected || p.ws.readyState !== WebSocket.OPEN) continue;
          if (p.compactSnapshots && compact) {
            if (!compactJson) compactJson = JSON.stringify(compact);
            p.ws.send(compactJson);
          } else {
            if (!fullJson) fullJson = JSON.stringify(snap);
            p.ws.send(fullJson);
          }
        }
      },
      onFinished: (result) => {
        room.status = 'finished';
        room.lastResult = result;
        const persistRes = this.persistence.recordVerifiedMatchResult(result);
        // Clear any pending reconnect slots for this match
        for (const [tok, slot] of this.disconnectedSlots.entries()) {
          if (slot.matchId === result.matchId) {
            clearTimeout(slot.timer);
            this.disconnectedSlots.delete(tok);
          }
        }
        this.broadcastRoom(room, {
          type: 'match_finished',
          result,
          rewardsIssuedCount: persistRes.rewardsIssued.length,
        });
        // Prune disconnected players before returning room to lobby
        for (const [pid, pl] of Array.from(room.players.entries())) {
          if (pl.disconnected) {
            room.players.delete(pid);
            this.playerToRoom.delete(pid);
          }
        }
        room.status = 'lobby';
        room.race = null;
        if (room.players.size === 0) {
          this.rooms.delete(room.code);
        } else {
          this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
        }
      },
    });

    // Send personalized race_start carrying each player's private reconnectToken
    const serializedRoom = this.serializeRoom(room);
    for (const p of room.players.values()) {
      if (p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(
          JSON.stringify({
            type: 'race_start',
            room: serializedRoom,
            matchId: room.race.matchId,
            reconnectToken: p.reconnectToken,
            authoritative: true,
          }),
        );
      }
    }
    room.race.start();
    return { ok: true, matchId: room.race.matchId };
  }

  public handlePlayerInput(playerId: string, payload: PlayerInputPayload): { ok: boolean; reason?: string } {
    const room = this.getRoomForPlayer(playerId);
    if (!room || room.status !== 'racing' || !room.race) {
      return { ok: false, reason: 'No active authoritative race.' };
    }
    room.race.inputQueue.enqueue(playerId, payload);
    return { ok: true };
  }

  public getLastSequence(playerId: string): number {
    const room = this.getRoomForPlayer(playerId);
    return room?.race?.inputQueue.getLastSequence(playerId) ?? 0;
  }

  public shutdown(): void {
    for (const slot of this.disconnectedSlots.values()) {
      clearTimeout(slot.timer);
    }
    this.disconnectedSlots.clear();
    for (const room of this.rooms.values()) {
      room.race?.stop();
      room.race = null;
    }
    this.rooms.clear();
    this.playerToRoom.clear();
  }
}
