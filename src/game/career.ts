import type {
  Difficulty,
  GameModeId,
  TrackId,
  VehicleCustomization,
} from './types';

export type FanDemandType =
  | 'hit_opponents'
  | 'drift_duration'
  | 'block_or_intercept'
  | 'rear_fire_hit'
  | 'overtake_rivals'
  | 'avoid_shock';

export interface FanDemandConfig {
  id: string;
  type: FanDemandType;
  label: string;
  target: number;
  timeLimitSec: number;
  rewardFans: number;
}

export interface FanDemandRuntime {
  id: string;
  type: FanDemandType;
  label: string;
  target: number;
  progress: number;
  remainingSec: number;
  status: 'active' | 'succeeded' | 'failed';
  rewardFans: number;
}

export interface FanRunRuntime {
  active: boolean;
  triggered: boolean;
  completed: boolean;
  failed: boolean;
  gatesTotal: number;
  gatesCleared: number;
  remainingSec: number;
  nextGateTrackT: number;
  nextGateLateral: number;
}

export interface RivalProfile {
  id: string;
  name: string;
  title: string;
  vehicleId: string;
  customization: Partial<VehicleCustomization>;
  aggression: number; // 0..1
  preferredDefense: 'SHIELD' | 'BARGE' | 'MINE';
  preferredOffense: 'SHUNT' | 'BOLT' | 'SHOCK';
  quote: string;
  unlockLightsRequired: number;
}

export interface CareerEventDef {
  id: string;
  groupId: string;
  order: number;
  title: string;
  subtitle: string;
  trackId: TrackId;
  mode: GameModeId;
  difficulty: Difficulty;
  laps: number;
  aiCount: number;
  objectiveText: string;
  rewardCredits: number;
  rewardFans: number;
  /** Optional score/gate thresholds for Destruction or Checkpoint modes [3-star, 4-star, 5-star] */
  modeThresholds?: [number, number, number];
  timeLimitSec?: number;
  fanDemand?: FanDemandConfig;
  isRivalShowdown?: boolean;
  rival?: RivalProfile;
  unlockVehicleReward?: string;
}

export interface CareerGroupDef {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  requiredLights: number;
  accentColor: string;
  rival: RivalProfile;
  events: CareerEventDef[];
}

export interface CareerEventRecord {
  eventId: string;
  groupId: string;
  bestPosition: number;
  bestScore: number;
  bestTimeMs: number;
  lightsEarned: number; // 0..5 permanent stars
  fanRunCompleted: boolean;
  fanDemandCompleted: boolean;
  completed: boolean;
}

export interface VehicleMasteryRecord {
  vehicleId: string;
  racesCompleted: number;
  wins: number;
  distanceMeters: number;
  bestLapMs: number;
  combatActions: number;
  defensiveActions: number;
  masteryLevel: number; // 1..10
}

export type ModCategory = 'offense' | 'defense' | 'mobility' | 'utility';

export interface MultiplayerModDef {
  id: string;
  name: string;
  category: ModCategory;
  description: string;
  unlockRank: number;
  /** Strictly bounded passive modifiers — never grants infinite abilities or invulnerability */
  effects: {
    pickupRadiusMult?: number; // e.g., 1.18 (max 1.25)
    shieldCapacityBonus?: number; // e.g., +15 HP (max +20)
    recoveryCooldownMult?: number; // e.g., 0.85
    driftStabilityBonus?: number; // e.g., +0.08
    boltLockAssistBonus?: number; // e.g., +0.15
    interceptionFansBonus?: number; // e.g., +100 fans
  };
}

export const MULTIPLAYER_MODS: MultiplayerModDef[] = [
  {
    id: 'mod_magnetic_intake',
    name: 'MAGNETIC INTAKE',
    category: 'utility',
    description: '+18% world pickup collection radius for cleaner racing lines.',
    unlockRank: 1,
    effects: { pickupRadiusMult: 1.18 },
  },
  {
    id: 'mod_aegis_capacitor',
    name: 'AEGIS CAPACITOR',
    category: 'defense',
    description: '+15 Shield absorption capacity (bounded, no invulnerability).',
    unlockRank: 1,
    effects: { shieldCapacityBonus: 15 },
  },
  {
    id: 'mod_apex_gyro',
    name: 'APEX GYRO',
    category: 'mobility',
    description: '+8% drift stability and smoother corner-exit counter-steering.',
    unlockRank: 1,
    effects: { driftStabilityBonus: 0.08 },
  },
  {
    id: 'mod_quick_recover',
    name: 'RAPID RECOVERY',
    category: 'utility',
    description: '15% shorter wreck/stun recovery delay without skipping track progress.',
    unlockRank: 5,
    effects: { recoveryCooldownMult: 0.85 },
  },
  {
    id: 'mod_precision_optics',
    name: 'PRECISION OPTICS',
    category: 'offense',
    description: 'Enhanced Bolt aiming lead indicator & +15% target lock range.',
    unlockRank: 10,
    effects: { boltLockAssistBonus: 0.15 },
  },
  {
    id: 'mod_counter_surge',
    name: 'COUNTER SURGE',
    category: 'defense',
    description: '+100 bonus Reputation on every Shield block or Shunt interception.',
    unlockRank: 15,
    effects: { interceptionFansBonus: 100 },
  },
];

export const MULTIPLAYER_MOD_MAP: Record<string, MultiplayerModDef> = Object.fromEntries(
  MULTIPLAYER_MODS.map((m) => [m.id, m]),
);

const NOVA_RIVAL: RivalProfile = {
  id: 'rival_nova',
  name: 'NOVA',
  title: 'Street Initiation Boss',
  vehicleId: 'night_viper',
  customization: {
    bodyColor: '#1a1f2e',
    finish: 'matte',
    rimColor: '#ff2a5f',
    underglowColor: '#ff2a5f',
    headlightColor: '#fff0d4',
    nitroColor: '#ff5533',
    spoiler: 'gt',
    windowTint: 0.88,
  },
  aggression: 0.86,
  preferredDefense: 'SHIELD',
  preferredOffense: 'SHUNT',
  quote: 'Speed gets you noticed. Survival keeps your crown.',
  unlockLightsRequired: 18,
};

function makeGroupRival(
  id: string,
  name: string,
  title: string,
  vehicleId: string,
  bodyColor: string,
  accent: string,
  unlockLightsRequired: number,
): RivalProfile {
  return {
    id,
    name,
    title,
    vehicleId,
    customization: {
      bodyColor,
      finish: 'metallic',
      rimColor: accent,
      underglowColor: accent,
      headlightColor: '#f0f8ff',
      nitroColor: accent,
      spoiler: 'wing',
      windowTint: 0.85,
    },
    aggression: 0.8,
    preferredDefense: 'BARGE',
    preferredOffense: 'BOLT',
    quote: 'Prove you belong in this tier.',
    unlockLightsRequired,
  };
}

function makeStandardGroupEvents(
  groupId: string,
  trackA: TrackId,
  trackB: TrackId,
  difficulty: Difficulty,
  baseCredits: number,
  rival: RivalProfile,
): CareerEventDef[] {
  return [
    {
      id: `${groupId}_01_race`,
      groupId,
      order: 1,
      title: 'OPENING HEAT',
      subtitle: 'Powered Circuit Race',
      trackId: trackA,
      mode: 'combat_race',
      difficulty,
      laps: 3,
      aiCount: 7,
      objectiveText: 'Finish Top 3 to earn 3–5 permanent Lights.',
      rewardCredits: baseCredits,
      rewardFans: 650,
      fanDemand: {
        id: `${groupId}_fd_1`,
        type: 'hit_opponents',
        label: 'Land 2 power-up hits',
        target: 2,
        timeLimitSec: 90,
        rewardFans: 350,
      },
    },
    {
      id: `${groupId}_02_destruction`,
      groupId,
      order: 2,
      title: 'TARGET LOCK',
      subtitle: 'Timed Destruction Arena',
      trackId: trackB,
      mode: 'destruction_arena',
      difficulty,
      laps: 3,
      aiCount: 7,
      objectiveText: 'Wreck target vehicles before the clock expires.',
      rewardCredits: Math.round(baseCredits * 1.15),
      rewardFans: 780,
      timeLimitSec: 90,
      modeThresholds: [1400, 2200, 3200],
    },
    {
      id: `${groupId}_03_checkpoint`,
      groupId,
      order: 3,
      title: 'APEX CLOCK',
      subtitle: 'Timed Checkpoint Rush',
      trackId: trackA,
      mode: 'checkpoint',
      difficulty,
      laps: 2,
      aiCount: 0,
      objectiveText: 'Clear sequential gates & collect time extensions before zero.',
      rewardCredits: Math.round(baseCredits * 1.2),
      rewardFans: 820,
      timeLimitSec: 40,
      modeThresholds: [8, 12, 16],
    },
    {
      id: `${groupId}_04_rival`,
      groupId,
      order: 4,
      title: `${rival.name} SHOWDOWN`,
      subtitle: '1v1 Rival Duel',
      trackId: trackB,
      mode: 'combat_race',
      difficulty,
      laps: 2,
      aiCount: 1,
      objectiveText: `Defeat ${rival.name} head-to-head in powered combat.`,
      rewardCredits: Math.round(baseCredits * 1.6),
      rewardFans: 1200,
      isRivalShowdown: true,
      rival,
    },
  ];
}

/**
 * Nine Blur-inspired original Career Groups.
 * Group 1 (STREET INITIATION) ships with all 7 complete, distinct playable events end-to-end.
 */
export const CAREER_GROUPS: CareerGroupDef[] = [
  {
    id: 'street_initiation',
    index: 1,
    name: 'STREET INITIATION',
    subtitle: 'Proving Ground · Neon City & Port',
    requiredLights: 0,
    accentColor: '#00c8ff',
    rival: NOVA_RIVAL,
    events: [
      {
        id: 'si_01_first_contact',
        groupId: 'street_initiation',
        order: 1,
        title: 'FIRST CONTACT',
        subtitle: 'Standard Powered Race',
        trackId: 'neon_city',
        mode: 'combat_race',
        difficulty: 'easy',
        laps: 2,
        aiCount: 7,
        objectiveText: 'Finish Top 3 in Neon City to claim your first permanent Lights.',
        rewardCredits: 1400,
        rewardFans: 500,
        fanDemand: {
          id: 'fd_si_01',
          type: 'hit_opponents',
          label: 'Hit 2 opponents with power-ups',
          target: 2,
          timeLimitSec: 120,
          rewardFans: 300,
        },
      },
      {
        id: 'si_02_urban_pursuit',
        groupId: 'street_initiation',
        order: 2,
        title: 'URBAN PURSUIT',
        subtitle: 'Competitive City Race',
        trackId: 'midnight_streets',
        mode: 'combat_race',
        difficulty: 'normal',
        laps: 2,
        aiCount: 7,
        objectiveText: 'Battle through Sunset Blvd avenues and finish on the podium.',
        rewardCredits: 1850,
        rewardFans: 680,
        fanDemand: {
          id: 'fd_si_02',
          type: 'drift_duration',
          label: 'Hold controlled drifts for 3s total',
          target: 3,
          timeLimitSec: 120,
          rewardFans: 320,
        },
      },
      {
        id: 'si_03_precision_strike',
        groupId: 'street_initiation',
        order: 3,
        title: 'PRECISION STRIKE',
        subtitle: 'Timed Destruction Challenge',
        trackId: 'neon_city',
        mode: 'destruction_arena',
        difficulty: 'normal',
        laps: 3,
        aiCount: 7,
        objectiveText: 'Score 1,200+ Destruction points by hammering target cars with offensive power-ups.',
        rewardCredits: 2200,
        rewardFans: 850,
        timeLimitSec: 90,
        modeThresholds: [1200, 2000, 3000],
      },
      {
        id: 'si_04_time_pressure',
        groupId: 'street_initiation',
        order: 4,
        title: 'TIME PRESSURE',
        subtitle: 'Checkpoint Rush',
        trackId: 'industrial_port',
        mode: 'checkpoint',
        difficulty: 'normal',
        laps: 2,
        aiCount: 0,
        objectiveText: 'Beat the countdown clock across sequential route gates using Time & Nitro pickups.',
        rewardCredits: 2300,
        rewardFans: 880,
        timeLimitSec: 38,
        modeThresholds: [8, 12, 16],
      },
      {
        id: 'si_05_tactical_defense',
        groupId: 'street_initiation',
        order: 5,
        title: 'TACTICAL DEFENSE',
        subtitle: 'Combat Counterplay Race',
        trackId: 'industrial_port',
        mode: 'combat_race',
        difficulty: 'normal',
        laps: 2,
        aiCount: 7,
        objectiveText: 'Use Shield, Barge, or rear-fired Bolts to survive heavy dockyard fire.',
        rewardCredits: 2500,
        rewardFans: 950,
        fanDemand: {
          id: 'fd_si_05',
          type: 'block_or_intercept',
          label: 'Block an attack with Shield or Barge',
          target: 1,
          timeLimitSec: 140,
          rewardFans: 400,
        },
      },
      {
        id: 'si_06_midnight_sprint',
        groupId: 'street_initiation',
        order: 6,
        title: 'MIDNIGHT SPRINT',
        subtitle: 'Advanced Powered Race',
        trackId: 'midnight_streets',
        mode: 'combat_race',
        difficulty: 'hard',
        laps: 3,
        aiCount: 7,
        objectiveText: 'High-pace 3-lap sprint against aggressive rivals.',
        rewardCredits: 3100,
        rewardFans: 1150,
        fanDemand: {
          id: 'fd_si_06',
          type: 'overtake_rivals',
          label: 'Overtake 2 opponents during the race',
          target: 2,
          timeLimitSec: 150,
          rewardFans: 420,
        },
      },
      {
        id: 'si_07_nova_showdown',
        groupId: 'street_initiation',
        order: 7,
        title: 'NOVA SHOWDOWN',
        subtitle: '1v1 Rival Showdown',
        trackId: 'neon_city',
        mode: 'combat_race',
        difficulty: 'hard',
        laps: 2,
        aiCount: 1,
        objectiveText: 'Defeat NOVA head-to-head to unlock Night Viper & advance to Group 2.',
        rewardCredits: 4500,
        rewardFans: 1800,
        isRivalShowdown: true,
        rival: NOVA_RIVAL,
        unlockVehicleReward: 'night_viper',
      },
    ],
  },
  {
    id: 'harbor_heat',
    index: 2,
    name: 'HARBOR HEAT',
    subtitle: 'Container Terminal Endurance',
    requiredLights: 18,
    accentColor: '#f59e0b',
    rival: makeGroupRival('rival_razor', 'RAZOR-9', 'Port Enforcer', 'sand_runner', '#d97706', '#fbbf24', 32),
    events: makeStandardGroupEvents(
      'harbor_heat',
      'industrial_port',
      'neon_city',
      'normal',
      2400,
      makeGroupRival('rival_razor', 'RAZOR-9', 'Port Enforcer', 'sand_runner', '#d97706', '#fbbf24', 32),
    ),
  },
  {
    id: 'sunset_syndicate',
    index: 3,
    name: 'SUNSET SYNDICATE',
    subtitle: 'Golden Hour Street Battles',
    requiredLights: 32,
    accentColor: '#fb7185',
    rival: makeGroupRival('rival_valkyrie', 'VALKYRIE', 'Avenue Tactician', 'cyber_gtr', '#be123c', '#fda4af', 46),
    events: makeStandardGroupEvents(
      'sunset_syndicate',
      'midnight_streets',
      'industrial_port',
      'normal',
      3000,
      makeGroupRival('rival_valkyrie', 'VALKYRIE', 'Avenue Tactician', 'cyber_gtr', '#be123c', '#fda4af', 46),
    ),
  },
  {
    id: 'apex_circuit',
    index: 4,
    name: 'APEX CIRCUIT',
    subtitle: 'High-Speed Technical Precision',
    requiredLights: 46,
    accentColor: '#22d3ee',
    rival: makeGroupRival('rival_kazuya', 'KAZUYA', 'Apex Specialist', 'cyber_gtr', '#0284c7', '#38bdf8', 60),
    events: makeStandardGroupEvents(
      'apex_circuit',
      'neon_city',
      'midnight_streets',
      'hard',
      3600,
      makeGroupRival('rival_kazuya', 'KAZUYA', 'Apex Specialist', 'cyber_gtr', '#0284c7', '#38bdf8', 60),
    ),
  },
  {
    id: 'midnight_runners',
    index: 5,
    name: 'MIDNIGHT RUNNERS',
    subtitle: 'Heavy Combat Interceptors',
    requiredLights: 60,
    accentColor: '#a78bfa',
    rival: makeGroupRival('rival_vortex', 'VORTEX', 'Shockwave Tactician', 'night_viper', '#6d28d9', '#c4b5fd', 74),
    events: makeStandardGroupEvents(
      'midnight_runners',
      'midnight_streets',
      'neon_city',
      'hard',
      4200,
      makeGroupRival('rival_vortex', 'VORTEX', 'Shockwave Tactician', 'night_viper', '#6d28d9', '#c4b5fd', 74),
    ),
  },
  {
    id: 'thunder_district',
    index: 6,
    name: 'THUNDER DISTRICT',
    subtitle: 'Full-Grid Dockyard Chaos',
    requiredLights: 74,
    accentColor: '#34d399',
    rival: makeGroupRival('rival_kestrel', 'KESTREL', 'Dockyard Ace', 'cyber_gtr', '#059669', '#6ee7b7', 88),
    events: makeStandardGroupEvents(
      'thunder_district',
      'industrial_port',
      'midnight_streets',
      'hard',
      4800,
      makeGroupRival('rival_kestrel', 'KESTREL', 'Dockyard Ace', 'cyber_gtr', '#059669', '#6ee7b7', 88),
    ),
  },
  {
    id: 'iron_gauntlet',
    index: 7,
    name: 'IRON GAUNTLET',
    subtitle: 'Class B/A Endurance Trials',
    requiredLights: 88,
    accentColor: '#f97316',
    rival: makeGroupRival('rival_titan', 'TITAN', 'Armored Brawler', 'night_viper', '#c2410c', '#fdba74', 102),
    events: makeStandardGroupEvents(
      'iron_gauntlet',
      'neon_city',
      'industrial_port',
      'expert',
      5600,
      makeGroupRival('rival_titan', 'TITAN', 'Armored Brawler', 'night_viper', '#c2410c', '#fdba74', 102),
    ),
  },
  {
    id: 'hyper_velocity',
    index: 8,
    name: 'HYPER VELOCITY',
    subtitle: 'Class A Supercar Division',
    requiredLights: 102,
    accentColor: '#38bdf8',
    rival: makeGroupRival('rival_zenith', 'ZENITH', 'Hypercar Phantom', 'phantom_x', '#1d4ed8', '#93c5fd', 116),
    events: makeStandardGroupEvents(
      'hyper_velocity',
      'midnight_streets',
      'neon_city',
      'expert',
      6500,
      makeGroupRival('rival_zenith', 'ZENITH', 'Hypercar Phantom', 'phantom_x', '#1d4ed8', '#93c5fd', 116),
    ),
  },
  {
    id: 'neon_legends',
    index: 9,
    name: 'NEON LEGENDS',
    subtitle: 'Grand Championship Finals',
    requiredLights: 116,
    accentColor: '#facc15',
    rival: makeGroupRival('rival_eclipse', 'ECLIPSE', 'Undisputed Legend', 'phantom_x', '#111827', '#facc15', 130),
    events: makeStandardGroupEvents(
      'neon_legends',
      'neon_city',
      'midnight_streets',
      'expert',
      8000,
      makeGroupRival('rival_eclipse', 'ECLIPSE', 'Undisputed Legend', 'phantom_x', '#111827', '#facc15', 130),
    ),
  },
];

export function getAllCareerEvents(): CareerEventDef[] {
  return CAREER_GROUPS.flatMap((g) => g.events);
}

export function getCareerEventById(eventId: string): CareerEventDef | undefined {
  return getAllCareerEvents().find((e) => e.id === eventId);
}

/**
 * Computes permanent Blur-style Lights (0..5) for a career event outcome.
 * - Standard/Rival Race: 1st = 5, 2nd = 4, 3rd = 3 (plus +1 if Fan Run or Fan Demand completed, capped at 5).
 * - Destruction / Checkpoint: based on event thresholds [3-star, 4-star, 5-star].
 */
export function computeEventLights(params: {
  event: CareerEventDef;
  position: number;
  score: number;
  checkpointsCleared: number;
  fanRunCompleted: boolean;
  fanDemandCompleted: boolean;
}): number {
  const { event, position, score, checkpointsCleared, fanRunCompleted, fanDemandCompleted } = params;
  let lights = 0;

  if (event.mode === 'destruction_arena' && event.modeThresholds) {
    const [t3, t4, t5] = event.modeThresholds;
    if (score >= t5) lights = 5;
    else if (score >= t4) lights = 4;
    else if (score >= t3) lights = 3;
    else if (score >= Math.round(t3 * 0.6)) lights = 2;
    else if (score > 0) lights = 1;
  } else if (event.mode === 'checkpoint' && event.modeThresholds) {
    const [g3, g4, g5] = event.modeThresholds;
    if (checkpointsCleared >= g5) lights = 5;
    else if (checkpointsCleared >= g4) lights = 4;
    else if (checkpointsCleared >= g3) lights = 3;
    else if (checkpointsCleared >= Math.max(3, Math.floor(g3 * 0.6))) lights = 2;
    else if (checkpointsCleared >= 2) lights = 1;
  } else if (event.isRivalShowdown) {
    lights = position === 1 ? 5 : 1;
  } else {
    if (position === 1) lights = 5;
    else if (position === 2) lights = 4;
    else if (position === 3) lights = 3;
    else if (position <= 5) lights = 1;
  }

  // Bonus light for completing optional Fan Run or Fan Demand (never exceeds 5)
  if (lights > 0 && lights < 5 && (fanRunCompleted || fanDemandCompleted)) {
    lights = Math.min(5, lights + 1);
  }
  return Math.max(0, Math.min(5, lights));
}

/**
 * Merges a new event result into the player's career records, storing best result
 * and guaranteeing permanent Lights are never double-counted on replay.
 */
export function mergeCareerEventRecord(
  existing: Record<string, CareerEventRecord>,
  event: CareerEventDef,
  outcome: {
    position: number;
    score: number;
    timeMs: number;
    lightsEarned: number;
    fanRunCompleted: boolean;
    fanDemandCompleted: boolean;
  },
): {
  records: Record<string, CareerEventRecord>;
  newLightsDelta: number;
  bestRecord: CareerEventRecord;
} {
  const prev = existing[event.id];
  const prevLights = prev?.lightsEarned ?? 0;
  const bestLights = Math.max(prevLights, Math.max(0, Math.min(5, outcome.lightsEarned)));
  const newLightsDelta = Math.max(0, bestLights - prevLights);

  const bestRecord: CareerEventRecord = {
    eventId: event.id,
    groupId: event.groupId,
    bestPosition: prev ? Math.min(prev.bestPosition, outcome.position) : outcome.position,
    bestScore: prev ? Math.max(prev.bestScore, outcome.score) : outcome.score,
    bestTimeMs:
      prev && prev.bestTimeMs > 0
        ? outcome.timeMs > 0
          ? Math.min(prev.bestTimeMs, outcome.timeMs)
          : prev.bestTimeMs
        : outcome.timeMs,
    lightsEarned: bestLights,
    fanRunCompleted: Boolean(prev?.fanRunCompleted || outcome.fanRunCompleted),
    fanDemandCompleted: Boolean(prev?.fanDemandCompleted || outcome.fanDemandCompleted),
    completed: bestLights >= 3 || Boolean(prev?.completed),
  };

  return {
    records: {
      ...existing,
      [event.id]: bestRecord,
    },
    newLightsDelta,
    bestRecord,
  };
}

export function computeTotalCareerLights(records: Record<string, CareerEventRecord>): number {
  let total = 0;
  for (const r of Object.values(records)) {
    total += Math.max(0, Math.min(5, Math.floor(r.lightsEarned)));
  }
  return total;
}

export function computeMasteryLevel(rec: Omit<VehicleMasteryRecord, 'masteryLevel'>): number {
  const points =
    rec.racesCompleted * 120 +
    rec.wins * 260 +
    Math.floor(rec.distanceMeters / 500) * 15 +
    rec.combatActions * 45 +
    rec.defensiveActions * 55;
  return Math.max(1, Math.min(10, 1 + Math.floor(points / 650)));
}

export function updateVehicleMastery(
  existing: Record<string, VehicleMasteryRecord>,
  update: {
    vehicleId: string;
    won: boolean;
    distanceMeters: number;
    bestLapMs: number;
    combatActions: number;
    defensiveActions: number;
  },
): Record<string, VehicleMasteryRecord> {
  const prev = existing[update.vehicleId] ?? {
    vehicleId: update.vehicleId,
    racesCompleted: 0,
    wins: 0,
    distanceMeters: 0,
    bestLapMs: 0,
    combatActions: 0,
    defensiveActions: 0,
    masteryLevel: 1,
  };

  const nextBase = {
    vehicleId: update.vehicleId,
    racesCompleted: prev.racesCompleted + 1,
    wins: prev.wins + (update.won ? 1 : 0),
    distanceMeters: prev.distanceMeters + Math.max(0, Math.round(update.distanceMeters)),
    bestLapMs:
      update.bestLapMs > 0
        ? prev.bestLapMs > 0
          ? Math.min(prev.bestLapMs, Math.round(update.bestLapMs))
          : Math.round(update.bestLapMs)
        : prev.bestLapMs,
    combatActions: prev.combatActions + Math.max(0, Math.round(update.combatActions)),
    defensiveActions: prev.defensiveActions + Math.max(0, Math.round(update.defensiveActions)),
  };

  return {
    ...existing,
    [update.vehicleId]: {
      ...nextBase,
      masteryLevel: computeMasteryLevel(nextBase),
    },
  };
}

/**
 * Validates up to 3 equipped passive multiplayer mods against player online rank & ownership.
 * Strictly rejects unknown mod IDs, duplicates, or mods above the player's verified rank.
 */
export function validateEquippedMods(
  requestedModIds: string[],
  verifiedOnlineRank: number,
): { valid: boolean; mods: MultiplayerModDef[]; rejectedIds: string[] } {
  const seen = new Set<string>();
  const mods: MultiplayerModDef[] = [];
  const rejectedIds: string[] = [];

  for (const id of requestedModIds) {
    if (seen.has(id) || mods.length >= 3) {
      rejectedIds.push(id);
      continue;
    }
    const def = MULTIPLAYER_MOD_MAP[id];
    if (!def || verifiedOnlineRank < def.unlockRank) {
      rejectedIds.push(id);
      continue;
    }
    seen.add(id);
    mods.push(def);
  }

  return {
    valid: rejectedIds.length === 0,
    mods,
    rejectedIds,
  };
}

/**
 * Computes Online Rank (1..50) strictly from server-verified XP.
 */
export function computeOnlineRankFromXp(totalOnlineXp: number): {
  rank: number;
  xpIntoRank: number;
  xpForNextRank: number;
} {
  let rank = 1;
  let remaining = Math.max(0, Math.floor(totalOnlineXp));
  while (rank < 50) {
    const needed = 350 + (rank - 1) * 140;
    if (remaining < needed) {
      return { rank, xpIntoRank: remaining, xpForNextRank: needed };
    }
    remaining -= needed;
    rank += 1;
  }
  return { rank: 50, xpIntoRank: remaining, xpForNextRank: 0 };
}

export const MAX_PRESTIGE_TIER = 10;

export function canActivatePrestige(onlineRank: number, currentPrestigeTier: number): boolean {
  return onlineRank >= 50 && currentPrestigeTier < MAX_PRESTIGE_TIER;
}

/**
 * Applies optional Prestige advancement (requires explicit player confirmation).
 * Resets online rank XP back to Rank 1 while preserving protected cosmetics, owned vehicles,
 * career Lights, and vehicle mastery, and increments prestigeTier (1..10).
 */
export function applyPrestigeReset(state: {
  onlineRank: number;
  onlineXp: number;
  prestigeTier: number;
  confirmed: boolean;
}): {
  ok: boolean;
  reason?: string;
  onlineRank: number;
  onlineXp: number;
  prestigeTier: number;
  preservedItems: string[];
  resetItems: string[];
} {
  if (!state.confirmed) {
    return {
      ok: false,
      reason: 'Player confirmation is required before entering Prestige.',
      onlineRank: state.onlineRank,
      onlineXp: state.onlineXp,
      prestigeTier: state.prestigeTier,
      preservedItems: [],
      resetItems: [],
    };
  }
  if (!canActivatePrestige(state.onlineRank, state.prestigeTier)) {
    return {
      ok: false,
      reason:
        state.prestigeTier >= MAX_PRESTIGE_TIER
          ? 'Maximum Prestige Tier 10 reached.'
          : 'Online Rank 50 is required to enter Prestige.',
      onlineRank: state.onlineRank,
      onlineXp: state.onlineXp,
      prestigeTier: state.prestigeTier,
      preservedItems: [],
      resetItems: [],
    };
  }
  return {
    ok: true,
    onlineRank: 1,
    onlineXp: 0,
    prestigeTier: state.prestigeTier + 1,
    preservedItems: [
      'Protected Vehicle Cosmetics & Paint Finishes',
      'Owned Vehicles & Vehicle Mastery Levels',
      'Career Lights & Completed Events',
    ],
    resetItems: ['Online Rank (50 -> 1)', 'Rank-locked Mod slots (re-unlocked as you rank up)'],
  };
}
