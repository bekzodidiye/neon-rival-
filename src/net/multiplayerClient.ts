import type { GameModeId, MultiplayerRoomInfo, TrackId, VehicleCustomization } from '../game/types';
import type {
  AuthoritativeMatchResult,
  AuthoritativeWorldSnapshot,
  PlayerInputPayload,
} from '../../shared/protocol/messages';
import { SnapshotDecoder, type CompactWorldSnapshot } from '../../shared/protocol/snapshotCodec';

export interface MultiplayerClientEvents {
  onConnectionChange: (connected: boolean) => void;
  onRoomUpdate: (room: MultiplayerRoomInfo | null) => void;
  onPublicRooms: (rooms: { code: string; trackId: TrackId; mode: GameModeId; playerCount: number; status: string }[]) => void;
  onRaceStart: (room: MultiplayerRoomInfo, matchId: string | null) => void;
  onWorldSnapshot: (snapshot: AuthoritativeWorldSnapshot, rawBytes?: number) => void;
  onMatchFinished: (result: AuthoritativeMatchResult, rewardsIssuedCount: number) => void;
  onPing: (ms: number) => void;
  onError: (message: string) => void;
}

/**
 * Authoritative WebSocket Multiplayer Client (V7.0 Sections 35–39).
 * Streams sequenced PlayerInputPayload commands, decodes compact/delta v2 snapshots,
 * and supports token-authenticated match reconnection without spawning duplicate vehicles.
 */
export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private events: MultiplayerClientEvents;
  public playerId: string | null = null;
  public activeMatchId: string | null = null;
  public reconnectToken: string | null = null;
  public lastSnapshotBytes = 0;
  private authToken: string | null = null;
  private pingInterval = 0;
  private lastPingSent = 0;
  private inputSequence = 0;
  private readonly snapshotDecoder = new SnapshotDecoder();

  constructor(events: MultiplayerClientEvents) {
    this.events = events;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
    if (token && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'auth', token });
    }
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.send({ type: 'list_rooms' });
      return;
    }
    const configuredUrl = (import.meta.env.VITE_GAME_SERVER_WS_URL as string | undefined)?.trim();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = configuredUrl || `${proto}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.events.onConnectionChange(false);
      this.events.onError('Could not open WebSocket connection.');
      return;
    }

    this.ws.onopen = () => {
      this.events.onConnectionChange(true);
      if (this.authToken) {
        this.send({ type: 'auth', token: this.authToken });
      }
      this.send({ type: 'set_protocol', compactSnapshots: true });
      if (this.activeMatchId && this.reconnectToken) {
        this.send({
          type: 'reconnect',
          matchId: this.activeMatchId,
          reconnectToken: this.reconnectToken,
          compactSnapshots: true,
        });
      } else {
        this.send({ type: 'list_rooms' });
      }
      this.pingInterval = window.setInterval(() => {
        this.lastPingSent = performance.now();
        this.send({ type: 'ping' });
      }, 2500);
    };

    this.ws.onclose = () => {
      clearInterval(this.pingInterval);
      this.events.onConnectionChange(false);
    };

    this.ws.onerror = () => {
      this.events.onConnectionChange(false);
    };

    this.ws.onmessage = (ev) => {
      try {
        const rawStr = String(ev.data);
        const msg = JSON.parse(rawStr);
        switch (msg.type) {
          case 'welcome':
            this.playerId = msg.playerId;
            break;
          case 'pong':
            if (this.lastPingSent > 0) {
              this.events.onPing(Math.round(performance.now() - this.lastPingSent));
            }
            break;
          case 'rooms_list':
            this.events.onPublicRooms(msg.rooms || []);
            break;
          case 'room_state':
            this.events.onRoomUpdate(msg.room);
            break;
          case 'room_left':
            this.activeMatchId = null;
            this.reconnectToken = null;
            this.events.onRoomUpdate(null);
            break;
          case 'race_start':
            this.inputSequence = 0;
            this.snapshotDecoder.reset();
            this.activeMatchId = msg.matchId ?? null;
            this.reconnectToken = typeof msg.reconnectToken === 'string' ? msg.reconnectToken : null;
            this.events.onRaceStart(msg.room, this.activeMatchId);
            break;
          case 'reconnected':
            this.playerId = msg.playerId ?? this.playerId;
            this.inputSequence = Number(msg.lastSequence || 0);
            this.snapshotDecoder.reset();
            if (msg.room) this.events.onRoomUpdate(msg.room);
            break;
          case 'world_snapshot_compact': {
            this.lastSnapshotBytes = rawStr.length;
            const decoded = this.snapshotDecoder.decode(msg as CompactWorldSnapshot);
            if (decoded) {
              this.events.onWorldSnapshot(decoded, rawStr.length);
            }
            break;
          }
          case 'world_snapshot':
            this.lastSnapshotBytes = rawStr.length;
            this.events.onWorldSnapshot(msg as AuthoritativeWorldSnapshot, rawStr.length);
            break;
          case 'match_finished':
            this.activeMatchId = null;
            this.reconnectToken = null;
            if (msg.result) {
              this.events.onMatchFinished(
                msg.result as AuthoritativeMatchResult,
                Number(msg.rewardsIssuedCount || 0),
              );
            }
            break;
          case 'error':
            this.events.onError(msg.message || 'Server error');
            break;
        }
      } catch {
        // ignore malformed frames
      }
    };
  }

  public createRoom(payload: {
    name: string;
    vehicleId: string;
    customization: VehicleCustomization;
    trackId: TrackId;
    mode: GameModeId;
    laps: number;
  }): void {
    this.send({ type: 'create_room', ...payload });
  }

  public joinRoom(payload: {
    code: string;
    name: string;
    vehicleId: string;
    customization: VehicleCustomization;
  }): void {
    this.send({ type: 'join_room', ...payload });
  }

  public quickMatch(payload: {
    name: string;
    vehicleId: string;
    customization: VehicleCustomization;
  }): void {
    this.send({ type: 'quick_match', ...payload });
  }

  public toggleReady(): void {
    this.send({ type: 'toggle_ready' });
  }

  public startMatch(): void {
    this.send({ type: 'start_match' });
  }

  public leaveRoom(): void {
    this.send({ type: 'leave_room' });
  }

  /**
   * Sends a sequenced PlayerInputPayload to the authoritative server and returns its sequence number
   * for client-side prediction & reconciliation.
   */
  public sendPlayerInput(input: Omit<PlayerInputPayload, 'sequence'>): number {
    this.inputSequence += 1;
    const seq = this.inputSequence;
    this.send({
      type: 'input',
      sequence: seq,
      ...input,
    });
    return seq;
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public disconnect(): void {
    clearInterval(this.pingInterval);
    this.ws?.close();
    this.ws = null;
  }
}
