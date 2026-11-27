# NEON RIVALS — Asset Manifest (V6.0)

All visual and audio assets currently shipped in Neon Rivals are **100% original procedural assets** generated in TypeScript/Three.js/Canvas2D/WebAudio with zero external hotlinks, zero proprietary Blur assets, and zero fake/empty `.glb` placeholders.

## 1. Vehicle Asset Pipeline (`src/engine/assets/VehicleAssetLoader.ts` & `src/engine/vehicleMesh.ts`)
- **Production GLB Pipeline (Ready, Awaiting Licensed Models)**:
  - `VehicleAssetLoader` wraps Three.js `GLTFLoader` and `THREE.LoadingManager` with per-vehicle caching, progress callbacks, structural node validation (`Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`), bounding-box/triangle budget checks, automotive PBR clearcoat/glass/rim material assignment, `THREE.LOD` support, and full geometry/material/texture `dispose()`.
  - `VEHICLE_ASSET_REGISTRY` explicitly marks `available: false` for all five vehicles until verified licensed `.glb` models are placed under `public/assets/vehicles/` (preventing broken 404 requests while cleanly falling back to the sculpted procedural meshes).
- **Active Procedural Sculpted Vehicles (`src/engine/vehicleMesh.ts` — V6.0 Upgraded)**:
  - 34-station parametric lofted `BufferGeometry` bodies with recessed wheel arches, crowned wrap-around greenhouses, stalk mirrors, door seams, **V6.0 hood and trunk panel shutline seams**, **multi-slat recessed front grilles with flanking brake-cooling intakes**, **twin/quad polished metallic exhaust tips in rear diffusers**, **dual inner projector headlamp lenses**, slotted brake discs, fixed calipers, LatheGeometry tires/deep-dish alloy wheels, and `MeshPhysicalMaterial` automotive clearcoat paint.
  - **Same asset loader & models shared across Garage showcase and live Gameplay**:
    - `street_falcon` (Class D, Balanced Sport Coupe) — Procedural sculpted fallback (`glbAvailable: false`).
    - `night_viper` (Class C, Drifty Muscle Interceptor) — Procedural sculpted fallback (`glbAvailable: false`).
    - `phantom_x` (Class A, Grippy Mid-Engine Supercar) — Procedural sculpted fallback (`glbAvailable: false`).
    - `cyber_gt` (Class B, Widebody GT Drift) — Procedural sculpted fallback (`glbAvailable: false`).
    - `sand_runner` (Class D, Off-Road Rally Raid) — Procedural sculpted fallback (`glbAvailable: false`).

## 2. Environment, Lighting & Road Assets (`src/engine/lighting.ts`, `src/engine/trackMesh.ts`, `src/engine/proceduralTextures.ts`)
- **Lighting & Sky Profiles (`src/engine/lighting.ts`)**:
  - `neon_city` → **Night** profile (cool midnight ambient, warm urban street accents, deep starry dome, night PMREM reflections).
  - `industrial_port` → **Day** profile (crisp daylight sun, sky-ground hemisphere fill, atmospheric haze, bright daylight PMREM reflections).
  - `midnight_streets` → **Sunset** profile (low golden-amber sun, violet twilight fill, warm horizon sky dome, sunset PMREM reflections).
- **Road Surfaces & Street Furniture**:
  - Procedural 1024×1024 wet urban asphalt albedo + roughness maps with rubber tire grooves, lane lines, curbs, sidewalks, guardrails, bridge piers, overhead expressway gantries, and **V6.0 instanced roadside concrete planters with urban trees and cantilevered traffic signal assemblies** on Neon City.
- **City Architecture**:
  - 4 procedural metropolitan building archetypes with realistic tungsten/cool-white/slate office window facade maps and emissive masks.

## 3. Audio (`src/engine/audio.ts`)
- 100% procedural Web Audio API synthesizer (multi-oscillator RPM engine, drift tire scrub, Nitro turbine, all 8 combat power-up SFX, UI feedback).
