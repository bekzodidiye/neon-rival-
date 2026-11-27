import type { GameModeId, MultiplayerRoomInfo, PowerUpType, TrackId, VehicleCustomization } from '../game/types';
import type { RemoteRacerPatch } from '../engine/RaceEngine';

export interface PlayerInputMessage {
  type: 'input';
  sequence: number;
  throttle: number;
  brake: number;
  steering: number;
  drift: boolean;
  firePowerUp: boolean;
  rearFire: boolean;
}

export interface MultiplayerClientEvents {
  onConnectionChange: (connected: boolean) => void;
  onRoomUpdate: (room: MultiplayerRoomInfo | null) => void;
  onPublicRooms: (rooms: { code: string; trackId: TrackId; mode: GameModeId; playerCount: number; status: string }[]) => void;
  onRaceStart: (room: MultiplayerRoomInfo) => void;
  onRemoteState: (patch: RemoteRacerPatch) => void;
  onRemoteCombat: (ownerId: string, type: PowerUpType, rearFired: boolean) => void;
  onPing: (ms: number) => void;
  onError: (message: string) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private events: MultiplayerClientEvents;
  public playerId: string | null = null;
  private pingInterval = 0;
  private lastPingSent = 0;
  private inputSequence = 0;

  constructor(events: MultiplayerClientEvents) {
    this.events = events;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
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
      this.send({ type: 'list_rooms' });
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
        const msg = JSON.parse(String(ev.data));
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
            this.events.onRoomUpdate(null);
            break;
          case 'race_start':
            this.events.onRaceStart(msg.room);
            break;
          case 'racer_snapshot':
            if (msg.racer && msg.racer.id !== this.playerId) {
              this.events.onRemoteState(msg.racer);
            }
            break;
          case 'combat_event':
            if (msg.ownerId !== this.playerId) {
              this.events.onRemoteCombat(msg.ownerId, msg.powerUpType, Boolean(msg.rearFired));
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

  public sendPlayerInput(input: Omit<PlayerInputMessage, 'type' | 'sequence'>): void {
    this.inputSequence += 1;
    this.send({
      type: 'input',
      sequence: this.inputSequence,
      ...input,
    });
  }

  public sendRaceState(state: Record<string, unknown>): void {
    this.send({ type: 'racer_state', state });
  }

  public sendCombatEvent(event: { type: PowerUpType; rearFired: boolean; x: number; z: number; heading: number }): void {
    this.send({
      type: 'combat_use',
      powerUpType: event.type,
      rearFired: event.rearFired,
      x: event.x,
      z: event.z,
      heading: event.heading,
    });
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
