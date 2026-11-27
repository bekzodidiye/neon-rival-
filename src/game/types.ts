export type VehicleClass = 'D' | 'C' | 'B' | 'A';

export type VehicleArchetype = 'coupe' | 'muscle' | 'supercar' | 'gt';

export type HandlingArchetype = 'grippy' | 'drifty' | 'balanced' | 'offroad';

export type PaintFinish = 'metallic' | 'matte' | 'gloss';

export type SpoilerStyle = 'none' | 'street' | 'gt' | 'wing';

export interface VehicleCustomization {
  bodyColor: string;
  finish: PaintFinish;
  rimColor: string;
  underglowColor: string;
  headlightColor: string;
  nitroColor: string;
  spoiler: SpoilerStyle;
  windowTint: number; // 0.3 to 0.95
}

export interface VehicleStats {
  topSpeed: number; // m/s (e.g., 64 = 230 km/h, 80 = 288 km/h)
  acceleration: number; // m/s^2
  braking: number; // m/s^2
  handling: number; // rad/s base steer rate
  grip: number; // lateral friction coeff
  driftControl: number; // 0-1 drift stability
  durability: number; // max HP (maxHealthBlocks * 20)
  maxHealthBlocks: number; // Blur-style segmented health blocks (5..8)
  nitroEfficiency: number; // multiplier on nitro duration/power
  weight: number; // kg (affects knockback resistance)
}

export interface VehicleDimensions {
  length: number; // meters (bumper to bumper)
  width: number; // meters (body width for OBB collision & rendering)
  height: number; // meters (overall roof height)
  wheelBase: number; // meters (front axle to rear axle)
  trackWidth: number; // meters (left wheel center to right wheel center)
  wheelRadius: number; // meters
  rideHeight: number; // meters (suspension rest clearance)
}

export interface VehicleConfig {
  id: string;
  name: string;
  subtitle: string;
  vehicleClass: VehicleClass;
  archetype: VehicleArchetype;
  handlingArchetype: HandlingArchetype;
  modelStatus?: 'sculpted' | 'prototype';
  price: number;
  dimensions: VehicleDimensions;
  defaultCustomization: VehicleCustomization;
  stats: VehicleStats;
  /** Display scores 0-100 for Garage UI */
  ratings: {
    speed: number;
    acceleration: number;
    handling: number;
    grip: number;
    drift: number;
    durability: number;
    nitro: number;
  };
}

export type PowerUpType =
  | 'SHUNT'
  | 'BOLT'
  | 'BARGE'
  | 'MINE'
  | 'SHOCK'
  | 'SHIELD'
  | 'NITRO'
  | 'REPAIR';

export interface PowerUpSlot {
  type: PowerUpType;
  ammo: number;
}

export interface PowerUpDefinition {
  type: PowerUpType;
  name: string;
  shortDesc: string;
  color: string;
  hexColor: number;
  maxAmmo: number;
  damage: number;
  supportsRearFire: boolean;
  category: 'offense' | 'defense' | 'boost' | 'utility';
}

export type TrackId = 'neon_city' | 'industrial_port' | 'midnight_streets';

export type GameModeId =
  | 'combat_race'
  | 'pure_race'
  | 'time_trial'
  | 'elimination'
  | 'destruction_arena'
  | 'training';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert';

export type LanguageCode = 'en' | 'uz' | 'ru';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';

export type CameraMode = 'near' | 'far' | 'hood';

export type AppScreen =
  | 'title'
  | 'garage'
  | 'race_setup'
  | 'multiplayer'
  | 'career'
  | 'settings'
  | 'playing'
  | 'paused'
  | 'results';

export interface ControlInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. +1 (right)
  drift: boolean;
  useNitro: boolean;
  usePowerUp: boolean;
  cycleSlot: boolean;
  discardSlot: boolean;
  selectSlot: number; // -1 none, 0,1,2
  rearView: boolean;
  rearFire: boolean;
  recover: boolean;
  instantRearFire?: boolean;
}

export interface RacerState {
  id: string;
  name: string;
  isPlayer: boolean;
  isRemote: boolean;
  vehicleId: string;
  customization: VehicleCustomization;

  // Spatial physics
  x: number;
  y: number;
  z: number;
  prevX?: number;
  prevZ?: number;
  vx: number;
  vy?: number;
  vz: number;
  heading: number; // radians, 0 = +Z, atan2(dx, dz)
  angularVel: number;
  speed: number; // signed forward speed m/s
  lateralSpeed: number;
  steerAngle: number;
  wheelSpin: number;
  bodyPitch: number;
  bodyRoll: number;
  grounded?: boolean;
  airborneTime?: number;
  suspCompression?: [number, number, number, number]; // [FL, FR, RL, RR] 0..1
  lastSafeTrackT?: number;

  // Drift & boost
  isDrifting: boolean;
  driftTime: number;
  nitroTimer: number;
  nitroEnergy: number; // 0..100 passive drift-charge + pickup
  airBrakeBoostTimer?: number; // Delayed corner-exit surge after reverse Nitro airbrake
  shieldTimer: number;
  shieldHp?: number; // Absorption capacity depleted by impacts & Shock domes
  shockSlowTimer: number;
  stunTimer: number;
  spawnProtectTimer: number;
  hitFlashTimer: number;

  // Combat & health
  hp: number;
  maxHp: number;
  maxHealthBlocks?: number;
  destroyed: boolean;
  respawnTimer: number;
  inventory: (PowerUpSlot | null)[];
  activeSlot: number;
  rearFireMode: boolean;
  boltCooldown: number;

  // Race progress
  trackT: number; // 0..1 along spline
  lateralOffset: number;
  lap: number; // 1-indexed current lap
  nextCheckpoint: number;
  passedCheckpoints: number;
  totalProgress: number; // monotonic progress score for ranking
  position: number; // 1..N
  finished: boolean;
  finishTime: number;
  lapStartTime: number;
  bestLapTime: number;
  wrongWay: boolean;
  eliminated: boolean;

  // Combat & Blur Fans stats
  hitsLanded: number;
  takedowns: number;
  powerUpsUsed: number;
  blocksLanded: number;
  damageDealt: number;
  raceFans?: number;
  comboCount?: number;
  comboTimer?: number;
  isDrafting?: boolean;

  // AI parameters
  aiLaneOffset: number;
  aiLaneTimer: number;
  aiDecisionTimer: number;
  aiAggression: number;
}

export interface ProjectileState {
  id: string;
  type: 'SHUNT' | 'BOLT';
  ownerId: string;
  targetId: string | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  damage: number;
  life: number;
  maxLife: number;
  rearFired: boolean;
  health?: number; // Shunt takes 2 Bolt hits (1st weakens, 2nd destroys)
}

export interface MineState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  armTimer: number;
  life: number;
  radius: number;
  damage: number;
}

export interface ShockZoneState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  trackT: number;
  life: number;
  radius: number;
  damage: number;
  hitRacerIds: string[];
}

export interface BargeWaveState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
}

export interface TrackPickupNode {
  id: string;
  trackT: number;
  lateralOffset: number;
  x: number;
  y: number;
  z: number;
  type: PowerUpType;
  active: boolean;
  respawnTimer: number;
}

export interface RaceConfig {
  mode: GameModeId;
  trackId: TrackId;
  laps: number;
  difficulty: Difficulty;
  vehicleId: string;
  customization: VehicleCustomization;
  aiCount: number;
  isMultiplayer: boolean;
  roomCode?: string;
}

export interface CombatFeedItem {
  id: string;
  text: string;
  color: string;
  timestamp: number;
}

export interface MinimapDot {
  id: string;
  x: number;
  z: number;
  isPlayer: boolean;
  color: string;
}

export interface RaceHudSnapshot {
  phase: 'countdown' | 'racing' | 'finished';
  countdownValue: number; // 3, 2, 1, 0 (GO)
  position: number;
  totalRacers: number;
  lap: number;
  totalLaps: number;
  raceTime: number;
  bestLapTime: number;
  speedKmh: number;
  gear: number;
  rpmRatio: number; // 0..1
  hp: number;
  maxHp: number;
  maxHealthBlocks: number;
  shieldActive: boolean;
  shieldRemaining: number;
  nitroActive: boolean;
  nitroRemaining: number;
  nitroEnergy: number;
  isDrifting: boolean;
  isDrafting: boolean;
  wrongWay: boolean;
  incomingWarning: boolean;
  incomingDistance: number;
  rearFireMode: boolean;
  cameraMode: CameraMode;
  raceFans: number;
  comboCount: number;
  comboMultiplier: number;
  lockTargetScreen: { x: number; y: number; name: string; dist: number; color: string } | null;
  inventory: (PowerUpSlot | null)[];
  activeSlot: number;
  fps: number;
  pingMs: number;
  finalLapBanner: boolean;
  eliminationTimer: number;
  combatFeed: CombatFeedItem[];
  minimapDots: MinimapDot[];
  minimapPath: { x: number; z: number }[];
  standings: {
    id: string;
    name: string;
    vehicleId: string;
    position: number;
    lap: number;
    finished: boolean;
    finishTime: number;
    hitsLanded: number;
    takedowns: number;
    isPlayer: boolean;
    eliminated: boolean;
  }[];
}

export interface RaceRewards {
  credits: number;
  xp: number;
  fanPoints: number;
  bonusLabels: string[];
  levelUp: boolean;
}

export interface SettingsState {
  language: LanguageCode;
  graphics: GraphicsPreset;
  motionBlur: boolean;
  masterVolume: number;
  engineVolume: number;
  sfxVolume: number;
  uiVolume: number;
  muted: boolean;
  showFps: boolean;
  mobileControls: 'auto' | 'on' | 'off';
  autoAccelerate: boolean;
  leftHandedMobile: boolean;
  speedUnit: 'kmh' | 'mph';
}

export interface PlayerProfile {
  id: string;
  username: string;
  isGuest: boolean;
  level: number;
  xp: number;
  credits: number;
  fanPoints: number;
  racesCompleted: number;
  wins: number;
  takedowns: number;
  ownedVehicles: string[];
  selectedVehicleId: string;
  customizations: Record<string, VehicleCustomization>;
  completedCareerIds: string[];
  claimedMissionIds: string[];
  unlockedAchievements: string[];
}

export interface MultiplayerPlayerInfo {
  id: string;
  name: string;
  vehicleId: string;
  customization: VehicleCustomization;
  ready: boolean;
  isHost: boolean;
}

export interface MultiplayerRoomInfo {
  code: string;
  hostId: string;
  trackId: TrackId;
  mode: GameModeId;
  laps: number;
  status: 'lobby' | 'countdown' | 'racing' | 'finished';
  players: MultiplayerPlayerInfo[];
}
