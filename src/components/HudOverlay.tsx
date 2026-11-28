import React, { useMemo } from 'react';
import { Camera, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import type { RaceHudSnapshot, SettingsState } from '../game/types';
import { POWERUP_DEFS } from '../game/powerups';
import { t } from '../game/i18n';
import { PowerUpIcon } from './PowerUpIcon';
import type { RacingInputHub } from '../engine/input';

interface HudOverlayProps {
  hud: RaceHudSnapshot;
  settings: SettingsState;
  isMultiplayer: boolean;
  isElimination: boolean;
  inputHub: RacingInputHub | null;
  onToggleMute: () => void;
  onCycleCamera: () => void;
  onPause: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  hud,
  settings,
  isMultiplayer,
  isElimination,
  inputHub,
  onToggleMute,
  onCycleCamera,
  onPause,
}) => {
  const lang = settings.language;
  const speedDisplay = settings.speedUnit === 'mph' ? Math.round(hud.speedKmh * 0.621371) : hud.speedKmh;
  const speedUnitLabel = settings.speedUnit === 'mph' ? 'MPH' : t(lang, 'speed');
  const hpPct = Math.max(0, Math.min(100, Math.round((hud.hp / Math.max(1, hud.maxHp)) * 100)));
  const isTouchDevice =
    settings.mobileControls === 'on' ||
    (settings.mobileControls === 'auto' &&
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0));

  // Normalize spline minimap coordinates cleanly into 136x136 viewBox
  const minimap = useMemo(() => {
    if (!hud.minimapPath.length) return { poly: '', project: (_x: number, _z: number) => ({ x: 68, y: 68 }) };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of hud.minimapPath) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const span = Math.max(1, Math.max(maxX - minX, maxZ - minZ));
    const pad = 14;
    const scale = (136 - pad * 2) / span;
    const ox = (136 - (maxX - minX) * scale) * 0.5;
    const oz = (136 - (maxZ - minZ) * scale) * 0.5;

    const project = (x: number, z: number) => ({
      x: ox + (x - minX) * scale,
      y: 136 - (oz + (z - minZ) * scale),
    });

    const poly = hud.minimapPath
      .map((p) => {
        const pt = project(p.x, p.z);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      })
      .join(' ');
    return { poly, project };
  }, [hud.minimapPath]);

  const activePowerUp = hud.inventory[hud.activeSlot];

  return (
    <div
      className="fixed inset-0 pointer-events-none z-20 flex flex-col justify-between p-3 sm:p-4"
      data-testid="gameplay-hud"
    >
      {/* Low HP Red Peripheral Vignette */}
      {hpPct <= 30 && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 95px rgba(255, 42, 85, 0.58)',
          }}
        />
      )}

      {/* High-Speed / Nitro Velocity Edge Glow */}
      {(hud.nitroActive || hud.speedKmh >= 245) && hpPct > 30 && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: hud.nitroActive
              ? 'inset 0 0 85px rgba(37, 244, 160, 0.36)'
              : 'inset 0 0 65px rgba(0, 200, 255, 0.22)',
          }}
        />
      )}

      {/* Authentic Blur 3D Holographic Target Lock-On Reticle */}
      {hud.lockTargetScreen && hud.phase === 'racing' && (
        <div
          className="fixed pointer-events-none -translate-x-1/2 -translate-y-1/2 z-10"
          style={{
            left: `${hud.lockTargetScreen.x.toFixed(1)}%`,
            top: `${hud.lockTargetScreen.y.toFixed(1)}%`,
          }}
        >
          <div className="relative flex flex-col items-center">
            <svg width="52" height="52" viewBox="0 0 52 52">
              <path
                d="M14 4 L4 4 L4 14 M38 4 L48 4 L48 14 M4 38 L4 48 L14 48 M48 38 L48 48 L38 48"
                fill="none"
                stroke={hud.lockTargetScreen.color}
                strokeWidth="2.5"
              />
              <circle
                cx="26"
                cy="26"
                r="10"
                fill="none"
                stroke={hud.lockTargetScreen.color}
                strokeWidth="1.6"
                strokeDasharray="4 3"
              />
              <circle cx="26" cy="26" r="2.2" fill="#FFFFFF" />
            </svg>
            <div
              className="mt-0.5 px-1.5 py-0.5 text-[9px] font-mono-num font-bold tracking-wider bg-[#070A12]/85 whitespace-nowrap"
              style={{ color: hud.lockTargetScreen.color, border: `1px solid ${hud.lockTargetScreen.color}` }}
            >
              LOCK · {hud.lockTargetScreen.name} · {hud.lockTargetScreen.dist}m
            </div>
          </div>
        </div>
      )}

      {/* TOP ROW: Position/Lap/Timer/Fans (Left) & Speed/Utility (Right) */}
      <div className="flex items-start justify-between gap-4">
        {/* TOP-LEFT CLUSTER */}
        <div className="bg-[#070A12]/85 border-l-4 border-[#00C8FF] px-4 py-2.5 nr-clip-angle shadow-lg">
          <div className="flex items-baseline gap-4 sm:gap-5">
            <div>
              <div className="text-[10px] font-bold tracking-[0.22em] text-[#94A3B8] uppercase">
                {t(lang, 'position')}
              </div>
              <div className="font-display font-bold italic text-3xl sm:text-4xl leading-none text-[#F5F7FA] font-mono-num">
                <span className="text-[#00C8FF]">{hud.position}</span>
                <span className="text-base text-[#64748B] ml-1">/ {hud.totalRacers}</span>
              </div>
            </div>

            <div className="h-9 w-px bg-white/15" />

            <div>
              <div className="text-[10px] font-bold tracking-[0.22em] text-[#94A3B8] uppercase">
                {t(lang, 'lap')}
              </div>
              <div className="font-display font-bold text-2xl sm:text-3xl leading-none text-[#F5F7FA] font-mono-num">
                {hud.lap}
                <span className="text-sm text-[#64748B] ml-1">/ {hud.totalLaps}</span>
              </div>
            </div>

            <div className="h-9 w-px bg-white/15" />

            <div>
              <div className="text-[10px] font-bold tracking-[0.22em] text-[#94A3B8] uppercase">
                {t(lang, 'time')}
              </div>
              <div className="font-mono-num font-bold text-lg sm:text-xl leading-tight text-[#F5F7FA]">
                {formatTime(hud.raceTime)}
              </div>
            </div>

            <div className="hidden md:block h-9 w-px bg-white/15" />

            <div className="hidden md:block">
              <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.22em] text-[#FF2A85] uppercase">
                <span>FANS</span>
                {hud.comboCount > 1 && (
                  <span className="px-1 bg-[#FF2A85] text-[#070A12] text-[9px] tracking-wider font-mono-num">
                    x{hud.comboCount}
                  </span>
                )}
              </div>
              <div className="font-mono-num font-bold text-lg sm:text-xl leading-tight text-[#F5F7FA]">
                {hud.raceFans.toLocaleString()}
              </div>
            </div>
          </div>

          {isElimination && (
            <div className="mt-1.5 text-xs font-mono-num font-bold text-[#FF365E] tracking-wider">
              ELIMINATION IN {hud.eliminationTimer}s
            </div>
          )}

          {hud.mode === 'destruction_arena' && (
            <div className="mt-1.5 flex items-center gap-3 text-xs font-mono-num font-bold tracking-wider">
              <span className="text-[#FF8A00]">SCORE {hud.destructionScore ?? 0}</span>
              <span className="text-[#FF365E]">TIME {hud.modeTimeRemaining ?? 0}s</span>
            </div>
          )}

          {hud.mode === 'checkpoint' && (
            <div className="mt-1.5 flex items-center gap-3 text-xs font-mono-num font-bold tracking-wider">
              <span className="text-[#00F5D4]">GATES {hud.checkpointsCleared ?? 0}</span>
              <span className={(hud.modeTimeRemaining ?? 0) <= 6 ? 'text-[#FF365E]' : 'text-[#F5F7FA]'}>
                CLOCK {hud.modeTimeRemaining ?? 0}s
              </span>
            </div>
          )}

          {hud.fanRun?.active && (
            <div className="mt-1.5 text-[11px] font-mono-num font-bold text-[#FF2A85] tracking-wider">
              FAN RUN {hud.fanRun.gatesCleared}/{hud.fanRun.gatesTotal} · {hud.fanRun.remainingSec}s
            </div>
          )}

          {hud.fanDemand && hud.fanDemand.status === 'active' && (
            <div className="mt-1 text-[11px] font-mono-num font-bold text-[#FACC15] tracking-wider">
              DEMAND: {hud.fanDemand.label} ({hud.fanDemand.progress}/{hud.fanDemand.target}) · {hud.fanDemand.remainingSec}s
            </div>
          )}
        </div>

        {/* TOP-RIGHT CLUSTER: Speedometer + FPS/Ping + Square Utility Buttons */}
        <div className="flex items-start gap-2.5">
          <div className="bg-[#070A12]/85 border-r-4 border-[#8B5CF6] px-4 py-2.5 text-right nr-clip-angle shadow-lg">
            <div className="flex items-baseline justify-end gap-2">
              <span
                className="font-display font-bold italic text-4xl sm:text-5xl leading-none font-mono-num"
                style={{ color: hud.nitroActive ? '#00F5D4' : '#F5F7FA' }}
                data-testid="hud-speed"
              >
                {speedDisplay}
              </span>
              <span className="text-xs font-bold tracking-widest text-[#00C8FF]">{speedUnitLabel}</span>
            </div>
            <div className="mt-1 flex items-center justify-end gap-2.5 text-[11px] font-mono-num text-[#94A3B8]">
              <span className="text-[#F5F7FA] font-bold">G{hud.gear}</span>
              {hud.isDrafting && <span className="text-[#00D8FF] font-bold">SLIPSTREAM</span>}
              {hud.isDrifting && <span className="text-[#25F4A0] font-bold">DRIFT</span>}
              {isMultiplayer && <span className="text-[#25F4A0]">{hud.pingMs} ms</span>}
            </div>
            {/* RPM Bar */}
            <div className="mt-1.5 h-1.5 w-36 bg-[#101522] overflow-hidden">
              <div
                className="h-full transition-all duration-75"
                style={{
                  width: `${Math.round(hud.rpmRatio * 100)}%`,
                  backgroundColor: hud.nitroActive ? '#00F5D4' : hud.rpmRatio > 0.82 ? '#FF365E' : '#00C8FF',
                }}
              />
            </div>
          </div>

          {/* Compact Utility Icon Buttons (pointer-events-auto, tabIndex=-1) */}
          <div className="pointer-events-auto flex flex-col gap-1.5">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause Race"
              onClick={(e) => {
                e.currentTarget.blur();
                onPause();
              }}
              className="w-9 h-9 bg-[#070A12]/90 border border-white/20 hover:border-[#00C8FF] text-[#F5F7FA] flex items-center justify-center cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Cycle Camera"
              onClick={(e) => {
                e.currentTarget.blur();
                onCycleCamera();
              }}
              className="w-9 h-9 bg-[#070A12]/90 border border-white/20 hover:border-[#00C8FF] text-[#F5F7FA] flex items-center justify-center cursor-pointer"
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={settings.muted ? 'Unmute Audio' : 'Mute Audio'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className="w-9 h-9 bg-[#070A12]/90 border border-white/20 hover:border-[#00C8FF] text-[#F5F7FA] flex items-center justify-center cursor-pointer"
            >
              {settings.muted ? <VolumeX className="w-4 h-4 text-[#FF365E]" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* CENTER TRANSIENT BANNERS (Countdown, Wrong Way, Incoming Lock, Combat Feed) */}
      <div className="flex flex-col items-center justify-center gap-2">
        {hud.phase === 'countdown' && (
          <div className="font-display font-bold italic text-7xl sm:text-8xl text-[#00C8FF] nr-text-outline">
            {hud.countdownValue > 0 ? hud.countdownValue : 'GO!'}
          </div>
        )}

        {hud.wrongWay && (
          <div className="bg-[#FF365E] text-white font-display font-bold text-xl tracking-[0.2em] px-5 py-1.5 nr-clip-btn">
            {t(lang, 'wrongWay')} · PRESS [R]
          </div>
        )}

        {hud.incomingWarning && (
          <div className="bg-[#070A12]/90 border-2 border-[#FF365E] text-[#FF365E] font-display font-bold text-sm tracking-[0.2em] px-4 py-1">
            ▲ {t(lang, 'incoming')} ({hud.incomingDistance}m) — USE SHIELD ▲
          </div>
        )}

        {hud.finalLapBanner && hud.phase === 'racing' && hud.lap === hud.totalLaps && hud.raceTime < 999 && (
          <div className="text-[#00C8FF] font-display font-bold italic text-lg tracking-[0.25em] nr-text-outline">
            {t(lang, 'finalLap')}
          </div>
        )}

        {/* Compact Combat Event Feed */}
        {hud.combatFeed.length > 0 && (
          <div className="flex flex-col items-center gap-1 mt-1">
            {hud.combatFeed.slice(0, 2).map((item) => (
              <div
                key={item.id}
                className="bg-[#070A12]/80 px-3 py-0.5 text-xs font-mono-num font-bold tracking-wider uppercase"
                style={{ color: item.color, borderLeft: `3px solid ${item.color}` }}
              >
                {item.text}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BOTTOM ROW: Minimap (Left), Power-Up 3-Slot Inventory + Integrity/Nitro (Center), Rear/Recover (Right) */}
      <div className="flex items-end justify-between gap-4">
        {/* BOTTOM-LEFT: Real Spline-Projected Minimap */}
        <div className="hidden sm:block bg-[#070A12]/82 border border-white/15 p-1.5">
          <svg width="136" height="136" viewBox="0 0 136 136" aria-label="Track Minimap">
            <polygon
              points={minimap.poly}
              fill="none"
              stroke="#334155"
              strokeWidth="6"
              strokeLinejoin="round"
            />
            <polygon
              points={minimap.poly}
              fill="none"
              stroke="#00C8FF"
              strokeOpacity="0.65"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {hud.minimapDots.map((dot) => {
              const p = minimap.project(dot.x, dot.z);
              return (
                <circle
                  key={dot.id}
                  cx={p.x}
                  cy={p.y}
                  r={dot.isPlayer ? 4.8 : 3.2}
                  fill={dot.color}
                  stroke="#070A12"
                  strokeWidth="1.2"
                />
              );
            })}
          </svg>
        </div>

        {/* BOTTOM-CENTER: Compact 3-Slot Power-Up Inventory + Integrity/Nitro */}
        <div className="mx-auto flex flex-col items-center gap-1.5">
          {/* Active Power-Up Name (only shown when holding an active power-up so car rear stays unobstructed) */}
          {activePowerUp && (
            <div className="bg-[#070A12]/88 px-2.5 py-0.5 border border-white/15 text-[11px] font-mono-num tracking-wider">
              <span style={{ color: POWERUP_DEFS[activePowerUp.type].color }} className="font-bold">
                {POWERUP_DEFS[activePowerUp.type].name} · {POWERUP_DEFS[activePowerUp.type].shortDesc}
              </span>
            </div>
          )}

          {/* 3 Power-Up Slots */}
          <div className="pointer-events-auto flex items-center gap-2">
            {[0, 1, 2].map((slotIdx) => {
              const slot = hud.inventory[slotIdx];
              const isSelected = hud.activeSlot === slotIdx;
              const def = slot ? POWERUP_DEFS[slot.type] : null;
              return (
                <button
                  key={slotIdx}
                  type="button"
                  tabIndex={-1}
                  aria-label={`Power-Up Slot ${slotIdx + 1}: ${slot ? slot.type : 'Empty'}`}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    inputHub?.selectSlot(slotIdx);
                    if (isSelected && slot) inputHub?.triggerAction('usePowerUp');
                  }}
                  className="relative w-14 h-14 sm:w-[58px] sm:h-[58px] bg-[#070A12]/90 flex flex-col items-center justify-center transition-transform cursor-pointer"
                  style={{
                    border: isSelected
                      ? `2px solid ${def?.color ?? '#00C8FF'}`
                      : '1px solid rgba(255,255,255,0.16)',
                    transform: isSelected ? 'translateY(-3px)' : 'none',
                  }}
                >
                  <span className="absolute top-0.5 left-1.5 text-[9px] font-mono-num text-[#64748B]">
                    {slotIdx + 1}
                  </span>
                  {slot && def ? (
                    <>
                      <PowerUpIcon type={slot.type} size={24} />
                      <span
                        className="mt-0.5 text-[8px] font-bold tracking-wider"
                        style={{ color: def.color }}
                      >
                        {slot.type}
                      </span>
                      {slot.ammo > 1 && (
                        <span className="absolute top-0.5 right-1 text-[9px] font-mono-num font-bold text-[#FF8A00]">
                          x{slot.ammo}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[9px] text-[#334155] font-mono-num">EMPTY</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Blur-Style Vehicle-Specific Segmented Chassis Integrity (5-8 Blocks) + Nitro/Shield Meter */}
          <div className="flex items-center gap-3 bg-[#070A12]/88 px-3 py-1.5 border border-white/15">
            <div className="w-40 sm:w-48">
              <div className="flex justify-between text-[10px] font-mono-num font-bold mb-1">
                <span className="text-[#94A3B8]">
                  {t(lang, 'integrity')}
                  {hud.damageStage && hud.damageStage !== 'healthy' && (
                    <span className="ml-1.5 text-[#FF8A00] uppercase">· {hud.damageStage}</span>
                  )}
                </span>
                <span style={{ color: hpPct <= 30 ? '#FF2A55' : '#25F4A0' }}>
                  {Math.ceil((hud.hp / Math.max(1, hud.maxHp)) * (hud.maxHealthBlocks || 6))}/{hud.maxHealthBlocks || 6} BLK
                </span>
              </div>
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${hud.maxHealthBlocks || 6}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: hud.maxHealthBlocks || 6 }, (_, seg) => {
                  const blockSpan = 100 / (hud.maxHealthBlocks || 6);
                  const segFill = Math.max(0, Math.min(1, (hpPct - seg * blockSpan) / blockSpan));
                  const segColor = hpPct <= 30 ? '#FF2A55' : hpPct <= 60 ? '#FF8A00' : '#25F4A0';
                  return (
                    <div key={seg} className="h-2 bg-[#141B2D] overflow-hidden skew-x-[-16deg]">
                      <div
                        className="h-full transition-all duration-150"
                        style={{ width: `${Math.round(segFill * 100)}%`, backgroundColor: segColor }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="w-24 sm:w-28">
              <div className="flex justify-between text-[10px] font-mono-num font-bold mb-0.5">
                <span className="text-[#94A3B8]">
                  {hud.shieldActive ? t(lang, 'shield') : t(lang, 'nitro')}
                </span>
                <span className="text-[#00C8FF]">
                  {hud.shieldActive
                    ? `${hud.shieldRemaining.toFixed(1)}s`
                    : hud.nitroActive
                      ? `${hud.nitroRemaining.toFixed(1)}s`
                      : `${hud.nitroEnergy}%`}
                </span>
              </div>
              <div className="h-1.5 bg-[#101522] overflow-hidden">
                <div
                  className="h-full transition-all duration-100"
                  style={{
                    width: hud.shieldActive
                      ? `${Math.min(100, (hud.shieldRemaining / 4.2) * 100)}%`
                      : hud.nitroActive
                        ? `${Math.min(100, (hud.nitroRemaining / 3) * 100)}%`
                        : `${hud.nitroEnergy}%`,
                    backgroundColor: hud.shieldActive ? '#00C8FF' : '#00F5D4',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM-RIGHT: Fire Mode & Quick Recover */}
        <div className="hidden sm:flex pointer-events-auto flex-col items-end gap-1.5">
          <div
            className="px-2.5 py-1 text-[10px] font-mono-num font-bold bg-[#070A12]/88 border"
            style={{
              color: hud.rearFireMode ? '#FF8A00' : '#00C8FF',
              borderColor: hud.rearFireMode ? '#FF8A00' : 'rgba(0,200,255,0.45)',
            }}
          >
            [F] {hud.rearFireMode ? t(lang, 'rearFire') : t(lang, 'forwardFire')}
          </div>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Recover Vehicle"
            onClick={(e) => {
              e.currentTarget.blur();
              inputHub?.triggerAction('recover');
            }}
            className="bg-[#070A12]/85 border border-white/15 hover:border-[#00C8FF] px-3 py-1.5 text-[11px] font-mono-num text-[#94A3B8] hover:text-white flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> [R] RECOVER
          </button>
        </div>
      </div>

      {/* MOBILE LANDSCAPE MULTI-TOUCH CONTROLS OVERLAY */}
      {isTouchDevice && (
        <div className="fixed inset-x-4 bottom-24 flex justify-between items-end pointer-events-none z-30">
          {/* Steering Pad */}
          <div className={`pointer-events-auto flex gap-2 ${settings.leftHandedMobile ? 'order-2' : 'order-1'}`}>
            <button
              type="button"
              aria-label="Steer Left"
              onPointerDown={() => inputHub?.setTouchButton('steerLeft', true)}
              onPointerUp={() => inputHub?.setTouchButton('steerLeft', false)}
              onPointerLeave={() => inputHub?.setTouchButton('steerLeft', false)}
              className="w-16 h-16 bg-[#070A12]/80 border-2 border-[#00C8FF]/70 text-white font-display font-bold text-2xl active:bg-[#00C8FF]/30"
            >
              ◀
            </button>
            <button
              type="button"
              aria-label="Steer Right"
              onPointerDown={() => inputHub?.setTouchButton('steerRight', true)}
              onPointerUp={() => inputHub?.setTouchButton('steerRight', false)}
              onPointerLeave={() => inputHub?.setTouchButton('steerRight', false)}
              className="w-16 h-16 bg-[#070A12]/80 border-2 border-[#00C8FF]/70 text-white font-display font-bold text-2xl active:bg-[#00C8FF]/30"
            >
              ▶
            </button>
          </div>

          {/* Gas / Brake / Fire / Nitro */}
          <div className={`pointer-events-auto flex gap-2 items-end ${settings.leftHandedMobile ? 'order-1' : 'order-2'}`}>
            <button
              type="button"
              aria-label="Fire Power-Up"
              onPointerDown={() => inputHub?.triggerAction('usePowerUp')}
              className="w-14 h-14 bg-[#8B5CF6]/85 border-2 border-white/50 text-white font-display font-bold text-xs"
            >
              FIRE
            </button>
            <button
              type="button"
              aria-label="Activate Nitro"
              onPointerDown={() => inputHub?.triggerAction('useNitro')}
              className="w-14 h-14 bg-[#00F5D4]/80 border-2 border-white/50 text-[#070A12] font-display font-bold text-xs"
            >
              NITRO
            </button>
            <button
              type="button"
              aria-label="Brake and Drift"
              onPointerDown={() => {
                inputHub?.setTouchButton('brake', true);
                inputHub?.setTouchButton('drift', true);
              }}
              onPointerUp={() => {
                inputHub?.setTouchButton('brake', false);
                inputHub?.setTouchButton('drift', false);
              }}
              onPointerLeave={() => {
                inputHub?.setTouchButton('brake', false);
                inputHub?.setTouchButton('drift', false);
              }}
              className="w-14 h-16 bg-[#FF365E]/80 border-2 border-white/40 text-white font-display font-bold text-xs"
            >
              BRAKE
            </button>
            <button
              type="button"
              aria-label="Accelerate"
              onPointerDown={() => inputHub?.setTouchButton('gas', true)}
              onPointerUp={() => inputHub?.setTouchButton('gas', false)}
              onPointerLeave={() => inputHub?.setTouchButton('gas', false)}
              className="w-16 h-20 bg-[#25F4A0]/85 border-2 border-white/50 text-[#070A12] font-display font-bold text-sm"
            >
              GAS
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
