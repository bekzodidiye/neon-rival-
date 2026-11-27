import React, { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Lock, Play } from 'lucide-react';
import type { PaintFinish, PlayerProfile, SpoilerStyle, VehicleCustomization } from '../game/types';
import { PAINT_PRESETS, RIM_PRESETS, UNDERGLOW_PRESETS, VEHICLES } from '../game/vehicles';
import { t } from '../game/i18n';
import type { LanguageCode } from '../game/types';

interface GarageDockProps {
  profile: PlayerProfile;
  viewingVehicleId: string;
  language: LanguageCode;
  onSelectViewing: (vehicleId: string) => void;
  onEquipVehicle: (vehicleId: string) => void;
  onUnlockVehicle: (vehicleId: string) => void;
  onUpdateCustomization: (vehicleId: string, patch: Partial<VehicleCustomization>) => void;
  onBack: () => void;
  onRaceNow: () => void;
}

export const GarageDock: React.FC<GarageDockProps> = ({
  profile,
  viewingVehicleId,
  language,
  onSelectViewing,
  onEquipVehicle,
  onUnlockVehicle,
  onUpdateCustomization,
  onBack,
  onRaceNow,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'vehicles' | 'customize'>('vehicles');

  const vehicle = VEHICLES.find((v) => v.id === viewingVehicleId) ?? VEHICLES[0];
  const isOwned = profile.ownedVehicles.includes(vehicle.id);
  const isEquipped = profile.selectedVehicleId === vehicle.id;
  const custom = profile.customizations[vehicle.id] ?? vehicle.defaultCustomization;
  const canAfford = profile.credits >= vehicle.price;

  return (
    <div className="fixed inset-0 pointer-events-none z-20 flex flex-col justify-between p-4 sm:p-5">
      {/* Top Minimal Spec Bar (Unobstructed center viewport for 3D car rotation) */}
      <div className="flex items-start justify-between gap-4">
        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="bg-[#070A12]/90 border border-white/20 hover:border-[#00C8FF] text-[#F5F7FA] px-3.5 py-2 text-xs font-display font-bold tracking-widest flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> {t(language, 'back')}
          </button>
          <div className="bg-[#070A12]/88 border-l-4 border-[#00C8FF] px-4 py-1.5">
            <div className="flex items-center gap-2">
              <span className="bg-[#00C8FF] text-[#070A12] font-display font-bold text-xs px-1.5 py-0.5">
                CLASS {vehicle.vehicleClass}
              </span>
              <span className="border border-white/25 text-[#25F4A0] font-mono-num font-bold text-[10px] px-1.5 py-0.5 uppercase">
                {vehicle.handlingArchetype}
              </span>
              <h1 className="font-display font-bold italic text-xl sm:text-2xl tracking-wide text-[#F5F7FA]">
                {vehicle.name}
              </h1>
            </div>
            <p className="text-[11px] text-[#94A3B8]">
              {vehicle.subtitle} · {vehicle.stats.maxHealthBlocks} Armor Blocks · Drag to rotate 360°
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5">
          <div className="bg-[#070A12]/90 border border-white/15 px-3.5 py-2 text-right font-mono-num">
            <div className="text-[10px] text-[#94A3B8] tracking-widest">{t(language, 'credits')}</div>
            <div className="text-base font-bold text-[#25F4A0]">{profile.credits.toLocaleString()} CR</div>
          </div>
          {isOwned && (
            <button
              type="button"
              onClick={onRaceNow}
              className="bg-[#00C8FF] hover:bg-[#33D4FF] text-[#070A12] font-display font-bold tracking-wider px-5 py-2.5 text-sm nr-clip-btn flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" /> {t(language, 'play')}
            </button>
          )}
        </div>
      </div>

      {/* Collapsible Unified Bottom Control Dock */}
      <div className="flex flex-col items-center w-full">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="pointer-events-auto bg-[#070A12]/92 border border-b-0 border-white/20 px-4 py-1 text-[11px] font-mono-num text-[#94A3B8] hover:text-white flex items-center gap-1.5 cursor-pointer"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {collapsed ? 'SHOW GARAGE DOCK' : 'HIDE DOCK (ZEN VIEW)'}
        </button>

        {!collapsed && (
          <div className="pointer-events-auto w-full max-w-[960px] bg-[#070A12]/94 border border-white/20 p-3.5 shadow-2xl">
            {/* Tabs + Action */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTab('vehicles')}
                  className={`px-3.5 py-1.5 text-xs font-display font-bold tracking-widest cursor-pointer ${
                    tab === 'vehicles'
                      ? 'bg-[#00C8FF] text-[#070A12]'
                      : 'bg-[#101522] text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {t(language, 'selectCar')} ({VEHICLES.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTab('customize')}
                  className={`px-3.5 py-1.5 text-xs font-display font-bold tracking-widest cursor-pointer ${
                    tab === 'customize'
                      ? 'bg-[#8B5CF6] text-white'
                      : 'bg-[#101522] text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {t(language, 'customize')}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {isOwned ? (
                  <button
                    type="button"
                    disabled={isEquipped}
                    onClick={() => onEquipVehicle(vehicle.id)}
                    className={`px-4 py-1.5 text-xs font-display font-bold tracking-widest cursor-pointer ${
                      isEquipped
                        ? 'bg-[#25F4A0]/20 text-[#25F4A0] border border-[#25F4A0]/50 cursor-default'
                        : 'bg-[#25F4A0] text-[#070A12] hover:bg-[#4FF7B5]'
                    }`}
                  >
                    {isEquipped ? t(language, 'equipped') : 'EQUIP VEHICLE'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canAfford}
                    onClick={() => onUnlockVehicle(vehicle.id)}
                    className={`px-4 py-1.5 text-xs font-display font-bold tracking-widest flex items-center gap-1.5 ${
                      canAfford
                        ? 'bg-[#FF8A00] text-[#070A12] hover:bg-[#FFA233] cursor-pointer'
                        : 'bg-[#1E293B] text-[#64748B] cursor-not-allowed'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" /> {t(language, 'unlock')} · {vehicle.price.toLocaleString()} CR
                  </button>
                )}
              </div>
            </div>

            {tab === 'vehicles' ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                {/* Vehicle Selector Row */}
                <div className="md:col-span-7 grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {VEHICLES.map((v) => {
                    const owned = profile.ownedVehicles.includes(v.id);
                    const active = v.id === vehicle.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onSelectViewing(v.id)}
                        className={`p-2 text-left border transition cursor-pointer ${
                          active
                            ? 'bg-[#101A30] border-[#00C8FF]'
                            : 'bg-[#0C111E] border-white/10 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono-num font-bold text-[#00C8FF]">
                            CLS {v.vehicleClass}
                          </span>
                          {!owned && <Lock className="w-3 h-3 text-[#FF8A00]" />}
                        </div>
                        <div className="mt-1 font-display font-bold text-xs text-[#F5F7FA] truncate">
                          {v.name}
                        </div>
                        <div className="text-[10px] font-mono-num text-[#94A3B8]">
                          {owned ? (profile.selectedVehicleId === v.id ? 'ACTIVE' : 'OWNED') : `${v.price} CR`}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Compact Telemetry Stat Bars */}
                <div className="md:col-span-5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-mono-num">
                  {(
                    [
                      ['SPEED', vehicle.ratings.speed, '#00C8FF'],
                      ['ACCEL', vehicle.ratings.acceleration, '#25F4A0'],
                      ['HANDLING', vehicle.ratings.handling, '#8B5CF6'],
                      ['DRIFT', vehicle.ratings.drift, '#FF8A00'],
                      ['ARMOR', vehicle.ratings.durability, '#FF365E'],
                      ['NITRO', vehicle.ratings.nitro, '#00F5D4'],
                    ] as const
                  ).map(([label, val, col]) => (
                    <div key={label}>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[#94A3B8]">{label}</span>
                        <span className="text-[#F5F7FA] font-bold">{val}</span>
                      </div>
                      <div className="h-1.5 bg-[#101522] mt-0.5">
                        <div className="h-full" style={{ width: `${val}%`, backgroundColor: col }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* Real-time Customization Controls */
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-[11px]">
                <div>
                  <div className="text-[10px] font-mono-num text-[#94A3B8] mb-1.5">{t(language, 'paint')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PAINT_PRESETS.map((p) => (
                      <button
                        key={p.hex}
                        type="button"
                        aria-label={`Paint ${p.name}`}
                        onClick={() => onUpdateCustomization(vehicle.id, { bodyColor: p.hex })}
                        className="w-6 h-6 border cursor-pointer"
                        style={{
                          backgroundColor: p.hex,
                          borderColor: custom.bodyColor === p.hex ? '#FFFFFF' : 'rgba(255,255,255,0.2)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-mono-num text-[#94A3B8] mb-1.5">{t(language, 'finish')}</div>
                  <div className="flex flex-wrap gap-1">
                    {(['metallic', 'gloss', 'matte'] as PaintFinish[]).map((fin) => (
                      <button
                        key={fin}
                        type="button"
                        onClick={() => onUpdateCustomization(vehicle.id, { finish: fin })}
                        className={`px-2 py-1 text-[10px] font-mono-num uppercase border cursor-pointer ${
                          custom.finish === fin
                            ? 'bg-[#00C8FF] text-[#070A12] border-[#00C8FF] font-bold'
                            : 'bg-[#101522] text-[#94A3B8] border-white/15'
                        }`}
                      >
                        {fin}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-mono-num text-[#94A3B8] mb-1.5">{t(language, 'underglow')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {UNDERGLOW_PRESETS.map((u) => (
                      <button
                        key={u.hex}
                        type="button"
                        aria-label={`Underglow ${u.name}`}
                        onClick={() => onUpdateCustomization(vehicle.id, { underglowColor: u.hex, nitroColor: u.hex })}
                        className="w-6 h-6 border cursor-pointer"
                        style={{
                          backgroundColor: u.hex,
                          borderColor: custom.underglowColor === u.hex ? '#FFFFFF' : 'rgba(255,255,255,0.2)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-mono-num text-[#94A3B8] mb-1.5">{t(language, 'rims')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {RIM_PRESETS.map((r) => (
                      <button
                        key={r.hex}
                        type="button"
                        aria-label={`Rim ${r.name}`}
                        onClick={() => onUpdateCustomization(vehicle.id, { rimColor: r.hex })}
                        className="w-6 h-6 border cursor-pointer"
                        style={{
                          backgroundColor: r.hex,
                          borderColor: custom.rimColor === r.hex ? '#FFFFFF' : 'rgba(255,255,255,0.2)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-mono-num text-[#94A3B8] mb-1.5">{t(language, 'spoiler')}</div>
                  <div className="flex flex-wrap gap-1">
                    {(['none', 'street', 'gt', 'wing'] as SpoilerStyle[]).map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        onClick={() => onUpdateCustomization(vehicle.id, { spoiler: sp })}
                        className={`px-2 py-1 text-[10px] font-mono-num uppercase border cursor-pointer ${
                          custom.spoiler === sp
                            ? 'bg-[#8B5CF6] text-white border-[#8B5CF6] font-bold'
                            : 'bg-[#101522] text-[#94A3B8] border-white/15'
                        }`}
                      >
                        {sp}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
