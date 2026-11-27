# NEON RIVALS — Security & Anti-Cheat Report (V5.0)

## Remediated Vulnerabilities in `server.ts` & Client Auth Flow
1. **Password Storage (`scrypt` + Random Salt)**:
   - Replaced legacy static-salt SHA-256 (`nr_salt_${pw}`) with Node's built-in `crypto.scryptSync` (`N=16384, r=8, p=1`, 64-byte key) using a unique 16-byte random salt per account (`scrypt$<salt>$<hash>`).
   - Verification uses constant-time `crypto.timingSafeEqual`. Legacy hashes are automatically upgraded on valid login.
2. **Signed Bearer Session Authentication & Revocation**:
   - Issued HMAC-SHA256 signed Bearer tokens (`SESSION_SECRET` env override or per-process CSPRNG 256-bit secret) with 24-hour TTL and server-side session ledger revocation via `POST /api/auth/logout` and verification via `GET /api/auth/me`.
   - Client stores the Bearer token strictly in React memory (`authTokenRef`), never in `localStorage`.
3. **Auth Rate Limiting & Strict Input Validation**:
   - Per-IP sliding-window rate limiting on `/api/auth/register` and `/api/auth/login` (15 attempts / 60s).
   - Enforces username character whitelist (`/^[a-zA-Z0-9_-]{3,20}$/`) and minimum 6-character passwords.
4. **Server-Computed Progression & Replay Protection**:
   - Hardened `POST /api/race/complete` to require a valid Bearer session (`401` otherwise) and a unique `transactionId` (preventing duplicate reward claims with `409`).
   - Eliminated client-controlled `fanPoints` / `wins` overrides: rewards (`credits`, `xp`, `fanPoints`) are computed server-side from bounded race placement and combat counts.
5. **WebSocket Protocol Hardening**:
   - Added `maxPayload: 16 * 1024`, per-connection message rate limiting, track/mode/power-up allowlists, finite-number checks, teleport-spike rejection, and validated `PlayerInputMessage` (`type: "input"`) sequence clamping.

## Honest Scope Notes
- Persistence currently uses local JSON storage (`data/store.json`) suitable for single-instance deployment; production multi-instance scale should migrate to PostgreSQL/Redis.
- Full 20-player server-authoritative physics tick loop with client-side prediction/reconciliation remains a planned multiplayer milestone beyond the current validated lobby + input/snapshot protocol.
