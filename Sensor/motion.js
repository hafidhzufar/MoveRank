'use strict';

const SensorProcessor = typeof module !== 'undefined' && module.exports
  ? require('./processor.js') : globalThis.MoveRankStepProcessor;

class MoveRankMotionSensor {
  constructor({ target = globalThis.window, processorOptions = {}, onUpdate = () => {}, onStatus = () => {} } = {}) {
    if (typeof onUpdate !== 'function' || typeof onStatus !== 'function') throw new TypeError('Callback sensor harus berupa fungsi.');
    this.target = target;
    this.processor = new SensorProcessor(processorOptions);
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.permission = 'unknown';
    this.state = 'idle';
    this.generation = 0;
    this.starting = false;
    this.timer = null;
    this.lastEmitted = null;
    this.handleMotion = event => {
      if (this.state !== 'running') return;
      const timestamp = this.now();
      const vector = value => value && ['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]));
      const gyro = event.rotationRate;
      if ((vector(event.accelerationIncludingGravity) || vector(event.acceleration)) && gyro && ['alpha', 'beta', 'gamma'].every(axis => Number.isFinite(gyro[axis]))) this.lastValidAt = timestamp;
      this.emit(this.processor.push({
        timestamp,
        acceleration: event.acceleration,
        accelerationIncludingGravity: event.accelerationIncludingGravity,
        rotationRate: gyro
      }));
    };
    this.handleVisibility = () => {
      if (this.target.document.hidden) this.halt('paused', 'Sensor dijeda karena halaman tidak aktif. Tekan mulai untuk melanjutkan.');
    };
    this.handlePageHide = () => this.halt('paused', 'Sensor dijeda karena halaman ditinggalkan. Tekan mulai untuk melanjutkan.');
  }

  now() { return this.target.performance.now(); }

  async requestPermission() {
    const error = (code, message) => Object.assign(new Error(message), { code });
    const motion = this.target?.DeviceMotionEvent;
    if (this.target?.isSecureContext !== true) throw error('SENSOR_INSECURE_CONTEXT', 'Sensor memerlukan HTTPS (atau localhost untuk pengujian).');
    if (!motion) throw error('SENSOR_UNSUPPORTED', 'DeviceMotion tidak didukung browser ini. Gunakan Safari pada iPhone yang memiliki sensor.');
    if (this.target.document.hidden) throw error('SENSOR_PAGE_HIDDEN', 'Buka halaman di depan sebelum mengaktifkan sensor.');
    if (this.permission === 'granted') return this.permission;
    if (typeof motion.requestPermission === 'function') {
      let result;
      try {
        // This call must happen before the first await in the user's click handler.
        result = await motion.requestPermission();
      } catch {
        throw error('SENSOR_PERMISSION_FAILED', 'Izin sensor gagal. Minta izin melalui tombol yang ditekan langsung di Safari.');
      }
      if (result !== 'granted') {
        this.permission = 'denied';
        throw error('SENSOR_PERMISSION_DENIED', 'Izin sensor ditolak. Periksa izin Motion & Orientation di Safari lalu coba lagi.');
      }
    }
    this.permission = 'granted';
    return this.permission;
  }

  async start() {
    if (this.state === 'running' || this.starting) return this.processor.snapshot();
    this.starting = true;
    const generation = ++this.generation;
    this.setStatus('requesting', 'Meminta izin akses sensor...');
    try {
      const permission = this.requestPermission();
      // Guard the pending permission phase too: returning to the page must not auto-start.
      this.target?.addEventListener('pagehide', this.handlePageHide);
      this.target?.document?.addEventListener('visibilitychange', this.handleVisibility);
      await permission;
      if (generation !== this.generation) return this.processor.snapshot();
      if (this.target.document.hidden) {
        this.halt('paused', 'Halaman tidak aktif. Tekan mulai untuk melanjutkan.');
        return this.processor.snapshot();
      }
      this.processor.pause();
      this.startedAt = this.now();
      this.lastValidAt = null;
      this.target.addEventListener('devicemotion', this.handleMotion);
      this.timer = this.target.setInterval(() => {
        const now = this.now();
        if (now - (this.lastValidAt ?? this.startedAt) >= 2000) {
          this.halt('unavailable', 'Data accelerometer/gyroscope tidak tersedia selama 2 detik. Periksa izin dan sensor, lalu tekan mulai lagi.');
          return;
        }
        this.emit(this.processor.advanceTime(now));
      }, 250);
      this.setStatus('running', 'Sensor aktif. Jaga halaman tetap terbuka saat bergerak.');
      this.emit(this.processor.snapshot(), true);
      return this.processor.snapshot();
    } catch (error) {
      if (generation !== this.generation) return this.processor.snapshot();
      this.halt(error.code === 'SENSOR_PERMISSION_DENIED' ? 'denied' : 'unavailable', error.message);
      throw error;
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  stop() { return this.halt('stopped', 'Sensor dihentikan. Total langkah dipertahankan.'); }

  halt(state, message) {
    this.generation += 1;
    this.starting = false;
    this.target?.removeEventListener('devicemotion', this.handleMotion);
    this.target?.removeEventListener('pagehide', this.handlePageHide);
    this.target?.document?.removeEventListener('visibilitychange', this.handleVisibility);
    if (this.timer !== null) this.target.clearInterval(this.timer);
    this.timer = null;
    const snapshot = this.processor.pause();
    this.setStatus(state, message);
    this.emit(snapshot, true);
    return snapshot;
  }

  reset() {
    const snapshot = this.processor.reset();
    this.emit(snapshot, true);
    return snapshot;
  }

  snapshot() { return this.processor.snapshot(); }

  setStatus(state, message) {
    this.state = state;
    this.onStatus({ state, message });
  }

  emit(snapshot, force = false) {
    const previous = this.lastEmitted;
    if (!force && previous && ['steps', 'activity', 'cadence'].every(key => previous[key] === snapshot[key])) return;
    this.lastEmitted = { ...snapshot };
    this.onUpdate(snapshot);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = MoveRankMotionSensor;
else globalThis.MoveRankMotionSensor = MoveRankMotionSensor;
