# NEON RIVALS V6.0 — Test & Verification Report

This report records only tests actually executed in the workspace environment, with exact measured telemetry and explicit `PASS / FAIL / BLOCKED / NOT TESTED` statuses.

## 1. Automated Test Suite Summary (`npm test`)

Command:
```bash
npm test
# Runs: tsx --test src/game/gameLogic.test.ts shared/simulation/authoritativeRace.test.ts server/game/multiplayer.test.ts
```

Result: **21 / 21 PASS** (total runtime: ~8.15 s).

### 1.1 V5.0 Gameplay Regression Suite (`src/game/gameLogic.test.ts` — 13/13 PASS)
- Track spline arc-length lookup & elevation continuity
- Vehicle acceleration, braking, drift, and Nitro behavior
- 3-slot Blur-style power-up inventory, cycling, discarding, and slot selection
- Swept geometric checkpoint validation (anti-shortcut, lap increment)
- Camera motion blur & FOV response
- Combat resolver (Bolt, Shunt, Barge, Shock, Mine, Shield, Repair, Nitro)
- Segmented health & 4-block repair cap
- 2-stage Nitro air-brake
- Handling archetypes & combo progression
- 4-wheel suspension compression & ground-contact stability
- Vehicle-specific OBB SAT collision detection
- Seeded 7-bot full AI race simulation

### 1.2 V6.0 Simulation, Camera & Physics Acceptance Suite (`shared/simulation/authoritativeRace.test.ts` — 6/6 PASS)
1. **Rear-view camera orientation & raycast wall collision pull-in**:
   - Verified fixed rear-view places camera `+5.8m` ahead of vehicle facing `-18m` backward along track toward pursuers (fixing V5.0 double-negative offset bug).
   - Verified `near`, `far`, `hood`, Nitro FOV expansion, and `THREE.Raycaster` geometry pull-in against an obstructing wall mesh.
2. **Per-vehicle 60 Hz physics telemetry (Neon City 18 s run + 150→5 km/h brake test)**:

| Vehicle | Class | 0–100 km/h | Max Speed | 150→5 km/h Brake Dist |
| :--- | :--- | :---: | :---: | :---: |
| `street_falcon` | Class D | 4.88 s | 215 km/h | 20.9 m |
| `sand_runner` | Class D | 4.70 s | 216 km/h | 21.7 m |
| `night_viper` | Class C | 4.05 s | 243 km/h | 21.2 m |
| `cyber_gt` | Class B | 3.40 s | 272 km/h | 19.0 m |
| `phantom_x` | Class A | 2.93 s | 296 km/h | 17.6 m |

3. **Protocol validation hardening (`shared/protocol/validation.ts`)**:
   - Rejects `NaN`/`Infinity`, out-of-range slots, stale/out-of-order sequences, and unknown power-up IDs (`validatePowerUpType` returns `null`, never coerces to `BOLT`).
4. **Atomic single-owner pickup exclusivity**:
   - Two racers intersecting the same pickup orb on the same 60 Hz tick produce exactly 1 granted pickup and 1 deactivated orb.
5. **Full 3-Lap 8-Racer Combat Acceptance (3 Deterministic Seeds, Neon City)**:

| Seed | Finishers | Winner Time | Driver Avg Lap | Pickups | Power-Ups Fired | Collisions | Wrecks | Shield Blocks |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `101` | 8 / 8 | 146.6 s | 57.1 s | 84 | 82 | 27 | 3 | 2 |
| `202` | 8 / 8 | 144.2 s | 57.3 s | 88 | 88 | 35 | 3 | 0 |
| `303` | 8 / 8 | 170.9 s | 58.3 s | 123 | 143 | 41 | 14 | 3 |

### 1.3 V6.0 Security & Authoritative Multiplayer Suite (`server/game/multiplayer.test.ts` — 2/2 PASS)
1. **Security & Reward Integrity (Gate E)**:
   - `POST /api/race/complete` returns `403 CLIENT_RACE_CLAIM_DISABLED` (blocks unverified client-claimed rewards).
   - `GET /api/leaderboard` returns `[]` initially (zero fabricated seeded leaderboard entries).
   - Register/login enforces `6..128` password length, async `scrypt`, Bearer token validation, and Origin checks.
   - WebSocket `/ws` rejects legacy client-authored `racer_state` and arbitrary `combat_use` with `AUTHORITATIVE_ONLY`.
2. **Independent Multi-Client Authoritative WebSocket Races (2, 4, and 8 Clients)**:

| Scenario | Avg Snapshots / Client | Avg Snapshot Payload | Tick Avg | Tick Max | Node Heap Used |
| :--- | :---: | :---: | :---: | :---: | :---: |
| 2 WS Clients (+6 AI) | 1,313 | 7,288 B | 0.701 ms | 4.299 ms | 79.5 MB |
| 4 WS Clients (+4 AI) | 1,084 | 7,295 B | 0.244 ms | 0.625 ms | 87.1 MB |
| 8 WS Clients (0 AI) | 993 | 7,319 B | 0.084 ms | 0.141 ms | 165.3 MB |

- Verified server-side match persistence (`GET /api/matches/:matchId/result`), verified leaderboard population after authoritative completion, and strict idempotency on duplicate reward settlement (`(matchId, userId)` ledger key).

## 2. Explicit `NOT TESTED` / `BLOCKED` Items

| Verification Area | Status | Honest Reason |
| :--- | :---: | :--- |
| 20-client concurrent WebSocket load test | **NOT TESTED** | Automated suite tested 2, 4, and 8 independent WS clients; 20-client stress benchmark remains pending. |
| Real WAN multi-browser multiplayer latency / packet-loss test | **NOT TESTED** | Tested over local loopback WebSocket server only. |
| Hardware-GPU 60 FPS frame-time benchmark (1080p/1440p) | **NOT TESTED** | Container environment uses software WebGL / headless Chromium; real GPU FPS cannot be credibly measured here. |
| External artist-authored `.glb` vehicle asset loading | **BLOCKED** | `VehicleAssetLoader` + `GLTFLoader` + validation + LOD pipeline is implemented and compiled, but no licensed third-party `.glb` files are bundled in `public/assets/vehicles/`. |
| Managed PostgreSQL live query / migration run | **BLOCKED** | `server/persistence/schema.sql` is ready, but paid cloud database provisioning was not authorized in this environment. |

## 3. Gate A–G Status Matrix

| Gate | Scope | Status | Summary |
| :--- | :--- | :---: | :--- |
| **Gate A** | Real GLB Vehicle Assets | **BLOCKED** | `GLTFLoader` + cache + validation + LOD + disposal pipeline implemented; awaiting licensed external `.glb` files. Procedural sculpted models upgraded with flush A-pillars, multi-slat grilles, twin/quad exhausts, and recessed projector headlamps. |
| **Gate B** | Environment & Lighting | **PASS** | Distinct Night (`neon_city`), Day (`industrial_port`), and Sunset (`midnight_streets`) PBR lighting profiles + PMREM reflections + urban roadside planters/trees and traffic signals on Neon City. |
| **Gate C** | Physics, Camera & 3-Lap 8-Racer Combat Acceptance | **PASS** | Rear-view camera fixed + raycast wall pull-in; 5-vehicle telemetry verified; 3 deterministic seeds complete 3 laps with 8/8 finishers and active combat. |
| **Gate D** | Authoritative Multiplayer | **PASS (≤8 clients) / NOT TESTED (20 clients & WAN)** | Browser-independent 60 Hz `RaceSimulation`, 20 Hz snapshots, sequenced `InputQueue`, client prediction/reconciliation, and 2/4/8-client WS verification passing. |
| **Gate E** | Security & Verified Rewards | **PASS** | `/api/race/complete` disabled (`403`), async `scrypt`, `6..128` password bounds, Origin checks, WS `AUTHORITATIVE_ONLY`, verified-only leaderboard, idempotent `(matchId, userId)` ledger. |
| **Gate F** | Production PostgreSQL & Split Cloud Deployment | **BLOCKED** | `server/persistence/schema.sql`, `Dockerfile`, and `docs/DEPLOYMENT.md` ready; live cloud infrastructure not provisioned per cost constraint. |
| **Gate G** | Typecheck, Production Build, Tests & Headless Browser QA | **PASS** | `tsc --noEmit` 0 errors, `vite build` clean, `npm test` 21/21 PASS, Playwright 1440×900 visual QA passed with 0 console errors, 0 404s, verified empty leaderboard, and flush vehicle showcase. |
