import React, { useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import type { Difficulty, GameModeId, LanguageCode, TrackId } from '../game/types';
import { TRACK_LIST } from '../game/trackMath';
import { t } from '../game/i18n';

interface RaceSetupModalProps {
  language: LanguageCode;
  initialMode?: GameModeId;
  initialTrack?: TrackId;
  initialDifficulty?: Difficulty;
  initialLaps?: number;
  onLaunch: (params: { mode: GameModeId; trackId: TrackId; difficulty: Difficulty; laps: number }) => void;
  onBack: () => void;
}

const MODES: { id: GameModeId; label: string; desc: string; accent: string }[] = [
  { id: 'combat_race', label: 'COMBAT RACE', desc: 'All 8 energy power-ups · 8-car street battle', accent: '#00C8FF' },
  { id: 'destruction_arena', label: 'DESTRUCTION', desc: 'Score combat hits & wrecks before the clock runs out', accent: '#FF8A00' },
  { id: 'checkpoint', label: 'CHECKPOINT', desc: 'Beat the clock by chaining high-speed time gates', accent: '#00F5D4' },
  { id: 'pure_race', label: 'PURE RACE', desc: 'Zero weapons · Pure high-speed apex racing', accent: '#25F4A0' },
  { id: 'elimination', label: 'ELIMINATION', desc: 'Last-place driver knocked out every 20 seconds', accent: '#FF365E' },
  { id: 'time_trial', label: 'TIME TRIAL', desc: 'Solo track run to beat your personal best lap', accent: '#8B5CF6' },
];

const TRACK_TIME_LABEL: Record<TrackId, string> = {
  neon_city: 'NIGHT',
  industrial_port: 'DAYTIME',
  midnight_streets: 'SUNSET',
};

export const RaceSetupModal: React.FC<RaceSetupModalProps> = ({
  language,
  initialMode = 'combat_race',
  initialTrack = 'neon_city',
  initialDifficulty = 'normal',
  initialLaps = 3,
  onLaunch,
  onBack,
}) => {
  const [mode, setMode] = useState<GameModeId>(initialMode);
  const [trackId, setTrackId] = useState<TrackId>(initialTrack);
  const [difficulty, setDifficulty] = useState<Difficulty>(initialDifficulty);
  const [laps, setLaps] = useState<number>(initialLaps);

  return (
    <div className="fixed inset-0 z-30 bg-[#070A12]/88 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-[#0C111E] border border-white/20 p-5 sm:p-6 max-h-[90vh] overflow-y-auto nr-scroll">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="bg-[#101522] border border-white/20 hover:border-[#00C8FF] px-3 py-1.5 text-xs font-display font-bold tracking-widest flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> {t(language, 'back')}
            </button>
            <h1 className="font-display font-bold italic text-2xl tracking-wider text-[#F5F7FA]">
              {t(language, 'raceSetup')}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => onLaunch({ mode, trackId, difficulty, laps })}
            className="bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] font-display font-bold tracking-wider px-6 py-2.5 text-sm nr-clip-btn flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" /> {t(language, 'play')}
          </button>
        </div>

        {/* Game Mode Cards */}
        <div className="mt-5">
          <div className="text-xs font-mono-num text-[#94A3B8] tracking-widest mb-2">SELECT MODE</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {MODES.map((m) => {
              const selected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className="p-3 text-left border transition cursor-pointer"
                  style={{
                    backgroundColor: selected ? '#141D33' : '#090D18',
                    borderColor: selected ? m.accent : 'rgba(255,255,255,0.12)',
                  }}
                >
                  <div className="font-display font-bold text-sm" style={{ color: selected ? m.accent : '#F5F7FA' }}>
                    {m.label}
                  </div>
                  <div className="mt-1 text-[11px] text-[#94A3B8] leading-snug">{m.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Track Selection */}
        <div className="mt-5">
          <div className="text-xs font-mono-num text-[#94A3B8] tracking-widest mb-2">SELECT CIRCUIT</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TRACK_LIST.map((tr) => {
              const selected = trackId === tr.id;
              return (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => setTrackId(tr.id)}
                  className={`p-3.5 text-left border transition cursor-pointer ${
                    selected
                      ? 'bg-[#121C32] border-[#00C8FF]'
                      : 'bg-[#090D18] border-white/12 hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold italic text-base text-[#F5F7FA]">{tr.name}</span>
                    <span className="text-[10px] font-mono-num text-[#00C8FF]">{TRACK_TIME_LABEL[tr.id]}</span>
                  </div>
                  <div className="mt-1 text-xs text-[#94A3B8]">{tr.subtitle}</div>
                  <div className="mt-2 flex gap-2 text-[10px] font-mono-num text-[#64748B]">
                    <span>WIDTH {tr.roadWidth}M</span>
                    <span>·</span>
                    <span>TUNNELS {tr.tunnelRanges.length}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Difficulty & Laps */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-[#090D18] border border-white/10 p-3.5">
            <div className="text-xs font-mono-num text-[#94A3B8] mb-2">AI OPPONENT DIFFICULTY</div>
            <div className="grid grid-cols-4 gap-2">
              {(['easy', 'normal', 'hard', 'expert'] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(d)}
                  className={`py-2 text-xs font-display font-bold uppercase border cursor-pointer ${
                    difficulty === d
                      ? 'bg-[#8B5CF6] text-white border-[#8B5CF6]'
                      : 'bg-[#101522] text-[#94A3B8] border-white/10'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#090D18] border border-white/10 p-3.5">
            <div className="text-xs font-mono-num text-[#94A3B8] mb-2">RACE LAPS</div>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLaps(n)}
                  className={`py-2 text-xs font-mono-num font-bold border cursor-pointer ${
                    laps === n
                      ? 'bg-[#00C8FF] text-[#070A12] border-[#00C8FF]'
                      : 'bg-[#101522] text-[#94A3B8] border-white/10'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
