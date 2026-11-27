import type { PowerUpType, RacerState, TrackId, TrackPickupNode } from './types';
import { POWERUP_TYPES } from './powerups';

export interface Vec2 {
  x: number;
  z: number;
}

export interface TrackSample {
  t: number; // 0..1 spline parameter
  cumDist: number; // meters from start line
  x: number;
  y: number;
  z: number;
  tx: number; // unit horizontal tangent x
  tz: number; // unit horizontal tangent z
  rx: number; // unit right x
  rz: number; // unit right z
  slope: number; // dy / ds (vertical grade)
  ny: number; // surface normal Y
  bankAngle: number; // subtle corner banking radians
  curvature: number; // signed turn sharpness (1/m scaled)
  width: number;
  isTunnel: boolean;
}

export interface CheckpointGate {
  index: number;
  t: number;
  cumDist: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  halfWidth: number;
}

export interface TrackDefinition {
  id: TrackId;
  name: string;
  subtitle: string;
  environmentTheme: 'neon_city' | 'industrial_port' | 'midnight_streets';
  roadWidth: number;
  defaultLaps: number;
  controlPoints: { x: number; z: number; y?: number }[];
  tunnelRanges: [number, number][]; // [tStart, tEnd]
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  accentPrimary: number;
  accentSecondary: number;
}

export interface BuiltTrack {
  def: TrackDefinition;
  samples: TrackSample[];
  arcLengths: number[]; // cumulative arc-length at each sample (length = samples.length + 1)
  totalLength: number;
  checkpointCount: number;
  checkpoints: CheckpointGate[];
  minimapPath: Vec2[];
}

export const TRACK_DEFINITIONS: Record<TrackId, TrackDefinition> = {
  neon_city: {
    id: 'neon_city',
    name: 'NEON CITY',
    subtitle: 'Downtown Express Loop · 3.0 km',
    environmentTheme: 'neon_city',
    roadWidth: 22,
    defaultLaps: 3,
    // Sweeping closed urban circuit (~3.0 km) with wide start grid, elevated skyline overpass (+6.5m),
    // fast sweeping right-hander, technical S-chicane, depressed underpass tunnel, and wide final hairpin.
    controlPoints: [
      { x: 0, z: 0, y: 0 },
      { x: 0, z: 240, y: 0.4 },
      { x: 55, z: 430, y: 4.5 },
      { x: 220, z: 520, y: 6.5 },
      { x: 420, z: 485, y: 3.5 },
      { x: 520, z: 330, y: 0.2 },
      { x: 445, z: 165, y: 0 },
      { x: 555, z: 10, y: 0 },
      { x: 525, z: -210, y: 1.8 },
      { x: 350, z: -345, y: 3.2 },
      { x: 140, z: -310, y: 1.0 },
      { x: 15, z: -200, y: 0 },
    ],
    tunnelRanges: [
      [0.44, 0.56],
      [0.78, 0.85],
    ],
    skyColor: 0x070d1c,
    fogColor: 0x0b1326,
    fogDensity: 0.0018,
    accentPrimary: 0x00c8ff,
    accentSecondary: 0x8b5cf6,
  },
  industrial_port: {
    id: 'industrial_port',
    name: 'INDUSTRIAL PORT',
    subtitle: 'Container Terminal Circuit · 2.6 km',
    environmentTheme: 'industrial_port',
    roadWidth: 23,
    defaultLaps: 3,
    controlPoints: [
      { x: 0, z: 0, y: 0 },
      { x: 0, z: 260, y: 0 },
      { x: 120, z: 390, y: 3.0 },
      { x: 340, z: 390, y: 4.5 },
      { x: 460, z: 260, y: 1.5 },
      { x: 430, z: 60, y: 0 },
      { x: 280, z: -35, y: 0 },
      { x: 390, z: -215, y: 2.2 },
      { x: 260, z: -340, y: 1.5 },
      { x: 60, z: -290, y: 0 },
      { x: -35, z: -150, y: 0 },
    ],
    tunnelRanges: [[0.25, 0.34]],
    skyColor: 0x090d17,
    fogColor: 0x101624,
    fogDensity: 0.002,
    accentPrimary: 0xff8a00,
    accentSecondary: 0x00c8ff,
  },
  midnight_streets: {
    id: 'midnight_streets',
    name: 'MIDNIGHT STREETS',
    subtitle: 'Rain-Slicked Skyscraper District · 3.1 km',
    environmentTheme: 'midnight_streets',
    roadWidth: 21,
    defaultLaps: 3,
    controlPoints: [
      { x: 0, z: 0, y: 0 },
      { x: 0, z: 270, y: 0.5 },
      { x: -115, z: 440, y: 3.8 },
      { x: 40, z: 590, y: 5.0 },
      { x: 290, z: 540, y: 2.0 },
      { x: 430, z: 370, y: 0 },
      { x: 330, z: 185, y: 0 },
      { x: 460, z: -20, y: 2.5 },
      { x: 380, z: -240, y: 3.0 },
      { x: 170, z: -310, y: 1.0 },
      { x: 15, z: -210, y: 0 },
    ],
    tunnelRanges: [
      [0.14, 0.22],
      [0.62, 0.71],
    ],
    skyColor: 0x060b18,
    fogColor: 0x0c1124,
    fogDensity: 0.0019,
    accentPrimary: 0x25f4a0,
    accentSecondary: 0xff365e,
  },
};

export const TRACK_LIST: TrackDefinition[] = Object.values(TRACK_DEFINITIONS);

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Build a dense arc-length indexed closed racing circuit from control points. */
export function buildTrack(trackId: TrackId, sampleCount = 360): BuiltTrack {
  const def = TRACK_DEFINITIONS[trackId] ?? TRACK_DEFINITIONS.neon_city;
  const pts = def.controlPoints;
  const n = pts.length;

  const rawPoints: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const u = (i / sampleCount) * n;
    const seg = Math.floor(u) % n;
    const localT = u - Math.floor(u);

    const p0 = pts[(seg - 1 + n) % n];
    const p1 = pts[seg];
    const p2 = pts[(seg + 1) % n];
    const p3 = pts[(seg + 2) % n];

    rawPoints.push({
      x: catmullRom(p0.x, p1.x, p2.x, p3.x, localT),
      y: Math.max(0, catmullRom(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0, localT)),
      z: catmullRom(p0.z, p1.z, p2.z, p3.z, localT),
    });
  }

  // Pass 1: Build exact cumulative arc-length lookup table
  const arcLengths: number[] = new Array(sampleCount + 1);
  arcLengths[0] = 0;
  for (let i = 0; i < sampleCount; i++) {
    const curr = rawPoints[i];
    const next = rawPoints[(i + 1) % sampleCount];
    const segLen = Math.hypot(next.x - curr.x, next.y - curr.y, next.z - curr.z);
    arcLengths[i + 1] = arcLengths[i] + segLen;
  }
  const totalLength = arcLengths[sampleCount];

  // Pass 2: Build TrackSamples with tangent, right vector, slope, normal, and curvature
  const samples: TrackSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const prev = rawPoints[(i - 1 + sampleCount) % sampleCount];
    const curr = rawPoints[i];
    const next = rawPoints[(i + 1) % sampleCount];

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const dz = next.z - prev.z;
    const horizLen = Math.hypot(dx, dz) || 1;
    const tx = dx / horizLen;
    const tz = dz / horizLen;
    const rx = -tz;
    const rz = tx;
    const slope = Math.max(-0.22, Math.min(0.22, dy / horizLen));
    const ny = 1 / Math.sqrt(1 + slope * slope);

    // Signed curvature
    const d1x = curr.x - prev.x;
    const d1z = curr.z - prev.z;
    const d2x = next.x - curr.x;
    const d2z = next.z - curr.z;
    const l1 = Math.hypot(d1x, d1z) || 1;
    const l2 = Math.hypot(d2x, d2z) || 1;
    const cross = (d1x / l1) * (d2z / l2) - (d1z / l1) * (d2x / l2);

    const t = i / sampleCount;
    const isTunnel = def.tunnelRanges.some(([a, b]) => t >= a && t <= b);
    const bankAngle = Math.max(-0.06, Math.min(0.06, cross * 0.45));

    samples.push({
      t,
      cumDist: arcLengths[i],
      x: curr.x,
      y: curr.y,
      z: curr.z,
      tx,
      tz,
      rx,
      rz,
      slope,
      ny,
      bankAngle,
      curvature: cross,
      width: def.roadWidth,
      isTunnel,
    });
  }

  const minimapPath: Vec2[] = [];
  const step = Math.max(1, Math.floor(sampleCount / 72));
  for (let i = 0; i < sampleCount; i += step) {
    minimapPath.push({ x: samples[i].x, z: samples[i].z });
  }

  const checkpointCount = 12;
  const built: BuiltTrack = {
    def,
    samples,
    arcLengths,
    totalLength,
    checkpointCount,
    checkpoints: [],
    minimapPath,
  };

  // Build evenly spaced arc-length checkpoint gates around the circuit
  const checkpoints: CheckpointGate[] = [];
  for (let ci = 0; ci < checkpointCount; ci++) {
    const dist = (ci / checkpointCount) * totalLength;
    const s = sampleTrackByDistance(built, dist);
    checkpoints.push({
      index: ci,
      t: s.t,
      cumDist: dist,
      x: s.x,
      y: s.y,
      z: s.z,
      tx: s.tx,
      tz: s.tz,
      rx: s.rx,
      rz: s.rz,
      halfWidth: s.width * 0.55,
    });
  }
  built.checkpoints = checkpoints;

  return built;
}

export function normalizeT(t: number): number {
  let r = t % 1;
  if (r < 0) r += 1;
  return r;
}

export function normalizeDistance(track: BuiltTrack, dist: number): number {
  const L = track.totalLength;
  let d = dist % L;
  if (d < 0) d += L;
  return d;
}

/** Convert spline parameter t in [0,1) to exact arc-length distance in meters. */
export function tToDistance(track: BuiltTrack, tRaw: number): number {
  const t = normalizeT(tRaw);
  const n = track.samples.length;
  const f = t * n;
  const i0 = Math.floor(f) % n;
  const alpha = f - Math.floor(f);
  const d0 = track.arcLengths[i0];
  const d1 = track.arcLengths[i0 + 1];
  return d0 + (d1 - d0) * alpha;
}

/** Convert arc-length distance in meters to spline parameter t in [0,1) via binary search. */
export function distanceToT(track: BuiltTrack, distRaw: number): number {
  const d = normalizeDistance(track, distRaw);
  const arc = track.arcLengths;
  const n = track.samples.length;
  let lo = 0;
  let hi = n;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arc[mid] <= d) lo = mid;
    else hi = mid;
  }
  const segLen = Math.max(0.0001, arc[lo + 1] - arc[lo]);
  const alpha = (d - arc[lo]) / segLen;
  return normalizeT((lo + alpha) / n);
}

/** Sample interpolated track frame at exact arc-length distance in meters (Stage 3 Sec 20). */
export function sampleTrackByDistance(track: BuiltTrack, distMeters: number): TrackSample {
  const t = distanceToT(track, distMeters);
  return sampleTrackAt(track, t);
}

/** Sample interpolated track frame at normalized parameter t in [0, 1). */
export function sampleTrackAt(track: BuiltTrack, tRaw: number): TrackSample {
  const t = normalizeT(tRaw);
  const n = track.samples.length;
  const f = t * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const alpha = f - Math.floor(f);
  const a = track.samples[i0];
  const b = track.samples[i1];

  const tx = a.tx + (b.tx - a.tx) * alpha;
  const tz = a.tz + (b.tz - a.tz) * alpha;
  const tLen = Math.hypot(tx, tz) || 1;
  const ntx = tx / tLen;
  const ntz = tz / tLen;

  const cumDist = track.arcLengths[i0] + (track.arcLengths[i0 + 1] - track.arcLengths[i0]) * alpha;

  return {
    t,
    cumDist,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    tx: ntx,
    tz: ntz,
    rx: -ntz,
    rz: ntx,
    slope: a.slope + (b.slope - a.slope) * alpha,
    ny: a.ny + (b.ny - a.ny) * alpha,
    bankAngle: a.bankAngle + (b.bankAngle - a.bankAngle) * alpha,
    curvature: a.curvature + (b.curvature - a.curvature) * alpha,
    width: a.width,
    isTunnel: a.isTunnel,
  };
}

export interface TrackProjection {
  sampleIndex: number;
  t: number;
  cumDist: number;
  lateralOffset: number; // signed offset along right vector
  distSq: number;
  sample: TrackSample;
}

/** Project a world XZ point onto the closest track spline sample (optional hintT prevents crossing-segment jumps). */
export function projectPointToTrack(
  track: BuiltTrack,
  x: number,
  z: number,
  hintT?: number,
): TrackProjection {
  const samples = track.samples;
  const n = samples.length;
  let bestIdx = 0;
  let bestDistSq = Infinity;

  if (hintT !== undefined) {
    const center = Math.floor(normalizeT(hintT) * n) % n;
    const window = 24;
    for (let offset = -window; offset <= window; offset++) {
      const idx = (center + offset + n) % n;
      const s = samples[idx];
      const dx = x - s.x;
      const dz = z - s.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }
  }

  // Fallback full scan if far from hint or no hint
  if (bestDistSq > 900) {
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      const dx = x - s.x;
      const dz = z - s.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
  }

  const s = samples[bestIdx];
  const dx = x - s.x;
  const dz = z - s.z;
  const lateralOffset = dx * s.rx + dz * s.rz;
  const along = dx * s.tx + dz * s.tz;
  const segLen = Math.max(0.5, track.arcLengths[bestIdx + 1] - track.arcLengths[bestIdx]);
  const refinedT = normalizeT((bestIdx + along / segLen) / n);
  const interpSample = sampleTrackAt(track, refinedT);

  return {
    sampleIndex: bestIdx,
    t: refinedT,
    cumDist: interpSample.cumDist,
    lateralOffset,
    distSq: bestDistSq,
    sample: interpSample,
  };
}

/** Query ground road elevation at any world (x, z) point for 4-wheel suspension contact. */
export function sampleTrackElevationAt(track: BuiltTrack, x: number, z: number, hintT?: number): {
  y: number;
  slope: number;
  bankAngle: number;
  lateralOffset: number;
} {
  const proj = projectPointToTrack(track, x, z, hintT);
  // Subtle banked corner height adjustment across road width
  const bankLift = Math.sin(proj.sample.bankAngle) * proj.lateralOffset * 0.25;
  return {
    y: proj.sample.y + bankLift,
    slope: proj.sample.slope,
    bankAngle: proj.sample.bankAngle,
    lateralOffset: proj.lateralOffset,
  };
}

/** Generate staggered starting grid positions behind the start line using exact arc-length distances. */
export function getSpawnGridTransform(
  track: BuiltTrack,
  slotIndex: number,
): { x: number; y: number; z: number; heading: number; trackT: number; lateralOffset: number } {
  const row = Math.floor(slotIndex / 2);
  const col = slotIndex % 2; // 0 = left, 1 = right
  const backMeters = 12 + row * 9.5;
  const s = sampleTrackByDistance(track, track.totalLength - backMeters);
  const lateralOffset = col === 0 ? -3.8 : 3.8;
  return {
    x: s.x + s.rx * lateralOffset,
    y: s.y,
    z: s.z + s.rz * lateralOffset,
    heading: Math.atan2(s.tx, s.tz),
    trackT: s.t,
    lateralOffset,
  };
}

/** Generate rows of 3D power-up pickup nodes evenly distributed by arc-length distance along the track. */
export function generateTrackPickups(track: BuiltTrack): TrackPickupNode[] {
  const nodes: TrackPickupNode[] = [];
  const rowCount = 16;
  let idCounter = 0;

  for (let r = 0; r < rowCount; r++) {
    // First row ~95m down the starting straight so combat starts cleanly off launch
    const dist = 95 + (r / rowCount) * (track.totalLength - 180);
    const s = sampleTrackByDistance(track, dist);
    const lanes = [-5.8, 0, 5.8];

    for (let l = 0; l < lanes.length; l++) {
      const lateral = lanes[l];
      const type: PowerUpType = POWERUP_TYPES[(r * 3 + l) % POWERUP_TYPES.length];
      nodes.push({
        id: `pu_${idCounter++}`,
        trackT: s.t,
        lateralOffset: lateral,
        x: s.x + s.rx * lateral,
        y: s.y + 1.55,
        z: s.z + s.rz * lateral,
        type,
        active: true,
        respawnTimer: 0,
      });
    }
  }
  return nodes;
}

/** Check whether motion segment (x0,z0)->(x1,z1) crossed checkpoint gate in the valid forward direction. */
function didCrossGateForward(
  gate: CheckpointGate,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): boolean {
  const d0 = (x0 - gate.x) * gate.tx + (z0 - gate.z) * gate.tz;
  const d1 = (x1 - gate.x) * gate.tx + (z1 - gate.z) * gate.tz;
  // Must transition from behind gate plane (<= 0) to ahead of gate plane (> 0)
  if (!(d0 <= 0.15 && d1 > 0)) return false;
  const span = d1 - d0;
  if (span <= 0.0001 || span > 140) return false; // reject teleports or stationary jitter
  const alpha = Math.max(0, Math.min(1, -d0 / span));
  const cx = x0 + (x1 - x0) * alpha;
  const cz = z0 + (z1 - z0) * alpha;
  const lateral = Math.abs((cx - gate.x) * gate.rx + (cz - gate.z) * gate.rz);
  return lateral <= gate.halfWidth + 4.5;
}

/**
 * Validate sequential checkpoint gates using swept crossing & direction checks (Stage 3 Sec 21).
 * Prevents reverse finish crossing, checkpoint skipping, teleport exploits, and recovery progress exploits.
 */
export function updateRacerCheckpoints(
  racer: RacerState,
  track: BuiltTrack,
  newT: number,
  totalLaps: number,
  raceTime: number,
): { lapCompleted: boolean; raceFinished: boolean } {
  if (racer.finished || racer.eliminated) {
    return { lapCompleted: false, raceFinished: false };
  }

  const cpCount = track.checkpointCount;
  const nextCp = racer.nextCheckpoint;
  const gate = track.checkpoints[nextCp];
  const newDist = tToDistance(track, newT);

  let crossedExpectedGate = false;

  // 1. Primary path: Swept geometric gate crossing when previous world position is available
  if (racer.prevX !== undefined && racer.prevZ !== undefined && gate) {
    const moveDist = Math.hypot(racer.x - racer.prevX, racer.z - racer.prevZ);
    // Reject implausible teleports (> 120m in a single step)
    if (moveDist > 0.01 && moveDist < 120) {
      crossedExpectedGate = didCrossGateForward(gate, racer.prevX, racer.prevZ, racer.x, racer.z);
    }
  } else if (gate) {
    // Fallback for unit-test direct parameter advancement (strictly sequential + no multi-skipping + not wrongWay)
    const distFromGate = forwardTrackDistance(track, gate.t, newT);
    const segLen = track.totalLength / cpCount;
    if (!racer.wrongWay && distFromGate >= 0 && distFromGate < segLen * 0.85) {
      crossedExpectedGate = true;
    }
  }

  let lapCompleted = false;
  let raceFinished = false;

  if (crossedExpectedGate) {
    const crossed = nextCp;
    // Crossing checkpoint 0 after completing all checkpoints finishes a lap!
    if (crossed === 0 && racer.passedCheckpoints >= cpCount) {
      const lapDuration = raceTime - racer.lapStartTime;
      if (lapDuration > 5 && (racer.bestLapTime === 0 || lapDuration < racer.bestLapTime)) {
        racer.bestLapTime = lapDuration;
      }
      racer.lapStartTime = raceTime;
      lapCompleted = true;

      if (racer.lap >= totalLaps) {
        racer.finished = true;
        racer.finishTime = raceTime;
        raceFinished = true;
      } else {
        racer.lap += 1;
      }
    }
    racer.passedCheckpoints += 1;
    racer.lastSafeTrackT = gate.t;
    racer.nextCheckpoint = (nextCp + 1) % cpCount;
  }

  // Compute monotonic distance-based totalProgress
  const segLen = track.totalLength / cpCount;
  const lastPassedGate = track.checkpoints[(racer.nextCheckpoint - 1 + cpCount) % cpCount];
  let intraMeters = newDist - lastPassedGate.cumDist;
  if (intraMeters < -track.totalLength * 0.5) intraMeters += track.totalLength;
  if (intraMeters > track.totalLength * 0.5) intraMeters -= track.totalLength;
  const clampedIntra = Math.max(-0.45, Math.min(1.15, intraMeters / segLen));

  if (racer.passedCheckpoints === 0 && newDist > track.totalLength * 0.8) {
    racer.totalProgress = (newDist - track.totalLength) / segLen;
  } else {
    racer.totalProgress = racer.passedCheckpoints + clampedIntra;
  }

  return { lapCompleted, raceFinished };
}

/** Sort racers by authoritative finish state, lap/checkpoint progress, and update 1-based positions. */
export function sortRaceStandings(racers: RacerState[]): RacerState[] {
  const sorted = [...racers].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.totalProgress - a.totalProgress;
  });
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].position = i + 1;
  }
  return sorted;
}

/** Forward signed arc-length track distance from tA to tB along loop (in meters). */
export function forwardTrackDistance(track: BuiltTrack, tA: number, tB: number): number {
  const dA = tToDistance(track, tA);
  const dB = tToDistance(track, tB);
  let delta = dB - dA;
  if (delta < 0) delta += track.totalLength;
  return delta;
}
