import type { GameModeId, PowerUpType, TrackId, VehicleCustomization } from '../../src/game/types';

export const VALID_POWERUP_TYPES: readonly PowerUpType[] = [
  'NITRO',
  'SHUNT',
  'BOLT',
  'MINE',
  'SHOCK',
  'BARGE',
  'SHIELD',
  'REPAIR',
] as const;

export const VALID_TRACK_IDS: readonly TrackId[] = [
  'neon_city',
  'industrial_port',
  'midnight_streets',
] as const;

export const VALID_GAME_MODES: readonly GameModeId[] = [
  'combat_race',
  'pure_race',
  'time_trial',
  'elimination',
  'destruction_arena',
  'checkpoint',
  'training',
] as const;

export interface PlayerInputPayload {
  sequence: number;
  throttle: number; // 0..1
  brake: number; // 0..1
  steering: number; // -1..1
  drift: boolean;
  firePowerUp: boolean;
  rearFire: boolean;
  cycleSlot: boolean;
  discardSlot: boolean;
  selectSlot: number; // -1 or 0..2
  recover: boolean;
}

export interface AuthoritativeRacerSnapshot {
  id: string;
  name: string;
  vehicleId: string;
  isAi: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  speed: number;
  lateralSpeed: number;
  steerAngle: number;
  bodyPitch: number;
  bodyRoll: number;
  hp: number;
  maxHp: number;
  shieldTimer: number;
  shieldHp: number;
  nitroTimer: number;
  shockSlowTimer: number;
  destroyed: boolean;
  eliminated: boolean;
  isDrifting: boolean;
  isDrafting: boolean;
  lap: number;
  passedCheckpoints: number;
  totalProgress: number;
  position: number;
  finished: boolean;
  finishTime: number;
  hitsLanded: number;
  takedowns: number;
  blocksLanded: number;
  raceFans: number;
  activeSlot: number;
  inventory: ({ type: PowerUpType; ammo: number } | null)[];
  lastProcessedInputSeq: number;
}

export interface AuthoritativePickupSnapshot {
  id: string;
  active: boolean;
  type: PowerUpType;
}

export interface AuthoritativeProjectileSnapshot {
  id: string;
  type: 'SHUNT' | 'BOLT';
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
}

export interface AuthoritativeMineSnapshot {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  armed: boolean;
}

export interface AuthoritativeShockSnapshot {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface AuthoritativeSimulationEvent {
  seq: number;
  type: 'pickup' | 'powerup_fire' | 'damage' | 'shield_block' | 'wreck' | 'lap' | 'finish';
  actorId: string;
  targetId?: string;
  powerUp?: PowerUpType;
  rearFired?: boolean;
  value?: number;
}

export interface AuthoritativeWorldSnapshot {
  type: 'world_snapshot';
  matchId: string;
  tick: number;
  serverTime: number;
  phase: 'countdown' | 'racing' | 'finished';
  countdownTimer: number;
  raceTime: number;
  racers: AuthoritativeRacerSnapshot[];
  pickups: AuthoritativePickupSnapshot[];
  projectiles: AuthoritativeProjectileSnapshot[];
  mines: AuthoritativeMineSnapshot[];
  shockZones: AuthoritativeShockSnapshot[];
  events: AuthoritativeSimulationEvent[];
}

export interface VerifiedMatchStanding {
  playerId: string;
  userId: string | null;
  username: string;
  vehicleId: string;
  isAi: boolean;
  position: number;
  finishTime: number;
  hitsLanded: number;
  takedowns: number;
  blocksLanded: number;
  raceFans: number;
  rewardCredits: number;
  rewardXp: number;
  rewardFans: number;
  verified: boolean;
}

export interface AuthoritativeMatchResult {
  matchId: string;
  roomCode: string;
  trackId: TrackId;
  mode: GameModeId;
  laps: number;
  startedAt: string;
  finishedAt: string;
  standings: VerifiedMatchStanding[];
}

export interface CreateRoomPayload {
  name: string;
  vehicleId: string;
  customization?: Partial<VehicleCustomization>;
  trackId: TrackId;
  mode: GameModeId;
  laps: number;
  fillWithAi?: boolean;
}

export interface JoinRoomPayload {
  code?: string;
  name: string;
  vehicleId: string;
  customization?: Partial<VehicleCustomization>;
}
