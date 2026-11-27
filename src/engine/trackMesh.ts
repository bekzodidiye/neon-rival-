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
 * Generates a realistic, readable urban night racing circuit (V5.0 Stage 3):
 * - Continuous elevated wet-asphalt roadway with sidewalks, concrete Jersey barriers & steel guardrails
 * - Structural concrete viaduct underside & support piers on elevated overpass segments
 * - 4 distinct instanced architectural building archetypes (setback towers, chamfered corporate glass towers,
 *   mid-rise commercial podiums, and rooftop mechanical penthouses/spires)
 * - Curved cantilevered cobra-head streetlamps with warm light pools on the asphalt
 * - Overhead expressway directional sign gantries, corner chevrons, tunnel arches, and 3D power-up pickups
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

  // 0. Atmospheric Night Sky Dome
  const skyGeo = trackGeo(new THREE.SphereGeometry(1050, 24, 16));
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

  // 1. Urban Ground Plane extending seamlessly into horizon fog
  const groundGeo = trackGeo(new THREE.PlaneGeometry(2600, 2600));
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x0a0f18,
      roughness: 0.92,
      metalness: 0.04,
      envMapIntensity: 0.28,
    }),
  );
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(220, -0.18, 100);
  ground.receiveShadow = true;
  group.add(ground);

  // 2. Continuous Wet Asphalt Road Ribbon + Elevated Concrete Curbs/Sidewalks + Jersey Barriers + Guardrails
  const roadPositions: number[] = [];
  const roadNormals: number[] = [];
  const roadUvs: number[] = [];
  const roadIndices: number[] = [];

  const leftSidewalkPos: number[] = [];
  const rightSidewalkPos: number[] = [];
  const leftWallPos: number[] = [];
  const rightWallPos: number[] = [];
  const leftGuardPos: number[] = [];
  const rightGuardPos: number[] = [];
  const bridgeSideLeftPos: number[] = [];
  const bridgeSideRightPos: number[] = [];
  const ribbonIndices: number[] = [];

  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    const distAccum = i === n ? track.totalLength : s.cumDist;
    const vCoord = distAccum / 14;

    const lx = s.x - s.rx * halfW;
    const lz = s.z - s.rz * halfW;
    const rx = s.x + s.rx * halfW;
    const rz = s.z + s.rz * halfW;

    roadPositions.push(lx, s.y + 0.02, lz, rx, s.y + 0.02, rz);
    roadNormals.push(0, 1, 0, 0, 1, 0);
    roadUvs.push(0, vCoord, 1, vCoord);

    // Raised concrete sidewalk/apron strips outside road edge
    const swIn = halfW;
    const swOut = halfW + 2.8;
    leftSidewalkPos.push(
      s.x - s.rx * swOut, s.y + 0.22, s.z - s.rz * swOut,
      s.x - s.rx * swIn, s.y + 0.22, s.z - s.rz * swIn,
    );
    rightSidewalkPos.push(
      s.x + s.rx * swIn, s.y + 0.22, s.z + s.rz * swIn,
      s.x + s.rx * swOut, s.y + 0.22, s.z + s.rz * swOut,
    );

    // Concrete Jersey barrier wall (1.15m tall)
    const wallOut = halfW + 0.45;
    const wlx = s.x - s.rx * wallOut;
    const wlz = s.z - s.rz * wallOut;
    const wrx = s.x + s.rx * wallOut;
    const wrz = s.z + s.rz * wallOut;
    leftWallPos.push(wlx, s.y, wlz, wlx, s.y + 1.15, wlz);
    rightWallPos.push(wrx, s.y, wrz, wrx, s.y + 1.15, wrz);

    // Metallic reflective guardrail strip mounted cleanly on inner barrier face
    const railOut = halfW + 0.34;
    const rlx = s.x - s.rx * railOut;
    const rlz = s.z - s.rz * railOut;
    const rrx = s.x + s.rx * railOut;
    const rrz = s.z + s.rz * railOut;
    leftGuardPos.push(rlx, s.y + 0.68, rlz, rlx, s.y + 0.96, rlz);
    rightGuardPos.push(rrx, s.y + 0.68, rrz, rrx, s.y + 0.96, rrz);

    // Structural bridge fascia girder skirts under elevated segments
    const deckBottomY = Math.max(-0.18, s.y - 1.35);
    bridgeSideLeftPos.push(s.x - s.rx * swOut, deckBottomY, s.z - s.rz * swOut, s.x - s.rx * swOut, s.y + 0.22, s.z - s.rz * swOut);
    bridgeSideRightPos.push(s.x + s.rx * swOut, deckBottomY, s.z + s.rz * swOut, s.x + s.rx * swOut, s.y + 0.22, s.z + s.rz * swOut);

    if (i < n) {
      const base = i * 2;
      roadIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      ribbonIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
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
      roughness: 0.76,
      metalness: 0.08,
      envMapIntensity: 0.38,
      side: THREE.DoubleSide,
    }),
  );
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Sidewalks & concrete bridge deck fascias
  const concreteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x262f3e,
      roughness: 0.84,
      metalness: 0.12,
      side: THREE.DoubleSide,
    }),
  );
  for (const swVerts of [leftSidewalkPos, rightSidewalkPos]) {
    const swGeo = trackGeo(new THREE.BufferGeometry());
    swGeo.setAttribute('position', new THREE.Float32BufferAttribute(swVerts, 3));
    swGeo.setIndex(roadIndices);
    swGeo.computeVertexNormals();
    const swMesh = new THREE.Mesh(swGeo, concreteMat);
    swMesh.receiveShadow = true;
    group.add(swMesh);
  }

  const barrierMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x2c3648,
      roughness: 0.72,
      metalness: 0.2,
      side: THREE.DoubleSide,
    }),
  );
  for (const wallVerts of [leftWallPos, rightWallPos, bridgeSideLeftPos, bridgeSideRightPos]) {
    const wGeo = trackGeo(new THREE.BufferGeometry());
    wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
    wGeo.setIndex(ribbonIndices);
    wGeo.computeVertexNormals();
    group.add(new THREE.Mesh(wGeo, barrierMat));
  }

  // Steel urban highway guardrails with subtle accent reflection
  const guardrailMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7c8ca3,
      roughness: 0.34,
      metalness: 0.78,
      emissive: new THREE.Color(track.def.accentPrimary),
      emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
    }),
  );
  for (const gVerts of [leftGuardPos, rightGuardPos]) {
    const gGeo = trackGeo(new THREE.BufferGeometry());
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gVerts, 3));
    gGeo.setIndex(ribbonIndices);
    gGeo.computeVertexNormals();
    group.add(new THREE.Mesh(gGeo, guardrailMat));
  }

  // 2b. Structural Concrete Bridge Support Piers under elevated overpass segments
  const pierPositions: { x: number; y: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < n; i += 6) {
    const s = samples[i];
    if (s.y > 0.85) {
      pierPositions.push({ x: s.x, y: s.y, z: s.z, yaw: Math.atan2(s.tx, s.tz) });
    }
  }
  if (pierPositions.length > 0) {
    const pierGeo = trackGeo(new THREE.BoxGeometry(2.2, 1, 2.2));
    pierGeo.translate(0, 0.5, 0);
    const pierInst = new THREE.InstancedMesh(pierGeo, concreteMat, pierPositions.length * 2);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (const p of pierPositions) {
      const s = samples.find((sm) => sm.x === p.x && sm.z === p.z) ?? samples[0];
      for (const side of [-1, 1]) {
        dummy.position.set(p.x + s.rx * side * (halfW - 2.2), -0.18, p.z + s.rz * side * (halfW - 2.2));
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(1, p.y + 0.25, 1);
        dummy.updateMatrix();
        pierInst.setMatrixAt(idx++, dummy.matrix);
      }
    }
    pierInst.computeBoundingSphere();
    group.add(pierInst);
  }

  // 3. Start / Finish Illuminated Motorsport Gantry Arch + Overhead Expressway Directional Sign Gantries
  const pillarMat = trackMat(
    new THREE.MeshStandardMaterial({ color: 0x263144, roughness: 0.42, metalness: 0.72 }),
  );
  const startSample = samples[0];
  const gantryGroup = new THREE.Group();
  gantryGroup.position.set(startSample.x, startSample.y, startSample.z);
  gantryGroup.rotation.y = Math.atan2(startSample.tx, startSample.tz);

  const pillarGeo = trackGeo(new THREE.BoxGeometry(1.3, 11.2, 1.6));
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(sx * (halfW + 1.4), 5.6, 0);
    gantryGroup.add(pillar);
  }
  const bannerGeo = trackGeo(new THREE.BoxGeometry(track.def.roadWidth + 4.2, 2.6, 1.1));
  const bannerMat = trackMat(new THREE.MeshBasicMaterial({ map: textures.gantryBanner }));
  const banner = new THREE.Mesh(bannerGeo, bannerMat);
  banner.position.set(0, 10.4, 0);
  gantryGroup.add(banner);
  group.add(gantryGroup);

  // Overhead highway directional sign gantries at 22%, 58%, 88% of circuit
  const signTrussGeo = trackGeo(new THREE.BoxGeometry(track.def.roadWidth + 4.6, 0.75, 0.75));
  const signBoardGeo = trackGeo(new THREE.BoxGeometry(11.5, 3.2, 0.32));
  const signBoardMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: textures.highwaySign,
      emissiveMap: textures.highwaySign,
      emissive: 0xffffff,
      emissiveIntensity: 0.48,
      roughness: 0.4,
    }),
  );
  for (const frac of [0.22, 0.58, 0.88]) {
    const s = samples[Math.floor(frac * n) % n];
    if (s.isTunnel) continue;
    const g = new THREE.Group();
    g.position.set(s.x, s.y, s.z);
    g.rotation.y = Math.atan2(s.tx, s.tz);
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.scale.set(0.65, 0.85, 0.65);
      p.position.set(sx * (halfW + 1.5), 4.7, 0);
      g.add(p);
    }
    const truss = new THREE.Mesh(signTrussGeo, pillarMat);
    truss.position.set(0, 9.1, 0);
    g.add(truss);
    const board = new THREE.Mesh(signBoardGeo, signBoardMat);
    board.position.set(0, 8.6, 0.45);
    g.add(board);
    group.add(g);
  }

  // 4. Urban Concrete Tunnel Arches with Recessed Overhead Sodium/LED Strip Lighting
  const tunnelArchIndices: number[] = [];
  for (let i = 0; i < n; i += 2) {
    if (samples[i].isTunnel) tunnelArchIndices.push(i);
  }
  if (tunnelArchIndices.length > 0) {
    const archGeo = trackGeo(new THREE.TorusGeometry(halfW + 1.2, 0.9, 6, 16, Math.PI));
    const archMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1c2434, roughness: 0.68, metalness: 0.3 }),
    );
    const archInst = new THREE.InstancedMesh(archGeo, archMat, tunnelArchIndices.length);

    const lightStripGeo = trackGeo(new THREE.BoxGeometry(7.5, 0.22, 0.48));
    const lightStripMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xffe4b5 }));
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

  // 5. Multi-Archetype Urban City Kit (Setback Towers, Chamfered Corporate High-Rises, Mid-Rise Commercial, Rooftop Equipment)
  interface BuildingPlacement {
    x: number;
    z: number;
    sx: number;
    sy: number;
    sz: number;
    rotY: number;
    color: number;
    archetype: 0 | 1 | 2; // 0 = setback tower, 1 = chamfered glass tower, 2 = mid-rise commercial
  }
  const placements: BuildingPlacement[] = [];
  const minClearanceSq = (halfW + 15) * (halfW + 15);

  for (let i = 0; i < n; i += 4) {
    const s = samples[i];
    if (s.isTunnel) continue;
    for (const side of [-1, 1]) {
      const offsetDist = halfW + 19 + ((i * 17 + (side > 0 ? 7 : 3)) % 24);
      const bx = s.x + s.rx * side * offsetDist;
      const bz = s.z + s.rz * side * offsetDist;

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

      const arch = ((i + (side > 0 ? 1 : 0)) % 3) as 0 | 1 | 2;
      const width = arch === 2 ? 18 + ((i * 11) % 10) : 14 + ((i * 13) % 12);
      const depth = arch === 2 ? 16 + ((i * 19) % 10) : 14 + ((i * 29) % 14);
      const height =
        arch === 2
          ? 20 + ((i * 23 + (side > 0 ? 9 : 3)) % 22)
          : 40 + ((i * 41 + (side > 0 ? 19 : 5)) % 72);
      const tint =
        arch === 0 ? 0xcad6e8 : arch === 1 ? 0xa8c2dc : 0xd8cfc2;

      placements.push({
        x: bx,
        z: bz,
        sx: width,
        sy: height,
        sz: depth,
        rotY: Math.atan2(s.tx, s.tz),
        color: tint,
        archetype: arch,
      });
    }
  }

  if (placements.length > 0) {
    const facadeMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x5c6a82,
        map: textures.buildingFacade,
        emissive: 0xffffff,
        emissiveMap: textures.buildingEmissive,
        emissiveIntensity: 0.92,
        roughness: 0.72,
        metalness: 0.24,
        envMapIntensity: 0.36,
      }),
    );

    const glassTowerMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3b4e68,
        map: textures.buildingFacade,
        emissive: 0xffffff,
        emissiveMap: textures.buildingEmissive,
        emissiveIntensity: 0.85,
        roughness: 0.36,
        metalness: 0.62,
        envMapIntensity: 0.55,
      }),
    );

    const rooftopMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x222a38,
        roughness: 0.8,
        metalness: 0.3,
      }),
    );

    // Archetype 0: Stepped Setback Skyscrapers (base podium + upper slender shaft)
    const arch0 = placements.filter((b) => b.archetype === 0);
    // Archetype 1: Chamfered Octagonal Glass Corporate Towers
    const arch1 = placements.filter((b) => b.archetype === 1);
    // Archetype 2: Mid-Rise Urban Commercial Blocks
    const arch2 = placements.filter((b) => b.archetype === 2);

    const boxUnit = trackGeo(new THREE.BoxGeometry(1, 1, 1));
    boxUnit.translate(0, 0.5, 0);

    const chamferTowerGeo = trackGeo(new THREE.CylinderGeometry(0.62, 0.68, 1, 8));
    chamferTowerGeo.rotateY(Math.PI / 8);
    chamferTowerGeo.translate(0, 0.5, 0);

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();

    if (arch0.length > 0) {
      const podiumInst = new THREE.InstancedMesh(boxUnit, facadeMat, arch0.length);
      const upperInst = new THREE.InstancedMesh(boxUnit, facadeMat, arch0.length);
      arch0.forEach((bt, idx) => {
        const podH = bt.sy * 0.42;
        dummy.position.set(bt.x, -0.18, bt.z);
        dummy.rotation.set(0, bt.rotY, 0);
        dummy.scale.set(bt.sx, podH, bt.sz);
        dummy.updateMatrix();
        podiumInst.setMatrixAt(idx, dummy.matrix);
        col.setHex(bt.color);
        podiumInst.setColorAt(idx, col);

        dummy.position.set(bt.x, podH - 0.18, bt.z);
        dummy.scale.set(bt.sx * 0.72, bt.sy * 0.58, bt.sz * 0.72);
        dummy.updateMatrix();
        upperInst.setMatrixAt(idx, dummy.matrix);
        upperInst.setColorAt(idx, col);
      });
      podiumInst.computeBoundingSphere();
      upperInst.computeBoundingSphere();
      group.add(podiumInst, upperInst);
    }

    if (arch1.length > 0) {
      const towerInst = new THREE.InstancedMesh(chamferTowerGeo, glassTowerMat, arch1.length);
      arch1.forEach((bt, idx) => {
        dummy.position.set(bt.x, -0.18, bt.z);
        dummy.rotation.set(0, bt.rotY, 0);
        dummy.scale.set(bt.sx * 0.92, bt.sy, bt.sz * 0.92);
        dummy.updateMatrix();
        towerInst.setMatrixAt(idx, dummy.matrix);
        col.setHex(bt.color);
        towerInst.setColorAt(idx, col);
      });
      towerInst.computeBoundingSphere();
      group.add(towerInst);
    }

    if (arch2.length > 0) {
      const midInst = new THREE.InstancedMesh(boxUnit, facadeMat, arch2.length);
      arch2.forEach((bt, idx) => {
        dummy.position.set(bt.x, -0.18, bt.z);
        dummy.rotation.set(0, bt.rotY, 0);
        dummy.scale.set(bt.sx, bt.sy, bt.sz);
        dummy.updateMatrix();
        midInst.setMatrixAt(idx, dummy.matrix);
        col.setHex(bt.color);
        midInst.setColorAt(idx, col);
      });
      midInst.computeBoundingSphere();
      group.add(midInst);
    }

    // Rooftop HVAC penthouses + architectural aviation warning spires
    const mechInst = new THREE.InstancedMesh(boxUnit, rooftopMat, placements.length);
    const spireGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.25, 9, 6));
    spireGeo.translate(0, 4.5, 0);
    const spireInst = new THREE.InstancedMesh(spireGeo, pillarMat, placements.length);

    placements.forEach((bt, idx) => {
      const topScale = bt.archetype === 0 ? 0.42 : 0.48;
      dummy.position.set(bt.x, bt.sy - 0.2, bt.z);
      dummy.rotation.set(0, bt.rotY, 0);
      dummy.scale.set(bt.sx * topScale, 3.2 + (idx % 3) * 1.4, bt.sz * topScale);
      dummy.updateMatrix();
      mechInst.setMatrixAt(idx, dummy.matrix);

      // Add spire only on tall buildings
      const hasSpire = bt.sy > 58 ? 1 : 0;
      dummy.position.set(bt.x, bt.sy + 3.0, bt.z);
      dummy.scale.set(hasSpire, hasSpire, hasSpire);
      dummy.updateMatrix();
      spireInst.setMatrixAt(idx, dummy.matrix);
    });
    mechInst.computeBoundingSphere();
    spireInst.computeBoundingSphere();
    group.add(mechInst, spireInst);
  }

  // 6. Curved Cantilevered Cobra-Head Urban Streetlights + Warm Road Light Pools
  const lampCount = Math.floor(n / 8) * 2;
  const poleGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.16, 9.0, 8));
  poleGeo.translate(0, 4.5, 0);
  const armGeo = trackGeo(new THREE.BoxGeometry(2.8, 0.14, 0.16));
  const poleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x323d52, roughness: 0.45, metalness: 0.72 }));
  const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampCount);
  const armInst = new THREE.InstancedMesh(armGeo, poleMat, lampCount);

  const bulbGeo = trackGeo(new THREE.BoxGeometry(1.1, 0.16, 0.36));
  const bulbMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xfff0d4 }));
  const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, lampCount);

  const poolGeo = trackGeo(new THREE.PlaneGeometry(8.8, 8.8));
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0xffdeb0,
      map: textures.neonGlow,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const poolInst = new THREE.InstancedMesh(poolGeo, poolMat, lampCount);

  const dummy = new THREE.Object3D();
  let lIdx = 0;
  for (let i = 0; i < n && lIdx + 1 < lampCount; i += 8) {
    const s = samples[i];
    if (s.isTunnel) continue;
    const yaw = Math.atan2(s.tx, s.tz);
    for (const side of [-1, 1]) {
      const px = s.x + s.rx * side * (halfW + 1.15);
      const pz = s.z + s.rz * side * (halfW + 1.15);
      dummy.position.set(px, s.y, pz);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(lIdx, dummy.matrix);

      // Cantilevered mast arm extending inward over lane
      const ax = s.x + s.rx * side * (halfW - 0.15);
      const az = s.z + s.rz * side * (halfW - 0.15);
      dummy.position.set(ax, s.y + 8.95, az);
      dummy.updateMatrix();
      armInst.setMatrixAt(lIdx, dummy.matrix);

      // Cobra-head warm LED fixture
      const bx = s.x + s.rx * side * (halfW - 1.3);
      const bz = s.z + s.rz * side * (halfW - 1.3);
      dummy.position.set(bx, s.y + 8.85, bz);
      dummy.updateMatrix();
      bulbInst.setMatrixAt(lIdx, dummy.matrix);

      // Soft warm streetlamp light pool projected onto wet asphalt
      dummy.position.set(bx, s.y + 0.045, bz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poolInst.setMatrixAt(lIdx, dummy.matrix);

      lIdx++;
    }
  }
  poleInst.count = lIdx;
  armInst.count = lIdx;
  bulbInst.count = lIdx;
  poolInst.count = lIdx;
  poleInst.computeBoundingSphere();
  armInst.computeBoundingSphere();
  bulbInst.computeBoundingSphere();
  poolInst.computeBoundingSphere();
  group.add(poleInst, armInst, bulbInst, poolInst);

  // 6b. High-Contrast Corner Chevron Warning Panels on sharp turns
  const chevronSamples: { s: typeof samples[number]; side: number }[] = [];
  for (let i = 0; i < n; i += 3) {
    const s = samples[i];
    if (!s.isTunnel && Math.abs(s.curvature) > 0.042) {
      const outsideSide = s.curvature > 0 ? 1 : -1;
      chevronSamples.push({ s, side: outsideSide });
    }
  }
  if (chevronSamples.length > 0) {
    const chevGeo = trackGeo(new THREE.PlaneGeometry(4.2, 1.85));
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
      dummy.position.set(cx, s.y + 2.15, cz);
      dummy.rotation.set(0, Math.atan2(s.tx, s.tz) + (side > 0 ? -Math.PI / 2 - 0.18 : Math.PI / 2 + 0.18), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      chevInst.setMatrixAt(idx, dummy.matrix);
    });
    chevInst.computeBoundingSphere();
    group.add(chevInst);
  }

  // 7. Distinct 3D Holographic Floating Power-Up Emblem Gates
  const pickupMeshes = new Map<string, THREE.Group>();
  const iconPlaneGeo = trackGeo(new THREE.PlaneGeometry(2.45, 2.45));
  const beamGeo = trackGeo(new THREE.CylinderGeometry(0.58, 1.25, 3.4, 12, 1, true));
  const ringGeo = trackGeo(new THREE.RingGeometry(1.0, 1.42, 24));
  ringGeo.rotateX(-Math.PI / 2);

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
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    padMats[type] = trackMat(
      new THREE.MeshBasicMaterial({
        color: def.hexColor,
        transparent: true,
        opacity: 0.68,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  }

  for (const node of pickups) {
    const puGroup = new THREE.Group();
    puGroup.position.set(node.x, node.y, node.z);

    const coreGroup = new THREE.Group();
    coreGroup.name = 'core';
    const planeA = new THREE.Mesh(iconPlaneGeo, iconMats[node.type]);
    const planeB = new THREE.Mesh(iconPlaneGeo, iconMats[node.type]);
    planeB.rotation.y = Math.PI / 2;
    coreGroup.add(planeA, planeB);
    puGroup.add(coreGroup);

    const beam = new THREE.Mesh(beamGeo, beamMats[node.type]);
    beam.name = 'ring';
    beam.position.y = 0.15;
    puGroup.add(beam);

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
