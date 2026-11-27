import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type {
  BargeWaveState,
  CameraMode,
  CombatFeedItem,
  GraphicsPreset,
  MineState,
  PowerUpType,
  ProjectileState,
  RaceConfig,
  RaceHudSnapshot,
  RacerState,
  SettingsState,
  ShockZoneState,
  TrackPickupNode,
  VehicleCustomization,
} from '../game/types';
import {
  buildTrack,
  forwardTrackDistance,
  generateTrackPickups,
  getSpawnGridTransform,
  normalizeT,
  sampleTrackAt,
  sortRaceStandings,
  updateRacerCheckpoints,
  type BuiltTrack,
} from '../game/trackMath';
import { getVehicleById, PAINT_PRESETS, VEHICLES } from '../game/vehicles';
import {
  applyCombatDamage,
  applyRepairPowerUp,
  collectPowerUp,
  consumeActivePowerUp,
  cyclePowerUpSlot,
  discardPowerUpSlot,
  POWERUP_BALANCE,
  POWERUP_DEFS,
} from '../game/powerups';
import { resolveCarCollisions, stepVehiclePhysics } from '../game/physics';
import { AI_DRIVER_NAMES, computeAiInput } from '../game/ai';
import { createProceduralTexturePack, type ProceduralTexturePack } from './proceduralTextures';
import { applyVehicleCustomization, buildVehicleRig, type VehicleRig } from './vehicleMesh';
import { buildTrackScene, type BuiltTrackScene } from './trackMesh';
import { RacingAudioEngine } from './audio';
import { RacingInputHub } from './input';

export type EngineMode = 'title' | 'garage' | 'playing' | 'paused' | 'results';

export interface RemoteRacerPatch {
  id: string;
  name: string;
  vehicleId: string;
  customization: VehicleCustomization;
  x: number;
  z: number;
  heading: number;
  speed: number;
  hp: number;
  lap: number;
  totalProgress: number;
  shieldTimer: number;
  nitroTimer: number;
  destroyed: boolean;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: RaceHudSnapshot) => void;
  onPauseToggle: () => void;
  onRaceFinished: (snapshot: RaceHudSnapshot) => void;
  onSendMultiplayerState?: (state: {
    x: number;
    z: number;
    heading: number;
    speed: number;
    hp: number;
    lap: number;
    totalProgress: number;
    shieldTimer: number;
    nitroTimer: number;
    destroyed: boolean;
  }) => void;
  onSendMultiplayerCombat?: (event: {
    type: PowerUpType;
    rearFired: boolean;
    x: number;
    z: number;
    heading: number;
  }) => void;
}

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
}

// Module-scope reusable math helpers (zero per-frame GC allocation)
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _tmpColor = new THREE.Color();

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

/**
 * Custom dark midnight neon PMREM scene so metallic cars and wet asphalt reflect
 * deep indigo skies plus vibrant cyan/magenta/amber street strips — never a white studio ceiling.
 */
function createNightCityEnvScene(): THREE.Scene {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x060a18);

  const shellGeo = new THREE.BoxGeometry(30, 18, 30);
  const shellMat = new THREE.MeshBasicMaterial({ color: 0x070c1c, side: THREE.BackSide });
  env.add(new THREE.Mesh(shellGeo, shellMat));

  const strips: { pos: [number, number, number]; size: [number, number, number]; color: number }[] = [
    // Deep violet-indigo overhead night haze (keeps car roofs sleek & dark, never white)
    { pos: [0, 8.6, 0], size: [18, 0.2, 18], color: 0x1b2b58 },
    // Cyan neon city horizon bar (left)
    { pos: [-14.2, 1.8, 0], size: [0.3, 2.2, 22], color: 0x00c8ff },
    // Magenta neon city horizon bar (right)
    { pos: [14.2, 1.8, 0], size: [0.3, 2.2, 22], color: 0xff2a85 },
    // Cool cyan-blue distant skyline glow (front)
    { pos: [0, 2.4, 14.2], size: [22, 1.8, 0.3], color: 0x3b82f6 },
    // Warm amber/crimson streetlamp reflection (back)
    { pos: [0, 2.0, -14.2], size: [20, 1.6, 0.3], color: 0xff6b35 },
  ];
  for (const s of strips) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]),
      new THREE.MeshBasicMaterial({ color: s.color }),
    );
    m.position.set(s.pos[0], s.pos[1], s.pos[2]);
    env.add(m);
  }
  return env;
}

export class RaceEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  public readonly audio: RacingAudioEngine;
  public readonly input: RacingInputHub;
  public readonly isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private textures: ProceduralTexturePack;

  // World objects
  private currentTrack: BuiltTrack;
  private trackScene: BuiltTrackScene | null = null;
  private garageGroup: THREE.Group;
  private garageHeroRig: VehicleRig | null = null;
  private garageVehicleId = 'street_falcon';
  private garageOrbitYaw = 0.65;
  private garageOrbitPitch = 0.24;
  private garageOrbitDist = 6.9;
  private isDraggingGarage = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Active race state
  private mode: EngineMode = 'title';
  private raceConfig: RaceConfig | null = null;
  private racers: RacerState[] = [];
  private racerRigs = new Map<string, VehicleRig>();
  private pickups: TrackPickupNode[] = [];
  private projectiles: ProjectileState[] = [];
  private projectileMeshes = new Map<string, THREE.Mesh>();
  private mines: MineState[] = [];
  private mineMeshes = new Map<string, THREE.Mesh>();
  private shockZones: ShockZoneState[] = [];
  private shockMeshes = new Map<string, THREE.Group>();
  private bargeWaves: BargeWaveState[] = [];
  private bargeMeshes = new Map<string, THREE.Mesh>();

  private combatGroup: THREE.Group;
  private particleMesh: THREE.InstancedMesh;
  private particles: PooledParticle[] = [];
  private particleCursor = 0;

  // Timing & race phase
  private frameId = 0;
  private disposed = false;
  private lastFrameTs = 0;
  private elapsedClock = 0;
  private racePhase: 'countdown' | 'racing' | 'finished' = 'countdown';
  private countdownTimer = 3.2;
  private lastCountdownInt = 4;
  private raceTime = 0;
  private hitstopTimer = 0;
  private cameraTrauma = 0;
  private cameraMode: CameraMode = 'near';
  private currentCamPos = new THREE.Vector3(0, 6, -12);
  private currentCamLook = new THREE.Vector3(0, 1, 10);
  private finalLapShown = false;
  private eliminationTimer = 25;
  private combatFeed: CombatFeedItem[] = [];
  private hudEmitAccum = 0;
  private netEmitAccum = 0;
  private pingMs = 0;
  private fpsSamples = 0;
  private fpsAccum = 0;
  private measuredFps = 60;
  private entityCounter = 0;

  // Shared combat geometries/materials
  private shuntGeo = new THREE.SphereGeometry(0.62, 12, 12);
  private shuntMat = new THREE.MeshBasicMaterial({ color: 0xff365e });
  private boltGeo = new THREE.CapsuleGeometry(0.24, 1.1, 4, 8);
  private boltMat = new THREE.MeshBasicMaterial({ color: 0xff8a00 });
  private mineGeo = new THREE.DodecahedronGeometry(0.75, 0);
  private mineMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  private bargeGeo = new THREE.RingGeometry(0.7, 1.0, 28);
  private shockDomeGeo = new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);

  private resizeObserver: ResizeObserver;
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: () => void;

  constructor(container: HTMLElement, callbacks: EngineCallbacks, initialSettings: SettingsState) {
    this.container = container;
    this.callbacks = callbacks;
    this.audio = new RacingAudioEngine();
    this.audio.applySettings(initialSettings);
    this.input = new RacingInputHub();
    this.input.setAutoAccelerate(initialSettings.autoAccelerate);
    this.isSoftwareGl = detectSoftwareWebGL();

    // Renderer configured per Three.js studio PBR + Software-WebGL guard
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && initialSettings.graphics !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060a16);
    this.scene.fog = new THREE.FogExp2(0x080e20, 0.0021);

    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(62, w / h, 0.25, 1400);
    this.renderer.setSize(w, h, false);

    // Custom dark Night-City Neon PMREM for glossy metallic car reflections & glare-free dark wet asphalt
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = createNightCityEnvScene();
    this.envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.85;
    pmrem.dispose();

    // Cool nocturnal sky/ground fill + angled moonlight rim key light (zero white road washout!)
    this.hemiLight = new THREE.HemisphereLight(0x3a62b8, 0x120924, 0.42);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0x9ec5ff, 0.68);
    this.keyLight.position.set(88, 56, -52);
    this.keyLight.castShadow = !this.isSoftwareGl;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 10;
    this.keyLight.shadow.camera.far = 210;
    const sd = 55;
    this.keyLight.shadow.camera.left = -sd;
    this.keyLight.shadow.camera.right = sd;
    this.keyLight.shadow.camera.top = sd;
    this.keyLight.shadow.camera.bottom = -sd;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    // Authentic Blur neon bloom post-processing on hardware GPUs (skipped on software WebGL)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.42, 0.72);
      this.composer.addPass(this.bloomPass);
    }

    // Procedural Textures
    this.textures = createProceduralTexturePack(this.renderer.capabilities.getMaxAnisotropy());

    // Build initial Neon City track for live Title background
    this.currentTrack = buildTrack('neon_city');
    this.pickups = generateTrackPickups(this.currentTrack);
    this.rebuildTrackScene();

    // Combat effects container
    this.combatGroup = new THREE.Group();
    this.scene.add(this.combatGroup);
    this.bargeGeo.rotateX(-Math.PI / 2);

    // Pooled InstancedMesh particle ring buffer (zero GC)
    const maxParticles = 240;
    const pGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, maxParticles);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    for (let i = 0; i < maxParticles; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        scale: 0,
        color: new THREE.Color(0x00c8ff),
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
    }

    // Build Interactive 3D Garage Showcase Rig (positioned at origin on wet reflective turntable)
    this.garageGroup = new THREE.Group();
    this.buildGarageStage();
    this.scene.add(this.garageGroup);

    // Load default hero car for Title & Garage
    this.setShowcaseVehicle(VEHICLES[0].id, VEHICLES[0].defaultCustomization);
    this.setMode('title');

    // Interactive orbit drag for 3D Garage
    this.onPointerDownBound = (e: PointerEvent) => {
      if (this.mode !== 'garage') return;
      this.isDraggingGarage = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    };
    this.onPointerMoveBound = (e: PointerEvent) => {
      if (!this.isDraggingGarage || this.mode !== 'garage') return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.garageOrbitYaw -= dx * 0.008;
      this.garageOrbitPitch = Math.max(0.08, Math.min(0.65, this.garageOrbitPitch + dy * 0.005));
    };
    this.onPointerUpBound = () => {
      this.isDraggingGarage = false;
    };
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDownBound);
    window.addEventListener('pointermove', this.onPointerMoveBound);
    window.addEventListener('pointerup', this.onPointerUpBound);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.lastFrameTs = performance.now();
    this.scheduleNextTick();
  }

  private buildGarageStage(): void {
    // Sleek dark reflective circular turntable + neon halo ring right on Neon City start grid
    const baseGeo = new THREE.CylinderGeometry(4.6, 5.0, 0.22, 40);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0c1222,
      roughness: 0.14,
      metalness: 0.82,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, -0.05, 0);
    base.receiveShadow = true;
    this.garageGroup.add(base);

    const haloGeo = new THREE.TorusGeometry(4.65, 0.06, 8, 48);
    haloGeo.rotateX(Math.PI / 2);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x00c8ff });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 0.08, 0);
    this.garageGroup.add(halo);

    // Position garage turntable slightly ahead of start gantry on the wet Neon City straight
    const s = sampleTrackAt(this.currentTrack, 0.985);
    this.garageGroup.position.set(s.x, s.y + 0.02, s.z);
    this.garageGroup.rotation.y = Math.atan2(s.tx, s.tz);
  }

  private rebuildTrackScene(): void {
    if (this.trackScene) {
      this.scene.remove(this.trackScene.group);
      this.trackScene.dispose();
      this.trackScene = null;
    }
    this.scene.background = new THREE.Color(this.currentTrack.def.skyColor);
    this.scene.fog = new THREE.FogExp2(this.currentTrack.def.fogColor, this.currentTrack.def.fogDensity);

    this.trackScene = buildTrackScene(this.currentTrack, this.textures, this.pickups);
    this.scene.add(this.trackScene.group);
  }

  public setShowcaseVehicle(vehicleId: string, customization: VehicleCustomization): void {
    if (this.garageHeroRig && this.garageVehicleId === vehicleId) {
      applyVehicleCustomization(this.garageHeroRig, customization);
      return;
    }
    if (this.garageHeroRig) {
      this.garageGroup.remove(this.garageHeroRig.root);
      this.garageHeroRig.dispose();
    }
    const cfg = getVehicleById(vehicleId);
    this.garageVehicleId = vehicleId;
    this.garageHeroRig = buildVehicleRig(
      cfg.archetype,
      customization,
      this.textures.contactShadow,
      !this.isSoftwareGl,
      this.textures.neonGlow,
      this.textures.headlightBeam,
      this.textures.tailTrail,
    );
    this.garageHeroRig.root.position.set(0, 0.07, 0);
    this.garageGroup.add(this.garageHeroRig.root);
  }

  public applyGraphicsPreset(preset: GraphicsPreset): void {
    if (this.isSoftwareGl) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    if (preset === 'low') {
      this.renderer.setPixelRatio(Math.min(dpr, 1));
      this.renderer.shadowMap.enabled = false;
    } else if (preset === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.25));
      this.renderer.shadowMap.enabled = true;
    } else if (preset === 'high') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.75));
      this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.shadowMap.enabled = true;
    }
  }

  public applySettings(settings: SettingsState): void {
    this.audio.applySettings(settings);
    this.input.setAutoAccelerate(settings.autoAccelerate);
    this.applyGraphicsPreset(settings.graphics);
  }

  public setPing(ms: number): void {
    this.pingMs = ms;
  }

  public setMode(mode: EngineMode): void {
    this.mode = mode;
    const isPlaying = mode === 'playing';
    this.input.setGameplayActive(isPlaying);
    this.audio.setEngineActive(isPlaying);
    this.garageGroup.visible = mode === 'title' || mode === 'garage';
    if (mode === 'title' || mode === 'garage') {
      this.clearRaceEntities();
      const s = sampleTrackAt(this.currentTrack, 0.985);
      this.garageGroup.position.set(s.x, s.y + 0.02, s.z);
      this.garageGroup.rotation.y = Math.atan2(s.tx, s.tz);
      // Immediately snap camera to hero showcase & render so Title/Garage never shows a blank frame
      if (mode === 'title') {
        const angle = 0.52;
        this.currentCamPos.set(s.x + Math.sin(angle) * 7.4, s.y + 2.17, s.z + Math.cos(angle) * 7.4);
        this.camera.position.copy(this.currentCamPos);
        this.camera.fov = 52;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(s.x + 1.55, s.y + 0.87, s.z);
      } else {
        this.currentCamPos.set(
          s.x + Math.sin(this.garageOrbitYaw) * Math.cos(this.garageOrbitPitch) * this.garageOrbitDist,
          s.y + 1.17 + Math.sin(this.garageOrbitPitch) * this.garageOrbitDist,
          s.z + Math.cos(this.garageOrbitYaw) * Math.cos(this.garageOrbitPitch) * this.garageOrbitDist,
        );
        this.camera.position.copy(this.currentCamPos);
        this.camera.fov = 48;
        this.camera.updateProjectionMatrix();
        this.camera.lookAt(s.x, s.y + 0.82, s.z);
      }
      this.renderCurrentFrame();
    }
  }

  private renderCurrentFrame(): void {
    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public cycleCamera(): void {
    const order: CameraMode[] = ['near', 'far', 'hood'];
    const idx = order.indexOf(this.cameraMode);
    this.cameraMode = order[(idx + 1) % order.length];
    this.audio.playUiClick();
  }

  public startRace(
    config: RaceConfig,
    playerName: string,
    remotePlayers: { id: string; name: string; vehicleId: string; customization: VehicleCustomization }[] = [],
  ): void {
    this.audio.unlock();
    this.clearRaceEntities();
    this.raceConfig = config;

    // Build selected track
    this.currentTrack = buildTrack(config.trackId);
    const includePowerUps = config.mode !== 'pure_race' && config.mode !== 'time_trial';
    this.pickups = includePowerUps ? generateTrackPickups(this.currentTrack) : [];
    this.rebuildTrackScene();

    // Build player + remote/AI racers on staggered start grid
    const racerEntries: {
      id: string;
      name: string;
      isPlayer: boolean;
      isRemote: boolean;
      vehicleId: string;
      customization: VehicleCustomization;
    }[] = [];

    // Place human player at front-middle row (slot 0 in Time Trial, slot 3 or last in full grid for exciting overtakes)
    const aiTotal = config.mode === 'time_trial' ? 0 : config.isMultiplayer ? Math.max(0, 4 - remotePlayers.length) : config.aiCount;

    // Add remote multiplayer opponents first
    for (const rp of remotePlayers) {
      racerEntries.push({
        id: rp.id,
        name: rp.name,
        isPlayer: false,
        isRemote: true,
        vehicleId: rp.vehicleId,
        customization: rp.customization,
      });
    }

    // Add AI rivals
    for (let i = 0; i < aiTotal; i++) {
      const carCfg = VEHICLES[i % VEHICLES.length];
      const paint = PAINT_PRESETS[(i + 2) % PAINT_PRESETS.length].hex;
      racerEntries.push({
        id: `ai_${i}`,
        name: AI_DRIVER_NAMES[i % AI_DRIVER_NAMES.length],
        isPlayer: false,
        isRemote: false,
        vehicleId: carCfg.id,
        customization: {
          ...carCfg.defaultCustomization,
          bodyColor: paint,
          underglowColor: paint,
        },
      });
    }

    // Insert local player in slot 2 (or 0 if solo) so player immediately sees rivals ahead + behind!
    const playerSlot = Math.min(2, racerEntries.length);
    racerEntries.splice(playerSlot, 0, {
      id: 'player_local',
      name: playerName || 'PLAYER',
      isPlayer: true,
      isRemote: false,
      vehicleId: config.vehicleId,
      customization: { ...config.customization },
    });

    this.racers = racerEntries.map((entry, idx) => {
      const spawn = getSpawnGridTransform(this.currentTrack, idx);
      const carDef = getVehicleById(entry.vehicleId);
      const state: RacerState = {
        id: entry.id,
        name: entry.name,
        isPlayer: entry.isPlayer,
        isRemote: entry.isRemote,
        vehicleId: entry.vehicleId,
        customization: entry.customization,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        vx: 0,
        vz: 0,
        heading: spawn.heading,
        angularVel: 0,
        speed: 0,
        lateralSpeed: 0,
        steerAngle: 0,
        wheelSpin: 0,
        bodyPitch: 0,
        bodyRoll: 0,
        isDrifting: false,
        driftTime: 0,
        nitroTimer: 0,
        nitroEnergy: 45,
        shieldTimer: 0,
        shockSlowTimer: 0,
        stunTimer: 0,
        spawnProtectTimer: 0,
        hitFlashTimer: 0,
        hp: carDef.stats.durability,
        maxHp: carDef.stats.durability,
        destroyed: false,
        respawnTimer: 0,
        inventory: [null, null, null],
        activeSlot: 0,
        rearFireMode: false,
        boltCooldown: 0,
        trackT: spawn.trackT,
        lateralOffset: spawn.lateralOffset,
        lap: 1,
        nextCheckpoint: 0,
        passedCheckpoints: 0,
        totalProgress: spawn.trackT - 1,
        position: idx + 1,
        finished: false,
        finishTime: 0,
        lapStartTime: 0,
        bestLapTime: 0,
        wrongWay: false,
        eliminated: false,
        hitsLanded: 0,
        takedowns: 0,
        powerUpsUsed: 0,
        blocksLanded: 0,
        damageDealt: 0,
        raceFans: 0,
        isDrafting: false,
        aiLaneOffset: spawn.lateralOffset,
        aiLaneTimer: 1 + idx * 0.3,
        aiDecisionTimer: 2.2 + idx * 0.4,
        aiAggression: 0.45 + (idx % 3) * 0.2,
      };

      const rig = buildVehicleRig(
        carDef.archetype,
        entry.customization,
        this.textures.contactShadow,
        !this.isSoftwareGl && (entry.isPlayer || idx < 4),
        this.textures.neonGlow,
        this.textures.headlightBeam,
        this.textures.tailTrail,
      );
      rig.root.position.set(state.x, state.y, state.z);
      rig.root.rotation.y = state.heading;
      this.scene.add(rig.root);
      this.racerRigs.set(state.id, rig);
      return state;
    });

    // Position chase camera smoothly behind the player immediately on race start
    const player = this.getPlayerRacer();
    if (player) {
      const fwdX = Math.sin(player.heading);
      const fwdZ = Math.cos(player.heading);
      this.currentCamPos.set(player.x - fwdX * 8.4, player.y + 3.55, player.z - fwdZ * 8.4);
      this.currentCamLook.set(player.x + fwdX * 18, player.y + 0.85, player.z + fwdZ * 18);
      this.camera.position.copy(this.currentCamPos);
      this.camera.lookAt(this.currentCamLook);
    }

    this.racePhase = 'countdown';
    this.countdownTimer = 2.1;
    this.lastCountdownInt = 4;
    this.raceTime = 0;
    this.hitstopTimer = 0;
    this.cameraTrauma = 0;
    this.finalLapShown = false;
    this.eliminationTimer = 25;
    this.combatFeed = [];
    this.setMode('playing');
    this.emitHudSnapshot();
  }

  /** Apply remote multiplayer racer state update with smooth blending. */
  public applyRemoteRacerUpdate(patch: RemoteRacerPatch): void {
    const target = this.racers.find((r) => r.id === patch.id && r.isRemote);
    if (!target) return;
    target.x += (patch.x - target.x) * 0.45;
    target.z += (patch.z - target.z) * 0.45;
    target.heading = patch.heading;
    target.speed = patch.speed;
    target.hp = patch.hp;
    target.lap = patch.lap;
    target.totalProgress = patch.totalProgress;
    target.shieldTimer = patch.shieldTimer;
    target.nitroTimer = patch.nitroTimer;
    target.destroyed = patch.destroyed;
  }

  public applyRemoteCombatEvent(ownerId: string, type: PowerUpType, rearFired: boolean): void {
    const owner = this.racers.find((r) => r.id === ownerId);
    if (!owner) return;
    this.executePowerUpEffect(owner, type, rearFired, true);
  }

  private getPlayerRacer(): RacerState | undefined {
    return this.racers.find((r) => r.isPlayer);
  }

  private clearRaceEntities(): void {
    for (const rig of this.racerRigs.values()) {
      this.scene.remove(rig.root);
      rig.dispose();
    }
    this.racerRigs.clear();
    this.racers = [];

    for (const m of this.projectileMeshes.values()) this.combatGroup.remove(m);
    this.projectileMeshes.clear();
    this.projectiles = [];

    for (const m of this.mineMeshes.values()) this.combatGroup.remove(m);
    this.mineMeshes.clear();
    this.mines = [];

    for (const g of this.shockMeshes.values()) this.combatGroup.remove(g);
    this.shockMeshes.clear();
    this.shockZones = [];

    for (const m of this.bargeMeshes.values()) this.combatGroup.remove(m);
    this.bargeMeshes.clear();
    this.bargeWaves = [];
  }

  private scheduleNextTick(): void {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  /** Software-WebGL GPU-fence pacing per Three.js skill (prevents headless Chromium CPU starvation). */
  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 32);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 4);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 15);
      }
    };
    this.frameId = window.setTimeout(poll, 4);
  }

  private tick(): void {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = Math.max(0.001, (now - this.lastFrameTs) / 1000);
    this.lastFrameTs = now;
    const realDt = Math.min(rawDt, 0.32);
    const dt = Math.min(rawDt, 0.05);
    this.elapsedClock += realDt;

    // Measured FPS tracker
    this.fpsSamples += 1;
    this.fpsAccum += rawDt;
    if (this.fpsAccum >= 0.5) {
      this.measuredFps = Math.round(this.fpsSamples / this.fpsAccum);
      this.fpsSamples = 0;
      this.fpsAccum = 0;
    }

    if (this.mode === 'title') {
      this.updateTitleCamera(dt);
    } else if (this.mode === 'garage') {
      this.updateGarageCamera(dt);
    } else if (this.mode === 'playing') {
      this.updateRaceFrame(realDt);
    }

    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.scheduleNextTick();
  }

  private updateTitleCamera(dt: number): void {
    // Smooth cinematic orbit around the hero sports car on the wet Neon City grid,
    // offsetting lookAt slightly left so the car sits in the right 60% and the left 38% stays calm for the title lockup.
    const anchor = this.garageGroup.position;
    const angle = 0.52 + Math.sin(this.elapsedClock * 0.22) * 0.28;
    const dist = 7.4;
    const desiredX = anchor.x + Math.sin(angle) * dist;
    const desiredY = anchor.y + 2.15 + Math.sin(this.elapsedClock * 0.4) * 0.15;
    const desiredZ = anchor.z + Math.cos(angle) * dist;

    const damp = 1 - Math.exp(-4.5 * dt);
    this.currentCamPos.x += (desiredX - this.currentCamPos.x) * damp;
    this.currentCamPos.y += (desiredY - this.currentCamPos.y) * damp;
    this.currentCamPos.z += (desiredZ - this.currentCamPos.z) * damp;

    // Shift look target toward car's right so the car frames cleanly in the right two-thirds
    this.camera.position.copy(this.currentCamPos);
    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(anchor.x + 1.55, anchor.y + 0.85, anchor.z);

    if (this.garageHeroRig) {
      this.garageHeroRig.root.rotation.y = Math.sin(this.elapsedClock * 0.35) * 0.12;
    }
    this.animatePickups(dt);
  }

  private updateGarageCamera(dt: number): void {
    if (!this.isDraggingGarage) {
      this.garageOrbitYaw += dt * 0.24;
    }
    const anchor = this.garageGroup.position;
    const desiredX = anchor.x + Math.sin(this.garageOrbitYaw) * Math.cos(this.garageOrbitPitch) * this.garageOrbitDist;
    const desiredY = anchor.y + 1.15 + Math.sin(this.garageOrbitPitch) * this.garageOrbitDist;
    const desiredZ = anchor.z + Math.cos(this.garageOrbitYaw) * Math.cos(this.garageOrbitPitch) * this.garageOrbitDist;

    const damp = 1 - Math.exp(-8 * dt);
    this.currentCamPos.x += (desiredX - this.currentCamPos.x) * damp;
    this.currentCamPos.y += (desiredY - this.currentCamPos.y) * damp;
    this.currentCamPos.z += (desiredZ - this.currentCamPos.z) * damp;

    this.camera.position.copy(this.currentCamPos);
    this.camera.fov = 48;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(anchor.x, anchor.y + 0.8, anchor.z);
  }

  private updateRaceFrame(frameDt: number): void {
    const { control, toggleCamera, toggleRearFire, pausePressed } = this.input.sampleFrame();
    if (pausePressed) {
      this.callbacks.onPauseToggle();
      return;
    }
    if (toggleCamera) {
      this.cycleCamera();
    }

    const player = this.getPlayerRacer();
    if (player && toggleRearFire) {
      player.rearFireMode = !player.rearFireMode;
      this.audio.playUiClick();
    }

    // Fixed-safe sub-stepping so physics & countdown stay true to real time even under low-FPS software WebGL
    const subSteps = Math.max(1, Math.min(6, Math.ceil(frameDt / 0.05)));
    const stepBaseDt = frameDt / subSteps;

    for (let stepIdx = 0; stepIdx < subSteps; stepIdx++) {
      // Only trigger one-shot edge actions on the first sub-step of the rendered frame
      const stepControl =
        stepIdx === 0
          ? control
          : {
              ...control,
              usePowerUp: false,
              useNitro: false,
              cycleSlot: false,
              discardSlot: false,
              selectSlot: -1,
              recover: false,
            };

      let simDt = stepBaseDt;
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - stepBaseDt);
        simDt = stepBaseDt * 0.12;
      }

      // Countdown state machine (advances in real wall-clock seconds)
      if (this.racePhase === 'countdown') {
        this.countdownTimer -= stepBaseDt;
        const countInt = Math.ceil(this.countdownTimer);
        if (countInt !== this.lastCountdownInt && countInt >= 1 && countInt <= 3) {
          this.lastCountdownInt = countInt;
          this.audio.playCountdown(false);
        }
        if (this.countdownTimer <= 0) {
          this.racePhase = 'racing';
          this.audio.playCountdown(true);
        }
      } else if (this.racePhase === 'racing') {
        this.raceTime += simDt;
      }

      const canDrive = this.racePhase === 'racing';
      const totalLaps = this.raceConfig?.laps ?? 3;
      const difficulty = this.raceConfig?.difficulty ?? 'normal';

      // Elimination mode timer
      if (canDrive && this.raceConfig?.mode === 'elimination') {
        this.eliminationTimer -= simDt;
        if (this.eliminationTimer <= 0) {
          this.eliminationTimer = 20;
          const active = sortRaceStandings(this.racers).filter((r) => !r.eliminated && !r.finished);
          if (active.length > 1) {
            const last = active[active.length - 1];
            last.eliminated = true;
            this.pushFeed(`${last.name} ELIMINATED`, '#FF365E');
            if (last.isPlayer) {
              this.finishRaceNow();
            }
          }
        }
      }

      // Step all racers
      for (const racer of this.racers) {
        if (racer.isRemote) {
          racer.wheelSpin += (racer.speed / 0.38) * simDt;
          continue;
        }

        const racerInput = racer.isPlayer
          ? stepControl
          : computeAiInput(racer, this.racers, this.currentTrack, this.pickups, this.projectiles, this.shockZones, difficulty, simDt);

        // Handle inventory selection / cycling / discard / activation
        if (canDrive && !racer.destroyed && !racer.eliminated) {
          if (racerInput.selectSlot >= 0 && racerInput.selectSlot < 3) {
            racer.activeSlot = racerInput.selectSlot;
          }
          if (racerInput.cycleSlot) {
            racer.activeSlot = cyclePowerUpSlot(racer.inventory, racer.activeSlot);
            if (racer.isPlayer) this.audio.playUiClick();
          }
          if (racerInput.discardSlot) {
            const res = discardPowerUpSlot(racer.inventory, racer.activeSlot);
            racer.activeSlot = res.newActiveSlot;
            if (racer.isPlayer && res.discarded) this.audio.playUiClick();
          }
          if (racerInput.usePowerUp && racer.boltCooldown <= 0) {
            const { firedType, newActiveSlot } = consumeActivePowerUp(racer.inventory, racer.activeSlot);
            racer.activeSlot = newActiveSlot;
            if (firedType) {
              racer.powerUpsUsed += 1;
              if (firedType === 'BOLT') racer.boltCooldown = POWERUP_BALANCE.BOLT_INTERVAL;
              const useRear = Boolean(racerInput.instantRearFire || racer.rearFireMode);
              this.executePowerUpEffect(racer, firedType, useRear, false);
            }
          }
        }

        // Authentic Blur Slipstream / Drafting detection (trailing 4..28m behind a rival in same lane)
        racer.isDrafting = false;
        if (canDrive && racer.speed > 36 && !racer.destroyed) {
          for (const other of this.racers) {
            if (other.id === racer.id || other.destroyed || other.eliminated) continue;
            const aheadDist = forwardTrackDistance(this.currentTrack, racer.trackT, other.trackT);
            if (aheadDist > 4.5 && aheadDist < 28 && Math.abs(other.lateralOffset - racer.lateralOffset) < 2.9) {
              racer.isDrafting = true;
              break;
            }
          }
        }

        const physEvents = stepVehiclePhysics(racer, racerInput, this.currentTrack, simDt, canDrive);

        // Award Blur FANS for clean drift exit boost!
        if (physEvents.driftBoostTriggered && racer.isPlayer) {
          this.awardFans(racer, 75, 'CLEAN DRIFT +75 FANS', '#25F4A0');
        }

        // Wall impact sparks, audio & Blur heavy-crash hull chip damage
        if (physEvents.wallHitIntensity > 0.25) {
          this.spawnBurst(racer.x, racer.y + 0.6, racer.z, 8, 0xffaa33, 12);
          if (physEvents.wallHitIntensity > 0.72 && racer.shieldTimer <= 0 && racer.spawnProtectTimer <= 0) {
            racer.hp = Math.max(5, racer.hp - Math.round(physEvents.wallHitIntensity * 6));
          }
          if (racer.isPlayer) {
            this.cameraTrauma = Math.min(1, this.cameraTrauma + physEvents.wallHitIntensity * 0.45);
            this.audio.playImpact(physEvents.wallHitIntensity > 0.65);
          }
        }

        // Drift tire smoke & Nitro exhaust sparks
        if (physEvents.driftIntensity > 0.25 && Math.random() < 0.72) {
          const backX = racer.x - Math.sin(racer.heading) * 1.8;
          const backZ = racer.z - Math.cos(racer.heading) * 1.8;
          this.spawnParticle(backX, racer.y + 0.25, backZ, (Math.random() - 0.5) * 3.2, 1.9, (Math.random() - 0.5) * 3.2, 0.42, 0.52, 0xff9f43);
        }
        if (physEvents.nitroActive && Math.random() < 0.9) {
          const backX = racer.x - Math.sin(racer.heading) * 2.4;
          const backZ = racer.z - Math.cos(racer.heading) * 2.4;
          this.spawnParticle(backX, racer.y + 0.35, backZ, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, 0.25, 0.44, 0x25f4a0);
        }

        // Damage smoke when HP < 45%
        if (racer.hp < racer.maxHp * 0.45 && !racer.destroyed && Math.random() < 0.35) {
          this.spawnParticle(racer.x, racer.y + 0.9, racer.z, (Math.random() - 0.5) * 2, 3.2, (Math.random() - 0.5) * 2, 0.6, 0.5, 0x3b4252);
        }

        // Update checkpoints & lap completion
        if (canDrive) {
          const cpRes = updateRacerCheckpoints(racer, this.currentTrack, racer.trackT, totalLaps, this.raceTime);
          if (racer.isPlayer && cpRes.lapCompleted && !cpRes.raceFinished && racer.lap === totalLaps) {
            this.finalLapShown = true;
            this.pushFeed('FINAL LAP!', '#00C8FF');
          }
          if (racer.isPlayer && cpRes.raceFinished) {
            this.finishRaceNow();
          }
        }

        // Update engine audio from player racer on final substep
        if (racer.isPlayer && stepIdx === subSteps - 1) {
          const carTop = getVehicleById(racer.vehicleId).stats.topSpeed;
          const speedRatio = Math.min(1.3, Math.abs(racer.speed) / carTop);
          const gearFloat = speedRatio * 5.8;
          const rpmRatio = Math.max(0.15, Math.min(1, gearFloat - Math.floor(gearFloat) + 0.22));
          this.audio.updateEngine(speedRatio, rpmRatio, physEvents.driftIntensity, physEvents.nitroActive);
        }
      }

      // Car-to-car collisions
      const carImpacts = resolveCarCollisions(this.racers);
      for (const imp of carImpacts) {
        this.spawnBurst(imp.x, 0.8, imp.z, 8, 0xffd166, 12);
        if (imp.aId === 'player_local' || imp.bId === 'player_local') {
          this.cameraTrauma = Math.min(1, this.cameraTrauma + imp.pairImpact * 0.55);
          this.audio.playImpact(imp.pairImpact > 0.55);
        }
      }

      // Update Pickups, Projectiles, Mines, Shock Domes, Barge Waves, Particles
      this.updatePickups(simDt);
      this.updateCombatEntities(simDt);
      this.updateParticles(stepBaseDt);
    }

    // Sort standings
    sortRaceStandings(this.racers);

    // Sync 3D vehicle meshes
    this.syncVehicleRigs(frameDt);

    // Update chase camera & follow cross-angled directional light (zero forward road glare)
    if (player) {
      this.updateRaceCamera(player, control.rearView, frameDt);
      this.keyLight.position.set(player.x + 88, 56, player.z - 52);
      this.keyLight.target.position.set(player.x, player.y, player.z);
    }

    // Throttled HUD update (~12 Hz, always emits immediately on low-FPS frames)
    this.hudEmitAccum += frameDt;
    if (this.hudEmitAccum >= 0.08) {
      this.hudEmitAccum = 0;
      this.emitHudSnapshot();
    }

    // Multiplayer outbound state sync (20 Hz)
    if (this.raceConfig?.isMultiplayer && player && this.callbacks.onSendMultiplayerState) {
      this.netEmitAccum += frameDt;
      if (this.netEmitAccum >= 0.05) {
        this.netEmitAccum = 0;
        this.callbacks.onSendMultiplayerState({
          x: player.x,
          z: player.z,
          heading: player.heading,
          speed: player.speed,
          hp: player.hp,
          lap: player.lap,
          totalProgress: player.totalProgress,
          shieldTimer: player.shieldTimer,
          nitroTimer: player.nitroTimer,
          destroyed: player.destroyed,
        });
      }
    }
  }

  private executePowerUpEffect(owner: RacerState, type: PowerUpType, rearFired: boolean, fromNetwork: boolean): void {
    if (owner.isPlayer && !fromNetwork) {
      this.audio.playPowerUp(type);
      if (this.raceConfig?.isMultiplayer && this.callbacks.onSendMultiplayerCombat) {
        this.callbacks.onSendMultiplayerCombat({
          type,
          rearFired,
          x: owner.x,
          z: owner.z,
          heading: owner.heading,
        });
      }
    }

    const fwdX = Math.sin(owner.heading);
    const fwdZ = Math.cos(owner.heading);
    const dir = rearFired && POWERUP_DEFS[type].supportsRearFire ? -1 : 1;

    switch (type) {
      case 'NITRO': {
        if (rearFired) {
          // Authentic Blur Reverse Nitro = Instant Air-Brake!
          owner.vx *= 0.42;
          owner.vz *= 0.42;
          owner.speed *= 0.42;
          this.spawnBurst(owner.x + fwdX * 2.2, owner.y + 0.6, owner.z + fwdZ * 2.2, 16, 0x25f4a0, 12);
          if (owner.isPlayer) {
            this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.24);
            this.awardFans(owner, 75, 'AIR-BRAKE +75 FANS', '#25F4A0');
          }
        } else {
          const mult = getVehicleById(owner.vehicleId).stats.nitroEfficiency;
          owner.nitroTimer = Math.max(owner.nitroTimer, POWERUP_BALANCE.NITRO_DURATION * mult);
          if (owner.isPlayer) {
            this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
            this.awardFans(owner, 50, 'NITRO OVERDRIVE +50 FANS', '#25F4A0');
          }
        }
        break;
      }
      case 'SHIELD': {
        owner.shieldTimer = POWERUP_BALANCE.SHIELD_DURATION;
        if (owner.isPlayer) this.pushFeed('SHIELD DEFLECTOR ONLINE', '#00D8FF');
        break;
      }
      case 'REPAIR': {
        applyRepairPowerUp(owner);
        this.spawnBurst(owner.x, owner.y + 1.1, owner.z, 20, 0x22c55e, 10);
        if (owner.isPlayer) this.awardFans(owner, 50, 'FULL CHASSIS REPAIR', '#22C55E');
        break;
      }
      case 'SHUNT': {
        // Rear-fired SHUNT immediately intercepts incoming homing Shunts behind the player!
        if (dir < 0) {
          for (const proj of this.projectiles) {
            if (proj.targetId === owner.id && Math.hypot(proj.x - owner.x, proj.z - owner.z) < 42) {
              proj.life = 0;
              this.spawnBurst(proj.x, proj.y, proj.z, 22, 0xff2a55, 16);
              if (owner.isPlayer) {
                this.audio.playShieldBlock();
                this.awardFans(owner, 200, 'SHUNT INTERCEPTED! +200 FANS', '#FF2A55');
              }
              return;
            }
          }
        }
        // Acquire best opponent ahead (only when forward-fired)
        let targetId: string | null = null;
        if (dir > 0) {
          let bestDist = 175;
          for (const r of this.racers) {
            if (r.id === owner.id || r.destroyed || r.eliminated) continue;
            const d = forwardTrackDistance(this.currentTrack, owner.trackT, r.trackT);
            if (d > 4 && d < bestDist) {
              bestDist = d;
              targetId = r.id;
            }
          }
        }
        const id = `proj_${this.entityCounter++}`;
        const p: ProjectileState = {
          id,
          type: 'SHUNT',
          ownerId: owner.id,
          targetId,
          x: owner.x + fwdX * dir * 3.4,
          y: owner.y + 0.9,
          z: owner.z + fwdZ * dir * 3.4,
          vx: fwdX * dir * POWERUP_BALANCE.SHUNT_SPEED,
          vz: fwdZ * dir * POWERUP_BALANCE.SHUNT_SPEED,
          speed: POWERUP_BALANCE.SHUNT_SPEED,
          damage: POWERUP_BALANCE.SHUNT_DAMAGE,
          life: POWERUP_BALANCE.SHUNT_LIFETIME,
          maxLife: POWERUP_BALANCE.SHUNT_LIFETIME,
          rearFired: dir < 0,
        };
        this.projectiles.push(p);
        const mesh = new THREE.Mesh(this.shuntGeo, this.shuntMat);
        mesh.position.set(p.x, p.y, p.z);
        this.combatGroup.add(mesh);
        this.projectileMeshes.set(id, mesh);
        break;
      }
      case 'BOLT': {
        // Authentic Blur counter-play: rear-fired Bolt shoots down an incoming chasing Shunt!
        if (dir < 0) {
          for (const proj of this.projectiles) {
            if (proj.targetId === owner.id && Math.hypot(proj.x - owner.x, proj.z - owner.z) < 38) {
              proj.life = 0;
              this.spawnBurst(proj.x, proj.y, proj.z, 20, 0xff8a00, 15);
              if (owner.isPlayer) {
                this.audio.playShieldBlock();
                this.awardFans(owner, 200, 'BOLT INTERCEPTED SHUNT! +200 FANS', '#FF8A00');
              }
              return;
            }
          }
        }
        const id = `proj_${this.entityCounter++}`;
        const p: ProjectileState = {
          id,
          type: 'BOLT',
          ownerId: owner.id,
          targetId: null,
          x: owner.x + fwdX * dir * 3.4,
          y: owner.y + 0.85,
          z: owner.z + fwdZ * dir * 3.4,
          vx: fwdX * dir * POWERUP_BALANCE.BOLT_SPEED,
          vz: fwdZ * dir * POWERUP_BALANCE.BOLT_SPEED,
          speed: POWERUP_BALANCE.BOLT_SPEED,
          damage: POWERUP_BALANCE.BOLT_DAMAGE,
          life: POWERUP_BALANCE.BOLT_LIFETIME,
          maxLife: POWERUP_BALANCE.BOLT_LIFETIME,
          rearFired: dir < 0,
        };
        this.projectiles.push(p);
        const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
        mesh.position.set(p.x, p.y, p.z);
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.z = -owner.heading;
        this.combatGroup.add(mesh);
        this.projectileMeshes.set(id, mesh);
        break;
      }
      case 'BARGE': {
        const id = `barge_${this.entityCounter++}`;
        const wave: BargeWaveState = {
          id,
          ownerId: owner.id,
          x: owner.x,
          y: owner.y + 0.4,
          z: owner.z,
          radius: 1.2,
          maxRadius: POWERUP_BALANCE.BARGE_RADIUS,
          life: 0.42,
          maxLife: 0.42,
        };
        this.bargeWaves.push(wave);
        const bMat = new THREE.MeshBasicMaterial({
          color: 0xa855f7,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(this.bargeGeo, bMat);
        mesh.position.set(wave.x, wave.y, wave.z);
        this.combatGroup.add(mesh);
        this.bargeMeshes.set(id, mesh);

        // Apply radial knockback + damage to nearby opponents & intercept projectiles
        for (const other of this.racers) {
          if (other.id === owner.id || other.destroyed || other.eliminated) continue;
          const dx = other.x - owner.x;
          const dz = other.z - owner.z;
          const dist = Math.hypot(dx, dz);
          if (dist < POWERUP_BALANCE.BARGE_RADIUS && dist > 0.01) {
            const falloff = 1 - dist / POWERUP_BALANCE.BARGE_RADIUS;
            const kb = POWERUP_BALANCE.BARGE_IMPULSE * (0.45 + falloff * 0.75);
            const res = applyCombatDamage(
              other,
              POWERUP_BALANCE.BARGE_DAMAGE * (0.55 + falloff * 0.45),
              owner,
              (dx / dist) * kb,
              (dz / dist) * kb,
              0.2,
            );
            this.onCombatHit(owner, other, 'BARGE', res.blockedByShield, res.destroyedNow);
          }
        }
        // Intercept nearby enemy projectiles
        for (const proj of this.projectiles) {
          if (proj.ownerId !== owner.id && Math.hypot(proj.x - owner.x, proj.z - owner.z) < POWERUP_BALANCE.BARGE_RADIUS) {
            proj.life = 0;
            this.spawnBurst(proj.x, proj.y, proj.z, 10, 0xa855f7, 10);
          }
        }
        break;
      }
      case 'MINE': {
        // Dropping a Mine behind you immediately intercepts an incoming chasing Shunt (classic Blur counter!)
        if (!rearFired) {
          for (const proj of this.projectiles) {
            if (proj.targetId === owner.id && Math.hypot(proj.x - owner.x, proj.z - owner.z) < 28) {
              proj.life = 0;
              this.spawnBurst(proj.x, proj.y, proj.z, 24, 0xfacc15, 16);
              if (owner.isPlayer) {
                this.audio.playShieldBlock();
                this.awardFans(owner, 200, 'MINE BLOCKED SHUNT! +200 FANS', '#FACC15');
              }
              return;
            }
          }
        }
        const dropDir = rearFired ? 1 : -1; // Default drops behind; forward/rear-toggle lobs 11m ahead!
        const dropDist = rearFired ? 11.5 : 4.2;
        const id = `mine_${this.entityCounter++}`;
        const m: MineState = {
          id,
          ownerId: owner.id,
          x: owner.x + fwdX * dropDir * dropDist,
          y: owner.y + 0.65,
          z: owner.z + fwdZ * dropDir * dropDist,
          armTimer: POWERUP_BALANCE.MINE_ARM_DELAY,
          life: POWERUP_BALANCE.MINE_LIFETIME,
          radius: POWERUP_BALANCE.MINE_TRIGGER_RADIUS,
          damage: POWERUP_BALANCE.MINE_DAMAGE,
        };
        this.mines.push(m);
        const mesh = new THREE.Mesh(this.mineGeo, this.mineMat);
        mesh.position.set(m.x, m.y, m.z);
        this.combatGroup.add(mesh);
        this.mineMeshes.set(id, mesh);
        break;
      }
      case 'SHOCK': {
        // Spawn 3 electric hazard domes + glowing vertical lightning cores ahead of current race leader
        const sorted = sortRaceStandings(this.racers);
        const leader = sorted.find((r) => !r.eliminated && !r.finished) ?? owner;
        const lanes = [-5.8, 0, 5.8];
        for (let k = 0; k < POWERUP_BALANCE.SHOCK_COUNT; k++) {
          const tAhead = normalizeT(leader.trackT + (48 + k * 28) / this.currentTrack.totalLength);
          const s = sampleTrackAt(this.currentTrack, tAhead);
          const lane = lanes[k % lanes.length];
          const id = `shock_${this.entityCounter++}`;
          const sz: ShockZoneState = {
            id,
            ownerId: owner.id,
            x: s.x + s.rx * lane,
            y: s.y,
            z: s.z + s.rz * lane,
            trackT: tAhead,
            life: POWERUP_BALANCE.SHOCK_DURATION,
            radius: POWERUP_BALANCE.SHOCK_RADIUS,
            damage: POWERUP_BALANCE.SHOCK_DAMAGE,
            hitRacerIds: [],
          };
          this.shockZones.push(sz);

          const g = new THREE.Group();
          g.position.set(sz.x, sz.y + 0.05, sz.z);
          const domeMat = new THREE.MeshBasicMaterial({
            color: 0x3b82f6,
            wireframe: true,
            transparent: true,
            opacity: 0.9,
          });
          const dome = new THREE.Mesh(this.shockDomeGeo, domeMat);
          dome.scale.set(sz.radius, sz.radius * 0.85, sz.radius);
          const pillarGeo = new THREE.CylinderGeometry(0.32, 0.55, 8.5, 8);
          const pillarMat = new THREE.MeshBasicMaterial({
            color: 0x93c5fd,
            transparent: true,
            opacity: 0.72,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const pillar = new THREE.Mesh(pillarGeo, pillarMat);
          pillar.position.y = 4.25;
          g.add(dome, pillar);
          this.combatGroup.add(g);
          this.shockMeshes.set(id, g);
        }
        if (owner.isPlayer) this.awardFans(owner, 60, 'SHOCK DOMES DEPLOYED!', '#3B82F6');
        break;
      }
    }
  }

  private awardFans(racer: RacerState, amount: number, label: string, color: string): void {
    racer.raceFans = (racer.raceFans ?? 0) + amount;
    if (racer.isPlayer) {
      this.pushFeed(label, color);
    }
  }

  private onCombatHit(
    attacker: RacerState | undefined,
    target: RacerState,
    weapon: PowerUpType,
    blocked: boolean,
    destroyed: boolean,
  ): void {
    if (blocked) {
      this.spawnBurst(target.x, target.y + 1.0, target.z, 16, 0x00d8ff, 14);
      if (target.isPlayer) {
        this.audio.playShieldBlock();
        this.awardFans(target, 200, `SHIELD DEFLECTED ${weapon} +200 FANS`, '#00D8FF');
      } else if (attacker?.isPlayer) {
        this.audio.playShieldBlock();
        this.pushFeed(`${target.name} BLOCKED ${weapon}`, '#00D8FF');
      }
      return;
    }

    this.spawnBurst(target.x, target.y + 1.0, target.z, destroyed ? 36 : 18, POWERUP_DEFS[weapon].hexColor, destroyed ? 20 : 14);

    if (target.isPlayer || attacker?.isPlayer) {
      this.audio.playImpact(true);
      if (destroyed) {
        this.hitstopTimer = 0.065;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.9);
        if (attacker?.isPlayer) {
          this.awardFans(attacker, 300, `WRECKED ${target.name}! +300 FANS`, '#FF2A55');
        } else {
          this.pushFeed(`WRECKED BY ${attacker?.name ?? 'HAZARD'}!`, '#FF2A55');
        }
      } else {
        this.hitstopTimer = 0.035;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.5);
        if (attacker?.isPlayer) {
          this.awardFans(attacker, 150, `${weapon} HIT ${target.name} +150 FANS`, POWERUP_DEFS[weapon].color);
        } else {
          this.pushFeed(`HIT BY ${attacker?.name ?? 'HAZARD'} (${weapon})`, POWERUP_DEFS[weapon].color);
        }
      }
    }
  }

  private animatePickups(dt: number): void {
    if (!this.trackScene) return;
    for (const node of this.pickups) {
      const mesh = this.trackScene.pickupMeshes.get(node.id);
      if (!mesh) continue;
      mesh.visible = node.active;
      if (node.active) {
        mesh.rotation.y += dt * 1.9;
        mesh.position.y = node.y + Math.sin(this.elapsedClock * 3.2 + node.trackT * 20) * 0.22;
      }
    }
  }

  private updatePickups(dt: number): void {
    this.animatePickups(dt);
    for (const node of this.pickups) {
      if (!node.active) {
        node.respawnTimer -= dt;
        if (node.respawnTimer <= 0) node.active = true;
        continue;
      }
      for (const racer of this.racers) {
        if (racer.destroyed || racer.eliminated) continue;
        const dx = racer.x - node.x;
        const dz = racer.z - node.z;
        if (dx * dx + dz * dz < 6.5) {
          const res = collectPowerUp(racer.inventory, racer.activeSlot, node.type);
          if (res.collected) {
            racer.activeSlot = res.newActiveSlot;
            node.active = false;
            node.respawnTimer = 6.5;
            this.spawnBurst(node.x, node.y, node.z, 10, POWERUP_DEFS[node.type].hexColor, 8);
            if (racer.isPlayer) {
              this.audio.playPickup();
              this.pushFeed(`ACQUIRED ${node.type}`, POWERUP_DEFS[node.type].color);
            }
            break;
          }
        }
      }
    }
  }

  private updateCombatEntities(dt: number): void {
    // 1. Projectiles (SHUNT & BOLT)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;

      // SHUNT homing steering
      if (p.type === 'SHUNT' && p.targetId) {
        const target = this.racers.find((r) => r.id === p.targetId && !r.destroyed);
        if (target) {
          const dx = target.x - p.x;
          const dz = target.z - p.z;
          const len = Math.hypot(dx, dz) || 1;
          const desiredVx = (dx / len) * p.speed;
          const desiredVz = (dz / len) * p.speed;
          p.vx += (desiredVx - p.vx) * Math.min(1, 5.5 * dt);
          p.vz += (desiredVz - p.vz) * Math.min(1, 5.5 * dt);
        }
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // Energy trail particle
      if (Math.random() < 0.7) {
        this.spawnParticle(
          p.x,
          p.y,
          p.z,
          0,
          0.4,
          0,
          0.22,
          p.type === 'SHUNT' ? 0.36 : 0.24,
          p.type === 'SHUNT' ? 0xff365e : 0xff8a00,
        );
      }

      // Check hit against racers
      let hit = false;
      for (const r of this.racers) {
        if (r.id === p.ownerId || r.destroyed || r.eliminated) continue;
        const dx = r.x - p.x;
        const dz = r.z - p.z;
        if (dx * dx + dz * dz < 6.8) {
          const attacker = this.racers.find((a) => a.id === p.ownerId);
          const norm = Math.hypot(p.vx, p.vz) || 1;
          const kb = p.type === 'SHUNT' ? 16 : 6;
          const res = applyCombatDamage(
            r,
            p.damage,
            attacker,
            (p.vx / norm) * kb,
            (p.vz / norm) * kb,
            p.type === 'SHUNT' ? 0.32 : 0.12,
          );
          this.onCombatHit(attacker, r, p.type, res.blockedByShield, res.destroyedNow);
          hit = true;
          break;
        }
      }

      const mesh = this.projectileMeshes.get(p.id);
      if (hit || p.life <= 0) {
        if (mesh) {
          this.combatGroup.remove(mesh);
          this.projectileMeshes.delete(p.id);
        }
        this.projectiles.splice(i, 1);
      } else if (mesh) {
        mesh.position.set(p.x, p.y, p.z);
      }
    }

    // 2. Mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      if (m.armTimer > 0) m.armTimer = Math.max(0, m.armTimer - dt);

      let exploded = false;
      if (m.armTimer <= 0) {
        // Armed mines also intercept enemy SHUNT projectiles flying over them
        for (const proj of this.projectiles) {
          if (proj.type === 'SHUNT' && proj.life > 0) {
            const pdx = proj.x - m.x;
            const pdz = proj.z - m.z;
            if (pdx * pdx + pdz * pdz < 17.64) {
              proj.life = 0;
              exploded = true;
              this.spawnBurst(m.x, m.y + 0.4, m.z, 22, 0xfacc15, 16);
              const mineOwner = this.racers.find((a) => a.id === m.ownerId);
              if (mineOwner?.isPlayer) {
                this.audio.playShieldBlock();
                this.awardFans(mineOwner, 150, 'MINE INTERCEPTED SHUNT! +150 FANS', '#FACC15');
              }
              break;
            }
          }
        }
        if (!exploded) {
          for (const r of this.racers) {
            if (r.destroyed || r.eliminated) continue;
            const dx = r.x - m.x;
            const dz = r.z - m.z;
            if (dx * dx + dz * dz < m.radius * m.radius) {
              const attacker = this.racers.find((a) => a.id === m.ownerId);
              const res = applyCombatDamage(r, m.damage, attacker, 0, 0, 0.35);
              this.onCombatHit(attacker, r, 'MINE', res.blockedByShield, res.destroyedNow);
              exploded = true;
              break;
            }
          }
        }
      }

      const mesh = this.mineMeshes.get(m.id);
      if (exploded || m.life <= 0) {
        if (mesh) {
          this.combatGroup.remove(mesh);
          this.mineMeshes.delete(m.id);
        }
        this.mines.splice(i, 1);
      } else if (mesh) {
        mesh.rotation.y += dt * 3;
        const pulse = 1 + Math.sin(this.elapsedClock * 8) * 0.14;
        mesh.scale.setScalar(pulse);
      }
    }

    // 3. Shock Electric Domes
    for (let i = this.shockZones.length - 1; i >= 0; i--) {
      const sz = this.shockZones[i];
      sz.life -= dt;

      for (const r of this.racers) {
        if (r.destroyed || r.eliminated || sz.hitRacerIds.includes(r.id)) continue;
        const dx = r.x - sz.x;
        const dz = r.z - sz.z;
        if (dx * dx + dz * dz < sz.radius * sz.radius) {
          sz.hitRacerIds.push(r.id);
          const attacker = this.racers.find((a) => a.id === sz.ownerId);
          const res = applyCombatDamage(r, sz.damage, attacker, 0, 0, 0.35);
          if (!res.blockedByShield) {
            r.shockSlowTimer = POWERUP_BALANCE.SHOCK_SLOW_DURATION;
          }
          this.onCombatHit(attacker, r, 'SHOCK', res.blockedByShield, res.destroyedNow);
        }
      }

      const g = this.shockMeshes.get(sz.id);
      if (sz.life <= 0) {
        if (g) {
          this.combatGroup.remove(g);
          this.shockMeshes.delete(sz.id);
        }
        this.shockZones.splice(i, 1);
      } else if (g) {
        g.rotation.y += dt * 2.4;
      }
    }

    // 4. Barge Shockwave Rings
    for (let i = this.bargeWaves.length - 1; i >= 0; i--) {
      const bw = this.bargeWaves[i];
      bw.life -= dt;
      const t = 1 - Math.max(0, bw.life / bw.maxLife);
      bw.radius = 1 + t * (bw.maxRadius - 1);
      const mesh = this.bargeMeshes.get(bw.id);
      if (bw.life <= 0) {
        if (mesh) {
          (mesh.material as THREE.Material).dispose();
          this.combatGroup.remove(mesh);
          this.bargeMeshes.delete(bw.id);
        }
        this.bargeWaves.splice(i, 1);
      } else if (mesh) {
        mesh.scale.setScalar(bw.radius);
        (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      }
    }
  }

  private syncVehicleRigs(dt: number): void {
    for (const r of this.racers) {
      const rig = this.racerRigs.get(r.id);
      if (!rig) continue;

      rig.root.position.set(r.x, r.y, r.z);
      rig.root.rotation.y = r.heading;
      rig.bodyGroup.rotation.x = r.bodyPitch;
      rig.bodyGroup.rotation.z = r.bodyRoll;

      // Wheel spin & front wheel steering
      rig.wheelPivots[0].rotation.y = r.steerAngle;
      rig.wheelPivots[1].rotation.y = r.steerAngle;
      for (const wm of rig.wheelMeshes) {
        wm.rotation.x = r.wheelSpin;
      }

      // Nitro exhaust flames
      const nitroOn = r.nitroTimer > 0 && !r.destroyed;
      for (const f of rig.nitroFlames) {
        f.visible = nitroOn;
        if (nitroOn) {
          f.scale.set(1, 0.85 + Math.random() * 0.45, 1);
        }
      }

      // Iconic Blur dynamic taillight neon light-trails stretching smoothly with speed
      const speedAbs = Math.abs(r.speed);
      const showTrails = !r.destroyed && speedAbs > 18;
      const trailLen = Math.min(4.6, Math.max(0.7, (speedAbs - 16) * 0.068 + (nitroOn ? 2.2 : 0)));
      rig.tailTrailMaterial.color.setHex(nitroOn ? 0x25f4a0 : 0xff2248);
      rig.tailTrailMaterial.opacity = showTrails ? Math.min(0.82, (speedAbs - 16) / 62 + (nitroOn ? 0.3 : 0)) : 0;
      for (const tMesh of rig.tailTrails) {
        tMesh.visible = showTrails;
        if (showTrails) {
          tMesh.scale.set(nitroOn ? 1.35 : 1, 1, trailLen);
        }
      }

      // Shield dome
      rig.shieldDome.visible = r.shieldTimer > 0 && !r.destroyed;
      if (rig.shieldDome.visible) {
        rig.shieldDome.rotation.y += dt * 1.8;
      }

      // Hit flash emissive pulse
      const flash = r.hitFlashTimer > 0;
      for (const mat of rig.hitFlashMaterials) {
        mat.emissive.setHex(flash ? 0xffffff : 0x000000);
        mat.emissiveIntensity = flash ? 0.65 : 0;
      }

      // Spawn-protection blink or destroyed tilt
      if (r.destroyed) {
        rig.bodyGroup.position.y = 0.25;
        rig.bodyGroup.rotation.z = 0.25;
      } else {
        rig.bodyGroup.position.y = 0;
      }
      rig.root.visible = !r.eliminated && (r.spawnProtectTimer <= 0 || Math.floor(this.elapsedClock * 14) % 2 === 0);
    }
  }

  private updateRaceCamera(player: RacerState, rearView: boolean, dt: number): void {
    const fwdX = Math.sin(player.heading);
    const fwdZ = Math.cos(player.heading);
    const dir = rearView ? -1 : 1;

    let backDist = this.cameraMode === 'far' ? 11.2 : this.cameraMode === 'hood' ? -0.35 : 8.4;
    let camHeight = this.cameraMode === 'far' ? 4.6 : this.cameraMode === 'hood' ? 1.48 : 3.55;

    if (rearView) {
      backDist = -8.4;
      camHeight = 3.3;
    }

    // Velocity & drift look-ahead
    const desiredX = player.x - fwdX * backDist * dir + (rearView ? 0 : -player.lateralSpeed * 0.08);
    const desiredY = player.y + camHeight;
    const desiredZ = player.z - fwdZ * backDist * dir;

    const lookDist = this.cameraMode === 'hood' ? 28 : 18;
    const lookX = player.x + fwdX * lookDist * dir;
    const lookY = player.y + (this.cameraMode === 'hood' ? 1.15 : 0.85);
    const lookZ = player.z + fwdZ * lookDist * dir;

    if (this.cameraMode === 'hood' || rearView) {
      this.currentCamPos.set(desiredX, desiredY, desiredZ);
      this.currentCamLook.set(lookX, lookY, lookZ);
    } else {
      const posDamp = 1 - Math.exp(-9.5 * dt);
      const lookDamp = 1 - Math.exp(-12.5 * dt);
      _vecA.set(desiredX, desiredY, desiredZ);
      _vecB.set(lookX, lookY, lookZ);
      this.currentCamPos.lerp(_vecA, posDamp);
      this.currentCamLook.lerp(_vecB, lookDamp);
    }

    // Decaying trauma^2 impact & nitro shake
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.9);
    const shakeAmp = this.cameraTrauma * this.cameraTrauma * 0.6 + (player.nitroTimer > 0 ? 0.045 : 0);
    const shakeX = (Math.random() - 0.5) * shakeAmp;
    const shakeY = (Math.random() - 0.5) * shakeAmp;

    this.camera.position.set(this.currentCamPos.x + shakeX, this.currentCamPos.y + shakeY, this.currentCamPos.z);
    this.camera.lookAt(this.currentCamLook);

    // Speed-based + Nitro FOV expansion
    const speedRatio = Math.min(1.2, Math.abs(player.speed) / 78);
    const targetFov = 60 + speedRatio * 15 + (player.nitroTimer > 0 ? 10 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-6 * dt));
    this.camera.updateProjectionMatrix();
  }

  private spawnParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxLife: number,
    scale: number,
    hexColor: number,
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.particles.length;
    p.active = true;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.scale = scale;
    p.color.setHex(hexColor);
  }

  private spawnBurst(x: number, y: number, z: number, count: number, hexColor: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = speed * (0.35 + Math.random() * 0.65);
      this.spawnParticle(
        x,
        y,
        z,
        Math.cos(ang) * spd,
        2 + Math.random() * 6,
        Math.sin(ang) * spd,
        0.35 + Math.random() * 0.3,
        0.3 + Math.random() * 0.35,
        hexColor,
      );
    }
  }

  private updateParticles(dt: number): void {
    let anyDirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyDirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }
      p.vy -= 9.8 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.08, p.y + p.vy * dt);
      p.z += p.vz * dt;
      const s = p.scale * (p.life / p.maxLife);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.scale.set(s, s, s);
      _dummy.rotation.set(p.life * 4, p.life * 3, 0);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      _tmpColor.copy(p.color);
      this.particleMesh.setColorAt(i, _tmpColor);
    }
    if (anyDirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
    }
  }

  private pushFeed(text: string, color: string): void {
    this.combatFeed.unshift({
      id: `cf_${this.entityCounter++}`,
      text,
      color,
      timestamp: performance.now(),
    });
    if (this.combatFeed.length > 4) this.combatFeed.pop();
  }

  private finishRaceNow(): void {
    if (this.racePhase === 'finished') return;
    this.racePhase = 'finished';
    this.audio.playFinish();
    this.audio.setEngineActive(false);
    this.input.setGameplayActive(false);
    const snap = this.buildHudSnapshot();
    this.callbacks.onHudUpdate(snap);
    this.callbacks.onRaceFinished(snap);
  }

  private buildHudSnapshot(): RaceHudSnapshot {
    const player = this.getPlayerRacer() ?? this.racers[0];
    const now = performance.now();
    this.combatFeed = this.combatFeed.filter((item) => now - item.timestamp < 3600);

    let incomingDist = Infinity;
    if (player) {
      for (const proj of this.projectiles) {
        if (proj.targetId === player.id) {
          const d = Math.hypot(proj.x - player.x, proj.z - player.z);
          if (d < incomingDist) incomingDist = d;
        }
      }
    }

    const speedKmh = player ? Math.round(Math.abs(player.speed) * 3.6) : 0;
    const gear = Math.max(1, Math.min(6, Math.floor(speedKmh / 48) + 1));
    const rpmRatio = Math.min(1, Math.max(0.12, (speedKmh % 48) / 48 + 0.2));

    // Compute 3D screen-space Target Lock-On Reticle when holding SHUNT or BOLT
    let lockTargetScreen: { x: number; y: number; name: string; dist: number; color: string } | null = null;
    const activeSlotObj = player ? player.inventory[player.activeSlot] : null;
    if (
      player &&
      activeSlotObj &&
      (activeSlotObj.type === 'SHUNT' || activeSlotObj.type === 'BOLT') &&
      !player.rearFireMode
    ) {
      let bestTarget: RacerState | null = null;
      let bestDist = 165;
      for (const r of this.racers) {
        if (r.id === player.id || r.destroyed || r.eliminated) continue;
        const d = forwardTrackDistance(this.currentTrack, player.trackT, r.trackT);
        if (d > 5 && d < bestDist) {
          bestDist = d;
          bestTarget = r;
        }
      }
      if (bestTarget) {
        _vecA.set(bestTarget.x, bestTarget.y + 1.1, bestTarget.z);
        _vecA.project(this.camera);
        if (_vecA.z > -1 && _vecA.z < 1 && Math.abs(_vecA.x) <= 0.92 && Math.abs(_vecA.y) <= 0.88) {
          lockTargetScreen = {
            x: (_vecA.x * 0.5 + 0.5) * 100,
            y: (-_vecA.y * 0.5 + 0.5) * 100,
            name: bestTarget.name,
            dist: Math.round(bestDist),
            color: POWERUP_DEFS[activeSlotObj.type].color,
          };
        }
      }
    }

    const sorted = sortRaceStandings(this.racers);

    return {
      phase: this.racePhase,
      countdownValue: Math.max(0, Math.ceil(this.countdownTimer)),
      position: player?.position ?? 1,
      totalRacers: this.racers.length || 1,
      lap: Math.min(this.raceConfig?.laps ?? 3, player?.lap ?? 1),
      totalLaps: this.raceConfig?.laps ?? 3,
      raceTime: this.raceTime,
      bestLapTime: player?.bestLapTime ?? 0,
      speedKmh,
      gear,
      rpmRatio,
      hp: Math.round(player?.hp ?? 100),
      maxHp: Math.round(player?.maxHp ?? 100),
      shieldActive: (player?.shieldTimer ?? 0) > 0,
      shieldRemaining: player?.shieldTimer ?? 0,
      nitroActive: (player?.nitroTimer ?? 0) > 0,
      nitroRemaining: player?.nitroTimer ?? 0,
      nitroEnergy: Math.round(player?.nitroEnergy ?? 0),
      isDrifting: player?.isDrifting ?? false,
      isDrafting: player?.isDrafting ?? false,
      wrongWay: player?.wrongWay ?? false,
      incomingWarning: incomingDist < 95,
      incomingDistance: Number.isFinite(incomingDist) ? Math.round(incomingDist) : 0,
      rearFireMode: player?.rearFireMode ?? false,
      cameraMode: this.cameraMode,
      raceFans: player?.raceFans ?? 0,
      lockTargetScreen,
      inventory: player ? player.inventory.map((s) => (s ? { ...s } : null)) : [null, null, null],
      activeSlot: player?.activeSlot ?? 0,
      fps: this.measuredFps,
      pingMs: this.pingMs,
      finalLapBanner: this.finalLapShown && this.raceTime > 5,
      eliminationTimer: Math.ceil(this.eliminationTimer),
      combatFeed: [...this.combatFeed],
      minimapDots: this.racers
        .filter((r) => !r.eliminated)
        .map((r) => ({
          id: r.id,
          x: r.x,
          z: r.z,
          isPlayer: r.isPlayer,
          color: r.isPlayer ? '#00C8FF' : r.isRemote ? '#25F4A0' : '#FF365E',
        })),
      minimapPath: this.currentTrack.minimapPath,
      standings: sorted.map((r) => ({
        id: r.id,
        name: r.name,
        vehicleId: r.vehicleId,
        position: r.position,
        lap: r.lap,
        finished: r.finished,
        finishTime: r.finishTime,
        hitsLanded: r.hitsLanded,
        takedowns: r.takedowns,
        isPlayer: r.isPlayer,
        eliminated: r.eliminated,
      })),
    };
  }

  private emitHudSnapshot(): void {
    this.callbacks.onHudUpdate(this.buildHudSnapshot());
  }

  private handleResize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(w, h);
    }
    this.renderCurrentFrame();
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDownBound);
    window.removeEventListener('pointermove', this.onPointerMoveBound);
    window.removeEventListener('pointerup', this.onPointerUpBound);
    this.clearRaceEntities();
    this.garageHeroRig?.dispose();
    this.trackScene?.dispose();
    this.textures.dispose();
    this.envRT?.dispose();
    this.composer?.dispose();
    this.shuntGeo.dispose();
    this.shuntMat.dispose();
    this.boltGeo.dispose();
    this.boltMat.dispose();
    this.mineGeo.dispose();
    this.mineMat.dispose();
    this.bargeGeo.dispose();
    this.shockDomeGeo.dispose();
    this.particleMesh.geometry.dispose();
    (this.particleMesh.material as THREE.Material).dispose();
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
