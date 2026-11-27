import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChaseCameraController } from '../../src/engine/camera/ChaseCamera';
import { buildTrack, getSpawnGridTransform, sampleTrackAt } from '../../src/game/trackMath';
import { stepVehiclePhysics } from '../../src/game/physics';
import { VEHICLES, getVehicleById } from '../../src/game/vehicles';
import { computeAiInput, AI_DRIVER_NAMES } from '../../src/game/ai';
import type { ControlInput, RacerState } from '../../src/game/types';
import {
  validateCreateRoomPayload,
  validatePlayerInput,
  validatePowerUpType,
} from '../protocol/validation';
import { RaceSimulation, createIdleControlInput } from './RaceSimulation';

function createTestRacer(vehicleId = 'street_falcon', track = buildTrack('neon_city')): RacerState {
  const spawn = getSpawnGridTransform(track, 0);
  const car = getVehicleById(vehicleId);
  return {
    id: 'tester',
    name: 'TESTER',
    isPlayer: true,
    isRemote: false,
    vehicleId,
    customization: { ...car.defaultCustomization },
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vz: 0,
    heading: spawn.heading,
    angularVel: 0,
    speed: 0,
    lateralSpeed: 0,
    steerAngle: 0,
    wheelSpin: 0,
    bodyPitch: 0,
    bodyRoll: 0,
    isDrifting: false,
    driftTime: 0,
    nitroTimer: 0,
    nitroEnergy: 45,
    shieldTimer: 0,
    shockSlowTimer: 0,
    stunTimer: 0,
    spawnProtectTimer: 0,
    hitFlashTimer: 0,
    hp: car.stats.durability,
    maxHp: car.stats.durability,
    maxHealthBlocks: car.stats.maxHealthBlocks,
    shieldHp: 0,
    airBrakeBoostTimer: 0,
    comboCount: 0,
    comboTimer: 0,
    destroyed: false,
    respawnTimer: 0,
    inventory: [null, null, null],
    activeSlot: 0,
    rearFireMode: false,
    boltCooldown: 0,
    trackT: spawn.trackT,
    lateralOffset: spawn.lateralOffset,
    lap: 1,
    nextCheckpoint: 0,
    passedCheckpoints: 0,
    totalProgress: spawn.trackT - 1,
    position: 1,
    finished: false,
    finishTime: 0,
    lapStartTime: 0,
    bestLapTime: 0,
    wrongWay: false,
    eliminated: false,
    hitsLanded: 0,
    takedowns: 0,
    powerUpsUsed: 0,
    blocksLanded: 0,
    damageDealt: 0,
    raceFans: 0,
    isDrafting: false,
    aiLaneOffset: 0,
    aiLaneTimer: 1,
    aiDecisionTimer: 2,
    aiAggression: 0.5,
    vy: 0,
    grounded: true,
    airborneTime: 0,
    suspCompression: [0, 0, 0, 0],
    lastSafeTrackT: spawn.trackT,
  };
}

// =========================================================================
// 1. CAMERA UNIT TESTS (V6.0 Section 8 — Rear-View Bug Fix & Raycast Safety)
// =========================================================================

test('ChaseCameraController rear-view places camera AHEAD of car looking BACKWARD (fixes double-negative bug)', () => {
  const track = buildTrack('neon_city');
  const racer = createTestRacer('street_falcon', track);
  const s = sampleTrackAt(track, 0.05);
  racer.x = s.x;
  racer.y = s.y;
  racer.z = s.z;
  racer.heading = Math.atan2(s.tx, s.tz);
  racer.speed = 45;

  const carFwdX = Math.sin(racer.heading);
  const carFwdZ = Math.cos(racer.heading);

  const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.25, 1400);
  const ctrl = new ChaseCameraController();
  ctrl.reset(racer);

  // Normal forward chase camera should sit BEHIND car (dot < 0) and look AHEAD (dot > 0)
  for (let i = 0; i < 30; i++) {
    ctrl.update(cam, racer, track, 'near', false, false, 1 / 60);
  }
  const normalOffsetDot = (ctrl.currentPos.x - racer.x) * carFwdX + (ctrl.currentPos.z - racer.z) * carFwdZ;
  const normalLookDot = (ctrl.currentLook.x - racer.x) * carFwdX + (ctrl.currentLook.z - racer.z) * carFwdZ;
  assert.ok(normalOffsetDot < -4.0, `Normal chase cam should be behind car, got dot=${normalOffsetDot.toFixed(2)}`);
  assert.ok(normalLookDot > 8.0, `Normal chase cam should look ahead of car, got dot=${normalLookDot.toFixed(2)}`);

  // Rear-view camera MUST sit AHEAD of car (dot > +4m) and look BACKWARD toward pursuers (dot < -10m)
  ctrl.update(cam, racer, track, 'near', true, false, 1 / 60);
  const rearOffsetDot = (ctrl.currentPos.x - racer.x) * carFwdX + (ctrl.currentPos.z - racer.z) * carFwdZ;
  const rearLookDot = (ctrl.currentLook.x - racer.x) * carFwdX + (ctrl.currentLook.z - racer.z) * carFwdZ;
  assert.ok(rearOffsetDot > 3.5, `Rear-view cam MUST be ahead of car, got dot=${rearOffsetDot.toFixed(2)}`);
  assert.ok(rearLookDot < -10.0, `Rear-view cam MUST look backward toward pursuers, got dot=${rearLookDot.toFixed(2)}`);
});

test('ChaseCameraController modes (near/far/hood), Nitro FOV expansion, and raycast wall collision pull-in', () => {
  const track = buildTrack('neon_city');
  const racer = createTestRacer('phantom_x', track);
  const s = sampleTrackAt(track, 0.02);
  racer.x = s.x;
  racer.y = s.y;
  racer.z = s.z;
  racer.heading = Math.atan2(s.tx, s.tz);
  racer.speed = 65;

  const cam = new THREE.PerspectiveCamera(62, 16 / 9, 0.25, 1400);
  const ctrl = new ChaseCameraController();
  ctrl.reset(racer);

  // Near vs Far distance check
  for (let i = 0; i < 60; i++) ctrl.update(cam, racer, track, 'near', false, false, 1 / 60);
  const nearDist = Math.hypot(ctrl.currentPos.x - racer.x, ctrl.currentPos.z - racer.z);

  for (let i = 0; i < 90; i++) ctrl.update(cam, racer, track, 'far', false, false, 1 / 60);
  const farDist = Math.hypot(ctrl.currentPos.x - racer.x, ctrl.currentPos.z - racer.z);
  assert.ok(farDist > nearDist + 1.0, `Far cam (${farDist.toFixed(2)}m) should sit farther back than near cam (${nearDist.toFixed(2)}m)`);

  // Hood cam stays near vehicle hood
  for (let i = 0; i < 60; i++) ctrl.update(cam, racer, track, 'hood', false, false, 1 / 60);
  const hoodDist = Math.hypot(ctrl.currentPos.x - racer.x, ctrl.currentPos.z - racer.z);
  assert.ok(hoodDist < 2.0, `Hood cam should sit on hood (<2m), got ${hoodDist.toFixed(2)}m`);

  // Nitro FOV widens dynamically relative to settled near-mode baseline
  for (let i = 0; i < 60; i++) ctrl.update(cam, racer, track, 'near', false, false, 1 / 60);
  const baseFov = cam.fov;
  racer.nitroTimer = 2.0;
  for (let i = 0; i < 45; i++) ctrl.update(cam, racer, track, 'near', false, false, 1 / 60);
  assert.ok(cam.fov > baseFov + 4.0, `Nitro should expand camera FOV (${baseFov.toFixed(1)} -> ${cam.fov.toFixed(1)})`);

  // Raycast collision avoidance pulls camera in front of an obstructing wall mesh placed 3m behind car
  const wallGeo = new THREE.BoxGeometry(10, 6, 0.5);
  const wallMat = new THREE.MeshBasicMaterial();
  const wall = new THREE.Mesh(wallGeo, wallMat);
  const backX = -Math.sin(racer.heading);
  const backZ = -Math.cos(racer.heading);
  wall.position.set(racer.x + backX * 3.2, racer.y + 2.0, racer.z + backZ * 3.2);
  wall.rotation.y = racer.heading;
  wall.updateMatrixWorld(true);

  for (let i = 0; i < 40; i++) {
    ctrl.update(cam, racer, track, 'near', false, false, 1 / 60, [wall]);
  }
  const pulledDist = Math.hypot(ctrl.currentPos.x - racer.x, ctrl.currentPos.z - racer.z);
  assert.ok(pulledDist < 3.6, `Camera should pull forward in front of wall at 3.2m, got ${pulledDist.toFixed(2)}m`);

  wallGeo.dispose();
  wallMat.dispose();
});

// =========================================================================
// 2. PER-VEHICLE PHYSICS TELEMETRY MEASUREMENTS (V6.0 Section 9)
// =========================================================================

test('All 5 vehicles exhibit distinct measurable acceleration, top speed, braking distance, and suspension stability', () => {
  const track = buildTrack('neon_city');
  const results: Record<string, { t0to100: number; maxSpeedKmh: number; brakeDistM: number }> = {};

  for (const car of VEHICLES) {
    const racer = createTestRacer(car.id, track);
    const startSample = sampleTrackAt(track, 0.0);
    racer.x = startSample.x;
    racer.y = startSample.y;
    racer.z = startSample.z;
    racer.heading = Math.atan2(startSample.tx, startSample.tz);
    racer.trackT = 0.0;

    let t0to100 = -1;
    let maxSpeedMs = 0;
    const dt = 1 / 60;

    // 18 seconds of full throttle with track-centerline steering
    for (let step = 0; step < 1080; step++) {
      const lookT = (racer.trackT + 22 / track.totalLength) % 1;
      const ahead = sampleTrackAt(track, lookT);
      const desiredYaw = Math.atan2(ahead.x - racer.x, ahead.z - racer.z);
      let yawErr = desiredYaw - racer.heading;
      while (yawErr > Math.PI) yawErr -= Math.PI * 2;
      while (yawErr < -Math.PI) yawErr += Math.PI * 2;
      const input: ControlInput = {
        ...createIdleControlInput(),
        throttle: 1,
        steer: Math.max(-1, Math.min(1, -yawErr * 2.2)),
      };
      stepVehiclePhysics(racer, input, track, dt, true);
      if (t0to100 < 0 && racer.speed * 3.6 >= 100) {
        t0to100 = Number(((step + 1) * dt).toFixed(2));
      }
      if (racer.speed > maxSpeedMs) maxSpeedMs = racer.speed;
      assert.ok(Number.isFinite(racer.x) && Number.isFinite(racer.y) && Number.isFinite(racer.z));
      assert.ok((racer.suspCompression ?? []).every((c) => Number.isFinite(c) && c >= -0.05 && c <= 1.2));
    }

    // Braking distance from 150 km/h (41.67 m/s) to < 5 km/h
    racer.speed = 41.67;
    racer.vx = Math.sin(racer.heading) * racer.speed;
    racer.vz = Math.cos(racer.heading) * racer.speed;
    let brakeDist = 0;
    for (let step = 0; step < 300 && racer.speed > 1.4; step++) {
      const prevX = racer.x;
      const prevZ = racer.z;
      stepVehiclePhysics(racer, { ...createIdleControlInput(), brake: 1 }, track, dt, true);
      brakeDist += Math.hypot(racer.x - prevX, racer.z - prevZ);
    }

    results[car.id] = {
      t0to100,
      maxSpeedKmh: Math.round(maxSpeedMs * 3.6),
      brakeDistM: Number(brakeDist.toFixed(1)),
    };

    assert.ok(t0to100 > 0.8 && t0to100 < 9.0, `${car.id} 0-100 km/h time out of range: ${t0to100}s`);
    assert.ok(maxSpeedMs * 3.6 >= 175, `${car.id} max speed too low: ${Math.round(maxSpeedMs * 3.6)} km/h`);
    assert.ok(brakeDist > 12 && brakeDist < 120, `${car.id} braking distance out of range: ${brakeDist.toFixed(1)}m`);
  }

  // Phantom X should reach higher top speed than Sand Runner
  assert.ok(
    results.phantom_x.maxSpeedKmh > results.sand_runner.maxSpeedKmh,
    `PHANTOM X (${results.phantom_x.maxSpeedKmh}) should be faster than SAND RUNNER (${results.sand_runner.maxSpeedKmh})`,
  );
  console.log('[Physics Telemetry V6.0]', JSON.stringify(results));
});

// =========================================================================
// 3. PROTOCOL VALIDATION & ATOMIC PICKUP EXCLUSIVITY (V6.0 Section 18)
// =========================================================================

test('Protocol validation strictly rejects unknown power-ups (never coerces to BOLT) and invalid inputs', () => {
  assert.equal(validatePowerUpType('SHUNT'), 'SHUNT');
  assert.equal(validatePowerUpType('NITRO'), 'NITRO');
  assert.equal(validatePowerUpType('INVALID_NUKE'), null);
  assert.equal(validatePowerUpType(''), null);
  assert.equal(validatePowerUpType(123), null);

  const badSeq = validatePlayerInput({ sequence: 5, throttle: 1, brake: 0, steering: 0 }, 5);
  assert.equal(badSeq.ok, false);

  const nanInput = validatePlayerInput({ sequence: 6, throttle: Number.NaN, brake: 0, steering: 0 }, 5);
  assert.equal(nanInput.ok, false);

  const badSlot = validatePlayerInput({ sequence: 6, throttle: 1, brake: 0, steering: 0, selectSlot: 9 }, 5);
  assert.equal(badSlot.ok, false);

  const goodInput = validatePlayerInput(
    { sequence: 6, throttle: 1.5, brake: -0.2, steering: -2, drift: true, firePowerUp: true, selectSlot: 1 },
    5,
  );
  assert.equal(goodInput.ok, true);
  if (goodInput.ok) {
    assert.equal(goodInput.input.throttle, 1);
    assert.equal(goodInput.input.brake, 0);
    assert.equal(goodInput.input.steering, -1);
    assert.equal(goodInput.input.selectSlot, 1);
  }

  const badRoom = validateCreateRoomPayload({ trackId: 'fake_track', mode: 'combat_race', laps: 3 });
  assert.equal(badRoom.ok, false);
});

test('Atomic single-owner pickup collection grants pickup to exactly one racer on simultaneous overlap', () => {
  const sim = new RaceSimulation({
    matchId: 'pickup_atomicity',
    trackId: 'neon_city',
    mode: 'combat_race',
    laps: 1,
    difficulty: 'normal',
    countdownSeconds: 0,
    seed: 42,
    participants: [
      { id: 'p1', name: 'P1', vehicleId: 'street_falcon', isAi: false },
      { id: 'p2', name: 'P2', vehicleId: 'night_viper', isAi: false },
    ],
  });

  const node = sim.pickups[0];
  assert.ok(node && node.active, 'Expected at least one active pickup node');

  // Place both racers directly on top of the exact same pickup node simultaneously
  for (const r of sim.racers) {
    r.x = node.x;
    r.y = node.y;
    r.z = node.z;
    r.inventory = [null, null, null];
  }

  const idle = new Map<string, ControlInput>([
    ['p1', createIdleControlInput()],
    ['p2', createIdleControlInput()],
  ]);
  sim.step(1 / 60, idle);

  const holders = sim.racers.filter((r) => r.inventory.some((s) => s !== null));
  assert.equal(holders.length, 1, 'Exactly ONE racer may collect an exclusive track pickup');
  assert.equal(node.active, false, 'Pickup node must immediately deactivate after collection');
});

// =========================================================================
// 4. FULL 3-LAP 8-RACER COMBAT RACE ACCEPTANCE TEST (V6.0 Section 11)
// =========================================================================

test('Full 3-lap 8-racer combat acceptance test completes reliably across 3 seeds on Neon City', () => {
  const seeds = [101, 202, 303];
  const summary: {
    seed: number;
    finishedCount: number;
    winnerTimeSec: number;
    driverLapSec: number;
    pickups: number;
    powerUpsUsed: number;
    collisions: number;
    wrecks: number;
    shieldBlocks: number;
  }[] = [];

  for (const seed of seeds) {
    const participants = [
      { id: 'driver_1', userId: 'u_driver', name: 'ACCEPT_DRIVER', vehicleId: 'street_falcon', isAi: false },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `ai_${i + 1}`,
        userId: null,
        name: AI_DRIVER_NAMES[i % AI_DRIVER_NAMES.length],
        vehicleId: VEHICLES[(i + 1) % VEHICLES.length].id,
        isAi: true,
      })),
    ];

    const sim = new RaceSimulation({
      matchId: `accept_${seed}`,
      trackId: 'neon_city',
      mode: 'combat_race',
      laps: 3,
      difficulty: 'normal',
      countdownSeconds: 0.2,
      seed,
      participants,
    });

    const dt = 1 / 60;
    const maxTicks = 60 * 270; // Up to 270 simulated seconds for all 8 racers to finish 3 laps
    const humanInputs = new Map<string, ControlInput>();
    let rngState = (seed ^ 0x5f3759df) >>> 0;
    const driverRng = (): number => {
      rngState = (rngState + 0x6d2b79f5) >>> 0;
      let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let tick = 0; tick < maxTicks; tick++) {
      const driver = sim.racers[0];
      // Drive the human slot with deterministic AI input so all 8 racers run full 3-lap combat racing
      const aiCtrl = computeAiInput(
        driver,
        sim.racers,
        sim.track,
        sim.pickups,
        sim.projectiles,
        sim.shockZones,
        'normal',
        dt,
        driverRng,
      );
      humanInputs.set('driver_1', aiCtrl);
      sim.step(dt, humanInputs);

      // Verify finite coordinates & track containment on every 30th tick
      if (tick % 30 === 0) {
        for (const r of sim.racers) {
          assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z), `NaN state for ${r.id}`);
          assert.ok(
            Math.abs(r.lateralOffset) <= sim.track.def.roadWidth * 0.85,
            `${r.id} escaped track bounds: offset=${r.lateralOffset.toFixed(2)}`,
          );
        }
      }

      if (sim.racers.every((r) => r.finished)) {
        break;
      }
    }

    const finishedCount = sim.racers.filter((r) => r.finished).length;
    assert.equal(finishedCount, 8, `Seed ${seed}: expected 8/8 racers to finish 3 laps, got ${finishedCount}/8`);

    const driver = sim.racers[0];
    const winner = sim.racers.find((r) => r.position === 1)!;
    assert.ok(winner.finishTime > 40 && winner.finishTime < 220, `Unrealistic 3-lap time: ${winner.finishTime.toFixed(1)}s`);
    assert.ok(sim.metrics.pickupsCollected >= 15, `Expected active pickup collection, got ${sim.metrics.pickupsCollected}`);
    assert.ok(sim.metrics.powerUpsUsed >= 10, `Expected active combat power-up usage, got ${sim.metrics.powerUpsUsed}`);
    assert.ok(sim.metrics.collisionCount >= 1, `Expected car-to-car collision events, got ${sim.metrics.collisionCount}`);

    // Verify standings are strictly unique positions 1..8
    const posSet = new Set(sim.racers.map((r) => r.position));
    assert.equal(posSet.size, 8);

    summary.push({
      seed,
      finishedCount,
      winnerTimeSec: Number(winner.finishTime.toFixed(1)),
      driverLapSec: Number((driver.finishTime / 3).toFixed(1)),
      pickups: sim.metrics.pickupsCollected,
      powerUpsUsed: sim.metrics.powerUpsUsed,
      collisions: sim.metrics.collisionCount,
      wrecks: sim.metrics.wrecks,
      shieldBlocks: sim.metrics.shieldBlocks,
    });
  }

  console.log('[3-Lap 8-Racer Combat Acceptance V6.0]', JSON.stringify(summary));
});
