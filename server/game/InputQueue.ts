import type { ControlInput } from '../../src/game/types';
import type { PlayerInputPayload } from '../../shared/protocol/messages';
import { createIdleControlInput } from '../../shared/simulation/RaceSimulation';

interface PlayerQueueSlot {
  lastSequence: number;
  lastReceivedAt: number;
  continuous: {
    throttle: number;
    brake: number;
    steering: number;
    drift: boolean;
    rearFire: boolean;
  };
  pendingOneShots: {
    firePowerUp: boolean;
    cycleSlot: boolean;
    discardSlot: boolean;
    selectSlot: number;
    recover: boolean;
  };
}

/**
 * Per-player validated input queue with sequence tracking, one-shot action latching,
 * and automatic stale-input timeout decay (V6.0 Section 16).
 */
export class InputQueue {
  private readonly slots = new Map<string, PlayerQueueSlot>();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 500) {
    this.timeoutMs = timeoutMs;
  }

  public registerPlayer(playerId: string): void {
    this.slots.set(playerId, {
      lastSequence: 0,
      lastReceivedAt: Date.now(),
      continuous: { throttle: 0, brake: 0, steering: 0, drift: false, rearFire: false },
      pendingOneShots: {
        firePowerUp: false,
        cycleSlot: false,
        discardSlot: false,
        selectSlot: -1,
        recover: false,
      },
    });
  }

  public removePlayer(playerId: string): void {
    this.slots.delete(playerId);
  }

  public getLastSequence(playerId: string): number {
    return this.slots.get(playerId)?.lastSequence ?? 0;
  }

  public enqueue(playerId: string, payload: PlayerInputPayload, nowMs = Date.now()): void {
    let slot = this.slots.get(playerId);
    if (!slot) {
      this.registerPlayer(playerId);
      slot = this.slots.get(playerId)!;
    }
    if (payload.sequence <= slot.lastSequence) return;

    slot.lastSequence = payload.sequence;
    slot.lastReceivedAt = nowMs;
    slot.continuous.throttle = payload.throttle;
    slot.continuous.brake = payload.brake;
    slot.continuous.steering = payload.steering;
    slot.continuous.drift = payload.drift;
    slot.continuous.rearFire = payload.rearFire;

    // Latch discrete one-shot actions until consumed by the next simulation tick
    if (payload.firePowerUp) slot.pendingOneShots.firePowerUp = true;
    if (payload.cycleSlot) slot.pendingOneShots.cycleSlot = true;
    if (payload.discardSlot) slot.pendingOneShots.discardSlot = true;
    if (payload.selectSlot >= 0 && payload.selectSlot <= 2) {
      slot.pendingOneShots.selectSlot = payload.selectSlot;
    }
    if (payload.recover) slot.pendingOneShots.recover = true;
  }

  public consumeTickInputs(nowMs = Date.now()): {
    inputs: Map<string, ControlInput>;
    sequences: Map<string, number>;
  } {
    const inputs = new Map<string, ControlInput>();
    const sequences = new Map<string, number>();

    for (const [playerId, slot] of this.slots.entries()) {
      const stale = nowMs - slot.lastReceivedAt > this.timeoutMs;
      const ctrl: ControlInput = stale
        ? createIdleControlInput()
        : {
            throttle: slot.continuous.throttle,
            brake: slot.continuous.brake,
            steer: slot.continuous.steering,
            drift: slot.continuous.drift,
            useNitro: false,
            usePowerUp: slot.pendingOneShots.firePowerUp,
            cycleSlot: slot.pendingOneShots.cycleSlot,
            discardSlot: slot.pendingOneShots.discardSlot,
            selectSlot: slot.pendingOneShots.selectSlot,
            rearView: false,
            rearFire: slot.continuous.rearFire,
            recover: slot.pendingOneShots.recover,
          };

      // Reset consumed one-shot latches
      slot.pendingOneShots.firePowerUp = false;
      slot.pendingOneShots.cycleSlot = false;
      slot.pendingOneShots.discardSlot = false;
      slot.pendingOneShots.selectSlot = -1;
      slot.pendingOneShots.recover = false;

      inputs.set(playerId, ctrl);
      sequences.set(playerId, slot.lastSequence);
    }

    return { inputs, sequences };
  }
}
