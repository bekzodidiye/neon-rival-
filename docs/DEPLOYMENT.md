# NEON RIVALS V6.0 — Deployment Guide

## Architecture Overview
NEON RIVALS consists of:
1. **Frontend SPA** (Vite + React 19 + Three.js WebGL2) — deployable to static CDN (Vercel/Cloudflare Pages) or served directly from `server.ts`.
2. **Authoritative Game Server** (`server.ts` + `server/game/*` + `shared/simulation/*`) — requires a persistent Node.js 22+ container host supporting long-lived WebSocket connections (`/ws`) and fixed-timestep room ticks. **Serverless platforms (such as Vercel Functions) cannot host stateful 60 Hz authoritative WebSocket rooms.**
3. **Database** — production PostgreSQL schema is provided in `server/persistence/schema.sql`. Local/dev environments use `JsonDevPersistenceAdapter` (`data/store_v6.json`) cleanly separated behind the `PersistenceAdapter` interface.

## Required Environment Variables
Configure via host secrets (never commit real secrets):
- `PORT` (default `3000`)
- `NODE_ENV=production`
- `SESSION_SECRET` (strong 32+ byte random hex string; required in production so sessions survive restarts)
- `ALLOWED_ORIGINS` (comma-separated frontend origins allowed for CORS & WebSocket `Origin` checks, e.g. `https://neon-rival-sigma.vercel.app`)
- `DATABASE_URL` (PostgreSQL connection string when using a managed PostgreSQL persistence adapter)
- Frontend build-time variables (when splitting SPA and game server):
  - `VITE_API_BASE_URL` (e.g. `https://game-server.example.com`)
  - `VITE_GAME_SERVER_WS_URL` (e.g. `wss://game-server.example.com/ws`)

## Container Build & Run
```bash
docker build -t neon-rivals-server:v6 .
docker run -d --name neon-rivals \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e ALLOWED_ORIGINS="https://neon-rival-sigma.vercel.app" \
  neon-rivals-server:v6
```

## Health Check & Graceful Shutdown
- `GET /api/health` returns `{ ok, authoritativeMultiplayer, persistenceKind, roomsActive, playersOnline, racesRunning }`.
- `SIGINT` and `SIGTERM` trigger `running.close()`, stopping active room simulation timers (`roomManager.shutdown()`), closing WebSocket clients, and draining HTTP connections cleanly.
