# NEON RIVALS — Stage 0 Baseline Audit (V5.0)

## 1. Repository & Tooling Snapshot
- **Stack**: React 19, TypeScript 7, Three.js 0.187, Vite 8.3, Express 4.21, `ws` 8.23, `vite-plugin-pwa` 2.0, `tsx` 4.21.
- **Pre-Rebuild Verification Baseline**:
  - `tsc --noEmit`: Passing (0 errors).
  - `vite build`: Passing.
  - `tsx --test src/game/gameLogic.test.ts`: 9/9 tests passing (track spline, physics acceleration/nitro/drift, power-up inventory, checkpoint progression, camera motion blur, V3.0 combat resolver, 4-block repair cap, 2-stage air-brake, handling archetypes & 10x combo).
  - `package.json`: Added `"test"` and `"typecheck"` scripts in Stage 0.

## 2. Verified Defects Identified Before V5.0 Rebuild
1. **Vehicle 3D Assets (`src/engine/vehicleMesh.ts`)**:
   - Built from blocky `ExtrudeGeometry` side profiles + stacked `BoxGeometry` fenders, roof caps, mirrors, and simple cylinder wheels lacking sculpted wheel arches, curved roofs, recessed greenhouses, brake discs/calipers, and distinct silhouette topology.
   - `phantom_x` defaulted to near-black `#181E2C` matte paint, reducing silhouette readability at night.
2. **Vehicle Physics (`src/game/physics.ts`)**:
   - Directly snapped `racer.y = proj.sample.y` every frame with zero suspension compression, vertical velocity, or ground contact simulation.
   - Used a uniform circular collision radius (`2.15m`) for every car regardless of vehicle length/width.
   - Included passive drift-charged Nitro (`Shift` key) and automatic post-drift boost in the default Blur Powered Racing ruleset, conflicting with 3-slot tactical Nitro inventory rules.
   - Instantaneous Class D acceleration (`acceleration: 39 m/s^2`, `topSpeed: 76 m/s`) felt artificially twitchy rather than progressive and weighted.
3. **Track Math & Environment (`src/game/trackMath.ts`, `src/engine/trackMesh.ts`, `src/engine/proceduralTextures.ts`)**:
   - Track spline was completely flat (`y = 0` everywhere) and used raw parameter `t` rather than an arc-length distance lookup table.
   - Checkpoint validation checked index proximity (`currentCp === nextCp || nextPlusOne`) instead of swept gate crossing with crossing direction validation.
   - City buildings used a single uniform `BoxGeometry` instanced mesh with bright multi-color square window patterns rather than multi-archetype urban architecture, curbs/sidewalks, bridge piers, and realistic nighttime street illumination.
4. **Chase Camera (`src/engine/RaceEngine.ts`)**:
   - Embedded inside the 2,251-line `RaceEngine.ts` with `backDist = 8.4m`, `camHeight = 3.55m` (slightly high/distant) and no wall-clipping avoidance.
5. **Multiplayer & Security (`server.ts`, `src/net/multiplayerClient.ts`)**:
   - Password hashing used single-pass `SHA-256` with a static prefix (`nr_salt_`) instead of `scrypt` with per-user random salt.
   - Auth endpoints issued no signed/verified session tokens; `/api/race/complete` accepted unauthenticated client-supplied `username`, `fanPoints`, and `wins`.
   - WebSocket client hardcoded `${proto}//${window.location.host}/ws` without `VITE_GAME_SERVER_WS_URL` support, and server rebroadcast client-authored `racer_state` directly.
