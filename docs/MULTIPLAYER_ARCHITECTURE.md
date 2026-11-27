# NEON RIVALS V6.0 — Authoritative Multiplayer Architecture

## Overview
V6.0 replaces the V5.0 client-relayed state model with a true server-authoritative racing architecture built on shared, browser-independent simulation code:

```
shared/protocol/messages.ts        <- Strict wire contracts & allowlists
shared/protocol/validation.ts      <- Finite/range/sequence/power-up validators
shared/simulation/RaceSimulation.ts <- Zero-DOM 60 Hz physics, checkpoints, pickups, combat & AI
server/game/InputQueue.ts          <- Sequenced input buffer, one-shot latching, stale timeout
server/game/AuthoritativeRace.ts   <- Fixed-timestep 60 Hz sim loop + 20 Hz snapshot fanout
server/game/RoomManager.ts         <- Lobby lifecycle, AI backfill, verified finish persistence
server.ts                          <- HTTP auth/API + WebSocket /ws gateway & Origin checks
src/net/multiplayerClient.ts       <- Client WS auth, sequenced input streaming, snapshot receiver
src/engine/RaceEngine.ts           <- Client prediction/reconciliation & remote interpolation
```

## Authority Rules Enforced
1. **Inputs Only From Clients**: Clients send sequenced `{ type: 'input', sequence, throttle, brake, steering, drift, firePowerUp, rearFire, cycleSlot, discardSlot, selectSlot, recover }` frames.
2. **Legacy Relay Frames Rejected**: Sending legacy `racer_state` or arbitrary `combat_use` frames in authoritative rooms returns `{ type: 'error', code: 'AUTHORITATIVE_ONLY' }`.
3. **No Silent Power-Up Coercion**: `validatePowerUpType()` returns `null` for any unknown string and never coerces invalid names to `BOLT`.
4. **Exclusive Atomic Pickups**: Pickup collection occurs strictly inside server `RaceSimulation.step()`. Simultaneous overlaps grant the node to exactly one racer and immediately deactivate the node.
5. **Server-Authoritative Combat & Standings**: Projectiles, homing locks, 2-hit Bolt-vs-Shunt interception, Barge clearing, Shock domes, Shield capacity, Repair 4-block cap, wrecks, respawns, checkpoints, laps, and finish order are computed exclusively on the server.
6. **Client Prediction & Remote Interpolation**:
   - Local player predicts movement locally with `stepVehiclePhysics()`, retains unacknowledged inputs (`pendingInputs`), and smoothly reconciles against server `lastProcessedInputSeq` (`< 4.5m` blended cleanly to avoid camera snapping).
   - Remote players and server AI interpolate smoothly between received snapshots with bounded `<= 120ms` dead-reckoning.
7. **Verified Rewards Only**: `POST /api/race/complete` is disabled (`403 CLIENT_RACE_CLAIM_DISABLED`). Rewards are credited exclusively when `AuthoritativeRace` finishes on the server and calls `PersistenceAdapter.recordVerifiedMatchResult()`.
