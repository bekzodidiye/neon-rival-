import type { ControlInput, RacerState } from './types';
import type { BuiltTrack } from './trackMath';
import { projectPointToTrack, sampleTrackAt, sampleTrackElevationAt } from './trackMath';
import { getVehicleById } from './vehicles';
import { POWERUP_BALANCE } from './powerups';

export interface PhysicsStepEvents {
  wallHitIntensity: number; // 0..1
  driftIntensity: number; // 0..1
  nitroActive: boolean;
  driftBoostTriggered?: boolean;
  landedHard?: boolean;
}

const GRAVITY = 18.5; // Crisp arcade-weighted vertical gravity (m/s^2)

/**
 * Grounded fixed-timestep arcade vehicle simulation (V5.0 Stage 2):
 * - 4-wheel suspension contact & vertical spring-damper integration over track elevation
 * - Progressive longitudinal torque, engine/aero drag, realistic braking & reverse
 * - Speed-dependent steering, tire slip angle, Grippy/Drifty/Balanced/Off-road handling differentiation
 * - Pure Blur Powered Racing Nitro rules (no passive drift-charged Nitro or auto-drift-exit boost)
 * - Physical barrier normal impulse & scrape friction (no forced auto-steering)
 * Zero Three.js/DOM dependencies — 100% deterministic for fixed-step offline & server-authoritative execution.
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
  const dims = vehicle.dimensions;

  // Record previous position for swept checkpoint gate crossing
  racer.prevX = racer.x;
  racer.prevZ = racer.z;

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

  // 2-stage Blur Reverse Nitro Air-Brake: brief sharp rotation slowdown -> controlled corner-exit surge
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

  // Manual safe vehicle recovery (returns to last valid safe track position; never advances progress)
  if (canDrive && input.recover) {
    recoverVehicleToTrack(racer, track);
    racer.spawnProtectTimer = Math.max(racer.spawnProtectTimer, 1.2);
  }

  // NOTE (V5.0 Sec 16): Passive drift-charged Nitro is intentionally disabled in default Blur Powered Racing.
  // Nitro is activated solely by consuming a collected NITRO power-up from the 3-slot inventory.
  racer.nitroEnergy = racer.nitroTimer > 0 ? Math.min(100, Math.round((racer.nitroTimer / 2.2) * 100)) : 0;

  const nitroActive = racer.nitroTimer > 0;
  const shockMult = racer.shockSlowTimer > 0 ? 0.54 : 1.0;
  const stunMult = racer.stunTimer > 0 ? 0.48 : 1.0;
  const slipstreamMult = racer.isDrafting ? 1.09 : 1.0;

  const maxSpeed =
    stats.topSpeed *
    (nitroActive ? POWERUP_BALANCE.NITRO_SPEED_MULT : 1.0) *
    slipstreamMult *
    shockMult *
    stunMult;
  const accelPower =
    stats.acceleration *
    (nitroActive ? POWERUP_BALANCE.NITRO_ACCEL_MULT : 1.0) *
    (racer.isDrafting ? 1.12 : 1.0) *
    shockMult;

  const fwdX = Math.sin(racer.heading);
  const fwdZ = Math.cos(racer.heading);
  const rightX = -fwdZ;
  const rightZ = fwdX;

  // 4-Wheel Ground Contact & Suspension Sampling (FL, FR, RL, RR)
  const halfWB = dims.wheelBase * 0.5;
  const halfTW = dims.trackWidth * 0.5;
  const wheelOffsets: [number, number][] = [
    [halfTW, halfWB],   // FL
    [-halfTW, halfWB],  // FR
    [halfTW, -halfWB],  // RL
    [-halfTW, -halfWB], // RR
  ];

  const suspMaxTravel = 0.24;
  let groundYSum = 0;
  let slopeSum = 0;
  let wheelsGrounded = 0;
  const comp: [number, number, number, number] = [0, 0, 0, 0];

  for (let w = 0; w < 4; w++) {
    const [ox, oz] = wheelOffsets[w];
    const wx = racer.x + rightX * ox + fwdX * oz;
    const wz = racer.z + rightZ * ox + fwdZ * oz;
    const sample = sampleTrackElevationAt(track, wx, wz, racer.trackT);
    groundYSum += sample.y;
    slopeSum += sample.slope;
    const clearance = racer.y - sample.y;
    if (clearance <= suspMaxTravel) {
      wheelsGrounded += 1;
      comp[w] = Math.max(0, Math.min(1, (suspMaxTravel - clearance) / suspMaxTravel));
    } else {
      comp[w] = 0;
    }
  }

  const avgGroundY = groundYSum * 0.25;
  const avgSlope = slopeSum * 0.25;
  const wasAirborne = racer.grounded === false && (racer.airborneTime ?? 0) > 0.2;

  // Spring-damper vertical integration (replaces direct racer.y = proj.sample.y snapping)
  let vy = racer.vy ?? 0;
  const heightAboveGround = racer.y - avgGroundY;
  let landedHard = false;

  if (heightAboveGround <= suspMaxTravel * 0.85) {
    // Grounded: damped spring brings chassis smoothly to ride ground plane
    const restError = avgGroundY - racer.y;
    const springForce = restError * 115 - vy * 18.5;
    vy += springForce * dt;
    racer.y += vy * dt;
    // Prevent chassis floor from penetrating asphalt
    if (racer.y < avgGroundY - 0.06) {
      if (wasAirborne && vy < -3.5) landedHard = true;
      racer.y = avgGroundY - 0.06;
      vy = Math.max(0, vy * -0.12);
    }
    racer.grounded = true;
    racer.airborneTime = 0;
  } else {
    // Airborne over crest/ramp: real gravity arc
    vy -= GRAVITY * dt;
    racer.y += vy * dt;
    if (racer.y <= avgGroundY) {
      if (wasAirborne && vy < -3.5) landedHard = true;
      racer.y = avgGroundY;
      vy = Math.max(0, -vy * 0.14);
      racer.grounded = true;
      racer.airborneTime = 0;
    } else {
      racer.grounded = false;
      racer.airborneTime = (racer.airborneTime ?? 0) + dt;
    }
  }
  racer.vy = vy;
  racer.suspCompression = comp;

  const tractionScale = wheelsGrounded > 0 ? 0.4 + 0.6 * (wheelsGrounded / 4) : 0.12;

  // Decompose current world velocity into vehicle-local forward & lateral components
  let forwardSpeed = racer.vx * fwdX + racer.vz * fwdZ;
  let lateralSpeed = racer.vx * rightX + racer.vz * rightZ;

  const throttle = canDrive && !racer.eliminated ? Math.max(0, Math.min(1, input.throttle)) : 0;
  const brake = canDrive && !racer.eliminated ? Math.max(0, Math.min(1, input.brake)) : 0;
  const steerInput = canDrive && !racer.eliminated ? Math.max(-1, Math.min(1, input.steer)) : 0;

  // Progressive longitudinal torque curve (realistic weighted 0-100 km/h: ~5.5s Class D -> ~3.2s Class A)
  let longAccel = 0;
  if ((throttle > 0 || nitroActive) && wheelsGrounded > 0) {
    const effThrottle = nitroActive ? Math.max(throttle, 0.96) : throttle;
    const speedRatio = Math.max(0, forwardSpeed / Math.max(1, maxSpeed));
    const baseThrustScale = nitroActive ? 0.85 : 0.41;
    const torqueCurve = Math.max(0.36, 1.06 - speedRatio * 0.68);
    const dV = effThrottle * accelPower * baseThrustScale * torqueCurve * tractionScale * dt;
    forwardSpeed += dV;
    longAccel += dV / Math.max(0.001, dt);
  }

  // Track elevation slope gravity component (uphill loads engine, downhill adds natural momentum)
  if (canDrive) {
    forwardSpeed -= avgSlope * 7.5 * dt;
  }

  // Predictable braking & reverse
  if (brake > 0 && wheelsGrounded > 0) {
    if (forwardSpeed > 1.2) {
      const decel = brake * stats.braking * tractionScale * dt;
      forwardSpeed = Math.max(0, forwardSpeed - decel);
      longAccel -= decel / Math.max(0.001, dt);
    } else {
      // Reverse gear
      forwardSpeed -= brake * (stats.acceleration * 0.55) * dt;
      forwardSpeed = Math.max(-18, forwardSpeed);
    }
  }

  // Engine braking & quadratic aerodynamic drag (Slipstream drafting cuts aero drag ~45%!)
  const aeroCoeff = racer.isDrafting ? 0.00024 : 0.00042;
  const aeroDrag = aeroCoeff * forwardSpeed * Math.abs(forwardSpeed);
  forwardSpeed -= aeroDrag * dt;
  if (throttle <= 0.01 && !nitroActive) {
    forwardSpeed *= Math.exp(-0.42 * dt);
  }

  // Smooth aerodynamic top-speed limiter
  if (forwardSpeed > maxSpeed) {
    forwardSpeed += (maxSpeed - forwardSpeed) * Math.min(1, 3.2 * dt);
  }

  // Controlled Arcade Drift state (handbrake/drift or hard trail-braking into corner)
  const wantsDrift =
    canDrive &&
    wheelsGrounded >= 2 &&
    Math.abs(steerInput) > 0.28 &&
    forwardSpeed > 20 &&
    (input.drift || (brake > 0.25 && throttle > 0.1));

  if (wantsDrift) {
    racer.isDrifting = true;
    racer.driftTime += dt;
  } else if (Math.abs(lateralSpeed) < 3.8 || forwardSpeed < 14 || Math.abs(steerInput) < 0.12) {
    racer.isDrifting = false;
    racer.driftTime = 0;
  }

  // Handling archetype simulation differences (Grippy, Drifty, Balanced, Off-Road)
  const handlingType = vehicle.handlingArchetype ?? 'balanced';
  const archetypeGripMult =
    handlingType === 'grippy' ? 1.26 : handlingType === 'drifty' ? 0.76 : handlingType === 'offroad' ? 0.96 : 1.0;
  const archetypeDriftSlip =
    handlingType === 'drifty' ? 0.42 : handlingType === 'grippy' ? 0.2 : handlingType === 'offroad' ? 0.29 : 0.32;
  const archetypeYawBoost =
    handlingType === 'drifty' ? 1.14 : handlingType === 'grippy' ? 1.05 : 1.0;

  // Speed-dependent steering (zero instant rotation at standstill, stable at 260+ km/h)
  const absSpeed = Math.abs(forwardSpeed);
  const speedFactor = Math.min(1, absSpeed / 12);
  const highSpeedDamp = 1 / (1 + Math.max(0, absSpeed - 28) * 0.016);
  const driftSteerBoost = racer.isDrifting ? 1.24 * archetypeYawBoost : 1.0;
  const reverseSign = forwardSpeed >= -0.2 ? 1 : -1;

  const targetYawRate =
    -steerInput * stats.handling * speedFactor * highSpeedDamp * driftSteerBoost * tractionScale * reverseSign;
  const yawResponsiveness = racer.isDrifting ? (handlingType === 'drifty' ? 7.4 : 6.4) : 9.8;
  racer.angularVel += (targetYawRate - racer.angularVel) * Math.min(1, yawResponsiveness * dt);
  // Natural yaw damping prevents perpetual spinning
  if (Math.abs(steerInput) < 0.05) {
    racer.angularVel *= Math.exp(-5.5 * dt);
  }
  racer.heading += racer.angularVel * dt;

  // Visual front wheel steer angle
  const targetSteerAngle = -steerInput * 0.42;
  racer.steerAngle += (targetSteerAngle - racer.steerAngle) * Math.min(1, 13 * dt);

  // Tire slip angle & lateral grip physics
  const baseGrip = stats.grip * archetypeGripMult * tractionScale;
  const gripCoeff = racer.isDrifting ? baseGrip * (0.34 + stats.driftControl * 0.14) : baseGrip;
  if (racer.isDrifting) {
    lateralSpeed += -steerInput * forwardSpeed * archetypeDriftSlip * dt;
    // Tire scrubbing bleed during deep drift angles
    if (Math.abs(lateralSpeed) > 12) {
      forwardSpeed *= Math.exp((handlingType === 'drifty' ? -0.24 : -0.44) * dt);
    }
  }
  lateralSpeed *= Math.exp(-gripCoeff * dt);

  // Rough road-shoulder traction drag (Off-Road vehicles preserve speed on shoulders/curbs!)
  const shoulderThreshold = track.def.roadWidth * 0.5 - 3.2;
  if (Math.abs(racer.lateralOffset) > shoulderThreshold && handlingType !== 'offroad') {
    forwardSpeed *= Math.exp(-0.55 * dt);
  }

  // Reconstruct world velocity
  const newFwdX = Math.sin(racer.heading);
  const newFwdZ = Math.cos(racer.heading);
  const newRightX = -newFwdZ;
  const newRightZ = newFwdX;

  racer.vx = newFwdX * forwardSpeed + newRightX * lateralSpeed;
  racer.vz = newFwdZ * forwardSpeed + newRightZ * lateralSpeed;

  // Integrate XZ position
  racer.x += racer.vx * dt;
  racer.z += racer.vz * dt;
  racer.speed = forwardSpeed;
  racer.lateralSpeed = lateralSpeed;
  racer.wheelSpin += (forwardSpeed / Math.max(0.25, dims.wheelRadius)) * dt;

  // Weight-transfer & elevation-coupled body pitch & roll
  const slopePitch = -Math.atan(avgSlope);
  const accelPitch = Math.max(-0.045, Math.min(0.055, -longAccel * 0.0014));
  const targetPitch = slopePitch + accelPitch;
  const lateralG = Math.max(-1.4, Math.min(1.4, (-racer.angularVel * absSpeed) / 28));
  const targetRoll = Math.max(-0.095, Math.min(0.095, lateralG * 0.062));
  racer.bodyPitch += (targetPitch - racer.bodyPitch) * Math.min(1, 10 * dt);
  racer.bodyRoll += (targetRoll - racer.bodyRoll) * Math.min(1, 10 * dt);

  // Track projection for progress/surface queries & physical barrier impulse response
  const proj = projectPointToTrack(track, racer.x, racer.z, racer.trackT);
  racer.trackT = proj.t;

  const halfRoad = proj.sample.width * 0.5 - (dims.width * 0.52 + 0.35);
  let wallHitIntensity = 0;

  if (Math.abs(proj.lateralOffset) > halfRoad) {
    const sign = Math.sign(proj.lateralOffset);
    const clampedOffset = sign * halfRoad;

    // Bounded penetration correction back to physical barrier surface
    racer.x = proj.sample.x + proj.sample.rx * clampedOffset;
    racer.z = proj.sample.z + proj.sample.rz * clampedOffset;

    // Physical collision impulse along barrier normal + controlled tangential scrape friction
    // NOTE: Does NOT automatically rotate/steer the player along the road on minor scrapes!
    const vDotNormal = racer.vx * proj.sample.rx + racer.vz * proj.sample.rz;
    if (vDotNormal * sign > 0) {
      const impactSpeed = Math.abs(vDotNormal);
      wallHitIntensity = Math.min(1, impactSpeed / 20);
      const restitution = 0.28;
      racer.vx -= proj.sample.rx * vDotNormal * (1 + restitution);
      racer.vz -= proj.sample.rz * vDotNormal * (1 + restitution);

      // Tangential friction proportional to impact normal impulse
      const scrapeLoss = Math.max(0.84, 1 - impactSpeed * 0.008);
      racer.vx *= scrapeLoss;
      racer.vz *= scrapeLoss;

      // Subtle yaw impulse away from barrier on hard oblique strikes
      racer.angularVel += -sign * Math.min(1.2, impactSpeed * 0.045);
      racer.speed = racer.vx * Math.sin(racer.heading) + racer.vz * Math.cos(racer.heading);
    }
    racer.lateralOffset = clampedOffset;
  } else {
    racer.lateralOffset = proj.lateralOffset;
  }

  // Wrong-way detection
  const headingDotTrack = Math.sin(racer.heading) * proj.sample.tx + Math.cos(racer.heading) * proj.sample.tz;
  racer.wrongWay = headingDotTrack < -0.35 && absSpeed > 4;

  const driftIntensity = racer.isDrifting ? Math.min(1, Math.abs(lateralSpeed) / 13) : 0;
  return { wallHitIntensity, driftIntensity, nitroActive, driftBoostTriggered: false, landedHard };
}

/**
 * Safely recover a vehicle to its last validated safe track position (never grants race progress).
 */
export function recoverVehicleToTrack(racer: RacerState, track: BuiltTrack): void {
  const safeT = racer.lastSafeTrackT !== undefined ? racer.lastSafeTrackT : racer.trackT;
  const s = sampleTrackAt(track, safeT);
  racer.x = s.x;
  racer.y = s.y;
  racer.z = s.z;
  racer.prevX = s.x;
  racer.prevZ = s.z;
  racer.trackT = s.t;
  racer.heading = Math.atan2(s.tx, s.tz);
  racer.vx = s.tx * 8;
  racer.vy = 0;
  racer.vz = s.tz * 8;
  racer.speed = 8;
  racer.lateralSpeed = 0;
  racer.angularVel = 0;
  racer.lateralOffset = 0;
  racer.grounded = true;
  racer.airborneTime = 0;
  racer.isDrifting = false;
  racer.wrongWay = false;
}

/**
 * 2D Oriented Bounding Box (OBB) SAT test for vehicle-specific collision footprints (V5.0 Stage 2 Sec 13).
 * Returns minimum translation vector (nx, nz, overlap) from A toward B, or null if separated.
 */
function testObbOverlap(
  ax: number,
  az: number,
  aFwdX: number,
  aFwdZ: number,
  aHalfL: number,
  aHalfW: number,
  bx: number,
  bz: number,
  bFwdX: number,
  bFwdZ: number,
  bHalfL: number,
  bHalfW: number,
): { nx: number; nz: number; overlap: number } | null {
  const aRightX = -aFwdZ;
  const aRightZ = aFwdX;
  const bRightX = -bFwdZ;
  const bRightZ = bFwdX;

  const dx = bx - ax;
  const dz = bz - az;

  const axes: [number, number][] = [
    [aFwdX, aFwdZ],
    [aRightX, aRightZ],
    [bFwdX, bFwdZ],
    [bRightX, bRightZ],
  ];

  let minOverlap = Infinity;
  let bestNx = 0;
  let bestNz = 0;

  for (const [ux, uz] of axes) {
    const dist = Math.abs(dx * ux + dz * uz);
    const projA =
      Math.abs(aFwdX * ux + aFwdZ * uz) * aHalfL +
      Math.abs(aRightX * ux + aRightZ * uz) * aHalfW;
    const projB =
      Math.abs(bFwdX * ux + bFwdZ * uz) * bHalfL +
      Math.abs(bRightX * ux + bRightZ * uz) * bHalfW;
    const overlap = projA + projB - dist;
    if (overlap <= 0) return null;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = dx * ux + dz * uz >= 0 ? 1 : -1;
      bestNx = ux * sign;
      bestNz = uz * sign;
    }
  }

  return { nx: bestNx, nz: bestNz, overlap: minOverlap };
}

/**
 * Resolve vehicle-to-vehicle collisions using per-vehicle Oriented Bounding Boxes (OBB SAT),
 * mass-weighted momentum transfer, and realistic angular yaw impulse.
 */
export function resolveCarCollisions(racers: RacerState[]): { pairImpact: number; aId: string; bId: string; x: number; z: number }[] {
  const impacts: { pairImpact: number; aId: string; bId: string; x: number; z: number }[] = [];

  for (let i = 0; i < racers.length; i++) {
    const a = racers[i];
    if (a.destroyed || a.eliminated) continue;
    const vehA = getVehicleById(a.vehicleId);
    const aHalfL = vehA.dimensions.length * 0.49;
    const aHalfW = vehA.dimensions.width * 0.49;
    const aFwdX = Math.sin(a.heading);
    const aFwdZ = Math.cos(a.heading);

    for (let j = i + 1; j < racers.length; j++) {
      const b = racers[j];
      if (b.destroyed || b.eliminated) continue;

      // Broad-phase radius rejection
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const vehB = getVehicleById(b.vehicleId);
      const broadR = (vehA.dimensions.length + vehB.dimensions.length) * 0.6;
      if (dx * dx + dz * dz > broadR * broadR) continue;

      const bHalfL = vehB.dimensions.length * 0.49;
      const bHalfW = vehB.dimensions.width * 0.49;
      const bFwdX = Math.sin(b.heading);
      const bFwdZ = Math.cos(b.heading);

      // Narrow-phase OBB SAT
      const hit = testObbOverlap(
        a.x,
        a.z,
        aFwdX,
        aFwdZ,
        aHalfL,
        aHalfW,
        b.x,
        b.z,
        bFwdX,
        bFwdZ,
        bHalfL,
        bHalfW,
      );
      if (!hit) continue;

      const { nx, nz, overlap } = hit;
      const wa = vehA.stats.weight;
      const wb = vehB.stats.weight;
      const totalW = wa + wb;
      const ratioA = wb / totalW;
      const ratioB = wa / totalW;

      // Bounded positional separation
      const sep = Math.min(overlap, 1.2);
      a.x -= nx * sep * ratioA;
      a.z -= nz * sep * ratioA;
      b.x += nx * sep * ratioB;
      b.z += nz * sep * ratioB;

      const rvx = b.vx - a.vx;
      const rvz = b.vz - a.vz;
      const velAlongNormal = rvx * nx + rvz * nz;

      if (velAlongNormal < 0) {
        const restitution = 0.42;
        const impulse = -(1 + restitution) * velAlongNormal;
        a.vx -= nx * impulse * ratioA;
        a.vz -= nz * impulse * ratioA;
        b.vx += nx * impulse * ratioB;
        b.vz += nz * impulse * ratioB;

        // Subtle angular yaw impulse on off-center / side impacts
        const contactX = (a.x + b.x) * 0.5;
        const contactZ = (a.z + b.z) * 0.5;
        const torqueA = (contactX - a.x) * (-nz) - (contactZ - a.z) * (-nx);
        const torqueB = (contactX - b.x) * nz - (contactZ - b.z) * nx;
        a.angularVel += Math.max(-0.9, Math.min(0.9, torqueA * impulse * 0.012 * ratioA));
        b.angularVel += Math.max(-0.9, Math.min(0.9, torqueB * impulse * 0.012 * ratioB));

        const impactStrength = Math.min(1, Math.abs(velAlongNormal) / 26);
        if (impactStrength > 0.14) {
          impacts.push({
            pairImpact: impactStrength,
            aId: a.id,
            bId: b.id,
            x: contactX,
            z: contactZ,
          });
        }
      }
    }
  }
  return impacts;
}
