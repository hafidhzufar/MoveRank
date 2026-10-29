'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MoveRankRoom, MoveRankCrypto } = require('./protocol.js');
const HOST = 'a'.repeat(32), GUEST = 'b'.repeat(32), SESSION = 'c'.repeat(32), ROUND = 'd'.repeat(32);
function lobby() {
  const room = new MoveRankRoom({ code: 'ABC123', session: SESSION, host: { id: HOST, name: 'Host' }, duration: 60, now: 100000, round: ROUND });
  const command = (id, seq, type, fields = {}) => ({ code: 'ABC123', session: SESSION, round: room.value.round, id, seq, type, ...fields });
  room.command(command(GUEST, 1, 'join', { name: 'Guest' }), 100000);
  return { room, command };
}
function running() {
  const result = lobby();
  result.room.command(result.command(HOST, 1, 'ready', { ready: true }), 100000);
  result.room.command(result.command(GUEST, 2, 'ready', { ready: true }), 100000);
  result.room.start(100000);
  return result;
}

test('room validates creation and requires two connected, ready players', () => {
  assert.throws(() => new MoveRankRoom({ code: 'bad' }));
  const { room, command } = lobby();
  assert.throws(() => room.start(100000));
  room.command(command(HOST, 1, 'ready', { ready: true }), 100000);
  room.command(command(GUEST, 2, 'ready', { ready: true }), 100000);
  assert.throws(() => room.start(107000));
  room.command(command(GUEST, 3, 'ping'), 107000);
  room.start(107000);
  assert.equal(room.value.status, 'running');
});

test('rejects foreign room/session/round, replay, full room, and unknown identity', () => {
  const { room, command } = lobby();
  const valid = command(GUEST, 2, 'ready', { ready: true });
  for (const fields of [{ code: 'ZZZ999' }, { session: '0'.repeat(32) }, { round: '0'.repeat(32) }, { id: '0'.repeat(32) }, { seq: 1 }, { seq: NaN }, { ready: 'true' }]) {
    assert.equal(room.command({ ...valid, ...fields }, 100000), false);
  }
  assert.equal(room.command(command('e'.repeat(32), 1, 'join', { name: 'Third' }), 100000), false);
  assert.equal(room.command(valid, 100000), true);
  assert.equal(room.command(valid, 100000), false);
});

test('validates cumulative steps without summing duplicates or accepting impossible rates', () => {
  const { room, command } = running();
  const score = (seq, steps, activity = 'Berjalan') => command(GUEST, seq, 'steps', { steps, activity });
  for (const steps of [-1, 1.5, Infinity, '3', 1000]) assert.equal(room.command(score(3, steps), 102000), false);
  assert.equal(room.command(score(3, 5), 102000), true);
  assert.equal(room.command(score(4, 5), 102000), true);
  assert.equal(room.value.players[1].steps, 5);
  assert.equal(room.command(score(5, 4), 102000), false);
  assert.equal(room.command(score(5, 6, 'sprint'), 102000), false);
  assert.equal(room.command(score(5, 7, 'Berjalan cepat'), 103000), true);
});

test('deadline produces official winner; late data cannot change the result', () => {
  const { room, command } = running();
  room.command(command(GUEST, 3, 'steps', { steps: 8, activity: 'Berjalan' }), 104000);
  room.command(command(HOST, 2, 'steps', { steps: 4, activity: 'Berjalan' }), 104000);
  room.tick(160000);
  assert.equal(room.value.status, 'finished');
  assert.deepEqual(room.value.winnerIds, [GUEST]);
  assert.equal(room.command(command(HOST, 3, 'steps', { steps: 100, activity: 'Berjalan' }), 160000), false);
  assert.equal(room.snapshot(180000).remaining, 0);
  assert.deepEqual(room.value.winnerIds, [GUEST]);
});

test('tie and reset retain room identity and isolate the new round', () => {
  const { room, command } = running();
  room.tick(160000);
  assert.deepEqual(room.value.winnerIds, [HOST, GUEST]);
  const old = command(GUEST, 3, 'ready', { ready: true });
  room.reset(160001, 'e'.repeat(32));
  assert.equal(room.value.code, 'ABC123');
  assert.equal(room.value.session, SESSION);
  assert.ok(room.value.players.every(p => p.steps === 0 && !p.ready));
  assert.equal(room.command(old, 160002), false);
  assert.deepEqual(room.value.winnerIds, []);
});

test('signed snapshot schema rejects inconsistent winners, time, IDs and stale packets', () => {
  const { room } = running(); room.value.revision = 1;
  const snapshot = room.snapshot(102000);
  const context = { code: 'ABC123', session: SESSION, hostId: HOST };
  assert.equal(MoveRankRoom.valid(snapshot, context, 102000), true);
  for (const fields of [{ remaining: 59 }, { endsAt: 42 }, { winnerIds: [HOST] }, { players: [...snapshot.players, snapshot.players[0]] }, { revision: NaN }, { round: 'old' }]) assert.equal(MoveRankRoom.valid({ ...snapshot, ...fields }, context, 102000), false);
  assert.equal(MoveRankRoom.valid(snapshot, context, 140000), false);
  room.tick(160000);
  assert.equal(MoveRankRoom.valid(room.snapshot(160000), context, 160000), true);
});

test('expiry blocks room reuse and late joins', () => {
  const { room, command } = lobby();
  assert.equal(room.command(command(GUEST, 2, 'ready', { ready: true }), 1900000), false);
  assert.throws(() => room.reset(1900000, 'e'.repeat(32)));
});

test('AES-GCM hides payload and binds topic; ECDSA authenticates individual senders', async () => {
  const security = new MoveRankCrypto();
  const host = await security.identity(), attacker = await security.identity();
  const imported = await security.importIdentity(host.publicKey);
  assert.equal(imported.id, host.id);
  const key = await security.roomKey(btoa(String.fromCharCode(...security.random(32))));
  const message = { name: 'Private nickname', steps: 42 };
  const payload = await security.seal(message, host, key, 'state');
  assert.equal(payload.includes(message.name), false);
  const packet = await security.open(payload, key, 'state');
  assert.deepEqual(packet.message, message);
  assert.equal(await security.verify(packet, imported.key), true);
  assert.equal(await security.verify(packet, attacker.keys.publicKey), false);
  packet.message.steps = 100;
  assert.equal(await security.verify(packet, imported.key), false);
  await assert.rejects(security.open(payload, key, 'command'));
  const otherKey = await security.roomKey(btoa(String.fromCharCode(...security.random(32))));
  await assert.rejects(security.open(payload, otherKey, 'state'));
  await assert.rejects(security.open('x'.repeat(16385), key, 'state'));
});
