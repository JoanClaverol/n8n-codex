// Dashboard hardening: host allowlist (anti DNS-rebinding), content-type
// gate on the chat API, and friendly errors instead of crashes when the
// n8n container is missing. No Docker needed — all paths fail before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startDashboard } from './helpers.js';

/** fetch() refuses to set Host (forbidden header) — go raw to spoof it. */
function rawGet(cfg, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: cfg.port, path, headers: { host } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
    );
    req.on('error', reject);
    req.end();
  });
}
test('requests with a foreign Host header are rejected', async (t) => {
  const { cfg } = await startDashboard(t);
  for (const target of ['/', '/api/workflows', '/rest/workflows/abc']) {
    assert.equal(await rawGet(cfg, target, 'evil.example:5680'), 403,
      `${target} must 403 for a rebound host`);
  }
});
test('dashboard and chat pages are served for the real host', async (t) => {
  const { url } = await startDashboard(t);
  const home = await fetch(url + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /n8n.*codex/s);
  const chat = await fetch(url + '/chat/abc123');
  assert.equal(chat.status, 200);
});

test('chat API refuses non-JSON content types (CSRF simple requests)', async (t) => {
  const { url } = await startDashboard(t);
  const res = await fetch(url + '/api/chat/abc123', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ message: 'hi' }),
  });
  assert.equal(res.status, 403);
});

test('missing n8n container yields a friendly 500, not a crash', async (t) => {
  const { url } = await startDashboard(t); // container name that does not exist
  const res = await fetch(url + '/api/workflows');
  assert.equal(res.status, 500);
  assert.match(await res.text(), /No Docker container|Docker CLI not found/);
});
