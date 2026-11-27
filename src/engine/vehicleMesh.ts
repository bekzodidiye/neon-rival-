import * as THREE from 'three';
import type { VehicleArchetype, VehicleCustomization } from '../game/types';

export interface VehicleRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheelPivots: THREE.Group[]; // [FL, FR, RL, RR]
  wheelMeshes: THREE.Group[]; // [FL, FR, RL, RR] spin containers
  paintMaterials: THREE.MeshPhysicalMaterial[];
  rimMaterials: THREE.MeshStandardMaterial[];
  glassMaterial: THREE.MeshPhysicalMaterial;
  underglowMaterial: THREE.MeshBasicMaterial;
  headlightMaterial: THREE.MeshStandardMaterial;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  nitroFlames: THREE.Mesh[];
  tailTrails: THREE.Mesh[];
  tailTrailMaterial: THREE.MeshBasicMaterial;
  shieldDome: THREE.Mesh;
  spoilerGroup: THREE.Group;
  hitFlashMaterials: THREE.MeshPhysicalMaterial[];
  dispose: () => void;
}

/**
 * Builds a composite 12+ part procedural 3D sports car silhouette (bottom-center grounded at y=0, facing +Z).
 * Distinct proportions and sculpted geometry per archetype: coupe, muscle, gt, supercar.
 */
export function buildVehicleRig(
  archetype: VehicleArchetype,
  customization: VehicleCustomization,
  contactShadowTex: THREE.Texture,
  castShadow = true,
  neonGlowTex?: THREE.Texture,
  headlightBeamTex?: THREE.Texture,
  tailTrailTex?: THREE.Texture,
): VehicleRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const isSupercar = archetype === 'supercar';
  const isMuscle = archetype === 'muscle';
  const isGt = archetype === 'gt';

  const carLength = isMuscle ? 4.65 : isSupercar ? 4.55 : 4.42;
  const carWidth = isSupercar ? 2.08 : isGt ? 2.04 : 1.96;
  const deckHeight = isSupercar ? 0.62 : isMuscle ? 0.74 : 0.68;
  const cabinHeight = isSupercar ? 0.42 : isMuscle ? 0.48 : 0.46;

  // Materials with deliberate roughness/metalness contrast
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(customization.bodyColor),
    metalness: customization.finish === 'matte' ? 0.18 : customization.finish === 'metallic' ? 0.72 : 0.42,
    roughness: customization.finish === 'matte' ? 0.68 : customization.finish === 'metallic' ? 0.22 : 0.16,
    clearcoat: customization.finish === 'matte' ? 0.08 : 1.0,
    clearcoatRoughness: 0.1,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x111520,
    roughness: 0.72,
    metalness: 0.35,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x171c28,
    roughness: 0.42,
    metalness: 0.55,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x091322,
    metalness: 0.25,
    roughness: 0.08,
    clearcoat: 1.0,
    transparent: true,
    opacity: customization.windowTint,
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.rimColor),
    metalness: 0.88,
    roughness: 0.2,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x14171f,
    roughness: 0.88,
    metalness: 0.05,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.headlightColor),
    emissive: new THREE.Color(customization.headlightColor),
    emissiveIntensity: 2.2,
    roughness: 0.1,
  });

  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: 0xff1e44,
    emissive: new THREE.Color(0xff1e44),
    emissiveIntensity: 1.6,
    roughness: 0.15,
  });

  const underglowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.underglowColor),
    map: neonGlowTex ?? null,
    transparent: true,
    opacity: neonGlowTex ? 0.88 : 0.65,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  // 1. Sculpted Main Chassis Hull via beveled ExtrudeGeometry (side profile extruded across width)
  const hullShape = new THREE.Shape();
  const halfL = carLength * 0.5;
  const noseH = isSupercar ? 0.36 : isMuscle ? 0.52 : 0.42;
  const tailH = isSupercar ? 0.58 : isMuscle ? 0.64 : 0.6;
  hullShape.moveTo(-halfL, 0.28);
  hullShape.lineTo(halfL - 0.12, 0.25);
  hullShape.lineTo(halfL, noseH);
  hullShape.lineTo(halfL - 0.65, deckHeight * 0.92);
  hullShape.lineTo(0.75, deckHeight);
  hullShape.lineTo(-0.95, deckHeight * 1.04);
  hullShape.lineTo(-halfL + 0.12, tailH);
  hullShape.lineTo(-halfL, 0.36);
  hullShape.closePath();

  const hullGeo = trackGeo(
    new THREE.ExtrudeGeometry(hullShape, {
      depth: carWidth - 0.22,
      bevelEnabled: true,
      bevelThickness: 0.11,
      bevelSize: 0.08,
      bevelSegments: 2,
    }),
  );
  // Rotate so X is width, Y is height, Z is forward (+halfL is front nose)
  hullGeo.rotateY(-Math.PI / 2);
  hullGeo.translate((carWidth - 0.22) * 0.5, 0, 0);
  const hullMesh = new THREE.Mesh(hullGeo, paintMat);
  hullMesh.castShadow = castShadow;
  hullMesh.receiveShadow = true;
  bodyGroup.add(hullMesh);

  // 2. Sculpted Greenhouse Cabin + Windshield & Rear Fastback Glass
  const cabinShape = new THREE.Shape();
  const cabFrontZ = isSupercar ? 0.96 : isMuscle ? 0.68 : 0.8;
  const cabRearZ = isSupercar ? -1.45 : isMuscle ? -1.28 : -1.38;
  const roofFrontZ = cabFrontZ - 0.64;
  const roofRearZ = cabRearZ + 0.54;
  cabinShape.moveTo(cabRearZ, deckHeight - 0.04);
  cabinShape.lineTo(cabFrontZ, deckHeight - 0.06);
  cabinShape.lineTo(roofFrontZ, deckHeight + cabinHeight);
  cabinShape.lineTo(roofRearZ, deckHeight + cabinHeight * 0.97);
  cabinShape.closePath();

  const cabinGeo = trackGeo(
    new THREE.ExtrudeGeometry(cabinShape, {
      depth: carWidth * 0.7,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.05,
      bevelSegments: 2,
    }),
  );
  cabinGeo.rotateY(-Math.PI / 2);
  cabinGeo.translate((carWidth * 0.7) * 0.5, 0, 0);
  const cabinMesh = new THREE.Mesh(cabinGeo, glassMat);
  cabinMesh.castShadow = castShadow;
  bodyGroup.add(cabinMesh);

  // 3. Flush Painted Roof Cap aligned exactly with cabin top span (zero overhang)
  const roofLen = Math.max(0.55, roofFrontZ - roofRearZ);
  const roofCenterZ = (roofFrontZ + roofRearZ) * 0.5;
  const roofGeo = trackGeo(new THREE.BoxGeometry(carWidth * 0.68, 0.06, roofLen + 0.04));
  const roofMesh = new THREE.Mesh(roofGeo, paintMat);
  roofMesh.position.set(0, deckHeight + cabinHeight + 0.015, roofCenterZ);
  roofMesh.castShadow = castShadow;
  bodyGroup.add(roofMesh);

  // Sculpted aerodynamic side mirrors
  const mirrorGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.08, 0.14));
  for (const sx of [-1, 1]) {
    const mirror = new THREE.Mesh(mirrorGeo, paintMat);
    mirror.position.set(sx * (carWidth * 0.46), deckHeight + 0.13, cabFrontZ - 0.34);
    bodyGroup.add(mirror);
  }

  // 4. Sculpted Hood Power Bulge / Side Fenders (Archetype-specific character)
  const fenderGeo = trackGeo(new THREE.BoxGeometry(0.28, 0.28, 1.35));
  for (const sx of [-1, 1]) {
    const frontFender = new THREE.Mesh(fenderGeo, paintMat);
    frontFender.position.set(sx * (carWidth * 0.44), 0.55, 1.25);
    frontFender.castShadow = castShadow;
    bodyGroup.add(frontFender);

    const rearHaunch = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.32, 0.34, 1.48)),
      paintMat,
    );
    rearHaunch.position.set(sx * (carWidth * 0.45), 0.6, -1.22);
    rearHaunch.castShadow = castShadow;
    bodyGroup.add(rearHaunch);
  }

  if (isMuscle) {
    // Muscle car twin hood intake scoop
    const scoop = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.68, 0.14, 1.05)), carbonMat);
    scoop.position.set(0, deckHeight + 0.05, 1.15);
    bodyGroup.add(scoop);
  } else if (isSupercar) {
    // Supercar roof snorkel + side aero vents
    const snorkel = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 0.12, 0.72)), carbonMat);
    snorkel.position.set(0, deckHeight + cabinHeight + 0.06, -0.58);
    bodyGroup.add(snorkel);
  }

  // 5. Front Splitter, Grille Air Intake & Rear Diffuser
  const splitter = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 1.02, 0.08, 0.55)), carbonMat);
  splitter.position.set(0, 0.21, halfL - 0.12);
  bodyGroup.add(splitter);

  const grille = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.62, 0.18, 0.12)), trimMat);
  grille.position.set(0, 0.34, halfL + 0.02);
  bodyGroup.add(grille);

  const diffuser = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.94, 0.22, 0.34)), carbonMat);
  diffuser.position.set(0, 0.27, -halfL + 0.04);
  bodyGroup.add(diffuser);

  // Side Skirts
  const skirtGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.11, 2.2));
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(skirtGeo, carbonMat);
    skirt.position.set(sx * (carWidth * 0.49), 0.23, 0);
    bodyGroup.add(skirt);
  }

  // 6. LED Headlights, Road Light Cones & Full-Width Neon Tail-Light Bar + Dynamic Light Trails
  const hlGeo = trackGeo(new THREE.BoxGeometry(0.44, 0.09, 0.14));
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(hlGeo, headlightMat);
    hl.position.set(sx * (carWidth * 0.34), 0.48, halfL - 0.02);
    hl.rotation.y = sx * -0.18;
    bodyGroup.add(hl);
  }

  let hlBeamMat: THREE.MeshBasicMaterial | null = null;
  if (headlightBeamTex) {
    const beamGeo = trackGeo(new THREE.PlaneGeometry(1.6, 10.5));
    beamGeo.rotateX(-Math.PI / 2);
    hlBeamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(customization.headlightColor),
      map: headlightBeamTex,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const sx of [-1, 1]) {
      const cone = new THREE.Mesh(beamGeo, hlBeamMat);
      cone.position.set(sx * (carWidth * 0.36), 0.06, halfL + 5.25);
      root.add(cone);
    }
  }

  const tailBar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.86, 0.1, 0.1)), brakeLightMat);
  tailBar.position.set(0, 0.58, -halfL - 0.02);
  bodyGroup.add(tailBar);

  // Iconic Blur dynamic glowing taillight ribbon trails streaming behind at speed
  const tailTrailMat = new THREE.MeshBasicMaterial({
    color: 0xff2248,
    map: tailTrailTex ?? null,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const trailGeo = trackGeo(new THREE.PlaneGeometry(0.15, 1));
  // UV v=1 is at +Y before rotateX, which becomes -Z (far end); rotate +PI/2 so v=0 (bright top of canvas) sits at taillight (z=0) and fades toward -Z
  trailGeo.rotateX(Math.PI / 2);
  trailGeo.translate(0, 0, -0.5);
  const tailTrails: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const trail = new THREE.Mesh(trailGeo, tailTrailMat);
    trail.position.set(sx * (carWidth * 0.38), 0.56, -halfL - 0.05);
    trail.visible = false;
    bodyGroup.add(trail);
    tailTrails.push(trail);
  }

  // 7. Twin Exhaust Tips + Dynamic Nitro Flame Cones
  const exhaustGeo = trackGeo(new THREE.CylinderGeometry(0.065, 0.075, 0.24, 10));
  exhaustGeo.rotateX(Math.PI / 2);
  const flameGeo = trackGeo(new THREE.ConeGeometry(0.13, 1.35, 8));
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.nitroColor),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const nitroFlames: THREE.Mesh[] = [];
  for (const sx of [-0.42, 0.42]) {
    const ex = new THREE.Mesh(exhaustGeo, rimMat);
    ex.position.set(sx, 0.27, -halfL - 0.05);
    bodyGroup.add(ex);

    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(sx, 0.27, -halfL - 0.75);
    flame.visible = false;
    bodyGroup.add(flame);
    nitroFlames.push(flame);
  }

  // 8. Customizable Rear Spoiler Group
  const spoilerGroup = new THREE.Group();
  spoilerGroup.position.set(0, tailH + 0.08, -halfL + 0.22);
  bodyGroup.add(spoilerGroup);
  rebuildSpoiler(spoilerGroup, customization.spoiler, carWidth, paintMat, carbonMat);

  // 9. Four Separate Wheels (Tires + Multi-Spoke Rims + Brake Calipers)
  const wheelPivots: THREE.Group[] = [];
  const wheelMeshes: THREE.Group[] = [];
  const wheelZFront = halfL - 0.92;
  const wheelZRear = -halfL + 0.92;
  const wheelX = carWidth * 0.47;
  const wheelRadius = 0.36;

  const tireGeo = trackGeo(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.28, 18));
  tireGeo.rotateZ(Math.PI / 2);
  const rimHubGeo = trackGeo(new THREE.CylinderGeometry(wheelRadius * 0.64, wheelRadius * 0.64, 0.295, 12));
  rimHubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = trackGeo(new THREE.BoxGeometry(0.31, wheelRadius * 1.15, 0.055));

  const wheelPositions: [number, number, number][] = [
    [wheelX, wheelRadius, wheelZFront],
    [-wheelX, wheelRadius, wheelZFront],
    [wheelX, wheelRadius, wheelZRear],
    [-wheelX, wheelRadius, wheelZRear],
  ];

  for (const [wx, wy, wz] of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    const spinGroup = new THREE.Group();
    pivot.add(spinGroup);

    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = castShadow;
    spinGroup.add(tire);

    const hub = new THREE.Mesh(rimHubGeo, rimMat);
    spinGroup.add(hub);

    // 3 intersecting spoke bars = 6-spoke sport alloy wheel
    for (let k = 0; k < 3; k++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (k * Math.PI) / 3;
      spinGroup.add(spoke);
    }

    root.add(pivot);
    wheelPivots.push(pivot);
    wheelMeshes.push(spinGroup);
  }

  // 10. Ground Contact Shadow Plane (prevents floating appearance) + Neon Underglow Strip
  const shadowGeo = trackGeo(new THREE.PlaneGeometry(carWidth * 1.45, carLength * 1.24));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.position.y = 0.025;
  root.add(shadowPlane);

  const glowGeo = trackGeo(new THREE.PlaneGeometry(carWidth * 1.65, carLength * 1.28));
  glowGeo.rotateX(-Math.PI / 2);
  const glowPlane = new THREE.Mesh(glowGeo, underglowMat);
  glowPlane.position.y = 0.045;
  root.add(glowPlane);

  // 11. Transparent Cyan Hexagonal Energy Shield Dome (toggled when SHIELD active)
  const shieldGeo = trackGeo(new THREE.IcosahedronGeometry(2.85, 1));
  const shieldMat = new THREE.MeshBasicMaterial({
    color: 0x00d8ff,
    wireframe: true,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shieldInnerMat = new THREE.MeshBasicMaterial({
    color: 0x00c8ff,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shieldDome = new THREE.Mesh(shieldGeo, shieldMat);
  shieldDome.add(new THREE.Mesh(shieldGeo, shieldInnerMat));
  shieldDome.scale.set(0.72, 0.56, 1.04);
  shieldDome.position.set(0, 0.9, 0);
  shieldDome.visible = false;
  root.add(shieldDome);

  return {
    root,
    bodyGroup,
    wheelPivots,
    wheelMeshes,
    paintMaterials: [paintMat],
    rimMaterials: [rimMat],
    glassMaterial: glassMat,
    underglowMaterial: underglowMat,
    headlightMaterial: headlightMat,
    brakeLightMaterial: brakeLightMat,
    nitroFlames,
    tailTrails,
    tailTrailMaterial: tailTrailMat,
    shieldDome,
    spoilerGroup,
    hitFlashMaterials: [paintMat],
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      paintMat.dispose();
      trimMat.dispose();
      carbonMat.dispose();
      glassMat.dispose();
      rimMat.dispose();
      tireMat.dispose();
      headlightMat.dispose();
      brakeLightMat.dispose();
      underglowMat.dispose();
      flameMat.dispose();
      tailTrailMat.dispose();
      hlBeamMat?.dispose();
      shadowMat.dispose();
      shieldMat.dispose();
      shieldInnerMat.dispose();
    },
  };
}

function rebuildSpoiler(
  group: THREE.Group,
  style: VehicleCustomization['spoiler'],
  carWidth: number,
  paintMat: THREE.Material,
  carbonMat: THREE.Material,
): void {
  while (group.children.length > 0) {
    const child = group.children[0] as THREE.Mesh;
    group.remove(child);
    child.geometry?.dispose();
  }
  if (style === 'none') return;

  const height = style === 'wing' ? 0.34 : style === 'gt' ? 0.26 : 0.14;
  const wingWidth = style === 'wing' ? carWidth * 1.06 : style === 'gt' ? carWidth * 0.98 : carWidth * 0.86;

  // Struts
  const strutGeo = new THREE.BoxGeometry(0.07, height, 0.22);
  for (const sx of [-0.46, 0.46]) {
    const strut = new THREE.Mesh(strutGeo, carbonMat);
    strut.position.set(sx, height * 0.5, 0);
    group.add(strut);
  }

  // Main airfoil blade
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(wingWidth, 0.055, style === 'street' ? 0.24 : 0.34),
    style === 'street' ? paintMat : carbonMat,
  );
  blade.position.set(0, height + 0.02, -0.05);
  blade.rotation.x = 0.08;
  group.add(blade);

  // Endplates on GT / Wing spoilers
  if (style === 'gt' || style === 'wing') {
    const plateGeo = new THREE.BoxGeometry(0.04, 0.22, 0.42);
    for (const sx of [-1, 1]) {
      const plate = new THREE.Mesh(plateGeo, paintMat);
      plate.position.set(sx * (wingWidth * 0.5), height + 0.02, -0.05);
      group.add(plate);
    }
  }
}

export function applyVehicleCustomization(rig: VehicleRig, custom: VehicleCustomization): void {
  for (const mat of rig.paintMaterials) {
    mat.color.set(custom.bodyColor);
    mat.metalness = custom.finish === 'matte' ? 0.18 : custom.finish === 'metallic' ? 0.72 : 0.42;
    mat.roughness = custom.finish === 'matte' ? 0.68 : custom.finish === 'metallic' ? 0.22 : 0.16;
    mat.clearcoat = custom.finish === 'matte' ? 0.08 : 1.0;
    mat.needsUpdate = true;
  }
  for (const mat of rig.rimMaterials) {
    mat.color.set(custom.rimColor);
  }
  rig.underglowMaterial.color.set(custom.underglowColor);
  rig.headlightMaterial.color.set(custom.headlightColor);
  rig.headlightMaterial.emissive.set(custom.headlightColor);
  rig.glassMaterial.opacity = custom.windowTint;
  for (const f of rig.nitroFlames) {
    (f.material as THREE.MeshBasicMaterial).color.set(custom.nitroColor);
  }

  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x171c28, roughness: 0.42, metalness: 0.55 });
  rebuildSpoiler(rig.spoilerGroup, custom.spoiler, 2.0, rig.paintMaterials[0], carbonMat);
}
