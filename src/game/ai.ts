import type {
  ControlInput,
  Difficulty,
  ProjectileState,
  RacerState,
  ShockZoneState,
  TrackPickupNode,
} from './types';
import type { BuiltTrack } from './trackMath';
import { forwardTrackDistance, sampleTrackAt, sampleTrackByDistance, tToDistance } from './trackMath';
import { getVehicleById } from './vehicles';

interface DifficultyProfile {
  speedScale: number;
  cornerCaution: number;
  combatFrequency: number; // lower = more frequent
  shieldReactionChance: number;
  pickupSeekWeight: number;
}

const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    speedScale: 0.85,
    cornerCaution: 1.25,
    combatFrequency: 2.5,
    shieldReactionChance: 0.35,
    pickupSeekWeight: 0.5,
  },
  normal: {
    speedScale: 0.94,
    cornerCaution: 1.0,
    combatFrequency: 1.55,
    shieldReactionChance: 0.68,
    pickupSeekWeight: 0.78,
  },
  hard: {
    speedScale: 1.0,
    cornerCaution: 0.88,
    combatFrequency: 1.1,
    shieldReactionChance: 0.85,
    pickupSeekWeight: 0.92,
  },
  expert: {
    speedScale: 1.03,
    cornerCaution: 0.8,
    combatFrequency: 0.82,
    shieldReactionChance: 0.94,
    pickupSeekWeight: 1.0,
  },
};

export const AI_DRIVER_NAMES = [
  'KAZUYA',
  'VALKYRIE',
  'RAZOR-9',
  'SOLARIS',
  'DRIFTER X',
  'VORTEX',
  'NOVA',
];

/**
 * Compute grounded arcade racing + tactical combat inputs for an AI opponent (V5.0 Stage 6).
 * Uses arc-length look-ahead, curvature-based corner braking distance, persistent lane selection,
 * overtaking awareness, recovery detection, and optional seeded PRNG for repeatable acceptance tests.
 */
export function computeAiInput(
  ai: RacerState,
  allRacers: RacerState[],
  track: BuiltTrack,
  pickups: TrackPickupNode[],
  projectiles: ProjectileState[],
  shockZones: ShockZoneState[],
  difficulty: Difficulty,
  dt: number,
  rng: () => number = Math.random,
): ControlInput {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const vehicle = getVehicleById(ai.vehicleId);

  const input: ControlInput = {
    throttle: 0.96,
    brake: 0,
    steer: 0,
    drift: false,
    useNitro: false,
    usePowerUp: false,
    cycleSlot: false,
    discardSlot: false,
    selectSlot: -1,
    rearView: false,
    rearFire: false,
    recover: false,
  };

  if (ai.destroyed || ai.eliminated || ai.finished) {
    input.throttle = 0;
    return input;
  }

  // Persistent lane decision interval (never flips randomly every frame)
  ai.aiLaneTimer -= dt;
  if (ai.aiLaneTimer <= 0) {
    ai.aiLaneTimer = 2.1 + rng() * 2.4;
    ai.aiLaneOffset = (rng() - 0.5) * (track.def.roadWidth * 0.44);
  }

  let targetLane = ai.aiLaneOffset;

  // Seek nearby power-up if inventory has an empty slot
  const hasEmptySlot = ai.inventory.some((s) => s === null);
  if (hasEmptySlot && profile.pickupSeekWeight > 0.3) {
    let bestPu: TrackPickupNode | null = null;
    let bestDist = 72;
    for (const pu of pickups) {
      if (!pu.active) continue;
      const ahead = forwardTrackDistance(track, ai.trackT, pu.trackT);
      if (ahead > 14 && ahead < bestDist) {
        bestDist = ahead;
        bestPu = pu;
      }
    }
    if (bestPu) {
      targetLane = bestPu.lateralOffset;
    }
  }

  // Avoid nearby active Shock electric domes ahead
  for (const sz of shockZones) {
    const ahead = forwardTrackDistance(track, ai.trackT, sz.trackT);
    if (ahead > 4 && ahead < 52) {
      const s = sampleTrackAt(track, sz.trackT);
      const szLat = (sz.x - s.x) * s.rx + (sz.z - s.z) * s.rz;
      if (Math.abs(targetLane - szLat) < 5.5) {
        targetLane = szLat > 0 ? -6.0 : 6.0;
      }
    }
  }

  // Safe overtaking around slower car directly ahead
  for (const other of allRacers) {
    if (other.id === ai.id || other.destroyed || other.eliminated) continue;
    const ahead = forwardTrackDistance(track, ai.trackT, other.trackT);
    if (ahead > 4 && ahead < 28 && Math.abs(other.lateralOffset - ai.lateralOffset) < 3.8) {
      targetLane = other.lateralOffset > 0 ? -5.2 : 5.2;
      break;
    }
  }

  // Clamp lane safely inside road barriers
  const maxLane = track.def.roadWidth * 0.5 - 3.4;
  targetLane = Math.max(-maxLane, Math.min(maxLane, targetLane));

  // Arc-length distance look-ahead scaled by vehicle speed
  const aiDist = tToDistance(track, ai.trackT);
  const lookAheadMeters = Math.max(20, Math.min(54, ai.speed * 0.68 + 15));
  const lookSample = sampleTrackByDistance(track, aiDist + lookAheadMeters);
  const targetX = lookSample.x + lookSample.rx * targetLane;
  const targetZ = lookSample.z + lookSample.rz * targetLane;

  const desiredHeading = Math.atan2(targetX - ai.x, targetZ - ai.z);
  let headingErr = desiredHeading - ai.heading;
  while (headingErr > Math.PI) headingErr -= Math.PI * 2;
  while (headingErr < -Math.PI) headingErr += Math.PI * 2;

  input.steer = Math.max(-1, Math.min(1, -headingErr * 2.2));

  // Curvature-based corner entry speed & braking distance calculation
  const midSample = sampleTrackByDistance(track, aiDist + 38);
  const farSample = sampleTrackByDistance(track, aiDist + 72);
  const peakCurvature = Math.max(
    Math.abs(lookSample.curvature),
    Math.abs(midSample.curvature),
    Math.abs(farSample.curvature),
  );

  // Subtle fair rubber-banding (never grants impossible speeds above vehicle class limits)
  const player = allRacers.find((r) => r.isPlayer);
  let paceMultiplier = profile.speedScale;
  if (player && !player.finished) {
    const progressGap = ai.totalProgress - player.totalProgress;
    if (progressGap > 1.2) paceMultiplier *= 0.92;
    else if (progressGap < -1.2) paceMultiplier *= 1.04;
  }

  // Safe corner speed threshold from curvature
  const safeCornerSpeed =
    peakCurvature > 0.025
      ? Math.max(30, (vehicle.stats.topSpeed * 0.92) / (1 + peakCurvature * 11 * profile.cornerCaution))
      : vehicle.stats.topSpeed;

  if (ai.speed > safeCornerSpeed + 3.5) {
    const excess = (ai.speed - safeCornerSpeed) / 25;
    input.throttle = 0.28 * paceMultiplier;
    input.brake = Math.min(0.75, 0.25 + excess * 0.55);
    if (Math.abs(input.steer) > 0.45 && ai.speed > 34) {
      input.drift = true;
    }
  } else {
    input.throttle = Math.min(1, paceMultiplier);
  }

  // Automatic stuck / wrong-way recovery
  if (ai.wrongWay && Math.abs(ai.speed) < 9) {
    input.recover = true;
  }

  // Tactical power-up usage on clean decision intervals
  ai.aiDecisionTimer -= dt;
  if (ai.aiDecisionTimer <= 0) {
    ai.aiDecisionTimer = profile.combatFrequency * (0.75 + rng() * 0.5);

    // 1. Incoming homing threat -> SHIELD or defensive MINE
    const hasIncomingThreat = projectiles.some(
      (p) => p.targetId === ai.id && Math.hypot(p.x - ai.x, p.z - ai.z) < 55,
    );
    const shieldIdx = ai.inventory.findIndex((s) => s?.type === 'SHIELD');
    const mineIdx = ai.inventory.findIndex((s) => s?.type === 'MINE');
    if (hasIncomingThreat && rng() < profile.shieldReactionChance) {
      if (shieldIdx !== -1) {
        input.selectSlot = shieldIdx;
        input.usePowerUp = true;
        return input;
      }
      if (mineIdx !== -1) {
        input.selectSlot = mineIdx;
        input.usePowerUp = true;
        return input;
      }
    }

    // 2. Low health -> REPAIR
    const repairIdx = ai.inventory.findIndex((s) => s?.type === 'REPAIR');
    if (repairIdx !== -1 && ai.hp < ai.maxHp * 0.62) {
      input.selectSlot = repairIdx;
      input.usePowerUp = true;
      return input;
    }

    // 3. Close opponent -> BARGE
    const bargeIdx = ai.inventory.findIndex((s) => s?.type === 'BARGE');
    if (bargeIdx !== -1) {
      const nearbyEnemy = allRacers.some(
        (r) => r.id !== ai.id && !r.destroyed && Math.hypot(r.x - ai.x, r.z - ai.z) < 10,
      );
      if (nearbyEnemy) {
        input.selectSlot = bargeIdx;
        input.usePowerUp = true;
        return input;
      }
    }

    // 4. Clear straightaway -> NITRO
    const nitroIdx = ai.inventory.findIndex((s) => s?.type === 'NITRO');
    if (nitroIdx !== -1 && peakCurvature < 0.036) {
      input.selectSlot = nitroIdx;
      input.usePowerUp = true;
      return input;
    }

    // 5. Offensive abilities (SHUNT, BOLT, SHOCK, MINE)
    for (let i = 0; i < 3; i++) {
      const slot = ai.inventory[i];
      if (!slot) continue;
      if (slot.type === 'SHOCK' && ai.position > 1) {
        input.selectSlot = i;
        input.usePowerUp = true;
        return input;
      }
      if (slot.type === 'MINE') {
        const chaserBehind = allRacers.some(
          (r) =>
            r.id !== ai.id &&
            !r.destroyed &&
            forwardTrackDistance(track, r.trackT, ai.trackT) < 35,
        );
        if (chaserBehind) {
          input.selectSlot = i;
          input.usePowerUp = true;
          return input;
        }
      }
      if (slot.type === 'SHUNT' || slot.type === 'BOLT') {
        const targetAhead = allRacers.some(
          (r) =>
            r.id !== ai.id &&
            !r.destroyed &&
            forwardTrackDistance(track, ai.trackT, r.trackT) < 95,
        );
        if (targetAhead) {
          input.selectSlot = i;
          input.usePowerUp = true;
          return input;
        }
      }
    }
  }

  return input;
}
