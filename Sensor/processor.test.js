const test = require('node:test');
const assert = require('node:assert/strict');
const StepProcessor = require('./processor.js');

function sample(timestamp, signal = 0, gyro = 30, gravity = true) {
  return {
    timestamp,
    acceleration: { x: 0, y: 0, z: signal },
    accelerationIncludingGravity: gravity ? { x: 0, y: 0, z: 9.80665 + signal } : null,
    rotationRate: { alpha: gyro, beta: 0, gamma: 0 }
  };
}

function walk(processor, { start = 0, period = 600, count = 10, gyro = 30, gravity = true, interval = 20, amplitude = 3 } = {}) {
  let result;
  for (let t = 0; t < period * count; t += interval) {
    const phase = t % period;
    const signal = phase <= 240 ? amplitude * (1 - Math.abs(phase - 120) / 120) : 0;
    result = processor.push(sample(start + t, signal, gyro, gravity));
  }
  return result;
}

test('FR-05: moving average rejects isolated noise and low-amplitude vibration', () => {
  const processor = new StepProcessor();
  for (let t = 0; t < 5000; t += 20) {
    const noise = t === 1000 ? 3 : (t % 40 === 0 ? 0.2 : -0.2);
    processor.push(sample(t, noise));
  }
  assert.deepEqual(processor.snapshot(), { steps: 0, activity: 'Diam', cadence: 0, timestamp: 4980 });
});

test('FR-06/08: synthetic walking produces one step per peak and walking activity', () => {
  const result = walk(new StepProcessor());
  assert.equal(result.steps, 10);
  assert.equal(result.activity, 'Berjalan');
  assert.ok(result.cadence >= 90 && result.cadence <= 110);
});

test('FR-08: faster accepted steps classify as brisk walking; inactivity returns to idle', () => {
  const processor = new StepProcessor();
  const result = walk(processor, { period: 400, count: 15 });
  assert.equal(result.steps, 15);
  assert.equal(result.activity, 'Berjalan cepat');
  assert.ok(result.cadence >= 120);
  const idle = processor.advanceTime(9000);
  assert.equal(idle.steps, 15);
  assert.equal(idle.activity, 'Diam');
  assert.equal(idle.cadence, 0);
});

test('FR-08: exactly 120 steps per minute meets the brisk threshold between steps', () => {
  const result = walk(new StepProcessor(), { period: 500 });
  assert.equal(result.cadence, 120);
  assert.equal(result.activity, 'Berjalan cepat');
});

test('FR-06: refractory interval rejects implausibly close peaks', () => {
  const result = walk(new StepProcessor({ windowMs: 20 }), { period: 280, count: 12 });
  assert.equal(result.steps, 6);
});

test('FR-07: no rotation, missing axes, and excessive rotation fail closed', () => {
  for (const gyro of [0, 4, 301, 900, null, NaN, Infinity]) {
    assert.equal(walk(new StepProcessor(), { gyro }).steps, 0, `gyro=${gyro}`);
  }
  const processor = new StepProcessor();
  for (let t = 0; t < 2000; t += 20) {
    const reading = sample(t, 3);
    reading.rotationRate = { alpha: 30, beta: null, gamma: 0 };
    processor.push(reading);
  }
  assert.equal(processor.snapshot().steps, 0);
});

test('FR-07: rotation must be recent, not retained from an old excursion', () => {
  const processor = new StepProcessor();
  processor.push(sample(0));
  for (let t = 20; t <= 10000; t += 20) processor.push(sample(t, 0.5, t === 1000 ? 30 : 0));
  for (let t = 10020; t <= 10400; t += 20) processor.push(sample(t, t < 10200 ? 3 : 0, 0));
  assert.equal(processor.snapshot().steps, 0);
});

test('FR-04: supports linear acceleration fallback and rotated gravity vectors', () => {
  assert.equal(walk(new StepProcessor(), { gravity: false }).steps, 10);
  const processor = new StepProcessor();
  for (let t = 0; t < 3000; t += 20) {
    const reading = sample(t);
    const angle = t / 100;
    reading.accelerationIncludingGravity = { x: 9.80665 * Math.sin(angle), y: 9.80665 * Math.cos(angle), z: 0 };
    processor.push(reading);
  }
  assert.equal(processor.snapshot().steps, 0);
});

test('time-based smoothing handles common device sample rates', () => {
  for (const interval of [10, 20, 40]) {
    assert.equal(walk(new StepProcessor(), { interval }).steps, 10, `interval=${interval}`);
  }
});

test('switching acceleration sources clears pending peaks with different baselines', () => {
  const processor = new StepProcessor();
  for (let t = 0; t < 1000; t += 20) {
    const reading = sample(t);
    reading.acceleration = { x: 2, y: 0, z: 0 };
    reading.accelerationIncludingGravity = t >= 400 && t <= 600 ? null : { x: 2, y: 0, z: 9.80665 };
    processor.push(reading);
  }
  assert.equal(processor.snapshot().steps, 0);
});

test('invalid timestamps discard pending peaks without changing the clock', () => {
  const processor = new StepProcessor();
  processor.push(sample(0));
  processor.push(sample(200, 3));
  processor.push(sample(NaN));
  assert.equal(processor.snapshot().timestamp, 200);
  assert.equal(processor.push(sample(400)).steps, 0);
});

test('malformed readings, stale timestamps and gaps do not create phantom steps', () => {
  const processor = new StepProcessor();
  const before = walk(processor);
  for (const timestamp of [-1, NaN, Infinity, 100, before.timestamp]) processor.push(sample(timestamp, 3));
  assert.deepEqual(processor.snapshot(), before);
  processor.push({ timestamp: 6100 });
  processor.push(sample(6200, Infinity));
  processor.push(sample(6300, 100));
  processor.push(sample(6400, 3));
  processor.push(sample(10000, 2));
  assert.equal(processor.push(sample(10020, 0)).steps, 10);
  assert.equal(processor.snapshot().activity, 'Diam');
  assert.equal(walk(processor, { start: 11000, count: 3 }).steps, 13);
});

test('reset clears steps, filter, cadence and timing for a new match', () => {
  const processor = new StepProcessor();
  walk(processor);
  assert.deepEqual(processor.reset(), { steps: 0, activity: 'Diam', cadence: 0, timestamp: null });
  assert.equal(walk(processor, { count: 2 }).steps, 2);
});

test('pause preserves score but discards cadence and pending sensor history', () => {
  const processor = new StepProcessor();
  walk(processor);
  const paused = processor.pause();
  assert.equal(paused.steps, 10);
  assert.equal(paused.activity, 'Diam');
  assert.equal(paused.cadence, 0);
  assert.equal(walk(processor, { start: 10000, count: 2 }).steps, 12);
});

test('invalid algorithm configuration is rejected', () => {
  for (const options of [{ windowMs: 0 }, { peakThreshold: NaN }, { typo: 1 }, { releaseThreshold: 2 }, { gyroMin: 300 }, { maxGapMs: 100 }, { idleTimeoutMs: 200 }, { activityWindowMs: 1000 }]) {
    assert.throws(() => new StepProcessor(options));
  }
});
