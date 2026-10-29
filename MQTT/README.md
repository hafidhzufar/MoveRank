# MoveRank — MQTT Cloud & Logika Pertandingan

Implementasi anggota 3 untuk FR-10, FR-11, FR-13, FR-14, FR-15, dan FR-17. Modul langsung menghubungkan UI anggota 1 dengan sensor anggota 2 melalui MQTT.js di browser. Tidak memerlukan server aplikasi tambahan; broker HiveMQ Cloud tetap perlu disiapkan sendiri.

## Pemetaan kebutuhan

| FR | Implementasi | Verifikasi |
| --- | --- | --- |
| FR-10 | `submitStats()` menerima total langkah valid sensor; statistik dikirim setiap 1 detik | pertukaran agregat, data sumbu mentah tidak terkirim |
| FR-11 | subscribe snapshot host, signature verification, `MoveRankUI.updateRoom()` | dua klien melihat skor dan hasil yang sama |
| FR-13 | host menentukan pemenang pada tenggat; `winnerIds` berisi satu pemenang atau kedua ID saat seri | menang, seri, paket terlambat, reset |
| FR-14 | reconnect MQTT.js 1,5 detik, subscribe ulang, heartbeat, pemulihan total kumulatif | guest reconnect, host reconnect setelah tenggat |
| FR-15 | room/session/round, ID dari public key, tanda tangan, nomor urut, revisi, schema dan batas laju | pemalsuan identitas, replay, ronde lama, data rusak, ACL ditolak |
| FR-17 | WSS + AES-GCM, hanya nickname/statistik agregat, kredensial diisi saat runtime | ciphertext tidak mengandung nama, password, sumbu, atau timestamp sensor |

## Berkas

- `protocol.js`: AES-256-GCM, tanda tangan ECDSA P-256/SHA-256, identitas pemain, state pertandingan dan validator.
- `mqtt.js`: adapter asinkron `createRoom`, `joinRoom`, `setReady`, `startMatch`, `resetMatch`, `submitStats`, reconnect dan timer.
- `online.js`, `online.css`: konfigurasi broker, kunci undangan, izin sensor dan integrasi UI.
- `protocol.test.js`, `mqtt.test.js`: unit test serta broker tiruan yang menukar pesan terenkripsi antara klien.
- `browser.test.js`: Edge/Chromium dengan dua halaman dan broker tiruan; memakai Web Crypto browser dan event DeviceMotion sintetik melalui modul sensor asli.

## Menyiapkan HiveMQ Cloud

1. Buat cluster di [HiveMQ Cloud](https://console.hivemq.cloud/), lalu buka **Access Management** dan buat kredensial **MQTT** khusus pengujian aplikasi. Jangan gunakan password akun dashboard atau API token administrasi.
2. Catat hostname cluster. Isikan URL pada halaman dalam bentuk `wss://HOST-CLUSTER:8884/mqtt`. HiveMQ Cloud mendokumentasikan MQTT over WebSocket di port **8884**; port MQTT TCP **8883** tidak dipakai oleh browser. Gunakan endpoint WSS yang ditampilkan cluster bila berbeda.
3. Berikan izin publish dan subscribe untuk `moverank/v1/+/state` dan `moverank/v1/+/command`, atau prefix `moverank/v1/#` pada cluster pengujian khusus. Subscription menggunakan QoS 1; retained snapshot memerlukan izin publish retained jika broker memisahkannya. Jangan memberi akses administrasi atau seluruh topic aplikasi lain.
4. Kedua iPhone menggunakan cluster yang sama; kredensial boleh berbeda selama izin topic saling sesuai. Untuk pembatasan lebih ketat per room, gunakan ACL kode room yang spesifik. Jika memakai ACL per peran: host publish `state`/subscribe `command`, guest publish `command`/subscribe `state`. UI memilih peran saat create/join.
5. Sajikan **root repo** melalui HTTPS, dengan sertifikat yang dipercaya iPhone. Buka `/User%20Interface/index.html`. Hosting hanya subfolder UI akan membuat modul `../Sensor/` dan `../MQTT/` tidak ditemukan.

Rujukan resmi: [HiveMQ Cloud quick start](https://docs.hivemq.com/hivemq-cloud/quick-start-guide.html), [Authentication and Authorization](https://docs.hivemq.com/hivemq-cloud/authn-authz.html), dan [MQTT.js](https://github.com/mqttjs/MQTT.js/tree/v5.10.4). UI memuat versi MQTT.js **5.10.4** dari jsDelivr melalui HTTPS. Akses CDN diperlukan; tidak ada bundler atau proses build untuk halaman ini.

## Menjalankan dua iPhone

1. Pada **kedua perangkat**, buka halaman melalui HTTPS dan isi URL WSS, username MQTT, serta password pada bagian **Main online dengan MQTT Cloud**. Tekan **Hubungkan MQTT** sebelum masuk room. Jika tidak dikonfigurasi, UI tetap demo lokal dan tidak bertukar data.
2. Pemain pertama membuat room, memilih nickname dan durasi 1/3/5 menit. Bagikan **kode enam karakter** dan **kunci undangan room** dari panel MQTT kepada lawan melalui saluran pribadi. Kunci tidak dimasukkan ke URL atau localStorage.
3. Pemain kedua memilih **Gabung room**, mengisi nickname, kode, dan kunci undangan utuh. Kode harus cocok dengan isi undangan. Room hanya menerima satu host dan satu guest.
4. Kedua pemain menekan **Saya siap** dan mengizinkan Motion & Orientation. Penolakan izin tidak mengirim kesiapan. Izin diminta di handler klik sebelum menunggu MQTT; sensor baru mulai menghitung saat snapshot ronde berubah menjadi `running`.
5. Host menekan **Mulai pertandingan**. Bergerak sambil mempertahankan halaman di depan dan layar menyala. Leaderboard menerima statistik sekitar sekali per detik, bergantung koneksi internet.
6. Setelah durasi habis, kedua halaman menampilkan pemenang resmi atau seri. Host dapat **Reset pertandingan**; kode dan kunci tetap, ronde/angka langkah/kesiapan diperbarui. Kedua pemain harus siap lagi.
7. Sensor yang dijeda karena tab tidak aktif atau watchdog dapat diaktifkan lagi melalui **Lanjutkan sensor** selama waktu tersisa. Total langkah sebelumnya dipertahankan.

Untuk komputer saja: `python -m http.server 8765` dari root, lalu buka `http://localhost:8765/User%20Interface/index.html`. `http://IP-LAPTOP:8765` di iPhone bukan secure context. Koneksi broker dapat diuji pada desktop, tetapi kesiapan online membutuhkan izin/API sensor. Browser tanpa sensor fisik akan menampilkan pesan watchdog; data tidak disimulasikan dalam mode online.

## Aturan pertandingan dan reconnect

Host menyimpan state resmi di memori, menjalankan tenggat `Date.now()`, memvalidasi total langkah, serta menandatangani snapshot. Tidak ada pemilihan host baru. Jam perangkat perlu memakai pengaturan waktu otomatis: snapshot dengan selisih jam lebih dari 30 detik ditolak. Countdown guest memakai waktu tenggat host; hasil resmi menunggu signature host.

Jumlah langkah adalah **total**, bukan delta. Total tidak boleh turun, harus integer nonnegatif, dan dibatasi oleh interval minimum sensor 300 ms (sekitar 3,33 langkah/detik), dengan kelonggaran awal satu langkah dan kelonggaran batch dua langkah. Pengujian laju ini merupakan pemeriksaan kewajaran; hitungan sensor tetap mengikuti Moving Average, Peak Detection, dan gyro milik anggota 2.

Saat koneksi putus, timer pertandingan tetap berjalan. Heartbeat yang tidak terlihat selama 6 detik menandai lawan tidak terhubung. Status ini tidak otomatis memberikan kemenangan. MQTT.js mencoba menyambung setiap 1,5 detik dan subscribe ulang setelah koneksi pulih. Selama halaman tetap terbuka, identitas, ronde, dan total lokal tetap tersedia. Guest mengirim ulang total terbaru sehingga paket ganda tidak menambah langkah dua kali.

**Skor resmi adalah total terakhir yang diterima host sebelum tenggat.** Tidak ada grace period untuk data terlambat. Paket yang tertunda hingga pertandingan selesai ditolak. Saat host offline, langkah host tetap dihitung lokal; langkah guest dapat dipulihkan bila koneksi kembali sebelum tenggat. Jika host baru kembali setelah tenggat, hasil memakai statistik yang telah ada di host. UI menunggu hasil host, bukan menyimpulkan kemenangan sendiri dari status jaringan.

Muat ulang, navigasi keluar, menutup halaman, atau `pagehide` menutup sesi; identitas tidak disimpan lintas reload. Buat room baru pada kedua perangkat. Room berlaku **30 menit**; setelah itu host menutup koneksi dan pengguna membuat room baru. Reset tidak memperpanjang masa berlaku. Retained ciphertext bisa tetap ada di broker setelah masa berlaku; klien menolak data kedaluwarsa. Bersihkan retained topic pengujian melalui pengelolaan broker bila diperlukan.

## Protokol dan keamanan dasar

Topic:

```text
moverank/v1/<KODE>/command  # guest -> host, QoS 0, tidak retained
moverank/v1/<KODE>/state    # host -> guest, QoS 1, retained
```

Perintah menggunakan QoS 0 tanpa antrean offline supaya status siap atau langkah lama tidak diam-diam dikirim pada ronde baru. Guest mengulang join/heartbeat/statistik; siap menunggu konfirmasi `ack` di snapshot dan gagal dengan timeout jika belum dikonfirmasi. QoS 1 snapshot dapat berulang; revisi yang sama/lebih lama diabaikan. Payload melebihi 16 KiB dan retained command diabaikan.

Setiap pesan dienkripsi AES-GCM dengan nonce acak 96 bit dan topic sebagai authenticated data. Bentuk luar: `{ v: 1, iv, data }`. Isi terenkripsi: `{ message, signature }`. `message` memuat versi, kode, session, ronde, jenis pesan, dan data yang diperlukan. Guest menggunakan ID hash public key dan `seq` meningkat; host mengirim `revision` meningkat. Snapshot memuat `hostNow`, `startsAt`, `endsAt`, `remaining`, masa berlaku, pemain, dan `winnerIds`.

Kunci undangan memuat kode, session acak, kunci AES acak 256 bit, serta public key host yang dipasangkan saat create. Guest memverifikasi snapshot menggunakan public key dari undangan, sehingga guest tidak dapat membuat signature host. Host menerima public key guest pertama yang berhasil join dan mengikatnya ke satu slot; pesan berikutnya harus ditandatangani identitas yang sama. Room/session/round mencegah pemakaian paket lintas room dan ronde, sedangkan sequence/revision mencegah replay.

Kunci undangan adalah kapabilitas akses: siapa yang memilikinya bisa membaca statistik dan mencoba mengambil slot guest sebelum lawan. Bagikan hanya ke lawan; nickname tidak membuktikan identitas dunia nyata. Kode enam karakter hanya untuk pencarian topic. Kredensial broker di browser tetap dapat dilihat pengguna perangkat; gunakan akun aplikasi dengan ACL terbatas. Broker melihat metadata topic, ukuran, dan waktu pesan. Enkripsi tidak menyembunyikan metadata tersebut.

Tidak ada pengiriman accelerometer, gyroscope, cadence mentah, timestamp sensor, GPS, email, atau identitas perangkat. Hanya nickname, ID acak berbasis public key, status siap/koneksi, waktu pertandingan, langkah dan kategori aktivitas yang diperlukan. Tidak ada localStorage, database aplikasi, atau log payload/kredensial.

Ini keamanan dasar untuk proyek antarteman: host adalah pihak tepercaya dan masih bisa memodifikasi program pada perangkatnya; sensor web tidak membuktikan langkah secara mutlak. Kompetisi dengan pihak tidak tepercaya memerlukan otoritas server terpisah dan kredensial/ACL per peserta yang diterbitkan backend.

## API integrasi

UI sudah memuat semua modul dengan `defer` dan mengonfigurasi adapter saat pengguna menekan Hubungkan MQTT. Penggunaan modul secara terpisah:

```js
const cloud = new MoveRankMQTT({
  onRoom: snapshot => MoveRankUI.updateRoom(snapshot),
  onConnection: connected => MoveRankUI.setConnection(connected),
  onError: error => console.error(error.message)
});
await cloud.connect({ url, username, password }); // Nilai diisi pengguna saat runtime.
const snapshot = await cloud.createRoom({ name: 'Nama panggilan', duration: 180 });
// Lawan: await cloud.joinRoom({ name, code, invitation });
// Sensor onUpdate: cloud.submitStats({ steps, activity });
```

Callback sensor harus hanya dihitung dalam ronde yang sedang berjalan. Integrasi bawaan mereset sensor satu kali per ID ronde, meminta izin sebelum status siap, berhenti saat selesai/reset/keluar, dan menyediakan tombol lanjut setelah pause. `submitStats()` mengambil hanya field `steps` dan `activity` dan mengembalikan boolean penerimaan input lokal; keputusan skor resmi dilakukan oleh host.

## Pemeriksaan

Node.js 20+:

```sh
npm ci
npm run check
npm test
npm run test:e2e
```

Tes browser menggunakan Microsoft Edge yang terpasang di path standar Windows. Untuk platform lain, jalankan `npx playwright install chromium` atau set `PLAYWRIGHT_EXECUTABLE_PATH` ke executable Chromium/Edge. Tes menyalakan HTTP localhost sementara dan broker tiruan, tidak membutuhkan akun HiveMQ dan tidak menghubungi broker publik. Event DeviceMotion yang dipakai sintetik; tes bukan pengukuran akurasi fisik.

Checklist uji nyata yang masih perlu dilakukan dengan cluster dan dua iPhone:

- Dua jaringan berbeda/kota berbeda: create, bagikan undangan, join, izin, siap, mulai, bandingkan leaderboard.
- Kredensial salah atau ACL ditolak: kegagalan jelas, tidak ada skor simulasi.
- Kunci undangan/kode tidak cocok: join ditolak; coba room penuh dan host offline.
- Matikan koneksi guest < durasi: badge berubah, reconnect tanpa penggandaan skor.
- Putus sampai lewat tenggat: langkah terlambat tidak mengubah hasil resmi.
- Putuskan host lalu sambungkan lagi: deadline tetap dan hasil diterbitkan setelah reconnect.
- Langkah sama dan nol: hasil seri; reset membutuhkan kesiapan baru dan skor kembali nol.
- Tolak izin, ganti tab/kunci layar, lanjut sensor: tidak otomatis siap atau menghitung diam-diam.

Hasil tes otomatis tidak menyatakan pengujian HiveMQ produksi atau Safari iPhone fisik telah dilakukan.
