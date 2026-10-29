'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { createServer } = require('node:http');
const { readFile, access } = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const mockMQTT = `
window.mqtt = { connect() {
  const listeners = new Map();
  const client = {
    on(type, handler) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(handler); return this; },
    emit(type, ...args) { for (const handler of listeners.get(type) || []) handler(...args); },
    subscribe(topic, options, done) {
      window.testBroker('subscribe', { topic }).then(retained => {
        done(null, [{ topic, qos: 1 }]);
        if (retained) queueMicrotask(() => client.emit('message', topic, retained, { retain: true }));
      });
    },
    unsubscribe(topic, done) { window.testBroker('unsubscribe', { topic }).then(() => done()); },
    publish(topic, payload, options, done) { window.testBroker('publish', { topic, payload, options }).then(() => done()); },
    end() { window.testBroker('end', {}); }
  };
  window.testMQTTClient = client;
  queueMicrotask(() => client.emit('connect'));
  return client;
} };
`;
async function fixture(t) {
  const server = createServer(async (request, response) => {
    try {
      const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
      if (!file.startsWith(root + path.sep)) throw new Error('invalid path');
      const body = await readFile(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'text/plain';
      response.writeHead(200, { 'content-type': mime + '; charset=utf-8' }); response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (await access(edge).then(() => edge, () => undefined));
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const subscriptions = new Map(), retained = new Map(), errors = [];
  await context.exposeBinding('testBroker', ({ page }, operation, data) => {
    if (!subscriptions.has(page)) subscriptions.set(page, new Set());
    const topics = subscriptions.get(page);
    if (operation === 'subscribe') { topics.add(data.topic); return retained.get(data.topic) || null; }
    if (operation === 'unsubscribe') topics.delete(data.topic);
    if (operation === 'end') topics.clear();
    if (operation === 'publish') {
      if (data.options.retain) retained.set(data.topic, data.payload);
      for (const [peer, peerTopics] of subscriptions) if (peerTopics.has(data.topic)) {
        setImmediate(() => peer.evaluate(({ topic, payload }) => window.testMQTTClient.emit('message', topic, payload, { retain: false }), data).catch(() => {}));
      }
    }
    return null;
  });
  await context.route('https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.min.js', route => route.fulfill({ contentType: 'text/javascript', body: mockMQTT }));
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.addInitScript(() => {
    window.permissionRequests = 0; window.motionPermission = 'granted';
    Object.defineProperty(window.DeviceMotionEvent, 'requestPermission', { configurable: true, value: () => { window.permissionRequests++; return Promise.resolve(window.motionPermission); } });
  });
  const url = `http://127.0.0.1:${server.address().port}/User%20Interface/index.html`;
  async function page() {
    const value = await context.newPage();
    value.on('pageerror', error => errors.push(error.message));
    await value.clock.install({ time: new Date('2026-10-29T03:00:00Z') });
    // Freeze real-time advancement: sensor intervals must depend only on runFor().
    await value.clock.pauseAt(new Date('2026-10-29T03:00:01Z'));
    await value.goto(url);
    return value;
  }
  return { page, errors };
}
async function configure(page) {
  await page.locator('#cloud-url').fill('wss://cluster.example:8884/mqtt');
  await page.locator('#cloud-username').fill('app');
  await page.locator('#cloud-password').fill('browser-test');
  await page.locator('#cloud-connect').click();
  await expect(page.locator('#cloud-status')).toHaveText('Terhubung ke MQTT Cloud.');
}
async function walk(page, count) {
  for (let time = 0; time < count * 600; time += 20) {
    await page.clock.runFor(20);
    const phase = time % 600, signal = phase <= 240 ? 3 * (1 - Math.abs(phase - 120) / 120) : 0;
    await page.evaluate(signal => {
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
        acceleration: { x: 0, y: 0, z: signal },
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.80665 + signal },
        rotationRate: { alpha: 30, beta: 0, gamma: 0 }, interval: 20
      }));
    }, signal);
  }
  await page.clock.runFor(1000);
}

test('browser: online form, permission gating, two sensors, leaderboard, result, and reset', { timeout: 60000 }, async t => {
  const app = await fixture(t), host = await app.page(), guest = await app.page();
  await configure(host); await configure(guest);
  await host.locator('[data-open=create]').click();
  await host.locator('#player-name').fill('Host');
  await host.locator('#duration').selectOption('60');
  await host.locator('#submit-room').click();
  await expect(host.locator('#room-dialog')).not.toBeVisible();
  const code = await host.locator('#room-code').textContent();
  const invitation = await host.locator('#cloud-invitation').inputValue();
  assert.ok(invitation.length > 100);
  await guest.locator('[data-open=join]').click();
  await guest.locator('#player-name').fill('Guest');
  await guest.locator('#join-code').fill(code);
  await guest.locator('#join-invitation').fill(invitation);
  await guest.locator('#submit-room').click();
  await expect(guest.locator('#room-dialog')).not.toBeVisible();
  await guest.evaluate(() => { window.motionPermission = 'denied'; });
  await guest.locator('#ready-button').click();
  await expect(guest.locator('#self-status')).toHaveText('Belum siap');
  await expect(guest.locator('#toast')).toContainText('Izin sensor ditolak');
  await guest.evaluate(() => { window.motionPermission = 'granted'; });
  await guest.locator('#ready-button').click();
  await host.locator('#ready-button').click();
  await expect(host.locator('#start-button')).toBeEnabled();
  await host.locator('#start-button').click();
  await expect(guest.locator('#arena-tag')).toHaveText('SEDANG BERLANGSUNG');
  await expect(host.locator('#cloud-sensor-status')).toContainText('Sensor aktif');
  await expect(guest.locator('#cloud-sensor-status')).toContainText('Sensor aktif');
  await Promise.all([walk(host, 3), walk(guest, 5)]);
  await host.clock.runFor(2000); await guest.clock.runFor(1000);
  await expect(host.locator('#leaderboard-body')).toContainText('Guest');
  await expect(host.locator('#step-total')).toHaveText('3');
  await expect(guest.locator('#step-total')).toHaveText('5');
  for (const page of [host, guest]) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  }
  await guest.evaluate(() => window.testMQTTClient.emit('close'));
  await Promise.all([host.clock.fastForward(60000), guest.clock.fastForward(60000)]);
  await expect(guest.locator('#timer')).toHaveText('00:00');
  // The sensor may already have halted via its no-data watchdog before the deadline.
  await expect(guest.locator('#cloud-sensor-status')).not.toContainText('Sensor aktif');
  await expect(guest.locator('#cloud-resume')).toBeHidden();
  await guest.evaluate(() => window.testMQTTClient.emit('connect'));
  await host.clock.runFor(1000);
  await expect(host.locator('#match-message')).toHaveText('Pemenang: Guest dengan 5 langkah valid.');
  await expect(guest.locator('#match-message')).toHaveText('Pemenang: Guest dengan 5 langkah valid.');
  await host.locator('#reset-button').click(); await host.locator('#confirm-reset').click();
  await expect(guest.locator('#arena-tag')).toHaveText('LOBBY');
  await expect(guest.locator('#step-total')).toHaveText('0');
  await expect(host.locator('#step-total')).toHaveText('0');
  assert.equal(await host.evaluate(() => window.permissionRequests), 1);
  assert.equal(await guest.evaluate(() => window.permissionRequests), 2);
  assert.deepEqual(app.errors, []);
});

test('browser: local demo still works without configuring MQTT', { timeout: 30000 }, async t => {
  const app = await fixture(t), page = await app.page();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-open=create]').click(); await page.locator('#player-name').fill('Demo');
  await page.locator('#submit-room').click(); await page.locator('#ready-button').click();
  await page.locator('#start-button').click(); await page.clock.runFor(3000);
  assert.ok(Number(await page.locator('#step-total').textContent()) > 0);
  await expect(page.locator('#cloud-connect')).toBeDisabled();
  assert.deepEqual(app.errors, []);
});
