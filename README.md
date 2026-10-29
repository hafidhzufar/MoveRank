# MoveRank
# Pembagian Tugas 3 Anggota

Anggota 1 — Frontend & User Interface

HTML, CSS, JavaScript

Bertanggung jawab membuat website MoveRank, tampilan pertandingan, leaderboard, dan navigasi pengguna.


FR-01	Membuat room pertandingan
FR-02	Bergabung menggunakan kode room
FR-09	Tampilan mulai pertandingan dan status pemain siap
FR-12	Menampilkan leaderboard real-time
FR-16	Fitur reset pertandingan melalui UI

Output: Website MoveRank yang responsif dan dapat dibuka melalui Safari iPhone.


Anggota 2 — Sensor & Data Processing

JavaScript, DeviceMotion API, algoritma

Bertanggung jawab membaca sensor bawaan iPhone dan mengolahnya menjadi jumlah langkah serta kategori aktivitas.


FR-03	Meminta izin akses sensor iPhone
FR-04	Membaca accelerometer dan gyroscope
FR-05	Filtering data dengan Moving Average
FR-06	Menghitung langkah menggunakan Peak Detection
FR-07	Validasi gerakan menggunakan gyroscope
FR-08	Klasifikasi aktivitas (diam, berjalan, berjalan cepat)

Output: Modul JavaScript yang menghasilkan jumlah langkah dan kategori aktivitas dari sensor iPhone.

Implementasi anggota 2 tersedia di [`Sensor/`](Sensor/README.md): modul DeviceMotion, Moving Average, Peak Detection, validasi gyroscope, klasifikasi aktivitas, pengujian, dan halaman uji iPhone [`Sensor/index.html`](Sensor/index.html). Petunjuk HTTPS, API integrasi anggota 3, serta batasan kalibrasi ada pada dokumentasi modul.


Anggota 3 — MQTT Cloud & Logika Pertandingan

JavaScript, MQTT.js, HiveMQ

Bertanggung jawab menghubungkan kedua iPhone lewat internet, sinkronisasi skor, keamanan dasar, dan penentuan pemenang.


FR-10	Mengirim data langkah ke MQTT Cloud
FR-11	Menerima data langkah lawan
FR-13	Menentukan pemenang berdasarkan langkah valid
FR-14	Menangani koneksi terputus dan reconnect
FR-15	Validasi identitas room dan data pertandingan
FR-17	Menjaga privasi data yang dikirim

Output: Kedua iPhone dapat bertukar statistik aktivitas melalui MQTT meskipun berada di kota berbeda.

Implementasi anggota 3 tersedia di [`MQTT/`](MQTT/README.md): MQTT.js melalui WSS HiveMQ Cloud, sinkronisasi statistik, host sebagai otoritas pertandingan, reconnect, validasi room/ronde/identitas, serta enkripsi dan tanda tangan pesan. Sudah terintegrasi dengan UI dan sensor melalui panel **Main online dengan MQTT Cloud** di [`User Interface/index.html`](User%20Interface/index.html). Isi konfigurasi broker pada kedua perangkat sebelum masuk room; host membagikan kode serta kunci undangan kepada lawan. Tanpa konfigurasi, UI tetap demo lokal.

Jalankan `npm ci`, `npm run check`, dan `npm test` dari root untuk pemeriksaan otomatis. Panduan HiveMQ, kebijakan skor saat koneksi putus, tes browser, serta checklist uji dua iPhone ada di [`MQTT/README.md`](MQTT/README.md). Kredensial broker dan hosting HTTPS perlu disediakan saat pengujian perangkat nyata.