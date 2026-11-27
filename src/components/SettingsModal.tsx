import React, { useState } from 'react';
import { ArrowLeft, Download, HelpCircle, Sliders } from 'lucide-react';
import type { GraphicsPreset, LanguageCode, SettingsState } from '../game/types';
import { POWERUP_DEFS, POWERUP_TYPES } from '../game/powerups';
import { t } from '../game/i18n';
import { PowerUpIcon } from './PowerUpIcon';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface SettingsModalProps {
  settings: SettingsState;
  onChange: (patch: Partial<SettingsState>) => void;
  onBack: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onChange, onBack }) => {
  const [tab, setTab] = useState<'settings' | 'help'>('settings');
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const lang = settings.language;

  return (
    <div className="fixed inset-0 z-30 bg-[#070A12]/90 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-[#0C111E] border border-white/20 p-5 sm:p-6 max-h-[90vh] overflow-y-auto nr-scroll">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="bg-[#101522] border border-white/20 hover:border-[#00C8FF] px-3 py-1.5 text-xs font-display font-bold tracking-widest flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> {t(lang, 'back')}
            </button>
            <h1 className="font-display font-bold italic text-2xl tracking-wider text-[#F5F7FA]">
              {t(lang, 'settings')}
            </h1>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('settings')}
              className={`px-3.5 py-1.5 text-xs font-display font-bold flex items-center gap-1.5 cursor-pointer ${
                tab === 'settings' ? 'bg-[#00C8FF] text-[#070A12]' : 'bg-[#101522] text-[#94A3B8]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" /> CONFIG
            </button>
            <button
              type="button"
              onClick={() => setTab('help')}
              className={`px-3.5 py-1.5 text-xs font-display font-bold flex items-center gap-1.5 cursor-pointer ${
                tab === 'help' ? 'bg-[#8B5CF6] text-white' : 'bg-[#101522] text-[#94A3B8]'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" /> {t(lang, 'controls')}
            </button>
          </div>
        </div>

        {tab === 'settings' ? (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Graphics & Language */}
            <div className="bg-[#090D18] border border-white/12 p-4 space-y-4">
              <div>
                <div className="text-xs font-mono-num text-[#94A3B8] mb-2">{t(lang, 'graphics')}</div>
                <div className="grid grid-cols-4 gap-2">
                  {(['low', 'medium', 'high', 'ultra'] as GraphicsPreset[]).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => onChange({ graphics: g })}
                      className={`py-2 text-xs font-display font-bold uppercase border cursor-pointer ${
                        settings.graphics === g
                          ? 'bg-[#00C8FF] text-[#070A12] border-[#00C8FF]'
                          : 'bg-[#101522] text-[#94A3B8] border-white/10'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-mono-num text-[#94A3B8] mb-2">{t(lang, 'language')}</div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['en', 'ENGLISH'],
                      ['uz', "O'ZBEKCHA"],
                      ['ru', 'РУССКИЙ'],
                    ] as [LanguageCode, string][]
                  ).map(([code, label]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => onChange({ language: code })}
                      className={`py-2 text-xs font-display font-bold border cursor-pointer ${
                        settings.language === code
                          ? 'bg-[#8B5CF6] text-white border-[#8B5CF6]'
                          : 'bg-[#101522] text-[#94A3B8] border-white/10'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => onChange({ speedUnit: settings.speedUnit === 'kmh' ? 'mph' : 'kmh' })}
                  className="bg-[#101522] border border-white/15 px-3 py-2 text-xs font-mono-num text-[#F5F7FA] flex justify-between cursor-pointer"
                >
                  <span>UNIT</span>
                  <span className="text-[#00C8FF] font-bold">{settings.speedUnit.toUpperCase()}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ showFps: !settings.showFps })}
                  className="bg-[#101522] border border-white/15 px-3 py-2 text-xs font-mono-num text-[#F5F7FA] flex justify-between cursor-pointer"
                >
                  <span>FPS METER</span>
                  <span className="text-[#25F4A0] font-bold">{settings.showFps ? 'ON' : 'OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      mobileControls:
                        settings.mobileControls === 'auto'
                          ? 'on'
                          : settings.mobileControls === 'on'
                            ? 'off'
                            : 'auto',
                    })
                  }
                  className="bg-[#101522] border border-white/15 px-3 py-2 text-xs font-mono-num text-[#F5F7FA] flex justify-between cursor-pointer"
                >
                  <span>TOUCH HUD</span>
                  <span className="text-[#00C8FF] font-bold">{settings.mobileControls.toUpperCase()}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ autoAccelerate: !settings.autoAccelerate })}
                  className="bg-[#101522] border border-white/15 px-3 py-2 text-xs font-mono-num text-[#F5F7FA] flex justify-between cursor-pointer"
                >
                  <span>AUTO GAS</span>
                  <span className="text-[#25F4A0] font-bold">{settings.autoAccelerate ? 'ON' : 'OFF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ motionBlur: settings.motionBlur === false })}
                  className="col-span-2 bg-[#101522] border border-white/15 hover:border-[#00C8FF] px-3 py-2 text-xs font-mono-num text-[#F5F7FA] flex justify-between cursor-pointer"
                >
                  <span>MOTION BLUR</span>
                  <span className={settings.motionBlur !== false ? 'text-[#25F4A0] font-bold' : 'text-[#94A3B8] font-bold'}>
                    {settings.motionBlur !== false ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>

            {/* Audio Mixer & PWA */}
            <div className="bg-[#090D18] border border-white/12 p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono-num text-[#94A3B8]">{t(lang, 'audio')}</span>
                <button
                  type="button"
                  onClick={() => onChange({ muted: !settings.muted })}
                  className={`px-3 py-1 text-xs font-mono-num font-bold cursor-pointer ${
                    settings.muted ? 'bg-[#FF365E] text-white' : 'bg-[#25F4A0]/20 text-[#25F4A0]'
                  }`}
                >
                  {settings.muted ? 'MUTED' : 'AUDIO ACTIVE'}
                </button>
              </div>

              {(
                [
                  ['MASTER', 'masterVolume'],
                  ['ENGINE', 'engineVolume'],
                  ['COMBAT SFX', 'sfxVolume'],
                  ['UI CLICKS', 'uiVolume'],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <div className="flex justify-between text-xs font-mono-num mb-1">
                    <span className="text-[#94A3B8]">{label}</span>
                    <span className="text-[#F5F7FA]">{Math.round(settings[key] * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings[key] * 100)}
                    onChange={(e) => onChange({ [key]: Number(e.target.value) / 100 })}
                    aria-label={`${label} Volume`}
                    className="w-full accent-[#00C8FF] cursor-pointer"
                  />
                </div>
              ))}

              {!isInstalled && isInstallable && (
                <button
                  type="button"
                  onClick={install}
                  className="w-full mt-2 bg-[#00C8FF] text-[#070A12] font-display font-bold py-2.5 text-xs tracking-wider flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" /> INSTALL NEON RIVALS PWA
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Help Center & 8 Power-Ups Guide */
          <div className="mt-5 space-y-4">
            <div className="bg-[#090D18] border border-white/12 p-4">
              <div className="text-xs font-mono-num text-[#00C8FF] mb-2">DESKTOP KEY BINDINGS</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono-num text-[#CBD5E1]">
                <div><strong className="text-white">W / ↑</strong> Accelerate</div>
                <div><strong className="text-white">S / ↓</strong> Brake / Reverse</div>
                <div><strong className="text-white">A / D</strong> Steer Left/Right</div>
                <div><strong className="text-white">SHIFT</strong> Drift Nitro</div>
                <div><strong className="text-white">SPACE</strong> Fire Power-Up</div>
                <div><strong className="text-white">Q / 1-3</strong> Switch Slot</div>
                <div><strong className="text-white">E</strong> Drop Power-Up</div>
                <div><strong className="text-white">F</strong> Toggle Rear-Fire</div>
                <div><strong className="text-white">C</strong> Switch Camera</div>
                <div><strong className="text-white">V</strong> Rear-View Mirror</div>
                <div><strong className="text-white">R</strong> Recover to Track</div>
                <div><strong className="text-white">ESC / P</strong> Pause Menu</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {POWERUP_TYPES.map((pt) => {
                const def = POWERUP_DEFS[pt];
                return (
                  <div key={pt} className="bg-[#090D18] border border-white/12 p-3 flex items-start gap-2.5">
                    <PowerUpIcon type={pt} size={28} />
                    <div>
                      <div className="font-display font-bold text-sm" style={{ color: def.color }}>
                        {def.name}
                      </div>
                      <div className="text-[11px] text-[#94A3B8] leading-snug mt-0.5">{def.shortDesc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
