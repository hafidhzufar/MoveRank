# MoveRank Sensor & Data Processing

Modul anggota 2 untuk FR-03 sampai FR-08. Acuan yang ada di repo adalah pembagian tugas pada `../README.md`; tidak ada SRS terpisah maupun target akurasi/ambang numerik. Modul ini tidak mengelola room, MQTT, skor lawan, atau penentuan pemenang.

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

## Pengujian Algoritma

Jalankan dari root repo:

```sh
node --test Sensor/processor.test.js
```

Tes memakai jejak sintetik untuk diam/noise, berjalan, berjalan cepat, histeresis, interval langkah, validasi gyro, fallback sensor, variasi frekuensi sampel, data rusak, gap, dan reset. Kelulusan tes ini tidak membuktikan akurasi pada perangkat fisik.
