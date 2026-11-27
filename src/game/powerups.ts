import type { PowerUpDefinition, PowerUpSlot, PowerUpType, RacerState } from './types';

export const POWERUP_TYPES: PowerUpType[] = [
  'SHUNT',
  'BOLT',
  'BARGE',
  'MINE',
  'SHOCK',
  'SHIELD',
  'NITRO',
  'REPAIR',
];

export const POWERUP_DEFS: Record<PowerUpType, PowerUpDefinition> = {
  SHUNT: {
    type: 'SHUNT',
    name: 'SHUNT',
    shortDesc: 'Homing Red Plasma · Rear Intercept',
    color: '#FF2A55',
    hexColor: 0xff2a55,
    maxAmmo: 1,
    damage: 28,
    supportsRearFire: true,
    category: 'offense',
  },
  BOLT: {
    type: 'BOLT',
    name: 'BOLT',
    shortDesc: '3x Rapid Pulse · Knock Off Line',
    color: '#FF8A00',
    hexColor: 0xff8a00,
    maxAmmo: 3,
    damage: 12,
    supportsRearFire: true,
    category: 'offense',
  },
  BARGE: {
    type: 'BARGE',
    name: 'BARGE',
    shortDesc: '360° Slam Wave · Shoves Rivals',
    color: '#B24BF3',
    hexColor: 0xb24bf3,
    maxAmmo: 1,
    damage: 20,
    supportsRearFire: false,
    category: 'offense',
  },
  MINE: {
    type: 'MINE',
    name: 'MINE',
    shortDesc: 'Rear Trap · Lob Forward · Blocks Shunt',
    color: '#FACC15',
    hexColor: 0xfacc15,
    maxAmmo: 1,
    damage: 28,
    supportsRearFire: true,
    category: 'offense',
  },
  SHOCK: {
    type: 'SHOCK',
    name: 'SHOCK',
    shortDesc: '3x Leader Lightning Domes · Drains Speed',
    color: '#3B82F6',
    hexColor: 0x3b82f6,
    maxAmmo: 1,
    damage: 18,
    supportsRearFire: false,
    category: 'offense',
  },
  SHIELD: {
    type: 'SHIELD',
    name: 'SHIELD',
    shortDesc: '4.5s Deflector Dome · Blocks All Hits',
    color: '#00D8FF',
    hexColor: 0x00d8ff,
    maxAmmo: 1,
    damage: 0,
    supportsRearFire: false,
    category: 'defense',
  },
  NITRO: {
    type: 'NITRO',
    name: 'NITRO',
    shortDesc: 'Surge +42% · Rear = Instant Air-Brake',
    color: '#25F4A0',
    hexColor: 0x25f4a0,
    maxAmmo: 1,
    damage: 0,
    supportsRearFire: true,
    category: 'boost',
  },
  REPAIR: {
    type: 'REPAIR',
    name: 'REPAIR',
    shortDesc: 'Instant Full Chassis Integrity Restore',
    color: '#22C55E',
    hexColor: 0x22c55e,
    maxAmmo: 1,
    damage: 0,
    supportsRearFire: false,
    category: 'utility',
  },
};

export const POWERUP_BALANCE = {
  SHUNT_DAMAGE: 28,
  SHUNT_SPEED: 112,
  SHUNT_LIFETIME: 8.5,
  BOLT_SHOTS: 3,
  BOLT_DAMAGE: 12,
  BOLT_INTERVAL: 0.18,
  BOLT_SPEED: 155,
  BOLT_LIFETIME: 3.2,
  BARGE_RADIUS: 11.5,
  BARGE_DAMAGE: 20,
  BARGE_IMPULSE: 30,
  MINE_DAMAGE: 28,
  MINE_ARM_DELAY: 0.35,
  MINE_TRIGGER_RADIUS: 3.4,
  MINE_LIFETIME: 22,
  SHOCK_COUNT: 3,
  SHOCK_DAMAGE: 18,
  SHOCK_SLOW_DURATION: 1.8,
  SHOCK_DURATION: 9.0,
  SHOCK_RADIUS: 4.5,
  SHIELD_DURATION: 4.5,
  NITRO_DURATION: 3.2,
  NITRO_ACCEL_MULT: 1.9,
  NITRO_SPEED_MULT: 1.42,
};

/** Try to add a collected power-up into the first empty slot of a 3-slot inventory. */
export function collectPowerUp(
  inventory: (PowerUpSlot | null)[],
  activeSlot: number,
  type: PowerUpType,
): { collected: boolean; newActiveSlot: number } {
  const emptyIdx = inventory.findIndex((s) => s === null);
  if (emptyIdx === -1) {
    return { collected: false, newActiveSlot: activeSlot };
  }
  inventory[emptyIdx] = {
    type,
    ammo: POWERUP_DEFS[type].maxAmmo,
  };
  const nextActive = inventory[activeSlot] === null ? emptyIdx : activeSlot;
  return { collected: true, newActiveSlot: nextActive };
}

/** Cycle to the next non-empty slot, or advance slot index by 1. */
export function cyclePowerUpSlot(
  inventory: (PowerUpSlot | null)[],
  activeSlot: number,
): number {
  for (let offset = 1; offset <= 3; offset++) {
    const idx = (activeSlot + offset) % 3;
    if (inventory[idx] !== null) return idx;
  }
  return (activeSlot + 1) % 3;
}

/** Discard the active slot and shift selection to another filled slot if available. */
export function discardPowerUpSlot(
  inventory: (PowerUpSlot | null)[],
  activeSlot: number,
): { discarded: boolean; newActiveSlot: number } {
  if (inventory[activeSlot] === null) {
    return { discarded: false, newActiveSlot: activeSlot };
  }
  inventory[activeSlot] = null;
  for (let i = 0; i < 3; i++) {
    if (inventory[i] !== null) return { discarded: true, newActiveSlot: i };
  }
  return { discarded: true, newActiveSlot: 0 };
}

/** Consume one charge from the active slot (supports 3-shot Bolt). */
export function consumeActivePowerUp(
  inventory: (PowerUpSlot | null)[],
  activeSlot: number,
): { firedType: PowerUpType | null; newActiveSlot: number } {
  const slot = inventory[activeSlot];
  if (!slot) {
    return { firedType: null, newActiveSlot: activeSlot };
  }
  const firedType = slot.type;
  slot.ammo -= 1;
  let newActiveSlot = activeSlot;
  if (slot.ammo <= 0) {
    inventory[activeSlot] = null;
    for (let i = 0; i < 3; i++) {
      if (inventory[i] !== null) {
        newActiveSlot = i;
        break;
      }
    }
  }
  return { firedType, newActiveSlot };
}

export interface DamageResult {
  appliedDamage: number;
  blockedByShield: boolean;
  destroyedNow: boolean;
}

/** Resolve incoming combat damage against Shield, Spawn Protection, and Racer HP. */
export function applyCombatDamage(
  target: RacerState,
  amount: number,
  attacker?: RacerState | null,
  knockbackX = 0,
  knockbackZ = 0,
  speedPenaltyRatio = 0,
): DamageResult {
  if (target.destroyed || target.spawnProtectTimer > 0) {
    return { appliedDamage: 0, blockedByShield: false, destroyedNow: false };
  }

  if (target.shieldTimer > 0) {
    target.blocksLanded += 1;
    target.hitFlashTimer = 0.12;
    return { appliedDamage: 0, blockedByShield: true, destroyedNow: false };
  }

  const dmg = Math.max(0, Math.round(amount));
  target.hp = Math.max(0, target.hp - dmg);
  target.hitFlashTimer = 0.14;
  target.vx += knockbackX;
  target.vz += knockbackZ;
  if (speedPenaltyRatio > 0) {
    target.speed *= Math.max(0.25, 1 - speedPenaltyRatio);
  }

  if (attacker && attacker.id !== target.id) {
    attacker.hitsLanded += 1;
    attacker.damageDealt += dmg;
  }

  let destroyedNow = false;
  if (target.hp <= 0) {
    target.destroyed = true;
    target.respawnTimer = 2.0;
    target.speed *= 0.2;
    target.stunTimer = 1.6;
    destroyedNow = true;
    if (attacker && attacker.id !== target.id) {
      attacker.takedowns += 1;
    }
  }

  return { appliedDamage: dmg, blockedByShield: false, destroyedNow };
}

/** Apply Repair power-up safely clamped to maxHp. */
export function applyRepairPowerUp(racer: RacerState): number {
  const healed = Math.max(0, racer.maxHp - racer.hp);
  racer.hp = racer.maxHp;
  racer.shockSlowTimer = 0;
  return healed;
}
