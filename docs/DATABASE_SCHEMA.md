# NEON RIVALS V6.0 — Database Schema & Persistence

## Production Relational Schema (`server/persistence/schema.sql`)
Designed for PostgreSQL 15+ with strict referential integrity and idempotent reward ledger guarantees:

- **`users`**: `id`, `username`, `username_lower` (UNIQUE), `password_hash` (salted `scrypt`), `level`, `xp`, `credits`, `fan_points`, `races_completed`, `wins`, `takedowns`, `owned_vehicles`, `selected_vehicle_id`, `created_at`, `updated_at`.
- **`sessions`**: `jti` (PK), `user_id` (FK -> `users.id` ON DELETE CASCADE), `expires_at`, `created_at`.
- **`matches`**: `match_id` (PK, server-generated), `room_code`, `track_id`, `mode`, `laps`, `started_at`, `finished_at`, `duration_sec`, `verified_by_server`.
- **`match_participants`**: `(match_id, participant_id)` PK, nullable `user_id` FK (null for AI/guests), `display_name`, `vehicle_id`, `is_ai`, `position`, `finished`, `finish_time_sec`, `hits_landed`, `takedowns`, `blocks_landed`, `race_fans`.
- **`reward_ledger`**: `id`, `match_id` (FK), `user_id` (FK), `position`, `credits_awarded`, `xp_awarded`, `fans_awarded`, `created_at`, with **`CONSTRAINT uq_reward_ledger_match_user UNIQUE (match_id, user_id)`** preventing duplicate reward payouts on replay or retries.

## Development Fallback Adapter (`server/persistence/PersistenceAdapter.ts`)
Because no managed PostgreSQL instance is provisioned in this container environment (and paid cloud infrastructure was not authorized), runtime persistence uses `JsonDevPersistenceAdapter`:
- Implements the exact `PersistenceAdapter` interface with atomic write-to-temp + `renameSync` durability.
- Logs disk errors explicitly instead of silently swallowing them.
- Enforces the exact `${matchId}:${userId}` unique reward ledger constraint in memory and on disk.
- Contains **zero fabricated competitive players** in `getVerifiedLeaderboard()` — only authenticated users who have completed at least one verified authoritative match appear on rankings.
