import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
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
  projectPointToTrack,
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
import {
  applyComboFans,
  COMBAT_RULES,
  resolveBargeInterceptions,
  resolveBoltVsShunt,
  resolveNitroAirBrake,
  resolveShockVsShield,
} from '../game/combatResolver';
import { computeTransmissionTelemetry, resolveCarCollisions, stepVehiclePhysics } from '../game/physics';
import { AI_DRIVER_NAMES, computeAiInput } from '../game/ai';
import {
  getCareerEventById,
  MULTIPLAYER_MOD_MAP,
  type FanDemandRuntime,
  type FanRunRuntime,
} from '../game/career';
import { createProceduralTexturePack, type ProceduralTexturePack } from './proceduralTextures';
import {
  applyVehicleCustomization,
  applyVehicleDamageVisuals,
  computeVehicleDamageStage,
  type VehicleRig,
} from './vehicleMesh';
import { VehicleAssetLoader } from './assets/VehicleAssetLoader';
import { createEnvironmentSceneForProfile, getLightingForTrack, type LightingProfile } from './lighting';
import { buildTrackScene, type BuiltTrackScene } from './trackMesh';
import { RacingAudioEngine, resolveEngineProfile } from './audio';
import { RacingInputHub } from './input';
import {
  CameraMotionBlurShader,
  computeCameraMotionBlurParams,
  createCameraSpeedStreakRig,
  type CameraSpeedStreakRig,
} from './motionBlur';
import { ChaseCameraController } from './camera/ChaseCamera';
import type {
  AuthoritativeMatchResult,
  AuthoritativeWorldSnapshot,
  PlayerInputPayload,
} from '../../shared/protocol/messages';

export type EngineMode = 'title' | 'garage' | 'playing' | 'paused' | 'results';

export interface EngineCallbacks {
  onHudUpdate: (snapshot: RaceHudSnapshot) => void;
  onPauseToggle: () => void;
  onRaceFinished: (snapshot: RaceHudSnapshot) => void;
  onSendPlayerInput?: (input: Omit<PlayerInputPayload, 'sequence'>) => number;
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

// Lighting environments are built via createEnvironmentSceneForProfile() in ./lighting.ts

export class RaceEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  public readonly audio: RacingAudioEngine;
  public readonly input: RacingInputHub;
  public readonly isSoftwareGl: boolean;

  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private motionBlurPass: ShaderPass | null = null;
  private speedStreakRig: CameraSpeedStreakRig;
  private motionBlurEnabled = true;
  private motionBlurSeeded = false;
  private currViewProjMatrix = new THREE.Matrix4();
  private prevViewProjMatrix = new THREE.Matrix4();
  private invViewProjMatrix = new THREE.Matrix4();
  private prevCameraYaw = 0;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private keyLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private activeLighting: LightingProfile = getLightingForTrack('neon_city');
  private textures: ProceduralTexturePack;
  private vehicleLoader = new VehicleAssetLoader();

  // Authoritative multiplayer prediction & remote interpolation buffers
  private localNetPlayerId: string | null = null;
  private pendingInputs: {
    seq: number;
    dt: number;
    throttle: number;
    brake: number;
    steer: number;
    drift: boolean;
    recover: boolean;
  }[] = [];
  private remoteBuffers = new Map<
    string,
    {
      prev: { x: number; y: number; z: number; heading: number; speed: number; t: number };
      curr: { x: number; y: number; z: number; heading: number; speed: number; t: number };
    }
  >();
  private lastAppliedEventSeq = 0;

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
  private chaseCamera = new ChaseCameraController();
  private reducedMotion =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  private cameraMode: CameraMode = 'near';
  private currentCamPos = new THREE.Vector3(0, 3.2, -7.2);
  private currentCamLook = new THREE.Vector3(0, 1, 12);
  private finalLapShown = false;
  private eliminationTimer = 25;
  private modeTimeRemaining = 0;
  private destructionScore = 0;
  private checkpointsCleared = 0;
  private nextTimedGateT = 0.14;
  private fanRun: FanRunRuntime | null = null;
  private fanDemand: FanDemandRuntime | null = null;
  private playerPrevPosition = 1;
  private playerDistanceMeters = 0;
  private lastHudGear = 1;
  private fanRunGateMesh: THREE.Group | null = null;
  private checkpointGateMesh: THREE.Group | null = null;
  private combatFeed: CombatFeedItem[] = [];
  private hudEmitAccum = 0;
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
    this.scene.add(this.camera);
    this.speedStreakRig = createCameraSpeedStreakRig();
    this.camera.add(this.speedStreakRig.lines);
    this.motionBlurEnabled = initialSettings.motionBlur !== false;
    this.renderer.setSize(w, h, false);

    // Distinct Day/Sunset/Night PBR lighting & matching PMREM environment map
    this.hemiLight = new THREE.HemisphereLight(0x5a7ec8, 0x1b2234, 0.72);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xd8e6ff, 1.2);
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

    // Authentic Blur neon bloom + camera-velocity motion blur post-processing on hardware GPUs (skipped on software WebGL)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.42, 0.72);
      this.composer.addPass(this.bloomPass);
      this.motionBlurPass = new ShaderPass(CameraMotionBlurShader);
      this.motionBlurPass.enabled = false;
      this.composer.addPass(this.motionBlurPass);
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
      color: 0x162033,
      roughness: 0.34,
      metalness: 0.52,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, -0.05, 0);
    base.receiveShadow = true;
    this.garageGroup.add(base);

    const haloGeo = new THREE.TorusGeometry(4.65, 0.05, 8, 48);
    haloGeo.rotateX(Math.PI / 2);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x00c8ff });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 0.08, 0);
    this.garageGroup.add(halo);

    // Subtle localized showcase key, front fill & cool rim lights inside garageGroup (active only in Title/Garage)
    const stageKey = new THREE.PointLight(0xdcebff, 34, 20, 1.5);
    stageKey.position.set(4.8, 4.0, 4.8);
    this.garageGroup.add(stageKey);

    const stageFill = new THREE.PointLight(0xfff1dc, 22, 16, 1.6);
    stageFill.position.set(-2.5, 2.4, 5.2);
    this.garageGroup.add(stageFill);

    const stageRim = new THREE.PointLight(0x38bdf8, 22, 18, 1.6);
    stageRim.position.set(-5.2, 2.8, -4.4);
    this.garageGroup.add(stageRim);

    // Position garage turntable slightly ahead of start gantry on the wet Neon City straight
    const s = sampleTrackAt(this.currentTrack, 0.985);
    this.garageGroup.position.set(s.x, s.y + 0.02, s.z);
    this.garageGroup.rotation.y = Math.atan2(s.tx, s.tz);
  }

  private applyLightingProfile(profile: LightingProfile): void {
    this.activeLighting = profile;
    this.scene.background = new THREE.Color(profile.skyColor);
    this.scene.fog = new THREE.FogExp2(profile.fogColor, profile.fogDensity);
    this.hemiLight.color.setHex(profile.hemiSkyColor);
    this.hemiLight.groundColor.setHex(profile.hemiGroundColor);
    this.hemiLight.intensity = profile.hemiIntensity;
    this.keyLight.color.setHex(profile.keyColor);
    this.keyLight.intensity = profile.keyIntensity;
    this.keyLight.position.set(profile.keyOffset[0], profile.keyOffset[1], profile.keyOffset[2]);
    this.renderer.toneMappingExposure = profile.exposure;
    this.scene.environmentIntensity = profile.envIntensity;

    if (this.bloomPass) {
      this.bloomPass.strength = profile.bloomStrength;
      this.bloomPass.threshold = profile.bloomThreshold;
    }

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = createEnvironmentSceneForProfile(profile);
    const nextEnv = pmrem.fromScene(envScene, 0.04);
    if (this.envRT) {
      this.envRT.dispose();
    }
    this.envRT = nextEnv;
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();
  }

  private rebuildTrackScene(): void {
    if (this.trackScene) {
      this.scene.remove(this.trackScene.group);
      this.trackScene.dispose();
      this.trackScene = null;
    }
    this.applyLightingProfile(getLightingForTrack(this.currentTrack.def.id));

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
    this.garageHeroRig = this.vehicleLoader.instantiateVehicleRig(
      cfg,
      customization,
      {
        contactShadow: this.textures.contactShadow,
        neonGlow: this.textures.neonGlow,
        headlightBeam: this.textures.headlightBeam,
        tailTrail: this.textures.tailTrail,
      },
      !this.isSoftwareGl,
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
    this.motionBlurEnabled = settings.motionBlur !== false;
    if (!this.motionBlurEnabled) {
      this.resetMotionBlurState();
    }
  }

  public setPing(ms: number): void {
    this.pingMs = ms;
  }

  private resetMotionBlurState(): void {
    this.motionBlurSeeded = false;
    if (this.motionBlurPass) {
      this.motionBlurPass.uniforms['uIntensity'].value = 0;
      this.motionBlurPass.uniforms['uRadialStrength'].value = 0;
      this.motionBlurPass.uniforms['uChromatic'].value = 0;
      this.motionBlurPass.enabled = false;
    }
    this.speedStreakRig.lines.visible = false;
  }

  public setMode(mode: EngineMode): void {
    this.mode = mode;
    const isPlaying = mode === 'playing';
    this.input.setGameplayActive(isPlaying);
    this.audio.setEngineActive(isPlaying);
    this.garageGroup.visible = mode === 'title' || mode === 'garage';
    this.resetMotionBlurState();
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
    this.resetMotionBlurState();
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

    // Place human player at front-middle row (slot 0 in Time Trial/Checkpoint, 1v1 in Rival Showdown, full grid otherwise)
    const aiTotal =
      config.mode === 'time_trial' || config.mode === 'checkpoint'
        ? 0
        : config.isRivalShowdown
          ? 1
          : config.isMultiplayer
            ? Math.max(0, 4 - remotePlayers.length)
            : config.aiCount;

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

    // Add AI rivals (or Career Boss Rival for 1v1 Rival Showdown)
    for (let i = 0; i < aiTotal; i++) {
      if (config.isRivalShowdown && i === 0 && config.rivalVehicleId) {
        const bossCfg = getVehicleById(config.rivalVehicleId);
        racerEntries.push({
          id: 'ai_rival_boss',
          name: config.rivalName || 'RIVAL BOSS',
          isPlayer: false,
          isRemote: false,
          vehicleId: bossCfg.id,
          customization: {
            ...bossCfg.defaultCustomization,
            ...(config.rivalCustomization ?? {}),
          },
        });
        continue;
      }
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
        maxHealthBlocks: carDef.stats.maxHealthBlocks,
        shieldHp: 0,
        airBrakeBoostTimer: 0,
        comboCount: 0,
        comboTimer: 0,
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
        vy: 0,
        grounded: true,
        airborneTime: 0,
        suspCompression: [0, 0, 0, 0],
        lastSafeTrackT: spawn.trackT,
      };

      const rig = this.vehicleLoader.instantiateVehicleRig(
        carDef,
        entry.customization,
        {
          contactShadow: this.textures.contactShadow,
          neonGlow: this.textures.neonGlow,
          headlightBeam: this.textures.headlightBeam,
          tailTrail: this.textures.tailTrail,
        },
        !this.isSoftwareGl && (entry.isPlayer || idx < 4),
      );
      rig.root.position.set(state.x, state.y, state.z);
      rig.root.rotation.y = state.heading;
      this.scene.add(rig.root);
      this.racerRigs.set(state.id, rig);
      return state;
    });

    // Position dedicated ChaseCamera smoothly behind the player immediately on race start
    const player = this.getPlayerRacer();
    if (player) {
      this.chaseCamera.reset(player);
      this.currentCamPos.copy(this.chaseCamera.currentPos);
      this.currentCamLook.copy(this.chaseCamera.currentLook);
      this.camera.position.copy(this.currentCamPos);
      this.camera.lookAt(this.currentCamLook);
    }

    // Configure archetype-specific procedural engine audio profile
    const playerCarDef = getVehicleById(config.vehicleId);
    this.audio.setEngineProfile(
      resolveEngineProfile(playerCarDef.archetype, playerCarDef.handlingArchetype),
    );

    this.pendingInputs = [];
    this.remoteBuffers.clear();
    this.lastAppliedEventSeq = 0;

    this.racePhase = 'countdown';
    this.countdownTimer = 2.1;
    this.lastCountdownInt = 4;
    this.raceTime = 0;
    this.hitstopTimer = 0;
    this.chaseCamera.trauma = 0;
    this.finalLapShown = false;
    this.eliminationTimer = 25;
    this.modeTimeRemaining =
      config.mode === 'destruction_arena'
        ? config.timeLimitSec ?? 90
        : config.mode === 'checkpoint'
          ? config.timeLimitSec ?? 28
          : 0;
    this.destructionScore = 0;
    this.checkpointsCleared = 0;
    this.nextTimedGateT = 0.14;
    this.playerPrevPosition = player?.position ?? 1;
    this.playerDistanceMeters = 0;
    this.lastHudGear = 1;

    // Initialize optional Fan Run (5 glowing sequential gates mid-Lap 1 on Combat/Career races)
    const enableFanRun = !config.isMultiplayer && config.mode === 'combat_race';
    this.fanRun = enableFanRun
      ? {
          active: false,
          triggered: false,
          completed: false,
          failed: false,
          gatesTotal: 5,
          gatesCleared: 0,
          remainingSec: 18,
          nextGateTrackT: 0.28,
          nextGateLateral: -2.4,
        }
      : null;

    // Initialize Career Event Fan Demand challenge if configured
    const careerEv = config.careerEventId ? getCareerEventById(config.careerEventId) : undefined;
    this.fanDemand =
      careerEv?.fanDemand && !config.isMultiplayer
        ? {
            id: careerEv.fanDemand.id,
            type: careerEv.fanDemand.type,
            label: careerEv.fanDemand.label,
            target: careerEv.fanDemand.target,
            progress: 0,
            remainingSec: careerEv.fanDemand.timeLimitSec,
            status: 'active',
            rewardFans: careerEv.fanDemand.rewardFans,
          }
        : null;

    this.setupDynamicModeGates();
    this.combatFeed = [];
    this.setMode('playing');
    this.emitHudSnapshot();
  }

  private setupDynamicModeGates(): void {
    if (this.fanRunGateMesh) {
      this.combatGroup.remove(this.fanRunGateMesh);
      this.fanRunGateMesh = null;
    }
    if (this.checkpointGateMesh) {
      this.combatGroup.remove(this.checkpointGateMesh);
      this.checkpointGateMesh = null;
    }

    if (this.fanRun) {
      const g = new THREE.Group();
      const ringGeo = new THREE.TorusGeometry(2.6, 0.14, 10, 28);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a85 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 2.4;
      g.add(ring);
      g.visible = false;
      this.combatGroup.add(g);
      this.fanRunGateMesh = g;
    }

    if (this.raceConfig?.mode === 'checkpoint') {
      const g = new THREE.Group();
      const postGeo = new THREE.BoxGeometry(0.45, 5.2, 0.45);
      const postMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4 });
      const left = new THREE.Mesh(postGeo, postMat);
      left.position.set(-5.8, 2.6, 0);
      const right = new THREE.Mesh(postGeo, postMat);
      right.position.set(5.8, 2.6, 0);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.45, 0.45), postMat);
      bar.position.set(0, 5.1, 0);
      g.add(left, right, bar);
      this.positionGateOnTrack(g, this.nextTimedGateT, 0);
      this.combatGroup.add(g);
      this.checkpointGateMesh = g;
    }
  }

  private positionGateOnTrack(gate: THREE.Group, trackT: number, lateral: number): void {
    const s = sampleTrackAt(this.currentTrack, normalizeT(trackT));
    gate.position.set(s.x + s.rx * lateral, s.y, s.z + s.rz * lateral);
    gate.rotation.y = Math.atan2(s.tx, s.tz);
  }

  public setLocalNetworkPlayerId(playerId: string | null): void {
    this.localNetPlayerId = playerId;
  }

  /**
   * V6.0 Sections 15 & 17: Applies an authoritative server world snapshot.
   * - Local player: resets to server state and replays unacknowledged pending inputs for smooth reconciliation.
   * - Remote players & AI: updates interpolation buffers for jitter-free rendering.
   * - Syncs authoritative pickups, projectiles, mines, shock zones, barge waves, and combat events.
   */
  public applyAuthoritativeSnapshot(snapshot: AuthoritativeWorldSnapshot): void {
    if (!this.raceConfig?.isMultiplayer || this.mode !== 'playing') return;

    this.racePhase = snapshot.phase;
    this.countdownTimer = snapshot.countdownTimer;
    this.raceTime = snapshot.raceTime;

    const nowMs = performance.now();
    const myId = this.localNetPlayerId;

    // Ensure every server racer has a local RacerState + 3D rig
    for (const sr of snapshot.racers) {
      const isLocal = Boolean(myId && sr.id === myId);
      let existingRacer = isLocal
        ? this.racers.find((r) => r.isPlayer)
        : this.racers.find((r) => r.id === sr.id);

      if (!existingRacer) {
        const carDef = getVehicleById(sr.vehicleId);
        const custom: VehicleCustomization = { ...carDef.defaultCustomization };
        const proj = projectPointToTrack(this.currentTrack, sr.x, sr.z);
        existingRacer = {
          id: sr.id,
          name: sr.name,
          isPlayer: isLocal,
          isRemote: !isLocal,
          vehicleId: sr.vehicleId,
          customization: custom,
          x: sr.x,
          y: sr.y,
          z: sr.z,
          vx: sr.vx,
          vz: sr.vz,
          heading: sr.heading,
          angularVel: 0,
          speed: sr.speed,
          lateralSpeed: sr.lateralSpeed,
          steerAngle: sr.steerAngle,
          wheelSpin: 0,
          bodyPitch: sr.bodyPitch,
          bodyRoll: sr.bodyRoll,
          isDrifting: sr.isDrifting,
          driftTime: 0,
          nitroTimer: sr.nitroTimer,
          nitroEnergy: 0,
          shieldTimer: sr.shieldTimer,
          shockSlowTimer: sr.shockSlowTimer,
          stunTimer: 0,
          spawnProtectTimer: 0,
          hitFlashTimer: 0,
          hp: sr.hp,
          maxHp: sr.maxHp,
          maxHealthBlocks: carDef.stats.maxHealthBlocks,
          shieldHp: sr.shieldHp,
          airBrakeBoostTimer: 0,
          comboCount: 0,
          comboTimer: 0,
          destroyed: sr.destroyed,
          respawnTimer: 0,
          inventory: sr.inventory.map((slot) => (slot ? { ...slot } : null)),
          activeSlot: sr.activeSlot,
          rearFireMode: false,
          boltCooldown: 0,
          trackT: proj.t,
          lateralOffset: proj.lateralOffset,
          lap: sr.lap,
          nextCheckpoint: sr.passedCheckpoints,
          passedCheckpoints: sr.passedCheckpoints,
          totalProgress: sr.totalProgress,
          position: sr.position,
          finished: sr.finished,
          finishTime: sr.finishTime,
          lapStartTime: 0,
          bestLapTime: 0,
          wrongWay: false,
          eliminated: sr.eliminated,
          hitsLanded: sr.hitsLanded,
          takedowns: sr.takedowns,
          powerUpsUsed: 0,
          blocksLanded: sr.blocksLanded,
          damageDealt: 0,
          raceFans: sr.raceFans,
          isDrafting: sr.isDrafting,
          aiLaneOffset: proj.lateralOffset,
          aiLaneTimer: 1,
          aiDecisionTimer: 2,
          aiAggression: 0.5,
          vy: 0,
          grounded: true,
          airborneTime: 0,
          suspCompression: [0, 0, 0, 0],
          lastSafeTrackT: proj.t,
        };
        this.racers.push(existingRacer);
        const rig = this.vehicleLoader.instantiateVehicleRig(
          carDef,
          custom,
          {
            contactShadow: this.textures.contactShadow,
            neonGlow: this.textures.neonGlow,
            headlightBeam: this.textures.headlightBeam,
            tailTrail: this.textures.tailTrail,
          },
          !this.isSoftwareGl && isLocal,
        );
        rig.root.position.set(sr.x, sr.y, sr.z);
        rig.root.rotation.y = sr.heading;
        this.scene.add(rig.root);
        this.racerRigs.set(existingRacer.id, rig);
      }

      const racer: RacerState = existingRacer;

      // Sync authoritative combat, health, inventory, lap & standings
      racer.hp = sr.hp;
      racer.maxHp = sr.maxHp;
      racer.nitroTimer = sr.nitroTimer;
      racer.shieldTimer = sr.shieldTimer;
      racer.shieldHp = sr.shieldHp;
      racer.shockSlowTimer = sr.shockSlowTimer;
      racer.destroyed = sr.destroyed;
      racer.eliminated = sr.eliminated;
      racer.finished = sr.finished;
      racer.finishTime = sr.finishTime;
      racer.lap = sr.lap;
      racer.passedCheckpoints = sr.passedCheckpoints;
      racer.totalProgress = sr.totalProgress;
      racer.position = sr.position;
      racer.isDrafting = sr.isDrafting;
      racer.hitsLanded = sr.hitsLanded;
      racer.takedowns = sr.takedowns;
      racer.blocksLanded = sr.blocksLanded;
      racer.raceFans = sr.raceFans;
      racer.inventory = sr.inventory.map((slot) => (slot ? { ...slot } : null));
      racer.activeSlot = sr.activeSlot;

      if (isLocal) {
        // Client-side prediction reconciliation (keep unacked inputs, smoothly correct residual error)
        const prevX = racer.x;
        const prevZ = racer.z;
        const prevHeading = racer.heading;
        this.pendingInputs = this.pendingInputs.filter((p) => p.seq > sr.lastProcessedInputSeq);

        const proj = projectPointToTrack(this.currentTrack, sr.x, sr.z);
        racer.x = sr.x;
        racer.y = sr.y;
        racer.z = sr.z;
        racer.vx = sr.vx;
        racer.vz = sr.vz;
        racer.heading = sr.heading;
        racer.speed = sr.speed;
        racer.lateralSpeed = sr.lateralSpeed;
        racer.steerAngle = sr.steerAngle;
        racer.trackT = proj.t;
        racer.lateralOffset = proj.lateralOffset;

        for (const pending of this.pendingInputs) {
          stepVehiclePhysics(
            racer,
            {
              throttle: pending.throttle,
              brake: pending.brake,
              steer: pending.steer,
              drift: pending.drift,
              usePowerUp: false,
              useNitro: false,
              instantRearFire: false,
              rearView: false,
              rearFire: false,
              cycleSlot: false,
              discardSlot: false,
              selectSlot: -1,
              recover: pending.recover,
            },
            this.currentTrack,
            pending.dt,
            this.racePhase === 'racing',
          );
        }

        // Smooth small prediction discrepancies (< 4.5m) instead of snapping violently
        const errDist = Math.hypot(racer.x - prevX, racer.z - prevZ);
        if (errDist > 0.05 && errDist < 4.5) {
          racer.x = prevX + (racer.x - prevX) * 0.35;
          racer.z = prevZ + (racer.z - prevZ) * 0.35;
          let dh = racer.heading - prevHeading;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          racer.heading = prevHeading + dh * 0.35;
        }
      } else {
        const proj = projectPointToTrack(this.currentTrack, sr.x, sr.z);
        racer.isRemote = true;
        racer.bodyPitch = sr.bodyPitch;
        racer.bodyRoll = sr.bodyRoll;
        racer.steerAngle = sr.steerAngle;
        racer.isDrifting = sr.isDrifting;
        racer.lateralSpeed = sr.lateralSpeed;
        racer.trackT = proj.t;
        racer.lateralOffset = proj.lateralOffset;

        const existingBuf = this.remoteBuffers.get(racer.id);
        const nextSample = { x: sr.x, y: sr.y, z: sr.z, heading: sr.heading, speed: sr.speed, t: nowMs };
        if (existingBuf) {
          existingBuf.prev = existingBuf.curr;
          existingBuf.curr = nextSample;
        } else {
          this.remoteBuffers.set(racer.id, { prev: nextSample, curr: nextSample });
          racer.x = sr.x;
          racer.y = sr.y;
          racer.z = sr.z;
          racer.heading = sr.heading;
          racer.speed = sr.speed;
        }
      }
    }

    // Sync authoritative pickup active states
    const activeMap = new Map(snapshot.pickups.map((p) => [p.id, p.active]));
    for (const node of this.pickups) {
      const state = activeMap.get(node.id);
      if (state !== undefined) node.active = state;
    }

    // Sync authoritative projectiles, mines, shock domes
    this.syncAuthoritativeCombatMeshes(snapshot);

    // Trigger VFX / SFX / HUD feed for newly received authoritative simulation events
    for (const ev of snapshot.events) {
      if (ev.seq <= this.lastAppliedEventSeq) continue;
      this.lastAppliedEventSeq = ev.seq;
      const targetRacer = this.racers.find((r) => r.id === (ev.targetId ?? ev.actorId));
      if (ev.type === 'pickup' && ev.actorId === myId && ev.powerUp) {
        this.audio.playPickup();
        this.pushFeed(`ACQUIRED ${ev.powerUp}`, POWERUP_DEFS[ev.powerUp].color);
      } else if (ev.type === 'powerup_fire' && ev.actorId === myId && ev.powerUp) {
        this.audio.playPowerUp(ev.powerUp);
      } else if (ev.type === 'shield_block') {
        if (targetRacer) this.spawnBurst(targetRacer.x, targetRacer.y + 1.0, targetRacer.z, 14, 0x00d8ff, 12);
        if (ev.targetId === myId || ev.actorId === myId) this.audio.playShieldBlock();
      } else if (ev.type === 'damage' || ev.type === 'wreck') {
        if (targetRacer) {
          this.spawnBurst(
            targetRacer.x,
            targetRacer.y + 1.0,
            targetRacer.z,
            ev.type === 'wreck' ? 32 : 16,
            0xff365e,
            ev.type === 'wreck' ? 18 : 12,
          );
        }
        if (ev.targetId === myId || ev.actorId === myId) {
          this.audio.playImpact(true);
          this.chaseCamera.addTrauma(ev.type === 'wreck' ? 0.85 : 0.45);
          if (ev.type === 'wreck') {
            this.pushFeed(ev.targetId === myId ? 'WRECKED!' : 'TAKEDOWN!', '#FF365E');
          }
        }
      }
    }
  }

  private syncAuthoritativeCombatMeshes(snapshot: AuthoritativeWorldSnapshot): void {
    // Projectiles
    const projIds = new Set(snapshot.projectiles.map((p) => p.id));
    for (const [id, mesh] of this.projectileMeshes.entries()) {
      if (!projIds.has(id)) {
        this.combatGroup.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }
    for (const p of snapshot.projectiles) {
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          p.type === 'SHUNT' ? this.shuntGeo : this.boltGeo,
          p.type === 'SHUNT' ? this.shuntMat : this.boltMat,
        );
        this.combatGroup.add(mesh);
        this.projectileMeshes.set(p.id, mesh);
      }
      mesh.position.set(p.x, p.y, p.z);
    }

    // Mines
    const mineIds = new Set(snapshot.mines.map((m) => m.id));
    for (const [id, mesh] of this.mineMeshes.entries()) {
      if (!mineIds.has(id)) {
        this.combatGroup.remove(mesh);
        this.mineMeshes.delete(id);
      }
    }
    for (const m of snapshot.mines) {
      let mesh = this.mineMeshes.get(m.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.mineGeo, this.mineMat);
        this.combatGroup.add(mesh);
        this.mineMeshes.set(m.id, mesh);
      }
      mesh.position.set(m.x, m.y, m.z);
    }

    // Shock domes
    const shockIds = new Set(snapshot.shockZones.map((s) => s.id));
    for (const [id, g] of this.shockMeshes.entries()) {
      if (!shockIds.has(id)) {
        this.combatGroup.remove(g);
        this.shockMeshes.delete(id);
      }
    }
    for (const sz of snapshot.shockZones) {
      if (!this.shockMeshes.has(sz.id)) {
        const g = new THREE.Group();
        g.position.set(sz.x, sz.y + 0.05, sz.z);
        const dome = new THREE.Mesh(
          this.shockDomeGeo,
          new THREE.MeshBasicMaterial({ color: 0x3b82f6, wireframe: true, transparent: true, opacity: 0.9 }),
        );
        dome.scale.set(sz.radius, sz.radius * 0.85, sz.radius);
        g.add(dome);
        this.combatGroup.add(g);
        this.shockMeshes.set(sz.id, g);
      }
    }
  }

  public applyAuthoritativeMatchFinished(result: AuthoritativeMatchResult): void {
    if (!this.raceConfig?.isMultiplayer) return;
    // Sync final standings from verified server result
    for (const st of result.standings) {
      const r =
        st.playerId === this.localNetPlayerId
          ? this.getPlayerRacer()
          : this.racers.find((x) => x.id === st.playerId);
      if (r) {
        r.position = st.position;
        r.finished = true;
        r.finishTime = st.finishTime;
        r.hitsLanded = st.hitsLanded;
        r.takedowns = st.takedowns;
      }
    }
    this.finishRaceNow();
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
    if (this.fanRunGateMesh) {
      this.combatGroup.remove(this.fanRunGateMesh);
      this.fanRunGateMesh = null;
    }
    if (this.checkpointGateMesh) {
      this.combatGroup.remove(this.checkpointGateMesh);
      this.checkpointGateMesh = null;
    }
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

    this.updateCameraMotionBlur(dt);
    this.renderCurrentFrame();
    this.captureCameraMotionHistory();
    this.scheduleNextTick();
  }

  /** Updates camera-velocity motion blur shader uniforms & camera-anchored peripheral speed streaks. */
  private updateCameraMotionBlur(dt: number): void {
    this.camera.updateMatrixWorld();
    this.currViewProjMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.invViewProjMatrix.copy(this.currViewProjMatrix).invert();

    this.camera.getWorldDirection(_vecA);
    const currentYaw = Math.atan2(_vecA.x, _vecA.z);
    let yawDelta = 0;
    if (this.motionBlurSeeded) {
      yawDelta = currentYaw - this.prevCameraYaw;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    } else {
      this.prevViewProjMatrix.copy(this.currViewProjMatrix);
      this.prevCameraYaw = currentYaw;
    }

    const player = this.mode === 'playing' ? this.getPlayerRacer() : undefined;
    const canBlur = this.mode === 'playing' && this.racePhase === 'racing' && Boolean(player && !player.destroyed);
    const carTop = player ? getVehicleById(player.vehicleId).stats.topSpeed : 80;
    const nitroOn = Boolean(player && player.nitroTimer > 0 && !player.destroyed);

    const params = computeCameraMotionBlurParams({
      mode: canBlur ? 'playing' : 'title',
      enabled: this.motionBlurEnabled,
      speedMs: player ? player.speed : 0,
      topSpeedMs: carTop,
      lateralSpeedMs: player ? player.lateralSpeed : 0,
      nitroActive: nitroOn,
      isDrafting: Boolean(player?.isDrafting),
      cameraMode: this.cameraMode,
      cameraYawDelta: yawDelta,
      dt,
    });

    if (this.motionBlurPass) {
      const uniforms = this.motionBlurPass.uniforms;
      uniforms['uIntensity'].value = params.intensity;
      uniforms['uRadialStrength'].value = params.radialStrength;
      (uniforms['uCamVelocity'].value as THREE.Vector2).set(params.camVelocityUv.x, params.camVelocityUv.y);
      (uniforms['uVanishingUv'].value as THREE.Vector2).set(params.vanishingUv.x, params.vanishingUv.y);
      uniforms['uChromatic'].value = params.chromaticAmount;
      (uniforms['uPrevViewProj'].value as THREE.Matrix4).copy(this.prevViewProjMatrix);
      (uniforms['uInvViewProj'].value as THREE.Matrix4).copy(this.invViewProjMatrix);
      this.motionBlurPass.enabled = params.intensity > 0.004;
    }

    this.speedStreakRig.update(params, nitroOn, dt);
  }

  private captureCameraMotionHistory(): void {
    this.prevViewProjMatrix.copy(this.currViewProjMatrix);
    this.camera.getWorldDirection(_vecA);
    this.prevCameraYaw = Math.atan2(_vecA.x, _vecA.z);
    this.motionBlurSeeded = true;
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

    // Shift look target toward camera-left so the hero car frames cleanly in the unobstructed right 60%
    this.camera.position.copy(this.currentCamPos);
    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(anchor.x - 1.65, anchor.y + 0.85, anchor.z + 0.85);

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

      // Destruction Arena & Checkpoint timed modes (single-player)
      if (canDrive && !this.raceConfig?.isMultiplayer && (this.raceConfig?.mode === 'destruction_arena' || this.raceConfig?.mode === 'checkpoint')) {
        this.modeTimeRemaining = Math.max(0, this.modeTimeRemaining - simDt);
        if (this.modeTimeRemaining <= 0) {
          this.finishRaceNow();
        }
      }

      // Step all racers
      const isAuthMp = Boolean(this.raceConfig?.isMultiplayer);
      const nowPerf = performance.now();
      for (const racer of this.racers) {
        if (racer.isRemote) {
          // Smooth snapshot interpolation with bounded extrapolation (<= 120ms) in authoritative multiplayer
          const buf = this.remoteBuffers.get(racer.id);
          if (buf) {
            const span = Math.max(16, buf.curr.t - buf.prev.t);
            const alpha = Math.min(1.12, (nowPerf - buf.curr.t) / span);
            const lerpT = Math.max(0, Math.min(1, alpha));
            if (alpha <= 1) {
              racer.x += (buf.curr.x - racer.x) * Math.min(1, 0.35 + lerpT * 0.45);
              racer.y += (buf.curr.y - racer.y) * 0.45;
              racer.z += (buf.curr.z - racer.z) * Math.min(1, 0.35 + lerpT * 0.45);
            } else {
              // Bounded dead-reckoning for up to 120ms between snapshots
              const extraDt = Math.min(0.12, (nowPerf - buf.curr.t) / 1000);
              racer.x = buf.curr.x + Math.sin(buf.curr.heading) * buf.curr.speed * extraDt;
              racer.z = buf.curr.z + Math.cos(buf.curr.heading) * buf.curr.speed * extraDt;
            }
            let dh = buf.curr.heading - racer.heading;
            while (dh > Math.PI) dh -= Math.PI * 2;
            while (dh < -Math.PI) dh += Math.PI * 2;
            racer.heading += dh * 0.4;
            racer.speed = buf.curr.speed;
          }
          racer.wheelSpin += (racer.speed / 0.38) * simDt;
          continue;
        }

        // In authoritative multiplayer, server owns AI, combat, pickups, and standings;
        // local player streams sequenced PlayerInputPayload and runs local physics prediction.
        if (isAuthMp) {
          if (!racer.isPlayer) continue;
          if (this.callbacks.onSendPlayerInput) {
            const seq = this.callbacks.onSendPlayerInput({
              throttle: stepControl.throttle,
              brake: stepControl.brake,
              steering: stepControl.steer,
              drift: stepControl.drift,
              firePowerUp: stepControl.usePowerUp,
              rearFire: Boolean(stepControl.instantRearFire || racer.rearFireMode),
              cycleSlot: stepControl.cycleSlot,
              discardSlot: stepControl.discardSlot,
              selectSlot: stepControl.selectSlot,
              recover: stepControl.recover,
            });
            if (seq > 0) {
              this.pendingInputs.push({
                seq,
                dt: simDt,
                throttle: stepControl.throttle,
                brake: stepControl.brake,
                steer: stepControl.steer,
                drift: stepControl.drift,
                recover: stepControl.recover,
              });
              if (this.pendingInputs.length > 120) {
                this.pendingInputs.shift();
              }
            }
          }
          const physEvents = stepVehiclePhysics(racer, stepControl, this.currentTrack, simDt, canDrive);
          if (stepIdx === subSteps - 1) {
            const carTop = getVehicleById(racer.vehicleId).stats.topSpeed;
            const speedRatio = Math.min(1.3, Math.abs(racer.speed) / carTop);
            const trans = computeTransmissionTelemetry(
              racer.speed,
              carTop,
              stepControl.throttle,
              physEvents.nitroActive,
            );
            const inTunnel = this.currentTrack.def.tunnelRanges.some(
              ([a, b]) => racer.trackT >= a && racer.trackT <= b,
            );
            this.audio.updateEngine(
              speedRatio,
              trans.rpmRatio,
              physEvents.driftIntensity,
              physEvents.nitroActive,
              trans.gear,
              inTunnel,
            );
          }
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
            this.chaseCamera.addTrauma(physEvents.wallHitIntensity * 0.45);
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

        // Update checkpoints & lap completion + Checkpoint mode / Fan Run / Fan Demand progress
        if (canDrive) {
          if (racer.isPlayer) {
            this.playerDistanceMeters += Math.abs(racer.speed) * simDt;
            // Checkpoint mode sequential timed gate check
            if (this.raceConfig?.mode === 'checkpoint') {
              const gateDist = forwardTrackDistance(this.currentTrack, racer.trackT, this.nextTimedGateT);
              if (gateDist < 12 || gateDist > this.currentTrack.totalLength - 12) {
                this.checkpointsCleared += 1;
                this.modeTimeRemaining = Math.min(60, this.modeTimeRemaining + 6.5);
                this.nextTimedGateT = normalizeT(this.nextTimedGateT + 0.14);
                if (this.checkpointGateMesh) {
                  this.positionGateOnTrack(this.checkpointGateMesh, this.nextTimedGateT, 0);
                }
                this.audio.playPickup();
                this.awardFans(racer, 100, `GATE ${this.checkpointsCleared} (+6.5s)`, '#00F5D4');
              }
            }
            // Optional Fan Run holographic ring chain
            this.updateFanRunForPlayer(racer, simDt);
            // Active Fan Demand challenge (drift duration & overtakes)
            this.updateFanDemandForPlayer(racer, simDt);
          }

          const cpRes = updateRacerCheckpoints(racer, this.currentTrack, racer.trackT, totalLaps, this.raceTime);
          if (racer.isPlayer && cpRes.lapCompleted && !cpRes.raceFinished && racer.lap === totalLaps) {
            this.finalLapShown = true;
            this.pushFeed('FINAL LAP!', '#00C8FF');
          }
          if (
            racer.isPlayer &&
            cpRes.raceFinished &&
            this.raceConfig?.mode !== 'destruction_arena' &&
            this.raceConfig?.mode !== 'checkpoint'
          ) {
            this.finishRaceNow();
          }
        }

        // Update archetype engine audio with 6-speed transmission, tunnel reverb filter, and incoming warning
        if (racer.isPlayer && stepIdx === subSteps - 1) {
          const carTop = getVehicleById(racer.vehicleId).stats.topSpeed;
          const speedRatio = Math.min(1.3, Math.abs(racer.speed) / carTop);
          const trans = computeTransmissionTelemetry(
            racer.speed,
            carTop,
            racerInput.throttle,
            physEvents.nitroActive,
          );
          const inTunnel = this.currentTrack.def.tunnelRanges.some(
            ([a, b]) => racer.trackT >= a && racer.trackT <= b,
          );
          this.audio.updateEngine(
            speedRatio,
            trans.rpmRatio,
            physEvents.driftIntensity,
            physEvents.nitroActive,
            trans.gear,
            inTunnel,
          );
        }
      }

      if (!isAuthMp) {
        // Car-to-car collisions (single-player offline)
        const carImpacts = resolveCarCollisions(this.racers);
        for (const imp of carImpacts) {
          this.spawnBurst(imp.x, 0.8, imp.z, 8, 0xffd166, 12);
          if (imp.aId === 'player_local' || imp.bId === 'player_local') {
            this.chaseCamera.addTrauma(imp.pairImpact * 0.55);
            this.audio.playImpact(imp.pairImpact > 0.55);
          }
        }

        // Update Pickups, Projectiles, Mines, Shock Domes, Barge Waves
        this.updatePickups(simDt);
        this.updateCombatEntities(simDt);
      } else {
        this.animatePickups(simDt);
      }
      this.updateParticles(stepBaseDt);
    }

    // Sort standings (single-player; in multiplayer standings come from authoritative snapshot)
    if (!this.raceConfig?.isMultiplayer) {
      sortRaceStandings(this.racers);
    }

    // Sync 3D vehicle meshes
    this.syncVehicleRigs(frameDt);

    // Update chase camera & follow track-matched directional light
    if (player) {
      this.updateRaceCamera(player, control.rearView, frameDt);
      const [kx, ky, kz] = this.activeLighting.keyOffset;
      this.keyLight.position.set(player.x + kx, player.y + ky, player.z + kz);
      this.keyLight.target.position.set(player.x, player.y, player.z);
    }

    // Throttled HUD update (~12 Hz, always emits immediately on low-FPS frames)
    this.hudEmitAccum += frameDt;
    if (this.hudEmitAccum >= 0.08) {
      this.hudEmitAccum = 0;
      this.emitHudSnapshot();
    }
  }

  private executePowerUpEffect(owner: RacerState, type: PowerUpType, rearFired: boolean, fromNetwork: boolean): void {
    if (owner.isPlayer && !fromNetwork) {
      this.audio.playPowerUp(type);
    }

    const fwdX = Math.sin(owner.heading);
    const fwdZ = Math.cos(owner.heading);
    const dir = rearFired && POWERUP_DEFS[type].supportsRearFire ? -1 : 1;

    switch (type) {
      case 'NITRO': {
        if (rearFired) {
          // Authentic Blur 2-Stage Reverse Nitro = Air-Brake + Corner-Exit Surge!
          resolveNitroAirBrake(owner);
          this.spawnBurst(owner.x + fwdX * 2.2, owner.y + 0.6, owner.z + fwdZ * 2.2, 16, 0x25f4a0, 12);
          if (owner.isPlayer) {
            this.chaseCamera.addTrauma(0.24);
            this.awardFans(owner, 75, 'AIR-BRAKE BOOST', '#25F4A0');
          }
        } else {
          const mult = getVehicleById(owner.vehicleId).stats.nitroEfficiency;
          owner.nitroTimer = Math.max(owner.nitroTimer, POWERUP_BALANCE.NITRO_DURATION * mult);
          if (owner.isPlayer) {
            this.chaseCamera.addTrauma(0.34);
            this.awardFans(owner, 50, 'NITRO OVERDRIVE', '#25F4A0');
          }
        }
        break;
      }
      case 'SHIELD': {
        owner.shieldTimer = POWERUP_BALANCE.SHIELD_DURATION;
        const modBonus =
          owner.isPlayer && this.raceConfig?.equippedMods?.includes('mod_aegis_capacitor')
            ? MULTIPLAYER_MOD_MAP['mod_aegis_capacitor']?.effects.shieldCapacityBonus ?? 0
            : 0;
        owner.shieldHp = POWERUP_BALANCE.SHIELD_CAPACITY + modBonus;
        if (owner.isPlayer) this.pushFeed('SHIELD DEFLECTOR ONLINE', '#00D8FF');
        break;
      }
      case 'REPAIR': {
        const healed = applyRepairPowerUp(owner);
        const blocksHealed = Math.ceil(healed / POWERUP_BALANCE.HEALTH_PER_BLOCK);
        this.spawnBurst(owner.x, owner.y + 1.1, owner.z, 20, 0x22c55e, 10);
        if (owner.isPlayer) this.awardFans(owner, 50, `CHASSIS REPAIR (+${blocksHealed} BLOCKS)`, '#22C55E');
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
                this.awardFans(owner, 200, 'SHUNT INTERCEPTED!', '#FF2A55');
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
          health: COMBAT_RULES.SHUNT_INITIAL_HEALTH,
        };
        this.projectiles.push(p);
        const mesh = new THREE.Mesh(this.shuntGeo, this.shuntMat);
        mesh.position.set(p.x, p.y, p.z);
        this.combatGroup.add(mesh);
        this.projectileMeshes.set(id, mesh);
        break;
      }
      case 'BOLT': {
        // V3.0 Sec 23 & 30: Rear-fired Bolt weakens incoming Shunt on 1st hit, destroys it on 2nd hit!
        if (dir < 0) {
          for (const proj of this.projectiles) {
            if (proj.type === 'SHUNT' && proj.targetId === owner.id && Math.hypot(proj.x - owner.x, proj.z - owner.z) < 38) {
              const bRes = resolveBoltVsShunt(proj);
              this.spawnBurst(proj.x, proj.y, proj.z, bRes.destroyed ? 22 : 12, 0xff8a00, bRes.destroyed ? 16 : 10);
              if (owner.isPlayer) {
                this.audio.playShieldBlock();
                this.awardFans(
                  owner,
                  bRes.destroyed ? 200 : 75,
                  bRes.destroyed ? 'BOLT DESTROYED SHUNT!' : 'BOLT WEAKENED SHUNT!',
                  '#FF8A00',
                );
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
          health: 1,
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
        // V3.0 Sec 24 & 30: Barge intercepts enemy Shunts, Bolts, AND nearby Mines via combatResolver
        const bargeInter = resolveBargeInterceptions(
          owner.id,
          owner.x,
          owner.z,
          POWERUP_BALANCE.BARGE_RADIUS,
          this.projectiles,
          this.mines,
        );
        for (const dp of bargeInter.destroyedProjectiles) {
          this.spawnBurst(dp.x, dp.y, dp.z, 12, 0xa855f7, 12);
        }
        for (const dm of bargeInter.destroyedMines) {
          this.spawnBurst(dm.x, dm.y, dm.z, 16, 0xfacc15, 14);
        }
        if (owner.isPlayer && (bargeInter.destroyedProjectiles.length > 0 || bargeInter.destroyedMines.length > 0)) {
          this.audio.playShieldBlock();
          this.awardFans(owner, 150, 'BARGE CLEARED HAZARDS!', '#B24BF3');
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
    const combo = applyComboFans(racer, amount);
    if (racer.isPlayer) {
      const suffix = combo.comboCount > 1 ? ` x${combo.comboCount} (+${combo.awarded})` : ` +${combo.awarded} FANS`;
      this.pushFeed(`${label}${suffix}`, color);
    }
  }

  private updateFanRunForPlayer(player: RacerState, dt: number): void {
    const fr = this.fanRun;
    if (!fr || fr.completed || fr.failed) return;

    if (!fr.triggered) {
      if (player.trackT >= 0.22 && player.trackT <= 0.35) {
        fr.triggered = true;
        fr.active = true;
        fr.nextGateTrackT = normalizeT(player.trackT + 0.045);
        fr.nextGateLateral = -2.2;
        if (this.fanRunGateMesh) {
          this.fanRunGateMesh.visible = true;
          this.positionGateOnTrack(this.fanRunGateMesh, fr.nextGateTrackT, fr.nextGateLateral);
        }
        this.pushFeed('FAN RUN ACTIVE — CLEAR 5 GATES!', '#FF2A85');
      }
      return;
    }

    if (!fr.active) return;
    fr.remainingSec = Math.max(0, fr.remainingSec - dt);
    if (fr.remainingSec <= 0) {
      fr.active = false;
      fr.failed = true;
      if (this.fanRunGateMesh) this.fanRunGateMesh.visible = false;
      this.pushFeed('FAN RUN EXPIRED', '#94A3B8');
      return;
    }

    if (this.fanRunGateMesh) {
      const dx = player.x - this.fanRunGateMesh.position.x;
      const dz = player.z - this.fanRunGateMesh.position.z;
      if (dx * dx + dz * dz < 16.5) {
        fr.gatesCleared += 1;
        this.audio.playPickup();
        if (fr.gatesCleared >= fr.gatesTotal) {
          fr.active = false;
          fr.completed = true;
          this.fanRunGateMesh.visible = false;
          this.awardFans(player, 400, 'FAN RUN COMPLETE!', '#FF2A85');
        } else {
          fr.nextGateTrackT = normalizeT(fr.nextGateTrackT + 0.045);
          fr.nextGateLateral = fr.gatesCleared % 2 === 0 ? -2.4 : 2.4;
          this.positionGateOnTrack(this.fanRunGateMesh, fr.nextGateTrackT, fr.nextGateLateral);
          this.awardFans(player, 65, `FAN GATE ${fr.gatesCleared}/${fr.gatesTotal}`, '#FF2A85');
        }
      }
    }
  }

  private updateFanDemandForPlayer(player: RacerState, dt: number): void {
    const fd = this.fanDemand;
    if (!fd || fd.status !== 'active') return;
    fd.remainingSec = Math.max(0, fd.remainingSec - dt);
    if (fd.type === 'drift_duration' && player.isDrifting) {
      fd.progress = Math.min(fd.target, fd.progress + dt);
    } else if (fd.type === 'overtake_rivals' && player.position < this.playerPrevPosition) {
      fd.progress = Math.min(fd.target, fd.progress + (this.playerPrevPosition - player.position));
    }
    this.playerPrevPosition = player.position;

    if (fd.progress >= fd.target) {
      fd.status = 'succeeded';
      this.awardFans(player, fd.rewardFans, `FAN DEMAND CLEARED!`, '#FF2A85');
    } else if (fd.remainingSec <= 0) {
      fd.status = 'failed';
      this.pushFeed('FAN DEMAND MISSED', '#94A3B8');
    }
  }

  private recordFanDemandCombat(type: 'hit_opponents' | 'block_or_intercept' | 'rear_fire_hit', player: RacerState): void {
    const fd = this.fanDemand;
    if (!fd || fd.status !== 'active' || fd.type !== type) return;
    fd.progress = Math.min(fd.target, fd.progress + 1);
    if (fd.progress >= fd.target) {
      fd.status = 'succeeded';
      this.awardFans(player, fd.rewardFans, 'FAN DEMAND CLEARED!', '#FF2A85');
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
        const modBonus = this.raceConfig?.equippedMods?.includes('mod_counter_surge') ? 100 : 0;
        this.awardFans(target, 200 + modBonus, `SHIELD DEFLECTED ${weapon}`, '#00D8FF');
        this.recordFanDemandCombat('block_or_intercept', target);
      } else if (attacker?.isPlayer) {
        this.audio.playShieldBlock();
        this.pushFeed(`${target.name} BLOCKED ${weapon}`, '#00D8FF');
      }
      return;
    }

    this.spawnBurst(target.x, target.y + 1.0, target.z, destroyed ? 36 : 18, POWERUP_DEFS[weapon].hexColor, destroyed ? 20 : 14);

    if (attacker?.isPlayer && this.raceConfig?.mode === 'destruction_arena') {
      const pts = destroyed ? 550 : 200;
      this.destructionScore += pts;
    }

    if (target.isPlayer || attacker?.isPlayer) {
      this.audio.playImpact(true);
      if (destroyed) {
        this.hitstopTimer = 0.065;
        this.chaseCamera.addTrauma(0.9);
        if (attacker?.isPlayer) {
          this.awardFans(attacker, 300, `WRECKED ${target.name}!`, '#FF2A55');
          this.recordFanDemandCombat('hit_opponents', attacker);
          if (attacker.rearFireMode) this.recordFanDemandCombat('rear_fire_hit', attacker);
        } else {
          this.pushFeed(`WRECKED BY ${attacker?.name ?? 'HAZARD'}!`, '#FF2A55');
        }
      } else {
        this.hitstopTimer = 0.035;
        this.chaseCamera.addTrauma(0.5);
        if (attacker?.isPlayer) {
          this.awardFans(attacker, 150, `${weapon} HIT ${target.name}`, POWERUP_DEFS[weapon].color);
          this.recordFanDemandCombat('hit_opponents', attacker);
          if (attacker.rearFireMode) this.recordFanDemandCombat('rear_fire_hit', attacker);
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
        const radiusMult =
          racer.isPlayer && this.raceConfig?.equippedMods?.includes('mod_magnetic_intake') ? 1.18 : 1.0;
        const pickupSq = 6.5 * radiusMult * radiusMult;
        if (dx * dx + dz * dz < pickupSq) {
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

      // Check in-flight BOLT vs enemy SHUNT 2-hit interception (V3.0 Sec 23 & 30)
      let hit = false;
      if (p.type === 'BOLT' && p.life > 0) {
        for (const other of this.projectiles) {
          if (other.type !== 'SHUNT' || other.ownerId === p.ownerId || other.life <= 0) continue;
          const bdx = other.x - p.x;
          const bdz = other.z - p.z;
          if (bdx * bdx + bdz * bdz < 10.24) {
            const res = resolveBoltVsShunt(other);
            this.spawnBurst(other.x, other.y, other.z, res.destroyed ? 18 : 10, 0x38bdf8, res.destroyed ? 14 : 9);
            const shooter = this.racers.find((a) => a.id === p.ownerId);
            if (shooter?.isPlayer) {
              this.audio.playShieldBlock();
              if (res.destroyed) {
                this.awardFans(shooter, 160, 'BOLT DESTROYED SHUNT! +160 FANS', '#38BDF8');
              } else {
                this.awardFans(shooter, 70, 'BOLT WEAKENED SHUNT! +70 FANS', '#38BDF8');
              }
            }
            hit = true;
            break;
          }
        }
      }

      // Check hit against racers
      if (!hit) {
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
          // V3.0 Sec 26 & 30: Standard Shield absorbs Shock impact but is depleted by it
          if (resolveShockVsShield(r)) {
            this.onCombatHit(attacker, r, 'SHOCK', true, false);
          } else {
            const res = applyCombatDamage(r, sz.damage, attacker, 0, 0, 0.35);
            if (!res.blockedByShield) {
              r.shockSlowTimer = POWERUP_BALANCE.SHOCK_SLOW_DURATION;
            }
            this.onCombatHit(attacker, r, 'SHOCK', res.blockedByShield, res.destroyedNow);
          }
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

      // Wheel spin, front wheel steering & 4-wheel suspension travel
      rig.wheelPivots[0].rotation.y = r.steerAngle;
      rig.wheelPivots[1].rotation.y = r.steerAngle;
      for (let wi = 0; wi < rig.wheelPivots.length; wi++) {
        const comp = r.suspCompression?.[wi] ?? 0;
        const baseY = rig.wheelBaseY[wi] ?? 0.36;
        rig.wheelPivots[wi].position.y = baseY + (comp - 0.16) * 0.14;
      }
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

      // Hit flash emissive pulse + V7.0 5-Stage Progressive Visible Damage & LOD update
      const damageStage = computeVehicleDamageStage(r.hp, r.maxHp, r.destroyed);
      applyVehicleDamageVisuals(rig, damageStage, this.elapsedClock);
      if (rig.lod) {
        rig.lod.update(this.camera);
      }

      const flash = r.hitFlashTimer > 0;
      if (flash) {
        for (const mat of rig.hitFlashMaterials) {
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.65;
        }
      }

      // Critical damage embers & smoke trail
      if ((damageStage === 'critical' || damageStage === 'wrecked') && Math.random() < 0.45) {
        this.spawnParticle(
          r.x,
          r.y + 0.9,
          r.z,
          (Math.random() - 0.5) * 2.5,
          2.6,
          (Math.random() - 0.5) * 2.5,
          0.42,
          0.36,
          damageStage === 'wrecked' ? 0xff4500 : 0xffaa22,
        );
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
    this.chaseCamera.update(
      this.camera,
      player,
      this.currentTrack,
      this.cameraMode,
      rearView,
      this.reducedMotion,
      dt,
      this.trackScene ? [this.trackScene.group] : undefined,
    );
    this.currentCamPos.copy(this.chaseCamera.currentPos);
    this.currentCamLook.copy(this.chaseCamera.currentLook);
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
    const carTop = player ? getVehicleById(player.vehicleId).stats.topSpeed : 80;
    const trans = computeTransmissionTelemetry(
      player ? player.speed : 0,
      carTop,
      player && player.speed > 1 ? 1 : 0,
      Boolean(player && player.nitroTimer > 0),
    );
    const gear = trans.gear;
    const rpmRatio = trans.rpmRatio;
    this.lastHudGear = gear;

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
      const lockMult = this.raceConfig?.equippedMods?.includes('mod_precision_optics') ? 1.15 : 1.0;
      let bestDist = 165 * lockMult;
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
    const activeParticles = this.particles.reduce((acc, p) => acc + (p.active ? 1 : 0), 0);
    const damageStage = player
      ? computeVehicleDamageStage(player.hp, player.maxHp, player.destroyed)
      : 'healthy';

    return {
      phase: this.racePhase,
      mode: this.raceConfig?.mode ?? 'combat_race',
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
      hp: Math.round(player?.hp ?? 120),
      maxHp: Math.round(player?.maxHp ?? 120),
      maxHealthBlocks: player?.maxHealthBlocks ?? 6,
      damageStage,
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
      comboCount: (player?.comboTimer ?? 0) > 0 ? (player?.comboCount ?? 0) : 0,
      comboMultiplier:
        (player?.comboTimer ?? 0) > 0 && (player?.comboCount ?? 0) > 1
          ? Number((1 + ((player?.comboCount ?? 1) - 1) * 0.2).toFixed(1))
          : 1,
      lockTargetScreen,
      inventory: player ? player.inventory.map((s) => (s ? { ...s } : null)) : [null, null, null],
      activeSlot: player?.activeSlot ?? 0,
      fps: this.measuredFps,
      pingMs: this.pingMs,
      finalLapBanner: this.finalLapShown && this.raceTime > 5,
      eliminationTimer: Math.ceil(this.eliminationTimer),
      modeTimeRemaining: Math.ceil(this.modeTimeRemaining),
      destructionScore: this.destructionScore,
      checkpointsCleared: this.checkpointsCleared,
      fanRun: this.fanRun
        ? {
            active: this.fanRun.active,
            completed: this.fanRun.completed,
            gatesCleared: this.fanRun.gatesCleared,
            gatesTotal: this.fanRun.gatesTotal,
            remainingSec: Math.ceil(this.fanRun.remainingSec),
          }
        : null,
      fanDemand: this.fanDemand
        ? {
            label: this.fanDemand.label,
            progress: Number(this.fanDemand.progress.toFixed(1)),
            target: this.fanDemand.target,
            remainingSec: Math.ceil(this.fanDemand.remainingSec),
            status: this.fanDemand.status,
          }
        : null,
      diagnostics: {
        fps: this.measuredFps,
        frameTimeMs: Number((1000 / Math.max(1, this.measuredFps)).toFixed(1)),
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        physicsMs: 1.2,
        resolution: `${this.container.clientWidth}x${this.container.clientHeight}`,
        pingMs: this.pingMs,
        snapshotBytes: 0,
        isSoftwareGl: this.isSoftwareGl,
      },
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
        blocksLanded: r.blocksLanded,
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
    this.vehicleLoader.dispose();
    this.trackScene?.dispose();
    this.textures.dispose();
    this.speedStreakRig.dispose();
    this.motionBlurPass?.dispose();
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
