const test = require('node:test');
const assert = require('node:assert/strict');
const DemoMatch = require('./match.js');

test('room creation validates inputs and blocks starting before both players are ready', () => {
  const match = new DemoMatch();
  assert.throws(() => match.create(' ', 60));
  assert.throws(() => match.create('Vela', 0));
  const room = match.create('Vela', 60);
  assert.match(room.code, /^[A-Z0-9]{6}$/);
  assert.equal(room.hostId, room.selfId);
  assert.throws(() => match.start(1000));
  match.ready();
  match.start(1000);
  assert.equal(room.status, 'running');
  assert.throws(() => match.start(1000));
  assert.throws(() => match.ready());
});

test('timer handles delayed ticks and stops counting at the deadline', () => {
  const match = new DemoMatch();
  const room = match.create('Vela', 60);
  match.ready(); match.start(1000);
  match.tick(11000, () => 0);
  assert.equal(room.remaining, 50);
  assert.equal(room.players[0].steps, 10);
  match.tick(121000, () => 0);
  assert.equal(room.remaining, 0);
  assert.equal(room.status, 'finished');
  assert.equal(room.players[0].steps, 60);
  match.tick(180000, () => 0);
  assert.equal(room.players[0].steps, 60);
});

test('reset retains room identity and clears scores and readiness', () => {
  const match = new DemoMatch();
  const room = match.create('Vela', 180);
  const code = room.code;
  match.ready(); match.start(0); match.tick(5000, () => 0.9);
  assert.equal(room.players[0].steps, 15);
  match.reset();
  assert.equal(room.code, code);
  assert.equal(room.remaining, 180);
  assert.equal(room.status, 'waiting');
  assert.ok(room.players.every(p => p.steps === 0 && !p.ready));
  assert.throws(() => match.start());
});

test('demo join gives the other player host role', () => {
  const match = new DemoMatch();
  const room = match.create('Vela', 180, true);
  assert.equal(room.code, 'MOV123');
  assert.notEqual(room.hostId, room.selfId);
});
