import crypto from 'crypto';
import type { Difficulty, GameModeId, TrackId } from '../../src/game/types';
import type {
  AuthoritativeMatchResult,
  AuthoritativeWorldSnapshot,
  VerifiedMatchStanding,
} from '../../shared/protocol/messages';
import { RaceSimulation, type SimParticipantConfig } from '../../shared/simulation/RaceSimulation';
import { InputQueue } from './InputQueue';

export interface AuthoritativeRaceOptions {
  roomCode: string;
  trackId: TrackId;
  mode: GameModeId;
  laps: number;
  difficulty: Difficulty;
  participants: SimParticipantConfig[];
  simHz?: number; // default 60 Hz internal simulation
  snapshotHz?: number; // default 20 Hz snapshot publish rate
  countdownSeconds?: number;
  seed?: number;
  onSnapshot: (snapshot: AuthoritativeWorldSnapshot) => void;
  onFinished: (result: AuthoritativeMatchResult) => void;
}

export interface ServerTickStats {
  ticks: number;
  avgTickMs: number;
  maxTickMs: number;
  lastSnapshotBytes: number;
}

function computeVerifiedRewards(position: number, hitsLanded: number, takedowns: number, blocksLanded: number): {
  credits: number;
  xp: number;
  fans: number;
} {
  const pos = Math.max(1, Math.min(8, position));
  const positionTable = [1800, 1300, 950, 700, 520, 400, 320, 260];
  const baseCredits = positionTable[pos - 1] ?? 260;
  return {
    credits: Math.round(baseCredits + hitsLanded * 45 + takedowns * 220 + blocksLanded * 60),
    xp: Math.round(260 + (9 - pos) * 55 + hitsLanded * 20 + takedowns * 90),
    fans: Math.round(180 + (9 - pos) * 65 + hitsLanded * 35 + takedowns * 140 + blocksLanded * 50),
  };
}

/**
 * Authoritative server-side race runner (V6.0 Sections 15, 16, 18, 19).
 * Owns the server-generated matchId, fixed-timestep simulation loop, input queue,
 * snapshot publishing cadence, and authoritative finish/reward computation.
 */
export class AuthoritativeRace {
  public readonly matchId: string;
  public readonly roomCode: string;
  public readonly startedAt: string;
  public readonly simulation: RaceSimulation;
  public readonly inputQueue: InputQueue;

  private readonly simHz: number;
  private readonly snapshotIntervalTicks: number;
  private readonly onSnapshot: (snapshot: AuthoritativeWorldSnapshot) => void;
  private readonly onFinished: (result: AuthoritativeMatchResult) => void;

  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private finishedEmitted = false;
  private finishGraceTimer = 0;

  private totalTickMs = 0;
  private maxTickMs = 0;
  private lastSnapshotBytes = 0;

  constructor(options: AuthoritativeRaceOptions) {
    this.matchId = `match_${crypto.randomBytes(8).toString('hex')}`;
    this.roomCode = options.roomCode;
    this.startedAt = new Date().toISOString();
    this.simHz = Math.max(20, Math.min(60, options.simHz ?? 60));
    const snapHz = Math.max(5, Math.min(this.simHz, options.snapshotHz ?? 20));
    this.snapshotIntervalTicks = Math.max(1, Math.round(this.simHz / snapHz));
    this.onSnapshot = options.onSnapshot;
    this.onFinished = options.onFinished;

    this.inputQueue = new InputQueue(650);
    for (const p of options.participants) {
      if (!p.isAi) this.inputQueue.registerPlayer(p.id);
    }

    this.simulation = new RaceSimulation({
      matchId: this.matchId,
      trackId: options.trackId,
      mode: options.mode,
      laps: options.laps,
      difficulty: options.difficulty,
      participants: options.participants,
      countdownSeconds: options.countdownSeconds ?? 2.2,
      seed: options.seed,
    });
  }

  public start(): void {
    if (this.timer || this.stopped) return;
    const stepMs = Math.round(1000 / this.simHz);
    const dt = 1 / this.simHz;

    // Emit initial snapshot immediately so clients sync grid & countdown right away
    this.publishSnapshot();

    this.timer = setInterval(() => {
      this.stepOnce(dt);
    }, stepMs);
  }

  /**
   * Executes one deterministic authoritative server tick. Exposed publicly so tests can also drive ticks directly.
   */
  public stepOnce(dt = 1 / this.simHz): void {
    if (this.stopped || this.finishedEmitted) return;
    const t0 = performance.now();

    const { inputs, sequences } = this.inputQueue.consumeTickInputs();
    for (const [pid, seq] of sequences.entries()) {
      this.simulation.lastProcessedSeq.set(pid, seq);
    }

    this.simulation.step(dt, inputs);

    // If all human players finished (or 1st human finished + 15s grace elapsed), finalize match cleanly
    const humanRacers = this.simulation.racers.filter((r) => r.isPlayer && !r.eliminated);
    const anyHumanFinished = humanRacers.some((r) => r.finished);
    const allHumansFinished = humanRacers.length > 0 && humanRacers.every((r) => r.finished);
    if (anyHumanFinished && !allHumansFinished) {
      this.finishGraceTimer += dt;
    }

    const elapsedMs = performance.now() - t0;
    this.totalTickMs += elapsedMs;
    if (elapsedMs > this.maxTickMs) this.maxTickMs = elapsedMs;

    if (
      this.simulation.phase === 'finished' ||
      allHumansFinished ||
      this.finishGraceTimer >= 15
    ) {
      this.simulation.phase = 'finished';
      this.publishSnapshot();
      this.finalizeMatch();
      return;
    }

    if (this.simulation.tick % this.snapshotIntervalTicks === 0) {
      this.publishSnapshot();
    }
  }

  private publishSnapshot(): void {
    const snap = this.simulation.createSnapshot(Date.now());
    this.lastSnapshotBytes = Buffer.byteLength(JSON.stringify(snap), 'utf8');
    this.onSnapshot(snap);
  }

  private finalizeMatch(): void {
    if (this.finishedEmitted) return;
    this.finishedEmitted = true;
    this.stop();

    const standings: VerifiedMatchStanding[] = this.simulation.racers
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((r) => {
        const userId = this.simulation.participantUserIds.get(r.id) ?? null;
        const verified = Boolean(userId && r.isPlayer);
        const rew = verified
          ? computeVerifiedRewards(r.position, r.hitsLanded, r.takedowns, r.blocksLanded)
          : { credits: 0, xp: 0, fans: 0 };

        return {
          playerId: r.id,
          userId,
          username: r.name,
          vehicleId: r.vehicleId,
          isAi: !r.isPlayer,
          position: r.position,
          finishTime: r.finished ? r.finishTime : this.simulation.raceTime,
          hitsLanded: r.hitsLanded,
          takedowns: r.takedowns,
          blocksLanded: r.blocksLanded,
          raceFans: r.raceFans ?? 0,
          rewardCredits: rew.credits,
          rewardXp: rew.xp,
          rewardFans: rew.fans,
          verified,
        };
      });

    const result: AuthoritativeMatchResult = {
      matchId: this.matchId,
      roomCode: this.roomCode,
      trackId: this.simulation.trackId,
      mode: this.simulation.mode,
      laps: this.simulation.totalLaps,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      standings,
    };
    this.onFinished(result);
  }

  public getTickStats(): ServerTickStats {
    const ticks = Math.max(1, this.simulation.tick);
    return {
      ticks: this.simulation.tick,
      avgTickMs: Number((this.totalTickMs / ticks).toFixed(3)),
      maxTickMs: Number(this.maxTickMs.toFixed(3)),
      lastSnapshotBytes: this.lastSnapshotBytes,
    };
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
