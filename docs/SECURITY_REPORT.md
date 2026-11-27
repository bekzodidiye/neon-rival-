# NEON RIVALS — Security & Anti-Cheat Report (V6.0)

## 1. Authoritative Reward Integrity (Critical V5.0 Blocker Remediated)
- **Disabled Unverified Client Race Claims**: `POST /api/race/complete` now strictly returns `403 { error: "CLIENT_RACE_CLAIM_DISABLED" }`. Client browsers can no longer self-report race position, takedowns, hits, credits, or wins to affect server-controlled balances or competitive rankings.
- **Offline vs. Verified Online Separation**: Single-player offline races persist strictly in client-local storage and never touch server accounts or leaderboards.
- **Server-Authoritative Match Settlement**: Only completed matches executed inside `server/game/AuthoritativeRace.ts` write to `matches`, `match_participants`, and `reward_ledger`. Verified results are queryable via `GET /api/matches/:matchId/result`, and player profiles expose `verifiedMatchesCount` via `GET /api/auth/me`.
- **Strict Reward Idempotency**: Reward grants are keyed by `(matchId, userId)` (enforced via `UNIQUE (match_id, user_id)` in `server/persistence/schema.sql` and atomic ledger keys in `JsonDevPersistenceAdapter`), ensuring a match can never double-credit a player.
- **Verified-Only Leaderboard**: Removed fabricated seeded placeholder entries from `CareerModal.tsx`; `GET /api/leaderboard` returns only server-verified accounts with recorded authoritative matches (returning `[]` honestly when none exist).

## 2. Authentication, Sessions & Transport Hardening
- **Non-Blocking Password Hashing**: Upgraded `server.ts` from `crypto.scryptSync` to async `crypto.scrypt` (`N=16384, r=8, p=1`, 64-byte derived key, 16-byte random per-user salt) with constant-time `crypto.timingSafeEqual` verification, preventing event-loop blocking under login traffic.
- **Strict Input & Password Bounds**: Enforces username allowlist (`/^[a-zA-Z0-9_-]{3,20}$/`) and bounded password lengths (`6..128` characters) to mitigate password-hashing DoS.
- **Memory-Only Bearer Tokens**: Signed HMAC-SHA256 Bearer tokens (24-hour TTL, revocable via `POST /api/auth/logout`) are kept strictly in React memory (`authTokenRef`) on the client and never persisted to `localStorage`.
- **Rate Limiting & Origin Allowlist**: Per-IP sliding-window rate limiting on `/api/auth/register` and `/api/auth/login`; HTTP API and WebSocket upgrade requests validate `Origin` against allowed hosts (`ALLOWED_ORIGINS` env override + localhost/same-host defaults).

## 3. Authoritative WebSocket Protocol Hardening
- **Authenticated Handshake**: WebSocket connections authenticate via `auth` message carrying the signed Bearer token (`MultiplayerClient.setAuthToken`).
- **Rejection of Client-Authored State**: Legacy `racer_state` and arbitrary `combat_use` client messages are explicitly rejected with `AUTHORITATIVE_ONLY`.
- **Strict Input Validation (`shared/protocol/validation.ts`)**:
  - `maxPayload: 16 * 1024`, per-connection message rate limiting, finite-number checks, clamped throttle/brake/steer (`[-1, 1]` / `[0, 1]`), slot index bounds (`0..2`), and strictly increasing input sequence numbers.
  - `validatePowerUpType` returns `null` for any unknown power-up ID (never silently coerces invalid strings to `BOLT`).
- **Atomic Pickup Exclusivity**: Pickup orbs are claimed atomically inside the single-threaded 60 Hz server simulation (`RaceSimulation.ts`), preventing duplicate grants on simultaneous ticks.

## 4. Honest Remaining Security & Infrastructure Notes
- **Local Dev Persistence Fallback**: `JsonDevPersistenceAdapter` (`data/store.json`) is active until managed PostgreSQL (`server/persistence/schema.sql`) is provisioned for production multi-instance deployment.
- **Production Secret Requirement**: Deployments must configure a persistent `SESSION_SECRET` (32+ random bytes) and explicit `ALLOWED_ORIGINS` environment variables (see `docs/DEPLOYMENT.md`).
