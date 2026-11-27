import React, { useState } from 'react';
import { ArrowLeft, Check, Copy, Play, Plus, RefreshCw, Users, Wifi, WifiOff } from 'lucide-react';
import type { GameModeId, LanguageCode, MultiplayerRoomInfo, TrackId } from '../game/types';
import { TRACK_LIST } from '../game/trackMath';
import { t } from '../game/i18n';

interface MultiplayerModalProps {
  language: LanguageCode;
  connected: boolean;
  pingMs: number;
  myPlayerId: string | null;
  room: MultiplayerRoomInfo | null;
  publicRooms: { code: string; trackId: TrackId; mode: GameModeId; playerCount: number; status: string }[];
  errorMessage: string | null;
  onBack: () => void;
  onCreateRoom: (trackId: TrackId, mode: GameModeId, laps: number) => void;
  onJoinRoom: (code: string) => void;
  onQuickMatch: () => void;
  onToggleReady: () => void;
  onStartMatch: () => void;
  onLeaveRoom: () => void;
  onRefreshRooms: () => void;
}

export const MultiplayerModal: React.FC<MultiplayerModalProps> = ({
  language,
  connected,
  pingMs,
  myPlayerId,
  room,
  publicRooms,
  errorMessage,
  onBack,
  onCreateRoom,
  onJoinRoom,
  onQuickMatch,
  onToggleReady,
  onStartMatch,
  onLeaveRoom,
  onRefreshRooms,
}) => {
  const [joinCode, setJoinCode] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<TrackId>('neon_city');
  const [selectedMode, setSelectedMode] = useState<GameModeId>('combat_race');
  const [laps, setLaps] = useState(3);
  const [copied, setCopied] = useState(false);

  const isHost = room ? room.hostId === myPlayerId : false;
  const meInRoom = room?.players.find((p) => p.id === myPlayerId);

  const copyInvite = () => {
    if (!room) return;
    navigator.clipboard?.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

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
              {t(language, 'multiplayer')}
            </h1>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono-num">
            {connected ? (
              <span className="text-[#25F4A0] flex items-center gap-1.5 bg-[#091A18] border border-[#25F4A0]/40 px-3 py-1">
                <Wifi className="w-3.5 h-3.5" /> WS ONLINE · {pingMs}ms
              </span>
            ) : (
              <span className="text-[#FF365E] flex items-center gap-1.5 bg-[#1F0B14] border border-[#FF365E]/40 px-3 py-1">
                <WifiOff className="w-3.5 h-3.5" /> CONNECTING TO SERVER...
              </span>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="mt-3 bg-[#FF365E]/15 border border-[#FF365E] text-[#FF365E] text-xs font-mono-num px-3.5 py-2">
            {errorMessage}
          </div>
        )}

        {!room ? (
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Create Private Room */}
            <div className="bg-[#090D18] border border-white/15 p-4 flex flex-col justify-between">
              <div>
                <h2 className="font-display font-bold text-lg text-[#00C8FF]">{t(language, 'createRoom')}</h2>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Host an authoritative real-time WebSocket lobby (up to 8 live racers + optional AI fill).
                </p>

                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="mp-track" className="block text-[11px] font-mono-num text-[#94A3B8] mb-1">
                      CIRCUIT
                    </label>
                    <select
                      id="mp-track"
                      value={selectedTrack}
                      onChange={(e) => setSelectedTrack(e.target.value as TrackId)}
                      className="w-full bg-[#101522] border border-white/20 px-3 py-2 text-sm text-[#F5F7FA]"
                    >
                      {TRACK_LIST.map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="mp-mode" className="block text-[11px] font-mono-num text-[#94A3B8] mb-1">
                        MODE
                      </label>
                      <select
                        id="mp-mode"
                        value={selectedMode}
                        onChange={(e) => setSelectedMode(e.target.value as GameModeId)}
                        className="w-full bg-[#101522] border border-white/20 px-3 py-2 text-sm text-[#F5F7FA]"
                      >
                        <option value="combat_race">Combat Race</option>
                        <option value="pure_race">Pure Race</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="mp-laps" className="block text-[11px] font-mono-num text-[#94A3B8] mb-1">
                        LAPS
                      </label>
                      <select
                        id="mp-laps"
                        value={laps}
                        onChange={(e) => setLaps(Number(e.target.value))}
                        className="w-full bg-[#101522] border border-white/20 px-3 py-2 text-sm text-[#F5F7FA]"
                      >
                        {[1, 2, 3, 4, 5].map((l) => (
                          <option key={l} value={l}>
                            {l} Laps
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  disabled={!connected}
                  onClick={() => onCreateRoom(selectedTrack, selectedMode, laps)}
                  className="flex-1 bg-[#00C8FF] hover:bg-[#38D6FF] disabled:opacity-40 text-[#070A12] font-display font-bold py-2.5 text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> {t(language, 'createRoom')}
                </button>
                <button
                  type="button"
                  disabled={!connected}
                  onClick={onQuickMatch}
                  className="bg-[#25F4A0] hover:bg-[#4AF7B2] disabled:opacity-40 text-[#070A12] font-display font-bold px-4 py-2.5 text-sm cursor-pointer"
                >
                  QUICK MATCH
                </button>
              </div>
            </div>

            {/* Join Room by Code + Active Public Rooms */}
            <div className="bg-[#090D18] border border-white/15 p-4 flex flex-col">
              <h2 className="font-display font-bold text-lg text-[#25F4A0]">{t(language, 'joinRoom')}</h2>
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (joinCode.trim().length >= 4) onJoinRoom(joinCode.trim().toUpperCase());
                }}
              >
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                  placeholder="ENTER 6-CHAR CODE"
                  aria-label="Room Invite Code"
                  className="flex-1 bg-[#101522] border border-white/20 px-3 py-2 font-mono-num text-sm tracking-widest uppercase text-[#F5F7FA]"
                />
                <button
                  type="submit"
                  disabled={!connected || joinCode.trim().length < 4}
                  className="bg-[#8B5CF6] hover:bg-[#9D74FA] disabled:opacity-40 text-white font-display font-bold px-4 py-2 text-sm cursor-pointer"
                >
                  JOIN
                </button>
              </form>

              <div className="mt-5 flex items-center justify-between">
                <span className="text-xs font-mono-num text-[#94A3B8]">OPEN LOBBIES ({publicRooms.length})</span>
                <button
                  type="button"
                  onClick={onRefreshRooms}
                  className="text-xs font-mono-num text-[#00C8FF] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> REFRESH
                </button>
              </div>

              <div className="mt-2 space-y-2 flex-1">
                {publicRooms.length === 0 ? (
                  <div className="text-xs text-[#64748B] border border-dashed border-white/10 p-4 text-center">
                    No open lobbies right now. Create a room and open a second browser tab with the invite code to test live 2+ player racing!
                  </div>
                ) : (
                  publicRooms.map((r) => (
                    <div
                      key={r.code}
                      className="flex items-center justify-between bg-[#101522] border border-white/10 px-3 py-2"
                    >
                      <div>
                        <div className="font-mono-num font-bold text-sm text-[#F5F7FA]">{r.code}</div>
                        <div className="text-[11px] text-[#94A3B8]">
                          {r.trackId.toUpperCase()} · {r.playerCount}/8 Players
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onJoinRoom(r.code)}
                        className="bg-[#00C8FF] text-[#070A12] font-display font-bold text-xs px-3 py-1.5 cursor-pointer"
                      >
                        JOIN
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Active Room Lobby */
          <div className="mt-5 bg-[#090D18] border border-[#00C8FF]/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
              <div>
                <div className="text-[11px] font-mono-num text-[#94A3B8]">ROOM INVITE CODE</div>
                <div className="flex items-center gap-2.5 mt-0.5">
                  <span className="font-mono-num font-bold text-3xl tracking-[0.2em] text-[#00C8FF]">
                    {room.code}
                  </span>
                  <button
                    type="button"
                    onClick={copyInvite}
                    className="bg-[#101522] border border-white/20 hover:border-[#00C8FF] px-2.5 py-1 text-xs font-mono-num text-[#F5F7FA] flex items-center gap-1 cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-[#25F4A0]" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'COPIED' : 'COPY'}
                  </button>
                </div>
              </div>

              <div className="text-right font-mono-num text-xs text-[#94A3B8]">
                <div className="text-[#F5F7FA] font-bold">{room.trackId.replace('_', ' ').toUpperCase()}</div>
                <div>{room.mode.replace('_', ' ').toUpperCase()} · {room.laps} LAPS</div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-mono-num text-[#94A3B8] mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> CONNECTED DRIVERS ({room.players.length} / 8)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {room.players.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-[#101522] border border-white/15 px-3.5 py-2.5"
                  >
                    <div>
                      <div className="font-display font-bold text-sm text-[#F5F7FA]">
                        {p.name}{' '}
                        {p.isHost && <span className="text-[10px] font-mono-num text-[#FF8A00] ml-1">[HOST]</span>}
                        {p.id === myPlayerId && <span className="text-[10px] font-mono-num text-[#00C8FF] ml-1">(YOU)</span>}
                      </div>
                      <div className="text-[11px] font-mono-num text-[#94A3B8] uppercase">
                        {p.vehicleId.replace('_', ' ')}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-mono-num font-bold px-2.5 py-1 ${
                        p.ready
                          ? 'bg-[#25F4A0]/20 text-[#25F4A0] border border-[#25F4A0]/50'
                          : 'bg-white/5 text-[#94A3B8] border border-white/10'
                      }`}
                    >
                      {p.ready ? 'READY' : 'WAITING'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={onLeaveRoom}
                className="bg-[#1F0B14] border border-[#FF365E]/50 text-[#FF365E] hover:bg-[#FF365E]/20 px-4 py-2 text-xs font-display font-bold tracking-wider cursor-pointer"
              >
                {t(language, 'leaveRoom')}
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={onToggleReady}
                  className={`px-5 py-2.5 text-sm font-display font-bold tracking-wider cursor-pointer ${
                    meInRoom?.ready
                      ? 'bg-[#25F4A0]/20 text-[#25F4A0] border border-[#25F4A0]'
                      : 'bg-[#101522] text-white border border-white/25 hover:border-[#25F4A0]'
                  }`}
                >
                  {meInRoom?.ready ? t(language, 'notReady') : t(language, 'ready')}
                </button>

                {isHost && (
                  <button
                    type="button"
                    onClick={onStartMatch}
                    className="bg-[#00C8FF] hover:bg-[#38D6FF] text-[#070A12] font-display font-bold px-6 py-2.5 text-sm nr-clip-btn flex items-center gap-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" /> {t(language, 'startMatch')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
