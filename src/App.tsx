import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RaceEngine } from './engine/RaceEngine';
import { MultiplayerClient } from './net/multiplayerClient';
import type {
  AppScreen,
  Difficulty,
  GameModeId,
  MultiplayerRoomInfo,
  PlayerProfile,
  RaceConfig,
  RaceHudSnapshot,
  RaceRewards,
  SettingsState,
  TrackId,
  VehicleCustomization,
} from './game/types';
import { getVehicleById, VEHICLES } from './game/vehicles';
import {
  calculateRaceRewards,
  loadLocalProfile,
  loadLocalSettings,
  saveLocalProfile,
  saveLocalSettings,
  xpForNextLevel,
  type CareerEvent,
} from './game/progression';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { MainMenuOverlay } from './components/MainMenuOverlay';
import { HudOverlay } from './components/HudOverlay';
import { GarageDock } from './components/GarageDock';
import { RaceSetupModal } from './components/RaceSetupModal';
import { MultiplayerModal } from './components/MultiplayerModal';
import { CareerModal } from './components/CareerModal';
import { SettingsModal } from './components/SettingsModal';
import { PauseModal, ResultsModal } from './components/PauseResultsModals';

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RaceEngine | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);

  const [profile, setProfile] = useState<PlayerProfile>(() => loadLocalProfile());
  const [settings, setSettings] = useState<SettingsState>(() => loadLocalSettings());
  const [screen, setScreen] = useState<AppScreen>('title');
  const [previousScreen, setPreviousScreen] = useState<AppScreen>('title');
  const [viewingVehicleId, setViewingVehicleId] = useState<string>(() => loadLocalProfile().selectedVehicleId);
  const [hud, setHud] = useState<RaceHudSnapshot | null>(null);
  const [lastRaceConfig, setLastRaceConfig] = useState<RaceConfig | null>(null);
  const [activeCareerEventId, setActiveCareerEventId] = useState<string | null>(null);
  const [rewards, setRewards] = useState<RaceRewards | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Multiplayer state
  const [mpConnected, setMpConnected] = useState(false);
  const [mpPing, setMpPing] = useState(0);
  const [mpRoom, setMpRoom] = useState<MultiplayerRoomInfo | null>(null);
  const [mpPublicRooms, setMpPublicRooms] = useState<
    { code: string; trackId: TrackId; mode: GameModeId; playerCount: number; status: string }[]
  >([]);
  const [mpError, setMpError] = useState<string | null>(null);

  const isOnline = useOnlineStatus();

  // Keep latest state accessible to imperative engine callbacks without re-mounting WebGL
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const lastConfigRef = useRef(lastRaceConfig);
  lastConfigRef.current = lastRaceConfig;
  const careerIdRef = useRef(activeCareerEventId);
  careerIdRef.current = activeCareerEventId;
  // Keep session Bearer token strictly in memory (never persisted to localStorage)
  const authTokenRef = useRef<string | null>(null);

  // Mirror state machine to document.body.dataset.state for accessibility & testing
  useEffect(() => {
    const bodyState =
      screen === 'playing'
        ? 'playing'
        : screen === 'paused'
          ? 'paused'
          : screen === 'results'
            ? 'gameover'
            : 'title';
    document.body.dataset.state = bodyState;
  }, [screen]);

  const handleRaceFinished = useCallback((finalSnap: RaceHudSnapshot) => {
    const p = profileRef.current;
    const cfg = lastConfigRef.current;
    const playerStanding = finalSnap.standings.find((s) => s.isPlayer);

    const earned = calculateRaceRewards({
      position: finalSnap.position,
      totalRacers: finalSnap.totalRacers,
      hitsLanded: playerStanding?.hitsLanded ?? 0,
      takedowns: playerStanding?.takedowns ?? 0,
      blocksLanded: 0,
      difficulty: cfg?.difficulty ?? 'normal',
      currentLevel: p.level,
      currentXp: p.xp,
    });

    setRewards(earned);
    setScreen('results');

    // Update persistent profile
    let nextLevel = p.level;
    let nextXp = p.xp + earned.xp;
    while (nextXp >= xpForNextLevel(nextLevel)) {
      nextXp -= xpForNextLevel(nextLevel);
      nextLevel += 1;
    }

    const completedCareerIds = [...p.completedCareerIds];
    if (careerIdRef.current && finalSnap.position <= 3 && !completedCareerIds.includes(careerIdRef.current)) {
      completedCareerIds.push(careerIdRef.current);
    }

    const updated: PlayerProfile = {
      ...p,
      level: nextLevel,
      xp: nextXp,
      credits: p.credits + earned.credits,
      fanPoints: p.fanPoints + earned.fanPoints,
      racesCompleted: p.racesCompleted + 1,
      wins: p.wins + (finalSnap.position === 1 ? 1 : 0),
      takedowns: p.takedowns + (playerStanding?.takedowns ?? 0),
      completedCareerIds,
    };
    setProfile(updated);
    saveLocalProfile(updated);

    // Report authenticated race summary to server for server-authoritative reward verification
    const token = authTokenRef.current;
    if (token) {
      const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '').replace(/\/$/, '');
      const transactionId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `race_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      fetch(`${apiBase}/api/race/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          transactionId,
          position: finalSnap.position,
          totalRacers: finalSnap.totalRacers,
          hitsLanded: playerStanding?.hitsLanded ?? 0,
          takedowns: playerStanding?.takedowns ?? 0,
          blocksLanded: 0,
          difficulty: cfg?.difficulty ?? 'normal',
          vehicle: getVehicleById(updated.selectedVehicleId).name,
        }),
      }).catch(() => {});
    }
  }, []);

  const launchRace = useCallback(
    (
      params: {
        mode: GameModeId;
        trackId: TrackId;
        difficulty: Difficulty;
        laps: number;
        isMultiplayer?: boolean;
        roomCode?: string;
        careerEventId?: string | null;
      },
      remotePlayers: { id: string; name: string; vehicleId: string; customization: VehicleCustomization }[] = [],
    ) => {
      const eng = engineRef.current;
      if (!eng) return;
      const p = profileRef.current;
      const carId = p.selectedVehicleId;
      const custom = p.customizations[carId] ?? getVehicleById(carId).defaultCustomization;
      const config: RaceConfig = {
        mode: params.mode,
        trackId: params.trackId,
        laps: params.laps,
        difficulty: params.difficulty,
        vehicleId: carId,
        customization: custom,
        aiCount: params.mode === 'time_trial' ? 0 : 7,
        isMultiplayer: Boolean(params.isMultiplayer),
        roomCode: params.roomCode,
      };
      setLastRaceConfig(config);
      setActiveCareerEventId(params.careerEventId ?? null);
      setRewards(null);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body.dataset.state = 'playing';
      setScreen('playing');
      eng.startRace(config, p.username, remotePlayers);
    },
    [],
  );

  // Mount Three.js RaceEngine ONCE inside isolated ref container
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let engine: RaceEngine;
    try {
      engine = new RaceEngine(
        container,
        {
          onHudUpdate: (snap) => setHud(snap),
          onPauseToggle: () => {
            if (screenRef.current === 'playing') {
              engine.setMode('paused');
              setScreen('paused');
            } else if (screenRef.current === 'paused') {
              engine.setMode('playing');
              setScreen('playing');
            }
          },
          onRaceFinished: handleRaceFinished,
          onSendMultiplayerState: (st) => mpClientRef.current?.sendRaceState(st),
          onSendMultiplayerCombat: (ev) => mpClientRef.current?.sendCombatEvent(ev),
        },
        settings,
      );
      engineRef.current = engine;
    } catch (err) {
      setWebglError(err instanceof Error ? err.message : 'WebGL2 could not be initialized on this browser.');
      return;
    }

    // Apply saved car customization to showcase
    const initProf = profileRef.current;
    const carCustom =
      initProf.customizations[initProf.selectedVehicleId] ??
      getVehicleById(initProf.selectedVehicleId).defaultCustomization;
    engine.setShowcaseVehicle(initProf.selectedVehicleId, carCustom);

    // Check ?autostart=1 query param to skip title straight into active Combat Race
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('autostart') === '1') {
      launchRace({ mode: 'combat_race', trackId: 'neon_city', difficulty: 'normal', laps: 3 });
    }

    // Initialize WebSocket Multiplayer Client
    const mp = new MultiplayerClient({
      onConnectionChange: (conn) => setMpConnected(conn),
      onRoomUpdate: (r) => {
        setMpRoom(r);
        setMpError(null);
      },
      onPublicRooms: (list) => setMpPublicRooms(list),
      onRaceStart: (startedRoom) => {
        const remotes = startedRoom.players
          .filter((pl) => pl.id !== mp.playerId)
          .map((pl) => ({
            id: pl.id,
            name: pl.name,
            vehicleId: pl.vehicleId,
            customization:
              pl.customization && pl.customization.bodyColor
                ? pl.customization
                : getVehicleById(pl.vehicleId).defaultCustomization,
          }));
        launchRace(
          {
            mode: startedRoom.mode,
            trackId: startedRoom.trackId,
            difficulty: 'normal',
            laps: startedRoom.laps,
            isMultiplayer: true,
            roomCode: startedRoom.code,
          },
          remotes,
        );
      },
      onRemoteState: (patch) => engineRef.current?.applyRemoteRacerUpdate(patch),
      onRemoteCombat: (ownerId, type, rear) => engineRef.current?.applyRemoteCombatEvent(ownerId, type, rear),
      onPing: (ms) => {
        setMpPing(ms);
        engineRef.current?.setPing(ms);
      },
      onError: (msg) => setMpError(msg),
    });
    mpClientRef.current = mp;
    mp.connect();

    return () => {
      mp.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
    // Mount WebGL & WS exactly once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bind Enter / Space on Title screen to launch Quick Race immediately
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (screenRef.current !== 'title') return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        launchRace({ mode: 'combat_race', trackId: 'neon_city', difficulty: 'normal', laps: 3 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [launchRace]);

  const updateSettings = (patch: Partial<SettingsState>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveLocalSettings(next);
      engineRef.current?.applySettings(next);
      return next;
    });
  };

  const openGarage = () => {
    engineRef.current?.audio.unlock();
    engineRef.current?.audio.playUiClick();
    setViewingVehicleId(profile.selectedVehicleId);
    const custom =
      profile.customizations[profile.selectedVehicleId] ??
      getVehicleById(profile.selectedVehicleId).defaultCustomization;
    engineRef.current?.setShowcaseVehicle(profile.selectedVehicleId, custom);
    engineRef.current?.setMode('garage');
    setScreen('garage');
  };

  const returnToTitle = () => {
    engineRef.current?.audio.playUiClick();
    const custom =
      profile.customizations[profile.selectedVehicleId] ??
      getVehicleById(profile.selectedVehicleId).defaultCustomization;
    engineRef.current?.setShowcaseVehicle(profile.selectedVehicleId, custom);
    engineRef.current?.setMode('title');
    setScreen('title');
  };

  const handleSelectViewingVehicle = (vehicleId: string) => {
    engineRef.current?.audio.playUiClick();
    setViewingVehicleId(vehicleId);
    const custom = profile.customizations[vehicleId] ?? getVehicleById(vehicleId).defaultCustomization;
    engineRef.current?.setShowcaseVehicle(vehicleId, custom);
  };

  const handleEquipVehicle = (vehicleId: string) => {
    if (!profile.ownedVehicles.includes(vehicleId)) return;
    engineRef.current?.audio.playUiClick();
    const updated = { ...profile, selectedVehicleId: vehicleId };
    setProfile(updated);
    saveLocalProfile(updated);
  };

  const handleUnlockVehicle = (vehicleId: string) => {
    const car = VEHICLES.find((v) => v.id === vehicleId);
    if (!car || profile.ownedVehicles.includes(vehicleId) || profile.credits < car.price) return;
    engineRef.current?.audio.playPickup();
    const updated: PlayerProfile = {
      ...profile,
      credits: profile.credits - car.price,
      ownedVehicles: [...profile.ownedVehicles, vehicleId],
      selectedVehicleId: vehicleId,
    };
    setProfile(updated);
    saveLocalProfile(updated);
  };

  const handleUpdateCustomization = (vehicleId: string, patch: Partial<VehicleCustomization>) => {
    const current = profile.customizations[vehicleId] ?? getVehicleById(vehicleId).defaultCustomization;
    const nextCustom = { ...current, ...patch };
    const updated: PlayerProfile = {
      ...profile,
      customizations: { ...profile.customizations, [vehicleId]: nextCustom },
    };
    setProfile(updated);
    saveLocalProfile(updated);
    engineRef.current?.setShowcaseVehicle(vehicleId, nextCustom);
  };

  const handleClaimMission = (missionId: string, rewardCredits: number) => {
    if (profile.claimedMissionIds.includes(missionId)) return;
    engineRef.current?.audio.playPickup();
    const updated: PlayerProfile = {
      ...profile,
      credits: profile.credits + rewardCredits,
      claimedMissionIds: [...profile.claimedMissionIds, missionId],
    };
    setProfile(updated);
    saveLocalProfile(updated);
  };

  const handleStartCareerEvent = (ev: CareerEvent) => {
    launchRace({
      mode: ev.mode,
      trackId: ev.trackId,
      difficulty: ev.difficulty,
      laps: ev.laps,
      careerEventId: ev.id,
    });
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#070A12]">
      {/* Isolated Full-Bleed WebGL2 Canvas Mount (Never re-renders on React HUD state updates) */}
      <div
        ref={mountRef}
        className="fixed inset-0 w-full h-full"
        data-testid="webgl-viewport"
      />

      {/* Honest WebGL Fallback Error State */}
      {webglError && (
        <div className="fixed inset-0 z-50 bg-[#070A12] flex items-center justify-center p-6">
          <div className="max-w-md bg-[#101522] border border-[#FF365E] p-6">
            <h1 className="font-display font-bold text-xl text-[#FF365E]">3D RENDERER UNAVAILABLE</h1>
            <p className="mt-2 text-sm text-[#CBD5E1]">{webglError}</p>
            <p className="mt-2 text-xs text-[#94A3B8]">
              Enable hardware acceleration or WebGL2 in your browser settings and reload the page.
            </p>
          </div>
        </div>
      )}

      {/* Offline PWA Banner */}
      {!isOnline && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-[#FF8A00] text-[#070A12] font-mono-num font-bold text-xs px-3 py-1">
          OFFLINE MODE — LOCAL RACING & GARAGE AVAILABLE
        </div>
      )}

      {/* TITLE / MAIN MENU SCREEN */}
      {screen === 'title' && !webglError && (
        <MainMenuOverlay
          profile={profile}
          language={settings.language}
          onQuickRace={() =>
            launchRace({ mode: 'combat_race', trackId: 'neon_city', difficulty: 'normal', laps: 3 })
          }
          onOpenRaceSetup={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.audio.playUiClick();
            setScreen('race_setup');
          }}
          onOpenMultiplayer={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.audio.playUiClick();
            mpClientRef.current?.connect();
            setScreen('multiplayer');
          }}
          onOpenGarage={openGarage}
          onOpenCareer={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.audio.playUiClick();
            setScreen('career');
          }}
          onOpenSettings={() => {
            engineRef.current?.audio.unlock();
            engineRef.current?.audio.playUiClick();
            setPreviousScreen('title');
            setScreen('settings');
          }}
        />
      )}

      {/* INTERACTIVE 3D GARAGE & CUSTOMIZATION */}
      {screen === 'garage' && (
        <GarageDock
          profile={profile}
          viewingVehicleId={viewingVehicleId}
          language={settings.language}
          onSelectViewing={handleSelectViewingVehicle}
          onEquipVehicle={handleEquipVehicle}
          onUnlockVehicle={handleUnlockVehicle}
          onUpdateCustomization={handleUpdateCustomization}
          onBack={returnToTitle}
          onRaceNow={() =>
            launchRace({ mode: 'combat_race', trackId: 'neon_city', difficulty: 'normal', laps: 3 })
          }
        />
      )}

      {/* RACE MODE & TRACK SETUP */}
      {screen === 'race_setup' && (
        <RaceSetupModal
          language={settings.language}
          onLaunch={(params) => launchRace(params)}
          onBack={returnToTitle}
        />
      )}

      {/* ONLINE MULTIPLAYER LOBBY & PRIVATE ROOMS */}
      {screen === 'multiplayer' && (
        <MultiplayerModal
          language={settings.language}
          connected={mpConnected}
          pingMs={mpPing}
          myPlayerId={mpClientRef.current?.playerId ?? null}
          room={mpRoom}
          publicRooms={mpPublicRooms}
          errorMessage={mpError}
          onBack={returnToTitle}
          onCreateRoom={(trackId, mode, laps) => {
            const carId = profile.selectedVehicleId;
            mpClientRef.current?.createRoom({
              name: profile.username,
              vehicleId: carId,
              customization: profile.customizations[carId] ?? getVehicleById(carId).defaultCustomization,
              trackId,
              mode,
              laps,
            });
          }}
          onJoinRoom={(code) => {
            const carId = profile.selectedVehicleId;
            mpClientRef.current?.joinRoom({
              code,
              name: profile.username,
              vehicleId: carId,
              customization: profile.customizations[carId] ?? getVehicleById(carId).defaultCustomization,
            });
          }}
          onQuickMatch={() => {
            const carId = profile.selectedVehicleId;
            mpClientRef.current?.quickMatch({
              name: profile.username,
              vehicleId: carId,
              customization: profile.customizations[carId] ?? getVehicleById(carId).defaultCustomization,
            });
          }}
          onToggleReady={() => mpClientRef.current?.toggleReady()}
          onStartMatch={() => mpClientRef.current?.startMatch()}
          onLeaveRoom={() => mpClientRef.current?.leaveRoom()}
          onRefreshRooms={() => mpClientRef.current?.connect()}
        />
      )}

      {/* CAREER, MISSIONS, LEADERBOARD & ACCOUNT */}
      {screen === 'career' && (
        <CareerModal
          profile={profile}
          language={settings.language}
          onStartCareerEvent={handleStartCareerEvent}
          onClaimMission={handleClaimMission}
          onAuthSuccess={(uname, isGuest, serverData, token) => {
            if (token) authTokenRef.current = token;
            const updated: PlayerProfile = {
              ...profile,
              ...(serverData ?? {}),
              username: uname,
              isGuest,
            };
            setProfile(updated);
            saveLocalProfile(updated);
          }}
          onBack={returnToTitle}
        />
      )}

      {/* SETTINGS & HELP CENTER */}
      {screen === 'settings' && (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          onBack={() => setScreen(previousScreen)}
        />
      )}

      {/* ACTIVE GAMEPLAY HUD */}
      {screen === 'playing' && hud && (
        <HudOverlay
          hud={hud}
          settings={settings}
          isMultiplayer={Boolean(lastRaceConfig?.isMultiplayer)}
          isElimination={lastRaceConfig?.mode === 'elimination'}
          inputHub={engineRef.current?.input ?? null}
          onToggleMute={() => updateSettings({ muted: !settings.muted })}
          onCycleCamera={() => engineRef.current?.cycleCamera()}
          onPause={() => {
            engineRef.current?.setMode('paused');
            setScreen('paused');
          }}
        />
      )}

      {/* PAUSE MODAL */}
      {screen === 'paused' && (
        <PauseModal
          language={settings.language}
          isMultiplayer={Boolean(lastRaceConfig?.isMultiplayer)}
          onResume={() => {
            engineRef.current?.setMode('playing');
            setScreen('playing');
          }}
          onRestart={() => {
            if (lastRaceConfig) {
              launchRace({
                mode: lastRaceConfig.mode,
                trackId: lastRaceConfig.trackId,
                difficulty: lastRaceConfig.difficulty,
                laps: lastRaceConfig.laps,
              });
            }
          }}
          onOpenSettings={() => {
            setPreviousScreen('paused');
            setScreen('settings');
          }}
          onQuit={() => {
            if (lastRaceConfig?.isMultiplayer) mpClientRef.current?.leaveRoom();
            returnToTitle();
          }}
        />
      )}

      {/* RACE RESULTS MODAL */}
      {screen === 'results' && hud && (
        <ResultsModal
          language={settings.language}
          hud={hud}
          rewards={rewards}
          onReplay={() => {
            if (lastRaceConfig) {
              launchRace({
                mode: lastRaceConfig.mode,
                trackId: lastRaceConfig.trackId,
                difficulty: lastRaceConfig.difficulty,
                laps: lastRaceConfig.laps,
              });
            }
          }}
          onMainMenu={returnToTitle}
        />
      )}
    </div>
  );
}

export default App;
