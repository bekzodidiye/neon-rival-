import * as THREE from 'three';
import type { TrackId } from '../game/types';

export type LightingTimeOfDay = 'night' | 'sunset' | 'day';

export interface LightingProfile {
  id: LightingTimeOfDay;
  label: string;
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  keyOffset: [number, number, number];
  exposure: number;
  envIntensity: number;
  bloomStrength: number;
  bloomThreshold: number;
  envCeilingColor: number;
  envHorizonPrimary: number;
  envHorizonSecondary: number;
  envHorizonWarm: number;
}

/**
 * Distinct Blur-inspired realistic daytime, golden sunset, and metropolitan night lighting rigs.
 * Balances metallic vehicle reflections, readable urban architecture, warm street accents,
 * and controlled bloom without crushing shadow detail or washing out asphalt.
 */
export const LIGHTING_PROFILES: Record<LightingTimeOfDay, LightingProfile> = {
  night: {
    id: 'night',
    label: 'MIDNIGHT METRO',
    skyColor: 0x070d1c,
    fogColor: 0x091124,
    fogDensity: 0.00175,
    hemiSkyColor: 0x5a7ec8,
    hemiGroundColor: 0x1b2234,
    hemiIntensity: 0.72,
    keyColor: 0xd8e6ff,
    keyIntensity: 1.2,
    keyOffset: [88, 58, -52],
    exposure: 1.06,
    envIntensity: 0.9,
    bloomStrength: 0.56,
    bloomThreshold: 0.74,
    envCeilingColor: 0x1b2b58,
    envHorizonPrimary: 0x00c8ff,
    envHorizonSecondary: 0x3b82f6,
    envHorizonWarm: 0xff9b42,
  },
  sunset: {
    id: 'sunset',
    label: 'GOLDEN DUSK',
    skyColor: 0x1d1b30,
    fogColor: 0x2b2038,
    fogDensity: 0.00155,
    hemiSkyColor: 0xf4a261,
    hemiGroundColor: 0x252036,
    hemiIntensity: 0.88,
    keyColor: 0xffb36b,
    keyIntensity: 1.65,
    keyOffset: [110, 34, -70],
    exposure: 1.08,
    envIntensity: 0.95,
    bloomStrength: 0.46,
    bloomThreshold: 0.78,
    envCeilingColor: 0x3b2c52,
    envHorizonPrimary: 0xff8c42,
    envHorizonSecondary: 0x6366f1,
    envHorizonWarm: 0xffd166,
  },
  day: {
    id: 'day',
    label: 'OVERCAST DAYLIGHT',
    skyColor: 0x6c8db5,
    fogColor: 0x7b98bc,
    fogDensity: 0.0011,
    hemiSkyColor: 0xc8def5,
    hemiGroundColor: 0x3b4252,
    hemiIntensity: 1.05,
    keyColor: 0xfff5e4,
    keyIntensity: 1.95,
    keyOffset: [75, 96, -45],
    exposure: 1.0,
    envIntensity: 0.85,
    bloomStrength: 0.28,
    bloomThreshold: 0.86,
    envCeilingColor: 0x8fb2d9,
    envHorizonPrimary: 0xdbeafe,
    envHorizonSecondary: 0x94a3b8,
    envHorizonWarm: 0xfef3c7,
  },
};

export function getLightingForTrack(trackId: TrackId): LightingProfile {
  if (trackId === 'industrial_port') return LIGHTING_PROFILES.day;
  if (trackId === 'midnight_streets') return LIGHTING_PROFILES.sunset;
  return LIGHTING_PROFILES.night;
}

/**
 * Generates a matching procedural PMREM reflection scene for the given lighting profile
 * so metallic car bodies and glass reflect the real sky & horizon strip palette.
 */
export function createEnvironmentSceneForProfile(profile: LightingProfile): THREE.Scene {
  const env = new THREE.Scene();
  env.background = new THREE.Color(profile.skyColor);

  const shellGeo = new THREE.BoxGeometry(30, 18, 30);
  const shellMat = new THREE.MeshBasicMaterial({ color: profile.fogColor, side: THREE.BackSide });
  env.add(new THREE.Mesh(shellGeo, shellMat));

  const strips: { pos: [number, number, number]; size: [number, number, number]; color: number }[] = [
    { pos: [0, 8.6, 0], size: [18, 0.2, 18], color: profile.envCeilingColor },
    { pos: [-14.2, 1.9, 0], size: [0.3, 2.2, 22], color: profile.envHorizonPrimary },
    { pos: [14.2, 1.9, 0], size: [0.3, 2.2, 22], color: profile.envHorizonSecondary },
    { pos: [0, 2.5, 14.2], size: [22, 1.8, 0.3], color: profile.envHorizonSecondary },
    { pos: [0, 2.0, -14.2], size: [20, 1.8, 0.3], color: profile.envHorizonWarm },
  ];
  for (const s of strips) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(s.size[0], s.size[1], s.size[2]),
      new THREE.MeshBasicMaterial({ color: s.color }),
    );
    m.position.set(s.pos[0], s.pos[1], s.pos[2]);
    env.add(m);
  }
  return env;
}
