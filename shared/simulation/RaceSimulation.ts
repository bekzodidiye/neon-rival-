import type {
  BargeWaveState,
  ControlInput,
  Difficulty,
  GameModeId,
  MineState,
  PowerUpType,
  ProjectileState,
  RacerState,
  ShockZoneState,
  TrackId,
  TrackPickupNode,
  VehicleCustomization,
} from '../../src/game/types';
import {
  buildTrack,
  forwardTrackDistance,
  generateTrackPickups,
  getSpawnGridTransform,
  sampleTrackAt,
  sampleTrackByDistance,
  sortRaceStandings,
  tToDistance,
  updateRacerCheckpoints,
  type BuiltTrack,
} from '../../src/game/trackMath';
import { getVehicleById } from '../../src/game/vehicles';
import {
  applyCombatDamage,
  applyRepairPowerUp,
  collectPowerUp,
  consumeActivePowerUp,
  cyclePowerUpSlot,
  discardPowerUpSlot,
  POWERUP_BALANCE,
  POWERUP_DEFS,
} from '../../src/game/powerups';
import {
  applyComboFans,
  COMBAT_RULES,
  resolveBargeInterceptions,
  resolveBoltVsShunt,
  resolveNitroAirBrake,
  resolveShieldAbsorption,
  resolveShockVsShield,
} from '../../src/game/combatResolver';
import { recoverVehicleToTrack, resolveCarCollisions, stepVehiclePhysics } from '../../src/game/physics';
import { AI_DRIVER_NAMES, computeAiInput } from '../../src/game/ai';
import type {
  AuthoritativeSimulationEvent,
  AuthoritativeWorldSnapshot,
} from '../protocol/messages';

export interface SimParticipantConfig {
  id: string;
  userId?: string | null;
  name: string;
  vehicleId: string;
  customization?: Partial<VehicleCustomization>;
  isAi: boolean;
  aiAggression?: number;
  equippedMods?: string[];
}

export interface RaceSimulationConfig {
  matchId: string;
  trackId: TrackId;
  mode: GameModeId;
  laps: number;
  difficulty: Difficulty;
  participants: SimParticipantConfig[];
  countdownSeconds?: number;
  seed?: number;
  timeLimitSec?: number;
  targetCheckpoints?: number;
}

export interface SimulationMetrics {
  ticksSimulated: number;
  collisionCount: number;
  recoveryCount: number;
  pickupsCollected: number;
  powerUpsUsed: number;
  wrecks: number;
  shieldBlocks: number;
  invalidCheckpointRejects: number;
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createIdleControlInput(): ControlInput {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    drift: false,
    useNitro: false,
    usePowerUp: false,
    cycleSlot: false,
    discardSlot: false,
    selectSlot: -1,
    rearView: false,
    rearFire: false,
    recover: false,
  };
}

/**
 * Reusable, browser-independent authoritative race simulation (V6.0 Section 14).
 * Zero dependencies on Three.js, React, window, document, DOM input, or Web Audio.
 * Drives both headless multi-lap combat acceptance tests and the authoritative Node.js multiplayer server.
 */
export class RaceSimulation {
  public readonly matchId: string;
  public readonly trackId: TrackId;
  public readonly mode: GameModeId;
  public readonly totalLaps: number;
  public readonly difficulty: Difficulty;
  public readonly track: BuiltTrack;

  public tick = 0;
  public phase: 'countdown' | 'racing' | 'finished' = 'countdown';
  public countdownTimer: number;
  public raceTime = 0;
  public modeTimeRemaining: number;
  public targetCheckpoints: number;
  public destructionScores = new Map<string, number>();

  public racers: RacerState[] = [];
  public pickups: TrackPickupNode[] = [];
  public projectiles: ProjectileState[] = [];
  public mines: MineState[] = [];
  public shockZones: ShockZoneState[] = [];
  public bargeWaves: BargeWaveState[] = [];

  public readonly participantUserIds = new Map<string, string | null>();
  public readonly participantMods = new Map<string, string[]>();
  public readonly lastProcessedSeq = new Map<string, number>();
  public readonly metrics: SimulationMetrics = {
    ticksSimulated: 0,
    collisionCount: 0,
    recoveryCount: 0,
    pickupsCollected: 0,
    powerUpsUsed: 0,
    wrecks: 0,
    shieldBlocks: 0,
    invalidCheckpointRejects: 0,
  };

  private readonly rng: () => number;
  private entityCounter = 0;
  private eventSeq = 0;
  private pendingEvents: AuthoritativeSimulationEvent[] = [];

  constructor(config: RaceSimulationConfig) {
    this.matchId = config.matchId;
    this.trackId = config.trackId;
    this.mode = config.mode;
    this.totalLaps = Math.max(1, Math.min(10, Math.round(config.laps)));
    this.difficulty = config.difficulty;
    this.countdownTimer = config.countdownSeconds ?? 2.5;
    this.modeTimeRemaining =
      config.timeLimitSec ??
      (config.mode === 'checkpoint' ? 38 : config.mode === 'destruction_arena' ? 90 : 0);
    this.targetCheckpoints = config.targetCheckpoints ?? 16;
    this.rng = config.seed !== undefined ? createMulberry32(config.seed) : Math.random;

    this.track = buildTrack(config.trackId);
    this.pickups = generateTrackPickups(this.track);
    if (config.mode === 'checkpoint') {
      // Checkpoint mode focuses on NITRO & time-extension pickup strategy
      this.pickups.forEach((p, idx) => {
        p.type = idx % 2 === 0 ? 'NITRO' : 'SHIELD';
      });
    } else if (config.mode === 'destruction_arena') {
      const offensive: PowerUpType[] = ['SHUNT', 'BOLT', 'BARGE', 'MINE', 'SHOCK'];
      this.pickups.forEach((p, idx) => {
        p.type = offensive[idx % offensive.length];
      });
    }

    this.racers = config.participants.map((p, idx) => {
      const car = getVehicleById(p.vehicleId);
      const spawn = getSpawnGridTransform(this.track, idx);
      this.participantUserIds.set(p.id, p.userId ?? null);
      this.participantMods.set(p.id, (p.equippedMods ?? []).slice(0, 3));
      this.destructionScores.set(p.id, 0);
      this.lastProcessedSeq.set(p.id, 0);

      return {
        id: p.id,
        name: p.name || AI_DRIVER_NAMES[idx % AI_DRIVER_NAMES.length],
        isPlayer: !p.isAi,
        isRemote: false,
        vehicleId: car.id,
        customization: { ...car.defaultCustomization, ...(p.customization ?? {}) },
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        vx: 0,
        vz: 0,
        vy: 0,
        grounded: true,
        airborneTime: 0,
        suspCompression: [0, 0, 0, 0],
        lastSafeTrackT: spawn.trackT,
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
        nitroEnergy: 0,
        shieldTimer: 0,
        shieldHp: 0,
        shockSlowTimer: 0,
        stunTimer: 0,
        spawnProtectTimer: 0,
        hitFlashTimer: 0,
        airBrakeBoostTimer: 0,
        comboCount: 0,
        comboTimer: 0,
        hp: car.stats.durability,
        maxHp: car.stats.durability,
        maxHealthBlocks: car.stats.maxHealthBlocks,
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
        aiLaneTimer: 1.0 + idx * 0.25,
        aiDecisionTimer: 1.6 + idx * 0.3,
        aiAggression: p.aiAggression ?? 0.45 + (idx % 3) * 0.2,
      };
    });

    if (this.countdownTimer <= 0) {
      this.phase = 'racing';
    }
  }

  private emitEvent(ev: Omit<AuthoritativeSimulationEvent, 'seq'>): void {
    this.eventSeq += 1;
    this.pendingEvents.push({ seq: this.eventSeq, ...ev });
    if (this.pendingEvents.length > 64) {
      this.pendingEvents.shift();
    }
  }

  public drainEvents(): AuthoritativeSimulationEvent[] {
    if (this.pendingEvents.length === 0) return [];
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }

  /**
   * Advances the entire race simulation by one fixed step (recommended dt = 1/60s).
   * Human participants supply validated ControlInput via humanInputs map; AI drivers run computeAiInput.
   */
  public step(dt: number, humanInputs: Map<string, ControlInput> = new Map()): void {
    const safeDt = Math.max(0.005, Math.min(0.05, dt));
    this.tick += 1;
    this.metrics.ticksSimulated += 1;

    if (this.phase === 'finished') return;

    if (this.phase === 'countdown') {
      this.countdownTimer -= safeDt;
      if (this.countdownTimer <= 0) {
        this.countdownTimer = 0;
        this.phase = 'racing';
      }
    }

    const canDrive = this.phase === 'racing';
    if (canDrive) {
      this.raceTime += safeDt;
      if (this.mode === 'checkpoint' || this.mode === 'destruction_arena') {
        this.modeTimeRemaining = Math.max(0, this.modeTimeRemaining - safeDt);
      }
    }

    // 1. Update Slipstream drafting flags
    for (const r of this.racers) {
      r.isDrafting = false;
      if (!canDrive || r.destroyed || r.finished || r.speed < 25) continue;
      for (const other of this.racers) {
        if (other.id === r.id || other.destroyed || other.eliminated) continue;
        const ahead = forwardTrackDistance(this.track, r.trackT, other.trackT);
        if (ahead > 4 && ahead < 26 && Math.abs(other.lateralOffset - r.lateralOffset) < 2.6) {
          r.isDrafting = true;
          break;
        }
      }
    }

    // 2. Step each racer's inputs, inventory actions, respawns, physics, and checkpoints
    for (const racer of this.racers) {
      if (racer.comboTimer && racer.comboTimer > 0) {
        racer.comboTimer = Math.max(0, racer.comboTimer - safeDt);
        if (racer.comboTimer === 0) racer.comboCount = 0;
      }

      // Wreck respawn countdown
      if (racer.destroyed && !racer.eliminated) {
        racer.respawnTimer -= safeDt;
        if (racer.respawnTimer <= 0) {
          racer.destroyed = false;
          racer.hp = racer.maxHp;
          racer.shieldTimer = 0;
          racer.shieldHp = 0;
          racer.shockSlowTimer = 0;
          racer.stunTimer = 0;
          racer.spawnProtectTimer = 2.0;
          recoverVehicleToTrack(racer, this.track);
          this.metrics.recoveryCount += 1;
        }
      }

      let input: ControlInput;
      if (!canDrive || racer.finished || racer.eliminated) {
        input = createIdleControlInput();
      } else if (!racer.isPlayer) {
        input = computeAiInput(
          racer,
          this.racers,
          this.track,
          this.pickups,
          this.projectiles,
          this.shockZones,
          this.difficulty,
          safeDt,
          this.rng,
        );
      } else {
        input = humanInputs.get(racer.id) ?? createIdleControlInput();
      }

      if (canDrive && !racer.destroyed && !racer.finished && !racer.eliminated) {
        if (input.recover) {
          this.metrics.recoveryCount += 1;
        }
        if (input.selectSlot >= 0 && input.selectSlot <= 2) {
          racer.activeSlot = input.selectSlot;
        }
        if (input.cycleSlot) {
          racer.activeSlot = cyclePowerUpSlot(racer.inventory, racer.activeSlot);
        }
        if (input.discardSlot) {
          discardPowerUpSlot(racer.inventory, racer.activeSlot);
        }
        if (input.usePowerUp && racer.boltCooldown <= 0) {
          const consumed = consumeActivePowerUp(racer.inventory, racer.activeSlot);
          if (consumed.firedType) {
            racer.activeSlot = consumed.newActiveSlot;
            racer.powerUpsUsed += 1;
            this.metrics.powerUpsUsed += 1;
            if (consumed.firedType === 'BOLT') {
              racer.boltCooldown = POWERUP_BALANCE.BOLT_INTERVAL;
            }
            this.executeAuthoritativePowerUp(racer, consumed.firedType, Boolean(input.rearFire));
          }
        }
      }

      stepVehiclePhysics(racer, input, this.track, safeDt, canDrive);

      if (canDrive && !racer.finished) {
        const prevPassed = racer.passedCheckpoints;
        const cpRes = updateRacerCheckpoints(racer, this.track, racer.trackT, this.totalLaps, this.raceTime);
        if (this.mode === 'checkpoint' && racer.isPlayer && racer.passedCheckpoints > prevPassed) {
          this.modeTimeRemaining = Math.min(90, this.modeTimeRemaining + 5.5);
          if (racer.passedCheckpoints >= this.targetCheckpoints) {
            racer.finished = true;
            racer.finishTime = this.raceTime;
            this.emitEvent({ type: 'finish', actorId: racer.id, value: racer.finishTime });
          }
        }
        if (cpRes.lapCompleted) {
          this.emitEvent({ type: 'lap', actorId: racer.id, value: racer.lap });
        }
        if (cpRes.raceFinished) {
          this.emitEvent({ type: 'finish', actorId: racer.id, value: racer.finishTime });
        }
      }
    }

    // 3. Vehicle-specific OBB SAT collisions
    const impacts = resolveCarCollisions(this.racers);
    this.metrics.collisionCount += impacts.length;

    // 4. Authoritative single-owner pickup collection & respawn timers
    this.stepPickups(safeDt);

    // 5. Authoritative projectiles, mines, shock domes, and barge waves
    this.stepCombat(safeDt);

    // 6. Authoritative race standings & match completion check
    if (this.mode === 'destruction_arena') {
      const sorted = [...this.racers].sort(
        (a, b) => (this.destructionScores.get(b.id) ?? 0) - (this.destructionScores.get(a.id) ?? 0),
      );
      sorted.forEach((r, idx) => {
        r.position = idx + 1;
      });
    } else {
      sortRaceStandings(this.racers);
    }

    if (canDrive && (this.mode === 'checkpoint' || this.mode === 'destruction_arena') && this.modeTimeRemaining <= 0) {
      for (const r of this.racers) {
        if (!r.finished) {
          r.finished = true;
          r.finishTime = this.raceTime;
        }
      }
      this.phase = 'finished';
      return;
    }

    const activeRacers = this.racers.filter((r) => !r.eliminated);
    if (canDrive && activeRacers.length > 0 && activeRacers.every((r) => r.finished)) {
      this.phase = 'finished';
    }
  }

  private executeAuthoritativePowerUp(owner: RacerState, type: PowerUpType, rearFired: boolean): void {
    const fwdX = Math.sin(owner.heading);
    const fwdZ = Math.cos(owner.heading);
    const dir = rearFired && POWERUP_DEFS[type].supportsRearFire ? -1 : 1;

    this.emitEvent({ type: 'powerup_fire', actorId: owner.id, powerUp: type, rearFired: dir < 0 });

    switch (type) {
      case 'NITRO': {
        if (dir < 0) {
          resolveNitroAirBrake(owner);
        } else {
          const mult = getVehicleById(owner.vehicleId).stats.nitroEfficiency;
          owner.nitroTimer = Math.max(owner.nitroTimer, POWERUP_BALANCE.NITRO_DURATION * mult);
        }
        break;
      }
      case 'SHIELD': {
        const mods = this.participantMods.get(owner.id) ?? [];
        const shieldBonus = mods.includes('mod_aegis_capacitor') ? 15 : 0;
        owner.shieldTimer = POWERUP_BALANCE.SHIELD_DURATION;
        owner.shieldHp = POWERUP_BALANCE.SHIELD_CAPACITY + shieldBonus;
        break;
      }
      case 'REPAIR': {
        applyRepairPowerUp(owner);
        break;
      }
      case 'BARGE': {
        this.entityCounter += 1;
        this.bargeWaves.push({
          id: `barge_${this.entityCounter}`,
          ownerId: owner.id,
          x: owner.x,
          y: owner.y + 0.5,
          z: owner.z,
          radius: 1.5,
          maxRadius: POWERUP_BALANCE.BARGE_RADIUS,
          life: 0.35,
          maxLife: 0.35,
        });

        // Counterplay: clear nearby enemy projectiles and mines
        resolveBargeInterceptions(
          owner.id,
          owner.x,
          owner.z,
          POWERUP_BALANCE.BARGE_RADIUS,
          this.projectiles,
          this.mines,
        );

        // Radial impulse & damage to nearby opponents
        for (const other of this.racers) {
          if (other.id === owner.id || other.destroyed || other.eliminated) continue;
          const dx = other.x - owner.x;
          const dz = other.z - owner.z;
          const d = Math.hypot(dx, dz);
          if (d < POWERUP_BALANCE.BARGE_RADIUS && d > 0.01) {
            const nx = dx / d;
            const nz = dz / d;
            const push = POWERUP_BALANCE.BARGE_IMPULSE * (1 - d / POWERUP_BALANCE.BARGE_RADIUS * 0.45);
            other.vx += nx * push;
            other.vz += nz * push;
            other.stunTimer = Math.max(other.stunTimer, 0.38);
            this.applyAuthoritativeDamage(other, POWERUP_BALANCE.BARGE_DAMAGE, owner, 'BARGE');
          }
        }
        break;
      }
      case 'MINE': {
        this.entityCounter += 1;
        const dropDist = dir > 0 ? 11.5 : -4.2;
        const mx = owner.x + fwdX * dropDist;
        const mz = owner.z + fwdZ * dropDist;
        this.mines.push({
          id: `mine_${this.entityCounter}`,
          ownerId: owner.id,
          x: mx,
          y: owner.y + 0.45,
          z: mz,
          radius: POWERUP_BALANCE.MINE_TRIGGER_RADIUS,
          life: POWERUP_BALANCE.MINE_LIFETIME,
          armTimer: 0.35,
          damage: POWERUP_BALANCE.MINE_DAMAGE,
        });
        break;
      }
      case 'SHOCK': {
        // Spawn 3 avoidable electrical domes ahead of the race leader (or ahead of caster if caster leads)
        const sorted = sortRaceStandings(this.racers);
        const leader = sorted.find((r) => !r.destroyed && !r.eliminated) ?? owner;
        const baseDist = tToDistance(this.track, leader.trackT);
        const offsets = [
          { d: 65, lat: -4.2 },
          { d: 98, lat: 4.2 },
          { d: 132, lat: 0 },
        ];
        for (const off of offsets) {
          const s = sampleTrackByDistance(this.track, baseDist + off.d);
          this.entityCounter += 1;
          this.shockZones.push({
            id: `shock_${this.entityCounter}`,
            ownerId: owner.id,
            x: s.x + s.rx * off.lat,
            y: s.y + 0.2,
            z: s.z + s.rz * off.lat,
            trackT: s.t,
            radius: POWERUP_BALANCE.SHOCK_RADIUS,
            life: POWERUP_BALANCE.SHOCK_DURATION,
            damage: POWERUP_BALANCE.SHOCK_DAMAGE,
            hitRacerIds: [],
          });
        }
        break;
      }
      case 'SHUNT': {
        // Lock onto closest opponent ahead along track
        let targetId: string | null = null;
        if (dir > 0) {
          let bestDist = 180;
          for (const other of this.racers) {
            if (other.id === owner.id || other.destroyed || other.eliminated) continue;
            const ahead = forwardTrackDistance(this.track, owner.trackT, other.trackT);
            if (ahead > 4 && ahead < bestDist) {
              bestDist = ahead;
              targetId = other.id;
            }
          }
        }
        this.entityCounter += 1;
        const spd = Math.max(owner.speed + 44, POWERUP_BALANCE.SHUNT_SPEED);
        this.projectiles.push({
          id: `shunt_${this.entityCounter}`,
          type: 'SHUNT',
          ownerId: owner.id,
          targetId,
          x: owner.x + fwdX * (3.2 * dir),
          y: owner.y + 0.85,
          z: owner.z + fwdZ * (3.2 * dir),
          vx: fwdX * spd * dir,
          vz: fwdZ * spd * dir,
          speed: spd,
          life: 4.8,
          maxLife: 4.8,
          damage: POWERUP_BALANCE.SHUNT_DAMAGE,
          rearFired: dir < 0,
          health: COMBAT_RULES.SHUNT_INITIAL_HEALTH,
        });
        break;
      }
      case 'BOLT': {
        this.entityCounter += 1;
        const spd = Math.max(owner.speed + 65, POWERUP_BALANCE.BOLT_SPEED);
        this.projectiles.push({
          id: `bolt_${this.entityCounter}`,
          type: 'BOLT',
          ownerId: owner.id,
          targetId: null,
          x: owner.x + fwdX * (3.0 * dir),
          y: owner.y + 0.8,
          z: owner.z + fwdZ * (3.0 * dir),
          vx: fwdX * spd * dir,
          vz: fwdZ * spd * dir,
          speed: spd,
          life: 2.2,
          maxLife: 2.2,
          damage: POWERUP_BALANCE.BOLT_DAMAGE,
          rearFired: dir < 0,
        });
        break;
      }
    }
  }

  private applyAuthoritativeDamage(
    target: RacerState,
    damage: number,
    attacker: RacerState | null,
    weapon: PowerUpType,
  ): void {
    if (target.destroyed || target.eliminated || target.spawnProtectTimer > 0) return;

    if (target.shieldTimer > 0) {
      const shieldRes = resolveShieldAbsorption(target, damage);
      if (shieldRes.blocked) {
        target.blocksLanded += 1;
        this.metrics.shieldBlocks += 1;
        this.emitEvent({
          type: 'shield_block',
          actorId: target.id,
          targetId: attacker?.id,
          powerUp: weapon,
        });
        return;
      }
    }

    const res = applyCombatDamage(target, damage, attacker);
    if (res.appliedDamage > 0) {
      this.emitEvent({
        type: 'damage',
        actorId: attacker?.id ?? 'world',
        targetId: target.id,
        powerUp: weapon,
        value: res.appliedDamage,
      });
      if (attacker) {
        applyComboFans(attacker, res.destroyedNow ? 300 : 120);
        if (this.mode === 'destruction_arena') {
          const comboMult = Math.min(4, 1 + Math.max(0, (attacker.comboCount ?? 1) - 1) * 0.5);
          const pts = Math.round((res.destroyedNow ? 450 : 140) * comboMult);
          this.destructionScores.set(attacker.id, (this.destructionScores.get(attacker.id) ?? 0) + pts);
        }
      }
      if (res.destroyedNow) {
        this.metrics.wrecks += 1;
        this.emitEvent({
          type: 'wreck',
          actorId: attacker?.id ?? 'world',
          targetId: target.id,
          powerUp: weapon,
        });
      }
    }
  }

  private stepPickups(dt: number): void {
    for (const node of this.pickups) {
      if (!node.active) {
        node.respawnTimer -= dt;
        if (node.respawnTimer <= 0) {
          node.active = true;
          node.respawnTimer = 0;
        }
        continue;
      }

      // Atomic exclusive pickup ownership: first eligible racer wins the pickup on this tick
      for (const racer of this.racers) {
        if (racer.destroyed || racer.eliminated || racer.finished) continue;
        const mods = this.participantMods.get(racer.id) ?? [];
        const radius = mods.includes('mod_magnetic_intake') ? 3.15 * 1.18 : 3.15;
        const dx = racer.x - node.x;
        const dz = racer.z - node.z;
        if (dx * dx + dz * dz <= radius * radius) {
          const collected = collectPowerUp(racer.inventory, racer.activeSlot, node.type);
          if (collected.collected) {
            racer.activeSlot = collected.newActiveSlot;
            node.active = false;
            node.respawnTimer = 6.5;
            this.metrics.pickupsCollected += 1;
            if (this.mode === 'checkpoint' && racer.isPlayer) {
              this.modeTimeRemaining = Math.min(90, this.modeTimeRemaining + 2.5);
            }
            this.emitEvent({ type: 'pickup', actorId: racer.id, powerUp: node.type });
            break; // Strictly one racer per pickup!
          }
        }
      }
    }
  }

  private stepCombat(dt: number): void {
    // 1. Projectiles (Shunt homing + Bolt interception + vehicle impact)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      if (p.type === 'SHUNT' && p.targetId && !p.rearFired) {
        const tgt = this.racers.find((r) => r.id === p.targetId && !r.destroyed && !r.eliminated);
        if (tgt) {
          const dx = tgt.x - p.x;
          const dz = tgt.z - p.z;
          const d = Math.hypot(dx, dz) || 1;
          const desVx = (dx / d) * p.speed;
          const desVz = (dz / d) * p.speed;
          const turnRate = Math.min(1, 5.5 * dt);
          p.vx += (desVx - p.vx) * turnRate;
          p.vz += (desVz - p.vz) * turnRate;
          const curSpd = Math.hypot(p.vx, p.vz) || 1;
          p.vx = (p.vx / curSpd) * p.speed;
          p.vz = (p.vz / curSpd) * p.speed;
        }
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // Counterplay: Bolt intercepting incoming enemy Shunt
      if (p.type === 'BOLT') {
        let intercepted = false;
        for (const other of this.projectiles) {
          if (other.type !== 'SHUNT' || other.ownerId === p.ownerId || other.life <= 0) continue;
          const dSq = (other.x - p.x) ** 2 + (other.z - p.z) ** 2;
          if (dSq < 3.5 * 3.5) {
            resolveBoltVsShunt(other);
            p.life = 0;
            intercepted = true;
            break;
          }
        }
        if (intercepted) {
          this.projectiles.splice(i, 1);
          continue;
        }
      }

      // Projectile vs Vehicle impact
      const attacker = this.racers.find((r) => r.id === p.ownerId) ?? null;
      const hitRadiusSq = (p.type === 'SHUNT' ? 2.85 : 2.35) ** 2;
      let hit = false;
      for (const r of this.racers) {
        if (r.id === p.ownerId || r.destroyed || r.eliminated) continue;
        const dx = r.x - p.x;
        const dz = r.z - p.z;
        if (dx * dx + dz * dz <= hitRadiusSq) {
          this.applyAuthoritativeDamage(r, p.damage, attacker, p.type);
          if (p.type === 'SHUNT' && r.shieldTimer <= 0) {
            r.stunTimer = Math.max(r.stunTimer, 0.55);
            r.vx += (p.vx / Math.max(1, p.speed)) * 12;
            r.vz += (p.vz / Math.max(1, p.speed)) * 12;
          }
          hit = true;
          break;
        }
      }
      if (hit) {
        this.projectiles.splice(i, 1);
      }
    }

    // 2. Mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      m.armTimer = Math.max(0, m.armTimer - dt);
      if (m.life <= 0) {
        this.mines.splice(i, 1);
        continue;
      }
      if (m.armTimer > 0) continue;

      const attacker = this.racers.find((r) => r.id === m.ownerId) ?? null;
      let detonated = false;
      for (const r of this.racers) {
        if (r.destroyed || r.eliminated) continue;
        if (r.id === m.ownerId && m.life > POWERUP_BALANCE.MINE_LIFETIME - 1.2) continue;
        const dx = r.x - m.x;
        const dz = r.z - m.z;
        if (dx * dx + dz * dz <= m.radius * m.radius) {
          this.applyAuthoritativeDamage(r, m.damage, attacker, 'MINE');
          if (r.shieldTimer <= 0) {
            r.stunTimer = Math.max(r.stunTimer, 0.65);
            r.speed *= 0.55;
            r.vx *= 0.55;
            r.vz *= 0.55;
          }
          detonated = true;
          break;
        }
      }
      if (detonated) {
        this.mines.splice(i, 1);
      }
    }

    // 3. Shock Domes
    for (let i = this.shockZones.length - 1; i >= 0; i--) {
      const sz = this.shockZones[i];
      sz.life -= dt;
      if (sz.life <= 0) {
        this.shockZones.splice(i, 1);
        continue;
      }
      const attacker = this.racers.find((r) => r.id === sz.ownerId) ?? null;
      for (const r of this.racers) {
        if (r.destroyed || r.eliminated || sz.hitRacerIds.includes(r.id)) continue;
        const dx = r.x - sz.x;
        const dz = r.z - sz.z;
        if (dx * dx + dz * dz <= sz.radius * sz.radius) {
          sz.hitRacerIds.push(r.id);
          if (resolveShockVsShield(r)) {
            r.blocksLanded += 1;
            this.metrics.shieldBlocks += 1;
            this.emitEvent({ type: 'shield_block', actorId: r.id, targetId: attacker?.id, powerUp: 'SHOCK' });
          } else {
            r.shockSlowTimer = Math.max(r.shockSlowTimer, POWERUP_BALANCE.SHOCK_SLOW_DURATION);
            this.applyAuthoritativeDamage(r, POWERUP_BALANCE.SHOCK_DAMAGE, attacker, 'SHOCK');
          }
        }
      }
    }

    // 4. Barge waves
    for (let i = this.bargeWaves.length - 1; i >= 0; i--) {
      const bw = this.bargeWaves[i];
      bw.life -= dt;
      if (bw.life <= 0) {
        this.bargeWaves.splice(i, 1);
      }
    }
  }

  public createSnapshot(serverTime = Date.now()): AuthoritativeWorldSnapshot {
    return {
      type: 'world_snapshot',
      matchId: this.matchId,
      tick: this.tick,
      serverTime,
      phase: this.phase,
      countdownTimer: Number(this.countdownTimer.toFixed(2)),
      raceTime: Number(this.raceTime.toFixed(3)),
      racers: this.racers.map((r) => ({
        id: r.id,
        name: r.name,
        vehicleId: r.vehicleId,
        isAi: !r.isPlayer,
        x: Number(r.x.toFixed(3)),
        y: Number(r.y.toFixed(3)),
        z: Number(r.z.toFixed(3)),
        vx: Number(r.vx.toFixed(3)),
        vz: Number(r.vz.toFixed(3)),
        heading: Number(r.heading.toFixed(4)),
        speed: Number(r.speed.toFixed(3)),
        lateralSpeed: Number(r.lateralSpeed.toFixed(3)),
        steerAngle: Number(r.steerAngle.toFixed(4)),
        bodyPitch: Number(r.bodyPitch.toFixed(4)),
        bodyRoll: Number(r.bodyRoll.toFixed(4)),
        hp: r.hp,
        maxHp: r.maxHp,
        shieldTimer: Number(r.shieldTimer.toFixed(2)),
        shieldHp: r.shieldHp ?? 0,
        nitroTimer: Number(r.nitroTimer.toFixed(2)),
        shockSlowTimer: Number(r.shockSlowTimer.toFixed(2)),
        destroyed: r.destroyed,
        eliminated: r.eliminated,
        isDrifting: r.isDrifting,
        isDrafting: Boolean(r.isDrafting),
        lap: r.lap,
        passedCheckpoints: r.passedCheckpoints,
        totalProgress: Number(r.totalProgress.toFixed(4)),
        position: r.position,
        finished: r.finished,
        finishTime: Number(r.finishTime.toFixed(3)),
        hitsLanded: r.hitsLanded,
        takedowns: r.takedowns,
        blocksLanded: r.blocksLanded,
        raceFans: r.raceFans ?? 0,
        activeSlot: r.activeSlot,
        inventory: r.inventory.map((slot) => (slot ? { type: slot.type, ammo: slot.ammo } : null)),
        lastProcessedInputSeq: this.lastProcessedSeq.get(r.id) ?? 0,
      })),
      pickups: this.pickups.map((p) => ({ id: p.id, active: p.active, type: p.type })),
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        type: p.type,
        ownerId: p.ownerId,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        z: Number(p.z.toFixed(2)),
        vx: Number(p.vx.toFixed(2)),
        vz: Number(p.vz.toFixed(2)),
      })),
      mines: this.mines.map((m) => ({
        id: m.id,
        ownerId: m.ownerId,
        x: Number(m.x.toFixed(2)),
        y: Number(m.y.toFixed(2)),
        z: Number(m.z.toFixed(2)),
        armed: m.armTimer <= 0,
      })),
      shockZones: this.shockZones.map((s) => ({
        id: s.id,
        ownerId: s.ownerId,
        x: Number(s.x.toFixed(2)),
        y: Number(s.y.toFixed(2)),
        z: Number(s.z.toFixed(2)),
        radius: s.radius,
      })),
      events: this.drainEvents(),
    };
  }
}

export { sampleTrackAt };
