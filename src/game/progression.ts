import type {
  Difficulty,
  GameModeId,
  PlayerProfile,
  RaceRewards,
  SettingsState,
  TrackId,
} from './types';
import { getDefaultCustomizationsMap } from './vehicles';

export interface CareerEvent {
  id: string;
  stage: number;
  title: string;
  rivalName: string;
  trackId: TrackId;
  mode: GameModeId;
  difficulty: Difficulty;
  laps: number;
  objectiveText: string;
  rewardCredits: number;
  rewardFans: number;
}

export const CAREER_EVENTS: CareerEvent[] = [
  {
    id: 'career_1',
    stage: 1,
    title: 'NEON INITIATION',
    rivalName: 'KAZUYA',
    trackId: 'neon_city',
    mode: 'combat_race',
    difficulty: 'easy',
    laps: 2,
    objectiveText: 'Finish Top 3 in Neon City Combat Race',
    rewardCredits: 1200,
    rewardFans: 450,
  },
  {
    id: 'career_2',
    stage: 1,
    title: 'DOCKYARD STRIKE',
    rivalName: 'RAZOR-9',
    trackId: 'industrial_port',
    mode: 'combat_race',
    difficulty: 'normal',
    laps: 3,
    objectiveText: 'Finish 1st & land 2+ Power-Up hits',
    rewardCredits: 2200,
    rewardFans: 800,
  },
  {
    id: 'career_3',
    stage: 2,
    title: 'MIDNIGHT APEX',
    rivalName: 'VALKYRIE',
    trackId: 'midnight_streets',
    mode: 'pure_race',
    difficulty: 'hard',
    laps: 3,
    objectiveText: 'Win a Pure Race with zero power-ups',
    rewardCredits: 3200,
    rewardFans: 1200,
  },
  {
    id: 'career_4',
    stage: 2,
    title: 'LAST CAR STANDING',
    rivalName: 'VORTEX',
    trackId: 'neon_city',
    mode: 'elimination',
    difficulty: 'hard',
    laps: 3,
    objectiveText: 'Survive Elimination intervals and take 1st',
    rewardCredits: 4000,
    rewardFans: 1600,
  },
  {
    id: 'career_5',
    stage: 3,
    title: 'SYNDICATE SHOWDOWN',
    rivalName: 'NOVA',
    trackId: 'midnight_streets',
    mode: 'combat_race',
    difficulty: 'expert',
    laps: 3,
    objectiveText: 'Defeat Expert rivals for the Hypercar title',
    rewardCredits: 6000,
    rewardFans: 2500,
  },
];

export interface DailyMission {
  id: string;
  title: string;
  description: string;
  target: number;
  metric: 'races' | 'wins' | 'takedowns';
  rewardCredits: number;
}

export const DAILY_MISSIONS: DailyMission[] = [
  {
    id: 'mission_races_2',
    title: 'NIGHT SHIFT',
    description: 'Complete 2 races in any mode',
    target: 2,
    metric: 'races',
    rewardCredits: 900,
  },
  {
    id: 'mission_win_1',
    title: 'PODIUM KING',
    description: 'Win 1 race in 1st place',
    target: 1,
    metric: 'wins',
    rewardCredits: 1500,
  },
  {
    id: 'mission_takedowns_2',
    title: 'WRECKING CREW',
    description: 'Score 2 opponent takedowns with power-ups',
    target: 2,
    metric: 'takedowns',
    rewardCredits: 1400,
  },
];

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  check: (p: PlayerProfile) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'ach_first_race',
    title: 'FIRST IGNITION',
    description: 'Finish your first Neon Rivals race',
    check: (p) => p.racesCompleted >= 1,
  },
  {
    id: 'ach_first_win',
    title: 'STREET CHAMPION',
    description: 'Take 1st place in a race',
    check: (p) => p.wins >= 1,
  },
  {
    id: 'ach_combat_vet',
    title: 'ENERGY SPECIALIST',
    description: 'Record 3 total combat takedowns',
    check: (p) => p.takedowns >= 3,
  },
  {
    id: 'ach_collector',
    title: 'GARAGE COLLECTOR',
    description: 'Own 2 or more vehicles in the 3D Garage',
    check: (p) => p.ownedVehicles.length >= 2,
  },
];

export const SEED_LEADERBOARD = [
  { username: 'NOVA_APEX', fanPoints: 14850, wins: 29, vehicle: 'PHANTOM X' },
  { username: 'KAZUYA_GT', fanPoints: 12120, wins: 24, vehicle: 'CYBER GT-R' },
  { username: 'VALKYRIE_X', fanPoints: 9840, wins: 19, vehicle: 'NIGHT VIPER' },
  { username: 'TASHKENT_DRIFT', fanPoints: 8420, wins: 15, vehicle: 'CYBER GT-R' },
  { username: 'RAZOR_VOLT', fanPoints: 6790, wins: 11, vehicle: 'STREET FALCON' },
];

export function xpForNextLevel(level: number): number {
  return 500 + (level - 1) * 350;
}

export function calculateRaceRewards(params: {
  position: number;
  totalRacers: number;
  hitsLanded: number;
  takedowns: number;
  blocksLanded: number;
  difficulty: Difficulty;
  currentLevel: number;
  currentXp: number;
}): RaceRewards {
  const diffMult =
    params.difficulty === 'expert'
      ? 1.5
      : params.difficulty === 'hard'
        ? 1.25
        : params.difficulty === 'normal'
          ? 1.0
          : 0.85;

  const basePlacementCredits = Math.max(250, (params.totalRacers - params.position + 1) * 260);
  const podiumBonus = params.position === 1 ? 650 : params.position === 2 ? 350 : params.position === 3 ? 200 : 0;
  const combatCredits = params.hitsLanded * 65 + params.takedowns * 220 + params.blocksLanded * 90;

  const credits = Math.round((basePlacementCredits + podiumBonus + combatCredits) * diffMult);
  const xp = Math.round((200 + podiumBonus * 0.4 + params.hitsLanded * 25 + params.takedowns * 90) * diffMult);
  const fanPoints = Math.round((150 + (params.totalRacers - params.position + 1) * 45 + params.takedowns * 80) * diffMult);

  const bonusLabels: string[] = [];
  if (params.position === 1) bonusLabels.push('1ST PLACE VICTORY (+650 CR)');
  else if (params.position <= 3) bonusLabels.push(`PODIUM FINISH (+${podiumBonus} CR)`);
  if (params.takedowns > 0) bonusLabels.push(`${params.takedowns}x TAKEDOWN (+${params.takedowns * 220} CR)`);
  if (params.blocksLanded > 0) bonusLabels.push(`${params.blocksLanded}x SHIELD BLOCK (+${params.blocksLanded * 90} CR)`);

  const levelUp = params.currentXp + xp >= xpForNextLevel(params.currentLevel);

  return { credits, xp, fanPoints, bonusLabels, levelUp };
}

export function createDefaultProfile(): PlayerProfile {
  return {
    id: `guest_${Math.random().toString(36).slice(2, 8)}`,
    username: 'DRIVER_01',
    isGuest: true,
    level: 1,
    xp: 0,
    credits: 3000,
    fanPoints: 350,
    racesCompleted: 0,
    wins: 0,
    takedowns: 0,
    ownedVehicles: ['street_falcon'],
    selectedVehicleId: 'street_falcon',
    customizations: getDefaultCustomizationsMap(),
    completedCareerIds: [],
    claimedMissionIds: [],
    unlockedAchievements: [],
  };
}

export function createDefaultSettings(): SettingsState {
  return {
    language: 'en',
    graphics: 'high',
    masterVolume: 0.75,
    engineVolume: 0.65,
    sfxVolume: 0.85,
    uiVolume: 0.65,
    muted: false,
    showFps: true,
    mobileControls: 'auto',
    autoAccelerate: false,
    leftHandedMobile: false,
    speedUnit: 'kmh',
  };
}

const PROFILE_STORAGE_KEY = 'neon_rivals_profile_v1';
const SETTINGS_STORAGE_KEY = 'neon_rivals_settings_v1';

export function loadLocalProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return createDefaultProfile();
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
    const defaults = createDefaultProfile();
    return {
      ...defaults,
      ...parsed,
      customizations: {
        ...defaults.customizations,
        ...(parsed.customizations ?? {}),
      },
    };
  } catch {
    return createDefaultProfile();
  }
}

export function saveLocalProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore storage quota errors
  }
}

export function loadLocalSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return createDefaultSettings();
    return { ...createDefaultSettings(), ...(JSON.parse(raw) as Partial<SettingsState>) };
  } catch {
    return createDefaultSettings();
  }
}

export function saveLocalSettings(settings: SettingsState): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}
