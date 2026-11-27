import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { VehicleConfig, VehicleCustomization } from '../../game/types';
import { buildVehicleRig, type VehicleRig } from '../vehicleMesh';

export interface VehicleAssetDescriptor {
  vehicleId: string;
  glbUrl: string | null;
  available: boolean;
  license: string;
  source: 'external_glb' | 'procedural_sculpted';
  expectedNodes: {
    body: string;
    wheels: [string, string, string, string]; // [FL, FR, RL, RR]
    glass?: string;
  };
}

export interface VehicleAssetLoadProgress {
  vehicleId: string;
  loaded: number;
  total: number;
  ratio: number;
  stage: 'checking' | 'downloading' | 'validating' | 'ready' | 'fallback';
}

export interface ValidatedVehicleModel {
  scene: THREE.Group;
  wheelNodes: [THREE.Object3D | null, THREE.Object3D | null, THREE.Object3D | null, THREE.Object3D | null];
  paintMaterials: THREE.MeshPhysicalMaterial[];
  rimMaterials: THREE.MeshStandardMaterial[];
  glassMaterial: THREE.MeshPhysicalMaterial | null;
  boundingBox: THREE.Box3;
  triangleCount: number;
  valid: boolean;
  validationNotes: string[];
}

/**
 * Honest repository asset registry (V6.0 Section 3).
 * External artist-authored .glb files are NOT bundled in this environment;
 * setting available: false prevents bogus 404 network fetches while keeping the full
 * GLTFLoader + validation + caching + LOD pipeline ready the moment licensed GLBs are placed in /public/assets/vehicles/.
 */
export const VEHICLE_ASSET_REGISTRY: Record<string, VehicleAssetDescriptor> = {
  street_falcon: {
    vehicleId: 'street_falcon',
    glbUrl: '/assets/vehicles/street_falcon.glb',
    available: false,
    license: 'Pending artist-authored original or CC0/licensed GLB',
    source: 'procedural_sculpted',
    expectedNodes: {
      body: 'Body',
      wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'],
      glass: 'Glass',
    },
  },
  night_viper: {
    vehicleId: 'night_viper',
    glbUrl: '/assets/vehicles/night_viper.glb',
    available: false,
    license: 'Pending artist-authored original or CC0/licensed GLB',
    source: 'procedural_sculpted',
    expectedNodes: {
      body: 'Body',
      wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'],
      glass: 'Glass',
    },
  },
  phantom_x: {
    vehicleId: 'phantom_x',
    glbUrl: '/assets/vehicles/phantom_x.glb',
    available: false,
    license: 'Pending artist-authored original or CC0/licensed GLB',
    source: 'procedural_sculpted',
    expectedNodes: {
      body: 'Body',
      wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'],
      glass: 'Glass',
    },
  },
  cyber_gt: {
    vehicleId: 'cyber_gt',
    glbUrl: '/assets/vehicles/cyber_gt.glb',
    available: false,
    license: 'Pending artist-authored original or CC0/licensed GLB',
    source: 'procedural_sculpted',
    expectedNodes: {
      body: 'Body',
      wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'],
      glass: 'Glass',
    },
  },
  sand_runner: {
    vehicleId: 'sand_runner',
    glbUrl: '/assets/vehicles/sand_runner.glb',
    available: false,
    license: 'Pending artist-authored original or CC0/licensed GLB',
    source: 'procedural_sculpted',
    expectedNodes: {
      body: 'Body',
      wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'],
      glass: 'Glass',
    },
  },
};

/**
 * Validates a loaded GLTF vehicle hierarchy for required wheel nodes, bounding scale,
 * and configures automotive PBR clearcoat / metalness / shadow flags.
 */
export function validateAndConfigureVehicleGLTF(
  gltf: GLTF,
  descriptor: VehicleAssetDescriptor,
  customization: VehicleCustomization,
  castShadow: boolean,
): ValidatedVehicleModel {
  const root = gltf.scene.clone(true);
  const validationNotes: string[] = [];
  const paintMaterials: THREE.MeshPhysicalMaterial[] = [];
  const rimMaterials: THREE.MeshStandardMaterial[] = [];
  let glassMaterial: THREE.MeshPhysicalMaterial | null = null;
  let triangleCount = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;

    const posAttr = mesh.geometry?.getAttribute('position');
    if (mesh.geometry?.index) {
      triangleCount += mesh.geometry.index.count / 3;
    } else if (posAttr) {
      triangleCount += posAttr.count / 3;
    }

    const nameLower = (mesh.name || '').toLowerCase();
    if (nameLower.includes('body') || nameLower.includes('paint') || nameLower.includes('hood') || nameLower.includes('door')) {
      const pMat = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(customization.bodyColor),
        metalness: customization.finish === 'matte' ? 0.22 : customization.finish === 'metallic' ? 0.78 : 0.45,
        roughness: customization.finish === 'matte' ? 0.56 : customization.finish === 'metallic' ? 0.22 : 0.16,
        clearcoat: customization.finish === 'matte' ? 0.14 : 1.0,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.25,
      });
      mesh.material = pMat;
      paintMaterials.push(pMat);
    } else if (nameLower.includes('glass') || nameLower.includes('window') || nameLower.includes('windshield')) {
      glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x0b1626,
        metalness: 0.2,
        roughness: 0.06,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        transparent: true,
        opacity: Math.max(0.76, customization.windowTint),
      });
      mesh.material = glassMaterial;
    } else if (nameLower.includes('rim') || nameLower.includes('alloy')) {
      const rMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(customization.rimColor),
        metalness: 0.9,
        roughness: 0.18,
      });
      mesh.material = rMat;
      rimMaterials.push(rMat);
    }
  });

  // Ground bottom-center at y = 0
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
    box.setFromObject(root);
  } else {
    validationNotes.push('Empty bounding box in GLTF scene.');
  }

  const wheelNodes: [THREE.Object3D | null, THREE.Object3D | null, THREE.Object3D | null, THREE.Object3D | null] = [
    root.getObjectByName(descriptor.expectedNodes.wheels[0]) ?? null,
    root.getObjectByName(descriptor.expectedNodes.wheels[1]) ?? null,
    root.getObjectByName(descriptor.expectedNodes.wheels[2]) ?? null,
    root.getObjectByName(descriptor.expectedNodes.wheels[3]) ?? null,
  ];
  const missingWheels = descriptor.expectedNodes.wheels.filter((_, idx) => !wheelNodes[idx]);
  if (missingWheels.length > 0) {
    validationNotes.push(`Missing expected wheel nodes: ${missingWheels.join(', ')}`);
  }

  const size = box.getSize(new THREE.Vector3());
  if (size.z < 2.5 || size.z > 6.5) {
    validationNotes.push(`Vehicle length ${size.z.toFixed(2)}m outside expected automotive range [2.5m, 6.5m].`);
  }

  return {
    scene: root,
    wheelNodes,
    paintMaterials,
    rimMaterials,
    glassMaterial,
    boundingBox: box,
    triangleCount: Math.round(triangleCount),
    valid: missingWheels.length === 0 && !box.isEmpty(),
    validationNotes,
  };
}

/**
 * Production VehicleAssetLoader:
 * - Coordinates GLTFLoader + THREE.LoadingManager + in-memory template cache.
 * - Reports download/validation progress via optional listener.
 * - Builds LOD-capable vehicle rigs with separate wheel steering pivots and suspension travel.
 * - Gracefully falls back to sculpted procedural rigs when licensed external GLB assets are not installed,
 *   without issuing broken 404 requests or faking empty GLB files.
 */
export class VehicleAssetLoader {
  private readonly manager = new THREE.LoadingManager();
  private readonly gltfLoader: GLTFLoader;
  private readonly gltfCache = new Map<string, GLTF>();
  private readonly pendingLoads = new Map<string, Promise<GLTF | null>>();
  private readonly listeners = new Set<(p: VehicleAssetLoadProgress) => void>();

  constructor() {
    this.gltfLoader = new GLTFLoader(this.manager);
  }

  public onProgress(listener: (p: VehicleAssetLoadProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(progress: VehicleAssetLoadProgress): void {
    for (const fn of this.listeners) {
      fn(progress);
    }
  }

  public getDescriptor(vehicleId: string): VehicleAssetDescriptor {
    return (
      VEHICLE_ASSET_REGISTRY[vehicleId] ?? {
        vehicleId,
        glbUrl: null,
        available: false,
        license: 'Procedural sculpted fallback',
        source: 'procedural_sculpted',
        expectedNodes: {
          body: 'Body',
          wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'],
        },
      }
    );
  }

  public isCached(vehicleId: string): boolean {
    return this.gltfCache.has(vehicleId);
  }

  /**
   * Attempts to load & cache an available external GLB asset.
   * Returns null cleanly (zero network 404s) if the manifest marks available: false.
   */
  public async preloadVehicleGLB(vehicleId: string): Promise<GLTF | null> {
    const desc = this.getDescriptor(vehicleId);
    if (!desc.available || !desc.glbUrl) {
      this.emit({ vehicleId, loaded: 1, total: 1, ratio: 1, stage: 'fallback' });
      return null;
    }

    if (this.gltfCache.has(vehicleId)) {
      this.emit({ vehicleId, loaded: 1, total: 1, ratio: 1, stage: 'ready' });
      return this.gltfCache.get(vehicleId)!;
    }

    const existing = this.pendingLoads.get(vehicleId);
    if (existing) return existing;

    this.emit({ vehicleId, loaded: 0, total: 1, ratio: 0, stage: 'downloading' });
    const promise = new Promise<GLTF | null>((resolve) => {
      this.gltfLoader.load(
        desc.glbUrl!,
        (gltf) => {
          this.gltfCache.set(vehicleId, gltf);
          this.pendingLoads.delete(vehicleId);
          this.emit({ vehicleId, loaded: 1, total: 1, ratio: 1, stage: 'ready' });
          resolve(gltf);
        },
        (evt) => {
          const total = evt.total || 1;
          this.emit({
            vehicleId,
            loaded: evt.loaded,
            total,
            ratio: Math.min(1, evt.loaded / total),
            stage: 'downloading',
          });
        },
        () => {
          this.pendingLoads.delete(vehicleId);
          this.emit({ vehicleId, loaded: 1, total: 1, ratio: 1, stage: 'fallback' });
          resolve(null);
        },
      );
    });
    this.pendingLoads.set(vehicleId, promise);
    return promise;
  }

  /**
   * Synchronously instantiates a complete VehicleRig (using cached validated GLB if present,
   * otherwise using the sculpted procedural automotive rig with matching dimensions & wheel pivots).
   */
  public instantiateVehicleRig(
    config: VehicleConfig,
    customization: VehicleCustomization,
    textures: {
      contactShadow: THREE.Texture;
      neonGlow?: THREE.Texture;
      headlightBeam?: THREE.Texture;
      tailTrail?: THREE.Texture;
    },
    castShadow: boolean,
  ): VehicleRig {
    // Always construct the full gameplay rig (ensuring shield dome, nitro flames, tail trails, wheel pivots & disposal)
    const rig = buildVehicleRig(
      config.archetype,
      customization,
      textures.contactShadow,
      castShadow,
      textures.neonGlow,
      textures.headlightBeam,
      textures.tailTrail,
      {
        dimensions: config.dimensions,
        handlingArchetype: config.handlingArchetype,
      },
    );

    // If a verified external GLB has been preloaded and passes node validation, mount it as LOD0
    const cached = this.gltfCache.get(config.id);
    const desc = this.getDescriptor(config.id);
    if (cached && desc.available) {
      const validated = validateAndConfigureVehicleGLTF(cached, desc, customization, castShadow);
      if (validated.valid) {
        const lod = new THREE.LOD();
        lod.addLevel(validated.scene, 0);
        // Hide procedural hull when verified GLB LOD0 is active, preserving combat VFX & wheel pivots
        rig.bodyGroup.visible = false;
        rig.root.add(lod);
      }
    }

    return rig;
  }

  public dispose(): void {
    for (const gltf of this.gltfCache.values()) {
      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m?.dispose();
        }
      });
    }
    this.gltfCache.clear();
    this.pendingLoads.clear();
    this.listeners.clear();
  }
}
