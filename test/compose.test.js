// The shipped docker-compose.yml must keep the course installation contract
// (WBS Module 3): container n8n, loopback port 5678, n8n_data volume at
// /home/node/.n8n, and the three required environment variables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, hasCompose } from './helpers.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = await hasCompose();

test('compose file matches the course installation contract', { skip: !compose && 'docker compose unavailable' }, async () => {
  const { stdout } = await exec('docker', ['compose', 'config', '--format', 'json'], { cwd: root });
  const cfg = JSON.parse(stdout);
  const svc = cfg.services.n8n;

  assert.equal(svc.container_name, 'n8n');
  assert.match(svc.image, /^docker\.n8n\.io\/n8nio\/n8n:/);
  assert.equal(svc.restart, 'unless-stopped');

  const [port] = svc.ports;
  assert.equal(String(port.published), '5678');
  assert.equal(port.target, 5678);
  assert.equal(port.host_ip, '127.0.0.1', 'editor must not be exposed to the LAN');

  assert.equal(svc.environment.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS, 'true');
  assert.ok(svc.environment.GENERIC_TIMEZONE, 'GENERIC_TIMEZONE set');
  assert.ok(svc.environment.TZ, 'TZ set');

  const [vol] = svc.volumes;
  assert.equal(vol.type, 'volume');
  assert.equal(vol.source, 'n8n_data');
  assert.equal(vol.target, '/home/node/.n8n');
  assert.equal(cfg.volumes.n8n_data.name, 'n8n_data',
    'volume name must stay unprefixed so hand-made course installs are adopted');
});
