'use strict';

// Shared browser/Node protocol. No sensor samples or broker credentials enter packets.
const MR_ACTIVITIES = ['Diam', 'Berjalan', 'Berjalan cepat'];
const mrCopy = value => JSON.parse(JSON.stringify(value));
const mrB64 = bytes => btoa(String.fromCharCode(...bytes));
const mrBytes = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
const mrName = name => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 24 && !/[\u0000-\u001f\u007f]/.test(name);
const mrId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

class MoveRankCrypto {
  constructor(crypto = globalThis.crypto) {
    if (!crypto?.subtle) throw new Error('Kriptografi memerlukan HTTPS dan Web Crypto.');
    this.crypto = crypto;
    this.encoder = new TextEncoder();
  }
  random(size = 16) { return this.crypto.getRandomValues(new Uint8Array(size)); }
  id() { return [...this.random()].map(n => n.toString(16).padStart(2, '0')).join(''); }
  async identity() {
    const keys = await this.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = new Uint8Array(await this.crypto.subtle.exportKey('raw', keys.publicKey));
    const hash = new Uint8Array(await this.crypto.subtle.digest('SHA-256', raw));
    return { keys, publicKey: mrB64(raw), id: [...hash.slice(0, 16)].map(n => n.toString(16).padStart(2, '0')).join('') };
  }
  async importIdentity(publicKey) {
    if (typeof publicKey !== 'string' || publicKey.length !== 88) throw new Error('Identitas tidak valid.');
    const raw = mrBytes(publicKey);
    const key = await this.crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    const hash = new Uint8Array(await this.crypto.subtle.digest('SHA-256', raw));
    return { key, id: [...hash.slice(0, 16)].map(n => n.toString(16).padStart(2, '0')).join('') };
  }
  async roomKey(value) {
    if (typeof value !== 'string' || mrBytes(value).length !== 32) throw new Error('Kunci room tidak valid.');
    return this.crypto.subtle.importKey('raw', mrBytes(value), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  invitation(value) { return mrB64(this.encoder.encode(JSON.stringify(value))); }
  readInvitation(value) {
    try {
      if (typeof value !== 'string' || value.length > 1024) throw new Error();
      const result = JSON.parse(new TextDecoder().decode(mrBytes(value.trim())));
      if (result.v !== 1 || !mrId(result.session) || !/^[A-Z0-9]{6}$/.test(result.code)) throw new Error();
      return result;
    } catch { throw new Error('Kunci undangan tidak valid. Salin utuh dari host.'); }
  }
  async seal(message, identity, key, topic) {
    const data = this.encoder.encode(JSON.stringify(message));
    const signature = mrB64(new Uint8Array(await this.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.keys.privateKey, data)));
    const iv = this.random(12);
    const body = this.encoder.encode(JSON.stringify({ message, signature }));
    const encrypted = await this.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.encoder.encode(topic) }, key, body);
    return JSON.stringify({ v: 1, iv: mrB64(iv), data: mrB64(new Uint8Array(encrypted)) });
  }
  async open(payload, key, topic) {
    if (typeof payload !== 'string' || payload.length > 16384) throw new Error('Paket terlalu besar.');
    const envelope = JSON.parse(payload);
    if (envelope.v !== 1 || typeof envelope.iv !== 'string' || envelope.iv.length !== 16 || typeof envelope.data !== 'string') throw new Error('Paket tidak valid.');
    const plain = await this.crypto.subtle.decrypt({ name: 'AES-GCM', iv: mrBytes(envelope.iv), additionalData: this.encoder.encode(topic) }, key, mrBytes(envelope.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async verify(packet, key) {
    if (typeof packet.signature !== 'string' || packet.signature.length !== 88) return false;
    return this.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, mrBytes(packet.signature), this.encoder.encode(JSON.stringify(packet.message)));
  }
}

class MoveRankRoom {
  constructor({ code, session, host, duration, now, round }) {
    if (!/^[A-Z0-9]{6}$/.test(code) || !mrId(session) || !mrId(round) || !mrId(host.id) || !mrName(host.name) || ![60, 180, 300].includes(duration)) throw new Error('Room tidak valid.');
    this.value = { code, session, hostId: host.id, duration, round, revision: 0, status: 'waiting', startsAt: null, endsAt: null, expiresAt: now + 1800000, winnerIds: [], players: [this.player(host)] };
    this.lastSeen = new Map([[host.id, now]]);
    this.lastScore = new Map();
  }
  player({ id, name }) { return { id, name: name.trim(), ready: false, steps: 0, activity: 'Diam', connected: true, ack: 0 }; }
  command(message, now) {
    const r = this.value;
    this.tick(now);
    if (now >= r.expiresAt || message.code !== r.code || message.session !== r.session || !mrId(message.id) || !Number.isSafeInteger(message.seq) || message.seq < 1) return false;
    let p = r.players.find(player => player.id === message.id);
    if (message.type === 'join' && !p) {
      if (r.status !== 'waiting' || r.players.length !== 1 || !mrName(message.name)) return false;
      p = this.player(message); r.players.push(p);
    }
    if (!p || message.seq <= p.ack) return false;
    if (message.type !== 'join' && message.round !== r.round) return false;
    if (message.type === 'ready') {
      if (r.status !== 'waiting' || typeof message.ready !== 'boolean') return false;
      p.ready = message.ready;
    } else if (message.type === 'steps') {
      if (r.status !== 'running' || !Number.isSafeInteger(message.steps) || message.steps < p.steps || !MR_ACTIVITIES.includes(message.activity)) return false;
      // Sensor's minimum interval is 300 ms. Bound total and incremental growth.
      const previous = this.lastScore.get(p.id) ?? { at: r.startsAt, steps: 0 };
      if (message.steps > Math.floor((now - r.startsAt) / 300) + 1 || message.steps - previous.steps > Math.floor((now - previous.at) / 300) + 2) return false;
      if (message.steps > p.steps) this.lastScore.set(p.id, { at: now, steps: message.steps });
      p.steps = message.steps; p.activity = message.activity;
    } else if (!['join', 'ping'].includes(message.type)) return false;
    p.ack = message.seq; p.connected = true; this.lastSeen.set(p.id, now);
    return true;
  }
  start(now) {
    this.tick(now);
    const r = this.value;
    if (now >= r.expiresAt || r.status !== 'waiting' || r.players.length !== 2 || !r.players.every(p => p.ready && p.connected)) throw new Error('Dua pemain harus siap dan terhubung.');
    Object.assign(r, { status: 'running', startsAt: now, endsAt: now + r.duration * 1000 });
  }
  reset(now, round) {
    if (now >= this.value.expiresAt) throw new Error('Room kedaluwarsa. Muat ulang dan buat room baru.');
    Object.assign(this.value, { round, status: 'waiting', startsAt: null, endsAt: null, winnerIds: [] });
    this.value.players.forEach(p => Object.assign(p, { ready: false, steps: 0, activity: 'Diam' }));
    this.lastScore.clear(); this.tick(now);
  }
  tick(now) {
    const r = this.value;
    r.players.forEach(p => { p.connected = p.id === r.hostId || now - (this.lastSeen.get(p.id) ?? 0) < 6000; });
    if (r.status === 'running' && now >= r.endsAt) {
      r.status = 'finished';
      const best = Math.max(...r.players.map(p => p.steps));
      r.winnerIds = r.players.filter(p => p.steps === best).map(p => p.id);
      r.players.forEach(p => { p.activity = 'Selesai'; });
    }
  }
  snapshot(now) {
    this.tick(now);
    return mrCopy({ ...this.value, hostNow: now, remaining: this.value.status === 'waiting' ? this.value.duration : Math.max(0, Math.ceil((this.value.endsAt - now) / 1000)) });
  }
  static valid(s, { code, session, hostId }, now) {
    if (!s || s.code !== code || s.session !== session || s.hostId !== hostId || !mrId(s.round) || !Number.isSafeInteger(s.revision) || s.revision < 1 || ![60, 180, 300].includes(s.duration) || !['waiting', 'running', 'finished'].includes(s.status)) return false;
    if (!Number.isFinite(s.hostNow) || !Number.isFinite(s.expiresAt) || s.expiresAt <= now || s.expiresAt < s.hostNow || Math.abs(now - s.hostNow) > 30000 || !Number.isInteger(s.remaining) || s.remaining < 0 || s.remaining > s.duration) return false;
    if (!Array.isArray(s.players) || s.players.length < 1 || s.players.length > 2 || !s.players.every(p => p && typeof p === 'object') || new Set(s.players.map(p => p.id)).size !== s.players.length || !s.players.some(p => p.id === hostId)) return false;
    if (!s.players.every(p => mrId(p.id) && mrName(p.name) && Number.isSafeInteger(p.steps) && p.steps >= 0 && p.steps <= Math.floor(s.duration * 1000 / 300) + 1 && typeof p.ready === 'boolean' && typeof p.connected === 'boolean' && Number.isSafeInteger(p.ack) && p.ack >= 0 && [...MR_ACTIVITIES, 'Selesai'].includes(p.activity))) return false;
    if (s.status === 'waiting') {
      if (s.startsAt !== null || s.endsAt !== null || s.remaining !== s.duration || s.players.some(p => p.steps !== 0)) return false;
    } else if (!Number.isFinite(s.startsAt) || s.endsAt !== s.startsAt + s.duration * 1000 || s.remaining !== Math.max(0, Math.ceil((s.endsAt - s.hostNow) / 1000)) || (s.status === 'running' ? s.hostNow >= s.endsAt : s.hostNow < s.endsAt)) return false;
    const winners = s.status === 'finished' ? s.players.filter(p => p.steps === Math.max(...s.players.map(player => player.steps))).map(p => p.id) : [];
    return Array.isArray(s.winnerIds) && JSON.stringify([...s.winnerIds].sort()) === JSON.stringify(winners.sort());
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MoveRankCrypto, MoveRankRoom };
else Object.assign(globalThis, { MoveRankCrypto, MoveRankRoom });
