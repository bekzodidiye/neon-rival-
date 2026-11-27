import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createAppServer, type RunningAppServer } from '../../server';
import type { AuthoritativeMatchResult, AuthoritativeWorldSnapshot } from '../../shared/protocol/messages';

interface TestWsClient {
  ws: WebSocket;
  playerId: string;
  messages: Record<string, unknown>[];
  snapshots: AuthoritativeWorldSnapshot[];
  errors: Record<string, unknown>[];
  matchResult: AuthoritativeMatchResult | null;
  send: (payload: unknown) => void;
  waitFor: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
}

async function connectClient(wsUrl: string, token?: string): Promise<TestWsClient> {
  const ws = new WebSocket(wsUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const messages: Record<string, unknown>[] = [];
  const snapshots: AuthoritativeWorldSnapshot[] = [];
  const errors: Record<string, unknown>[] = [];
  let matchResult: AuthoritativeMatchResult | null = null;
  const waiters: { pred: (m: Record<string, unknown>) => boolean; resolve: (m: Record<string, unknown>) => void }[] = [];

  ws.on('message', (raw) => {
    const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    messages.push(parsed);
    if (parsed.type === 'world_snapshot') {
      snapshots.push(parsed as unknown as AuthoritativeWorldSnapshot);
    } else if (parsed.type === 'error') {
      errors.push(parsed);
    } else if (parsed.type === 'match_finished' && parsed.result) {
      matchResult = parsed.result as AuthoritativeMatchResult;
    }

    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].pred(parsed)) {
        const w = waiters.splice(i, 1)[0];
        w.resolve(parsed);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const waitFor = (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs = 6000) => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for WS message (${timeoutMs}ms)`)), timeoutMs);
      waiters.push({
        pred: predicate,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  };

  const welcome = await waitFor((m) => m.type === 'welcome');
  const playerId = String(welcome.playerId);

  return {
    ws,
    playerId,
    messages,
    snapshots,
    errors,
    get matchResult() {
      return matchResult;
    },
    send: (payload: unknown) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    },
    waitFor,
    close: async () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve) => {
          ws.once('close', () => resolve());
          ws.close();
        });
      }
    },
  };
}

async function registerUser(baseUrl: string, username: string, password: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `Register ${username} failed with ${res.status}`);
  const data = (await res.json()) as { token: string; user: { id: string } };
  return { token: data.token, userId: data.user.id };
}

test('Security Gate E: /api/race/complete is disabled (403), leaderboard has zero fake players, legacy WS racer_state/combat_use rejected, async scrypt auth works', async () => {
  const srv: RunningAppServer = await createAppServer({
    port: 0,
    host: '127.0.0.1',
    enableVite: false,
    persistToDisk: false,
    simHz: 60,
    snapshotHz: 20,
    countdownSeconds: 0.1,
  });

  try {
    // 1. Leaderboard starts empty (ZERO fabricated competitive accounts)
    const lbRes = await fetch(`${srv.url}/api/leaderboard`);
    assert.equal(lbRes.status, 200);
    const lbJson = (await lbRes.json()) as { verifiedOnly: boolean; leaderboard: unknown[] };
    assert.equal(lbJson.verifiedOnly, true);
    assert.equal(lbJson.leaderboard.length, 0);

    // 2. Password length validation (< 6 or > 128 rejected)
    const shortPw = await fetch(`${srv.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ShortPwUser', password: '123' }),
    });
    assert.equal(shortPw.status, 400);

    const longPw = await fetch(`${srv.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'LongPwUser', password: 'a'.repeat(130) }),
    });
    assert.equal(longPw.status, 400);

    // 3. Valid async scrypt register + /api/auth/me + login
    const { token } = await registerUser(srv.url, 'GateTester', 'Str0ngPass!2026');
    const meRes = await fetch(`${srv.url}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(meRes.status, 200);

    // 4. CRITICAL SECURITY BLOCKER: Client-reported /api/race/complete MUST return 403
    const cheatRes = await fetch(`${srv.url}/api/race/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        transactionId: 'fake_tx_12345678',
        position: 1,
        takedowns: 10,
        hitsLanded: 20,
      }),
    });
    assert.equal(cheatRes.status, 403);
    const cheatJson = (await cheatRes.json()) as { code: string };
    assert.equal(cheatJson.code, 'CLIENT_RACE_CLAIM_DISABLED');

    // 5. Legacy WS racer_state & arbitrary combat_use MUST be rejected in authoritative server
    const client = await connectClient(srv.wsUrl, token);
    client.send({ type: 'create_room', name: 'GateTester', vehicleId: 'street_falcon', trackId: 'neon_city', mode: 'combat_race', laps: 1 });
    await client.waitFor((m) => m.type === 'room_state');

    client.send({ type: 'racer_state', state: { x: 999, z: 999, heading: 0 } });
    const err1 = await client.waitFor((m) => m.type === 'error' && m.code === 'AUTHORITATIVE_ONLY');
    assert.equal(err1.code, 'AUTHORITATIVE_ONLY');

    client.send({ type: 'combat_use', powerUpType: 'INVALID_WEAPON', rearFired: false });
    await new Promise((r) => setTimeout(r, 40));
    const authOnlyErrors = client.errors.filter((e) => e.code === 'AUTHORITATIVE_ONLY');
    assert.ok(authOnlyErrors.length >= 2, 'Both racer_state and combat_use must be rejected with AUTHORITATIVE_ONLY');

    await client.close();
  } finally {
    await srv.close();
  }
});

test('Multi-client authoritative WebSocket races (2, 4, and 8 independent clients) verify snapshots, server authority, verified rewards & strict idempotency', async () => {
  const srv: RunningAppServer = await createAppServer({
    port: 0,
    host: '127.0.0.1',
    enableVite: false,
    persistToDisk: false,
    simHz: 60,
    snapshotHz: 20,
    countdownSeconds: 0.05,
  });

  const stageTelemetry: {
    clients: number;
    snapshotsReceivedAvg: number;
    lastSnapshotBytes: number;
    avgTickMs: number;
    maxTickMs: number;
    heapUsedMb: number;
    matchId: string;
  }[] = [];

  try {
    for (const clientCount of [2, 4, 8]) {
      const clients: TestWsClient[] = [];
      const tokens: string[] = [];

      for (let i = 0; i < clientCount; i++) {
        const reg = await registerUser(srv.url, `Driver_${clientCount}_${i}`, 'RacePass123!');
        tokens.push(reg.token);
        const c = await connectClient(srv.wsUrl, reg.token);
        clients.push(c);
      }

      // Host creates 1-lap room
      clients[0].send({
        type: 'create_room',
        name: `Driver_${clientCount}_0`,
        vehicleId: 'street_falcon',
        trackId: 'neon_city',
        mode: 'combat_race',
        laps: 1,
        fillWithAi: clientCount < 8,
      });
      const createdMsg = await clients[0].waitFor((m) => m.type === 'room_state');
      const roomCode = (createdMsg.room as { code: string }).code;

      // Remaining clients join the same room
      for (let i = 1; i < clientCount; i++) {
        clients[i].send({
          type: 'join_room',
          code: roomCode,
          name: `Driver_${clientCount}_${i}`,
          vehicleId: i % 2 === 0 ? 'night_viper' : 'phantom_x',
        });
        await clients[i].waitFor((m) => m.type === 'room_state');
      }

      // Host starts authoritative match
      clients[0].send({ type: 'start_match' });
      const startMsg = await clients[0].waitFor((m) => m.type === 'race_start');
      assert.equal(startMsg.authoritative, true);
      const matchId = String(startMsg.matchId);

      // Stream real sequenced input commands from EVERY independent WS client for ~650ms
      let seq = 0;
      for (let step = 0; step < 22; step++) {
        seq += 1;
        for (let i = 0; i < clientCount; i++) {
          clients[i].send({
            type: 'input',
            sequence: seq,
            throttle: 1.0,
            brake: 0,
            steering: 0,
            drift: false,
            firePowerUp: step === 10,
            rearFire: false,
            cycleSlot: false,
            discardSlot: false,
            selectSlot: -1,
            recover: false,
          });
        }
        await new Promise((r) => setTimeout(r, 30));
      }

      // Verify all independent WS clients received live authoritative snapshots with moving racers
      for (let i = 0; i < clientCount; i++) {
        assert.ok(
          clients[i].snapshots.length >= 4,
          `Client ${i} in ${clientCount}-player stage should receive >=4 snapshots, got ${clients[i].snapshots.length}`,
        );
        const lastSnap = clients[i].snapshots[clients[i].snapshots.length - 1];
        assert.equal(lastSnap.racers.length, 8, 'Grid should have 8 racers total');
        const selfSnap = lastSnap.racers.find((r) => r.id === clients[i].playerId);
        assert.ok(selfSnap, 'Client should appear in authoritative world snapshot');
        assert.ok(selfSnap.lastProcessedInputSeq >= 5, 'Server should acknowledge and process sequenced client inputs');
        assert.ok(selfSnap.speed > 3.0, `Server should accelerate client car from real WS inputs, got speed=${selfSnap.speed}`);
      }

      // Inspect authoritative race telemetry & finish the match authoritatively on server
      const room = srv.roomManager.getRoomForPlayer(clients[0].playerId)!;
      assert.ok(room && room.race, 'AuthoritativeRace instance should be active');
      const raceStats = room.race.getTickStats();
      const snapBytes = raceStats.lastSnapshotBytes;

      // Fast-step the active server AuthoritativeRace through the rest of lap 1 so we verify full match_finished + verified persistence
      const sim = room.race.simulation;
      let safety = 0;
      while (sim.phase !== 'finished' && safety < 60 * 120) {
        seq += 1;
        for (let i = 0; i < clientCount; i++) {
          const r = sim.racers.find((x) => x.id === clients[i].playerId);
          if (!r || r.finished) continue;
          const lookT = (r.trackT + 26 / sim.track.totalLength) % 1;
          const sIdx = Math.floor(lookT * sim.track.samples.length) % sim.track.samples.length;
          const target = sim.track.samples[sIdx];
          const desiredYaw = Math.atan2(target.x - r.x, target.z - r.z);
          let err = desiredYaw - r.heading;
          while (err > Math.PI) err -= Math.PI * 2;
          while (err < -Math.PI) err += Math.PI * 2;
          room.race.inputQueue.enqueue(clients[i].playerId, {
            sequence: seq,
            throttle: 1,
            brake: 0,
            steering: Math.max(-1, Math.min(1, -err * 2.2)),
            drift: false,
            firePowerUp: safety % 90 === 0,
            rearFire: false,
            cycleSlot: false,
            discardSlot: false,
            selectSlot: -1,
            recover: false,
          });
        }
        room.race.stepOnce(1 / 60);
        safety += 1;
      }

      // Wait for match_finished broadcast on host
      await clients[0].waitFor((m) => m.type === 'match_finished', 5000);
      assert.ok(clients[0].matchResult, 'Host must receive authoritative match_finished result');
      assert.equal(clients[0].matchResult.matchId, matchId);

      // Verify REST /api/matches/:matchId/result returns the exact verified match
      const matchRes = await fetch(`${srv.url}/api/matches/${matchId}/result`);
      assert.equal(matchRes.status, 200);
      const matchJson = (await matchRes.json()) as { result: AuthoritativeMatchResult };
      assert.equal(matchJson.result.matchId, matchId);
      assert.equal(matchJson.result.standings.length, 8);

      // Verify server-issued credits/fans/racesCompleted persisted to host user account
      const meRes = await fetch(`${srv.url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokens[0]}` },
      });
      const meJson = (await meRes.json()) as {
        user: { credits: number; fanPoints: number; racesCompleted: number };
        verifiedMatchesCount: number;
      };
      assert.ok(meJson.user.credits > 3000, 'Verified authoritative match must credit authenticated player');
      assert.ok(meJson.user.fanPoints > 0, 'Verified authoritative match must award verified fan points');
      assert.equal(meJson.user.racesCompleted, 1);
      assert.equal(meJson.verifiedMatchesCount, 1);

      // Verify strict reward idempotency: re-recording exact same matchId MUST award 0 duplicate rewards
      const dupRes = srv.persistence.recordVerifiedMatchResult(matchJson.result);
      assert.equal(dupRes.recorded, false);
      assert.equal(dupRes.rewardsIssued.length, 0);

      const postStats = room.lastResult ? raceStats : raceStats;
      const avgSnaps =
        clients.reduce((acc, c) => acc + c.snapshots.length, 0) / Math.max(1, clients.length);

      stageTelemetry.push({
        clients: clientCount,
        snapshotsReceivedAvg: Number(avgSnaps.toFixed(1)),
        lastSnapshotBytes: snapBytes,
        avgTickMs: Number(postStats.avgTickMs.toFixed(3)),
        maxTickMs: Number(postStats.maxTickMs.toFixed(3)),
        heapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1)),
        matchId,
      });

      for (const c of clients) {
        await c.close();
      }
    }

    // Verify real verified accounts now populate /api/leaderboard (and zero fabricated entries)
    const lbRes = await fetch(`${srv.url}/api/leaderboard`);
    const lbJson = (await lbRes.json()) as { leaderboard: { username: string; verified: boolean }[] };
    assert.ok(lbJson.leaderboard.length >= 8, `Expected verified drivers on leaderboard, got ${lbJson.leaderboard.length}`);
    assert.ok(lbJson.leaderboard.every((e) => e.verified === true));

    console.log('[Multiplayer Multi-Client Telemetry V6.0]', JSON.stringify(stageTelemetry));
  } finally {
    await srv.close();
  }
});
