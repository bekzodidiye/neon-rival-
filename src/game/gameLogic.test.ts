import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrack,
  distanceToT,
  generateTrackPickups,
  getSpawnGridTransform,
  projectPointToTrack,
  sampleTrackAt,
  sampleTrackByDistance,
  sortRaceStandings,
  tToDistance,
  updateRacerCheckpoints,
} from './trackMath';
import { resolveCarCollisions, stepVehiclePhysics, recoverVehicleToTrack } from './physics';
import { computeAiInput } from './ai';
import {
  applyCombatDamage,
  applyRepairPowerUp,
  collectPowerUp,
  consumeActivePowerUp,
  cyclePowerUpSlot,
  discardPowerUpSlot,
  POWERUP_DEFS,
  POWERUP_TYPES,
} from './powerups';
import { calculateRaceRewards } from './progression';
import { VEHICLES } from './vehicles';
import {
  applyComboFans,
  COMBAT_RULES,
  resolveBargeInterceptions,
  resolveBoltVsShunt,
  resolveNitroAirBrake,
  resolveShieldAbsorption,
  resolveShockVsShield,
} from './combatResolver';
import { computeCameraMotionBlurParams } from '../engine/motionBlur';
import type { ControlInput, MineState, ProjectileState, RacerState } from './types';

function makeTestRacer(id: string, track = buildTrack('neon_city'), gridSlot = 0, vehicleId = VEHICLES[0].id): RacerState {
  const spawn = getSpawnGridTransform(track, gridSlot);
  const car = VEHICLES.find((v) => v.id === vehicleId) ?? VEHICLES[0];
  return {
    id,
    name: id,
    isPlayer: id === 'p1',
    isRemote: false,
    vehicleId: car.id,
    customization: { ...car.defaultCustomization },
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vz: 0,
    vy: 0,
    grounded: true,
    airborneTime: 0,
    suspCompression: [0, 0, 0, 0],
    lastSafeTrackT: spawn.trackT,
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
    nitroEnergy: 50,
    shieldTimer: 0,
    shockSlowTimer: 0,
    stunTimer: 0,
    spawnProtectTimer: 0,
    hitFlashTimer: 0,
    hp: car.stats.durability,
    maxHp: car.stats.durability,
    maxHealthBlocks: car.stats.maxHealthBlocks,
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
    position: gridSlot + 1,
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
    aiLaneOffset: spawn.lateralOffset,
    aiLaneTimer: 1,
    aiDecisionTimer: 1,
    aiAggression: 0.5,
  };
}

function idleInput(overrides: Partial<ControlInput> = {}): ControlInput {
  return {
    throttle: 0,
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
    ...overrides,
  };
}

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

test('Neon City track spline builds continuous 2.5km-4km closed loop with elevation, arc-length LUT, and pickups', () => {
  const track = buildTrack('neon_city');
  assert.ok(track.totalLength >= 2000 && track.totalLength <= 4500, `Expected ~2.5-4km, got ${track.totalLength}`);
  const s0 = sampleTrackAt(track, 0);
  const s1 = sampleTrackAt(track, 1);
  assert.ok(Math.hypot(s0.x - s1.x, s0.z - s1.z) < 0.01, 'Track loop must close seamlessly');

  // Verify V5.0 urban elevation profile has real overpass variation (> 3m)
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of track.samples) {
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  assert.ok(maxY - minY >= 3.0, `Neon City should feature real overpass elevation changes, got ${(maxY - minY).toFixed(2)}m`);

  // Verify arc-length distance LUT round-trip accuracy
  const testDist = track.totalLength * 0.37;
  const tFromDist = distanceToT(track, testDist);
  const distBack = tToDistance(track, tFromDist);
  assert.ok(Math.abs(distBack - testDist) < 2.5, `Arc-length LUT round-trip error too high: ${Math.abs(distBack - testDist)}`);
  const byDist = sampleTrackByDistance(track, testDist);
  const byT = sampleTrackAt(track, tFromDist);
  assert.ok(Math.hypot(byDist.x - byT.x, byDist.z - byT.z) < 1.0, 'sampleTrackByDistance must match sampleTrackAt');

  const pickups = generateTrackPickups(track);
  assert.ok(pickups.length >= 24, 'Should populate track with power-up pickups');
  const seenTypes = new Set(pickups.map((p) => p.type));
  assert.equal(seenTypes.size, POWERUP_TYPES.length, 'All 8 power-up types must appear on track');
});

test('V5.0 Realistic Street Falcon tuning, pure Blur Nitro rules (no passive drift Nitro), braking, and barriers', () => {
  const track = buildTrack('neon_city');
  const racer = makeTestRacer('p1', track);
  const baseTop = VEHICLES[0].stats.topSpeed; // 62 m/s (~223 km/h)
  assert.ok(baseTop * 3.6 >= 200 && baseTop * 3.6 <= 235, `Street Falcon top speed should be ~200-235 km/h, got ${(baseTop * 3.6).toFixed(1)}`);

  // Measure realistic 0 -> 100 km/h (27.78 m/s) acceleration time on straight road
  racer.trackT = 0.005;
  recoverVehicleToTrack(racer, track);
  let timeTo100 = -1;
  for (let i = 1; i <= 600; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1 }), track, 1 / 60, true);
    if (timeTo100 < 0 && racer.speed >= 27.78) {
      timeTo100 = i / 60;
    }
  }
  assert.ok(
    timeTo100 >= 3.5 && timeTo100 <= 8.5,
    `Street Falcon 0-100 km/h should be realistic (~3.5-8.5s), got ${timeTo100.toFixed(2)}s`,
  );

  // Confirm passive useNitro input does NOT activate Nitro without a picked-up NITRO power-up
  racer.nitroTimer = 0;
  racer.nitroEnergy = 100;
  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1, useNitro: true }), track, 1 / 60, true);
  }
  assert.equal(racer.nitroTimer, 0, 'Passive drift-charged Nitro must NOT activate in default Blur Powered Racing mode');

  // Verify braking stops vehicle predictably
  for (let i = 0; i < 180; i++) {
    stepVehiclePhysics(racer, idleInput({ brake: 1 }), track, 1 / 60, true);
  }
  assert.ok(racer.speed < 5, `Hard braking should halt vehicle predictably, got ${racer.speed.toFixed(2)} m/s`);

  // Verify NITRO power-up timer boosts speed well above base top speed
  racer.trackT = 0.005;
  recoverVehicleToTrack(racer, track);
  racer.speed = baseTop * 0.85;
  racer.vx = Math.sin(racer.heading) * racer.speed;
  racer.vz = Math.cos(racer.heading) * racer.speed;
  racer.nitroTimer = 3.0;
  for (let i = 0; i < 110; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1 }), track, 1 / 60, true);
  }
  assert.ok(racer.speed > baseTop * 1.12, `Nitro should boost speed above base top speed (${racer.speed.toFixed(1)} vs ${baseTop})`);

  // Verify Blur Slipstream drafting exceeds base top speed without Nitro
  racer.trackT = 0.005;
  recoverVehicleToTrack(racer, track);
  racer.nitroTimer = 0;
  racer.isDrafting = true;
  racer.speed = baseTop * 0.96;
  racer.vx = Math.sin(racer.heading) * racer.speed;
  racer.vz = Math.cos(racer.heading) * racer.speed;
  for (let i = 0; i < 110; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1 }), track, 1 / 60, true);
  }
  assert.ok(racer.speed > baseTop * 1.02, `Slipstream should exceed base top speed (${racer.speed.toFixed(1)} vs ${baseTop})`);
  assert.equal(POWERUP_DEFS.NITRO.supportsRearFire, true, 'NITRO must support Blur rear-fire Air-Brake');

  // Initiate drift while turning hard
  racer.isDrafting = false;
  racer.nitroTimer = 0;
  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1, steer: 1, drift: true }), track, 1 / 60, true);
  }
  assert.equal(racer.isDrifting, true, 'Drift input at high speed should engage drift state');

  // Verify barrier containment keeps lateralOffset within track half-width
  const proj = projectPointToTrack(track, racer.x, racer.z, racer.trackT);
  assert.ok(Math.abs(proj.lateralOffset) <= track.def.roadWidth * 0.5, 'Car must stay inside road barriers');

  // Verify recovery resets car to centerline facing forward
  recoverVehicleToTrack(racer, track);
  assert.equal(racer.lateralOffset, 0);
  assert.equal(racer.wrongWay, false);
});

test('V5.0 Frame-rate independence: 30Hz, 60Hz, and 120Hz produce consistent 3-second straight acceleration', () => {
  const track = buildTrack('neon_city');
  const runAtHz = (hz: number) => {
    const r = makeTestRacer('p1', track);
    r.trackT = 0.005;
    recoverVehicleToTrack(r, track);
    const startX = r.x;
    const startZ = r.z;
    const dt = 1 / hz;
    const steps = hz * 3;
    for (let i = 0; i < steps; i++) {
      stepVehiclePhysics(r, idleInput({ throttle: 1 }), track, dt, true);
    }
    return { speed: r.speed, dist: Math.hypot(r.x - startX, r.z - startZ) };
  };

  const r30 = runAtHz(30);
  const r60 = runAtHz(60);
  const r120 = runAtHz(120);

  assert.ok(Math.abs(r30.speed - r60.speed) < 1.2, `30Hz vs 60Hz speed diverged: ${r30.speed.toFixed(2)} vs ${r60.speed.toFixed(2)}`);
  assert.ok(Math.abs(r120.speed - r60.speed) < 0.8, `120Hz vs 60Hz speed diverged: ${r120.speed.toFixed(2)} vs ${r60.speed.toFixed(2)}`);
  assert.ok(Math.abs(r30.dist - r120.dist) < 4.5, `30Hz vs 120Hz distance diverged: ${r30.dist.toFixed(2)} vs ${r120.dist.toFixed(2)}`);
});

test('V5.0 4-wheel suspension dynamics settle smoothly under gravity and track elevation without snapping', () => {
  const track = buildTrack('neon_city');
  const racer = makeTestRacer('p1', track);
  racer.trackT = 0.02;
  recoverVehicleToTrack(racer, track);
  const groundY = sampleTrackAt(track, racer.trackT).y;

  // Drop car from 1.2m above road surface -> must fall smoothly under gravity, NOT snap in 1 frame
  racer.y = groundY + 1.2;
  racer.vy = 0;
  stepVehiclePhysics(racer, idleInput(), track, 1 / 60, true);
  assert.ok(racer.y > groundY + 0.8, `Suspension must not snap y directly to ground in 1 frame (y=${racer.y.toFixed(3)})`);
  assert.equal(racer.grounded, false, 'Car 1.2m above track should be airborne');

  // After 1.5 seconds of settling, car should rest cleanly on suspension springs
  for (let i = 0; i < 90; i++) {
    stepVehiclePhysics(racer, idleInput(), track, 1 / 60, true);
  }
  assert.equal(racer.grounded, true, 'Car must settle grounded on track surface');
  assert.ok(Math.abs(racer.y - groundY) < 0.28, `Settled ride height should stay near road surface (${racer.y.toFixed(3)} vs ${groundY.toFixed(3)})`);
  assert.ok(racer.suspCompression && racer.suspCompression.every((c) => c >= 0 && c <= 1), 'All 4 wheel suspension compressions must stay in [0,1]');
});

test('V5.0 Vehicle-specific OBB SAT collisions separate overlapping vehicles and exchange impulse', () => {
  const track = buildTrack('neon_city');
  const falcon = makeTestRacer('p1', track, 0, 'street_falcon');
  const viper = makeTestRacer('p2', track, 1, 'night_viper');

  // Place Falcon and Viper overlapping slightly side-by-side at same track point
  const s = sampleTrackAt(track, 0.02);
  const h = Math.atan2(s.tx, s.tz);
  falcon.x = s.x;
  falcon.z = s.z;
  falcon.heading = h;
  falcon.vx = Math.sin(h) * 40;
  falcon.vz = Math.cos(h) * 40;
  falcon.speed = 40;

  viper.x = s.x + s.rx * 1.1; // narrower than combined half-widths (~2.02m) -> overlap!
  viper.z = s.z + s.rz * 1.1;
  viper.heading = h;
  viper.vx = Math.sin(h) * 40 - s.rx * 6;
  viper.vz = Math.cos(h) * 40 - s.rz * 6;
  viper.speed = 40;

  const beforeDist = Math.hypot(viper.x - falcon.x, viper.z - falcon.z);
  const impacts = resolveCarCollisions([falcon, viper]);
  const afterDist = Math.hypot(viper.x - falcon.x, viper.z - falcon.z);

  assert.equal(impacts.length, 1, 'Overlapping OBBs must trigger collision response');
  assert.ok(afterDist > beforeDist + 0.5, `OBB SAT must separate overlapping hulls (${beforeDist.toFixed(2)} -> ${afterDist.toFixed(2)})`);
});

test('Power-up 3-slot inventory, Bolt 3-shot ammo, Shield block, Damage, and Repair work accurately', () => {
  const track = buildTrack('neon_city');
  const attacker = makeTestRacer('p1', track);
  const defender = makeTestRacer('p2', track);

  const c1 = collectPowerUp(attacker.inventory, attacker.activeSlot, 'BOLT');
  assert.equal(c1.collected, true);
  attacker.activeSlot = c1.newActiveSlot;
  collectPowerUp(attacker.inventory, attacker.activeSlot, 'SHIELD');
  collectPowerUp(attacker.inventory, attacker.activeSlot, 'REPAIR');
  const c4 = collectPowerUp(attacker.inventory, attacker.activeSlot, 'SHUNT');
  assert.equal(c4.collected, false, 'Inventory must cap at 3 slots');

  assert.equal(attacker.inventory[0]?.ammo, 3);
  const f1 = consumeActivePowerUp(attacker.inventory, 0);
  assert.equal(f1.firedType, 'BOLT');
  assert.equal(attacker.inventory[0]?.ammo, 2);
  consumeActivePowerUp(attacker.inventory, 0);
  consumeActivePowerUp(attacker.inventory, 0);
  assert.equal(attacker.inventory[0], null, 'Bolt slot clears after 3rd shot');

  const nextSlot = cyclePowerUpSlot(attacker.inventory, 0);
  assert.equal(nextSlot, 1);
  const disc = discardPowerUpSlot(attacker.inventory, 1);
  assert.equal(disc.discarded, true);
  assert.equal(attacker.inventory[1], null);

  defender.shieldTimer = 4.0;
  const blocked = applyCombatDamage(defender, 25, attacker);
  assert.equal(blocked.blockedByShield, true);
  assert.equal(defender.hp, 120);
  assert.equal(defender.blocksLanded, 1);

  defender.shieldTimer = 0;
  const hit1 = applyCombatDamage(defender, 60, attacker);
  assert.equal(hit1.appliedDamage, 60);
  assert.equal(defender.hp, 60);
  assert.equal(attacker.hitsLanded, 1);

  const healed = applyRepairPowerUp(defender);
  assert.equal(healed, 60);
  assert.equal(defender.hp, 120);

  const lethal = applyCombatDamage(defender, 140, attacker);
  assert.equal(lethal.destroyedNow, true);
  assert.equal(defender.destroyed, true);
  assert.equal(attacker.takedowns, 1);
});

test('V5.0 Swept checkpoints reject reverse finish crossing, lap skipping, and teleports while counting valid laps', () => {
  const track = buildTrack('neon_city');
  const r1 = makeTestRacer('p1', track);
  const r2 = makeTestRacer('p2', track);

  // 1. Reverse crossing across finish line (t = 0.01 -> t = 0.99) must NOT advance lap or checkpoints
  const sAhead = sampleTrackAt(track, 0.008);
  const sBehind = sampleTrackAt(track, 0.992);
  r1.prevX = sAhead.x;
  r1.prevZ = sAhead.z;
  r1.x = sBehind.x;
  r1.z = sBehind.z;
  r1.heading = Math.atan2(-sAhead.tx, -sAhead.tz);
  const revRes = updateRacerCheckpoints(r1, track, 0.992, 2, 5);
  assert.equal(revRes.lapCompleted, false, 'Reverse finish-line crossing must not count a lap');
  assert.equal(r1.passedCheckpoints, 0);

  // 2. Teleport jump directly to checkpoint 8 must NOT advance lap or checkpoints
  const sJump = sampleTrackAt(track, 0.72);
  r1.prevX = sBehind.x;
  r1.prevZ = sBehind.z;
  r1.x = sJump.x;
  r1.z = sJump.z;
  updateRacerCheckpoints(r1, track, 0.72, 2, 10);
  assert.equal(r1.lap, 1);
  assert.equal(r1.passedCheckpoints, 0);

  // 3. Walk r1 sequentially forward through all 12 swept checkpoint gates for 2 laps
  r1.prevX = undefined;
  r1.prevZ = undefined;
  let finished = false;
  for (let lap = 0; lap < 2; lap++) {
    for (let cp = 0; cp < track.checkpointCount; cp++) {
      const gate = track.checkpoints[cp];
      const pBefore = sampleTrackByDistance(track, gate.cumDist - 3.5);
      const pAfter = sampleTrackByDistance(track, gate.cumDist + 3.5);
      r1.prevX = pBefore.x;
      r1.prevZ = pBefore.z;
      r1.x = pAfter.x;
      r1.z = pAfter.z;
      r1.heading = Math.atan2(pAfter.tx, pAfter.tz);
      const res = updateRacerCheckpoints(r1, track, pAfter.t, 2, 10 + lap * 45 + cp * 3);
      if (res.raceFinished) finished = true;
    }
  }
  // Cross start/finish gate (cp 0) forward to complete lap 2
  const finGate = track.checkpoints[0];
  const pFinBefore = sampleTrackByDistance(track, finGate.cumDist - 3.5);
  const pFinAfter = sampleTrackByDistance(track, finGate.cumDist + 3.5);
  r1.prevX = pFinBefore.x;
  r1.prevZ = pFinBefore.z;
  r1.x = pFinAfter.x;
  r1.z = pFinAfter.z;
  r1.heading = Math.atan2(pFinAfter.tx, pFinAfter.tz);
  const finalCross = updateRacerCheckpoints(r1, track, pFinAfter.t, 2, 105);
  assert.equal(finished || finalCross.raceFinished, true, 'Completing all sequential swept checkpoints for 2 laps finishes race');
  assert.equal(r1.finished, true);

  const standings = sortRaceStandings([r2, r1]);
  assert.equal(standings[0].id, 'p1');
  assert.equal(standings[0].position, 1);
  assert.equal(standings[1].position, 2);

  const rewards = calculateRaceRewards({
    position: 1,
    totalRacers: 8,
    hitsLanded: 4,
    takedowns: 1,
    blocksLanded: 1,
    difficulty: 'normal',
    currentLevel: 1,
    currentXp: 0,
  });
  assert.ok(rewards.credits > 2000);
  assert.ok(rewards.xp > 300);
});

test('V5.0 Full 7-bot simulated race on Neon City completes cleanly with deterministic seeded PRNG', () => {
  const track = buildTrack('neon_city');
  const pickups = generateTrackPickups(track);
  const rng = createSeededRng(20261128);
  const bots: RacerState[] = Array.from({ length: 7 }, (_, i) =>
    makeTestRacer(`bot_${i + 1}`, track, i, VEHICLES[i % VEHICLES.length].id),
  );

  const dt = 1 / 60;
  const maxSteps = 60 * 115; // up to 115 simulated seconds for 1 full 3.1km lap
  let simTime = 0;

  for (let step = 0; step < maxSteps; step++) {
    simTime += dt;
    let allFinished = true;
    for (const bot of bots) {
      if (bot.finished) continue;
      allFinished = false;
      const aiInput = computeAiInput(bot, bots, track, pickups, [], [], 'normal', dt, rng);
      stepVehiclePhysics(bot, aiInput, track, dt, true);
      updateRacerCheckpoints(bot, track, bot.trackT, 1, simTime);
    }
    resolveCarCollisions(bots);
    if (allFinished) break;
  }

  const finishedCount = bots.filter((b) => b.finished).length;
  assert.equal(finishedCount, 7, `All 7 bots must finish 1 full Neon City lap cleanly (finished ${finishedCount}/7)`);
  for (const bot of bots) {
    assert.ok(Number.isFinite(bot.x) && Number.isFinite(bot.y) && Number.isFinite(bot.z), `${bot.id} coordinates must remain finite`);
    assert.ok(bot.finishTime > 30 && bot.finishTime < 115, `${bot.id} lap time should be realistic (${bot.finishTime.toFixed(1)}s)`);
  }
});

test('Camera-based motion blur scales with speed, Nitro, Slipstream, and camera yaw velocity', () => {
  const menuBlur = computeCameraMotionBlurParams({
    mode: 'title',
    enabled: true,
    speedMs: 85,
    topSpeedMs: 80,
    lateralSpeedMs: 0,
    nitroActive: true,
    isDrafting: false,
    cameraMode: 'near',
    cameraYawDelta: 0.05,
    dt: 1 / 60,
  });
  assert.equal(menuBlur.intensity, 0);
  assert.equal(menuBlur.radialStrength, 0);

  const disabledBlur = computeCameraMotionBlurParams({
    mode: 'playing',
    enabled: false,
    speedMs: 85,
    topSpeedMs: 80,
    lateralSpeedMs: 0,
    nitroActive: true,
    isDrafting: true,
    cameraMode: 'near',
    cameraYawDelta: 0.05,
    dt: 1 / 60,
  });
  assert.equal(disabledBlur.intensity, 0);

  const slowBlur = computeCameraMotionBlurParams({
    mode: 'playing',
    enabled: true,
    speedMs: 22,
    topSpeedMs: 80,
    lateralSpeedMs: 0,
    nitroActive: false,
    isDrafting: false,
    cameraMode: 'near',
    cameraYawDelta: 0,
    dt: 1 / 60,
  });
  assert.equal(slowBlur.intensity, 0);

  const fastBlur = computeCameraMotionBlurParams({
    mode: 'playing',
    enabled: true,
    speedMs: 74,
    topSpeedMs: 80,
    lateralSpeedMs: 0,
    nitroActive: false,
    isDrafting: false,
    cameraMode: 'near',
    cameraYawDelta: 0,
    dt: 1 / 60,
  });
  const nitroBlur = computeCameraMotionBlurParams({
    mode: 'playing',
    enabled: true,
    speedMs: 96,
    topSpeedMs: 80,
    lateralSpeedMs: 0,
    nitroActive: true,
    isDrafting: true,
    cameraMode: 'near',
    cameraYawDelta: 0,
    dt: 1 / 60,
  });
  assert.ok(fastBlur.intensity > 0.25, `Expected noticeable high-speed blur, got ${fastBlur.intensity}`);
  assert.ok(nitroBlur.intensity > fastBlur.intensity, 'Nitro + Slipstream must intensify motion blur');
  assert.ok(nitroBlur.chromaticAmount > fastBlur.chromaticAmount, 'Nitro must boost peripheral chromatic aberration');

  const turningBlur = computeCameraMotionBlurParams({
    mode: 'playing',
    enabled: true,
    speedMs: 68,
    topSpeedMs: 80,
    lateralSpeedMs: 12,
    nitroActive: false,
    isDrafting: false,
    cameraMode: 'near',
    cameraYawDelta: 0.035,
    dt: 1 / 60,
  });
  assert.ok(turningBlur.camVelocityUv.x > 0.01, `Camera yaw should create positive horizontal velocity blur, got ${turningBlur.camVelocityUv.x}`);
  assert.ok(turningBlur.vanishingUv.x > 0.5, 'Turning camera should shift radial vanishing center');
});

test('V3.0 Segmented health & 4-block Repair cap restores max 80 HP on 8-block vehicle', () => {
  const track = buildTrack('neon_city');
  const heavy = makeTestRacer('heavy', track, 0, 'night_viper');
  const viper = VEHICLES.find((v) => v.id === 'night_viper')!;
  heavy.hp = 20;

  assert.equal(viper.stats.maxHealthBlocks, 8);
  assert.equal(viper.stats.durability, 160);

  const healed = applyRepairPowerUp(heavy);
  assert.equal(healed, 80, 'Repair must cap at 4 health blocks (80 HP)');
  assert.equal(heavy.hp, 100, 'HP should increase from 20 to 100 without full heal');

  const healed2 = applyRepairPowerUp(heavy);
  assert.equal(healed2, 60);
  assert.equal(heavy.hp, 160);
});

test('V3.0 Combat resolver handles 2-hit Bolt vs Shunt, Barge clearing mines/projectiles, Shield capacity, and Shock vs Shield', () => {
  const track = buildTrack('neon_city');
  const defender = makeTestRacer('p2', track);

  const shunt: ProjectileState = {
    id: 'shunt-1',
    type: 'SHUNT',
    ownerId: 'ai-1',
    targetId: 'p2',
    x: 10,
    y: 1,
    z: 10,
    vx: 0,
    vz: 100,
    speed: 100,
    life: 4,
    maxLife: 4,
    damage: 34,
    rearFired: false,
    health: COMBAT_RULES.SHUNT_INITIAL_HEALTH,
  };
  const firstHit = resolveBoltVsShunt(shunt);
  assert.equal(firstHit.weakened, true);
  assert.equal(firstHit.destroyed, false);
  assert.equal(firstHit.remainingHealth, 1);
  assert.ok(shunt.speed < 100, 'First Bolt hit must slow Shunt');

  const secondHit = resolveBoltVsShunt(shunt);
  assert.equal(secondHit.destroyed, true);
  assert.equal(shunt.life, 0);

  const projList: ProjectileState[] = [
    { id: 'e-shunt', type: 'SHUNT', ownerId: 'ai-1', targetId: 'p1', x: 4, y: 1, z: 0, vx: 0, vz: 50, speed: 50, life: 3, maxLife: 3, damage: 30, rearFired: false },
    { id: 'e-bolt', type: 'BOLT', ownerId: 'ai-2', targetId: null, x: 0, y: 1, z: 6, vx: 0, vz: 50, speed: 50, life: 2, maxLife: 2, damage: 15, rearFired: false },
    { id: 'own-bolt', type: 'BOLT', ownerId: 'p1', targetId: null, x: 2, y: 1, z: 0, vx: 0, vz: 50, speed: 50, life: 2, maxLife: 2, damage: 15, rearFired: false },
  ];
  const mineList: MineState[] = [
    { id: 'm1', ownerId: 'ai-1', x: 5, y: 0.5, z: 5, radius: 4, life: 20, armTimer: 0, damage: 36 },
    { id: 'm-far', ownerId: 'ai-1', x: 40, y: 0.5, z: 40, radius: 4, life: 20, armTimer: 0, damage: 36 },
  ];
  const bargeRes = resolveBargeInterceptions('p1', 0, 0, 12, projList, mineList);
  assert.equal(bargeRes.destroyedProjectiles.length, 2, 'Barge must destroy nearby enemy Shunt & Bolt');
  assert.equal(bargeRes.destroyedMines.length, 1, 'Barge must destroy nearby Mine');
  assert.equal(projList[2].life, 2, 'Own projectile must not be destroyed by own Barge');
  assert.equal(mineList[1].life, 20, 'Far mine must remain intact');

  defender.shieldTimer = 6.0;
  defender.shieldHp = COMBAT_RULES.SHIELD_CAPACITY;
  const absorb1 = resolveShieldAbsorption(defender, 35);
  assert.equal(absorb1.blocked, true);
  assert.equal(absorb1.shieldBroken, false);
  assert.equal(defender.shieldHp, 25);

  const shockBlocked = resolveShockVsShield(defender);
  assert.equal(shockBlocked, true, 'Shield must absorb Shock dome');
  assert.equal(defender.shieldTimer, 0, 'Shock dome must immediately deplete active Shield');
  assert.equal(defender.shieldHp, 0);
});

test('V3.0 2-stage Nitro Air-Brake slows immediately then triggers controlled exit surge', () => {
  const track = buildTrack('neon_city');
  const racer = makeTestRacer('p1', track);
  racer.speed = 62;
  racer.vx = Math.sin(racer.heading) * 62;
  racer.vz = Math.cos(racer.heading) * 62;

  resolveNitroAirBrake(racer);
  assert.ok(racer.speed < 40, `Air-Brake must immediately drop speed, got ${racer.speed}`);
  assert.ok((racer.airBrakeBoostTimer ?? 0) > 0, 'Air-Brake must queue delayed corner-exit boost');

  for (let i = 0; i < 40; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1 }), track, 1 / 60, true);
  }
  assert.ok(racer.nitroTimer > 0, 'Exit surge Nitro timer must trigger after Air-Brake delay');
});

test('V3.0 Handling archetypes differentiate Grippy, Drifty, and Off-Road vehicles + 10x Combo Chain', () => {
  const track = buildTrack('neon_city');
  const offroader = VEHICLES.find((v) => v.handlingArchetype === 'offroad');
  const grippy = VEHICLES.find((v) => v.handlingArchetype === 'grippy');
  const drifty = VEHICLES.find((v) => v.handlingArchetype === 'drifty');
  assert.ok(offroader && grippy && drifty, 'Must include offroad, grippy, and drifty vehicles');

  const rOff = makeTestRacer('off', track, 0, offroader.id);
  const rGrip = makeTestRacer('grip', track, 1, grippy.id);

  const shoulderOffset = track.def.roadWidth * 0.45;
  const s0 = sampleTrackAt(track, 0.01);
  const heading = Math.atan2(s0.tx, s0.tz);
  for (const r of [rOff, rGrip]) {
    r.x = s0.x + s0.rx * shoulderOffset;
    r.z = s0.z + s0.rz * shoulderOffset;
    r.trackT = 0.01;
    r.heading = heading;
    r.speed = 55;
    r.vx = Math.sin(r.heading) * 55;
    r.vz = Math.cos(r.heading) * 55;
  }
  for (let i = 0; i < 45; i++) {
    stepVehiclePhysics(rOff, idleInput({ throttle: 1 }), track, 1 / 60, true);
    stepVehiclePhysics(rGrip, idleInput({ throttle: 1 }), track, 1 / 60, true);
  }
  assert.ok(
    rOff.speed > rGrip.speed * 0.9,
    `Off-road archetype should maintain strong shoulder speed (${rOff.speed.toFixed(1)} vs ${rGrip.speed.toFixed(1)})`,
  );

  const comboRacer = makeTestRacer('combo', track);
  let lastRes = applyComboFans(comboRacer, 100);
  assert.equal(lastRes.comboCount, 1);
  assert.equal(lastRes.multiplier, 1.0);
  assert.equal(lastRes.awarded, 100);

  for (let step = 2; step <= 12; step++) {
    lastRes = applyComboFans(comboRacer, 100);
  }
  assert.equal(lastRes.comboCount, 10, 'Combo chain must cap at 10 consecutive moves');
  assert.equal(lastRes.multiplier, 2.8);
  assert.equal(lastRes.awarded, 280);
});
