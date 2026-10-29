'use strict';

class MoveRankStepProcessor {
  static defaults = Object.freeze({
    windowMs: 120,
    peakThreshold: 1,
    releaseThreshold: 0.25,
    minStepIntervalMs: 300,
    gyroMin: 5,
    gyroMax: 300,
    maxGapMs: 1000,
    activityWindowMs: 5000,
    idleTimeoutMs: 2000,
    briskCadence: 120
  });

  constructor(options = {}) {
    this.options = { ...MoveRankStepProcessor.defaults, ...options };
    for (const [key, value] of Object.entries(this.options)) {
      if (!(key in MoveRankStepProcessor.defaults) || !Number.isFinite(value) || value < 0 || (value === 0 && !['gyroMin', 'releaseThreshold'].includes(key))) {
        throw new TypeError(`Opsi sensor tidak valid: ${key}`);
      }
    }
    const o = this.options;
    if (o.releaseThreshold >= o.peakThreshold || o.gyroMin >= o.gyroMax || o.windowMs >= o.maxGapMs || o.minStepIntervalMs >= o.idleTimeoutMs || o.idleTimeoutMs > o.activityWindowMs) {
      throw new RangeError('Hubungan ambang sensor tidak valid.');
    }
    this.reset();
  }

  reset() {
    this.steps = 0;
    this.timestamp = null;
    return this.pause();
  }

  pause() {
    this.lastSampleAt = null;
    this.lastStepAt = null;
    this.stepTimes = [];
    this.clearSignal();
    return this.snapshot();
  }

  clearSignal() {
    this.samples = [];
    this.previous = null;
    this.source = null;
    // Wait for a valley, rather than counting a peak already in progress.
    this.armed = false;
  }

  push(sample) {
    const timestamp = sample?.timestamp;
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      this.clearSignal();
      return this.snapshot();
    }
    if (this.timestamp !== null && timestamp <= this.timestamp) return this.snapshot();

    const vector = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
    const rotation = sample.rotationRate;
    const hasGyro = rotation && ['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(rotation[axis]));
    const gravity = sample.accelerationIncludingGravity;
    const linear = sample.acceleration;
    const source = vector(gravity) ? 'gravity' : 'linear';
    // Magnitude minus gravity is orientation-independent and retains signed gait peaks.
    const signal = source === 'gravity' ? Math.hypot(gravity.x, gravity.y, gravity.z) - 9.80665
      : vector(linear) ? Math.hypot(linear.x, linear.y, linear.z) : NaN;
    const gyro = hasGyro ? Math.hypot(rotation.alpha, rotation.beta, rotation.gamma) : NaN;

    if (!Number.isFinite(signal) || Math.abs(signal) > 50 || !Number.isFinite(gyro)) {
      this.clearSignal();
      this.lastSampleAt = null;
      return this.advanceTime(timestamp);
    }
    if (this.source !== source || (this.lastSampleAt !== null && timestamp - this.lastSampleAt > this.options.maxGapMs)) this.clearSignal();
    this.source = source;
    this.lastSampleAt = timestamp;
    this.timestamp = timestamp;

    this.samples.push({ timestamp, value: signal, gyro });
    while (this.samples[0].timestamp < timestamp - this.options.windowMs) this.samples.shift();
    const filtered = this.samples.reduce((sum, item) => sum + item.value, 0) / this.samples.length;
    const peakGyro = this.samples.reduce((max, item) => Math.max(max, item.gyro), 0);
    const previous = this.previous;
    if (this.armed && previous && previous.value >= this.options.peakThreshold && filtered < previous.value) {
      const spaced = this.lastStepAt === null || previous.timestamp - this.lastStepAt >= this.options.minStepIntervalMs;
      if (spaced && peakGyro >= this.options.gyroMin && peakGyro <= this.options.gyroMax) {
        this.steps += 1;
        this.lastStepAt = previous.timestamp;
        this.stepTimes.push(previous.timestamp);
      }
      this.armed = false;
    }
    if (filtered <= this.options.releaseThreshold) {
      this.armed = true;
    }
    this.previous = { timestamp, value: filtered };
    return this.snapshot();
  }

  advanceTime(timestamp) {
    if (Number.isFinite(timestamp) && timestamp >= 0 && (this.timestamp === null || timestamp >= this.timestamp)) this.timestamp = timestamp;
    return this.snapshot();
  }

  snapshot() {
    const now = this.timestamp ?? 0;
    while (this.stepTimes.length && this.stepTimes[0] < now - this.options.activityWindowMs) this.stepTimes.shift();
    const idle = this.lastStepAt === null || now - this.lastStepAt >= this.options.idleTimeoutMs;
    const elapsed = this.stepTimes.length > 1 ? this.lastStepAt - this.stepTimes[0] : 0;
    const cadence = !idle && elapsed > 0 ? Math.round((this.stepTimes.length - 1) * 60000 / elapsed) : 0;
    return {
      steps: this.steps,
      activity: idle ? 'Diam' : cadence >= this.options.briskCadence ? 'Berjalan cepat' : 'Berjalan',
      cadence,
      timestamp: this.timestamp
    };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = MoveRankStepProcessor;
else globalThis.MoveRankStepProcessor = MoveRankStepProcessor;
