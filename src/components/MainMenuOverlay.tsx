import React, { useState } from 'react';
import { Download, Flag, Play, Settings, Trophy, Users, Wrench } from 'lucide-react';
import type { LanguageCode, PlayerProfile } from '../game/types';
import { getVehicleById } from '../game/vehicles';
import { t } from '../game/i18n';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { TitleLogo } from './TitleLogo';

interface MainMenuOverlayProps {
  profile: PlayerProfile;
  language: LanguageCode;
  onQuickRace: () => void;
  onOpenRaceSetup: () => void;
  onOpenMultiplayer: () => void;
  onOpenGarage: () => void;
  onOpenCareer: () => void;
  onOpenSettings: () => void;
}

export const MainMenuOverlay: React.FC<MainMenuOverlayProps> = ({
  profile,
  language,
  onQuickRace,
  onOpenRaceSetup,
  onOpenMultiplayer,
  onOpenGarage,
  onOpenCareer,
  onOpenSettings,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const activeCar = getVehicleById(profile.selectedVehicleId);

  return (
    <div className="fixed inset-0 pointer-events-none z-20 flex flex-col justify-between p-6 sm:p-10">
      {/* Subtle Left Vignette for Crisp Negative-Space Legibility over Live 3D Showcase */}
      <div
        className="fixed inset-y-0 left-0 w-[52%] pointer-events-none -z-10"
        style={{
          background: 'linear-gradient(90deg, rgba(7,10,18,0.88) 0%, rgba(7,10,18,0.52) 60%, rgba(7,10,18,0) 100%)',
        }}
      />

      {/* Top Row: Driver Profile Compact Strip (Right) */}
      <div className="flex items-start justify-between">
        <div className="pointer-events-auto">
          <TitleLogo />
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5">
          {!isInstalled && (isInstallable || isIOS) && (
            <button
              type="button"
              onClick={() => (isInstallable ? install() : setShowIOSGuide(true))}
              className="bg-[#101522]/90 border border-[#00C8FF]/50 hover:border-[#00C8FF] text-[#00C8FF] px-3 py-2 text-xs font-display font-bold tracking-wider flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> INSTALL PWA
            </button>
          )}

          <button
            type="button"
            onClick={onOpenCareer}
            className="bg-[#070A12]/88 border border-white/15 hover:border-[#00C8FF] px-4 py-2 text-right cursor-pointer"
          >
            <div className="text-xs font-display font-bold tracking-wider text-[#F5F7FA]">
              {profile.username}{' '}
              <span className="text-[#00C8FF] ml-1">
                {t(language, 'level')} {profile.level}
              </span>
            </div>
            <div className="text-[11px] font-mono-num text-[#94A3B8] flex items-center justify-end gap-3">
              <span className="text-[#25F4A0]">{profile.credits.toLocaleString()} CR</span>
              <span className="text-[#8B5CF6]">{profile.fanPoints.toLocaleString()} {t(language, 'fans')}</span>
            </div>
          </button>
        </div>
      </div>

      {/* Left-Third Action Column (Calm negative space, leaving 3D Hero Car 100% visible on right) */}
      <div className="pointer-events-auto w-full max-w-[340px] flex flex-col gap-2.5 my-auto">
        <button
          type="button"
          data-start="true"
          onClick={onQuickRace}
          className="w-full bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] font-display font-bold italic text-xl tracking-wider px-6 py-4 nr-clip-btn flex items-center justify-between transition-transform hover:translate-x-1 cursor-pointer shadow-lg"
        >
          <span className="flex items-center gap-2.5">
            <Play className="w-5 h-5 fill-current" />
            {t(language, 'quickRace')}
          </span>
          <span className="text-xs not-italic font-mono-num opacity-80">ENTER</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenRaceSetup}
            className="bg-[#101522]/92 hover:bg-[#172036] border border-white/15 hover:border-[#00C8FF] text-[#F5F7FA] font-display font-bold text-sm tracking-wider px-4 py-3 flex items-center gap-2 cursor-pointer"
          >
            <Flag className="w-4 h-4 text-[#00C8FF]" />
            {t(language, 'raceSetup')}
          </button>

          <button
            type="button"
            onClick={onOpenMultiplayer}
            className="bg-[#101522]/92 hover:bg-[#172036] border border-white/15 hover:border-[#25F4A0] text-[#F5F7FA] font-display font-bold text-sm tracking-wider px-4 py-3 flex items-center gap-2 cursor-pointer"
          >
            <Users className="w-4 h-4 text-[#25F4A0]" />
            {t(language, 'multiplayer')}
          </button>

          <button
            type="button"
            onClick={onOpenGarage}
            className="bg-[#101522]/92 hover:bg-[#172036] border border-white/15 hover:border-[#8B5CF6] text-[#F5F7FA] font-display font-bold text-sm tracking-wider px-4 py-3 flex items-center gap-2 cursor-pointer"
          >
            <Wrench className="w-4 h-4 text-[#8B5CF6]" />
            {t(language, 'garage')}
          </button>

          <button
            type="button"
            onClick={onOpenCareer}
            className="bg-[#101522]/92 hover:bg-[#172036] border border-white/15 hover:border-[#FF8A00] text-[#F5F7FA] font-display font-bold text-sm tracking-wider px-4 py-3 flex items-center gap-2 cursor-pointer"
          >
            <Trophy className="w-4 h-4 text-[#FF8A00]" />
            {t(language, 'career')}
          </button>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="text-xs font-mono-num text-[#94A3B8]">
            ACTIVE CAR: <span className="text-[#F5F7FA] font-bold">{activeCar.name}</span>{' '}
            <span className="text-[#00C8FF]">[{activeCar.vehicleClass}]</span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-xs font-display font-bold tracking-widest text-[#94A3B8] hover:text-[#00C8FF] flex items-center gap-1.5 cursor-pointer"
          >
            <Settings className="w-4 h-4" /> {t(language, 'settings')}
          </button>
        </div>
      </div>

      {/* Bottom Safe Margin: Single Flat Borderless Control Hint Line */}
      <div className="text-[11px] font-mono-num text-[#94A3B8] tracking-wide nr-text-outline">
        {t(language, 'controlsHint')}
      </div>

      {showIOSGuide && (
        <div className="fixed inset-0 pointer-events-auto z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#101522] border border-[#00C8FF]/50 max-w-sm w-full p-5">
            <h2 className="font-display font-bold text-lg text-[#F5F7FA]">INSTALL NEON RIVALS ON iOS</h2>
            <p className="mt-2 text-sm text-[#94A3B8]">
              1. Tap the <strong>Share</strong> button in Safari.<br />
              2. Select <strong>Add to Home Screen</strong> for fullscreen landscape racing.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full bg-[#00C8FF] text-[#070A12] font-display font-bold py-2 text-sm cursor-pointer"
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
