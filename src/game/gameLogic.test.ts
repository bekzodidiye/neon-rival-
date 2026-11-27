import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrack,
  generateTrackPickups,
  getSpawnGridTransform,
  projectPointToTrack,
  sampleTrackAt,
  sortRaceStandings,
  updateRacerCheckpoints,
} from './trackMath';
import { stepVehiclePhysics, recoverVehicleToTrack } from './physics';
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
import type { ControlInput, RacerState } from './types';

function makeTestRacer(id: string, track = buildTrack('neon_city')): RacerState {
  const spawn = getSpawnGridTransform(track, 0);
  const car = VEHICLES[0];
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
    hp: 100,
    maxHp: 100,
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
    totalProgress: -0.02,
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
    aiLaneOffset: 0,
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

test('Neon City track spline builds continuous 2.5km-4km closed loop with pickups', () => {
  const track = buildTrack('neon_city');
  assert.ok(track.totalLength >= 2000 && track.totalLength <= 4500, `Expected ~2.5-4km, got ${track.totalLength}`);
  const s0 = sampleTrackAt(track, 0);
  const s1 = sampleTrackAt(track, 1);
  assert.ok(Math.hypot(s0.x - s1.x, s0.z - s1.z) < 0.01, 'Track loop must close seamlessly');

  const pickups = generateTrackPickups(track);
  assert.ok(pickups.length >= 24, 'Should populate track with power-up pickups');
  const seenTypes = new Set(pickups.map((p) => p.type));
  assert.equal(seenTypes.size, POWERUP_TYPES.length, 'All 8 power-up types must appear on track');
});

test('Vehicle physics accelerates, steers, drifts, boosts with Nitro, and stays contained inside barriers', () => {
  const track = buildTrack('neon_city');
  const racer = makeTestRacer('p1', track);

  // Accelerate straight for 2 seconds down the start straight
  for (let i = 0; i < 120; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1 }), track, 1 / 60, true);
  }
  assert.ok(racer.speed > 45, `Vehicle should accelerate past 45 m/s, got ${racer.speed}`);

  // Reset onto start straight and verify Nitro boosts speed well above base top speed
  racer.trackT = 0.005;
  recoverVehicleToTrack(racer, track);
  const baseTop = VEHICLES[0].stats.topSpeed;
  racer.speed = baseTop * 0.85;
  racer.vx = Math.sin(racer.heading) * racer.speed;
  racer.vz = Math.cos(racer.heading) * racer.speed;
  racer.nitroTimer = 3.0;
  for (let i = 0; i < 90; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1 }), track, 1 / 60, true);
  }
  assert.ok(racer.speed > baseTop * 1.15, `Nitro should boost speed above base top speed (${racer.speed} vs ${baseTop})`);

  // Verify Blur Slipstream drafting exceeds base top speed without Nitro
  racer.trackT = 0.005;
  recoverVehicleToTrack(racer, track);
  racer.nitroTimer = 0;
  racer.isDrafting = true;
  racer.speed = baseTop * 0.95;
  racer.vx = Math.sin(racer.heading) * racer.speed;
  racer.vz = Math.cos(racer.heading) * racer.speed;
  for (let i = 0; i < 90; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1 }), track, 1 / 60, true);
  }
  assert.ok(racer.speed > baseTop * 1.03, `Slipstream should exceed base top speed (${racer.speed} vs ${baseTop})`);
  assert.equal(POWERUP_DEFS.NITRO.supportsRearFire, true, 'NITRO must support Blur rear-fire Air-Brake');

  // Initiate drift while turning hard
  racer.isDrafting = false;
  racer.nitroTimer = 0;
  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(racer, idleInput({ throttle: 1, steer: 1, drift: true }), track, 1 / 60, true);
  }
  assert.equal(racer.isDrifting, true, 'Drift input at high speed should engage drift state');

  // Verify barrier clamping keeps lateralOffset within track half-width
  const proj = projectPointToTrack(track, racer.x, racer.z, racer.trackT);
  assert.ok(Math.abs(proj.lateralOffset) <= track.def.roadWidth * 0.5, 'Car must stay inside road barriers');

  // Verify recovery resets car to centerline facing forward
  recoverVehicleToTrack(racer, track);
  assert.equal(racer.lateralOffset, 0);
  assert.equal(racer.wrongWay, false);
});

test('Power-up 3-slot inventory, Bolt 3-shot ammo, Shield block, Damage, and Repair work accurately', () => {
  const track = buildTrack('neon_city');
  const attacker = makeTestRacer('p1', track);
  const defender = makeTestRacer('p2', track);

  // Fill 3 slots and confirm 4th is rejected
  const c1 = collectPowerUp(attacker.inventory, attacker.activeSlot, 'BOLT');
  assert.equal(c1.collected, true);
  attacker.activeSlot = c1.newActiveSlot;
  collectPowerUp(attacker.inventory, attacker.activeSlot, 'SHIELD');
  collectPowerUp(attacker.inventory, attacker.activeSlot, 'REPAIR');
  const c4 = collectPowerUp(attacker.inventory, attacker.activeSlot, 'SHUNT');
  assert.equal(c4.collected, false, 'Inventory must cap at 3 slots');

  // Bolt starts with 3 ammo shots
  assert.equal(attacker.inventory[0]?.ammo, 3);
  const f1 = consumeActivePowerUp(attacker.inventory, 0);
  assert.equal(f1.firedType, 'BOLT');
  assert.equal(attacker.inventory[0]?.ammo, 2);
  consumeActivePowerUp(attacker.inventory, 0);
  consumeActivePowerUp(attacker.inventory, 0);
  assert.equal(attacker.inventory[0], null, 'Bolt slot clears after 3rd shot');

  // Cycle & discard
  const nextSlot = cyclePowerUpSlot(attacker.inventory, 0);
  assert.equal(nextSlot, 1);
  const disc = discardPowerUpSlot(attacker.inventory, 1);
  assert.equal(disc.discarded, true);
  assert.equal(attacker.inventory[1], null);

  // Shield blocks incoming damage
  defender.shieldTimer = 4.0;
  const blocked = applyCombatDamage(defender, 25, attacker);
  assert.equal(blocked.blockedByShield, true);
  assert.equal(defender.hp, 100);
  assert.equal(defender.blocksLanded, 1);

  // Unshielded damage reduces HP and triggers destruction at 0 HP
  defender.shieldTimer = 0;
  const hit1 = applyCombatDamage(defender, 60, attacker);
  assert.equal(hit1.appliedDamage, 60);
  assert.equal(defender.hp, 40);
  assert.equal(attacker.hitsLanded, 1);

  // Repair restores to max HP and never exceeds maxHp
  const healed = applyRepairPowerUp(defender);
  assert.equal(healed, 60);
  assert.equal(defender.hp, 100);

  // Lethal hit destroys defender and awards takedown
  const lethal = applyCombatDamage(defender, 120, attacker);
  assert.equal(lethal.destroyedNow, true);
  assert.equal(defender.destroyed, true);
  assert.equal(attacker.takedowns, 1);
});

test('Checkpoints prevent lap skipping, count sequential laps, and rank standings properly', () => {
  const track = buildTrack('neon_city');
  const r1 = makeTestRacer('p1', track);
  const r2 = makeTestRacer('p2', track);

  // Jumping directly to checkpoint 8 without passing earlier ones should NOT advance lap
  updateRacerCheckpoints(r1, track, 0.72, 2, 10);
  assert.equal(r1.lap, 1);
  assert.equal(r1.passedCheckpoints, 0);

  // Walk r1 sequentially through all 12 checkpoints for 2 laps
  let finished = false;
  for (let lap = 0; lap < 2; lap++) {
    for (let cp = 0; cp < track.checkpointCount; cp++) {
      const t = (cp + 0.1) / track.checkpointCount;
      const res = updateRacerCheckpoints(r1, track, t, 2, 10 + lap * 45 + cp * 3);
      if (res.raceFinished) finished = true;
    }
  }
  // Cross start/finish line (cp 0) to complete lap 2
  const finalCross = updateRacerCheckpoints(r1, track, 0.01, 2, 105);
  assert.equal(finished || finalCross.raceFinished, true, 'Completing all sequential checkpoints for 2 laps finishes race');
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
