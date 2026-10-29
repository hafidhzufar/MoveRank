const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const MotionSensor = require('./motion.js');

class TrackedTarget extends EventTarget {
  constructor() { super(); this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    super.addEventListener(type, callback);
  }
  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback);
  }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}

function environment(requestPermission = async () => 'granted') {
  const target = new TrackedTarget();
  target.time = 0;
  target.performance = { now: () => target.time };
  target.isSecureContext = true;
  target.DeviceMotionEvent = { requestPermission };
  target.document = new TrackedTarget();
  target.document.hidden = false;
  target.timers = new Map();
  let nextTimer = 0;
  target.setInterval = callback => { target.timers.set(++nextTimer, callback); return nextTimer; };
  target.clearInterval = id => target.timers.delete(id);
  target.tick = time => {
    target.time = time;
    for (const callback of [...target.timers.values()]) callback();
  };
  target.motion = (time, signal = 0, gyro = 30) => {
    target.time = time;
    target.dispatchEvent(Object.assign(new Event('devicemotion'), {
      acceleration: { x: 0, y: 0, z: signal },
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 + signal },
      rotationRate: { alpha: gyro, beta: 0, gamma: 0 }
    }));
  };
  return target;
}

function walk(target, start = 20, count = 5) {
  for (let t = 0; t < count * 600; t += 20) {
    const phase = t % 600;
    target.motion(start + t, phase <= 240 ? 3 * (1 - Math.abs(phase - 120) / 120) : 0);
  }
}

function assertClean(target) {
  assert.equal(target.count('devicemotion'), 0);
  assert.equal(target.count('pagehide'), 0);
  assert.equal(target.document.count('visibilitychange'), 0);
  assert.equal(target.timers.size, 0);
}

test('FR-03: permission is requested synchronously before motion capture is installed', async () => {
  let grant;
  let requests = 0;
  const target = environment(() => { requests++; return new Promise(resolve => { grant = resolve; }); });
  const sensor = new MotionSensor({ target });
  const starting = sensor.start();
  assert.equal(requests, 1);
  assert.equal(sensor.state, 'requesting');
  assert.equal(target.count('devicemotion'), 0);
  assert.equal(target.timers.size, 0);
  assert.equal(target.count('pagehide'), 1);
  assert.equal(target.document.count('visibilitychange'), 1);
  await sensor.start();
  assert.equal(requests, 1);
  grant('granted');
  await starting;
  await sensor.start();
  assert.equal(sensor.state, 'running');
  assert.equal(requests, 1);
  assert.equal(target.count('devicemotion'), 1);
  assert.equal(target.timers.size, 1);
  sensor.stop();
  assertClean(target);
});

test('permission can be acquired in the ready gesture and reused when the match starts', async () => {
  let requests = 0;
  const target = environment(async () => { requests++; return 'granted'; });
  const sensor = new MotionSensor({ target });
  await sensor.requestPermission();
  assert.equal(sensor.state, 'idle');
  assertClean(target);
  await sensor.start();
  assert.equal(requests, 1);
  sensor.stop();
});

test('FR-03: denied permissions do not install listeners and can be retried', async () => {
  let allowed = false;
  const target = environment(async () => allowed ? 'granted' : 'denied');
  const sensor = new MotionSensor({ target });
  await assert.rejects(sensor.start(), { code: 'SENSOR_PERMISSION_DENIED' });
  assert.equal(sensor.state, 'denied');
  assertClean(target);
  allowed = true;
  await sensor.start();
  assert.equal(sensor.state, 'running');
  sensor.stop();
});

test('insecure context, absent API, hidden pages and permission exceptions fail clearly', async () => {
  const cases = [
    [target => { target.isSecureContext = false; }, 'SENSOR_INSECURE_CONTEXT'],
    [target => { delete target.DeviceMotionEvent; }, 'SENSOR_UNSUPPORTED'],
    [target => { target.document.hidden = true; }, 'SENSOR_PAGE_HIDDEN'],
    [target => { target.DeviceMotionEvent.requestPermission = () => { throw new Error('NotAllowedError'); }; }, 'SENSOR_PERMISSION_FAILED']
  ];
  for (const [configure, code] of cases) {
    const target = environment();
    configure(target);
    const sensor = new MotionSensor({ target });
    await assert.rejects(sensor.start(), { code });
    assert.equal(sensor.state, 'unavailable');
    assertClean(target);
  }
  const sensor = new MotionSensor({ target: undefined });
  await assert.rejects(sensor.start(), { code: 'SENSOR_INSECURE_CONTEXT' });
});

test('browsers without the iOS permission method still capture real motion events', async () => {
  const target = environment();
  delete target.DeviceMotionEvent.requestPermission;
  const updates = [];
  const sensor = new MotionSensor({ target, onUpdate: value => updates.push(value) });
  await sensor.start();
  walk(target);
  assert.equal(sensor.snapshot().steps, 5);
  assert.equal(sensor.snapshot().activity, 'Berjalan');
  assert.equal(updates.at(-1).steps, 5);
  assert.ok(updates.length < 20, 'Raw samples must not become a flood of statistics callbacks');
  sensor.stop();
  assertClean(target);
});

test('watchdog detects silent and null sensors even after permission is granted', async () => {
  for (const nullReadings of [false, true]) {
    const target = environment();
    const sensor = new MotionSensor({ target });
    await sensor.start();
    if (nullReadings) {
      for (let t = 0; t < 2000; t += 20) {
        target.time = t;
        target.dispatchEvent(new Event('devicemotion'));
      }
    }
    target.tick(2000);
    assert.equal(sensor.state, 'unavailable');
    assert.equal(sensor.snapshot().steps, 0);
    assertClean(target);
  }
});

test('valid stationary data keeps capture alive while missing gyro stops it', async () => {
  const target = environment();
  const sensor = new MotionSensor({ target });
  await sensor.start();
  for (let t = 20; t <= 4000; t += 20) { target.motion(t, 0, 0); target.tick(t); }
  assert.equal(sensor.state, 'running');
  assert.equal(sensor.snapshot().activity, 'Diam');
  for (let t = 4020; t <= 6000; t += 20) { target.motion(t, 0, null); target.tick(t); }
  assert.equal(sensor.state, 'unavailable');
  assertClean(target);
});

test('stop preserves steps, restart does not duplicate listeners, and reset starts a fresh score', async () => {
  const target = environment();
  const sensor = new MotionSensor({ target });
  await sensor.start();
  walk(target);
  assert.equal(sensor.stop().steps, 5);
  assert.equal(sensor.snapshot().activity, 'Diam');
  walk(target, 4000);
  assert.equal(sensor.snapshot().steps, 5);
  assertClean(target);
  await sensor.start();
  walk(target, 8000, 2);
  assert.equal(sensor.snapshot().steps, 7);
  assert.equal(target.count('devicemotion'), 1);
  sensor.reset();
  assert.equal(sensor.snapshot().steps, 0);
  walk(target, 10000, 2);
  assert.equal(sensor.snapshot().steps, 2);
  sensor.stop();
  sensor.stop();
  assertClean(target);
});

test('hidden pages and pagehide pause capture, requiring explicit resume', async () => {
  for (const type of ['visibilitychange', 'pagehide']) {
    const target = environment();
    const sensor = new MotionSensor({ target });
    await sensor.start();
    walk(target);
    if (type === 'visibilitychange') {
      target.document.hidden = true;
      target.document.dispatchEvent(new Event(type));
    } else target.dispatchEvent(new Event(type));
    assert.equal(sensor.state, 'paused');
    assert.equal(sensor.snapshot().steps, 5);
    assertClean(target);
    target.document.hidden = false;
    target.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(sensor.state, 'paused');
  }
});

test('stopping while the permission prompt is pending cannot start a listener later', async () => {
  let grant;
  const target = environment(() => new Promise(resolve => { grant = resolve; }));
  const sensor = new MotionSensor({ target });
  const starting = sensor.start();
  sensor.stop();
  grant('granted');
  await starting;
  assert.equal(sensor.state, 'stopped');
  assertClean(target);
  await sensor.start();
  assert.equal(sensor.state, 'running');
  sensor.stop();
});

test('a page hidden during a pending prompt is not started after permission resolves', async () => {
  let grant;
  const target = environment(() => new Promise(resolve => { grant = resolve; }));
  const sensor = new MotionSensor({ target });
  const starting = sensor.start();
  target.document.hidden = true;
  grant('granted');
  await starting;
  assert.equal(sensor.state, 'paused');
  assertClean(target);
});

test('page interruptions invalidate a pending start even when visibility returns before permission', async () => {
  for (const type of ['visibilitychange', 'pagehide']) {
    let grant;
    const target = environment(() => new Promise(resolve => { grant = resolve; }));
    const sensor = new MotionSensor({ target });
    const starting = sensor.start();
    if (type === 'visibilitychange') {
      target.document.hidden = true;
      target.document.dispatchEvent(new Event(type));
      target.document.hidden = false;
      target.document.dispatchEvent(new Event(type));
    } else target.dispatchEvent(new Event(type));
    grant('granted');
    await starting;
    assert.equal(sensor.state, 'paused');
    assertClean(target);
    await sensor.start();
    assert.equal(sensor.state, 'running');
    sensor.stop();
  }
});

test('browser scripts expose globals without CommonJS or a bundler', () => {
  const context = vm.createContext({});
  for (const file of ['processor.js', 'motion.js']) vm.runInContext(readFileSync(`${__dirname}/${file}`, 'utf8'), context);
  assert.equal(typeof context.MoveRankStepProcessor, 'function');
  assert.equal(typeof context.MoveRankMotionSensor, 'function');
  assert.equal(new context.MoveRankMotionSensor({ target: environment() }).snapshot().steps, 0);
});

test('sensor lab loads local assets in order and its controls display real sensor statistics', async () => {
  const html = readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)" defer>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['processor.js', 'motion.js', 'demo.js']);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(existsSync(path.resolve(__dirname, decodeURIComponent(match[1]))), `Missing asset: ${match[1]}`);
  }
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], Object.assign(new TrackedTarget(), { textContent: '', disabled: false })]));
  const target = environment();
  target.document.getElementById = id => {
    assert.ok(elements.has(id), `Unknown element: ${id}`);
    return elements.get(id);
  };
  const context = vm.createContext({ window: target, document: target.document, Intl });
  for (const file of scripts) vm.runInContext(readFileSync(path.join(__dirname, file), 'utf8'), context);
  elements.get('start').dispatchEvent(new Event('click'));
  assert.equal(elements.get('start').disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('sensor-state').textContent, 'Sensor aktif');
  walk(target);
  assert.equal(elements.get('steps').textContent, '5');
  assert.equal(elements.get('activity').textContent, 'Berjalan');
  assert.equal(elements.get('stop').disabled, false);
  elements.get('stop').dispatchEvent(new Event('click'));
  assert.equal(elements.get('start').disabled, false);
  assert.equal(elements.get('stop').disabled, true);
  assertClean(target);
  elements.get('reset').dispatchEvent(new Event('click'));
  assert.equal(elements.get('steps').textContent, '0');
  assert.equal(elements.get('activity').textContent, 'Diam');
});
