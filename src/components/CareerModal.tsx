import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  Cloud,
  Flag,
  Lock,
  Play,
  ShieldCheck,
  Sliders,
  Star,
  Trophy,
  User,
} from 'lucide-react';
import type { LanguageCode, PlayerProfile } from '../game/types';
import { ACHIEVEMENTS, DAILY_MISSIONS, xpForNextLevel } from '../game/progression';
import {
  CAREER_GROUPS,
  MULTIPLAYER_MODS,
  canActivatePrestige,
  computeOnlineRankFromXp,
  type CareerEventDef,
} from '../game/career';
import { VEHICLES } from '../game/vehicles';
import { t } from '../game/i18n';

interface VerifiedLeaderboardRow {
  username: string;
  fanPoints: number;
  wins: number;
  vehicle: string;
  verified?: boolean;
}

interface CareerModalProps {
  profile: PlayerProfile;
  language: LanguageCode;
  cloudUserEmail: string | null;
  cloudSyncStatus: string | null;
  onStartCareerEvent: (ev: CareerEventDef) => void;
  onClaimMission: (missionId: string, rewardCredits: number) => void;
  onToggleMod: (modId: string) => void;
  onActivatePrestige: () => void;
  onGoogleSignIn: () => void;
  onGoogleSignOut: () => void;
  onAuthSuccess: (username: string, isGuest: boolean, serverData?: Partial<PlayerProfile>, token?: string) => void;
  onBack: () => void;
}

export const CareerModal: React.FC<CareerModalProps> = ({
  profile,
  language,
  cloudUserEmail,
  cloudSyncStatus,
  onStartCareerEvent,
  onClaimMission,
  onToggleMod,
  onActivatePrestige,
  onGoogleSignIn,
  onGoogleSignOut,
  onAuthSuccess,
  onBack,
}) => {
  const [tab, setTab] = useState<'career' | 'mods' | 'missions' | 'leaderboard' | 'profile'>('career');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(CAREER_GROUPS[0].id);
  const [confirmPrestige, setConfirmPrestige] = useState(false);
  const [leaderboard, setLeaderboard] = useState<VerifiedLeaderboardRow[]>([]);
  const [leaderboardLoaded, setLeaderboardLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState(profile.isGuest ? '' : profile.username);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);

  useEffect(() => {
    const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '').replace(/\/$/, '');
    fetch(`${apiBase}/api/leaderboard`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.leaderboard)) {
          setLeaderboard(data.leaderboard);
        }
      })
      .catch(() => {})
      .finally(() => setLeaderboardLoaded(true));
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthStatus(null);
    if (username.trim().length < 3 || password.length < 6) {
      setAuthError('Enter a username (3+ chars) and password (6+ chars).');
      return;
    }
    try {
      const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '').replace(/\/$/, '');
      const res = await fetch(`${apiBase}/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(json.error || 'Authentication failed.');
        return;
      }
      onAuthSuccess(json.user.username, false, json.user, json.token);
      setAuthStatus(`Signed in as ${json.user.username} (server-persisted).`);
      setPassword('');
    } catch {
      setAuthError('Server unavailable. Continuing in offline guest profile.');
    }
  };

  const nextXp = xpForNextLevel(profile.level);
  const xpPct = Math.min(100, Math.round((profile.xp / Math.max(1, nextXp)) * 100));
  const totalLights = profile.careerLights ?? 0;
  const activeGroup = CAREER_GROUPS.find((g) => g.id === selectedGroupId) ?? CAREER_GROUPS[0];
  const onlineRankInfo = computeOnlineRankFromXp(profile.onlineXp ?? 0);
  const effectiveOnlineRank = Math.max(profile.onlineRank ?? 1, onlineRankInfo.rank);
  const prestigeReady = canActivatePrestige(effectiveOnlineRank, profile.prestigeTier ?? 0);

  return (
    <div className="fixed inset-0 z-30 bg-[#070A12]/90 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-[#0C111E] border border-white/20 p-5 sm:p-6 max-h-[90vh] overflow-y-auto nr-scroll">
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

          <div className="flex flex-wrap items-center gap-3 font-mono-num text-xs">
            <span className="text-[#FACC15] font-bold flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-current" /> {totalLights} LIGHTS
            </span>
            <span className="text-[#00C8FF] font-bold">RANK {effectiveOnlineRank}</span>
            {(profile.prestigeTier ?? 0) > 0 && (
              <span className="text-[#FF8A00] font-bold">PRESTIGE {profile.prestigeTier}</span>
            )}
            <span className="text-[#25F4A0] font-bold">{profile.credits.toLocaleString()} CR</span>
            <span className="text-[#8B5CF6] font-bold">{profile.fanPoints.toLocaleString()} FANS</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-4 flex flex-wrap lg:flex-nowrap gap-2">
          {(
            [
              ['career', 'CAREER GROUPS (9)', Flag],
              ['mods', 'MODS & MASTERY', Sliders],
              ['missions', 'MISSIONS', Award],
              ['leaderboard', 'LEADERBOARD', Trophy],
              ['profile', 'DRIVER ACCOUNT', User],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-[11px] font-display font-bold tracking-wider whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                tab === id
                  ? 'bg-[#00C8FF] text-[#070A12]'
                  : 'bg-[#101522] text-[#94A3B8] hover:text-white border border-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* 9 CAREER GROUPS + 7 STREET INITIATION EVENTS + LIGHTS + RIVAL SHOWDOWNS */}
        {tab === 'career' && (
          <div className="mt-4 space-y-4">
            {/* Group Selector Strip */}
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5">
              {CAREER_GROUPS.map((grp) => {
                const unlocked = totalLights >= grp.requiredLights;
                const active = grp.id === activeGroup.id;
                const grpLights = grp.events.reduce(
                  (acc, ev) => acc + (profile.careerRecords?.[ev.id]?.lightsEarned ?? 0),
                  0,
                );
                const maxGrpLights = grp.events.length * 5;
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => setSelectedGroupId(grp.id)}
                    className={`p-2 text-left border transition cursor-pointer ${
                      active
                        ? 'bg-[#131E34] border-[#00C8FF]'
                        : unlocked
                          ? 'bg-[#090D18] border-white/15 hover:border-white/35'
                          : 'bg-[#070A12] border-white/10 opacity-65'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono-num">
                      <span style={{ color: grp.accentColor }}>G{grp.index}</span>
                      {!unlocked && <Lock className="w-3 h-3 text-[#64748B]" />}
                    </div>
                    <div className="font-display font-bold text-[11px] text-[#F5F7FA] truncate mt-0.5">
                      {grp.name}
                    </div>
                    <div className="text-[10px] font-mono-num text-[#94A3B8]">
                      {unlocked ? `${grpLights}/${maxGrpLights} ★` : `${grp.requiredLights} ★ REQ`}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Active Group Header + Rival Boss Strip */}
            <div
              className="bg-[#090D18] border p-4 flex flex-wrap items-center justify-between gap-3"
              style={{ borderColor: `${activeGroup.accentColor}66` }}
            >
              <div>
                <div className="text-[10px] font-mono-num tracking-widest" style={{ color: activeGroup.accentColor }}>
                  GROUP {activeGroup.index} OF 9 · {activeGroup.subtitle.toUpperCase()}
                </div>
                <h2 className="font-display font-bold italic text-xl text-[#F5F7FA]">{activeGroup.name}</h2>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  Rival Boss: <strong className="text-[#F5F7FA]">{activeGroup.rival.name}</strong> ({activeGroup.rival.title}) — "{activeGroup.rival.quote}"
                </p>
              </div>
              <div className="text-right font-mono-num text-xs">
                <div className="text-[#94A3B8]">UNLOCK REQUIREMENT</div>
                <div className={totalLights >= activeGroup.requiredLights ? 'text-[#25F4A0] font-bold' : 'text-[#FF8A00] font-bold'}>
                  {totalLights} / {activeGroup.requiredLights} LIGHTS
                </div>
              </div>
            </div>

            {/* Group Events */}
            <div className="space-y-2.5">
              {activeGroup.events.map((ev) => {
                const rec = profile.careerRecords?.[ev.id];
                const earned = rec?.lightsEarned ?? 0;
                const groupUnlocked = totalLights >= activeGroup.requiredLights;
                const rivalLocked = Boolean(ev.isRivalShowdown && totalLights < activeGroup.rival.unlockLightsRequired);
                const isLocked = !groupUnlocked || rivalLocked;

                return (
                  <div
                    key={ev.id}
                    className={`bg-[#090D18] border p-4 flex flex-wrap items-center justify-between gap-3 ${
                      ev.isRivalShowdown ? 'border-[#FF365E]/50' : 'border-white/12'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="bg-[#101522] text-[#00C8FF] border border-white/15 text-[10px] font-mono-num px-2 py-0.5">
                          #{ev.order} · {ev.mode.replace('_', ' ').toUpperCase()}
                        </span>
                        <h3 className="font-display font-bold text-base text-[#F5F7FA]">{ev.title}</h3>
                        {ev.isRivalShowdown && (
                          <span className="bg-[#FF365E]/20 text-[#FF365E] border border-[#FF365E]/40 text-[10px] font-mono-num px-2 py-0.5">
                            1v1 BOSS SHOWDOWN
                          </span>
                        )}
                        {rec?.completed && (
                          <span className="text-[#25F4A0] text-xs font-mono-num flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> CLEARED
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#94A3B8] mt-1">{ev.objectiveText}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] font-mono-num text-[#64748B]">
                        <span>{ev.trackId.replace('_', ' ').toUpperCase()}</span>
                        <span>· {ev.laps} LAPS · {ev.difficulty.toUpperCase()}</span>
                        <span className="text-[#25F4A0]">+{ev.rewardCredits} CR</span>
                        {ev.fanDemand && (
                          <span className="text-[#FACC15]">DEMAND: {ev.fanDemand.label}</span>
                        )}
                        <span className="flex items-center gap-0.5 text-[#FACC15]">
                          {[1, 2, 3, 4, 5].map((starIdx) => (
                            <Star
                              key={starIdx}
                              className={`w-3.5 h-3.5 ${starIdx <= earned ? 'fill-current text-[#FACC15]' : 'text-[#334155]'}`}
                            />
                          ))}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => onStartCareerEvent(ev)}
                      className={`font-display font-bold text-xs tracking-wider px-4 py-2.5 flex items-center gap-1.5 ${
                        isLocked
                          ? 'bg-[#101522] text-[#64748B] border border-white/10 cursor-not-allowed'
                          : ev.isRivalShowdown
                            ? 'bg-[#FF365E] hover:bg-[#FF5578] text-white cursor-pointer'
                            : 'bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] cursor-pointer'
                      }`}
                    >
                      {isLocked ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          {rivalLocked
                            ? `${activeGroup.rival.unlockLightsRequired} ★ REQ`
                            : `${activeGroup.requiredLights} ★ REQ`}
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" /> RACE EVENT
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* BOUNDED MULTIPLAYER MODS + VEHICLE MASTERY + PRESTIGE */}
        {tab === 'mods' && (
          <div className="mt-4 space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-mono-num text-[#00C8FF] tracking-widest">
                  PASSIVE LOADOUT MODS ({(profile.equippedMods ?? []).length} / 3 EQUIPPED — STRICTLY BOUNDED)
                </div>
                <span className="text-[11px] font-mono-num text-[#94A3B8]">
                  ONLINE RANK {effectiveOnlineRank} / 50
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {MULTIPLAYER_MODS.map((mod) => {
                  const equipped = (profile.equippedMods ?? []).includes(mod.id);
                  const unlocked = effectiveOnlineRank >= mod.unlockRank;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      disabled={!unlocked}
                      onClick={() => onToggleMod(mod.id)}
                      className={`p-3 text-left border transition ${
                        equipped
                          ? 'bg-[#102333] border-[#00C8FF] cursor-pointer'
                          : unlocked
                            ? 'bg-[#090D18] border-white/15 hover:border-white/35 cursor-pointer'
                            : 'bg-[#070A12] border-white/10 opacity-60 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono-num">
                        <span className="uppercase text-[#8B5CF6]">{mod.category}</span>
                        <span className={equipped ? 'text-[#25F4A0] font-bold' : unlocked ? 'text-[#94A3B8]' : 'text-[#FF8A00]'}>
                          {equipped ? 'EQUIPPED' : unlocked ? 'AVAILABLE' : `RANK ${mod.unlockRank}`}
                        </span>
                      </div>
                      <div className="font-display font-bold text-sm text-[#F5F7FA] mt-1">{mod.name}</div>
                      <div className="text-xs text-[#94A3B8] mt-0.5">{mod.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vehicle Mastery Grid */}
            <div>
              <div className="text-xs font-mono-num text-[#25F4A0] tracking-widest mb-2">
                VEHICLE MASTERY PROGRESSION
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {VEHICLES.map((v) => {
                  const m = profile.vehicleMastery?.[v.id];
                  const lvl = m?.masteryLevel ?? 1;
                  return (
                    <div key={v.id} className="bg-[#090D18] border border-white/12 p-3 font-mono-num">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#00C8FF]">CLS {v.vehicleClass}</span>
                        <span className="text-[#FACC15] font-bold">M-LVL {lvl}/10</span>
                      </div>
                      <div className="font-display font-bold text-sm text-[#F5F7FA] mt-0.5 truncate">{v.name}</div>
                      <div className="mt-2 space-y-0.5 text-[10px] text-[#94A3B8]">
                        <div>RACES: {m?.racesCompleted ?? 0} · WINS: {m?.wins ?? 0}</div>
                        <div>DIST: {((m?.distanceMeters ?? 0) / 1000).toFixed(1)} KM</div>
                        <div>COMBAT: {m?.combatActions ?? 0} · DEF: {m?.defensiveActions ?? 0}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Online Prestige Advancement */}
            <div className="bg-[#090D18] border border-[#FF8A00]/40 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-mono-num text-[#FF8A00] tracking-widest">
                  ONLINE PRESTIGE TIER {profile.prestigeTier ?? 0} / 10
                </div>
                <div className="text-xs text-[#94A3B8] mt-1">
                  Reach Online Rank 50 through verified multiplayer matches to unlock optional Prestige. Cosmetics, owned vehicles, Vehicle Mastery, and Career Lights are always preserved.
                </div>
              </div>
              {prestigeReady ? (
                confirmPrestige ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onActivatePrestige();
                        setConfirmPrestige(false);
                      }}
                      className="bg-[#FF8A00] text-[#070A12] font-display font-bold text-xs px-4 py-2 cursor-pointer"
                    >
                      CONFIRM PRESTIGE
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPrestige(false)}
                      className="bg-[#101522] text-[#94A3B8] border border-white/15 font-display font-bold text-xs px-3 py-2 cursor-pointer"
                    >
                      CANCEL
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmPrestige(true)}
                    className="bg-[#FF8A00] hover:bg-[#FFA433] text-[#070A12] font-display font-bold text-xs px-4 py-2 cursor-pointer"
                  >
                    ENTER PRESTIGE {(profile.prestigeTier ?? 0) + 1}
                  </button>
                )
              ) : (
                <span className="text-xs font-mono-num text-[#64748B]">
                  REQUIRES ONLINE RANK 50
                </span>
              )}
            </div>
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
            {leaderboard.length === 0 ? (
              <div className="p-8 text-center">
                <Trophy className="w-7 h-7 text-[#00C8FF] mx-auto mb-2 opacity-80" />
                <div className="font-display font-bold text-sm tracking-wider text-[#F5F7FA]">
                  {leaderboardLoaded ? 'NO VERIFIED ONLINE MATCHES RECORDED YET' : 'LOADING VERIFIED RANKINGS...'}
                </div>
                <p className="mt-1.5 text-xs text-[#94A3B8] max-w-md mx-auto">
                  Only server-verified authoritative multiplayer matches count toward competitive rankings. Offline single-player races remain local to your device.
                </p>
              </div>
            ) : (
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
            )}
          </div>
        )}

        {tab === 'profile' && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4">
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

              {/* Firebase Cloud Save Card */}
              <div className="bg-[#090D18] border border-[#00C8FF]/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Cloud className="w-4 h-4 text-[#00C8FF]" />
                  <h2 className="font-display font-bold text-sm text-[#F5F7FA]">CLOUD CAREER SYNC (FIREBASE)</h2>
                </div>
                <p className="text-xs text-[#94A3B8] mb-3">
                  Sign in with Google to back up your Career Lights, Vehicle Mastery, and unlocked vehicles across devices. Competitive rankings remain strictly server-verified.
                </p>
                {cloudUserEmail ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-mono-num text-[#25F4A0] truncate">
                      CONNECTED: {cloudUserEmail}
                    </div>
                    <button
                      type="button"
                      onClick={onGoogleSignOut}
                      className="bg-[#101522] border border-white/20 hover:border-[#FF365E] text-xs font-display font-bold px-3 py-1.5 cursor-pointer"
                    >
                      SIGN OUT
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onGoogleSignIn}
                    className="w-full bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] font-display font-bold py-2 text-xs tracking-wider cursor-pointer"
                  >
                    SIGN IN WITH GOOGLE FOR CLOUD SAVE
                  </button>
                )}
                {cloudSyncStatus && (
                  <div className="mt-2 text-[11px] font-mono-num text-[#94A3B8]">{cloudSyncStatus}</div>
                )}
              </div>
            </div>

            <div className="bg-[#090D18] border border-white/12 p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-[#25F4A0]" />
                <h2 className="font-display font-bold text-base text-[#F5F7FA]">MULTIPLAYER SERVER ACCOUNT</h2>
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
                  placeholder="Password (6+ chars)"
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
