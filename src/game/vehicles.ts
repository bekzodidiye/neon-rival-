import type { VehicleConfig, VehicleCustomization } from './types';

export const PAINT_PRESETS = [
  { name: 'Cobalt Pulse', hex: '#00A8FF' },
  { name: 'Crimson Surge', hex: '#FF2A55' },
  { name: 'Hyper Violet', hex: '#7C3AED' },
  { name: 'Emerald Volt', hex: '#10D988' },
  { name: 'Solar Amber', hex: '#FF8A00' },
  { name: 'Arctic Silver', hex: '#DCE5F2' },
  { name: 'Obsidian Carbon', hex: '#181E2C' },
  { name: 'Laser Magenta', hex: '#E11D8F' },
];

export const UNDERGLOW_PRESETS = [
  { name: 'Electric Cyan', hex: '#00C8FF' },
  { name: 'Neon Purple', hex: '#8B5CF6' },
  { name: 'Acid Green', hex: '#25F4A0' },
  { name: 'Crimson Red', hex: '#FF365E' },
  { name: 'Gold Plasma', hex: '#FFB800' },
  { name: 'Ice White', hex: '#E8F6FF' },
];

export const RIM_PRESETS = [
  { name: 'Machined Alloy', hex: '#C8D4E6' },
  { name: 'Graphite Matte', hex: '#2B3242' },
  { name: 'Championship Gold', hex: '#E5B44B' },
  { name: 'Cyber Cyan', hex: '#00C8FF' },
  { name: 'Track Red', hex: '#FF365E' },
];

export const VEHICLES: VehicleConfig[] = [
  {
    id: 'street_falcon',
    name: 'STREET FALCON',
    subtitle: 'Balanced Street Sport Coupe',
    vehicleClass: 'D',
    archetype: 'coupe',
    handlingArchetype: 'balanced',
    price: 0,
    defaultCustomization: {
      bodyColor: '#00A8FF',
      finish: 'metallic',
      rimColor: '#C8D4E6',
      underglowColor: '#00C8FF',
      headlightColor: '#E6F8FF',
      nitroColor: '#00E5FF',
      spoiler: 'street',
      windowTint: 0.78,
    },
    stats: {
      topSpeed: 76, // ~274 km/h (360+ km/h on Nitro)
      acceleration: 39,
      braking: 52,
      handling: 2.5,
      grip: 9.8,
      driftControl: 0.88,
      durability: 120,
      maxHealthBlocks: 6,
      nitroEfficiency: 1.0,
      weight: 1380,
    },
    ratings: {
      speed: 76,
      acceleration: 80,
      handling: 85,
      grip: 84,
      drift: 86,
      durability: 76,
      nitro: 80,
    },
  },
  {
    id: 'sand_runner',
    name: 'SAND RUNNER',
    subtitle: 'All-Terrain Off-Road Rally Raid',
    vehicleClass: 'D',
    archetype: 'muscle',
    handlingArchetype: 'offroad',
    price: 1500,
    defaultCustomization: {
      bodyColor: '#FF8A00',
      finish: 'matte',
      rimColor: '#2B3242',
      underglowColor: '#FFB800',
      headlightColor: '#FFF3D6',
      nitroColor: '#25F4A0',
      spoiler: 'none',
      windowTint: 0.74,
    },
    stats: {
      topSpeed: 74, // ~266 km/h, unbeatable stability on rough shoulders & curbs
      acceleration: 41,
      braking: 50,
      handling: 2.42,
      grip: 9.5,
      driftControl: 0.9,
      durability: 140,
      maxHealthBlocks: 7,
      nitroEfficiency: 1.04,
      weight: 1580,
    },
    ratings: {
      speed: 74,
      acceleration: 83,
      handling: 82,
      grip: 86,
      drift: 84,
      durability: 88,
      nitro: 82,
    },
  },
  {
    id: 'night_viper',
    name: 'NIGHT VIPER',
    subtitle: 'Heavy High-Torque Muscle Interceptor',
    vehicleClass: 'C',
    archetype: 'muscle',
    handlingArchetype: 'drifty',
    price: 2500,
    defaultCustomization: {
      bodyColor: '#FF2A55',
      finish: 'metallic',
      rimColor: '#2B3242',
      underglowColor: '#FF365E',
      headlightColor: '#FFF3D6',
      nitroColor: '#FF5E3A',
      spoiler: 'street',
      windowTint: 0.84,
    },
    stats: {
      topSpeed: 81, // ~292 km/h
      acceleration: 42,
      braking: 48,
      handling: 2.38,
      grip: 8.8,
      driftControl: 0.94,
      durability: 160,
      maxHealthBlocks: 8,
      nitroEfficiency: 1.08,
      weight: 1650,
    },
    ratings: {
      speed: 85,
      acceleration: 86,
      handling: 76,
      grip: 78,
      drift: 93,
      durability: 96,
      nitro: 85,
    },
  },
  {
    id: 'cyber_gt',
    name: 'CYBER GT-R',
    subtitle: 'Widebody Apex Drift Machine',
    vehicleClass: 'B',
    archetype: 'gt',
    handlingArchetype: 'drifty',
    price: 5000,
    defaultCustomization: {
      bodyColor: '#7C3AED',
      finish: 'gloss',
      rimColor: '#E5B44B',
      underglowColor: '#8B5CF6',
      headlightColor: '#DDF6FF',
      nitroColor: '#A855F7',
      spoiler: 'gt',
      windowTint: 0.86,
    },
    stats: {
      topSpeed: 86, // ~310 km/h
      acceleration: 45,
      braking: 55,
      handling: 2.62,
      grip: 9.8,
      driftControl: 0.96,
      durability: 120,
      maxHealthBlocks: 6,
      nitroEfficiency: 1.14,
      weight: 1320,
    },
    ratings: {
      speed: 90,
      acceleration: 91,
      handling: 93,
      grip: 90,
      drift: 96,
      durability: 78,
      nitro: 90,
    },
  },
  {
    id: 'phantom_x',
    name: 'PHANTOM X',
    subtitle: 'Prototype Carbon Aero Hypercar',
    vehicleClass: 'A',
    archetype: 'supercar',
    handlingArchetype: 'grippy',
    price: 8500,
    defaultCustomization: {
      bodyColor: '#181E2C',
      finish: 'matte',
      rimColor: '#00C8FF',
      underglowColor: '#25F4A0',
      headlightColor: '#C4F7FF',
      nitroColor: '#25F4A0',
      spoiler: 'wing',
      windowTint: 0.9,
    },
    stats: {
      topSpeed: 91, // ~328 km/h
      acceleration: 48,
      braking: 58,
      handling: 2.7,
      grip: 11.4,
      driftControl: 0.88,
      durability: 140,
      maxHealthBlocks: 7,
      nitroEfficiency: 1.22,
      weight: 1240,
    },
    ratings: {
      speed: 98,
      acceleration: 98,
      handling: 97,
      grip: 98,
      drift: 86,
      durability: 86,
      nitro: 97,
    },
  },
];

export function getVehicleById(id: string): VehicleConfig {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

export function getDefaultCustomizationsMap(): Record<string, VehicleCustomization> {
  const map: Record<string, VehicleCustomization> = {};
  for (const v of VEHICLES) {
    map[v.id] = { ...v.defaultCustomization };
  }
  return map;
}
