# NEON RIVALS — Engineering Progress Log

## V5.0 Repository-Based Quality Rebuild (Current)
- **Stage 0 — Baseline Audit**: Added `npm test` and `npm run typecheck` scripts in `package.json`; documented verified pre-rebuild audit in `docs/BASELINE_AUDIT.md`.
- **Stage 1 — Sculpted 3D Vehicle Assets**: Replaced boxy `ExtrudeGeometry` + `BoxGeometry` hulls in `src/engine/vehicleMesh.ts` with 34-station parametric lofted `BufferGeometry` automotive bodies featuring sculpted wheel arches, crowned wrap-around greenhouses, stalk mirrors, door seams, archetype body kits, and multi-part `LatheGeometry` tires/deep-dish alloy wheels/10 twin spokes/slotted brake discs/fixed calipers. Documented honestly in `docs/ASSET_MANIFEST.md`.
- **Stage 2 — Grounded Vehicle Physics**: Rebuilt `src/game/physics.ts` with 4-wheel spring-damper suspension dynamics over track elevation, vehicle-specific OBB SAT collisions, realistic Class D–A acceleration/braking/top-speed curves, physical barrier normal impulses without forced auto-steering, and pure Blur Powered Racing Nitro rules (no passive drift-charged Nitro).
- **Stage 3 — Urban Track & Environment**: Added overpass elevation profiles, arc-length lookup tables (`sampleTrackByDistance`), and swept geometric checkpoint gates in `src/game/trackMath.ts`; rebuilt `src/engine/proceduralTextures.ts` and `src/engine/trackMesh.ts` with wet asphalt markings, sidewalks, guardrails, bridge support piers, 4-archetype metropolitan skyscrapers with realistic window lighting, cobra-head streetlights with warm road pools, and overhead expressway signs.
- **Stage 4 — Dedicated Chase Camera**: Extracted `src/engine/camera/ChaseCamera.ts` (`6.15m` near follow, `2.3m` height, `58°` base FOV, drift yaw lag, speed/Nitro FOV expansion, barrier avoidance, trauma² shake, reduced-motion scaling) and integrated it into `src/engine/RaceEngine.ts`.
- **Stage 6 — Bot Intelligence**: Upgraded `src/game/ai.ts` with arc-length look-ahead, curvature-based corner braking, persistent lane decisions, and seeded PRNG support verified by a full 7-bot simulated race test.
- **Stages 9 & 10 — Security & Multiplayer Protocol**: Upgraded `server.ts` to per-user salted `scrypt` password hashing, HMAC-SHA256 Bearer sessions, auth rate limiting, server-computed `/api/race/complete` rewards with replay protection, and validated WebSocket `PlayerInputMessage` handling; added `VITE_GAME_SERVER_WS_URL` & `VITE_API_BASE_URL` env support.

## Remaining Long-Term Roadmap Items
- External artist-authored multi-LOD `.glb` vehicle models (currently 100% high-detail procedural lofted geometry).
- Dedicated 20-player server-authoritative physics tick loop with client-side prediction and rollback reconciliation over real multi-client network tests.
