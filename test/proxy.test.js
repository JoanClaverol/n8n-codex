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
