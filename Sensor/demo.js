'use strict';

const element = id => document.getElementById(id);
const labels = {
  idle: 'Belum aktif', requesting: 'Meminta izin', running: 'Sensor aktif',
  stopped: 'Dihentikan', paused: 'Dijeda', denied: 'Izin ditolak', unavailable: 'Sensor tidak tersedia'
};
const sensor = new MoveRankMotionSensor({
  onUpdate({ steps, activity, cadence }) {
    element('steps').textContent = new Intl.NumberFormat('id-ID').format(steps);
    element('activity').textContent = activity;
    element('cadence').textContent = cadence;
  },
  onStatus({ state, message }) {
    element('sensor-state').textContent = labels[state];
    element('sensor-message').textContent = message;
    element('start').disabled = state === 'requesting' || state === 'running';
    element('stop').disabled = state !== 'requesting' && state !== 'running';
  }
});

element('start').addEventListener('click', () => {
  // Do not await any other work before start(): Safari needs this user gesture.
  sensor.start().catch(error => { element('sensor-message').textContent = error.message; });
});
element('stop').addEventListener('click', () => sensor.stop());
element('reset').addEventListener('click', () => sensor.reset());
