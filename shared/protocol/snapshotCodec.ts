import type { PowerUpType } from '../../src/game/types';
import {
  VALID_POWERUP_TYPES,
  type AuthoritativeMineSnapshot,
  type AuthoritativePickupSnapshot,
  type AuthoritativeProjectileSnapshot,
  type AuthoritativeRacerSnapshot,
  type AuthoritativeShockSnapshot,
  type AuthoritativeSimulationEvent,
  type AuthoritativeWorldSnapshot,
} from './messages';

const PHASE_TO_CODE = { countdown: 0, racing: 1, finished: 2 } as const;
const CODE_TO_PHASE: ('countdown' | 'racing' | 'finished')[] = ['countdown', 'racing', 'finished'];

const PU_TO_CODE = new Map<PowerUpType, number>(VALID_POWERUP_TYPES.map((p, idx) => [p, idx]));

function q(v: number, scale: number): number {
  return Math.round(v * scale);
}

export interface CompactRacerMeta {
  i: number;
  id: string;
  n: string;
  v: string;
  a: 0 | 1;
  mh: number;
}

export interface CompactPickupMeta {
  id: string;
  t: number; // powerup index
}

export interface CompactWorldSnapshot {
  type: 'world_snapshot_compact';
  v: 2;
  k: 0 | 1; // 1 = full keyframe, 0 = delta frame
  m: string;
  t: number;
  s: number;
  p: 0 | 1 | 2;
  cd: number;
  rt: number;
  meta?: CompactRacerMeta[];
  pmeta?: CompactPickupMeta[];
  /** Compact racer state tuples */
  r: (number | string)[][];
  /** Full keyframe: bitstring of active pickups; Delta: array of [idx, 0|1] changed pickups */
  pu: string | [number, 0 | 1][];
  pr?: [string, 0 | 1, string, number, number, number, number, number][];
  mn?: [string, string, number, number, number, 0 | 1][];
  sk?: [string, string, number, number, number, number][];
  ev?: AuthoritativeSimulationEvent[];
}

function encodeInventory(inv: ({ type: PowerUpType; ammo: number } | null)[]): string {
  let out = '';
  for (let i = 0; i < 3; i++) {
    const slot = inv[i];
    if (!slot) {
      out += '-';
    } else {
      const code = PU_TO_CODE.get(slot.type) ?? 0;
      out += `${code}:${slot.ammo}`;
    }
    if (i < 2) out += ',';
  }
  return out;
}

function decodeInventory(raw: string): ({ type: PowerUpType; ammo: number } | null)[] {
  const parts = raw.split(',');
  const out: ({ type: PowerUpType; ammo: number } | null)[] = [null, null, null];
  for (let i = 0; i < 3; i++) {
    const seg = parts[i];
    if (!seg || seg === '-') continue;
    const [cStr, aStr] = seg.split(':');
    const type = VALID_POWERUP_TYPES[Number(cStr)];
    const ammo = Number(aStr);
    if (type && Number.isFinite(ammo)) {
      out[i] = { type, ammo };
    }
  }
  return out;
}

function encodeFlags(r: AuthoritativeRacerSnapshot): number {
  return (
    (r.destroyed ? 1 : 0) |
    (r.eliminated ? 2 : 0) |
    (r.isDrifting ? 4 : 0) |
    (r.isDrafting ? 8 : 0) |
    (r.finished ? 16 : 0)
  );
}

/**
 * Stateful server-side compact/delta snapshot encoder (V7.0 Section 37).
 * Eliminates repeated static metadata, quantizes continuous transforms, compresses pickup
 * arrays into bitstrings / delta flips, and emits periodic full keyframes every keyframeInterval frames.
 */
export class SnapshotEncoder {
  private readonly keyframeInterval: number;
  private frameCount = 0;
  private lastPickupState: boolean[] = [];

  constructor(keyframeInterval = 20) {
    this.keyframeInterval = Math.max(1, keyframeInterval);
  }

  public reset(): void {
    this.frameCount = 0;
    this.lastPickupState = [];
  }

  public encode(snap: AuthoritativeWorldSnapshot, forceKeyframe = false): CompactWorldSnapshot {
    const isKeyframe =
      forceKeyframe ||
      this.frameCount === 0 ||
      this.frameCount % this.keyframeInterval === 0 ||
      this.lastPickupState.length !== snap.pickups.length;
    this.frameCount += 1;

    const rTuples = snap.racers.map((r, idx) => [
      idx,
      q(r.x, 100),
      q(r.y, 100),
      q(r.z, 100),
      q(r.vx, 100),
      q(r.vz, 100),
      q(r.heading, 1000),
      q(r.speed, 100),
      q(r.lateralSpeed, 100),
      q(r.steerAngle, 1000),
      q(r.bodyPitch, 1000),
      q(r.bodyRoll, 1000),
      Math.round(r.hp),
      q(r.shieldTimer, 10),
      Math.round(r.shieldHp),
      q(r.nitroTimer, 10),
      q(r.shockSlowTimer, 10),
      encodeFlags(r),
      r.lap,
      r.passedCheckpoints,
      q(r.totalProgress, 1000),
      r.position,
      q(r.finishTime, 100),
      r.hitsLanded,
      r.takedowns,
      r.blocksLanded,
      r.raceFans,
      r.activeSlot,
      encodeInventory(r.inventory),
      r.lastProcessedInputSeq,
    ]);

    let puField: string | [number, 0 | 1][];
    if (isKeyframe) {
      let bits = '';
      this.lastPickupState = snap.pickups.map((p) => {
        bits += p.active ? '1' : '0';
        return p.active;
      });
      puField = bits;
    } else {
      const diffs: [number, 0 | 1][] = [];
      for (let i = 0; i < snap.pickups.length; i++) {
        const active = snap.pickups[i].active;
        if (this.lastPickupState[i] !== active) {
          this.lastPickupState[i] = active;
          diffs.push([i, active ? 1 : 0]);
        }
      }
      puField = diffs;
    }

    const out: CompactWorldSnapshot = {
      type: 'world_snapshot_compact',
      v: 2,
      k: isKeyframe ? 1 : 0,
      m: snap.matchId,
      t: snap.tick,
      s: snap.serverTime,
      p: PHASE_TO_CODE[snap.phase],
      cd: q(snap.countdownTimer, 100),
      rt: q(snap.raceTime, 1000),
      r: rTuples,
      pu: puField,
    };

    if (isKeyframe) {
      out.meta = snap.racers.map((r, i) => ({
        i,
        id: r.id,
        n: r.name,
        v: r.vehicleId,
        a: r.isAi ? 1 : 0,
        mh: r.maxHp,
      }));
      out.pmeta = snap.pickups.map((p) => ({
        id: p.id,
        t: PU_TO_CODE.get(p.type) ?? 0,
      }));
    }

    if (snap.projectiles.length > 0) {
      out.pr = snap.projectiles.map((p) => [
        p.id,
        p.type === 'SHUNT' ? 0 : 1,
        p.ownerId,
        q(p.x, 100),
        q(p.y, 100),
        q(p.z, 100),
        q(p.vx, 100),
        q(p.vz, 100),
      ]);
    }
    if (snap.mines.length > 0) {
      out.mn = snap.mines.map((m) => [
        m.id,
        m.ownerId,
        q(m.x, 100),
        q(m.y, 100),
        q(m.z, 100),
        m.armed ? 1 : 0,
      ]);
    }
    if (snap.shockZones.length > 0) {
      out.sk = snap.shockZones.map((s) => [
        s.id,
        s.ownerId,
        q(s.x, 100),
        q(s.y, 100),
        q(s.z, 100),
        q(s.radius, 100),
      ]);
    }
    if (snap.events.length > 0) {
      out.ev = snap.events;
    }

    return out;
  }
}

/**
 * Stateful client-side compact/delta snapshot decoder reconstructing full AuthoritativeWorldSnapshot.
 */
export class SnapshotDecoder {
  private racerMeta: CompactRacerMeta[] = [];
  private pickupMeta: CompactPickupMeta[] = [];
  private pickupActive: boolean[] = [];
  private lastTick = -1;

  public reset(): void {
    this.racerMeta = [];
    this.pickupMeta = [];
    this.pickupActive = [];
    this.lastTick = -1;
  }

  public decode(compact: CompactWorldSnapshot): AuthoritativeWorldSnapshot | null {
    if (compact.v !== 2) return null;
    if (compact.t < this.lastTick && compact.k !== 1) return null;
    this.lastTick = compact.t;

    if (compact.k === 1) {
      if (compact.meta) this.racerMeta = compact.meta;
      if (compact.pmeta) this.pickupMeta = compact.pmeta;
      if (typeof compact.pu === 'string') {
        this.pickupActive = Array.from(compact.pu, (ch) => ch === '1');
      }
    } else {
      if (this.racerMeta.length === 0) return null; // wait for initial keyframe
      if (Array.isArray(compact.pu)) {
        for (const [idx, val] of compact.pu) {
          if (idx >= 0 && idx < this.pickupActive.length) {
            this.pickupActive[idx] = val === 1;
          }
        }
      }
    }

    const racers: AuthoritativeRacerSnapshot[] = compact.r.map((row) => {
      const idx = Number(row[0]);
      const meta = this.racerMeta[idx] ?? { i: idx, id: `r_${idx}`, n: 'RACER', v: 'street_falcon', a: 1, mh: 100 };
      const flags = Number(row[17]);
      return {
        id: meta.id,
        name: meta.n,
        vehicleId: meta.v,
        isAi: meta.a === 1,
        x: Number(row[1]) / 100,
        y: Number(row[2]) / 100,
        z: Number(row[3]) / 100,
        vx: Number(row[4]) / 100,
        vz: Number(row[5]) / 100,
        heading: Number(row[6]) / 1000,
        speed: Number(row[7]) / 100,
        lateralSpeed: Number(row[8]) / 100,
        steerAngle: Number(row[9]) / 1000,
        bodyPitch: Number(row[10]) / 1000,
        bodyRoll: Number(row[11]) / 1000,
        hp: Number(row[12]),
        maxHp: meta.mh,
        shieldTimer: Number(row[13]) / 10,
        shieldHp: Number(row[14]),
        nitroTimer: Number(row[15]) / 10,
        shockSlowTimer: Number(row[16]) / 10,
        destroyed: (flags & 1) !== 0,
        eliminated: (flags & 2) !== 0,
        isDrifting: (flags & 4) !== 0,
        isDrafting: (flags & 8) !== 0,
        lap: Number(row[18]),
        passedCheckpoints: Number(row[19]),
        totalProgress: Number(row[20]) / 1000,
        position: Number(row[21]),
        finished: (flags & 16) !== 0,
        finishTime: Number(row[22]) / 100,
        hitsLanded: Number(row[23]),
        takedowns: Number(row[24]),
        blocksLanded: Number(row[25]),
        raceFans: Number(row[26]),
        activeSlot: Number(row[27]),
        inventory: decodeInventory(String(row[28])),
        lastProcessedInputSeq: Number(row[29]),
      };
    });

    const pickups: AuthoritativePickupSnapshot[] = this.pickupMeta.map((pm, idx) => ({
      id: pm.id,
      active: this.pickupActive[idx] ?? true,
      type: VALID_POWERUP_TYPES[pm.t] ?? 'BOLT',
    }));

    const projectiles: AuthoritativeProjectileSnapshot[] = (compact.pr ?? []).map((p) => ({
      id: p[0],
      type: p[1] === 0 ? 'SHUNT' : 'BOLT',
      ownerId: p[2],
      x: p[3] / 100,
      y: p[4] / 100,
      z: p[5] / 100,
      vx: p[6] / 100,
      vz: p[7] / 100,
    }));

    const mines: AuthoritativeMineSnapshot[] = (compact.mn ?? []).map((m) => ({
      id: m[0],
      ownerId: m[1],
      x: m[2] / 100,
      y: m[3] / 100,
      z: m[4] / 100,
      armed: m[5] === 1,
    }));

    const shockZones: AuthoritativeShockSnapshot[] = (compact.sk ?? []).map((s) => ({
      id: s[0],
      ownerId: s[1],
      x: s[2] / 100,
      y: s[3] / 100,
      z: s[4] / 100,
      radius: s[5] / 100,
    }));

    return {
      type: 'world_snapshot',
      matchId: compact.m,
      tick: compact.t,
      serverTime: compact.s,
      phase: CODE_TO_PHASE[compact.p] ?? 'racing',
      countdownTimer: compact.cd / 100,
      raceTime: compact.rt / 1000,
      racers,
      pickups,
      projectiles,
      mines,
      shockZones,
      events: compact.ev ?? [],
    };
  }
}
