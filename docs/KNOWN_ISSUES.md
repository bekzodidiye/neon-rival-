# NEON RIVALS V6.0 — Known Issues & Honest Limitations

This document tracks unresolved engineering gaps, environmental blockers, and follow-up work required to reach full commercial production readiness.

## 1. Missing Artist-Authored `.glb` Vehicle Models (`BLOCKED — Gate A`)
- **Current state**: `src/engine/assets/VehicleAssetLoader.ts` implements `GLTFLoader`, `THREE.LoadingManager`, caching, progress reporting, node/bounds/triangle validation (`Wheel_FL/FR/RL/RR`), automotive PBR material setup, `THREE.LOD`, and full resource disposal. However, `VEHICLE_ASSET_REGISTRY` sets `available: false` for all 5 vehicles so zero 404 requests occur until licensed `.glb` files are placed in `public/assets/vehicles/`.
- **Active fallback**: Upgraded high-detail procedural sculpted meshes (`src/engine/vehicleMesh.ts`) with hood/trunk shutlines, recessed multi-slat front grilles, twin/quad metallic exhaust tips, and dual projector headlamps.
- **Resolution**: Drop verified CC0 or licensed `.glb` models following `docs/VEHICLE_ASSET_PIPELINE.md`, toggle `available: true` in `VEHICLE_ASSET_REGISTRY`, and run visual QA across front/rear/side/3-quarter camera angles.

## 2. Local JSON Dev Persistence Active Instead of Managed PostgreSQL (`BLOCKED — Gate F`)
- **Current state**: `server/persistence/PersistenceAdapter.ts` provides a clean `PersistenceAdapter` interface and `server/persistence/schema.sql` defines the production PostgreSQL schema (`users`, `sessions`, `matches`, `match_participants`, `reward_ledger` with `UNIQUE (match_id, user_id)`). At runtime, `JsonDevPersistenceAdapter` is used for single-node local persistence because paid cloud PostgreSQL provisioning is not authorized in this sandbox.
- **Limitation**: Single-process file locking does not scale horizontally across multiple game server replicas.
- **Resolution**: Implement `PostgresPersistenceAdapter` using `pg` against `DATABASE_URL` and deploy via the provided `Dockerfile` and `docs/DEPLOYMENT.md`.

## 3. Uncompressed JSON World Snapshots (~7.3 KB / Tick)
- **Current state**: At 20 Hz with 8 racers, each `world_snapshot` JSON frame averages ~7.3 KB (~146 KB/s per client before WebSocket permessage-deflate).
- **Impact**: Comfortable for 2–8 players on broadband, but 20-player rooms will benefit substantially from binary encoding (FlatBuffers / MessagePack / quantized `Float32`/`Int16` delta frames) and `perMessageDeflate`.
- **Resolution**: Add delta compression and quantized binary framing in `shared/protocol/` before scaling rooms to 20 concurrent human racers.

## 4. Untested Production Scale & Hardware-GPU Performance (`NOT TESTED`)
- **20-client load test**: Automated WebSocket tests verified 2, 4, and 8 independent clients (server tick avg `0.075–0.668 ms`). A 20-client sustained soak test and multi-room concurrency test have not yet been executed.
- **Hardware-GPU FPS & visual fidelity**: Headless Chromium uses software WebGL rendering; real-world 60 FPS frame-time budgets and PBR clearcoat/reflection quality must be benchmarked on dedicated desktop and mobile GPUs.
- **WAN jitter & packet loss**: Client-side prediction and bounded (`<= 120 ms`) remote interpolation have been tested on loopback only; simulated 80–200 ms RTT + 2% packet loss testing is recommended before public release.

## 5. Offline vs. Verified Online Progression Split
- **Intentional design**: Because `POST /api/race/complete` is disabled (`403 CLIENT_RACE_CLAIM_DISABLED`), single-player offline races persist only in local browser storage and never modify server-authoritative balances or the competitive leaderboard. Verified online career rewards are granted exclusively on authoritative multiplayer match completion.
