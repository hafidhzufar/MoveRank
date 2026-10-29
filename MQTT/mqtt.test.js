'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const MoveRankMQTT = require('./mqtt.js');

class Broker {
  constructor() { this.clients = []; this.retained = new Map(); this.packets = []; this.deny = false; }
  connect(url, options) {
    const client = new EventEmitter();
    client.topics = new Set(); client.connected = false;
    client.subscribe = (topic, config, done) => setImmediate(() => {
      if (this.deny) { done(null, [{ topic, qos: 128 }]); return; }
      client.topics.add(topic); done(null, [{ topic, qos: config.qos }]);
      if (this.retained.has(topic)) setImmediate(() => client.emit('message', topic, Buffer.from(this.retained.get(topic)), { retain: true }));
    });
    client.unsubscribe = (topic, done) => { client.topics.delete(topic); done(); };
    client.publish = (topic, payload, config, done) => {
      assert.equal(client.connected, true, 'must not queue offline packets');
      this.packets.push({ topic, payload, config, client });
      if (config.retain) this.retained.set(topic, payload);
      for (const peer of this.clients) if (peer.connected && peer.topics.has(topic)) setImmediate(() => peer.emit('message', topic, Buffer.from(payload), { retain: false }));
      setImmediate(() => done());
    };
    client.end = () => { client.connected = false; client.topics.clear(); };
    client.drop = () => { client.connected = false; client.topics.clear(); client.emit('close'); };
    client.restore = () => { client.connected = true; client.emit('connect'); };
    this.clients.push(client); this.lastOptions = options;
    setImmediate(() => client.restore());
    return client;
  }
}
async function until(predicate) {
  const end = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for MQTT test state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const settings = { url: 'wss://cluster.example:8884/mqtt', username: 'app', password: 'test-only' };
async function pair(t) {
  const broker = new Broker(), clock = { now: 100000 };
  const options = { mqtt: broker, now: () => clock.now, requestTimeout: 1000 };
  const host = new MoveRankMQTT(options), guest = new MoveRankMQTT(options);
  t.after(() => { host.disconnect(); guest.disconnect(); });
  await host.connect(settings); await guest.connect(settings);
  const room = await host.createRoom({ name: 'Host', duration: 60 });
  await guest.joinRoom({ name: 'Guest', code: room.code, invitation: host.invitation });
  return { host, guest, broker, clock };
}
async function start(host, guest) {
  await host.setReady({ ready: true }); await guest.setReady({ ready: true });
  await host.startMatch(); await until(() => guest.room?.status === 'running');
}

test('two clients join, ready, exchange aggregates, and agree on official result', async t => {
  const { host, guest, broker, clock } = await pair(t);
  assert.equal(guest.room.hostId, host.identity.id);
  assert.equal(host.room.players.length, 2);
  await assert.rejects(guest.startMatch(), /Hanya host/);
  await start(host, guest);
  clock.now += 3000;
  host.submitStats({ steps: 4, activity: 'Berjalan', acceleration: { x: 999 } });
  guest.submitStats({ steps: 7, activity: 'Berjalan cepat', timestamp: 999 });
  guest.tick();
  await until(() => host.room.players.find(p => p.id === guest.identity.id).steps === 7);
  await until(() => guest.room.players.find(p => p.id === host.identity.id).steps === 4);
  clock.now = host.room.endsAt; host.tick();
  await until(() => guest.room.status === 'finished');
  assert.deepEqual(guest.room.winnerIds, [guest.identity.id]);
  assert.deepEqual(host.room.winnerIds, guest.room.winnerIds);
  for (const packet of broker.packets) {
    assert.equal(packet.payload.includes('Host'), false);
    assert.equal(packet.payload.includes('test-only'), false);
    const key = packet.client === host.client ? host.key : guest.key;
    const plain = await host.security.open(packet.payload, key, packet.topic);
    assert.equal(JSON.stringify(plain).includes('acceleration'), false);
    assert.equal(JSON.stringify(plain).includes('timestamp'), false);
  }
  assert.equal(broker.lastOptions.queueQoSZero, false);
  assert.equal(broker.lastOptions.clean, true);
});

test('disconnect reconnect preserves cumulative score and does not double count', async t => {
  const { host, guest, clock } = await pair(t); await start(host, guest);
  guest.client.drop(); clock.now += 7000; host.tick();
  assert.equal(host.room.players[1].connected, false);
  guest.submitStats({ steps: 15, activity: 'Berjalan' }); guest.tick();
  assert.equal(host.room.players[1].steps, 0);
  guest.client.restore();
  await until(() => guest.subscribed);
  guest.tick();
  await until(() => host.room.players[1].steps === 15);
  assert.equal(host.room.players[1].connected, true);
  guest.tick(); await guest.outgoing; await host.incoming;
  assert.equal(host.room.players[1].steps, 15);
});

test('host reconnect republishes authoritative result after offline deadline', async t => {
  const { host, guest, clock } = await pair(t); await start(host, guest);
  host.client.drop(); clock.now = host.room.endsAt + 1000; host.tick();
  assert.equal(host.room.status, 'finished');
  host.client.restore();
  await until(() => guest.room.status === 'finished');
  assert.deepEqual(guest.room.winnerIds, host.room.winnerIds);
});

test('reset creates a fresh round and rejects delayed stats from previous round', async t => {
  const { host, guest, clock } = await pair(t); await start(host, guest);
  const oldRound = guest.room.round;
  const stale = guest.command('steps', { steps: 9, activity: 'Berjalan' });
  await host.resetMatch(); await until(() => guest.room.round !== oldRound);
  assert.ok(guest.room.players.every(p => p.steps === 0 && p.ready === false));
  await start(host, guest); clock.now += 5000;
  stale.seq = guest.seq + 10;
  await guest.publish('command', stale, false);
  await new Promise(resolve => setTimeout(resolve, 25)); await host.incoming;
  assert.equal(host.authority.value.players[1].steps, 0);
  assert.deepEqual(host.room.winnerIds, []);
});

test('rejects encrypted state forged by guest, duplicate revisions and malformed packets', async t => {
  const { host, guest, clock } = await pair(t);
  const original = guest.room.revision;
  const forgery = { ...guest.room, revision: original + 100, type: 'state', v: 1 };
  await guest.publish('state', forgery, false);
  await new Promise(resolve => setTimeout(resolve, 25)); await guest.incoming;
  assert.equal(guest.room.revision, original);
  const stale = { ...host.room, revision: original, hostNow: clock.now };
  await host.publish('state', stale, false);
  guest.client.emit('message', guest.topic('state'), Buffer.from('not json'));
  guest.client.emit('message', guest.topic('state'), Buffer.from('x'.repeat(17000)));
  await new Promise(resolve => setTimeout(resolve, 25)); await guest.incoming;
  assert.equal(guest.room.revision, original);
});

test('identity spoofing, retained commands and foreign topics cannot mutate host', async t => {
  const { host, guest } = await pair(t);
  const spoofed = guest.command('ready', { ready: true }); spoofed.id = host.identity.id;
  await guest.publish('command', spoofed, false);
  const valid = guest.command('ready', { ready: true });
  const payload = await guest.security.seal(valid, guest.identity, guest.key, guest.topic('command'));
  host.client.emit('message', host.topic('command'), Buffer.from(payload), { retain: true });
  host.client.emit('message', 'moverank/v1/WRONG1/command', Buffer.from(payload));
  await new Promise(resolve => setTimeout(resolve, 25)); await host.incoming;
  assert.ok(host.authority.value.players.every(p => !p.ready));
});

test('bad invitation fails cleanly and leaves room join available', async t => {
  const { host, guest, broker, clock } = await pair(t);
  const outsider = new MoveRankMQTT({ mqtt: broker, now: () => clock.now, requestTimeout: 80 });
  t.after(() => outsider.disconnect()); await outsider.connect(settings);
  await assert.rejects(outsider.joinRoom({ name: 'X', code: host.room.code, invitation: 'bad' }));
  assert.equal(outsider.context, undefined);
  await assert.rejects(outsider.joinRoom({ name: 'X', code: host.room.code, invitation: host.invitation }), /penuh/);
  assert.equal(outsider.context, null);
  assert.equal(guest.room.players.length, 2);
});

test('subscription ACL denial rolls room back and unsafe URL is rejected', async t => {
  const broker = new Broker(); const client = new MoveRankMQTT({ mqtt: broker });
  t.after(() => client.disconnect());
  await assert.rejects(client.connect({ ...settings, url: 'ws://insecure.example/mqtt' }), /wss/);
  await client.connect(settings); broker.deny = true;
  await assert.rejects(client.createRoom({ name: 'Host', duration: 60 }), /Topic/);
  assert.equal(client.context, null);
});

test('offline guest still counts down to zero without inventing an official result', async t => {
  const { host, guest, clock } = await pair(t); await start(host, guest);
  let view; guest.onRoom = snapshot => { view = snapshot; };
  guest.client.drop(); clock.now = guest.room.endsAt + 1000; guest.tick();
  assert.equal(view.remaining, 0);
  assert.equal(view.status, 'running');
  assert.equal(view.players.find(p => p.id === host.identity.id).connected, false);
  assert.deepEqual(view.winnerIds, []);
});
