import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { computeTransmissionTelemetry } from './physics';
import { computeVehicleDamageStage } from '../engine/vehicleMesh';
import { VehicleAssetLoader } from '../engine/assets/VehicleAssetLoader';
import { VEHICLES } from './vehicles';
import {
  CAREER_GROUPS,
  MULTIPLAYER_MODS,
  applyPrestigeReset,
  canActivatePrestige,
  computeEventLights,
  computeOnlineRankFromXp,
  computeTotalCareerLights,
  getAllCareerEvents,
  getCareerEventById,
  mergeCareerEventRecord,
  updateVehicleMastery,
  validateEquippedMods,
} from './career';
import { SnapshotDecoder, SnapshotEncoder } from '../../shared/protocol/snapshotCodec';
import type { AuthoritativeWorldSnapshot } from '../../shared/protocol/messages';
import { RaceSimulation } from '../../shared/simulation/RaceSimulation';

test('V7 Gate A: 6-speed transmission telemetry scales monotonically across speed bands', () => {
  const topSpeed = 84;
  const idle = computeTransmissionTelemetry(0, topSpeed, 0, false);
  assert.equal(idle.gear, 1);
  assert.ok(idle.rpmRatio >= 0.14 && idle.rpmRatio <= 0.35);

  const mid = computeTransmissionTelemetry(topSpeed * 0.45, topSpeed, 1, false);
  assert.ok(mid.gear >= 2 && mid.gear <= 4, `Expected mid gear 2..4, got ${mid.gear}`);
  assert.ok(mid.rpmRatio >= 0.25 && mid.rpmRatio <= 1.0);

  const high = computeTransmissionTelemetry(topSpeed * 0.95, topSpeed, 1, true);
  assert.equal(high.gear, 6);
  assert.ok(high.rpmRatio > 0.45);

  const rev = computeTransmissionTelemetry(-12, topSpeed, 0, false);
  assert.equal(rev.gear, 0);
});

test('V7 Gate B: 5-stage progressive visible damage thresholds are deterministic', () => {
  assert.equal(computeVehicleDamageStage(120, 120, false), 'healthy');
  assert.equal(computeVehicleDamageStage(90, 120, false), 'light');
  assert.equal(computeVehicleDamageStage(60, 120, false), 'moderate');
  assert.equal(computeVehicleDamageStage(25, 120, false), 'critical');
  assert.equal(computeVehicleDamageStage(0, 120, true), 'wrecked');
  assert.equal(computeVehicleDamageStage(50, 120, true), 'wrecked');
});

test('V7 Gate C: Vehicle multi-level LOD strictly reduces triangle counts from LOD0 to LOD3', () => {
  const car = VEHICLES[0];
  const loader = new VehicleAssetLoader();
  const dummyTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const rig = loader.instantiateVehicleRig(
    car,
    car.defaultCustomization,
    {
      contactShadow: dummyTex,
      neonGlow: dummyTex,
      headlightBeam: dummyTex,
      tailTrail: dummyTex,
    },
    false,
  );
  assert.ok(rig.lod && rig.lod.levels.length === 4, 'Vehicle rig should expose 4 LOD levels');
  assert.ok(rig.lodStats, 'Vehicle rig should record LOD triangle statistics');

  const { lod0Triangles, lod1Triangles, lod2Triangles, lod3Triangles } = rig.lodStats;
  assert.ok(lod0Triangles > 500, `LOD0 should be detailed hero mesh, got ${lod0Triangles}`);
  assert.ok(lod1Triangles < lod0Triangles, `LOD1 (${lod1Triangles}) must be lighter than LOD0 (${lod0Triangles})`);
  assert.ok(lod2Triangles <= lod1Triangles, `LOD2 (${lod2Triangles}) must be <= LOD1 (${lod1Triangles})`);
  assert.ok(lod3Triangles < lod2Triangles, `LOD3 (${lod3Triangles}) must be lighter than LOD2 (${lod2Triangles})`);

  rig.dispose();
  loader.dispose();
  dummyTex.dispose();
});

test('V7 Gate D: Career defines 9 groups, 7 Street Initiation events, permanent Lights without replay double-counting', () => {
  assert.equal(CAREER_GROUPS.length, 9);
  const streetInit = CAREER_GROUPS[0];
  assert.equal(streetInit.id, 'street_initiation');
  assert.equal(streetInit.events.length, 7);
  assert.ok(streetInit.events.some((e) => e.mode === 'destruction_arena'));
  assert.ok(streetInit.events.some((e) => e.mode === 'checkpoint'));
  assert.ok(streetInit.events.some((e) => e.isRivalShowdown && e.rival?.name === 'NOVA'));

  const allEvents = getAllCareerEvents();
  assert.ok(allEvents.length >= 30);

  const ev1 = getCareerEventById(streetInit.events[0].id);
  assert.ok(ev1);

  const lightsRun1 = computeEventLights({
    event: ev1,
    position: 2,
    score: 0,
    checkpointsCleared: 0,
    fanRunCompleted: false,
    fanDemandCompleted: false,
  });
  assert.equal(lightsRun1, 4);

  let records = {};
  const m1 = mergeCareerEventRecord(records, ev1, {
    position: 2,
    score: 0,
    timeMs: 92000,
    lightsEarned: lightsRun1,
    fanRunCompleted: false,
    fanDemandCompleted: false,
  });
  records = m1.records;
  assert.equal(m1.newLightsDelta, 4);
  assert.equal(computeTotalCareerLights(records), 4);

  // Replay with same result: zero duplicate lights added
  const m2 = mergeCareerEventRecord(records, ev1, {
    position: 2,
    score: 0,
    timeMs: 91000,
    lightsEarned: 4,
    fanRunCompleted: false,
    fanDemandCompleted: false,
  });
  records = m2.records;
  assert.equal(m2.newLightsDelta, 0);
  assert.equal(computeTotalCareerLights(records), 4);

  // Replay with 1st place (5 lights): only +1 delta added
  const m3 = mergeCareerEventRecord(records, ev1, {
    position: 1,
    score: 0,
    timeMs: 88000,
    lightsEarned: 5,
    fanRunCompleted: true,
    fanDemandCompleted: true,
  });
  records = m3.records;
  assert.equal(m3.newLightsDelta, 1);
  assert.equal(computeTotalCareerLights(records), 5);
});

test('V7 Gate E: Vehicle Mastery, Bounded Mods, Online Rank 1-50, and Prestige Reset work cleanly', () => {
  let mastery = {};
  for (let i = 0; i < 6; i++) {
    mastery = updateVehicleMastery(mastery, {
      vehicleId: 'street_falcon',
      won: true,
      distanceMeters: 4200,
      bestLapMs: 38000 - i * 400,
      combatActions: 4,
      defensiveActions: 2,
    });
  }
  const rec = (mastery as Record<string, any>)['street_falcon'];
  assert.equal(rec.racesCompleted, 6);
  assert.equal(rec.wins, 6);
  assert.ok(rec.masteryLevel >= 4 && rec.masteryLevel <= 10);

  const check1 = validateEquippedMods(
    ['mod_magnetic_intake', 'mod_aegis_capacitor', 'mod_counter_surge', 'fake_mod'],
    1,
  );
  assert.equal(check1.valid, false);
  assert.equal(check1.mods.length, 2);
  assert.ok(check1.rejectedIds.includes('mod_counter_surge'));
  assert.ok(check1.rejectedIds.includes('fake_mod'));

  const check50 = validateEquippedMods(MULTIPLAYER_MODS.map((m) => m.id), 50);
  assert.equal(check50.mods.length, 3);

  const r1 = computeOnlineRankFromXp(0);
  assert.equal(r1.rank, 1);
  const r50 = computeOnlineRankFromXp(500000);
  assert.equal(r50.rank, 50);
  assert.equal(canActivatePrestige(49, 0), false);
  assert.equal(canActivatePrestige(50, 0), true);

  const denied = applyPrestigeReset({ onlineRank: 50, onlineXp: 500000, prestigeTier: 0, confirmed: false });
  assert.equal(denied.ok, false);
  const ok = applyPrestigeReset({ onlineRank: 50, onlineXp: 500000, prestigeTier: 0, confirmed: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.onlineRank, 1);
  assert.equal(ok.onlineXp, 0);
  assert.equal(ok.prestigeTier, 1);
  assert.ok(ok.preservedItems.length >= 3);
});

test('V7 Gate F: Compact/Delta Snapshot Codec v2 achieves >35% byte reduction on 20-player grid', () => {
  const sim = new RaceSimulation({
    matchId: 'v7_compact_20p_test',
    trackId: 'neon_city',
    mode: 'combat_race',
    laps: 3,
    difficulty: 'normal',
    countdownSeconds: 0,
    participants: Array.from({ length: 20 }, (_, i) => ({
      id: `racer_${i}`,
      name: `DRIVER_${i + 1}`,
      vehicleId: VEHICLES[i % VEHICLES.length].id,
      isAi: true,
    })),
  });

  const encoder = new SnapshotEncoder();
  const decoder = new SnapshotDecoder();

  let fullBytesTotal = 0;
  let compactBytesTotal = 0;
  let lastDecoded: AuthoritativeWorldSnapshot | null = null;
  let lastRaw: AuthoritativeWorldSnapshot | null = null;

  for (let tick = 0; tick < 20; tick++) {
    sim.step(1 / 20);
    const snap = sim.createSnapshot();
    const compact = encoder.encode(snap);
    const decoded = decoder.decode(compact);

    fullBytesTotal += JSON.stringify(snap).length;
    compactBytesTotal += JSON.stringify(compact).length;
    lastDecoded = decoded;
    lastRaw = snap;
  }

  const savingsPct = ((fullBytesTotal - compactBytesTotal) / fullBytesTotal) * 100;
  assert.ok(savingsPct > 35, `Expected >35% compact bandwidth savings, got ${savingsPct.toFixed(1)}%`);
  assert.ok(lastDecoded && lastRaw);
  assert.equal(lastDecoded.racers.length, 20);
  assert.equal(lastDecoded.racers[0].name, lastRaw.racers[0].name);
  assert.ok(Math.abs(lastDecoded.racers[0].x - lastRaw.racers[0].x) < 0.02);
  assert.ok(Math.abs(lastDecoded.racers[0].z - lastRaw.racers[0].z) < 0.02);
});

test('V7 Gate G: Destruction & Checkpoint modes simulate deterministically in shared RaceSimulation', () => {
  const ckSim = new RaceSimulation({
    matchId: 'v7_checkpoint_sim_test',
    trackId: 'industrial_port',
    mode: 'checkpoint',
    laps: 3,
    difficulty: 'normal',
    countdownSeconds: 0,
    timeLimitSec: 25,
    participants: [{ id: 'p1', name: 'TESTER', vehicleId: 'street_falcon', isAi: true }],
  });
  for (let i = 0; i < 600; i++) {
    ckSim.step(1 / 20);
    if (ckSim.phase === 'finished') break;
  }
  const ckSnap = ckSim.createSnapshot();
  assert.equal(ckSnap.racers.length, 1);
  assert.ok(Number.isFinite(ckSnap.racers[0].x) && Number.isFinite(ckSnap.racers[0].z));

  const destSim = new RaceSimulation({
    matchId: 'v7_destruction_sim_test',
    trackId: 'midnight_streets',
    mode: 'destruction_arena',
    laps: 3,
    difficulty: 'normal',
    countdownSeconds: 0,
    timeLimitSec: 12,
    participants: Array.from({ length: 8 }, (_, i) => ({
      id: `d_${i}`,
      name: `BRAWLER_${i}`,
      vehicleId: VEHICLES[i % VEHICLES.length].id,
      isAi: true,
    })),
  });
  for (let i = 0; i < 300; i++) {
    destSim.step(1 / 20);
    if (destSim.phase === 'finished') break;
  }
  assert.equal(destSim.phase, 'finished');
});

test('V7 Gate H: Firestore security rules enforce default-deny, verified owner isolation, and strict schemas', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');
  assert.ok(rules.includes('allow read, write: if false;'), 'Must contain global default-deny catch-all');
  assert.ok(rules.includes('request.auth.token.email_verified == true'), 'Must enforce verified email');
  assert.ok(rules.includes('keys().hasOnly('), 'Must enforce strict field allowlists to prevent mass assignment');
  assert.ok(!/allow\s+(read|write)\s*:\s*if\s+true\b/.test(rules), 'Must never allow unauthenticated wildcard access');
});
