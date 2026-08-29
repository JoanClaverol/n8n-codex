// The proxy must present the dashboard's traffic as n8n's own: Host AND
// Origin rewritten to the upstream. n8n's push websocket accepts the upgrade
// and then closes 1008 "Invalid origin!" when Origin doesn't match its Host —
// which kills the editor's push connection and makes every manual run fail
// with "Problem running workflow / Lost connection to the server".
// Hermetic: a fake upstream records what the proxy really sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';
import { freePort, startDashboard } from './helpers.js';

/** Fake n8n: records request headers; answers upgrades with 101 + one byte. */
async function startFakeUpstream(t) {
  const seen = { requests: [], upgrades: [] };
  const server = http.createServer((req, res) => {
    seen.requests.push(req.headers);
    res.writeHead(200, { 'content-type': 'text/plain', 'x-frame-options': 'DENY' });
    res.end('upstream ok');
  });
  server.on('upgrade', (req, socket) => {
    seen.upgrades.push(req.headers);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n');
    socket.end();
  });
  const port = await freePort();
  server.listen(port, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, port };
}

test('proxied requests reach n8n with its own Host and Origin', async (t) => {
  const upstream = await startFakeUpstream(t);
  const { cfg, url } = await startDashboard(t, { n8nUrl: `http://localhost:${upstream.port}` });

  // plain request: host + origin rewritten, frame-blocking headers stripped
  const res = await fetch(url + '/rest/anything', { headers: { origin: `http://localhost:${cfg.port}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), null, 'frame-blocking header stripped');
  const [reqHeaders] = upstream.seen.requests;
  assert.equal(reqHeaders.host, `localhost:${upstream.port}`);
  assert.equal(reqHeaders.origin, `http://localhost:${upstream.port}`, 'origin must match the upstream host');

  // websocket upgrade (the n8n push connection): same rewrite
  const status = await new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost',
      port: cfg.port,
      path: '/rest/push?pushRef=test',
      headers: {
        host: `localhost:${cfg.port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        origin: `http://localhost:${cfg.port}`,
        'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', (res) => resolve(res.statusCode));
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 101, 'upgrade relayed');
  const [upHeaders] = upstream.seen.upgrades;
  assert.equal(upHeaders.host, `localhost:${upstream.port}`);
  assert.equal(upHeaders.origin, `http://localhost:${upstream.port}`,
    'push origin must match the upstream host, or n8n closes it with "Invalid origin!"');

  // requests without an Origin (curl, same-origin GETs) must not grow one
  await fetch(url + '/rest/anything');
  const bare = upstream.seen.requests[1];
  assert.equal('origin' in bare, false, 'no origin header invented');
});

test('a foreign Origin is forwarded untouched so n8n can reject it', async (t) => {
  const upstream = await startFakeUpstream(t);
  const { cfg, url } = await startDashboard(t, { n8nUrl: `http://localhost:${upstream.port}` });

  // plain request from some other local page: origin must survive as-is
  await fetch(url + '/rest/anything', { headers: { origin: 'http://evil.example' } });
  const [reqHeaders] = upstream.seen.requests;
  assert.equal(reqHeaders.origin, 'http://evil.example', 'foreign origin not rewritten');

  // websocket upgrade with a foreign origin (websockets skip CORS): same rule
  await new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost',
      port: cfg.port,
      path: '/rest/push?pushRef=test',
      headers: {
        host: `localhost:${cfg.port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        origin: 'http://evil.example',
        'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(); });
    req.on('response', () => resolve());
    req.on('error', reject);
    req.end();
  });
  const [upHeaders] = upstream.seen.upgrades;
  assert.equal(upHeaders.origin, 'http://evil.example',
    'foreign push origin passes through so n8n can close it with "Invalid origin!"');
});

/** Upstream that accepts TCP and reads (like a booting n8n) but never answers. */
async function startSilentUpstream(t) {
  const sockets = [];
  const server = net.createServer((s) => { sockets.push(s); s.resume(); });
  const port = await freePort();
  server.listen(port, '127.0.0.1');
  await new Promise((r) => server.on('listening', r));
  t.after(() => { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(r)); });
  return { port, sockets };
}

const UPGRADE_REQ = (port) =>
  `GET /rest/push HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
  `Origin: http://localhost:${port}\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`;

test('client reset during a pending upgrade must not crash the server', async (t) => {
  const upstream = await startSilentUpstream(t);
  const { cfg, url } = await startDashboard(t, { n8nUrl: `http://localhost:${upstream.port}` });

  const client = net.connect(cfg.port, '127.0.0.1');
  await new Promise((r) => client.on('connect', r));
  client.write(UPGRADE_REQ(cfg.port));
  await new Promise((r) => setTimeout(r, 150)); // upstream handshake now pending
  client.resetAndDestroy(); // ECONNRESET on the raw socket — used to kill the process
  await new Promise((r) => setTimeout(r, 200));

  const res = await fetch(url + '/'); // server survived and still answers
  assert.equal(res.status, 200);
});

test('client vanishing before the upgrade completes tears down the upstream', async (t) => {
  const upstream = await startSilentUpstream(t);
  const { cfg } = await startDashboard(t, { n8nUrl: `http://localhost:${upstream.port}` });

  const client = net.connect(cfg.port, '127.0.0.1');
  await new Promise((r) => client.on('connect', r));
  client.write(UPGRADE_REQ(cfg.port));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(upstream.sockets.length, 1, 'proxy opened one upstream connection');
  client.end(); // clean FIN, upstream 101 still pending
  await new Promise((resolve, reject) => {
    upstream.sockets[0].on('close', resolve);
    setTimeout(() => reject(new Error('upstream connection was leaked')), 2000);
  });
});
