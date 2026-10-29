/* Local demo model. Real room authority belongs to the MQTT integration. */
class DemoMatch {
  constructor() { this.room = null; }
  create(name, duration = 180, join = false) {
    if (![60, 180, 300].includes(duration)) throw new Error('Durasi tidak valid.');
    if (!name.trim() || name.trim().length > 24) throw new Error('Isi nama pemain (maksimal 24 karakter).');
    this.room = {
      code: join ? 'MOV123' : 'MV' + Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0'),
      selfId: 'you', hostId: join ? 'demo' : 'you', duration, remaining: duration,
      status: 'waiting', demo: true,
      players: [
        { id: 'you', name: name.trim(), ready: false, steps: 0, activity: 'Diam' },
        { id: 'demo', name: 'Alex · Demo', ready: true, steps: 0, activity: 'Diam' }
      ]
    };
    return this.room;
  }
  ready() {
    if (!this.room || this.room.status !== 'waiting') throw new Error('Pertandingan tidak dalam lobby.');
    this.room.players[0].ready = !this.room.players[0].ready;
    return this.room;
  }
  start(now = Date.now()) {
    if (!this.room || this.room.status !== 'waiting' || this.room.players.length !== 2 || !this.room.players.every(p => p.ready)) throw new Error('Kedua pemain harus siap.');
    this.room.status = 'running';
    this.room.endsAt = now + this.room.duration * 1000;
    this.lastTick = now;
    return this.room;
  }
  tick(now = Date.now(), random = Math.random) {
    const room = this.room;
    if (!room || room.status !== 'running') return room;
    const seconds = Math.max(0, Math.floor((Math.min(now, room.endsAt) - this.lastTick) / 1000));
    if (seconds) {
      room.players.forEach(p => { const pace = 1 + Math.floor(random() * 3); p.steps += seconds * pace; p.activity = pace > 1 ? 'Berjalan cepat' : 'Berjalan'; });
      this.lastTick += seconds * 1000;
    }
    room.remaining = Math.max(0, Math.ceil((room.endsAt - now) / 1000));
    if (!room.remaining) { room.status = 'finished'; room.players.forEach(p => { p.activity = 'Selesai'; }); }
    return room;
  }
  reset() {
    if (!this.room) throw new Error('Belum ada room.');
    Object.assign(this.room, { status: 'waiting', remaining: this.room.duration, endsAt: null });
    this.room.players.forEach(p => Object.assign(p, { ready: false, steps: 0, activity: 'Diam' }));
    return this.room;
  }
}
if (typeof module !== 'undefined') module.exports = DemoMatch;
