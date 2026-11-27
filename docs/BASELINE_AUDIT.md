# NEON RIVALS — Baseline & V6.0 Audit Report

## 1. Repository & Tooling Snapshot
- **Stack**: React 19, TypeScript 7, Three.js 0.187, Vite 8.3, Express 4.21, `ws` 8.23, `vite-plugin-pwa` 2.0, `tsx` 4.21.
- **Verification Scripts (`package.json`)**:
  - `npm run typecheck` (`tsc --noEmit`)
  - `npm run build` (`vite build`)
  - `npm test` (`tsx --test src/game/gameLogic.test.ts shared/simulation/authoritativeRace.test.ts server/game/multiplayer.test.ts`)

## 2. V5.0 Baseline Defects (Resolved in V5.0 & Preserved)
1. **Blocky Vehicle Meshes** → Replaced with 34-station parametric lofted sculpted automotive geometry, wheel arches, brake discs/calipers, and clearcoat PBR paint.
2. **Flat Track & Uniform Collisions** → Replaced with overpass elevation, arc-length lookup tables (`sampleTrackByDistance`), swept geometric checkpoints, 4-wheel spring-damper suspension, and vehicle-specific OBB SAT collisions.
3. **Passive Drift-Charged Nitro** → Removed in favor of strict Blur Powered Racing 3-slot tactical Nitro inventory rules.
4. **Embedded Chase Camera** → Extracted to `src/engine/camera/ChaseCamera.ts`.
5. **Weak Legacy Auth** → Upgraded from static-salt SHA-256 to salted `scrypt` + HMAC-SHA256 Bearer sessions + rate limiting.

## 3. V5.0 Remaining Gaps Audited at Start of V6.0 & Current Resolution
1. **CRITICAL Security Blocker — Client-Claimed Race Rewards (`POST /api/race/complete`)**:
   - *V5.0 flaw*: Accepted client-submitted position, takedowns, and hits to award online credits/XP/leaderboard rank.
   - *V6.0 resolution*: **FIXED (Gate E PASS)**. `POST /api/race/complete` disabled (`403 CLIENT_RACE_CLAIM_DISABLED`). Rewards and leaderboard progression are granted exclusively by the server-authoritative match engine with idempotent `(matchId, userId)` ledger checks; fabricated seeded leaderboard entries removed.
2. **Rear-View Camera Bug & Wall Clipping**:
   - *V5.0 flaw*: Double-negative offset placed rear-view camera behind the car looking forward instead of ahead of the car looking backward; lacked raycast geometry obstruction handling.
   - *V6.0 resolution*: **FIXED (Gate C PASS)**. Rear-view sits `+5.8m` ahead looking `-18m` back toward pursuers with instant toggle snap and `THREE.Raycaster` wall pull-in.
3. **Single Lighting Mood & Missing Street-Level Urban Detail**:
   - *V5.0 flaw*: All tracks shared a single night lighting rig; Neon City lacked street-level foliage/signals.
   - *V6.0 resolution*: **FIXED (Gate B PASS)**. Added `src/engine/lighting.ts` (`night` / `day` / `sunset` + matching PMREM) and instanced roadside planters/trees + traffic signals on Neon City.
4. **No GLB Asset Pipeline**:
   - *V5.0 flaw*: No `GLTFLoader`, cache, validation, LOD, or disposal path for artist-authored models.
   - *V6.0 resolution*: **PIPELINE COMPLETE / ASSETS BLOCKED (Gate A BLOCKED)**. Implemented `VehicleAssetLoader.ts` with honest procedural fallback (`available: false`, zero 404s) plus vehicle detail upgrades (panel seams, grilles, exhausts, projectors). External licensed `.glb` assets still required.
5. **Non-Authoritative WebSocket Relay**:
   - *V5.0 flaw*: Clients simulated physics locally and relayed `racer_state` / `combat_use`.
   - *V6.0 resolution*: **FIXED (Gate D PASS ≤8 clients)**. Implemented browser-independent 60 Hz `shared/simulation/RaceSimulation.ts`, server `InputQueue`/`AuthoritativeRace`/`RoomManager`, 20 Hz `world_snapshot` fanout, client prediction/reconciliation, and 2/4/8-client automated WS tests.
6. **Production Database & Cloud Infrastructure**:
   - *V5.0 flaw*: Single-file JSON store only; no container build or SQL schema.
   - *V6.0 resolution*: **ARTIFACTS READY / INFRA BLOCKED (Gate F BLOCKED)**. Added `server/persistence/schema.sql`, `PersistenceAdapter.ts`, `Dockerfile`, and `docs/DEPLOYMENT.md`; live cloud provisioning deferred per cost policy.
