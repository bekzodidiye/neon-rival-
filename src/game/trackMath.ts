import type { PowerUpType, RacerState, TrackId, TrackPickupNode } from './types';
import { POWERUP_TYPES } from './powerups';

export interface Vec2 {
  x: number;
  z: number;
}

export interface TrackSample {
  t: number; // 0..1
  x: number;
  y: number;
  z: number;
  tx: number; // unit tangent x
  tz: number; // unit tangent z
  rx: number; // unit right x
  rz: number; // unit right z
  curvature: number; // signed turn sharpness
  width: number;
  isTunnel: boolean;
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
  totalLength: number;
  checkpointCount: number;
  minimapPath: Vec2[];
}

export const TRACK_DEFINITIONS: Record<TrackId, TrackDefinition> = {
  neon_city: {
    id: 'neon_city',
    name: 'NEON CITY',
    subtitle: 'Downtown Express Loop · 2.9 km',
    environmentTheme: 'neon_city',
    roadWidth: 22,
    defaultLaps: 3,
    // Sweeping closed urban circuit (~2.9 km total circumference) with long start straight,
    // fast sweeping right-hander, technical S-chicane, tunnel straight, and wide final hairpin.
    controlPoints: [
      { x: 0, z: 0, y: 0 },
      { x: 0, z: 240, y: 0 },
      { x: 55, z: 430, y: 0 },
      { x: 220, z: 520, y: 0 },
      { x: 420, z: 485, y: 0 },
      { x: 520, z: 330, y: 0 },
      { x: 445, z: 165, y: 0 },
      { x: 555, z: 10, y: 0 },
      { x: 525, z: -210, y: 0 },
      { x: 350, z: -345, y: 0 },
      { x: 140, z: -310, y: 0 },
      { x: 15, z: -200, y: 0 },
    ],
    tunnelRanges: [
      [0.44, 0.56],
      [0.78, 0.85],
    ],
    skyColor: 0x060a16,
    fogColor: 0x080e20,
    fogDensity: 0.0021,
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
      { x: 120, z: 390, y: 0 },
      { x: 340, z: 390, y: 0 },
      { x: 460, z: 260, y: 0 },
      { x: 430, z: 60, y: 0 },
      { x: 280, z: -35, y: 0 },
      { x: 390, z: -215, y: 0 },
      { x: 260, z: -340, y: 0 },
      { x: 60, z: -290, y: 0 },
      { x: -35, z: -150, y: 0 },
    ],
    tunnelRanges: [[0.25, 0.34]],
    skyColor: 0x090b12,
    fogColor: 0x10131e,
    fogDensity: 0.0023,
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
      { x: 0, z: 270, y: 0 },
      { x: -115, z: 440, y: 0 },
      { x: 40, z: 590, y: 0 },
      { x: 290, z: 540, y: 0 },
      { x: 430, z: 370, y: 0 },
      { x: 330, z: 185, y: 0 },
      { x: 460, z: -20, y: 0 },
      { x: 380, z: -240, y: 0 },
      { x: 170, z: -310, y: 0 },
      { x: 15, z: -210, y: 0 },
    ],
    tunnelRanges: [
      [0.14, 0.22],
      [0.62, 0.71],
    ],
    skyColor: 0x050814,
    fogColor: 0x0b0a1f,
    fogDensity: 0.0022,
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

/** Build a dense uniform-ish sampled closed racing circuit from control points. */
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
      y: catmullRom(p0.y ?? 0, p1.y ?? 0, p2.y ?? 0, p3.y ?? 0, localT),
      z: catmullRom(p0.z, p1.z, p2.z, p3.z, localT),
    });
  }

  let totalLength = 0;
  const samples: TrackSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const prev = rawPoints[(i - 1 + sampleCount) % sampleCount];
    const curr = rawPoints[i];
    const next = rawPoints[(i + 1) % sampleCount];

    const segDx = next.x - curr.x;
    const segDz = next.z - curr.z;
    totalLength += Math.hypot(segDx, segDz);

    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    // Right vector in Three.js XZ plane (where +Y is up, forward x up = right => (-tz, tx) or (tz, -tx)?)
    // Cross(tangent (tx,0,tz), up (0,1,0)) = (-tz, 0, tx). Let's verify:
    // If tangent = (0, 0, +1), cross((0,0,1), (0,1,0)) = (-1, 0, 0) which is -X (right when looking down +Z!).
    const rx = -tz;
    const rz = tx;

    // Signed curvature approximation
    const d1x = curr.x - prev.x;
    const d1z = curr.z - prev.z;
    const d2x = next.x - curr.x;
    const d2z = next.z - curr.z;
    const l1 = Math.hypot(d1x, d1z) || 1;
    const l2 = Math.hypot(d2x, d2z) || 1;
    const cross = (d1x / l1) * (d2z / l2) - (d1z / l1) * (d2x / l2);

    const t = i / sampleCount;
    const isTunnel = def.tunnelRanges.some(([a, b]) => t >= a && t <= b);

    samples.push({
      t,
      x: curr.x,
      y: curr.y,
      z: curr.z,
      tx,
      tz,
      rx,
      rz,
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

  return {
    def,
    samples,
    totalLength,
    checkpointCount: 12,
    minimapPath,
  };
}

export function normalizeT(t: number): number {
  let r = t % 1;
  if (r < 0) r += 1;
  return r;
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

  return {
    t,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    tx: ntx,
    tz: ntz,
    rx: -ntz,
    rz: ntx,
    curvature: a.curvature + (b.curvature - a.curvature) * alpha,
    width: a.width,
    isTunnel: a.isTunnel,
  };
}

export interface TrackProjection {
  sampleIndex: number;
  t: number;
  lateralOffset: number; // signed offset along right vector
  distSq: number;
  sample: TrackSample;
}

/** Project a world XZ point onto the closest track spline sample (optional hintT speeds up search). */
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
    const window = 28;
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
  const stepLen = track.totalLength / n;
  const refinedT = normalizeT((bestIdx + along / Math.max(1, stepLen)) / n);

  return {
    sampleIndex: bestIdx,
    t: refinedT,
    lateralOffset,
    distSq: bestDistSq,
    sample: s,
  };
}

/** Generate staggered starting grid positions behind the start line (facing forward down +tangent). */
export function getSpawnGridTransform(
  track: BuiltTrack,
  slotIndex: number,
): { x: number; y: number; z: number; heading: number; trackT: number; lateralOffset: number } {
  const row = Math.floor(slotIndex / 2);
  const col = slotIndex % 2; // 0 = left, 1 = right
  const backMeters = 10 + row * 9.5;
  const t = normalizeT(1 - backMeters / track.totalLength);
  const s = sampleTrackAt(track, t);
  const lateralOffset = col === 0 ? -3.8 : 3.8;
  return {
    x: s.x + s.rx * lateralOffset,
    y: s.y,
    z: s.z + s.rz * lateralOffset,
    heading: Math.atan2(s.tx, s.tz),
    trackT: t,
    lateralOffset,
  };
}

/** Generate rows of 3D power-up pickup nodes evenly distributed along the track. */
export function generateTrackPickups(track: BuiltTrack): TrackPickupNode[] {
  const nodes: TrackPickupNode[] = [];
  const rowCount = 16;
  let idCounter = 0;

  for (let r = 0; r < rowCount; r++) {
    // First row right down the starting straight so combat starts within 2.5 seconds like Blur!
    const t = 0.032 + (r / rowCount) * 0.91;
    const s = sampleTrackAt(track, t);
    const lanes = [-5.8, 0, 5.8];

    for (let l = 0; l < lanes.length; l++) {
      const lateral = lanes[l];
      const type: PowerUpType = POWERUP_TYPES[(r * 3 + l) % POWERUP_TYPES.length];
      nodes.push({
        id: `pu_${idCounter++}`,
        trackT: t,
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

/**
 * Update strict sequential checkpoints and lap counting so shortcutting or reverse-crossing
 * cannot fake laps. Returns { lapCompleted, raceFinished }.
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
  const currentCp = Math.floor(newT * cpCount) % cpCount;

  // Check if racer entered expected nextCheckpoint (allow skipping 1 adjacent index on fast frame)
  const nextCp = racer.nextCheckpoint;
  const nextPlusOne = (nextCp + 1) % cpCount;

  let lapCompleted = false;
  let raceFinished = false;

  if (currentCp === nextCp || currentCp === nextPlusOne) {
    const advanced = currentCp === nextPlusOne ? 2 : 1;
    for (let step = 0; step < advanced; step++) {
      const crossed = (racer.nextCheckpoint + step) % cpCount;
      // Crossing checkpoint 0 after completing all checkpoints finishes a lap!
      if (crossed === 0 && racer.passedCheckpoints >= cpCount - 1) {
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
    }
    racer.nextCheckpoint = (currentCp + 1) % cpCount;
  }

  // Compute monotonic totalProgress:
  // Use completed checkpoints + fractional progress within current checkpoint segment.
  const segmentSize = 1 / cpCount;
  const expectedCpStartT = ((racer.nextCheckpoint - 1 + cpCount) % cpCount) * segmentSize;
  let intra = newT - expectedCpStartT;
  if (intra < -0.5) intra += 1;
  if (intra > 0.5) intra -= 1;
  const clampedIntra = Math.max(-0.5, Math.min(1.5, intra / segmentSize));

  // Before crossing checkpoint 0 for the first time (starting behind start line at t ~ 0.98)
  if (racer.passedCheckpoints === 0 && newT > 0.8) {
    racer.totalProgress = newT - 1;
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

/** Forward signed track distance from tA to tB along loop (in meters). */
export function forwardTrackDistance(track: BuiltTrack, tA: number, tB: number): number {
  let dt = normalizeT(tB) - normalizeT(tA);
  if (dt < 0) dt += 1;
  return dt * track.totalLength;
}
