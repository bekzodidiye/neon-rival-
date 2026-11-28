import React from 'react';
import { Home, Play, RotateCcw, Settings, Trophy } from 'lucide-react';
import type { LanguageCode, RaceHudSnapshot, RaceRewards } from '../game/types';
import { t } from '../game/i18n';

interface PauseModalProps {
  language: LanguageCode;
  isMultiplayer: boolean;
  onResume: () => void;
  onRestart: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  language,
  isMultiplayer,
  onResume,
  onRestart,
  onOpenSettings,
  onQuit,
}) => {
  return (
    <div className="fixed inset-0 z-40 bg-[#070A12]/82 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#0C111E] border border-[#00C8FF]/50 p-6 nr-clip-angle shadow-2xl">
        <h2 className="font-display font-bold italic text-3xl text-[#F5F7FA] tracking-wider">
          {t(language, 'paused')}
        </h2>
        {isMultiplayer && (
          <p className="mt-1 text-xs font-mono-num text-[#FF8A00]">
            ONLINE RACE CONTINUES LIVE ON SERVER
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] font-display font-bold py-3 text-sm tracking-wider flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" /> {t(language, 'resume')}
          </button>

          {!isMultiplayer && (
            <button
              type="button"
              onClick={onRestart}
              className="w-full bg-[#101522] hover:bg-[#192338] border border-white/15 text-[#F5F7FA] font-display font-bold py-2.5 text-sm tracking-wider flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" /> {t(language, 'restart')}
            </button>
          )}

          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full bg-[#101522] hover:bg-[#192338] border border-white/15 text-[#F5F7FA] font-display font-bold py-2.5 text-sm tracking-wider flex items-center justify-center gap-2 cursor-pointer"
          >
            <Settings className="w-4 h-4" /> {t(language, 'settings')}
          </button>

          <button
            type="button"
            onClick={onQuit}
            className="w-full bg-[#1F0B14] hover:bg-[#30101F] border border-[#FF365E]/40 text-[#FF365E] font-display font-bold py-2.5 text-sm tracking-wider flex items-center justify-center gap-2 cursor-pointer"
          >
            <Home className="w-4 h-4" /> {t(language, 'mainMenu')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ResultsModalProps {
  language: LanguageCode;
  hud: RaceHudSnapshot;
  rewards: RaceRewards | null;
  onReplay: () => void;
  onMainMenu: () => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export const ResultsModal: React.FC<ResultsModalProps> = ({
  language,
  hud,
  rewards,
  onReplay,
  onMainMenu,
}) => {
  const isPodium = hud.position <= 3;

  return (
    <div className="fixed inset-0 z-40 bg-[#070A12]/88 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-[#0C111E] border border-[#00C8FF]/50 p-6 max-h-[90vh] overflow-y-auto nr-scroll">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
          <div>
            <div className="text-xs font-mono-num text-[#00C8FF] tracking-widest">
              {t(language, 'raceComplete')}
            </div>
            <h2 className="font-display font-bold italic text-3xl sm:text-4xl text-[#F5F7FA] flex items-center gap-2.5">
              <Trophy className="w-8 h-8" style={{ color: isPodium ? '#25F4A0' : '#94A3B8' }} />
              FINISHED P{hud.position} / {hud.totalRacers}
            </h2>
          </div>

          <div className="text-right font-mono-num">
            {hud.mode === 'destruction_arena' ? (
              <>
                <div className="text-xs text-[#FF8A00]">DESTRUCTION SCORE</div>
                <div className="text-2xl font-bold text-[#F5F7FA]">{(hud.destructionScore ?? 0).toLocaleString()} PTS</div>
              </>
            ) : hud.mode === 'checkpoint' ? (
              <>
                <div className="text-xs text-[#00F5D4]">CHECKPOINTS CLEARED</div>
                <div className="text-2xl font-bold text-[#F5F7FA]">{hud.checkpointsCleared ?? 0} GATES</div>
              </>
            ) : (
              <>
                <div className="text-xs text-[#94A3B8]">TOTAL TIME</div>
                <div className="text-2xl font-bold text-[#F5F7FA]">{fmt(hud.raceTime)}</div>
              </>
            )}
          </div>
        </div>

        {/* Bonus Challenge Badges */}
        {(hud.fanRun?.completed || hud.fanDemand?.status === 'succeeded') && (
          <div className="mt-3 flex flex-wrap gap-2 font-mono-num text-xs">
            {hud.fanRun?.completed && (
              <span className="bg-[#FF2A85]/20 border border-[#FF2A85]/60 text-[#FF2A85] px-2.5 py-1 font-bold">
                ★ FAN RUN COMPLETED
              </span>
            )}
            {hud.fanDemand?.status === 'succeeded' && (
              <span className="bg-[#FACC15]/20 border border-[#FACC15]/60 text-[#FACC15] px-2.5 py-1 font-bold">
                ★ FAN DEMAND CLEARED: {hud.fanDemand.label}
              </span>
            )}
          </div>
        )}

        {/* Rewards Summary */}
        {rewards && (
          <div className="mt-4 grid grid-cols-3 gap-3 font-mono-num">
            <div className="bg-[#090D18] border border-[#25F4A0]/35 p-3">
              <div className="text-[10px] text-[#94A3B8]">CREDITS EARNED</div>
              <div className="text-xl font-bold text-[#25F4A0]">+{rewards.credits.toLocaleString()} CR</div>
            </div>
            <div className="bg-[#090D18] border border-[#00C8FF]/35 p-3">
              <div className="text-[10px] text-[#94A3B8]">EXPERIENCE</div>
              <div className="text-xl font-bold text-[#00C8FF]">
                +{rewards.xp} XP {rewards.levelUp && <span className="text-xs text-[#25F4A0]">LVL UP!</span>}
              </div>
            </div>
            <div className="bg-[#090D18] border border-[#8B5CF6]/35 p-3">
              <div className="text-[10px] text-[#94A3B8]">FAN POINTS</div>
              <div className="text-xl font-bold text-[#8B5CF6]">+{rewards.fanPoints} FANS</div>
            </div>
          </div>
        )}

        {rewards && rewards.bonusLabels.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5 font-mono-num text-[11px]">
            {rewards.bonusLabels.map((lbl, idx) => (
              <span key={idx} className="bg-[#101522] border border-white/10 text-[#CBD5E1] px-2 py-0.5">
                {lbl}
              </span>
            ))}
          </div>
        )}

        {/* Race Standings Table */}
        <div className="mt-4 bg-[#090D18] border border-white/12 overflow-hidden">
          <table className="w-full text-left text-xs font-mono-num">
            <thead className="bg-[#101522] text-[#94A3B8]">
              <tr>
                <th className="px-3 py-2">POS</th>
                <th className="px-3 py-2">DRIVER</th>
                <th className="px-3 py-2">CAR</th>
                <th className="px-3 py-2 text-right">HITS</th>
                <th className="px-3 py-2 text-right">WRECKS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {hud.standings.map((row) => (
                <tr
                  key={row.id}
                  className={row.isPlayer ? 'bg-[#00C8FF]/18 text-white font-bold' : 'text-[#CBD5E1]'}
                >
                  <td className="px-3 py-2 text-[#00C8FF] font-bold">P{row.position}</td>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 uppercase text-[#94A3B8]">{row.vehicleId.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-right">{row.hitsLanded}</td>
                  <td className="px-3 py-2 text-right text-[#FF365E]">{row.takedowns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onMainMenu}
            className="bg-[#101522] border border-white/20 hover:border-white/50 text-[#F5F7FA] font-display font-bold px-5 py-2.5 text-sm cursor-pointer"
          >
            {t(language, 'mainMenu')}
          </button>
          <button
            type="button"
            data-start="true"
            onClick={onReplay}
            className="bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] font-display font-bold px-6 py-2.5 text-sm nr-clip-btn flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" /> {t(language, 'restart')}
          </button>
        </div>
      </div>
    </div>
  );
};
