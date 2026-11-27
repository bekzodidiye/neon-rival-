# NEON RIVALS — Asset Manifest (V5.0)

All visual and audio assets currently shipped in Neon Rivals are **100% original procedural assets** generated in TypeScript/Three.js/Canvas2D/WebAudio with zero external hotlinks and zero third-party copyright dependencies.

## 1. Vehicle 3D Assets (`src/engine/vehicleMesh.ts`)
- **Architecture**: Parametric multi-section lofted `BufferGeometry` automotive bodies with recessed semicircular wheel-arch cutouts, crowned curved windshields/roofs, recessed window mullions, sculpted stalk mirrors, front splitters, rear diffusers, slotted brake discs, non-spinning calipers, LatheGeometry curved-sidewall tires & deep-dish alloy barrels, and `MeshPhysicalMaterial` automotive clearcoat paint.
- **Distinct Silhouettes Implemented**:
  - `street_falcon` (Class D, Balanced Sport Coupe) — Original procedural sculpted coupe (`modelStatus: 'sculpted'`).
  - `night_viper` (Class C, Drifty Muscle Interceptor) — Original procedural sculpted wide-haunch muscle car (`modelStatus: 'sculpted'`).
  - `phantom_x` (Class A, Grippy Mid-Engine Supercar) — Original procedural sculpted cab-forward wedge supercar with side intakes & rear engine louvers (`modelStatus: 'sculpted'`).
  - `cyber_gt` (Class B, Widebody GT Drift) — Original procedural sculpted widebody GT with front canards & rear GT wing (`modelStatus: 'sculpted'`).
  - `sand_runner` (Class D, Off-Road Rally Raid) — Original procedural lifted off-road silhouette with oversized treaded tires, skid plates, and roof light bar (`modelStatus: 'sculpted'`).
- **External `.glb` / `.gltf` Models**: None currently bundled in `public/assets/vehicles/` (no placeholder empty files created). All models are original procedural `BufferGeometry` assets.

## 2. Environment & Road Textures (`src/engine/proceduralTextures.ts`, `src/engine/trackMesh.ts`)
- **Road Surfaces**: Procedural 1024x1024 wet urban asphalt albedo + roughness maps with multi-scale grain, rubber tire grooves, lane markings, road edge lines, and curb detail.
- **City Architecture**: 4 procedural building archetypes (setback towers, chamfered glass corporate towers, mid-rise commercial blocks, industrial/parking blocks) with realistic tungsten/cool-white/slate urban office window facade maps and emissive masks.
- **Lighting & Sky**: Procedural Night-City PMREM environment, starry midnight sky dome, directional headlight beams, and feathered taillight trails.

## 3. Audio (`src/engine/audio.ts`)
- 100% procedural Web Audio API synthesizer (multi-oscillator RPM engine, drift tire scrub, Nitro turbine, all 8 combat power-up SFX, UI feedback).
