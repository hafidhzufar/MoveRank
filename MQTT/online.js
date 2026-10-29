'use strict';

// Loaded after the existing UI and sensor scripts. Demo remains available until configured.
(() => {
  const $ = id => document.getElementById(id);
  let connection, sensor, activeRound;
  const status = message => { $('cloud-status').textContent = message; };
  $('cloud-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (connection) { status('Koneksi akan dicoba ulang otomatis. Muat ulang untuk mengganti konfigurasi.'); return; }
    if (typeof MoveRankMQTT !== 'function' || typeof MoveRankMotionSensor !== 'function') { status('Modul belum dimuat. Periksa internet lalu muat ulang.'); return; }
    $('cloud-connect').disabled = true;
    try {
      connection = new MoveRankMQTT({
        onConnection(connected) { window.MoveRankUI.setConnection(connected); status(connected ? 'Terhubung ke MQTT Cloud.' : 'Menghubungkan ulang; skor terakhir tetap disimpan selama halaman terbuka.'); },
        onError(error) { status(error.message); },
        onRoom(room) {
          window.MoveRankUI.updateRoom(room);
          $('cloud-invitation-wrap').hidden = !connection.invitation;
          $('cloud-invitation').value = connection.invitation || '';
          if (room.status === 'running' && room.remaining > 0) {
            if (activeRound !== room.round) {
              activeRound = room.round;
              sensor.reset();
              sensor.start().catch(error => { $('cloud-sensor-status').textContent = error.message; });
            }
          } else if (sensor.state === 'running' || sensor.starting) sensor.stop();
          $('cloud-resume').hidden = room.status !== 'running' || room.remaining === 0 || sensor.state === 'running' || sensor.starting;
        }
      });
      sensor = new MoveRankMotionSensor({
        onUpdate(stats) { connection.submitStats(stats); },
        onStatus({ state, message }) {
          $('cloud-sensor-status').textContent = message;
          $('cloud-resume').hidden = state === 'running' || state === 'requesting' || connection.room?.status !== 'running';
        }
      });
      window.MoveRankUI.configure({
        createRoom: payload => connection.createRoom(payload),
        joinRoom: payload => connection.joinRoom({ ...payload, invitation: $('join-invitation').value.trim() }),
        async setReady(payload) {
          // Keep requestPermission in the original click stack before any network await.
          if (payload.ready) await sensor.requestPermission();
          return connection.setReady(payload);
        },
        startMatch: () => connection.startMatch(),
        resetMatch: () => connection.resetMatch()
      });
      $('join-invitation-field').hidden = false;
      $('join-invitation').required = true;
      $('cloud-config').disabled = true;
      $('cloud-connect').textContent = 'Mode online aktif';
      status('Menghubungkan ke MQTT Cloud...');
      await connection.connect({ url: $('cloud-url').value.trim(), username: $('cloud-username').value.trim(), password: $('cloud-password').value });
      $('cloud-password').value = '';
    } catch (error) {
      status(error.message);
      if (!connection?.client) {
        connection = null; $('cloud-config').disabled = false;
        $('cloud-connect').disabled = false; $('cloud-connect').textContent = 'Hubungkan MQTT';
      }
    }
  });
  $('cloud-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('cloud-invitation').value); status('Kunci undangan disalin. Kirim bersama kode room hanya ke lawan.'); }
    catch { $('cloud-invitation').focus(); $('cloud-invitation').select(); status('Salin kunci undangan yang dipilih secara manual.'); }
  });
  $('cloud-resume').addEventListener('click', () => {
    sensor?.start().catch(error => { $('cloud-sensor-status').textContent = error.message; });
  });
  window.addEventListener('pagehide', () => {
    sensor?.stop(); connection?.disconnect();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && connection?.closed) status('Halaman dipulihkan setelah ditutup. Muat ulang untuk menyambung dan buat room baru.');
  });
})();
