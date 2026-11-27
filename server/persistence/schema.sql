-- NEON RIVALS V6.0 — Production PostgreSQL Persistence Schema
-- Enforces server-authoritative match records and idempotent reward issuance.

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  username          TEXT NOT NULL,
  username_lower    TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  level             INTEGER NOT NULL DEFAULT 1,
  xp                INTEGER NOT NULL DEFAULT 0,
  credits           INTEGER NOT NULL DEFAULT 3000,
  fan_points        INTEGER NOT NULL DEFAULT 0,
  races_completed   INTEGER NOT NULL DEFAULT 0,
  wins              INTEGER NOT NULL DEFAULT 0,
  takedowns         INTEGER NOT NULL DEFAULT 0,
  owned_vehicles    JSONB NOT NULL DEFAULT '["street_falcon"]'::jsonb,
  selected_vehicle  TEXT NOT NULL DEFAULT 'street_falcon',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  jti               TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_key          TEXT NOT NULL,
  username          TEXT NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS matches (
  match_id          TEXT PRIMARY KEY,
  room_code         TEXT NOT NULL,
  track_id          TEXT NOT NULL,
  mode              TEXT NOT NULL,
  laps              INTEGER NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  finished_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS match_participants (
  match_id          TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  player_id         TEXT NOT NULL,
  user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  username          TEXT NOT NULL,
  vehicle_id        TEXT NOT NULL,
  is_ai             BOOLEAN NOT NULL DEFAULT FALSE,
  position          INTEGER NOT NULL,
  finish_time_sec   DOUBLE PRECISION NOT NULL,
  hits_landed       INTEGER NOT NULL DEFAULT 0,
  takedowns         INTEGER NOT NULL DEFAULT 0,
  blocks_landed     INTEGER NOT NULL DEFAULT 0,
  race_fans         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_id)
);

-- Transactional idempotent reward ledger: guarantees one verified reward per (match_id, user_id)
CREATE TABLE IF NOT EXISTS reward_ledger (
  id                BIGSERIAL PRIMARY KEY,
  match_id          TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  credits_awarded   INTEGER NOT NULL,
  xp_awarded        INTEGER NOT NULL,
  fans_awarded      INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_reward_ledger_match_user UNIQUE (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_leaderboard ON users(fan_points DESC, wins DESC);
