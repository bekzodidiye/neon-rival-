import React, { useEffect, useState } from 'react';
import { ArrowLeft, Award, CheckCircle2, Flag, Play, ShieldCheck, Trophy, User } from 'lucide-react';
import type { LanguageCode, PlayerProfile } from '../game/types';
import {
  ACHIEVEMENTS,
  CAREER_EVENTS,
  DAILY_MISSIONS,
  SEED_LEADERBOARD,
  xpForNextLevel,
  type CareerEvent,
} from '../game/progression';
import { t } from '../game/i18n';

interface CareerModalProps {
  profile: PlayerProfile;
  language: LanguageCode;
  onStartCareerEvent: (ev: CareerEvent) => void;
  onClaimMission: (missionId: string, rewardCredits: number) => void;
  onAuthSuccess: (username: string, isGuest: boolean, serverData?: Partial<PlayerProfile>) => void;
  onBack: () => void;
}

export const CareerModal: React.FC<CareerModalProps> = ({
  profile,
  language,
  onStartCareerEvent,
  onClaimMission,
  onAuthSuccess,
  onBack,
}) => {
  const [tab, setTab] = useState<'career' | 'missions' | 'leaderboard' | 'profile'>('career');
  const [leaderboard, setLeaderboard] = useState(SEED_LEADERBOARD);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState(profile.isGuest ? '' : profile.username);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.leaderboard?.length) setLeaderboard(data.leaderboard);
      })
      .catch(() => {});
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthStatus(null);
    if (username.trim().length < 3 || password.length < 4) {
      setAuthError('Enter a username (3+ chars) and password (4+ chars).');
      return;
    }
    try {
      const res = await fetch(`/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(json.error || 'Authentication failed.');
        return;
      }
      onAuthSuccess(json.user.username, false, json.user);
      setAuthStatus(`Signed in as ${json.user.username} (server-persisted).`);
      setPassword('');
    } catch {
      setAuthError('Server unavailable. Continuing in offline guest profile.');
    }
  };

  const nextXp = xpForNextLevel(profile.level);
  const xpPct = Math.min(100, Math.round((profile.xp / Math.max(1, nextXp)) * 100));

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
              <ArrowLeft className="w-4 h-4" /> {t(language, 'back')}
            </button>
            <h1 className="font-display font-bold italic text-2xl tracking-wider text-[#F5F7FA]">
              {t(language, 'career')}
            </h1>
          </div>

          <div className="flex items-center gap-3 font-mono-num text-xs">
            <span className="text-[#00C8FF] font-bold">LVL {profile.level}</span>
            <span className="text-[#25F4A0] font-bold">{profile.credits.toLocaleString()} CR</span>
            <span className="text-[#8B5CF6] font-bold">{profile.fanPoints.toLocaleString()} FANS</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              ['career', 'CAREER EVENTS', Flag],
              ['missions', 'MISSIONS & ACHIEVEMENTS', Award],
              ['leaderboard', 'GLOBAL LEADERBOARD', Trophy],
              ['profile', 'DRIVER ACCOUNT', User],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3.5 py-2 text-xs font-display font-bold tracking-wider flex items-center gap-1.5 cursor-pointer ${
                tab === id
                  ? 'bg-[#00C8FF] text-[#070A12]'
                  : 'bg-[#101522] text-[#94A3B8] hover:text-white border border-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === 'career' && (
          <div className="mt-4 space-y-2.5">
            {CAREER_EVENTS.map((ev) => {
              const completed = profile.completedCareerIds.includes(ev.id);
              return (
                <div
                  key={ev.id}
                  className="bg-[#090D18] border border-white/12 p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="bg-[#8B5CF6]/25 text-[#A78BFA] border border-[#8B5CF6]/50 text-[10px] font-mono-num px-2 py-0.5">
                        STAGE {ev.stage}
                      </span>
                      <h2 className="font-display font-bold text-base text-[#F5F7FA]">{ev.title}</h2>
                      {completed && (
                        <span className="text-[#25F4A0] text-xs font-mono-num flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> CLEARED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#94A3B8] mt-1">
                      Rival: <strong className="text-[#F5F7FA]">{ev.rivalName}</strong> · {ev.objectiveText}
                    </p>
                    <div className="mt-1.5 text-[11px] font-mono-num text-[#64748B]">
                      {ev.trackId.replace('_', ' ').toUpperCase()} · {ev.laps} LAPS · {ev.difficulty.toUpperCase()} · REWARD{' '}
                      <span className="text-[#25F4A0]">+{ev.rewardCredits} CR</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onStartCareerEvent(ev)}
                    className="bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] font-display font-bold text-xs tracking-wider px-4 py-2.5 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> RACE EVENT
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'missions' && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <div className="text-xs font-mono-num text-[#00C8FF] tracking-widest">DAILY MISSIONS</div>
              {DAILY_MISSIONS.map((m) => {
                const current =
                  m.metric === 'races'
                    ? profile.racesCompleted
                    : m.metric === 'wins'
                      ? profile.wins
                      : profile.takedowns;
                const done = current >= m.target;
                const claimed = profile.claimedMissionIds.includes(m.id);
                return (
                  <div key={m.id} className="bg-[#090D18] border border-white/12 p-3.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-display font-bold text-sm text-[#F5F7FA]">{m.title}</div>
                      <div className="text-xs text-[#94A3B8]">{m.description}</div>
                      <div className="mt-1 text-[11px] font-mono-num text-[#00C8FF]">
                        PROGRESS: {Math.min(m.target, current)} / {m.target} · +{m.rewardCredits} CR
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!done || claimed}
                      onClick={() => onClaimMission(m.id, m.rewardCredits)}
                      className={`px-3 py-1.5 text-xs font-display font-bold ${
                        claimed
                          ? 'bg-[#25F4A0]/15 text-[#25F4A0] border border-[#25F4A0]/40'
                          : done
                            ? 'bg-[#25F4A0] text-[#070A12] cursor-pointer'
                            : 'bg-[#101522] text-[#64748B] border border-white/10'
                      }`}
                    >
                      {claimed ? 'CLAIMED' : done ? 'CLAIM' : 'LOCKED'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-mono-num text-[#8B5CF6] tracking-widest">ACHIEVEMENTS</div>
              {ACHIEVEMENTS.map((a) => {
                const unlocked = a.check(profile) || profile.unlockedAchievements.includes(a.id);
                return (
                  <div
                    key={a.id}
                    className={`p-3.5 border ${
                      unlocked ? 'bg-[#101A2C] border-[#25F4A0]/45' : 'bg-[#090D18] border-white/10 opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display font-bold text-sm text-[#F5F7FA]">{a.title}</span>
                      <span className={`text-[10px] font-mono-num ${unlocked ? 'text-[#25F4A0]' : 'text-[#64748B]'}`}>
                        {unlocked ? 'UNLOCKED' : 'IN PROGRESS'}
                      </span>
                    </div>
                    <div className="text-xs text-[#94A3B8] mt-0.5">{a.description}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'leaderboard' && (
          <div className="mt-4 bg-[#090D18] border border-white/12 overflow-hidden">
            <table className="w-full text-left text-xs font-mono-num">
              <thead className="bg-[#101522] text-[#94A3B8]">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">DRIVER</th>
                  <th className="px-4 py-2.5">VEHICLE</th>
                  <th className="px-4 py-2.5 text-right">WINS</th>
                  <th className="px-4 py-2.5 text-right">FAN POINTS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {leaderboard.map((row, idx) => (
                  <tr
                    key={`${row.username}_${idx}`}
                    className={row.username === profile.username ? 'bg-[#00C8FF]/15 text-white' : 'text-[#CBD5E1]'}
                  >
                    <td className="px-4 py-2.5 font-bold text-[#00C8FF]">{idx + 1}</td>
                    <td className="px-4 py-2.5 font-bold">{row.username}</td>
                    <td className="px-4 py-2.5 text-[#94A3B8]">{row.vehicle}</td>
                    <td className="px-4 py-2.5 text-right">{row.wins}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[#25F4A0]">
                      {row.fanPoints.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'profile' && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#090D18] border border-white/12 p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-lg text-[#F5F7FA]">{profile.username}</h2>
                <span className="text-[10px] font-mono-num px-2 py-0.5 border border-[#00C8FF]/50 text-[#00C8FF]">
                  {profile.isGuest ? 'LOCAL GUEST' : 'SERVER ACCOUNT'}
                </span>
              </div>
              <div className="mt-3">
                <div className="flex justify-between text-xs font-mono-num text-[#94A3B8]">
                  <span>LEVEL {profile.level}</span>
                  <span>{profile.xp} / {nextXp} XP</span>
                </div>
                <div className="h-2 bg-[#101522] mt-1">
                  <div className="h-full bg-[#00C8FF]" style={{ width: `${xpPct}%` }} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center font-mono-num">
                <div className="bg-[#101522] p-2.5">
                  <div className="text-lg font-bold text-[#F5F7FA]">{profile.racesCompleted}</div>
                  <div className="text-[10px] text-[#94A3B8]">RACES</div>
                </div>
                <div className="bg-[#101522] p-2.5">
                  <div className="text-lg font-bold text-[#25F4A0]">{profile.wins}</div>
                  <div className="text-[10px] text-[#94A3B8]">WINS</div>
                </div>
                <div className="bg-[#101522] p-2.5">
                  <div className="text-lg font-bold text-[#FF365E]">{profile.takedowns}</div>
                  <div className="text-[10px] text-[#94A3B8]">WRECKS</div>
                </div>
              </div>
            </div>

            <div className="bg-[#090D18] border border-white/12 p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-[#25F4A0]" />
                <h2 className="font-display font-bold text-base text-[#F5F7FA]">SIGN IN / REGISTER PROFILE</h2>
              </div>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setAuthMode('register')}
                  className={`flex-1 py-1.5 text-xs font-display font-bold cursor-pointer ${
                    authMode === 'register' ? 'bg-[#00C8FF] text-[#070A12]' : 'bg-[#101522] text-[#94A3B8]'
                  }`}
                >
                  REGISTER
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className={`flex-1 py-1.5 text-xs font-display font-bold cursor-pointer ${
                    authMode === 'login' ? 'bg-[#00C8FF] text-[#070A12]' : 'bg-[#101522] text-[#94A3B8]'
                  }`}
                >
                  LOGIN
                </button>
              </div>
              <form onSubmit={handleAuthSubmit} className="space-y-2.5">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Driver Callsign (3+ chars)"
                  aria-label="Driver Callsign"
                  className="w-full bg-[#101522] border border-white/20 px-3 py-2 text-sm text-[#F5F7FA]"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password (4+ chars)"
                  aria-label="Password"
                  className="w-full bg-[#101522] border border-white/20 px-3 py-2 text-sm text-[#F5F7FA]"
                />
                {authError && <div className="text-xs text-[#FF365E]">{authError}</div>}
                {authStatus && <div className="text-xs text-[#25F4A0]">{authStatus}</div>}
                <button
                  type="submit"
                  className="w-full bg-[#25F4A0] hover:bg-[#49F7B3] text-[#070A12] font-display font-bold py-2 text-xs tracking-wider cursor-pointer"
                >
                  {authMode === 'register' ? 'CREATE DRIVER ACCOUNT' : 'SIGN IN'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
