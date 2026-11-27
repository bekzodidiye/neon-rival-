import type { GameModeId, PowerUpType, TrackId } from '../../src/game/types';
import { VEHICLES } from '../../src/game/vehicles';
import {
  VALID_GAME_MODES,
  VALID_POWERUP_TYPES,
  VALID_TRACK_IDS,
  type CreateRoomPayload,
  type JoinRoomPayload,
  type PlayerInputPayload,
} from './messages';

const POWERUP_SET = new Set<string>(VALID_POWERUP_TYPES);
const TRACK_SET = new Set<string>(VALID_TRACK_IDS);
const MODE_SET = new Set<string>(VALID_GAME_MODES);
const VEHICLE_SET = new Set<string>(VEHICLES.map((v) => v.id));

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function sanitizeDisplayName(raw: unknown, fallback = 'DRIVER'): string {
  const cleaned = String(raw ?? '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .slice(0, 18);
  return cleaned.length >= 2 ? cleaned : fallback;
}

/**
 * Strictly validates a PowerUpType string.
 * V6.0 Sec 18: Unknown power-up names MUST be rejected (return null), never coerced to BOLT.
 */
export function validatePowerUpType(raw: unknown): PowerUpType | null {
  if (typeof raw !== 'string') return null;
  return POWERUP_SET.has(raw) ? (raw as PowerUpType) : null;
}

export function validateVehicleId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return VEHICLE_SET.has(raw) ? raw : null;
}

export function validateTrackId(raw: unknown): TrackId | null {
  if (typeof raw !== 'string') return null;
  return TRACK_SET.has(raw) ? (raw as TrackId) : null;
}

export function validateGameMode(raw: unknown): GameModeId | null {
  if (typeof raw !== 'string') return null;
  return MODE_SET.has(raw) ? (raw as GameModeId) : null;
}

/**
 * Validates and clamps a client PlayerInputMessage payload.
 * Rejects non-finite numbers, negative/out-of-order sequences, or malformed structures.
 */
export function validatePlayerInput(
  raw: Record<string, unknown>,
  lastSeq: number,
): { ok: true; input: PlayerInputPayload } | { ok: false; reason: string } {
  const seq = raw.sequence;
  const throttle = raw.throttle;
  const brake = raw.brake;
  const steering = raw.steering;

  if (!isFiniteNumber(seq) || !Number.isInteger(seq) || seq <= lastSeq || seq > lastSeq + 10000) {
    return { ok: false, reason: 'Invalid or stale input sequence.' };
  }
  if (!isFiniteNumber(throttle) || !isFiniteNumber(brake) || !isFiniteNumber(steering)) {
    return { ok: false, reason: 'Non-finite control axis value.' };
  }

  let selectSlot = -1;
  if (raw.selectSlot !== undefined) {
    if (!isFiniteNumber(raw.selectSlot) || !Number.isInteger(raw.selectSlot)) {
      return { ok: false, reason: 'Invalid selectSlot value.' };
    }
    if (raw.selectSlot >= 0 && raw.selectSlot <= 2) {
      selectSlot = raw.selectSlot;
    } else if (raw.selectSlot !== -1) {
      return { ok: false, reason: 'selectSlot out of range [-1, 2].' };
    }
  }

  return {
    ok: true,
    input: {
      sequence: seq,
      throttle: Math.max(0, Math.min(1, throttle)),
      brake: Math.max(0, Math.min(1, brake)),
      steering: Math.max(-1, Math.min(1, steering)),
      drift: Boolean(raw.drift),
      firePowerUp: Boolean(raw.firePowerUp),
      rearFire: Boolean(raw.rearFire),
      cycleSlot: Boolean(raw.cycleSlot),
      discardSlot: Boolean(raw.discardSlot),
      selectSlot,
      recover: Boolean(raw.recover),
    },
  };
}

export function validateCreateRoomPayload(
  raw: Record<string, unknown>,
): { ok: true; payload: CreateRoomPayload } | { ok: false; reason: string } {
  const trackId = validateTrackId(raw.trackId ?? 'neon_city');
  if (!trackId) return { ok: false, reason: 'Unknown trackId.' };

  const mode = validateGameMode(raw.mode ?? 'combat_race');
  if (!mode) return { ok: false, reason: 'Unknown mode.' };

  const vehicleId = validateVehicleId(raw.vehicleId ?? 'street_falcon');
  if (!vehicleId) return { ok: false, reason: 'Unknown vehicleId.' };

  const lapsNum = raw.laps === undefined ? 3 : Number(raw.laps);
  if (!isFiniteNumber(lapsNum) || lapsNum < 1 || lapsNum > 5) {
    return { ok: false, reason: 'Laps must be an integer between 1 and 5.' };
  }

  return {
    ok: true,
    payload: {
      name: sanitizeDisplayName(raw.name, 'DRIVER'),
      vehicleId,
      customization:
        raw.customization && typeof raw.customization === 'object'
          ? (raw.customization as Record<string, unknown>)
          : undefined,
      trackId,
      mode,
      laps: Math.round(lapsNum),
      fillWithAi: raw.fillWithAi === undefined ? true : Boolean(raw.fillWithAi),
    },
  };
}

export function validateJoinRoomPayload(
  raw: Record<string, unknown>,
): { ok: true; payload: JoinRoomPayload } | { ok: false; reason: string } {
  const vehicleId = validateVehicleId(raw.vehicleId ?? 'street_falcon');
  if (!vehicleId) return { ok: false, reason: 'Unknown vehicleId.' };

  const code = raw.code !== undefined ? String(raw.code).trim().toUpperCase().slice(0, 8) : undefined;
  return {
    ok: true,
    payload: {
      code,
      name: sanitizeDisplayName(raw.name, 'DRIVER'),
      vehicleId,
      customization:
        raw.customization && typeof raw.customization === 'object'
          ? (raw.customization as Record<string, unknown>)
          : undefined,
    },
  };
}
