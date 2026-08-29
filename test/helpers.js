import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const exec = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeSrc = path.join(__dirname, 'fixtures', 'fake-codex.js');

export const N8N_IMAGE = 'docker.n8n.io/n8nio/n8n:latest';


/** n8n only preserves imported ids in its own format: 16 chars of [A-Za-z0-9]. */
export function testWorkflowId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
/** A minimal but valid workflow accepted by `n8n import:workflow`. */
export const seedWorkflow = (id, name) => ({
  id,
  name,
  active: false,
  nodes: [
    {
      parameters: {},
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
    },
  ],
  connections: {},
  settings: {},
});

/**
 * Put a fake `codex` first on PATH (POSIX script or Windows .cmd shim) and
 * set the given FAKE_CODEX_* env vars; everything is undone in t.after().
 * Returns { log, calls() } — calls() parses the recorded invocations.
 */
export function installFakeCodex(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-codex-'));
  const log = path.join(dir, 'calls.ndjson');
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'codex.cmd'), `@echo off\r\n"${process.execPath}" "${fakeSrc}" %*\r\n`);
  } else {
    const sh = path.join(dir, 'codex');
    fs.writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${fakeSrc}" "$@"\n`);
    fs.chmodSync(sh, 0o755);
  }
  const wanted = { PATH: dir + path.delimiter + process.env.PATH, FAKE_CODEX_LOG: log, ...env };
  const saved = {};
  for (const [k, v] of Object.entries(wanted)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    log,
    calls: () =>
      fs.existsSync(log)
        ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
        : [],
  };
}

export async function hasDocker() {
  try {
    // require a Linux daemon: GitHub's Windows runners have a docker CLI in
    // Windows-container mode, which cannot run the n8n image
    const { stdout } = await exec('docker', ['version', '--format', '{{.Server.Os}}']);
    return stdout.trim() === 'linux';
  } catch {
    return false;
  }
}
export async function hasCompose() {
  try {
    await exec('docker', ['compose', 'version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a throwaway n8n container (random loopback-only port, no volume —
 * fully isolated from any student install), seed it with `wf`, and remove it
 * in t.after().
 * Readiness probe = the seed import succeeding, i.e. DB migrated + CLI usable.
 */
export async function startThrowawayN8n(t, wf) {
  const name = `n8n-codex-test-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await exec('docker', ['run', '-d', '--name', name, '-p', '127.0.0.1:0:5678', N8N_IMAGE]);
  t.after(async () => {
    try {
      await exec('docker', ['rm', '-f', name]);
    } catch {}
  });
  // wait until the server finished migrating and is up — running the CLI
  // while boot migrations hold the SQLite lock fails intermittently
  let booted = false;
  for (let i = 0; i < 60 && !booted; i++) {
    const { stdout, stderr } = await exec('docker', ['logs', name]);
    booted = /Editor is now accessible/.test(stdout + stderr);
    if (!booted) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!booted) throw new Error('throwaway n8n never finished booting');
  const { importWorkflowRaw } = await import('../src/docker.js');
  let lastErr;
  for (let i = 0; i < 10; i++) {
    try {
      await importWorkflowRaw(name, wf);
      return name;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`throwaway n8n never accepted the seed workflow: ${lastErr?.message}`);
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** serve() the dashboard on a free port; closed in t.after(). Returns { cfg, url }. */
export async function startDashboard(t, over = {}) {
  const { serve } = await import('../src/server.js');
  const cfg = {
    container: 'no-such-container-for-tests',
    n8nUrl: 'http://localhost:1',
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-codex-test-')),
    port: await freePort(),
    open: false,
    ...over,
  };
  const server = serve(cfg);
  await new Promise((r) => server.on('listening', r));
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((r) => server.close(r));
  });
  t.after(() => fs.rmSync(cfg.dir, { recursive: true, force: true }));
  return { cfg, url: `http://localhost:${cfg.port}` };
}
