import type { ControlInput, RacerState } from './types';
import type { BuiltTrack } from './trackMath';
import { projectPointToTrack, sampleTrackAt } from './trackMath';
import { getVehicleById } from './vehicles';
import { POWERUP_BALANCE } from './powerups';

export interface PhysicsStepEvents {
  wallHitIntensity: number; // 0..1
  driftIntensity: number; // 0..1
  nitroActive: boolean;
  driftBoostTriggered?: boolean;
}

/**
 * Step arcade vehicle dynamics for a single racer on a fixed/clamped timestep.
 * Pure TypeScript math — zero Three.js/DOM dependencies for deterministic unit testing and server authority.
 */
export function stepVehiclePhysics(
  racer: RacerState,
  input: ControlInput,
  track: BuiltTrack,
  dt: number,
  canDrive: boolean,
): PhysicsStepEvents {
  const vehicle = getVehicleById(racer.vehicleId);
  const stats = vehicle.stats;

  // Decay timers
  if (racer.nitroTimer > 0) racer.nitroTimer = Math.max(0, racer.nitroTimer - dt);
  if (racer.shieldTimer > 0) racer.shieldTimer = Math.max(0, racer.shieldTimer - dt);
  if (racer.shockSlowTimer > 0) racer.shockSlowTimer = Math.max(0, racer.shockSlowTimer - dt);
  if (racer.stunTimer > 0) racer.stunTimer = Math.max(0, racer.stunTimer - dt);
  if (racer.spawnProtectTimer > 0) racer.spawnProtectTimer = Math.max(0, racer.spawnProtectTimer - dt);
  if (racer.hitFlashTimer > 0) racer.hitFlashTimer = Math.max(0, racer.hitFlashTimer - dt);
  if (racer.boltCooldown > 0) racer.boltCooldown = Math.max(0, racer.boltCooldown - dt);
  if ((racer.comboTimer ?? 0) > 0) {
    racer.comboTimer = Math.max(0, (racer.comboTimer ?? 0) - dt);
    if (racer.comboTimer === 0) racer.comboCount = 0;
  }
  // 2-stage Blur Reverse Nitro Air-Brake: after brief rotation slow-down, fire a crisp corner-exit boost
  if ((racer.airBrakeBoostTimer ?? 0) > 0 && !racer.destroyed) {
    racer.airBrakeBoostTimer = Math.max(0, (racer.airBrakeBoostTimer ?? 0) - dt);
    if (racer.airBrakeBoostTimer === 0 && canDrive) {
      racer.nitroTimer = Math.max(racer.nitroTimer, 0.9 * stats.nitroEfficiency);
    }
  }

  // Destroyed & respawn countdown
  if (racer.destroyed) {
    racer.respawnTimer -= dt;
    racer.vx *= Math.exp(-3.5 * dt);
    racer.vz *= Math.exp(-3.5 * dt);
    racer.x += racer.vx * dt;
    racer.z += racer.vz * dt;
    racer.speed = Math.hypot(racer.vx, racer.vz);
    racer.isDrifting = false;

    if (racer.respawnTimer <= 0) {
      recoverVehicleToTrack(racer, track);
      racer.destroyed = false;
      racer.hp = racer.maxHp;
      racer.spawnProtectTimer = 2.5;
    }
    return { wallHitIntensity: 0, driftIntensity: 0, nitroActive: false };
  }

  // Manual vehicle recovery
  if (canDrive && input.recover) {
    recoverVehicleToTrack(racer, track);
    racer.spawnProtectTimer = Math.max(racer.spawnProtectTimer, 1.2);
  }

  // Passive nitro activation via Shift if player has >= 35% drift-charged nitro energy
  if (canDrive && input.useNitro && racer.nitroTimer <= 0.05 && racer.nitroEnergy >= 35) {
    racer.nitroTimer = 1.6 * stats.nitroEfficiency;
    racer.nitroEnergy = Math.max(0, racer.nitroEnergy - 45);
  }

  const nitroActive = racer.nitroTimer > 0;
  const shockMult = racer.shockSlowTimer > 0 ? 0.52 : 1.0;
  const stunMult = racer.stunTimer > 0 ? 0.45 : 1.0;
  const slipstreamMult = racer.isDrafting ? 1.11 : 1.0;

  const maxSpeed =
    stats.topSpeed *
    (nitroActive ? POWERUP_BALANCE.NITRO_SPEED_MULT : 1.0) *
    slipstreamMult *
    shockMult *
    stunMult;
  const accelPower =
    stats.acceleration *
    (nitroActive ? POWERUP_BALANCE.NITRO_ACCEL_MULT : 1.0) *
    (racer.isDrafting ? 1.15 : 1.0) *
    shockMult;

  const fwdX = Math.sin(racer.heading);
  const fwdZ = Math.cos(racer.heading);
  const rightX = -fwdZ;
  const rightZ = fwdX;

  // Decompose current world velocity into vehicle-local forward & lateral components
  let forwardSpeed = racer.vx * fwdX + racer.vz * fwdZ;
  let lateralSpeed = racer.vx * rightX + racer.vz * rightZ;

  const throttle = canDrive && !racer.eliminated ? Math.max(0, Math.min(1, input.throttle)) : 0;
  const brake = canDrive && !racer.eliminated ? Math.max(0, Math.min(1, input.brake)) : 0;
  const steerInput = canDrive && !racer.eliminated ? Math.max(-1, Math.min(1, input.steer)) : 0;

  // Longitudinal forces with Blur-style explosive launch torque off the grid
  if (throttle > 0 || nitroActive) {
    const effThrottle = nitroActive ? Math.max(throttle, 0.95) : throttle;
    const speedRatio = Math.max(0, forwardSpeed / Math.max(1, maxSpeed));
    const torqueCurve = Math.max(0.28, 1.38 - speedRatio * 0.98);
    forwardSpeed += effThrottle * accelPower * torqueCurve * dt;
  }

  if (brake > 0) {
    if (forwardSpeed > 1.5) {
      forwardSpeed -= brake * stats.braking * dt;
      if (forwardSpeed < 0) forwardSpeed = 0;
    } else {
      // Reverse gear
      forwardSpeed -= brake * (stats.acceleration * 0.58) * dt;
      forwardSpeed = Math.max(-22, forwardSpeed);
    }
  }

  // Rolling resistance & aero drag
  if (throttle <= 0.01 && !nitroActive) {
    forwardSpeed *= Math.exp(-0.52 * dt);
  }
  // Aerodynamic cap smoothing
  if (forwardSpeed > maxSpeed) {
    forwardSpeed += (maxSpeed - forwardSpeed) * Math.min(1, 3.6 * dt);
  }

  // Arcade Drift state: initiated at speed > 22 m/s while steering + holding brake/drift
  const wantsDrift =
    canDrive &&
    Math.abs(steerInput) > 0.32 &&
    forwardSpeed > 22 &&
    (input.drift || (brake > 0.22 && throttle > 0.1));

  let driftBoostTriggered = false;
  if (wantsDrift) {
    racer.isDrifting = true;
    racer.driftTime += dt;
    // Charge passive nitro meter during clean drifts
    racer.nitroEnergy = Math.min(100, racer.nitroEnergy + dt * 20);
  } else if (Math.abs(lateralSpeed) < 4.5 || forwardSpeed < 16 || Math.abs(steerInput) < 0.12) {
    // Clean drift exit grants Blur corner-exit surge!
    if (racer.isDrifting && racer.driftTime >= 0.65 && forwardSpeed > 28) {
      forwardSpeed = Math.min(maxSpeed * 1.12, forwardSpeed + 9);
      driftBoostTriggered = true;
    }
    racer.isDrifting = false;
    racer.driftTime = 0;
  }

  // Handling archetype simulation modifiers (V3.0 Sec 10: Grippy, Drifty, Balanced, Off-road)
  const handlingType = vehicle.handlingArchetype ?? 'balanced';
  const archetypeGripMult =
    handlingType === 'grippy' ? 1.24 : handlingType === 'drifty' ? 0.78 : handlingType === 'offroad' ? 0.96 : 1.0;
  const archetypeDriftSlip =
    handlingType === 'drifty' ? 0.44 : handlingType === 'grippy' ? 0.22 : handlingType === 'offroad' ? 0.3 : 0.34;
  const archetypeYawBoost =
    handlingType === 'drifty' ? 1.12 : handlingType === 'grippy' ? 1.04 : 1.0;

  // Speed-dependent steering response (crisp low/mid speed, stable at 290+ km/h)
  const absSpeed = Math.abs(forwardSpeed);
  const speedFactor = Math.min(1, absSpeed / 14);
  const highSpeedDamp = 1 / (1 + Math.max(0, absSpeed - 32) * 0.014);
  const driftSteerBoost = racer.isDrifting ? 1.28 * archetypeYawBoost : 1.0;
  const reverseSign = forwardSpeed >= -0.2 ? 1 : -1;

  const targetYawRate = -steerInput * stats.handling * speedFactor * highSpeedDamp * driftSteerBoost * reverseSign;
  const yawResponsiveness = racer.isDrifting ? (handlingType === 'drifty' ? 7.6 : 6.5) : 10.5;
  racer.angularVel += (targetYawRate - racer.angularVel) * Math.min(1, yawResponsiveness * dt);
  racer.heading += racer.angularVel * dt;

  // Visual front wheel angle (-left, +right mapped to Three.js Y rotation)
  const targetSteerAngle = -steerInput * 0.42;
  racer.steerAngle += (targetSteerAngle - racer.steerAngle) * Math.min(1, 14 * dt);

  // Lateral grip & controlled drift slip
  const baseGrip = stats.grip * archetypeGripMult;
  const gripCoeff = racer.isDrifting ? baseGrip * (0.36 + stats.driftControl * 0.12) : baseGrip;
  if (racer.isDrifting) {
    lateralSpeed += -steerInput * forwardSpeed * archetypeDriftSlip * dt;
    // Small speed bleed only on excessive slip (Drifty cars lose less speed during wide drifts)
    if (Math.abs(lateralSpeed) > 14) {
      forwardSpeed *= Math.exp((handlingType === 'drifty' ? -0.28 : -0.45) * dt);
    }
  }
  lateralSpeed *= Math.exp(-gripCoeff * dt);

  // Rough road-shoulder traction drag (Off-road archetype preserves traction & speed on outer curbs/shoulders!)
  const shoulderThreshold = track.def.roadWidth * 0.5 - 3.2;
  if (Math.abs(racer.lateralOffset) > shoulderThreshold && handlingType !== 'offroad') {
    forwardSpeed *= Math.exp(-0.42 * dt);
  }

  // Reconstruct world velocity
  const newFwdX = Math.sin(racer.heading);
  const newFwdZ = Math.cos(racer.heading);
  const newRightX = -newFwdZ;
  const newRightZ = newFwdX;

  racer.vx = newFwdX * forwardSpeed + newRightX * lateralSpeed;
  racer.vz = newFwdZ * forwardSpeed + newRightZ * lateralSpeed;

  // Integrate position
  racer.x += racer.vx * dt;
  racer.z += racer.vz * dt;
  racer.speed = forwardSpeed;
  racer.lateralSpeed = lateralSpeed;
  racer.wheelSpin += (forwardSpeed / 0.38) * dt;

  // Body pitch (nose lift on accel/nitro, dive on brake) & body roll (cornering lean)
  const targetPitch = (throttle > 0.1 || nitroActive ? -0.025 : 0) + (brake > 0.1 && forwardSpeed > 4 ? 0.032 : 0);
  const targetRoll = Math.max(-0.085, Math.min(0.085, steerInput * Math.min(1, absSpeed / 45) * 0.075));
  racer.bodyPitch += (targetPitch - racer.bodyPitch) * Math.min(1, 9 * dt);
  racer.bodyRoll += (targetRoll - racer.bodyRoll) * Math.min(1, 9 * dt);

  // Project onto track spline & enforce continuous barrier containment (car never falls off road or clips buildings)
  const proj = projectPointToTrack(track, racer.x, racer.z, racer.trackT);
  racer.trackT = proj.t;
  racer.y = proj.sample.y;

  const halfRoad = proj.sample.width * 0.5 - 1.35;
  let wallHitIntensity = 0;

  if (Math.abs(proj.lateralOffset) > halfRoad) {
    const sign = Math.sign(proj.lateralOffset);
    const clampedOffset = sign * halfRoad;
    racer.x = proj.sample.x + proj.sample.rx * clampedOffset;
    racer.z = proj.sample.z + proj.sample.rz * clampedOffset;

    // Reflect outward lateral velocity along track barrier
    const vDotRight = racer.vx * proj.sample.rx + racer.vz * proj.sample.rz;
    if (vDotRight * sign > 0) {
      const impactSpeed = Math.abs(vDotRight);
      wallHitIntensity = Math.min(1, impactSpeed / 22);
      // Slide cleanly along the barrier instead of getting stuck
      racer.vx -= proj.sample.rx * vDotRight * 1.32;
      racer.vz -= proj.sample.rz * vDotRight * 1.32;
      // Gently align heading toward track tangent on scraping impacts
      const trackHeading = Math.atan2(proj.sample.tx, proj.sample.tz);
      let hDiff = trackHeading - racer.heading;
      while (hDiff > Math.PI) hDiff -= Math.PI * 2;
      while (hDiff < -Math.PI) hDiff += Math.PI * 2;
      racer.heading += hDiff * Math.min(0.35, dt * 6);
      racer.vx *= 0.94;
      racer.vz *= 0.94;
      racer.speed = racer.vx * Math.sin(racer.heading) + racer.vz * Math.cos(racer.heading);
    }
    racer.lateralOffset = clampedOffset;
  } else {
    racer.lateralOffset = proj.lateralOffset;
  }

  // Wrong-way detection
  const headingDotTrack = Math.sin(racer.heading) * proj.sample.tx + Math.cos(racer.heading) * proj.sample.tz;
  racer.wrongWay = headingDotTrack < -0.35 && absSpeed > 4;

  const driftIntensity = racer.isDrifting ? Math.min(1, Math.abs(lateralSpeed) / 14) : 0;
  return { wallHitIntensity, driftIntensity, nitroActive, driftBoostTriggered };
}

/** Snap a vehicle safely back onto the track centerline facing forward. */
export function recoverVehicleToTrack(racer: RacerState, track: BuiltTrack): void {
  const s = sampleTrackAt(track, racer.trackT);
  racer.x = s.x;
  racer.y = s.y;
  racer.z = s.z;
  racer.heading = Math.atan2(s.tx, s.tz);
  racer.vx = s.tx * 12;
  racer.vz = s.tz * 12;
  racer.speed = 12;
  racer.lateralSpeed = 0;
  racer.angularVel = 0;
  racer.lateralOffset = 0;
  racer.isDrifting = false;
  racer.wrongWay = false;
}

/** Resolve elastic arcade vehicle-to-vehicle collisions with momentum transfer. */
export function resolveCarCollisions(racers: RacerState[]): { pairImpact: number; aId: string; bId: string; x: number; z: number }[] {
  const impacts: { pairImpact: number; aId: string; bId: string; x: number; z: number }[] = [];
  const collisionRadius = 2.15;
  const minDist = collisionRadius * 2;

  for (let i = 0; i < racers.length; i++) {
    const a = racers[i];
    if (a.destroyed || a.eliminated) continue;
    for (let j = i + 1; j < racers.length; j++) {
      const b = racers[j];
      if (b.destroyed || b.eliminated) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 0.0001 && distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minDist - dist;

        const wa = getVehicleById(a.vehicleId).stats.weight;
        const wb = getVehicleById(b.vehicleId).stats.weight;
        const totalW = wa + wb;
        const ratioA = wb / totalW;
        const ratioB = wa / totalW;

        a.x -= nx * overlap * ratioA;
        a.z -= nz * overlap * ratioA;
        b.x += nx * overlap * ratioB;
        b.z += nz * overlap * ratioB;

        const rvx = b.vx - a.vx;
        const rvz = b.vz - a.vz;
        const velAlongNormal = rvx * nx + rvz * nz;

        if (velAlongNormal < 0) {
          const restitution = 0.55;
          const impulse = -(1 + restitution) * velAlongNormal;
          a.vx -= nx * impulse * ratioA;
          a.vz -= nz * impulse * ratioA;
          b.vx += nx * impulse * ratioB;
          b.vz += nz * impulse * ratioB;

          const impactStrength = Math.min(1, Math.abs(velAlongNormal) / 28);
          if (impactStrength > 0.15) {
            impacts.push({
              pairImpact: impactStrength,
              aId: a.id,
              bId: b.id,
              x: (a.x + b.x) * 0.5,
              z: (a.z + b.z) * 0.5,
            });
          }
        }
      }
    }
  }
  return impacts;
}
