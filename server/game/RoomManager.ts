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
}

/**
 * Authoritative multiplayer RoomManager (V6.0 Sections 15, 16, 18, 19).
 * Owns lobby lifecycle, authoritative match execution, snapshot fanout,
 * verified match persistence, and graceful cleanup on disconnect/shutdown.
 */
export class RoomManager {
  private readonly rooms = new Map<string, RaceRoom>();
  private readonly playerToRoom = new Map<string, string>();
  private readonly persistence: PersistenceAdapter;
  private readonly maxPlayersPerRoom: number;
  private readonly simHz: number;
  private readonly snapshotHz: number;
  private readonly countdownSeconds: number;

  constructor(options: RoomManagerOptions) {
    this.persistence = options.persistence;
    this.maxPlayersPerRoom = options.maxPlayersPerRoom ?? 20;
    this.simHz = options.simHz ?? 60;
    this.snapshotHz = options.snapshotHz ?? 20;
    this.countdownSeconds = options.countdownSeconds ?? 2.2;
  }

  public getStats(): { roomsActive: number; playersOnline: number; racesRunning: number } {
    let playersOnline = 0;
    let racesRunning = 0;
    for (const r of this.rooms.values()) {
      playersOnline += r.players.size;
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
      if (p.ws.readyState === WebSocket.OPEN) {
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
    this.leaveRoom(player.id);
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
    room.players.set(player.id, { ...player, ready: true, isHost: true });
    this.rooms.set(code, room);
    this.playerToRoom.set(player.id, code);
    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
    return room;
  }

  public joinRoom(
    player: Omit<RoomPlayer, 'ready' | 'isHost'>,
    codeOrQuickMatch?: string,
  ): { ok: true; room: RaceRoom } | { ok: false; error: string } {
    this.leaveRoom(player.id);
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

    room.players.set(player.id, { ...player, ready: isHost, isHost });
    this.playerToRoom.set(player.id, room.code);
    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
    return { ok: true, room };
  }

  public leaveRoom(playerId: string): void {
    const code = this.playerToRoom.get(playerId);
    if (!code) return;
    this.playerToRoom.delete(playerId);

    const room = this.rooms.get(code);
    if (!room) return;
    room.players.delete(playerId);
    room.race?.inputQueue.removePlayer(playerId);

    if (room.players.size === 0) {
      room.race?.stop();
      room.race = null;
      this.rooms.delete(code);
      return;
    }

    if (room.hostId === playerId) {
      const nextHost = Array.from(room.players.values())[0];
      if (nextHost) {
        nextHost.isHost = true;
        room.hostId = nextHost.id;
      }
    }
    this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
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
      participants.push({
        id: p.id,
        userId: p.userId,
        name: p.name,
        vehicleId: p.vehicleId,
        customization: p.customization,
        isAi: false,
      });
    }

    // Backfill up to 8 grid slots with AI opponents when enabled
    if (room.fillWithAi && room.mode !== 'time_trial') {
      const targetGrid = Math.max(participants.length, 8);
      let aiIdx = 0;
      while (participants.length < targetGrid) {
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
      onSnapshot: (snap) => {
        this.broadcastRoom(room, snap);
      },
      onFinished: (result) => {
        room.status = 'finished';
        room.lastResult = result;
        const persistRes = this.persistence.recordVerifiedMatchResult(result);
        this.broadcastRoom(room, {
          type: 'match_finished',
          result,
          rewardsIssuedCount: persistRes.rewardsIssued.length,
        });
        // Reset room back to lobby state after broadcasting verified result
        room.status = 'lobby';
        room.race = null;
        this.broadcastRoom(room, { type: 'room_state', room: this.serializeRoom(room) });
      },
    });

    this.broadcastRoom(room, {
      type: 'race_start',
      room: this.serializeRoom(room),
      matchId: room.race.matchId,
      authoritative: true,
    });
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
    for (const room of this.rooms.values()) {
      room.race?.stop();
      room.race = null;
    }
    this.rooms.clear();
    this.playerToRoom.clear();
  }
}
