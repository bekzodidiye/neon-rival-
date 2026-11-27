import type { MineState, ProjectileState, RacerState } from './types';

export const COMBAT_RULES = {
  SHUNT_INITIAL_HEALTH: 2, // 1st Bolt weakens Shunt, 2nd Bolt destroys it (V3.0 Sec 23 & 30)
  SHIELD_CAPACITY: 60, // Depleted by incoming damage; Shock immediately depletes Shield
  COMBO_WINDOW_SEC: 4.8,
  COMBO_MAX_CHAIN: 10, // Research-inspired 10-move max chain (V3.0 Sec 50)
  AIRBRAKE_SPEED_MULT: 0.48,
  AIRBRAKE_EXIT_DELAY: 0.52, // Seconds until controlled corner-exit surge kicks in
};

export interface BoltVsShuntResult {
  weakened: boolean;
  destroyed: boolean;
  remainingHealth: number;
}

/**
 * Resolve Bolt hitting an active Shunt projectile:
 * - 1st Bolt hit weakens the Shunt (health 2 -> 1, slows projectile)
 * - 2nd Bolt hit destroys the weakened Shunt completely.
 */
export function resolveBoltVsShunt(shunt: ProjectileState): BoltVsShuntResult {
  const hp = (shunt.health ?? COMBAT_RULES.SHUNT_INITIAL_HEALTH) - 1;
  shunt.health = Math.max(0, hp);
  if (shunt.health <= 0) {
    shunt.life = 0;
    return { weakened: false, destroyed: true, remainingHealth: 0 };
  }
  shunt.speed *= 0.72;
  shunt.vx *= 0.72;
  shunt.vz *= 0.72;
  return { weakened: true, destroyed: false, remainingHealth: shunt.health };
}

export interface BargeInterceptionResult {
  destroyedProjectiles: { x: number; y: number; z: number; type: 'SHUNT' | 'BOLT' }[];
  destroyedMines: { x: number; y: number; z: number }[];
}

/**
 * Resolve Barge radial pulse against nearby enemy Shunts, Bolts, and armed/unarmed Mines (V3.0 Sec 24 & 30).
 */
export function resolveBargeInterceptions(
  ownerId: string,
  originX: number,
  originZ: number,
  radius: number,
  projectiles: ProjectileState[],
  mines: MineState[],
): BargeInterceptionResult {
  const destroyedProjectiles: { x: number; y: number; z: number; type: 'SHUNT' | 'BOLT' }[] = [];
  const destroyedMines: { x: number; y: number; z: number }[] = [];
  const rSq = radius * radius;

  for (const proj of projectiles) {
    if (proj.ownerId === ownerId || proj.life <= 0) continue;
    const dx = proj.x - originX;
    const dz = proj.z - originZ;
    if (dx * dx + dz * dz <= rSq) {
      proj.life = 0;
      destroyedProjectiles.push({ x: proj.x, y: proj.y, z: proj.z, type: proj.type });
    }
  }

  for (const mine of mines) {
    if (mine.life <= 0) continue;
    const dx = mine.x - originX;
    const dz = mine.z - originZ;
    if (dx * dx + dz * dz <= rSq) {
      mine.life = 0;
      destroyedMines.push({ x: mine.x, y: mine.y, z: mine.z });
    }
  }

  return { destroyedProjectiles, destroyedMines };
}

/**
 * Resolve Shock dome collision against Shield (V3.0 Sec 26 & 30):
 * A standard Shield absorbs a Shock dome impact (zero damage, zero slow) but is immediately depleted by it.
 */
export function resolveShockVsShield(racer: RacerState): boolean {
  if (racer.shieldTimer > 0) {
    racer.shieldTimer = 0;
    racer.shieldHp = 0;
    racer.blocksLanded += 1;
    racer.hitFlashTimer = 0.14;
    return true;
  }
  return false;
}

/**
 * Resolve Shield absorption with capacity depletion (V3.0 Sec 27):
 * Blocks incoming damage and reduces remaining shield capacity; expires early if capacity reaches 0.
 */
export function resolveShieldAbsorption(racer: RacerState, incomingDamage: number): {
  blocked: boolean;
  shieldBroken: boolean;
} {
  if (racer.shieldTimer <= 0) {
    return { blocked: false, shieldBroken: false };
  }
  racer.blocksLanded += 1;
  racer.hitFlashTimer = 0.12;
  const currentCap = racer.shieldHp ?? COMBAT_RULES.SHIELD_CAPACITY;
  const nextCap = Math.max(0, currentCap - Math.max(10, incomingDamage));
  racer.shieldHp = nextCap;
  if (nextCap <= 0) {
    racer.shieldTimer = 0;
    return { blocked: true, shieldBroken: true };
  }
  return { blocked: true, shieldBroken: false };
}

/**
 * Resolve Blur 2-stage backward Nitro Air-Brake (V3.0 Sec 28):
 * Temporarily reduces forward speed for sharp corner rotation, then queues a controlled exit surge boost.
 */
export function resolveNitroAirBrake(racer: RacerState): void {
  racer.vx *= COMBAT_RULES.AIRBRAKE_SPEED_MULT;
  racer.vz *= COMBAT_RULES.AIRBRAKE_SPEED_MULT;
  racer.speed *= COMBAT_RULES.AIRBRAKE_SPEED_MULT;
  racer.airBrakeBoostTimer = COMBAT_RULES.AIRBRAKE_EXIT_DELAY;
}

export interface ComboAwardResult {
  awarded: number;
  comboCount: number;
  multiplier: number;
}

/**
 * Increment consecutive scoring combo chain (capped at 10 moves) and compute multiplied Fans reputation (V3.0 Sec 49-50).
 */
export function applyComboFans(racer: RacerState, baseFans: number): ComboAwardResult {
  const prevCount = (racer.comboTimer ?? 0) > 0 ? (racer.comboCount ?? 0) : 0;
  const nextCount = Math.min(COMBAT_RULES.COMBO_MAX_CHAIN, prevCount + 1);
  racer.comboCount = nextCount;
  racer.comboTimer = COMBAT_RULES.COMBO_WINDOW_SEC;

  const multiplier = Number((1 + (nextCount - 1) * 0.2).toFixed(1));
  const awarded = Math.round(baseFans * multiplier);
  racer.raceFans = (racer.raceFans ?? 0) + awarded;
  return { awarded, comboCount: nextCount, multiplier };
}
