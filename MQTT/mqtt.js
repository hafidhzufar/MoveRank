'use strict';

const MRProtocol = typeof module !== 'undefined' && module.exports ? require('./protocol.js') : globalThis;

class MoveRankMQTT {
  constructor({ mqtt = globalThis.mqtt, crypto = globalThis.crypto, now = Date.now, onRoom = () => {}, onConnection = () => {}, onError = () => {}, requestTimeout = 10000 } = {}) {
    this.mqtt = mqtt; this.security = new MRProtocol.MoveRankCrypto(crypto); this.now = now;
    this.onRoom = onRoom; this.onConnection = onConnection; this.onError = onError; this.requestTimeout = requestTimeout;
    this.client = null; this.identity = null; this.room = null; this.authority = null; this.seq = 0;
    this.online = false; this.subscribed = false; this.closed = false; this.pending = new Set();
    this.incoming = Promise.resolve(); this.outgoing = Promise.resolve(); this.peers = new Map();
    this.latestStats = { steps: 0, activity: 'Diam' }; this.lastHostAt = 0; this.revision = 0; this.generation = 0;
  }
  async connect({ url, username, password }) {
    if (this.client) throw new Error('Koneksi sudah dibuat. Muat ulang untuk mengganti broker.');
    let endpoint;
    try { endpoint = new URL(url); } catch { throw new Error('Isi URL WSS broker yang valid.'); }
    if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.search || !username || !password) throw new Error('Gunakan wss:// dan kredensial MQTT khusus aplikasi.');
    if (!this.mqtt?.connect) throw new Error('MQTT.js belum dimuat. Periksa koneksi internet lalu muat ulang.');
    this.identity = await this.security.identity();
    const client = this.mqtt.connect(endpoint.href, {
      username, password, clientId: 'moverank-' + this.security.id(), protocolVersion: 4,
      clean: true, keepalive: 15, reconnectPeriod: 1500, connectTimeout: 10000,
      queueQoSZero: false, resubscribe: false
    });
    this.client = client;
    client.on('connect', () => {
      this.online = true;
      this.resubscribe().catch(() => this.onError(new Error('Langganan topic ditolak. Periksa izin broker.')));
    });
    for (const event of ['offline', 'close', 'reconnect']) client.on(event, () => {
      this.online = false; this.subscribed = false; this.onConnection(false);
      this.rejectPending(new Error('Koneksi terputus. Tunggu tersambung lalu coba lagi.'));
    });
    client.on('error', () => this.onError(new Error('Koneksi MQTT gagal. Periksa URL, kredensial, dan izin broker.')));
    client.on('message', (topic, payload, packet = {}) => {
      if (!this.context || !this.subscribed || payload.length > 16384) return;
      if (topic !== this.topic(this.authority ? 'command' : 'state') || (this.authority && packet.retain)) return;
      const generation = this.generation;
      this.incoming = this.incoming.then(() => generation === this.generation ? this.receive(topic, payload.toString()) : undefined).catch(() => {});
    });
    this.timer = setInterval(() => this.tick(), 1000);
    return this.waitFor(() => this.online && this.subscribed, 'Broker belum terhubung. Periksa konfigurasi atau coba lagi.');
  }
  topic(kind) { return `moverank/v1/${this.context.code}/${kind}`; }
  async resubscribe() {
    this.subscribed = false;
    if (this.context) {
      await new Promise((resolve, reject) => this.client.subscribe(this.topic(this.authority ? 'command' : 'state'), { qos: 1 }, (error, grants) => {
        if (error || !grants?.length || grants.some(grant => grant.qos === 128)) reject(error || new Error('Topic ditolak.'));
        else resolve();
      }));
    }
    if (!this.online || this.closed) return;
    this.subscribed = true;
    this.onConnection(!this.context || !!this.authority);
    if (this.authority) this.broadcast();
    else if (this.context) this.send('join', { name: this.name, publicKey: this.identity.publicKey }).catch(error => this.onError(error));
    this.resolvePending();
  }
  ensureConnected() {
    if (!this.online || !this.subscribed || this.closed) throw new Error('MQTT belum terhubung. Tunggu koneksi lalu coba lagi.');
  }
  async createRoom({ name, duration }) {
    this.ensureConnected();
    if (this.context) throw new Error('Sudah berada di room. Muat ulang untuk keluar.');
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 24 || /[\u0000-\u001f\u007f]/.test(name) || ![60, 180, 300].includes(duration)) throw new Error('Nama atau durasi tidak valid.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const code = [...this.security.random(6)].map(n => alphabet[n % alphabet.length]).join('');
    const session = this.security.id(), k = btoa(String.fromCharCode(...this.security.random(32)));
    this.context = { code, session, hostId: this.identity.id }; this.key = await this.security.roomKey(k);
    this.authority = new MRProtocol.MoveRankRoom({ code, session, host: { id: this.identity.id, name }, duration, now: this.now(), round: this.security.id() });
    this.invitation = this.security.invitation({ v: 1, code, session, k, h: this.identity.publicKey });
    try { await this.resubscribe(); return this.snapshot(); }
    catch (error) { this.clearRoom(); throw error; }
  }
  async joinRoom({ name, code, invitation }) {
    this.ensureConnected();
    if (this.context) throw new Error('Sudah berada di room. Muat ulang untuk keluar.');
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Isi nama maksimal 24 karakter.');
    const invite = this.security.readInvitation(invitation);
    if (invite.code !== code) throw new Error('Kode room tidak cocok dengan kunci undangan.');
    const host = await this.security.importIdentity(invite.h);
    this.key = await this.security.roomKey(invite.k); this.hostKey = host.key;
    this.context = { code, session: invite.session, hostId: host.id }; this.name = name.trim();
    try {
      await this.resubscribe();
      await this.waitFor(() => !!this.room?.players.some(p => p.id === this.identity.id), 'Room tidak ditemukan, penuh, kedaluwarsa, atau host offline.');
      return this.snapshot();
    } catch (error) {
      if (this.online) this.client.unsubscribe(this.topic('state'), () => {});
      this.clearRoom(); throw error;
    }
  }
  async setReady({ ready }) {
    this.ensureConnected();
    if (!this.room || this.room.status !== 'waiting') throw new Error('Pertandingan tidak dalam lobby.');
    const seq = await this.send('ready', { ready });
    await this.waitFor(() => this.room?.players.some(p => p.id === this.identity.id && p.ack >= seq && p.ready === ready), 'Status siap belum dikonfirmasi host. Coba lagi.');
    return this.snapshot();
  }
  async startMatch() {
    this.ensureConnected();
    if (!this.authority) throw new Error('Hanya host dapat memulai pertandingan.');
    this.authority.start(this.now()); this.latestStats = { steps: 0, activity: 'Diam' };
    this.broadcast(); return this.snapshot();
  }
  async resetMatch() {
    this.ensureConnected();
    if (!this.authority) throw new Error('Hanya host dapat mereset pertandingan.');
    this.authority.reset(this.now(), this.security.id()); this.latestStats = { steps: 0, activity: 'Diam' };
    this.broadcast(); return this.snapshot();
  }
  submitStats({ steps, activity }) {
    if (!this.room || this.room.status !== 'running' || !Number.isSafeInteger(steps) || steps < this.latestStats.steps || !['Diam', 'Berjalan', 'Berjalan cepat'].includes(activity)) return false;
    this.latestStats = { steps, activity }; // Whitelist aggregates; never forward raw axes/timestamps.
    if (this.authority) this.authority.command(this.command('steps', this.latestStats), this.now());
    return true;
  }
  command(type, fields) {
    return { ...fields, v: 1, type, code: this.context.code, session: this.context.session, round: this.room?.round ?? null, id: this.identity.id, seq: ++this.seq };
  }
  async send(type, fields = {}) {
    this.ensureConnected();
    if (!this.context) throw new Error('Belum berada di room.');
    const message = this.command(type, fields);
    if (this.authority) {
      if (!this.authority.command(message, this.now())) throw new Error('Perintah pertandingan ditolak.');
      this.broadcast();
    } else await this.publish('command', message, false);
    return message.seq;
  }
  publish(kind, message, retain) {
    const topic = this.topic(kind), key = this.key, generation = this.generation;
    const job = this.outgoing.then(async () => {
      if (!this.online || this.closed || generation !== this.generation) return;
      const payload = await this.security.seal(message, this.identity, key, topic);
      if (!this.online || this.closed || generation !== this.generation) return;
      await new Promise((resolve, reject) => this.client.publish(topic, payload, { qos: retain ? 1 : 0, retain }, error => error ? reject(error) : resolve()));
    });
    this.outgoing = job.catch(() => {});
    return job;
  }
  broadcast() {
    if (!this.authority) return;
    this.authority.value.revision += 1;
    const snapshot = { v: 1, type: 'state', ...this.authority.snapshot(this.now()) };
    this.room = snapshot; this.emit();
    if (this.online && this.subscribed) this.publish('state', snapshot, true).catch(() => this.onError(new Error('Gagal mengirim status pertandingan.')));
  }
  async receive(topic, payload) {
    const context = this.context, generation = this.generation;
    const packet = await this.security.open(payload, this.key, topic);
    const m = packet.message;
    if (!m || m.v !== 1 || m.code !== context.code || m.session !== context.session) return;
    if (this.authority) {
      if (m.id === this.identity.id) return;
      let peer = this.peers.get(m.id);
      if (!peer) {
        if (m.type !== 'join' || this.authority.value.players.length >= 2) return;
        peer = await this.security.importIdentity(m.publicKey);
        if (peer.id !== m.id) return;
      }
      if (!await this.security.verify(packet, peer.key) || generation !== this.generation) return;
      if (this.authority.command(m, this.now())) {
        this.peers.set(m.id, peer);
        this.broadcast();
      }
    } else {
      if (m.type !== 'state' || !await this.security.verify(packet, this.hostKey) || generation !== this.generation) return;
      if (!MRProtocol.MoveRankRoom.valid(m, context, this.now()) || m.revision <= this.revision) return;
      this.revision = m.revision; this.lastHostAt = this.now();
      this.onConnection(true);
      if (!m.players.some(p => p.id === this.identity.id)) return;
      if (this.room?.round !== m.round) this.latestStats = { steps: 0, activity: 'Diam' };
      this.room = m; this.emit();
    }
    this.resolvePending();
  }
  snapshot() {
    if (!this.room) return null;
    return { ...JSON.parse(JSON.stringify(this.room)), selfId: this.identity.id, demo: false };
  }
  emit() { const snapshot = this.snapshot(); if (snapshot) this.onRoom(snapshot); this.resolvePending(); }
  tick() {
    if (this.closed || !this.context) return;
    if (this.authority) {
      this.broadcast();
      if (this.now() >= this.authority.value.expiresAt) { this.onError(new Error('Room kedaluwarsa. Muat ulang untuk membuat room baru.')); this.disconnect(); }
      return;
    }
    const fresh = this.now() - this.lastHostAt < 6000;
    this.onConnection(this.online && this.subscribed && fresh);
    // Keep the display and sensor deadline active even while MQTT is offline.
    // Only a signed host result may change the round's status to finished.
    if (this.room) {
      const view = this.snapshot();
      if (view.status === 'running') view.remaining = Math.max(0, Math.ceil((view.endsAt - this.now()) / 1000));
      if (!fresh) view.players.find(p => p.id === view.hostId).connected = false;
      this.onRoom(view);
    }
    if (!this.online || !this.subscribed) return;
    if (!this.room) this.send('join', { name: this.name, publicKey: this.identity.publicKey }).catch(() => {});
    else {
      const stillRunning = this.room.status === 'running' && this.now() < this.room.endsAt;
      this.send(stillRunning ? 'steps' : 'ping', stillRunning ? this.latestStats : {}).catch(() => {});
    }
  }
  waitFor(test, message) {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const entry = { test, resolve, reject };
      entry.timer = setTimeout(() => { this.pending.delete(entry); reject(new Error(message)); }, this.requestTimeout);
      this.pending.add(entry);
    });
  }
  resolvePending() {
    for (const entry of this.pending) if (entry.test()) { clearTimeout(entry.timer); this.pending.delete(entry); entry.resolve(); }
  }
  rejectPending(error) {
    for (const entry of this.pending) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  clearRoom() {
    this.generation += 1; this.context = null; this.room = null; this.authority = null; this.key = null;
    this.hostKey = null; this.invitation = null; this.revision = 0; this.peers.clear(); this.subscribed = this.online;
  }
  disconnect() {
    this.closed = true; this.online = false; this.subscribed = false;
    clearInterval(this.timer); this.rejectPending(new Error('Koneksi ditutup.'));
    this.client?.end(true); this.onConnection(false);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = MoveRankMQTT;
else globalThis.MoveRankMQTT = MoveRankMQTT;
