'use strict';
const $ = id => document.getElementById(id);
const demo = new DemoMatch();
const number = new Intl.NumberFormat('id-ID');
let room = null, adapter = null, dialogMode = 'create', toastTimeout, busy = false;
const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}
function render() {
  const self = room?.players.find(p => p.id === room.selfId);
  const opponent = room?.players.find(p => p.id !== room.selfId);
  const running = room?.status === 'running', finished = room?.status === 'finished';
  const isHost = room?.selfId === room?.hostId;
  const remaining = room?.remaining ?? 180;
  $('timer').innerHTML = `${String(Math.floor(remaining / 60)).padStart(2, '0')}<span>:</span>${String(remaining % 60).padStart(2, '0')}`;
  $('timer-progress').style.width = `${remaining / (room?.duration ?? 180) * 100}%`;
  $('timer-label').textContent = running ? 'WAKTU TERSISA' : finished ? 'TANTANGAN SELESAI' : 'WAKTU PERTANDINGAN';
  $('arena-tag').textContent = running ? 'SEDANG BERLANGSUNG' : finished ? 'SELESAI' : room ? 'LOBBY' : 'BELUM DIMULAI';
  $('match-title').textContent = running ? 'Terus melangkah!' : finished ? 'Langkahmu luar biasa.' : 'Siap untuk bergerak?';
  $('room-label').textContent = room ? `Room ${room.code}${room.demo ? ' · Demo lokal' : ''}` : 'Belum ada room aktif';
  $('room-code').textContent = room?.code ?? '';
  $('room-share').hidden = !room;
  $('self-name').innerHTML = `${escapeHTML(self?.name ?? 'Kamu')} <small>YOU</small>`;
  $('self-status').textContent = self ? (running ? self.activity : finished ? 'Selesai' : self.ready ? 'Siap bertanding' : 'Belum siap') : 'Belum masuk room';
  $('self-ready').textContent = self?.ready ? '✓' : '—';
  $('opponent-name').textContent = opponent?.name ?? 'Menunggu lawan';
  $('opponent-status').textContent = opponent ? (running ? opponent.activity : finished ? 'Selesai' : opponent.ready ? 'Siap bertanding' : 'Belum siap') : 'Ajak temanmu bergabung';
  $('opponent-avatar').textContent = opponent ? opponent.name.charAt(0).toUpperCase() : '?';
  $('opponent-ready').textContent = opponent?.ready ? '✓' : '—';
  $('ready-button').disabled = busy || !room || room.status !== 'waiting';
  $('ready-button').textContent = self?.ready ? '✓ Siap · Batalkan' : 'Saya siap';
  $('start-button').disabled = busy || !room || room.status !== 'waiting' || !isHost || room.players.length !== 2 || !room.players.every(p => p.ready);
  $('start-button').innerHTML = isHost || !room ? 'Mulai pertandingan <span>↗</span>' : 'Menunggu host';
  $('reset-button').disabled = busy || !room || !isHost;
  document.querySelectorAll('[data-open]').forEach(button => { button.disabled = busy || running || !!room; });
  $('step-total').textContent = number.format(self?.steps ?? 0);
  $('activity-label').textContent = self?.activity ?? 'Belum ada aktivitas';
  const elapsed = room ? room.duration - remaining : 0;
  $('pace').innerHTML = `${elapsed ? Math.round((self?.steps ?? 0) * 60 / elapsed) : 0} <small>langkah/menit</small>`;
  document.querySelector('.activity-bars').classList.toggle('running', !!running);
  let message = 'Buat atau gabung room untuk memulai tantangan.';
  if (room) message = running ? 'Ayo bergerak! Setiap langkah membuat perbedaan.' : 'Pilih “Saya siap” untuk menyiapkan pertandingan.';
  if (room?.status === 'waiting' && self?.ready) message = opponent?.ready ? (isHost ? 'Semua pemain siap. Mulai tantanganmu!' : 'Semua siap. Menunggu host memulai.') : 'Menunggu pemain lain siap.';
  if (finished) {
    const ranked = [...room.players].sort((a,b) => b.steps - a.steps);
    message = ranked.length > 1 && ranked[0].steps === ranked[1].steps ? 'Hasil seri! Kalian sama-sama hebat.' : `${ranked[0]?.name ?? 'Pemain'} memimpin dengan ${number.format(ranked[0]?.steps ?? 0)} langkah!`;
  }
  $('match-message').textContent = message;
  $('player-count').textContent = `${room?.players.length ?? 0} pemain di arena`;
  $('update-label').textContent = running ? (room.demo ? 'Simulasi diperbarui setiap detik' : 'Diperbarui melalui koneksi room') : finished ? 'Hasil akhir pertandingan' : 'Menunggu pertandingan';
  if (!room) return;
  let rank = 1;
  const ranked = [...room.players].sort((a,b) => b.steps - a.steps);
  $('leaderboard-body').innerHTML = ranked.map((p, i) => {
    if (i && p.steps !== ranked[i - 1].steps) rank = i + 1;
    return `<tr class="${p.id === room.selfId ? 'own-row' : ''}"><td><span class="rank-number ${rank === 1 ? 'first' : ''}">${String(rank).padStart(2, '0')}</span></td><td><span class="avatar ${p.id !== room.selfId ? 'avatar-opponent' : ''}">${escapeHTML(p.name.charAt(0).toUpperCase())}</span>${escapeHTML(p.name)}${p.id === room.selfId ? '<span class="you-label">YOU</span>' : ''}</td><td><span class="activity-pill">${escapeHTML(p.activity)}</span></td><td class="align-right score">${number.format(p.steps)}<small>langkah</small></td></tr>`;
  }).join('');
}
function openRoom(mode) {
  dialogMode = mode;
  $('room-form').reset();
  $('form-error').textContent = '';
  $('dialog-title').textContent = mode === 'create' ? 'Buat arena kamu.' : 'Masuk ke arena.';
  $('dialog-description').textContent = mode === 'create' ? 'Ajak satu teman dan mulai tantangan baru.' : 'Masukkan kode room yang dibagikan temanmu.';
  $('submit-room').textContent = mode === 'create' ? 'Buat room ↗' : 'Gabung room →';
  $('duration-field').hidden = mode !== 'create';
  $('code-field').hidden = mode !== 'join';
  $('join-code').required = mode === 'join';
  $('room-dialog').showModal();
  $('player-name').focus();
}
async function action(name, payload) {
  if (busy) return;
  busy = true; render();
  try {
    if (adapter) {
      const snapshot = await adapter[name](payload);
      if (snapshot) window.MoveRankUI.updateRoom(snapshot);
    } else {
      if (name === 'createRoom') room = demo.create(payload.name, payload.duration);
      if (name === 'joinRoom') {
        if (payload.code !== 'MOV123') throw new Error('Room demo tidak ditemukan. Gunakan kode MOV123.');
        room = demo.create(payload.name, 180, true);
      }
      if (name === 'setReady') {
        room = demo.ready();
        // Demo peer becomes ready; a demo host starts once the guest is ready.
        room.players[1].ready = true;
        if (room.hostId === 'demo' && room.players[0].ready) room = demo.start();
      }
      if (name === 'startMatch') room = demo.start();
      if (name === 'resetMatch') room = demo.reset();
    }
  } finally { busy = false; render(); }
}
document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openRoom(button.dataset.open)));
$('close-dialog').addEventListener('click', () => $('room-dialog').close());
$('room-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('form-error').textContent = '';
  const name = $('player-name').value.trim();
  if (!name) { $('form-error').textContent = 'Nama pemain tidak boleh kosong.'; return; }
  $('submit-room').disabled = true;
  $('close-dialog').disabled = true;
  try {
    await action(dialogMode === 'create' ? 'createRoom' : 'joinRoom', { name, duration: Number($('duration').value), code: $('join-code').value.trim().toUpperCase() });
    $('room-dialog').close();
    toast(dialogMode === 'create' ? 'Room berhasil dibuat. Arena siap!' : 'Kamu berhasil bergabung ke arena.');
    $('ready-button').focus();
  } catch (error) { $('form-error').textContent = error.message || 'Tidak dapat masuk room. Coba lagi.'; }
  finally { $('submit-room').disabled = false; $('close-dialog').disabled = false; }
});
$('room-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('ready-button').addEventListener('click', () => action('setReady', { ready: !room.players.find(p => p.id === room.selfId).ready }).catch(error => toast(error.message)));
$('start-button').addEventListener('click', () => action('startMatch').catch(error => toast(error.message)));
$('reset-button').addEventListener('click', () => $('reset-dialog').showModal());
$('cancel-reset').addEventListener('click', () => $('reset-dialog').close());
$('confirm-reset').addEventListener('click', async () => {
  $('confirm-reset').disabled = true;
  try { await action('resetMatch'); $('reset-dialog').close(); toast('Pertandingan direset. Siap untuk ronde baru?'); }
  catch (error) { toast(error.message); }
  finally { $('confirm-reset').disabled = false; }
});
$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(room.code); toast('Kode room disalin.'); }
  catch { toast(`Kode room: ${room.code} — salin secara manual.`); }
});
function updateNavigation() {
  const current = ['#dashboard', '#leaderboard', '#panduan'].includes(location.hash) ? location.hash : '#dashboard';
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.hash === current);
    if (link.hash === current) { link.setAttribute('aria-current', 'page'); $('page-label').textContent = link.textContent.replace(/[▦▥ⓘ]/g, '').trim(); }
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', updateNavigation);
setInterval(() => { if (!adapter && room?.status === 'running') { room = demo.tick(); render(); } }, 1000);

// Integration seam: MQTT owns room state; sensor readings are submitted by the sensor module.
window.MoveRankUI = Object.freeze({
  configure(integration) {
    if (room) throw new Error('Konfigurasikan integrasi sebelum masuk room.');
    for (const method of ['createRoom', 'joinRoom', 'setReady', 'startMatch', 'resetMatch']) {
      if (typeof integration?.[method] !== 'function') throw new Error(`Adapter membutuhkan ${method}().`);
    }
    adapter = integration;
    $('connection').lastChild.textContent = ' Mode online';
    $('data-note').textContent = 'Data langkah diterima dari modul sensor dan koneksi room.';
    $('dialog-note').textContent = 'Room disinkronkan melalui integrasi MQTT.';
    $('join-hint').textContent = 'Masukkan 6 karakter kode dari host.';
  },
  updateRoom(snapshot) {
    if (!adapter) throw new Error('Konfigurasikan adapter sebelum mengirim data room.');
    if (!snapshot || !['waiting','running','finished'].includes(snapshot.status) || !/^[A-Z0-9]{6}$/.test(snapshot.code) || !Number.isInteger(snapshot.duration) || snapshot.duration <= 0 || !Number.isInteger(snapshot.remaining) || snapshot.remaining < 0 || snapshot.remaining > snapshot.duration || !Array.isArray(snapshot.players) || snapshot.players.length < 1 || snapshot.players.length > 2 || new Set(snapshot.players.map(p => p.id)).size !== snapshot.players.length || !snapshot.players.some(p => p.id === snapshot.selfId) || !snapshot.players.some(p => p.id === snapshot.hostId) || !snapshot.players.every(p => typeof p.id === 'string' && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 24 && Number.isSafeInteger(p.steps) && p.steps >= 0 && typeof p.ready === 'boolean' && typeof p.activity === 'string')) throw new Error('Snapshot room tidak valid.');
    room = JSON.parse(JSON.stringify({ ...snapshot, demo: false }));
    render();
  },
  setConnection(connected) {
    if (!adapter) return;
    $('connection').lastChild.textContent = connected ? ' Terhubung' : ' Menghubungkan ulang…';
    $('connection').querySelector('i').style.background = connected ? 'var(--green)' : 'var(--orange)';
  }
});
updateNavigation();
render();
