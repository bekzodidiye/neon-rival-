import type {
  ControlInput,
  Difficulty,
  ProjectileState,
  RacerState,
  ShockZoneState,
  TrackPickupNode,
} from './types';
import type { BuiltTrack } from './trackMath';
import { forwardTrackDistance, normalizeT, sampleTrackAt } from './trackMath';

interface DifficultyProfile {
  speedScale: number;
  cornerCaution: number;
  combatFrequency: number; // lower = more frequent
  shieldReactionChance: number;
  pickupSeekWeight: number;
}

const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    speedScale: 0.84,
    cornerCaution: 1.25,
    combatFrequency: 2.6,
    shieldReactionChance: 0.35,
    pickupSeekWeight: 0.45,
  },
  normal: {
    speedScale: 0.94,
    cornerCaution: 1.0,
    combatFrequency: 1.65,
    shieldReactionChance: 0.65,
    pickupSeekWeight: 0.72,
  },
  hard: {
    speedScale: 1.0,
    cornerCaution: 0.85,
    combatFrequency: 1.15,
    shieldReactionChance: 0.85,
    pickupSeekWeight: 0.9,
  },
  expert: {
    speedScale: 1.04,
    cornerCaution: 0.75,
    combatFrequency: 0.8,
    shieldReactionChance: 0.95,
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
 * Compute natural arcade racing + tactical combat inputs for an AI opponent.
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
): ControlInput {
  const profile = DIFFICULTY_PROFILES[difficulty];

  const input: ControlInput = {
    throttle: 0.95,
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

  // Update periodic lane target variation & overtaking offset
  ai.aiLaneTimer -= dt;
  if (ai.aiLaneTimer <= 0) {
    ai.aiLaneTimer = 1.6 + Math.random() * 2.2;
    ai.aiLaneOffset = (Math.random() - 0.5) * (track.def.roadWidth * 0.48);
  }

  let targetLane = ai.aiLaneOffset;

  // Seek nearby power-up if inventory has an empty slot
  const hasEmptySlot = ai.inventory.some((s) => s === null);
  if (hasEmptySlot && Math.random() < profile.pickupSeekWeight) {
    let bestPu: TrackPickupNode | null = null;
    let bestDist = 75;
    for (const pu of pickups) {
      if (!pu.active) continue;
      const ahead = forwardTrackDistance(track, ai.trackT, pu.trackT);
      if (ahead > 12 && ahead < bestDist) {
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
    if (ahead > 4 && ahead < 48) {
      const s = sampleTrackAt(track, sz.trackT);
      const szLat = (sz.x - s.x) * s.rx + (sz.z - s.z) * s.rz;
      if (Math.abs(targetLane - szLat) < 5.5) {
        targetLane = szLat > 0 ? -6.2 : 6.2;
      }
    }
  }

  // Overtake slower car directly ahead
  for (const other of allRacers) {
    if (other.id === ai.id || other.destroyed) continue;
    const ahead = forwardTrackDistance(track, ai.trackT, other.trackT);
    if (ahead > 3 && ahead < 26 && Math.abs(other.lateralOffset - ai.lateralOffset) < 3.6) {
      targetLane = other.lateralOffset > 0 ? -5.0 : 5.0;
      break;
    }
  }

  // Clamp lane safely inside track walls
  const maxLane = track.def.roadWidth * 0.5 - 3.2;
  targetLane = Math.max(-maxLane, Math.min(maxLane, targetLane));

  // Look ahead along the spline scaled by speed
  const lookAheadMeters = Math.max(22, Math.min(58, ai.speed * 0.72 + 16));
  const lookT = normalizeT(ai.trackT + lookAheadMeters / track.totalLength);
  const lookSample = sampleTrackAt(track, lookT);
  const targetX = lookSample.x + lookSample.rx * targetLane;
  const targetZ = lookSample.z + lookSample.rz * targetLane;

  const desiredHeading = Math.atan2(targetX - ai.x, targetZ - ai.z);
  let headingErr = desiredHeading - ai.heading;
  while (headingErr > Math.PI) headingErr -= Math.PI * 2;
  while (headingErr < -Math.PI) headingErr += Math.PI * 2;

  // Remember: steerInput = -1 turns left (+heading), +1 turns right (-heading)
  input.steer = Math.max(-1, Math.min(1, -headingErr * 2.15));

  // Predict upcoming corner curvature for smart braking & drifting
  const farSample = sampleTrackAt(track, normalizeT(ai.trackT + 55 / track.totalLength));
  const cornerSeverity = Math.max(Math.abs(lookSample.curvature), Math.abs(farSample.curvature));

  // Authentic Blur pack-racing rubber-banding (keeps races wheel-to-wheel without unfair teleporting)
  const player = allRacers.find((r) => r.isPlayer);
  let paceMultiplier = profile.speedScale;
  if (player && !player.finished) {
    const progressGap = ai.totalProgress - player.totalProgress;
    if (progressGap > 0.9) paceMultiplier *= 0.89;
    else if (progressGap < -0.9) paceMultiplier *= 1.07;
  }

  if (cornerSeverity > 0.055 * profile.cornerCaution && ai.speed > 44) {
    input.throttle = 0.45 * paceMultiplier;
    input.brake = Math.min(0.65, cornerSeverity * 5.2);
    if (Math.abs(input.steer) > 0.45) {
      input.drift = true;
    }
  } else {
    input.throttle = Math.min(1, paceMultiplier);
  }

  // Recover if stuck or facing wrong way
  if (ai.wrongWay && Math.abs(ai.speed) < 8) {
    input.recover = true;
  }

  // Tactical power-up usage
  ai.aiDecisionTimer -= dt;
  if (ai.aiDecisionTimer <= 0) {
    ai.aiDecisionTimer = profile.combatFrequency * (0.7 + Math.random() * 0.6);

    // 1. Check incoming homing threat -> prioritize SHIELD or defensive MINE interception!
    const hasIncomingThreat = projectiles.some(
      (p) => p.targetId === ai.id && Math.hypot(p.x - ai.x, p.z - ai.z) < 52,
    );
    const shieldIdx = ai.inventory.findIndex((s) => s?.type === 'SHIELD');
    const mineIdx = ai.inventory.findIndex((s) => s?.type === 'MINE');
    if (hasIncomingThreat && Math.random() < profile.shieldReactionChance) {
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

    // 2. Low health -> prioritize REPAIR
    const repairIdx = ai.inventory.findIndex((s) => s?.type === 'REPAIR');
    if (repairIdx !== -1 && ai.hp < ai.maxHp * 0.6) {
      input.selectSlot = repairIdx;
      input.usePowerUp = true;
      return input;
    }

    // 3. Close opponent -> prioritize BARGE
    const bargeIdx = ai.inventory.findIndex((s) => s?.type === 'BARGE');
    if (bargeIdx !== -1) {
      const nearbyEnemy = allRacers.some(
        (r) => r.id !== ai.id && !r.destroyed && Math.hypot(r.x - ai.x, r.z - ai.z) < 9.5,
      );
      if (nearbyEnemy) {
        input.selectSlot = bargeIdx;
        input.usePowerUp = true;
        return input;
      }
    }

    // 4. Straightaway -> use NITRO
    const nitroIdx = ai.inventory.findIndex((s) => s?.type === 'NITRO');
    if (nitroIdx !== -1 && cornerSeverity < 0.035) {
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
