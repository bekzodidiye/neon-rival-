# NEON RIVALS V6.0 — Vehicle Asset Pipeline

## Architecture (`src/engine/assets/VehicleAssetLoader.ts`)
NEON RIVALS implements a full GLB/glTF vehicle loading and validation pipeline shared identically by the 3D Garage showcase and active gameplay:

1. **Manifest Registry (`VEHICLE_ASSET_REGISTRY`)**: Declares target `.glb` URLs, license metadata, and expected scene hierarchy (`Body`, `Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`, `Glass`).
2. **GLTFLoader + LoadingManager + Cache**: `VehicleAssetLoader` caches parsed `GLTF` templates in memory (`gltfCache`) and deduplicates concurrent requests (`pendingLoads`) while emitting download/validation progress callbacks via `onProgress()`.
3. **Model Validation & Material Injection (`validateAndConfigureVehicleGLTF`)**:
   - Verifies bounding dimensions fall within automotive scale (`2.5m–6.5m` length) and grounds bottom-center at `y = 0`.
   - Verifies all 4 separate wheel nodes (`Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`) exist for steering pivots, wheel spin, and 4-wheel suspension travel.
   - Configures automotive PBR `MeshPhysicalMaterial` (clearcoat, roughness, metallic response) on body/glass/rim nodes so player Garage customization works on imported models.
   - Reports triangle counts and validation notes.
4. **LOD & Resource Disposal**:
   - Mounts validated external GLB models via `THREE.LOD` while preserving gameplay VFX mounts (Nitro flames, shield dome, taillight trails, contact shadow).
   - `VehicleAssetLoader.dispose()` traverses cached GLTF scenes and disposes geometries and materials on unmount.

## Current Asset Status (Honest Disclosure)
- **External artist-authored `.glb` vehicle models**: **NOT INSTALLED (`available: false`)** in the current repository environment because licensed original or CC0 automotive `.glb` files cannot be fetched without external licensing verification.
- **Zero-404 Procedural Sculpted Fallback**: When `available: false`, `VehicleAssetLoader` avoids issuing broken network fetches and seamlessly instantiates the upgraded sculpted lofted procedural rigs (`src/engine/vehicleMesh.ts`) featuring curved fastback canopies, recessed wheel arches, hood/trunk panel shutline seams, multi-slat front grilles, twin/quad metallic exhausts, dual projector headlamps, alloy rims, brake discs, and calipers.
- **How to Drop In Real GLBs**: Place licensed `.glb` files at `/public/assets/vehicles/{street_falcon,night_viper,phantom_x,cyber_gt,sand_runner}.glb`, record provenance and license in `docs/ASSET_MANIFEST.md`, and flip `available: true` in `VEHICLE_ASSET_REGISTRY`.
