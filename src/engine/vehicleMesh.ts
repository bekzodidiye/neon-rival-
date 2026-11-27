import * as THREE from 'three';
import type { HandlingArchetype, VehicleArchetype, VehicleCustomization, VehicleDimensions } from '../game/types';

export interface VehicleRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheelPivots: THREE.Group[]; // [FL, FR, RL, RR]
  wheelMeshes: THREE.Group[]; // [FL, FR, RL, RR] spin containers
  wheelBaseY: number[]; // rest local Y per wheel for suspension animation
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

export interface VehicleRigOptions {
  dimensions?: VehicleDimensions;
  handlingArchetype?: HandlingArchetype;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Builds a genuinely sculpted, multi-section lofted BufferGeometry automotive body shell
 * with curved fenders, tucked doors, hood crease/power-dome, tapered nose/tail,
 * and real semicircular recessed wheel-arch cutouts (zero boxy slabs).
 */
function buildSculptedBodyGeometry(
  len: number,
  width: number,
  deckH: number,
  wheelZFront: number,
  wheelZRear: number,
  wheelRadius: number,
  rideH: number,
  archetype: VehicleArchetype,
  isOffroad: boolean,
): THREE.BufferGeometry {
  const halfL = len * 0.5;
  const halfW = width * 0.5;
  const isSupercar = archetype === 'supercar';
  const isMuscle = archetype === 'muscle';
  const isGt = archetype === 'gt';

  const archR = wheelRadius + (isOffroad ? 0.13 : 0.085);
  const archCenterY = wheelRadius;

  // Longitudinal stations concentrated around nose, wheel arches, and tail for smooth curves
  const zStations: number[] = [];
  const rawSteps = 34;
  for (let i = 0; i <= rawSteps; i++) {
    const u = i / rawSteps;
    // Slight cosine clustering near nose and tail for crisp sculpted bumpers
    const z = -halfL + len * u;
    zStations.push(z);
  }

  // Profile stations from bottom-center -> lower sill/arch -> flared shoulder -> deck edge -> center crest (right half, then mirrored left half)
  // 13 points around full cross-section perimeter (left-center-bottom -> left side -> top center -> right side -> right-center-bottom)
  const rings: { x: number; y: number; z: number; u: number; v: number }[][] = [];

  for (let zi = 0; zi < zStations.length; zi++) {
    const z = zStations[zi];
    const zn = z / halfL; // -1 (rear) .. +1 (front)
    const vTex = (zn + 1) * 0.5;

    // 1. Plan-view width curve: tapered nose, flared fenders, subtle wasp-waist doors, muscular rear haunches
    const noseTaper = 1 - Math.pow(Math.max(0, (zn - 0.62) / 0.38), 2.1) * (isSupercar ? 0.24 : 0.18);
    const tailTaper = 1 - Math.pow(Math.max(0, (-zn - 0.68) / 0.32), 2.0) * (isSupercar ? 0.15 : 0.11);
    const doorTuck = 1 - Math.exp(-Math.pow((zn + 0.02) / 0.3, 2)) * (isSupercar ? 0.075 : isGt ? 0.045 : 0.04);
    const rearHaunchFlare = Math.exp(-Math.pow((zn + 0.52) / 0.22, 2)) * (isMuscle ? 0.065 : isGt ? 0.07 : 0.045);
    const frontFenderFlare = Math.exp(-Math.pow((zn - 0.55) / 0.22, 2)) * (isGt ? 0.055 : 0.035);
    const wMax = halfW * noseTaper * tailTaper * doorTuck * (1 + rearHaunchFlare + frontFenderFlare);

    // 2. Vertical side-profile beltline / hood / rear deck height (clears tires cleanly over both wheel arches)
    const noseDrop = smoothstep(0.48, 1.0, zn) * (isSupercar ? 0.19 : isMuscle ? 0.11 : 0.15);
    const rearLift = smoothstep(-0.35, -0.95, zn) * (isMuscle ? 0.08 : isSupercar ? 0.09 : 0.06);
    const fenderPeakF = Math.exp(-Math.pow((zn - 0.56) / 0.22, 2)) * (isSupercar ? 0.095 : 0.075);
    const fenderPeakR = Math.exp(-Math.pow((zn + 0.54) / 0.24, 2)) * (isMuscle ? 0.085 : 0.07);
    const bumperRollF = Math.pow(Math.max(0, (zn - 0.87) / 0.13), 2) * 0.14;
    const bumperRollR = Math.pow(Math.max(0, (-zn - 0.89) / 0.11), 2) * 0.07;

    const shoulderY = deckH - noseDrop + rearLift + fenderPeakF + fenderPeakR - bumperRollF - bumperRollR;

    // Wide, muscular hood crown (subtle power dome on muscle, smooth flat-crowned deck on sports/supercar)
    const hoodDome =
      isMuscle
        ? Math.exp(-Math.pow((zn - 0.52) / 0.26, 2)) * 0.045
        : Math.exp(-Math.pow((zn - 0.48) / 0.3, 2)) * 0.015;
    const centerTopY = shoulderY + 0.028 + hoodDome - (isSupercar && zn > 0.38 ? 0.025 : 0);

    // 3. Lower sill height + clean semicircular wheel-arch cutouts
    let lowerY = rideH + (zn > 0.8 ? (zn - 0.8) * 0.26 : 0) + (zn < -0.8 ? (-zn - 0.8) * 0.38 : 0);
    let archTuckX = 0;

    for (const wz of [wheelZFront, wheelZRear]) {
      const dz = Math.abs(z - wz);
      if (dz < archR) {
        const archH = Math.sqrt(Math.max(0, archR * archR - dz * dz));
        const cutoutY = archCenterY + archH * 0.92;
        if (cutoutY > lowerY) {
          lowerY = cutoutY;
          archTuckX = 0.04 * (archH / archR);
        }
      }
    }
    lowerY = Math.min(lowerY, shoulderY - 0.07);

    const sideMidY = lowerY + (shoulderY - lowerY) * 0.52;
    const upperShoulderY = shoulderY - 0.028;
    const innerDeckX = wMax * 0.72;
    const floorX = wMax * 0.76;
    const sillX = wMax * 0.95 + archTuckX;
    const waistX = wMax * 1.0 + archTuckX;
    const upperX = wMax * 0.93;

    // 11-point full closed ring from bottom center -> right side -> top center -> left side -> bottom center
    const rightHalf: [number, number][] = [
      [0, rideH],
      [floorX, rideH + 0.02],
      [sillX, lowerY],
      [waistX, sideMidY],
      [upperX, upperShoulderY],
      [innerDeckX, shoulderY + 0.02],
      [0, centerTopY],
    ];

    const ring: { x: number; y: number; z: number; u: number; v: number }[] = [];
    // Left half reversed (excluding duplicate bottom & top center)
    for (let k = 0; k < rightHalf.length; k++) {
      const [rx, ry] = rightHalf[k];
      ring.push({ x: rx, y: ry, z, u: 0.5 + (k / (rightHalf.length - 1)) * 0.5, v: vTex });
    }
    for (let k = rightHalf.length - 2; k >= 0; k--) {
      const [rx, ry] = rightHalf[k];
      ring.push({ x: -rx, y: ry, z, u: 0.5 - (k / (rightHalf.length - 1)) * 0.5, v: vTex });
    }
    rings.push(ring);
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringLen = rings[0].length;

  for (let zi = 0; zi < rings.length; zi++) {
    for (let pi = 0; pi < ringLen; pi++) {
      const pt = rings[zi][pi];
      positions.push(pt.x, pt.y, pt.z);
      uvs.push(pt.u, pt.v);
    }
  }

  for (let zi = 0; zi < rings.length - 1; zi++) {
    for (let pi = 0; pi < ringLen - 1; pi++) {
      const a = zi * ringLen + pi;
      const b = (zi + 1) * ringLen + pi;
      const c = (zi + 1) * ringLen + (pi + 1);
      const d = zi * ringLen + (pi + 1);
      // Outward-facing winding
      indices.push(a, c, b, a, d, c);
    }
  }

  // Close front and rear bumper end caps cleanly
  const addEndCap = (ringIdx: number, flip: boolean) => {
    const ring = rings[ringIdx];
    let cx = 0;
    let cy = 0;
    const cz = ring[0].z;
    for (const pt of ring) {
      cx += pt.x;
      cy += pt.y;
    }
    cx /= ring.length;
    cy /= ring.length;
    const centerIdx = positions.length / 3;
    positions.push(cx, cy, cz);
    uvs.push(0.5, flip ? 1 : 0);
    const base = ringIdx * ringLen;
    for (let pi = 0; pi < ringLen - 1; pi++) {
      if (flip) indices.push(centerIdx, base + pi, base + pi + 1);
      else indices.push(centerIdx, base + pi + 1, base + pi);
    }
  };
  addEndCap(0, true);
  addEndCap(rings.length - 1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a curved, crowned lofted automotive greenhouse (windshield + side glass + fastback rear window)
 * plus a matching curved painted roof skin with tapered A/C pillars — zero rectangular roof slabs.
 */
function buildSculptedGreenhouse(
  len: number,
  width: number,
  deckH: number,
  cabinH: number,
  archetype: VehicleArchetype,
  isOffroad: boolean,
): {
  glassGeo: THREE.BufferGeometry;
  roofGeo: THREE.BufferGeometry;
  cabFrontZ: number;
  cabRearZ: number;
  aPillarTop: THREE.Vector3;
  aPillarBottom: THREE.Vector3;
} {
  const isSupercar = archetype === 'supercar';
  const isMuscle = archetype === 'muscle';

  const cabFrontZ = isSupercar ? len * 0.22 : isOffroad ? len * 0.17 : isMuscle ? len * 0.14 : len * 0.18;
  const cabRearZ = isSupercar ? -len * 0.34 : isOffroad ? -len * 0.36 : isMuscle ? -len * 0.31 : -len * 0.32;
  const cabLen = cabFrontZ - cabRearZ;

  // Build lofted curved glass canopy
  const steps = 16;
  const glassPositions: number[] = [];
  const glassUvs: number[] = [];
  const glassIndices: number[] = [];
  const roofPositions: number[] = [];
  const roofUvs: number[] = [];
  const roofIndices: number[] = [];

  const crossPts = 9; // -4..+4 across X
  const glassBaseW = width * (isSupercar ? 0.39 : isOffroad ? 0.42 : 0.4);
  const roofHalfW = width * (isSupercar ? 0.29 : isOffroad ? 0.36 : 0.32);

  for (let i = 0; i <= steps; i++) {
    const s = i / steps; // 0 = rear base, 1 = front cowl
    const z = cabRearZ + cabLen * s;

    // Smooth curved fastback profile: steep raked windshield in front, sweeping fastback rear
    const frontRake = isOffroad ? 0.78 : isSupercar ? 0.56 : 0.64;
    const rearRake = isOffroad ? 0.16 : isSupercar ? 0.34 : 0.3;

    let hFactor: number;
    if (s < rearRake) {
      hFactor = Math.sin((s / rearRake) * (Math.PI / 2));
    } else if (s > frontRake) {
      hFactor = Math.sin(((1 - s) / (1 - frontRake)) * (Math.PI / 2));
    } else {
      // Gentle crowned roof arch across longitudinal span
      const roofMid = (s - rearRake) / (frontRake - rearRake);
      hFactor = 0.96 + Math.sin(roofMid * Math.PI) * 0.06;
    }

    // Plan-view teardrop taper toward rear and front windshield
    const planTaper = 0.84 + Math.sin(s * Math.PI) * 0.18;
    const baseY = deckH - 0.04;
    const topY = deckH + cabinH * hFactor;

    for (let j = 0; j < crossPts; j++) {
      const u = (j / (crossPts - 1)) * 2 - 1; // -1..+1
      const absU = Math.abs(u);
      // Tumblehome glass curve from beltline up to crowned roof
      const halfSpan = THREE.MathUtils.lerp(roofHalfW, glassBaseW, Math.pow(absU, 1.35)) * planTaper;
      const x = Math.sign(u) * halfSpan * Math.pow(absU, 0.72);
      const yCurve = Math.cos(absU * Math.PI * 0.5);
      const y = baseY + (topY - baseY) * Math.pow(Math.max(0, yCurve), 0.52);

      glassPositions.push(x, y, z);
      glassUvs.push((u + 1) * 0.5, s);
    }

    // Separate curved painted roof panel sitting 0.014m proud of glass canopy over the roof span
    const roofSpanFactor = smoothstep(rearRake * 0.72, rearRake * 1.05, s) * (1 - smoothstep(frontRake * 0.96, Math.min(1, frontRake * 1.15), s));
    const rHalfW = roofHalfW * planTaper * (0.9 + 0.1 * roofSpanFactor);
    const roofArchY = topY + 0.018;
    for (let j = 0; j < 7; j++) {
      const u = (j / 6) * 2 - 1;
      const rx = u * rHalfW;
      const crown = (1 - u * u) * 0.045;
      // Tuck roof edges cleanly downward along front/rear header bounds
      const ry = roofSpanFactor > 0.01 ? roofArchY + crown - (1 - roofSpanFactor) * 0.06 : baseY + 0.02;
      roofPositions.push(rx, ry, z);
      roofUvs.push((u + 1) * 0.5, s);
    }
  }

  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < crossPts - 1; j++) {
      const a = i * crossPts + j;
      const b = (i + 1) * crossPts + j;
      const c = (i + 1) * crossPts + j + 1;
      const d = i * crossPts + j + 1;
      // Outward (+Y / outward lateral) winding for i -> +Z, j -> +X
      glassIndices.push(a, b, c, a, c, d);
    }
  }

  // Only triangulate roof skin along the actual roof section (keeps windshield & rear glass open & glossy!)
  const roofStartI = Math.max(1, Math.floor(steps * (isOffroad ? 0.12 : 0.25)));
  const roofEndI = Math.min(steps - 1, Math.ceil(steps * (isOffroad ? 0.8 : isSupercar ? 0.62 : 0.68)));
  for (let i = roofStartI; i < roofEndI; i++) {
    for (let j = 0; j < 6; j++) {
      const a = i * 7 + j;
      const b = (i + 1) * 7 + j;
      const c = (i + 1) * 7 + j + 1;
      const d = i * 7 + j + 1;
      // Outward (+Y) winding
      roofIndices.push(a, b, c, a, c, d);
    }
  }

  const glassGeo = new THREE.BufferGeometry();
  glassGeo.setAttribute('position', new THREE.Float32BufferAttribute(glassPositions, 3));
  glassGeo.setAttribute('uv', new THREE.Float32BufferAttribute(glassUvs, 2));
  glassGeo.setIndex(glassIndices);
  glassGeo.computeVertexNormals();

  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));
  roofGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roofUvs, 2));
  roofGeo.setIndex(roofIndices);
  roofGeo.computeVertexNormals();

  // Exact right-side (+X) A-pillar endpoints extracted directly from the generated greenhouse & roof vertices
  const topIdx = (roofEndI * 7 + 6) * 3;
  const aPillarTop = new THREE.Vector3(roofPositions[topIdx] * 0.96, roofPositions[topIdx + 1] - 0.015, roofPositions[topIdx + 2]);
  const botI = steps - 1;
  const botIdx = (botI * crossPts + (crossPts - 2)) * 3;
  const aPillarBottom = new THREE.Vector3(
    glassPositions[botIdx] * 1.02,
    Math.max(deckH - 0.02, glassPositions[botIdx + 1]),
    glassPositions[botIdx + 2],
  );

  return { glassGeo, roofGeo, cabFrontZ, cabRearZ, aPillarTop, aPillarBottom };
}

/**
 * Builds a high-detail LatheGeometry tire carcass with curved sidewalls + deep-dish alloy barrel.
 */
function buildLatheTireAndBarrel(radius: number, width: number): {
  tireGeo: THREE.LatheGeometry;
  barrelGeo: THREE.LatheGeometry;
} {
  const halfW = width * 0.5;
  const rimR = radius * 0.66;

  // Curved tire cross-section profile rotated around Y, then rotated Z by PI/2 so axle is X
  const tirePts = [
    new THREE.Vector2(rimR, -halfW * 0.86),
    new THREE.Vector2(radius * 0.9, -halfW),
    new THREE.Vector2(radius, -halfW * 0.78),
    new THREE.Vector2(radius, halfW * 0.78),
    new THREE.Vector2(radius * 0.9, halfW),
    new THREE.Vector2(rimR, halfW * 0.86),
    new THREE.Vector2(rimR * 0.94, halfW * 0.78),
    new THREE.Vector2(rimR * 0.94, -halfW * 0.78),
    new THREE.Vector2(rimR, -halfW * 0.86),
  ];
  const tireGeo = new THREE.LatheGeometry(tirePts, 24);
  tireGeo.rotateZ(Math.PI / 2);

  // Deep-dish metallic wheel barrel lip
  const barrelPts = [
    new THREE.Vector2(rimR * 0.86, -halfW * 0.84),
    new THREE.Vector2(rimR * 1.01, -halfW * 0.84),
    new THREE.Vector2(rimR * 1.01, halfW * 0.84),
    new THREE.Vector2(rimR * 0.86, halfW * 0.84),
    new THREE.Vector2(rimR * 0.82, halfW * 0.4),
    new THREE.Vector2(rimR * 0.82, -halfW * 0.4),
    new THREE.Vector2(rimR * 0.86, -halfW * 0.84),
  ];
  const barrelGeo = new THREE.LatheGeometry(barrelPts, 24);
  barrelGeo.rotateZ(Math.PI / 2);

  return { tireGeo, barrelGeo };
}

/**
 * Builds a production-oriented, sculpted procedural 3D automotive asset (bottom-center grounded at y=0, facing +Z).
 * Distinct curved silhouettes, recessed wheel arches, crowned greenhouse, mirrors, vents, brake discs & calipers.
 */
export function buildVehicleRig(
  archetype: VehicleArchetype,
  customization: VehicleCustomization,
  contactShadowTex: THREE.Texture,
  castShadow = true,
  neonGlowTex?: THREE.Texture,
  headlightBeamTex?: THREE.Texture,
  tailTrailTex?: THREE.Texture,
  options?: VehicleRigOptions,
): VehicleRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const isSupercar = archetype === 'supercar';
  const isMuscle = archetype === 'muscle';
  const isGt = archetype === 'gt';
  const isOffroad = options?.handlingArchetype === 'offroad';

  const dims = options?.dimensions;
  const carLength = dims?.length ?? (isMuscle ? 4.72 : isSupercar ? 4.58 : 4.46);
  const carWidth = dims?.width ?? (isSupercar ? 2.1 : isGt ? 2.06 : 1.94);
  const wheelRadius = dims?.wheelRadius ?? (isOffroad ? 0.41 : 0.35);
  const rideH = dims?.rideHeight ?? (isOffroad ? 0.24 : isSupercar ? 0.13 : 0.16);
  const wheelBase = dims?.wheelBase ?? carLength * 0.6;
  const trackWidth = dims?.trackWidth ?? carWidth - 0.3;
  const deckHeight = isOffroad ? 0.9 : isSupercar ? 0.75 : isMuscle ? 0.84 : 0.8;
  const cabinHeight = isOffroad ? 0.56 : isSupercar ? 0.44 : isMuscle ? 0.46 : 0.48;
  const halfL = carLength * 0.5;

  // PBR Automotive Materials (Physical clearcoat paint, satin carbon, dark reflective glass, alloy metal, matte rubber)
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(customization.bodyColor),
    metalness: customization.finish === 'matte' ? 0.22 : customization.finish === 'metallic' ? 0.76 : 0.44,
    roughness: customization.finish === 'matte' ? 0.58 : customization.finish === 'metallic' ? 0.24 : 0.16,
    clearcoat: customization.finish === 'matte' ? 0.14 : 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.25,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x10141d,
    roughness: 0.74,
    metalness: 0.28,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x1a202e,
    roughness: 0.38,
    metalness: 0.58,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xdce6f2,
    roughness: 0.14,
    metalness: 0.96,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1626,
    metalness: 0.2,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.4,
    transparent: true,
    opacity: Math.max(0.76, customization.windowTint),
  });

  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.rimColor),
    metalness: 0.9,
    roughness: 0.18,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x161922,
    roughness: 0.86,
    metalness: 0.06,
  });

  const discMat = new THREE.MeshStandardMaterial({
    color: 0x8d99ae,
    metalness: 0.88,
    roughness: 0.32,
  });

  const caliperMat = new THREE.MeshStandardMaterial({
    color: isOffroad ? 0xf59e0b : 0xef233c,
    metalness: 0.45,
    roughness: 0.35,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(customization.headlightColor),
    emissive: new THREE.Color(customization.headlightColor),
    emissiveIntensity: 2.4,
    roughness: 0.1,
  });

  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: 0xff1e44,
    emissive: new THREE.Color(0xff1e44),
    emissiveIntensity: 1.85,
    roughness: 0.14,
  });

  const underglowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.underglowColor),
    map: neonGlowTex ?? null,
    transparent: true,
    opacity: neonGlowTex ? 0.42 : 0.32, // Subtle grounded underglow, never garish washout
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const geometries: THREE.BufferGeometry[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };

  const wheelZFront = wheelBase * 0.5 + (isSupercar ? 0.06 : 0.02);
  const wheelZRear = -wheelBase * 0.5 + (isSupercar ? 0.06 : 0.02);

  // 1. Sculpted Multi-Section Lofted Automotive Body Shell (with recessed semicircular wheel arches)
  const bodyGeo = trackGeo(
    buildSculptedBodyGeometry(
      carLength,
      carWidth,
      deckHeight,
      wheelZFront,
      wheelZRear,
      wheelRadius,
      rideH,
      archetype,
      isOffroad,
    ),
  );
  const hullMesh = new THREE.Mesh(bodyGeo, paintMat);
  hullMesh.castShadow = castShadow;
  hullMesh.receiveShadow = true;
  bodyGroup.add(hullMesh);

  // Inset dark inner wheel-well backing plates strictly inside the fender plane (never clip tires or hood)
  const wellBackGeo = trackGeo(new THREE.CircleGeometry(wheelRadius * 0.96, 16));
  wellBackGeo.rotateY(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const wz of [wheelZFront, wheelZRear]) {
      const wellBack = new THREE.Mesh(wellBackGeo, trimMat);
      wellBack.position.set(sx * (trackWidth * 0.36), wheelRadius, wz);
      if (sx < 0) wellBack.rotation.y = Math.PI;
      bodyGroup.add(wellBack);
    }
  }

  // 2. Sculpted Curved Greenhouse (Windshield, Side Windows, Rear Fastback Glass) + Crowned Painted Roof
  const { glassGeo, roofGeo, cabFrontZ, cabRearZ, aPillarTop, aPillarBottom } = buildSculptedGreenhouse(
    carLength,
    carWidth,
    deckHeight,
    cabinHeight,
    archetype,
    isOffroad,
  );
  trackGeo(glassGeo);
  trackGeo(roofGeo);
  const cabinMesh = new THREE.Mesh(glassGeo, glassMat);
  cabinMesh.castShadow = castShadow;
  bodyGroup.add(cabinMesh);

  const roofMesh = new THREE.Mesh(roofGeo, paintMat);
  roofMesh.castShadow = castShadow;
  bodyGroup.add(roofMesh);

  // Structural sculpted A-pillars anchored exactly between windshield cowl and roof header corners
  const pillarVec = new THREE.Vector3().subVectors(aPillarTop, aPillarBottom);
  const pillarLen = pillarVec.length();
  const pillarGeo = trackGeo(new THREE.CylinderGeometry(0.024, 0.032, pillarLen, 8));
  const upAxis = new THREE.Vector3(0, 1, 0);
  for (const sx of [-1, 1]) {
    const pBot = new THREE.Vector3(sx * aPillarBottom.x, aPillarBottom.y, aPillarBottom.z);
    const pTop = new THREE.Vector3(sx * aPillarTop.x, aPillarTop.y, aPillarTop.z);
    const dir = new THREE.Vector3().subVectors(pTop, pBot).normalize();
    const aPillar = new THREE.Mesh(pillarGeo, paintMat);
    aPillar.position.addVectors(pBot, pTop).multiplyScalar(0.5);
    aPillar.quaternion.setFromUnitVectors(upAxis, dir);
    bodyGroup.add(aPillar);

    const bPillar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.026, cabinHeight * 0.78, 0.08)), trimMat);
    bPillar.position.set(sx * (carWidth * 0.34), deckHeight + cabinHeight * 0.44, (cabFrontZ + cabRearZ) * 0.5 + 0.06);
    bPillar.rotation.z = sx * 0.24;
    bodyGroup.add(bPillar);
  }

  // 3. Sculpted Stalk-Mounted Aerodynamic Side Mirrors (curved caps + angled stalks)
  const mirrorCapGeo = trackGeo(new THREE.SphereGeometry(0.075, 12, 8));
  mirrorCapGeo.scale(1.45, 0.65, 1.05);
  const mirrorStalkGeo = trackGeo(new THREE.CylinderGeometry(0.015, 0.022, 0.14, 6));
  for (const sx of [-1, 1]) {
    const stalk = new THREE.Mesh(mirrorStalkGeo, trimMat);
    stalk.position.set(sx * (carWidth * 0.44), deckHeight + 0.06, cabFrontZ - 0.16);
    stalk.rotation.z = sx * -0.82;
    bodyGroup.add(stalk);

    const cap = new THREE.Mesh(mirrorCapGeo, paintMat);
    cap.position.set(sx * (carWidth * 0.51), deckHeight + 0.11, cabFrontZ - 0.19);
    bodyGroup.add(cap);
  }

  // 4. Door Seams, Flush Door Handles, Side Skirts & Archetype Aero Details
  const doorSeamGeo = trackGeo(new THREE.BoxGeometry(0.014, 0.018, wheelBase * 0.58));
  const handleGeo = trackGeo(new THREE.BoxGeometry(0.032, 0.036, 0.18));
  const skirtGeo = trackGeo(new THREE.BoxGeometry(0.11, 0.075, wheelBase - wheelRadius * 2.15));
  for (const sx of [-1, 1]) {
    // Lower side accent crease / skirt
    const skirt = new THREE.Mesh(skirtGeo, carbonMat);
    skirt.position.set(sx * (carWidth * 0.465), rideH + 0.03, (wheelZFront + wheelZRear) * 0.5);
    bodyGroup.add(skirt);

    // Flush door handle
    const handle = new THREE.Mesh(handleGeo, trimMat);
    handle.position.set(sx * (carWidth * 0.468), deckHeight - 0.06, -0.22);
    bodyGroup.add(handle);

    // Subtle upper door crease trim
    const seam = new THREE.Mesh(doorSeamGeo, trimMat);
    seam.position.set(sx * (carWidth * 0.48), rideH + 0.18, 0);
    bodyGroup.add(seam);
  }

  // Archetype-specific automotive character features
  if (isOffroad) {
    // Off-Road Rally Raid: Front metal bash/skid plate + roof expedition rack + 4 rally light pods
    const skid = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.62, 0.18, 0.34)), chromeMat);
    skid.position.set(0, rideH + 0.06, halfL - 0.1);
    skid.rotation.x = 0.42;
    bodyGroup.add(skid);

    const rackGeo = trackGeo(new THREE.BoxGeometry(carWidth * 0.62, 0.06, 1.15));
    const rack = new THREE.Mesh(rackGeo, trimMat);
    rack.position.set(0, deckHeight + cabinHeight + 0.06, -0.22);
    bodyGroup.add(rack);

    const podGeo = trackGeo(new THREE.CylinderGeometry(0.065, 0.065, 0.08, 12));
    podGeo.rotateX(Math.PI / 2);
    for (const px of [-0.36, -0.12, 0.12, 0.36]) {
      const pod = new THREE.Mesh(podGeo, headlightMat);
      pod.position.set(px, deckHeight + cabinHeight + 0.12, 0.34);
      bodyGroup.add(pod);
    }
  } else if (isMuscle) {
    // Muscle Interceptor: Sculpted twin-intake hood cowl + aggressive chin lip
    const cowl = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.64, 0.085, 1.1)), carbonMat);
    cowl.position.set(0, deckHeight + 0.04, 1.12);
    cowl.rotation.x = 0.05;
    bodyGroup.add(cowl);
  } else if (isSupercar) {
    // Mid-Engine Supercar: Side aero air scoops + louvered carbon engine cover
    const scoopGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.24, 0.65));
    for (const sx of [-1, 1]) {
      const scoop = new THREE.Mesh(scoopGeo, trimMat);
      scoop.position.set(sx * (carWidth * 0.47), deckHeight - 0.14, -0.52);
      bodyGroup.add(scoop);
    }
    const louverGeo = trackGeo(new THREE.BoxGeometry(carWidth * 0.42, 0.035, 0.12));
    for (let li = 0; li < 4; li++) {
      const louver = new THREE.Mesh(louverGeo, carbonMat);
      louver.position.set(0, deckHeight + 0.16 - li * 0.042, -0.92 - li * 0.2);
      louver.rotation.x = -0.22;
      bodyGroup.add(louver);
    }
  } else if (isGt) {
    // Widebody GT: Front bumper dive-plane canards + hood vent
    const canardGeo = trackGeo(new THREE.BoxGeometry(0.16, 0.025, 0.28));
    for (const sx of [-1, 1]) {
      const canard = new THREE.Mesh(canardGeo, carbonMat);
      canard.position.set(sx * (carWidth * 0.47), rideH + 0.15, halfL - 0.24);
      canard.rotation.z = sx * -0.25;
      bodyGroup.add(canard);
    }
    const vent = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.56, 0.03, 0.42)), trimMat);
    vent.position.set(0, deckHeight - 0.02, 1.15);
    vent.rotation.x = 0.14;
    bodyGroup.add(vent);
  }

  // 5. Recessed Multi-Slat Front Grille, Side Intakes, Hood/Trunk Shutlines, Splitter & Quad Exhausts
  const splitter = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.94, 0.045, 0.42)), carbonMat);
  splitter.position.set(0, rideH + 0.01, halfL - 0.15);
  bodyGroup.add(splitter);

  const grille = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.56, 0.16, 0.12)), trimMat);
  grille.position.set(0, rideH + 0.16, halfL - 0.05);
  bodyGroup.add(grille);

  // Horizontal satin grille slats + flanking lower brake-cooling ducts
  const slatGeo = trackGeo(new THREE.BoxGeometry(carWidth * 0.52, 0.014, 0.03));
  for (const sy of [-0.04, 0, 0.04]) {
    const slat = new THREE.Mesh(slatGeo, chromeMat);
    slat.position.set(0, rideH + 0.16 + sy, halfL + 0.008);
    bodyGroup.add(slat);
  }
  const intakeGeo = trackGeo(new THREE.BoxGeometry(carWidth * 0.18, 0.11, 0.1));
  for (const sx of [-1, 1]) {
    const intake = new THREE.Mesh(intakeGeo, trimMat);
    intake.position.set(sx * (carWidth * 0.36), rideH + 0.14, halfL - 0.09);
    intake.rotation.y = sx * -0.22;
    bodyGroup.add(intake);
  }

  // Crisp trunk panel shutline seam (flush with rear deck)
  const trunkSeam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.56, 0.01, 0.014)), trimMat);
  trunkSeam.position.set(0, deckHeight + 0.005, cabRearZ - 0.16);
  bodyGroup.add(trunkSeam);

  const diffuser = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.84, 0.18, 0.26)), carbonMat);
  diffuser.position.set(0, rideH + 0.1, -halfL + 0.08);
  bodyGroup.add(diffuser);
  const finGeo = trackGeo(new THREE.BoxGeometry(0.03, 0.16, 0.28));
  for (const fx of [-0.48, -0.18, 0.18, 0.48]) {
    const fin = new THREE.Mesh(finGeo, trimMat);
    fin.position.set(fx, rideH + 0.08, -halfL + 0.05);
    bodyGroup.add(fin);
  }

  // 6. Flush-Mounted Sculpted Headlamp Clusters (Tucked cleanly inside sloped front fascia bevel)
  const hlBezelGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.068, 0.18));
  const hlBladeGeo = trackGeo(new THREE.BoxGeometry(0.27, 0.026, 0.075));
  const hlProjGeo = trackGeo(new THREE.CylinderGeometry(0.022, 0.022, 0.035, 10));
  hlProjGeo.rotateX(Math.PI / 2);
  const hlY = deckHeight - (isSupercar ? 0.27 : isMuscle ? 0.24 : 0.27);
  for (const sx of [-1, 1]) {
    const bezel = new THREE.Mesh(hlBezelGeo, trimMat);
    bezel.position.set(sx * (carWidth * 0.295), hlY, halfL - 0.17);
    bezel.rotation.y = sx * -0.24;
    bezel.rotation.x = 0.2;
    bodyGroup.add(bezel);

    const blade = new THREE.Mesh(hlBladeGeo, headlightMat);
    blade.position.set(sx * (carWidth * 0.295), hlY + 0.01, halfL - 0.115);
    blade.rotation.y = sx * -0.24;
    blade.rotation.x = 0.16;
    bodyGroup.add(blade);

    // Dual inner projector lenses recessed inside bezel
    for (const po of [-0.055, 0.055]) {
      const proj = new THREE.Mesh(hlProjGeo, headlightMat);
      proj.position.set(sx * (carWidth * 0.295) + po, hlY - 0.01, halfL - 0.105);
      proj.rotation.y = sx * -0.2;
      bodyGroup.add(proj);
    }
  }

  let hlBeamMat: THREE.MeshBasicMaterial | null = null;
  if (headlightBeamTex) {
    const beamGeo = trackGeo(new THREE.PlaneGeometry(1.75, 11.5));
    beamGeo.rotateX(-Math.PI / 2);
    hlBeamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(customization.headlightColor),
      map: headlightBeamTex,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const sx of [-1, 1]) {
      const cone = new THREE.Mesh(beamGeo, hlBeamMat);
      cone.position.set(sx * (carWidth * 0.34), 0.06, halfL + 5.6);
      root.add(cone);
    }
  }

  // Rear recessed lamp panel + signature LED tail/brake light clusters
  const rearFascia = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.82, 0.16, 0.08)), trimMat);
  const tailY = deckHeight - 0.09;
  rearFascia.position.set(0, tailY, -halfL + 0.04);
  bodyGroup.add(rearFascia);

  if (isMuscle) {
    // Classic twin-pair muscle tail lamps
    const lampGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.085, 0.07));
    for (const lx of [-0.66, -0.38, 0.38, 0.66]) {
      const lamp = new THREE.Mesh(lampGeo, brakeLightMat);
      lamp.position.set(lx, tailY, -halfL + 0.01);
      bodyGroup.add(lamp);
    }
  } else {
    // Crisp sculpted wrap-around sport LED bar + side pods
    const tailBar = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(carWidth * 0.78, 0.052, 0.07)), brakeLightMat);
    tailBar.position.set(0, tailY + 0.015, -halfL + 0.01);
    bodyGroup.add(tailBar);
    const sidePodGeo = trackGeo(new THREE.BoxGeometry(0.26, 0.095, 0.08));
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(sidePodGeo, brakeLightMat);
      pod.position.set(sx * (carWidth * 0.32), tailY, -halfL + 0.01);
      bodyGroup.add(pod);
    }
  }

  // Dynamic glowing taillight ribbon trails streaming behind at speed
  const tailTrailMat = new THREE.MeshBasicMaterial({
    color: 0xff2248,
    map: tailTrailTex ?? null,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const trailGeo = trackGeo(new THREE.PlaneGeometry(0.14, 1));
  trailGeo.rotateX(Math.PI / 2);
  trailGeo.translate(0, 0, -0.5);
  const tailTrails: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const trail = new THREE.Mesh(trailGeo, tailTrailMat);
    trail.position.set(sx * (carWidth * 0.35), tailY, -halfL - 0.04);
    trail.visible = false;
    bodyGroup.add(trail);
    tailTrails.push(trail);
  }

  // 7. Chrome-Rimmed Exhaust Outlets (with dark hollow bores) + Dynamic Nitro Flame Cones
  const exhaustOuterGeo = trackGeo(new THREE.CylinderGeometry(0.058, 0.064, 0.22, 12));
  exhaustOuterGeo.rotateX(Math.PI / 2);
  const exhaustBoreGeo = trackGeo(new THREE.CylinderGeometry(0.044, 0.044, 0.23, 10));
  exhaustBoreGeo.rotateX(Math.PI / 2);
  const flameGeo = trackGeo(new THREE.ConeGeometry(0.12, 1.3, 8));
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(customization.nitroColor),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const exhaustPositions = isSupercar ? [-0.24, -0.08, 0.08, 0.24] : isMuscle ? [-0.58, -0.44, 0.44, 0.58] : [-0.46, 0.46];
  for (const exX of exhaustPositions) {
    const ex = new THREE.Mesh(exhaustOuterGeo, chromeMat);
    ex.position.set(exX, rideH + 0.09, -halfL - 0.02);
    bodyGroup.add(ex);
    const bore = new THREE.Mesh(exhaustBoreGeo, trimMat);
    bore.position.set(exX, rideH + 0.09, -halfL - 0.025);
    bodyGroup.add(bore);
  }

  const nitroFlames: THREE.Mesh[] = [];
  const flameXs = isSupercar ? [-0.16, 0.16] : [-0.46, 0.46];
  for (const sx of flameXs) {
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(sx, rideH + 0.09, -halfL - 0.7);
    flame.visible = false;
    bodyGroup.add(flame);
    nitroFlames.push(flame);
  }

  // 8. Customizable Sculpted Rear Spoiler Group
  const spoilerGroup = new THREE.Group();
  spoilerGroup.position.set(0, deckHeight + (isMuscle ? 0.05 : 0.03), -halfL + 0.26);
  bodyGroup.add(spoilerGroup);
  rebuildSpoiler(spoilerGroup, customization.spoiler, carWidth, paintMat, carbonMat);

  // 9. Four Detailed Multi-Part Wheels (Lathe Tires, Deep-Dish Alloy Barrels, 10 Twin Spokes, Slotted Brake Discs, Fixed Calipers)
  const wheelPivots: THREE.Group[] = [];
  const wheelMeshes: THREE.Group[] = [];
  const wheelBaseY: number[] = [];

  const tireWidth = isOffroad ? 0.34 : isSupercar ? 0.31 : 0.27;
  const wheelX = trackWidth * 0.5;
  const { tireGeo, barrelGeo } = buildLatheTireAndBarrel(wheelRadius, tireWidth);
  trackGeo(tireGeo);
  trackGeo(barrelGeo);

  const hubGeo = trackGeo(new THREE.CylinderGeometry(wheelRadius * 0.22, wheelRadius * 0.22, tireWidth * 0.82, 12));
  hubGeo.rotateZ(Math.PI / 2);

  // 5 pairs of V-angled alloy spokes
  const spokeGeo = trackGeo(new THREE.BoxGeometry(0.038, wheelRadius * 0.62, 0.032));
  const discGeo = trackGeo(new THREE.CylinderGeometry(wheelRadius * 0.52, wheelRadius * 0.52, 0.035, 18));
  discGeo.rotateZ(Math.PI / 2);
  const caliperGeo = trackGeo(new THREE.BoxGeometry(0.085, wheelRadius * 0.34, wheelRadius * 0.22));

  const wheelPositions: [number, number, number, number][] = [
    [wheelX, wheelRadius, wheelZFront, 1],
    [-wheelX, wheelRadius, wheelZFront, -1],
    [wheelX, wheelRadius, wheelZRear, 1],
    [-wheelX, wheelRadius, wheelZRear, -1],
  ];

  for (const [wx, wy, wz, side] of wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);

    // Non-spinning brake caliper attached to wheel knuckle (stays upright while disc & rim spin!)
    const caliper = new THREE.Mesh(caliperGeo, caliperMat);
    caliper.position.set(-side * 0.035, 0.03, wz > 0 ? -wheelRadius * 0.34 : wheelRadius * 0.34);
    pivot.add(caliper);

    const spinGroup = new THREE.Group();
    pivot.add(spinGroup);

    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = castShadow;
    spinGroup.add(tire);

    const barrel = new THREE.Mesh(barrelGeo, rimMat);
    spinGroup.add(barrel);

    const hub = new THREE.Mesh(hubGeo, rimMat);
    spinGroup.add(hub);

    // Visible slotted metallic brake disc recessed inside wheel barrel
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.x = -side * 0.03;
    spinGroup.add(disc);

    // 5 twin-spoke sport alloy wheel face on outer side
    const faceX = side * (tireWidth * 0.36);
    for (let k = 0; k < 5; k++) {
      const baseAngle = (k * Math.PI * 2) / 5;
      for (const offsetAng of [-0.14, 0.14]) {
        const ang = baseAngle + offsetAng;
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        const rMid = wheelRadius * 0.34;
        spoke.position.set(faceX, Math.cos(ang) * rMid, Math.sin(ang) * rMid);
        spoke.rotation.x = -ang;
        spinGroup.add(spoke);
      }
    }

    root.add(pivot);
    wheelPivots.push(pivot);
    wheelMeshes.push(spinGroup);
    wheelBaseY.push(wy);
  }

  // 10. Ground Contact Shadow Plane (prevents floating appearance) + Subtle Neon Underglow Strip
  const shadowGeo = trackGeo(new THREE.PlaneGeometry(carWidth * 1.48, carLength * 1.24));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.position.y = 0.025;
  root.add(shadowPlane);

  const glowGeo = trackGeo(new THREE.PlaneGeometry(carWidth * 1.5, carLength * 1.18));
  glowGeo.rotateX(-Math.PI / 2);
  const glowPlane = new THREE.Mesh(glowGeo, underglowMat);
  glowPlane.position.y = 0.04;
  root.add(glowPlane);

  // 11. Transparent Cyan Hexagonal Energy Shield Dome (toggled when SHIELD active)
  const shieldGeo = trackGeo(new THREE.IcosahedronGeometry(2.8, 1));
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
    wheelBaseY,
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
      chromeMat.dispose();
      glassMat.dispose();
      rimMat.dispose();
      tireMat.dispose();
      discMat.dispose();
      caliperMat.dispose();
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

  const height = style === 'wing' ? 0.34 : style === 'gt' ? 0.25 : 0.12;
  const wingWidth = style === 'wing' ? carWidth * 0.98 : style === 'gt' ? carWidth * 0.92 : carWidth * 0.82;

  // Swan-neck angled aero struts
  const strutGeo = new THREE.BoxGeometry(0.045, height, 0.18);
  for (const sx of [-0.42, 0.42]) {
    const strut = new THREE.Mesh(strutGeo, carbonMat);
    strut.position.set(sx, height * 0.5, 0.02);
    strut.rotation.x = -0.18;
    group.add(strut);
  }

  // Cambered airfoil blade
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(wingWidth, 0.042, style === 'street' ? 0.22 : 0.32),
    style === 'street' ? paintMat : carbonMat,
  );
  blade.position.set(0, height + 0.015, -0.04);
  blade.rotation.x = 0.09;
  group.add(blade);

  // Sculpted aero endplates on GT / Wing spoilers
  if (style === 'gt' || style === 'wing') {
    const plateGeo = new THREE.BoxGeometry(0.032, 0.2, 0.4);
    for (const sx of [-1, 1]) {
      const plate = new THREE.Mesh(plateGeo, paintMat);
      plate.position.set(sx * (wingWidth * 0.5), height + 0.01, -0.05);
      group.add(plate);
    }
  }
}

export function applyVehicleCustomization(rig: VehicleRig, custom: VehicleCustomization): void {
  for (const mat of rig.paintMaterials) {
    mat.color.set(custom.bodyColor);
    mat.metalness = custom.finish === 'matte' ? 0.22 : custom.finish === 'metallic' ? 0.76 : 0.44;
    mat.roughness = custom.finish === 'matte' ? 0.58 : custom.finish === 'metallic' ? 0.24 : 0.16;
    mat.clearcoat = custom.finish === 'matte' ? 0.14 : 1.0;
    mat.needsUpdate = true;
  }
  for (const mat of rig.rimMaterials) {
    mat.color.set(custom.rimColor);
  }
  rig.underglowMaterial.color.set(custom.underglowColor);
  rig.headlightMaterial.color.set(custom.headlightColor);
  rig.headlightMaterial.emissive.set(custom.headlightColor);
  rig.glassMaterial.opacity = Math.max(0.76, custom.windowTint);
  for (const f of rig.nitroFlames) {
    (f.material as THREE.MeshBasicMaterial).color.set(custom.nitroColor);
  }

  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1a202e, roughness: 0.38, metalness: 0.58 });
  rebuildSpoiler(rig.spoilerGroup, custom.spoiler, 1.98, rig.paintMaterials[0], carbonMat);
}
