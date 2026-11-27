import * as THREE from 'three';
import type { BuiltTrack } from '../game/trackMath';
import type { PowerUpType, TrackPickupNode } from '../game/types';
import { POWERUP_DEFS } from '../game/powerups';
import type { ProceduralTexturePack } from './proceduralTextures';

export interface BuiltTrackScene {
  group: THREE.Group;
  pickupMeshes: Map<string, THREE.Group>;
  dispose: () => void;
}

/**
 * Generates the complete nighttime 3D Neon City / Industrial Port / Midnight Streets circuit:
 * continuous wet asphalt road ribbon, neon barrier walls, urban tunnel arches,
 * InstancedMesh skyscrapers, overhead street lamps, start/finish gantry, and 3D power-up pickups.
 */
export function buildTrackScene(
  track: BuiltTrack,
  textures: ProceduralTexturePack,
  pickups: TrackPickupNode[],
): BuiltTrackScene {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const samples = track.samples;
  const n = samples.length;
  const halfW = track.def.roadWidth * 0.5;

  // 0. Atmospheric Night Sky Dome (deep indigo zenith -> magenta/violet city horizon haze)
  const skyGeo = trackGeo(new THREE.SphereGeometry(950, 24, 16));
  const skyMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: textures.nightSky,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.position.set(220, 0, 100);
  group.add(skyDome);

  // 1. Dark City Ground Plane extending past horizon fog (offset -0.15m below road to prevent Z-fighting)
  const groundGeo = trackGeo(new THREE.PlaneGeometry(2400, 2400));
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x050811,
      roughness: 0.92,
      metalness: 0.05,
      envMapIntensity: 0.25,
    }),
  );
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(220, -0.15, 100);
  ground.receiveShadow = true;
  group.add(ground);

  // 2. Continuous Wet Asphalt Road Ribbon Mesh from Spline Samples
  const roadPositions: number[] = [];
  const roadNormals: number[] = [];
  const roadUvs: number[] = [];
  const roadIndices: number[] = [];

  const leftWallPos: number[] = [];
  const rightWallPos: number[] = [];
  const wallIndices: number[] = [];
  const leftRailPos: number[] = [];
  const rightRailPos: number[] = [];

  let distAccum = 0;
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    if (i > 0) {
      const prev = samples[(i - 1) % n];
      distAccum += Math.hypot(s.x - prev.x, s.z - prev.z);
    }
    const vCoord = distAccum / 14;

    const lx = s.x - s.rx * halfW;
    const lz = s.z - s.rz * halfW;
    const rx = s.x + s.rx * halfW;
    const rz = s.z + s.rz * halfW;

    roadPositions.push(lx, s.y + 0.02, lz, rx, s.y + 0.02, rz);
    roadNormals.push(0, 1, 0, 0, 1, 0);
    roadUvs.push(0, vCoord, 1, vCoord);

    // Concrete barrier walls on both sides (height 1.35m)
    const wallOut = halfW + 0.58;
    const wlx = s.x - s.rx * wallOut;
    const wlz = s.z - s.rz * wallOut;
    const wrx = s.x + s.rx * wallOut;
    const wrz = s.z + s.rz * wallOut;

    leftWallPos.push(wlx, s.y, wlz, wlx, s.y + 1.35, wlz);
    rightWallPos.push(wrx, s.y, wrz, wrx, s.y + 1.35, wrz);

    // Neon light strip offset 0.12m inward from barrier wall to prevent Z-fighting
    const railOut = halfW + 0.46;
    const rlx = s.x - s.rx * railOut;
    const rlz = s.z - s.rz * railOut;
    const rrx = s.x + s.rx * railOut;
    const rrz = s.z + s.rz * railOut;
    leftRailPos.push(rlx, s.y + 0.96, rlz, rlx, s.y + 1.18, rlz);
    rightRailPos.push(rrx, s.y + 0.96, rrz, rrx, s.y + 1.18, rrz);

    if (i < n) {
      const base = i * 2;
      // Upward-facing (+Y) winding for continuous road ribbon
      roadIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      wallIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const roadGeo = trackGeo(new THREE.BufferGeometry());
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIndices);

  const roadMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.roadAlbedo,
      roughnessMap: textures.roadRoughness,
      roughness: 0.78,
      metalness: 0.05,
      envMapIntensity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Side Barriers
  const barrierMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x151c2e,
      roughness: 0.65,
      metalness: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  for (const wallVerts of [leftWallPos, rightWallPos]) {
    const wGeo = trackGeo(new THREE.BufferGeometry());
    wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
    wGeo.setIndex(wallIndices);
    wGeo.computeVertexNormals();
    group.add(new THREE.Mesh(wGeo, barrierMat));
  }

  // Glowing Neon Barrier Strips
  const leftNeonMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: track.def.accentPrimary,
      side: THREE.DoubleSide,
    }),
  );
  const rightNeonMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: track.def.accentSecondary,
      side: THREE.DoubleSide,
    }),
  );
  const lrGeo = trackGeo(new THREE.BufferGeometry());
  lrGeo.setAttribute('position', new THREE.Float32BufferAttribute(leftRailPos, 3));
  lrGeo.setIndex(wallIndices);
  group.add(new THREE.Mesh(lrGeo, leftNeonMat));

  const rrGeo = trackGeo(new THREE.BufferGeometry());
  rrGeo.setAttribute('position', new THREE.Float32BufferAttribute(rightRailPos, 3));
  rrGeo.setIndex(wallIndices);
  group.add(new THREE.Mesh(rrGeo, rightNeonMat));

  // 3. Start / Finish Illuminated Gantry Arch (tall landmark visible from spawn!)
  const startSample = samples[0];
  const gantryGroup = new THREE.Group();
  gantryGroup.position.set(startSample.x, startSample.y, startSample.z);
  gantryGroup.rotation.y = Math.atan2(startSample.tx, startSample.tz);

  const pillarMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x1c253b, roughness: 0.4, metalness: 0.72 }),
  );
  const pillarGeo = trackGeo(new THREE.BoxGeometry(1.4, 11.5, 1.8));
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(sx * (halfW + 1.2), 5.75, 0);
    gantryGroup.add(pillar);
  }
  const bannerGeo = trackGeo(new THREE.BoxGeometry(track.def.roadWidth + 4, 2.8, 1.2));
  const bannerMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: textures.gantryBanner,
    }),
  );
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(0, 10.6, 0);
  gantryGroup.add(banner);
  group.add(gantryGroup);

  // 4. Urban Tunnel Arches along tunnel segments
  const tunnelArchIndices: number[] = [];
  for (let i = 0; i < n; i += 2) {
    if (samples[i].isTunnel) tunnelArchIndices.push(i);
  }
  if (tunnelArchIndices.length > 0) {
    const archGeo = trackGeo(new THREE.TorusGeometry(halfW + 1.2, 0.85, 6, 14, Math.PI));
    const archMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x131929, roughness: 0.55, metalness: 0.5 }),
    );
    const archInst = new THREE.InstancedMesh(archGeo, archMat, tunnelArchIndices.length);

    const lightStripGeo = trackGeo(new THREE.BoxGeometry(8, 0.25, 0.45));
    const lightStripMat = trackMat(new THREE.MeshBasicMaterial({ color: track.def.accentPrimary }));
    const stripInst = new THREE.InstancedMesh(lightStripGeo, lightStripMat, tunnelArchIndices.length);

    const dummy = new THREE.Object3D();
    tunnelArchIndices.forEach((sampleIdx, k) => {
      const s = samples[sampleIdx];
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, Math.atan2(s.tx, s.tz), 0);
      dummy.scale.set(1, 0.78, 1);
      dummy.updateMatrix();
      archInst.setMatrixAt(k, dummy.matrix);

      dummy.position.set(s.x, s.y + (halfW + 0.4) * 0.72, s.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      stripInst.setMatrixAt(k, dummy.matrix);
    });
    archInst.computeBoundingSphere();
    stripInst.computeBoundingSphere();
    group.add(archInst, stripInst);
  }

  // 5. Instanced Illuminated Skyscrapers lining both sides of the circuit
  const buildingTransforms: { x: number; z: number; sx: number; sy: number; sz: number; rotY: number; color: number }[] = [];
  const minClearanceSq = (halfW + 14) * (halfW + 14);

  for (let i = 0; i < n; i += 4) {
    const s = samples[i];
    if (s.isTunnel) continue;
    for (const side of [-1, 1]) {
      const offsetDist = halfW + 19 + ((i * 17 + (side > 0 ? 7 : 3)) % 22);
      const bx = s.x + s.rx * side * offsetDist;
      const bz = s.z + s.rz * side * offsetDist;

      // Ensure skyscraper never encroaches on another part of the track loop
      let safe = true;
      for (let j = 0; j < n; j += 6) {
        const other = samples[j];
        const dx = bx - other.x;
        const dz = bz - other.z;
        if (dx * dx + dz * dz < minClearanceSq) {
          safe = false;
          break;
        }
      }
      if (!safe) continue;

      const width = 14 + ((i * 13) % 14);
      const depth = 14 + ((i * 29) % 16);
      const height = 28 + ((i * 41 + (side > 0 ? 19 : 5)) % 76);
      const tint = (i + (side > 0 ? 1 : 0)) % 3 === 0 ? 0xa9d4ff : (i % 3 === 1 ? 0xc8b5ff : 0xdde8f8);
      buildingTransforms.push({
        x: bx,
        z: bz,
        sx: width,
        sy: height,
        sz: depth,
        rotY: Math.atan2(s.tx, s.tz),
        color: tint,
      });
    }
  }

  if (buildingTransforms.length > 0) {
    const bGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
    bGeo.translate(0, 0.5, 0); // Bottom-center pivot flush on ground
    const bMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3b4868,
        map: textures.buildingFacade,
        emissive: 0xffffff,
        emissiveMap: textures.buildingEmissive,
        emissiveIntensity: 1.05,
        roughness: 0.9,
        metalness: 0.08,
        envMapIntensity: 0.14,
      }),
    );
    const bInst = new THREE.InstancedMesh(bGeo, bMat, buildingTransforms.length);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    buildingTransforms.forEach((bt, idx) => {
      dummy.position.set(bt.x, -0.15, bt.z);
      dummy.rotation.set(0, bt.rotY, 0);
      dummy.scale.set(bt.sx, bt.sy, bt.sz);
      dummy.updateMatrix();
      bInst.setMatrixAt(idx, dummy.matrix);
      col.setHex(bt.color);
      bInst.setColorAt(idx, col);
    });
    bInst.computeBoundingSphere();
    group.add(bInst);

    // Rooftop Neon Crown Strips on the tallest buildings for unmistakable skyline identity
    const crownGeo = trackGeo(new THREE.BoxGeometry(1.04, 0.7, 1.04));
    const crownMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, buildingTransforms.length);
    buildingTransforms.forEach((bt, idx) => {
      dummy.position.set(bt.x, bt.sy - 0.5, bt.z);
      dummy.rotation.set(0, bt.rotY, 0);
      dummy.scale.set(bt.sx, 1, bt.sz);
      dummy.updateMatrix();
      crownInst.setMatrixAt(idx, dummy.matrix);
      col.setHex(idx % 2 === 0 ? track.def.accentPrimary : track.def.accentSecondary);
      crownInst.setColorAt(idx, col);
    });
    crownInst.computeBoundingSphere();
    group.add(crownInst);
  }

  // 6. Instanced Roadside Street Light Poles & Glowing Overhead Lamps
  const lampCount = Math.floor(n / 8) * 2;
  const poleGeo = trackGeo(new THREE.BoxGeometry(0.26, 8.8, 0.26));
  poleGeo.translate(0, 4.4, 0);
  const poleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x242e45, roughness: 0.45, metalness: 0.7 }));
  const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampCount);

  const bulbGeo = trackGeo(new THREE.BoxGeometry(2.6, 0.22, 0.42));
  const bulbMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xdff6ff }));
  const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, lampCount);

  const dummy = new THREE.Object3D();
  let lIdx = 0;
  for (let i = 0; i < n && lIdx + 1 < lampCount; i += 8) {
    const s = samples[i];
    if (s.isTunnel) continue;
    const yaw = Math.atan2(s.tx, s.tz);
    for (const side of [-1, 1]) {
      const px = s.x + s.rx * side * (halfW + 1.2);
      const pz = s.z + s.rz * side * (halfW + 1.2);
      dummy.position.set(px, s.y, pz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(lIdx, dummy.matrix);

      const bx = s.x + s.rx * side * (halfW - 0.4);
      const bz = s.z + s.rz * side * (halfW - 0.4);
      dummy.position.set(bx, s.y + 8.75, bz);
      dummy.updateMatrix();
      bulbInst.setMatrixAt(lIdx, dummy.matrix);
      lIdx++;
    }
  }
  poleInst.count = lIdx;
  bulbInst.count = lIdx;
  poleInst.computeBoundingSphere();
  bulbInst.computeBoundingSphere();
  group.add(poleInst, bulbInst);

  // 6b. Iconic Blur Neon Corner Chevron Warning Panels on sharp turns
  const chevronSamples: { s: typeof samples[number]; side: number }[] = [];
  for (let i = 0; i < n; i += 3) {
    const s = samples[i];
    if (!s.isTunnel && Math.abs(s.curvature) > 0.044) {
      // Mount chevron on the OUTSIDE barrier of the turn
      const outsideSide = s.curvature > 0 ? 1 : -1;
      chevronSamples.push({ s, side: outsideSide });
    }
  }
  if (chevronSamples.length > 0) {
    const chevGeo = trackGeo(new THREE.PlaneGeometry(4.4, 2.0));
    const chevMat = trackMat(
      new THREE.MeshBasicMaterial({
        map: textures.chevronSign,
        side: THREE.DoubleSide,
      }),
    );
    const chevInst = new THREE.InstancedMesh(chevGeo, chevMat, chevronSamples.length);
    chevronSamples.forEach(({ s, side }, idx) => {
      const cx = s.x + s.rx * side * (halfW + 0.35);
      const cz = s.z + s.rz * side * (halfW + 0.35);
      dummy.position.set(cx, s.y + 2.4, cz);
      // Angle panel slightly toward oncoming traffic
      dummy.rotation.set(0, Math.atan2(s.tx, s.tz) + (side > 0 ? -Math.PI / 2 - 0.18 : Math.PI / 2 + 0.18), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      chevInst.setMatrixAt(idx, dummy.matrix);
    });
    chevInst.computeBoundingSphere();
    group.add(chevInst);
  }

  // 7. Iconic Blur Holographic Floating Power-Up Emblem Gates (visible from 180m down the straight!)
  const pickupMeshes = new Map<string, THREE.Group>();
  const iconPlaneGeo = trackGeo(new THREE.PlaneGeometry(2.55, 2.55));
  const beamGeo = trackGeo(new THREE.CylinderGeometry(0.65, 1.35, 3.6, 12, 1, true));
  const ringGeo = trackGeo(new THREE.RingGeometry(1.05, 1.48, 24));
  ringGeo.rotateX(-Math.PI / 2);

  // Cache icon materials per PowerUpType (only 8 materials instead of 48!)
  const iconMats = {} as Record<PowerUpType, THREE.MeshBasicMaterial>;
  const beamMats = {} as Record<PowerUpType, THREE.MeshBasicMaterial>;
  const padMats = {} as Record<PowerUpType, THREE.MeshBasicMaterial>;

  for (const type of Object.keys(POWERUP_DEFS) as PowerUpType[]) {
    const def = POWERUP_DEFS[type];
    iconMats[type] = trackMat(
      new THREE.MeshBasicMaterial({
        map: textures.powerUpIcons[type],
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    beamMats[type] = trackMat(
      new THREE.MeshBasicMaterial({
        color: def.hexColor,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    padMats[type] = trackMat(
      new THREE.MeshBasicMaterial({
        color: def.hexColor,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  }

  for (const node of pickups) {
    const puGroup = new THREE.Group();
    puGroup.position.set(node.x, node.y, node.z);

    // Crossed double holographic emblem planes so icon is 100% readable from any angle
    const coreGroup = new THREE.Group();
    coreGroup.name = 'core';
    const planeA = new THREE.Mesh(iconPlaneGeo, iconMats[node.type]);
    const planeB = new THREE.Mesh(iconPlaneGeo, iconMats[node.type]);
    planeB.rotation.y = Math.PI / 2;
    coreGroup.add(planeA, planeB);
    puGroup.add(coreGroup);

    // Vertical holographic light beam column rising from road
    const beam = new THREE.Mesh(beamGeo, beamMats[node.type]);
    beam.name = 'ring';
    beam.position.y = 0.2;
    puGroup.add(beam);

    // Bright pulsing neon pad ring on the asphalt
    const pad = new THREE.Mesh(ringGeo, padMats[node.type]);
    pad.position.y = -1.48;
    puGroup.add(pad);

    group.add(puGroup);
    pickupMeshes.set(node.id, puGroup);
  }

  return {
    group,
    pickupMeshes,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
