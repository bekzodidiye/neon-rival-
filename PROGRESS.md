# NEON RIVALS — Implementation Progress Tracker (V3.0 Master Plan)

This document honestly tracks implementation status across the V3.0 Master Plan phases, separating **implemented & verified** capabilities from **deferred / unverified** items.

## Phase Status Overview

| Phase | Scope | Status | Verification & Notes |
|---|---|---|---|
| **Phase 0** | Architecture, TypeScript contracts, Modular Engine/Game separation | **Complete** | `src/game/` pure simulation decoupled from `src/engine/` Three.js renderer and `src/components/` React UI. |
| **Phase 1** | Core Driving Loop, Arcade Physics, 4 Handling Archetypes, Camera & Motion Blur | **Complete** | 4 handling archetypes (`grippy`, `drifty`, `balanced`, `offroad`), Slipstream drafting, drift counter-steering, 3 cameras (`Near`, `Far`, `Hood`), GPU `CameraMotionBlurShader` + `CameraSpeedStreakRig`. |
| **Phase 2** | 8 Power-Ups, 3-Slot Inventory, Dedicated `combatResolver.ts` Matrix | **Complete** | All 8 Blur-inspired power-ups (`SHUNT`, `BOLT`, `BARGE`, `MINE`, `SHOCK`, `NITRO`, `SHIELD`, `REPAIR`), 3-slot queue, forward & backward firing (`KeyG` / `KeyX` / `Brake+Space`), 2-hit Bolt-vs-Shunt, Barge clearing Shunts/Bolts/Mines, Shield capacity + Shock depletion, 2-stage Nitro Air-Brake, 4-block Repair cap. |
| **Phase 3** | Vehicles (Classes D–A), Segmented Armor Blocks (5–8), 3D Garage | **Core Complete (5 Vehicles)** | 5 distinct playable vehicles across Classes D–A (`Street Falcon`, `Sand Runner`, `Night Viper`, `Cyber GT-R`, `Phantom X`) with 6–8 segmented health blocks (`20 HP/block`) and 3D Garage paint/rim/neon/bodykit customization. Full 52-vehicle roster is deferred. |
| **Phase 4** | Circuits & Environment Art Direction | **Core Complete (3 Tracks)** | 3 playable closed-loop nocturnal circuits (`Neon City`, `Industrial Port`, `Midnight Streets`) with Blur midnight lighting, non-glare Night-City PMREM, floating neon power-up icons, and taillight ribbon trails. Expansion to 32 routes is deferred. |
| **Phase 5** | HUD, Controls, Accessibility, Reputation/Fans 10x Combo | **Complete** | Dynamic segmented health block bar (`N/M BLK`), 3-slot power-up dock, live `xN` Combo Chain multiplier (up to 10x chain), rear-threat warning indicator, minimap, speed/gear dial, and Settings modal (graphics/audio/motion blur/language). |
| **Phase 6** | Web Audio Procedural Engine & Combat SFX | **Complete** | Synthesized multi-oscillator engine RPM pitch, drift tire screech, Nitro whoosh, Shunt/Bolt/Barge/Shield/Shock/Repair SFX, UI clicks, and volume controls. |
| **Phase 7** | AI Racers & Rubber-Banding Combat Behavior | **Complete** | Waypoint spline steering, lane switching, tactical forward/backward power-up usage, difficulty tiers (`Easy`, `Normal`, `Hard`), and survival/elimination rules. |
| **Phase 8** | Multiplayer Lobby & WebSocket Server | **Prototype Complete (Not Stress-Tested)** | Express + `ws` server (`server.ts`) supports room creation, room codes, lobby ready-up, and live state sync. 20-player automated multi-client soak/stress testing has **not** been run. |
| **Phase 9** | Progression, Profiles & Persistence | **Local Persistence Only** | Local `localStorage` guest profile saves credits, XP, level, unlocks, customizations, and settings. Cloud/Firebase authentication and global leaderboards are **not** provisioned yet. |
| **Phase 10** | PWA Support & Packaging | **Complete** | Manifest, service worker registration, offline-friendly static shell, and responsive touch controls for mobile screens. |
| **Phase 11** | Automated Verification & Visual QA | **Active / Passing** | Unit test suite (`src/game/gameLogic.test.ts`), `tsc --noEmit`, Vite production build, and headless Chromium Playwright visual verification of Title, 3D Garage, and live Race HUD. |

## Deferred / Not Yet Implemented (Tracked Honestly)
- Expanding roster from 5 distinct class archetypes to the full 52-vehicle catalog.
- Expanding circuits from 3 tracks to 32 multi-route regional environments.
- Provisioning cloud database / authentication (currently local guest persistence only).
- Automated 20-client concurrent WebSocket load testing.
- Additional single-player modes beyond Quick Race, Elimination, Destruction, and Multiplayer (e.g., Checkpoint Time Attack, Boss One-on-One career tree).
