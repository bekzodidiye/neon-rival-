# NEON RIVALS — Engineering Progress Log

## V6.0 Production Quality, Asset Pipeline & Authoritative Multiplayer (Current)
- **Critical Security Blocker Resolved (Gate E — PASS)**:
  - Disabled client-claimed competitive reward submission (`POST /api/race/complete` now returns `403 CLIENT_RACE_CLAIM_DISABLED`). Offline single-player races remain strictly local.
  - Upgraded password hashing to non-blocking async `crypto.scrypt` with `6..128` character length bounds and constant-time verification.
  - Added strict HTTP/WS `Origin` allowlist checks, authenticated WebSocket Bearer handshake, strict rejection of legacy client-authored `racer_state` / arbitrary `combat_use` (`AUTHORITATIVE_ONLY`), and verified-only `GET /api/leaderboard` (removed fabricated seeded leaderboard entries from `CareerModal.tsx`).
  - Added server-side authoritative match persistence (`GET /api/matches/:matchId/result`), `verifiedMatchesCount` on `/api/auth/me`, and idempotent `(matchId, userId)` reward settlement.
- **Vehicle Asset Loading Architecture & Visual Upgrade (Gate A — Pipeline Ready / External GLBs BLOCKED)**:
  - Implemented `src/engine/assets/VehicleAssetLoader.ts` with `GLTFLoader`, `THREE.LoadingManager`, model cache, progress callbacks, structural/bounds/triangle validation (`Wheel_FL/FR/RL/RR`), automotive PBR clearcoat/glass/rim material config, `THREE.LOD`, and `dispose()`.
  - Upgraded procedural sculpted vehicles (`src/engine/vehicleMesh.ts`) with hood/trunk shutlines, multi-slat recessed front grilles + brake intakes, twin/quad metallic exhaust tips, and dual inner projector headlamps; zero empty/fake `.glb` files created.
- **Lighting Profiles & Neon City Environment (Gate B — PASS)**:
  - Added `src/engine/lighting.ts` with distinct `night` (`neon_city`), `day` (`industrial_port`), and `sunset` (`midnight_streets`) PBR lighting profiles and matching dynamic PMREM environment maps.
  - Added instanced roadside urban concrete planters + trees and cantilevered traffic signal assemblies to Neon City (`src/engine/trackMesh.ts`).
- **Chase Camera Fix & Raycast Collision Avoidance (Gate C — PASS)**:
  - Fixed V5.0 rear-view double-negative bug in `src/engine/camera/ChaseCamera.ts` (rear-view now positions `+5.8m` ahead facing `-18m` backward with immediate snap on toggle) and added geometry-based `THREE.Raycaster` wall pull-in.
- **Shared Browser-Independent Simulation & Authoritative Multiplayer (Gate D — PASS up to 8 clients)**:
  - Created `shared/protocol/messages.ts`, `shared/protocol/validation.ts`, and zero-DOM 60 Hz `shared/simulation/RaceSimulation.ts` with atomic single-owner pickups, 8 power-ups, 3-slot inventory, combat counterplay, swept checkpoints, and wreck/respawn rules.
  - Implemented `server/game/InputQueue.ts`, `server/game/AuthoritativeRace.ts`, `server/game/RoomManager.ts`, `server/persistence/PersistenceAdapter.ts`, and `server/persistence/schema.sql`.
  - Refactored `server.ts` to export `createAppServer(options)` and wired `src/net/multiplayerClient.ts`, `src/engine/RaceEngine.ts`, and `src/App.tsx` with sequenced `player_input`, local prediction + `pendingInputs` reconciliation, bounded (`<= 120ms`) remote interpolation, and verified match reward sync.
- **Deployment, Docs & Verification (Gate F — BLOCKED on Cloud Spend; Gate G — Verified)**:
  - Added `Dockerfile` and engineering docs (`DEPLOYMENT.md`, `VEHICLE_ASSET_PIPELINE.md`, `MULTIPLAYER_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `PERFORMANCE_REPORT.md`, `TEST_REPORT.md`, `KNOWN_ISSUES.md`).
  - Expanded automated test suite to **21/21 passing** (`npm test`), covering V5.0 regressions, rear-view/raycast camera, 5-vehicle physics telemetry, 3-seed 3-lap 8-racer combat acceptance, Gate E security assertions, and 2/4/8-client independent WebSocket races.

## V5.0 Repository-Based Quality Rebuild (Preserved)
- Parametric 34-station lofted vehicle silhouettes, 4-wheel suspension dynamics, vehicle-specific OBB SAT collisions, arc-length track sampling + swept checkpoints, dedicated `ChaseCameraController`, 8 power-ups + 3-slot inventory + Nitro air-brake + segmented health, procedural WebAudio, PWA, mobile controls, and 13/13 regression tests all preserved.

## Gate A–G Honest Status Summary
- **Gate A (Real GLB Vehicle Assets)**: `BLOCKED` — Full `GLTFLoader` pipeline & validation built; licensed artist `.glb` files not yet supplied.
- **Gate B (Environment & Lighting)**: `PASS` — Night/Day/Sunset PBR profiles + PMREM + Neon City street furniture verified.
- **Gate C (Physics, Camera & Combat Acceptance)**: `PASS` — 21/21 automated tests, rear-view fix + raycast pull-in, 3-seed 3-lap 8/8 finish.
- **Gate D (Authoritative Multiplayer)**: `PASS (≤8 clients)` / `NOT TESTED (20 clients & live WAN)`.
- **Gate E (Security & Verified Rewards)**: `PASS` — Client claim disabled (`403`), async `scrypt`, Origin & WS validation, verified-only leaderboard, idempotent ledger.
- **Gate F (PostgreSQL & Split Cloud Deploy)**: `BLOCKED` — Production SQL schema, Dockerfile & deployment guide complete; live paid cloud infra not provisioned.
- **Gate G (Build, Typecheck, Tests & Browser QA)**: Verified via `npm test`, `compile_applet`, `lint_applet`, and headless Playwright inspection (see `docs/TEST_REPORT.md`).
