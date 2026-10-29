# MoveRank Sensor & Data Processing

Modul anggota 2 untuk FR-03 sampai FR-08. Acuan yang ada di repo adalah pembagian tugas pada `../README.md`; tidak ada SRS terpisah maupun target akurasi/ambang numerik. Modul ini tidak mengelola room, MQTT, skor lawan, atau penentuan pemenang.

## Pemetaan Kebutuhan

| FR | Implementasi | Verifikasi otomatis |
| --- | --- | --- |
| FR-03 | `motion.js`: HTTPS, deteksi API, `DeviceMotionEvent.requestPermission()` dari interaksi pengguna | granted, denied, exception, tanpa API, HTTP, retry |
| FR-04 | `motion.js`: `devicemotion.acceleration`, `accelerationIncludingGravity`, dan `rotationRate` | event sensor, sumbu kosong, fallback, watchdog |
| FR-05 | `processor.js`: Moving Average berbasis jendela waktu | noise, variasi interval sampling |
| FR-06 | `processor.js`: Peak Detection, histeresis, interval minimum | hitungan jejak sintetik, gap, reset, data rusak |
| FR-07 | `processor.js`: validasi gyro terbaru, tolak data kosong/rotasi berlebihan | gyro rendah/tinggi/null, rotasi lama |
| FR-08 | `processor.js`: cadence langkah valid dan timeout diam | berjalan, berjalan cepat, batas 120, kembali diam |

## Menjalankan di iPhone

Sajikan **root repo** melalui HTTPS dengan sertifikat yang dipercaya iPhone, kemudian buka `/Sensor/` di Safari. Halaman `index.html` adalah alat uji sensor terpisah; demo pada `User Interface/index.html` tetap simulasi milik anggota 1, bukan hasil sensor ini. Modul tidak memerlukan framework, bundler, library eksternal, atau koneksi broker.

Untuk membuka halaman di komputer saja, jalankan dari root:

```sh
python -m http.server 8765
```

Buka `http://localhost:8765/Sensor/`. Pengecualian localhost hanya berlaku pada perangkat itu sendiri; `http://IP-LAPTOP:8765/Sensor/` dari iPhone **bukan** secure context. Gunakan hosting HTTPS/server TLS/tunnel HTTPS yang dipercaya untuk uji iPhone. API yang tersedia pada desktop tidak menjamin perangkat mempunyai sensor; watchdog akan menampilkan data tidak tersedia, bukan mengarang langkah.

Tekan **Izinkan & Mulai** langsung, izinkan akses, lalu ikuti checklist pada halaman. Jika ditolak, periksa pengaturan izin Motion & Orientation situs di Safari lalu coba tombol lagi. Jangan memakai iframe tanpa izin sensor yang sesuai; halaman top-level dianjurkan. Sensor membutuhkan halaman di depan dan layar tetap menyala. Pergantian tab, penguncian layar, atau `pagehide` menjeda pengambilan tanpa melanjutkan otomatis.

## API Browser (FR-03/04)

Muat script dengan urutan berikut sebelum kode integrasi:

```html
<script src="Sensor/processor.js" defer></script>
<script src="Sensor/motion.js" defer></script>
```

```js
const sensor = new MoveRankMotionSensor({
  onUpdate({ steps, activity, cadence, timestamp }) {
    // Teruskan statistik ini ke modul anggota 3 hanya saat pertandingan berjalan.
    // Jangan menambahkan steps sebagai delta: nilainya adalah TOTAL sejak reset.
  },
  onStatus({ state, message }) {
    // Tampilkan status/masalah sensor kepada pengguna.
    console.info(state, message);
  }
});

// Dalam handler klik langsung, tanpa await lain sebelumnya:
startButton.addEventListener('click', () => {
  sensor.start().catch(error => console.error(error.code, error.message));
});
```

- `requestPermission()`: Promise izin; tidak memasang listener gerak atau mulai menghitung. Untuk integrasi room, panggil dari handler tombol siap **sebelum** menunggu operasi MQTT. Setelah berhasil, baru kirim status siap. Tidak perlu `DeviceOrientationEvent`: gyro dibaca dari `rotationRate` pada event DeviceMotion yang sama.
- `start()`: Promise yang meminta izin bila perlu, lalu memasang listener. Aman dipanggil ulang ketika sudah berjalan; klik paralel tidak menambah listener. Promise selesai ketika listener terpasang, bukan jaminan bahwa perangkat sudah mengirim data. Pada browser tanpa metode izin iOS, event langsung digunakan dengan pemeriksaan data yang sama.
- `stop()`: hentikan listener/timer, aktivitas menjadi `Diam`, total langkah dipertahankan. Izin browser tidak dicabut. Izin yang baru selesai setelah stop tidak boleh menyalakan listener kembali.
- `reset()`: kosongkan langkah, cadence, filter, dan waktu. Jika sensor sedang berjalan, pengambilan tetap berjalan. Untuk akhir pertandingan, panggil `stop()`; untuk ronde baru, panggil `reset()` sebelum `start()`.
- `snapshot()`: salinan statistik terbaru. `processorOptions` pada konstruktor diteruskan ke algoritma untuk kalibrasi. Opsi `target` hanya untuk injeksi lingkungan browser dalam pengujian.
- `onUpdate`: dipanggil ketika langkah/aktivitas/cadence berubah, serta ketika start/stop/reset. Tidak mengirim tiap sampel sensor ke MQTT. `onStatus`: status `requesting`, `running`, `stopped`, `paused`, `denied`, atau `unavailable`; nilai awal properti `state` adalah `idle`.
- Watchdog 250 ms menghentikan pengambilan bila tidak ada pembacaan accelerometer **dan** gyroscope lengkap selama 2 detik, termasuk ketika izin diberikan tetapi sensor fisik/izin kebijakan tidak tersedia. Data gyro nol yang valid saat diam bukan data hilang.

### Handoff Anggota 3

1. Dapatkan izin dari tombol siap, tangani penolakan tanpa mengirim status siap. Jangan menambahkan listener siap paralel pada UI bawaan yang akan mengirim kesiapan sebelum izin selesai; lakukan urutan ini di handler/adapter integrasi.
2. Saat snapshot room bertransisi ke `running`, panggil `reset()` sekali untuk pertandingan baru, lalu `start()`. Izin yang sudah didapat bisa dipakai tanpa prompt baru ketika pertandingan dimulai lawan.
3. Teruskan `{ steps, activity }` (opsional cadence) sebagai total statistik pemain lokal, bukan data sumbu mentah. Ikat ke identitas pemain/room/ronde dan validasi masa pertandingan di modul MQTT. Callback awal bernilai nol; jangan menganggapnya sebagai skor tambahan.
4. Saat selesai/reset/keluar, panggil `stop()`; reset nilai untuk ronde baru. Jangan memanggil `reset()` di setiap pembaruan snapshot. Tangani `paused`/`unavailable` sebagai masalah sensor lokal, bukan skor lawan nol; kebijakan pertandingan saat interupsi milik anggota 3.
5. Anggota 3 mengirim snapshot room ke `MoveRankUI.updateRoom()`. Modul sensor tidak memodifikasi state room atau skor UI sendiri. Contoh halaman uji tidak memanggil `MoveRankUI.configure()` dan tidak mengganti adapter MQTT.

Tidak ada penyimpanan, geolokasi, fingerprint, atau pengiriman jaringan di modul ini. Hanya statistik agregat yang keluar melalui callback; validasi identitas, autentikasi, dan keputusan pemenang tetap tanggung jawab anggota 3.

## Pemrosesan (FR-04 sampai FR-08)

`processor.js` dapat dipakai langsung di browser sebagai `MoveRankStepProcessor` atau melalui `require('./processor.js')` di Node.js. `push(sample)` menerima waktu monoton dalam milidetik, `acceleration`/`accelerationIncludingGravity` dengan sumbu `x/y/z` dalam m/s2, serta `rotationRate.alpha/beta/gamma` dalam derajat/detik. Semua sumbu yang dipakai harus berupa angka finite, bukan `null`.

1. Gunakan magnitudo `accelerationIncludingGravity` dikurangi gravitasi 9.80665 m/s2 agar orientasi ponsel tidak mengubah sinyal ketika diam. Bila tidak tersedia, gunakan magnitudo `acceleration` tanpa gravitasi.
2. Moving Average meratakan sampel dalam jendela 120 ms, bukan jumlah sampel tetap.
3. Peak Detection menghitung puncak lokal saat sinyal mulai turun, minimal 1 m/s2. Histeresis mengharuskan sinyal kembali ke lembah <= 0.25 m/s2 sebelum puncak berikutnya; jarak langkah minimal 300 ms.
4. Puncak hanya diterima jika magnitudo maksimum gyroscope dalam jendela terbaru 120 ms berada di rentang 5 sampai 300 derajat/detik. Rotasi lama tidak dapat memvalidasi puncak baru. Data gyro kosong tidak dianggap nol atau dilewati. Ini heuristik penyaring, bukan jaminan anti-kecurangan.
5. Cadence dihitung dari interval langkah valid dalam 5 detik terakhir. Aktivitas `Berjalan cepat` mulai 120 langkah/menit; selain itu `Berjalan`. Setelah 2 detik tanpa langkah valid, aktivitas menjadi `Diam` dan cadence nol.

Hasil berupa objek baru `{ steps, activity, cadence, timestamp }`. `steps` adalah total langkah valid sejak `reset()`, `cadence` dalam langkah/menit berdasarkan interval antar langkah terakhir, dan `timestamp` waktu lokal monoton, bukan waktu server. Panggil `advanceTime(now)` ketika tidak ada sampel agar aktivitas kembali diam. Sampel tidak valid, perpindahan sumber percepatan, dan gap > 1 detik membuang kandidat puncak; waktu mundur/duplikat diabaikan. `reset()` menghapus seluruh state untuk pertandingan baru.

`pause()` menghapus filter, kandidat puncak, dan cadence tetapi mempertahankan total langkah serta waktu. Gunakan ketika pengambilan sensor dihentikan agar data sebelum dan sesudah jeda tidak disambung menjadi langkah.

Opsi dapat diubah melalui `new MoveRankStepProcessor({ peakThreshold: 1.2 })`; seluruh nilai awal ada di `MoveRankStepProcessor.defaults`. Ambang tersebut adalah keputusan implementasi awal, bukan angka yang ditentukan SRS. Sampling sangat rendah, cara membawa ponsel, dan fallback magnitudo percepatan linear dapat mengubah hasil. Kalibrasi dengan jumlah langkah manual dan iPhone nyata tetap diperlukan. Perubahan orientasi saja tidak dihitung, tetapi sensor web tidak dapat membuktikan bahwa suatu gerakan benar-benar langkah kaki.

## Pengujian

Jalankan dari root repo:

```sh
node --check Sensor/processor.js
node --check Sensor/motion.js
node --check Sensor/demo.js
node --test Sensor/processor.test.js Sensor/motion.test.js "User Interface/match.test.js"
```

Tes memakai jejak sintetik untuk diam/noise, berjalan, berjalan cepat, histeresis, interval langkah, validasi gyro, fallback sensor, variasi frekuensi sampel, data rusak, gap, dan reset. Lifecycle/izin browser diuji dengan mock event, termasuk pembatalan prompt tertunda dan pause saat halaman ditinggalkan. Kelulusan tes ini tidak membuktikan akurasi atau perilaku prompt pada perangkat fisik.

Uji manual Safari iPhone yang masih perlu dijalankan pada perangkat nyata:

| Skenario | Hasil yang diharapkan |
| --- | --- |
| HTTP IP lokal / HTTPS tanpa sensor | Pesan kegagalan yang jelas, tidak ada skor simulasi |
| Tolak izin, lalu izinkan dari pengaturan dan coba lagi | Penolakan terdeteksi; dapat retry tanpa listener ganda |
| Diam 10 detik, ganti orientasi tanpa berjalan | Total tidak bertambah karena orientasi saja |
| Berjalan 30 langkah, lalu 30 langkah cepat | Bandingkan manual, catat selisih; kategori sesuai cadence yang terdeteksi |
| Berhenti >= 2 detik | Diam, cadence 0, total dipertahankan |
| Goyangan tangan/ponsel tanpa berjalan | Evaluasi false positive untuk kalibrasi; heuristik bukan anti-cheat sempurna |
| Ganti tab/kunci layar saat berjalan atau prompt tertunda | Dijeda, tidak melanjutkan otomatis; perlu mulai lagi |
| Stop, lanjutkan, kemudian reset | Stop tidak menghitung, lanjut tidak menggandakan listener, reset mulai nol |
| Layar ponsel dan desktop | Tombol/statistik terbaca, tidak ada overflow horizontal |

Catat model iPhone, versi iOS, cara membawa perangkat, frekuensi event, dan kesalahan hitung sebelum mengubah ambang. Jangan menyatakan persentase akurasi tanpa hasil pengukuran fisik.

## Integrasi online anggota 3

Halaman [`../User Interface/index.html`](../User%20Interface/index.html) sekarang menyediakan panel MQTT Cloud untuk menghubungkan modul sensor ini dengan pertandingan dua perangkat. Tanpa konfigurasi, default UI tetap demo lokal. Adapter anggota 3 meminta izin dari tombol siap, memulai/reset sensor satu kali per ronde, mengirim statistik agregat, dan menghentikan sensor saat selesai/reset/keluar. Panduan broker, reconnect, kebijakan hasil, dan uji perangkat nyata ada di [`../MQTT/README.md`](../MQTT/README.md).