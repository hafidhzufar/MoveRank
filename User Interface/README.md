# MoveRank — Frontend

Antarmuka HTML, CSS, dan JavaScript tanpa framework untuk tugas anggota 1. Tema hitam/oranye, sidebar desktop, navigasi bawah pada ponsel, dan layout responsif. Font Google Fonts bersifat opsional; font sistem digunakan jika offline.

## Menjalankan

Untuk demo lokal, buka `index.html` langsung di browser. Untuk mode online, sajikan root repo agar folder Sensor dan MQTT juga tersedia. Dari root repo jalankan:

```sh
python -m http.server 8765
```

Buka `http://localhost:8765/User%20Interface/index.html`. Untuk menguji pada iPhone, sajikan folder melalui server yang dapat diakses iPhone. Integrasi DeviceMotion oleh anggota 2 membutuhkan HTTPS dan izin sensor dari interaksi pengguna. Pengujian langsung Safari iPhone masih diperlukan.

## Mode online anggota 3

Integrasi MQTT dan sensor tersedia melalui panel **Main online dengan MQTT Cloud**. Isi URL WSS dan kredensial pada kedua perangkat sebelum membuat/gabung room. Host membagikan kode dan kunci undangan; pemain meminta izin sensor melalui Saya siap. Leaderboard, hasil resmi, reconnect, serta reset dikelola adapter anggota 3. Panduan lengkap dan batasan uji ada di [`../MQTT/README.md`](../MQTT/README.md). Default halaman tetap demo lokal sampai konfigurasi online dipilih. Muat ulang untuk mengganti broker atau keluar dari room.

## Alur yang tersedia

- FR-01: buat room dengan nama dan durasi 1, 3, atau 5 menit.
- FR-02: gabung dengan kode enam karakter. Pada demo lokal hanya kode `MOV123` yang diterima.
- FR-09: status siap kedua pemain; hanya host dapat memulai setelah keduanya siap.
- FR-12: leaderboard terurut berdasarkan jumlah langkah, termasuk peringkat sama ketika seri.
- FR-16: host dapat mereset setelah konfirmasi; kode room dipertahankan dan skor, waktu, serta status siap dikosongkan.

Secara bawaan aplikasi adalah **demo lokal**, bukan komunikasi antarperangkat. Alex adalah pemain simulasi. Pada room buatan sendiri, tekan “Saya siap”, kemudian “Mulai pertandingan”. Pada demo gabung room, host simulasi otomatis mulai setelah kamu siap. Timer menggunakan tenggat waktu agar tidak melambat akibat tab tidak aktif. Muat ulang halaman untuk keluar dari demo dan mencoba room lain; state tidak disimpan setelah reload.

## Integrasi anggota 2 dan 3

`window.MoveRankUI` tersedia setelah `app.js` dimuat. Panggil `configure(adapter)` **sebelum** pengguna membuat atau bergabung ke room untuk menonaktifkan simulasi. Adapter harus menyediakan lima fungsi asinkron berikut:

```js
window.MoveRankUI.configure({
  createRoom: async ({ name, duration }) => { /* Buat room; return snapshot */ },
  joinRoom: async ({ name, code }) => { /* Validasi kode; return snapshot */ },
  setReady: async ({ ready }) => { /* Kirim status; return snapshot */ },
  startMatch: async () => { /* Validasi host dan kesiapan; return snapshot */ },
  resetMatch: async () => { /* Reset state server; return snapshot */ }
});
```

Contoh bentuk snapshot (sesuaikan `selfId` pada setiap perangkat):

```js
const snapshot = {
  code: 'ABC123', selfId: 'player-1', hostId: 'player-1',
  duration: 180, remaining: 180, status: 'waiting',
  players: [
    { id: 'player-1', name: 'Vela', ready: false, steps: 0, activity: 'Diam' },
    { id: 'player-2', name: 'Alex', ready: false, steps: 0, activity: 'Diam' }
  ]
};
window.MoveRankUI.updateRoom(snapshot);
window.MoveRankUI.setConnection(true);
```

Status: `waiting`, `running`, atau `finished`. Room berisi 1–2 pemain dengan ID unik, nama maksimal 24 karakter, langkah bilangan bulat nonnegatif, serta waktu dalam detik. Kode room terdiri dari enam huruf kapital/angka. Adapter dapat mengembalikan snapshot atau mengirimkannya melalui `updateRoom` ketika pesan MQTT diterima. Lempar `Error` untuk menampilkan kegagalan tindakan kepada pengguna.

Anggota 2 mengirim hasil sensor ke modul anggota 3; anggota 3 meneruskan snapshot terbaru ke UI, termasuk pembaruan `remaining` setiap detik saat pertandingan. UI online tidak menjalankan timer atau menambahkan skor sendiri. Otorisasi host, validasi gerakan, identitas room, reconnect, sinkronisasi tenggat, dan keputusan pemenang resmi tetap tanggung jawab modul sensor/MQTT. UI menampilkan urutan skor yang diterima. Jangan meletakkan kredensial rahasia broker di frontend.

Modul anggota 2 dan kontrak callback tersedia di [`../Sensor/README.md`](../Sensor/README.md). Buka `/Sensor/` dari root hosting HTTPS untuk menguji sensor secara terpisah. Demo UI di folder ini tetap menggunakan data simulasi sampai adapter anggota 3 diintegrasikan; memuat modul sensor saja tidak mengganti skor demo.

## Pemeriksaan

```sh
node --check app.js
node --check match.js
node --test match.test.js
```

Uji manual: buat room → siap → mulai → skor berubah → reset; gabung `MOV123`; coba kode salah; coba layar 375px dan desktop; navigasi keyboard dan tutup dialog dengan Escape.
