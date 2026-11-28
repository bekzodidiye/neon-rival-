# NEON RIVALS — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every path not explicitly matched under `/databases/{database}/documents` is denied for both read and write.
2. **Verified Owner-Only PII & Profile Isolation**: `/drivers/{driverId}` and all nested subcollections (`/careerEvents/{eventId}`, `/vehicleMastery/{vehicleId}`) are strictly owner-scoped (`driverId == request.auth.uid`). No blanket `isSignedIn()` reads or client-delegated list queries are permitted. All write operations strictly require `request.auth.token.email_verified == true`.
3. **Master Gate Relational Sync**: Every subcollection read/write under `/drivers/{driverId}/careerEvents/{eventId}` and `/drivers/{driverId}/vehicleMastery/{vehicleId}` must verify parent existence via `exists(/databases/$(database)/documents/drivers/$(driverId))` and `incoming().ownerId == driverId == request.auth.uid`.
4. **Immutable Ownership & Temporal Integrity**: `ownerId` and `createdAt` / `completedAt` are immutable on update. All create timestamps must equal `request.time`; all update `updatedAt` timestamps must equal `request.time`.
5. **Strict Schema & Bounds (No Shadow Fields / No Denial-of-Wallet)**: Every document enforces `hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update, `isValidId()` regex + `<= 128` length on all path IDs, explicit `.size()` checks on every string and array, and bounded numeric domains (`careerLights <= 500`, `lightsEarned >= 0 && <= 5`, `equippedMods.size() <= 3`, `unlockedVehicles.size() <= 10`, `prestigeTier >= 0 && <= 10`).
6. **Separation of Competitive Authority**: Online competitive rankings and server-controlled currency remain authoritative on the game server; Firestore stores only client-synced offline career/mastery records isolated per verified user.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Profile Read/Write**: Read or write `/drivers/uid_alice` with `request.auth == null`.
2. **Unverified Email Write Spoof**: Create `/drivers/uid_alice` with `request.auth.uid == 'uid_alice'` and `request.auth.token.email_verified == false`.
3. **Cross-User Identity Spoofing**: Authenticated `uid_bob` attempts to create `/drivers/uid_alice` or set `ownerId: 'uid_alice'`.
4. **Shadow Field Injection ("Ghost Field")**: Authenticated verified `uid_alice` sends all required `DriverProfile` fields plus `isAdmin: true` or `onlineRank: 50`.
5. **Path ID Poisoning (Denial-of-Wallet)**: Create `/drivers/uid_alice/careerEvents/<200-char-junk-id-with-spaces>` violating `isValidId()`.
6. **Array Overflow Poisoning**: Create `DriverProfile` with `equippedMods` containing 12 items (`> 3`) or `unlockedVehicles` containing 25 items (`> 10`).
7. **Timestamp Forgery**: Create `DriverProfile` with a backdated client timestamp `createdAt != request.time`.
8. **Immutable Owner Mutation**: Update `/drivers/uid_alice` attempting to change `ownerId` or `createdAt`.
9. **Orphan Subcollection Write**: Create `/drivers/uid_alice/careerEvents/street_01` when parent `/drivers/uid_alice` does not exist.
10. **Value Poisoning on Whitelisted Update Key**: Update `displayName` on `/drivers/uid_alice` with a 500-character string or non-string boolean (`displayName: true`).
11. **Out-of-Bounds Lights Manipulation**: Create/update `/drivers/uid_alice/careerEvents/street_01` with `lightsEarned: 99` (exceeds max `5`) or `bestPosition: 0`.
12. **Blanket Collection Scraping**: Authenticated `uid_bob` issues a `list` query against `/drivers` or `/drivers/uid_alice/careerEvents` without matching `resource.data.ownerId == request.auth.uid`.
