import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createAppServer } from '../server';
import { SnapshotDecoder } from '../shared/protocol/snapshotCodec';

function connectWithQueue(wsUrl: string): Promise<{
  ws: WebSocket;
  waitFor: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const queue: any[] = [];
    const waiters: { predicate: (msg: any) => boolean; resolve: (m: any) => void; timer: NodeJS.Timeout }[] = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].predicate(msg)) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
          return;
        }
      }
      queue.push(msg);
    });

    const waitFor = (predicate: (msg: any) => boolean, timeoutMs = 4500): Promise<any> => {
      const idx = queue.findIndex(predicate);
      if (idx >= 0) {
        return Promise.resolve(queue.splice(idx, 1)[0]);
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          const wi = waiters.findIndex((w) => w.timer === timer);
          if (wi >= 0) waiters.splice(wi, 1);
          rej(new Error('Timed out waiting for WebSocket message'));
        }, timeoutMs);
        waiters.push({ predicate, resolve: res, timer });
      });
    };

    ws.once('open', () => resolve({ ws, waitFor }));
    ws.once('error', reject);
  });
}

test('V7 Gate I: Live server readiness, compact snapshots, and grace-period reconnection preserve player slot without duplicates', async () => {
  const srv = await createAppServer({
    port: 0,
    enableVite: false,
    persistToDisk: false,
    simHz: 60,
    snapshotHz: 20,
    countdownSeconds: 0.2,
    reconnectGraceMs: 6000,
    compactSnapshotsByDefault: true,
    maxPlayersPerRoom: 20,
  });

  try {
    const baseUrl = `http://127.0.0.1:${srv.port}`;
    const wsUrl = `ws://127.0.0.1:${srv.port}/ws`;

    // 1. Verify /api/ready endpoint
    const readyRes = await fetch(`${baseUrl}/api/ready`);
    assert.equal(readyRes.status, 200);
    const readyJson = (await readyRes.json()) as any;
    assert.equal(readyJson.ready, true);
    assert.ok(typeof readyJson.persistenceKind === 'string');
    assert.equal(typeof readyJson.roomsActive, 'number');

    // 2. Connect client and create room
    const c1 = await connectWithQueue(wsUrl);
    const welcome = await c1.waitFor((m) => m.type === 'welcome');
    assert.ok(welcome.playerId);

    c1.ws.send(
      JSON.stringify({
        type: 'create_room',
        name: 'RECONNECT_ACE',
        vehicleId: 'street_falcon',
        trackId: 'neon_city',
        mode: 'combat_race',
        laps: 2,
      }),
    );
    const roomMsg = await c1.waitFor((m) => m.type === 'room_state' && m.room?.code);
    const roomCode = roomMsg.room.code;

    // 3. Start race, capture matchId + reconnectToken on race_start, verify compact v2 snapshot decodes cleanly
    c1.ws.send(JSON.stringify({ type: 'start_match' }));
    const startMsg = await c1.waitFor((m) => m.type === 'race_start');
    const matchId = startMsg.matchId as string;
    const reconnectToken = startMsg.reconnectToken as string;
    assert.ok(matchId && matchId.length > 4, 'Server must send matchId');
    assert.ok(reconnectToken && reconnectToken.length >= 16, 'Server must issue reconnectToken');

    const compactMsg = await c1.waitFor((m) => m.type === 'world_snapshot_compact');
    const decoder = new SnapshotDecoder();
    const decoded = decoder.decode(compactMsg);
    assert.ok(decoded, 'Compact snapshot must decode cleanly');
    assert.ok(decoded.racers.some((r) => r.id === welcome.playerId));

    // 4. Simulate disconnect mid-race, then reconnect with valid token within grace window
    c1.ws.close();
    await new Promise((r) => setTimeout(r, 120));

    const c2 = await connectWithQueue(wsUrl);
    await c2.waitFor((m) => m.type === 'welcome');

    // Reject forged reconnect token first
    c2.ws.send(
      JSON.stringify({
        type: 'reconnect',
        matchId,
        reconnectToken: 'forged_invalid_token_1234',
      }),
    );
    const errMsg = await c2.waitFor((m) => m.type === 'error');
    assert.equal(errMsg.code, 'RECONNECT_FAILED');

    // Now reconnect with valid token
    c2.ws.send(
      JSON.stringify({
        type: 'reconnect',
        matchId,
        reconnectToken,
      }),
    );
    const reconnected = await c2.waitFor((m) => m.type === 'reconnected');
    assert.equal(reconnected.playerId, welcome.playerId);
    assert.equal(reconnected.matchId, matchId);
    assert.equal(reconnected.room.code, roomCode);
    const matchingPlayers = reconnected.room.players.filter((p: any) => p.id === welcome.playerId);
    assert.equal(matchingPlayers.length, 1);

    c2.ws.close();
  } finally {
    await srv.close();
  }
});
