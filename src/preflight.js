import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const bad = (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
const fix = (s) => console.log(`    \x1b[33m→ ${s}\x1b[0m`);

async function run(cmd, args) {
  const { stdout } = await exec(cmd, args, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function n8nReachable(url, tries = 1, delayMs = 1000) {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

/** Check everything a student needs; auto-fix what is safe. Returns false if unusable. */
export async function preflight(cfg) {
  console.log('Checking your setup…');
  let usable = true;

  // 1. Docker + n8n container
  try {
    const state = (await run('docker', ['inspect', '-f', '{{.State.Running}}', cfg.container])).trim();
    if (state === 'true') {
      ok('n8n is running');
    } else {
      console.log(`  … n8n container is stopped — starting it for you`);
      await run('docker', ['start', cfg.container]);
      if (await n8nReachable(cfg.n8nUrl, 30)) ok('n8n started');
      else { bad('n8n did not come up'); fix(`check it with: docker logs ${cfg.container}`); usable = false; }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      bad('Docker is not installed (or not on PATH)');
      fix('install Docker Desktop, start it, then run n8n-codex again');
      return false;
    }
    // container not found — maybe it has a different name
    let hint = '';
    try {
      const rows = (await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}'])).trim().split('\n');
      const candidate = rows.map((r) => r.split('\t')).find(([, img]) => /n8n/i.test(img || ''));
      if (candidate) hint = candidate[0];
    } catch { /* docker daemon down */ }
    if (hint) {
      bad(`no container named "${cfg.container}", but found one named "${hint}"`);
      fix(`run:  n8n-codex --container=${hint}`);
    } else {
      bad(`no n8n container found (looked for "${cfg.container}")`);
      fix('is Docker Desktop running? Then follow the n8n install step in the README');
    }
    return false;
  }

  // 2. codex CLI
  try {
    await run('codex', ['--version']);
    ok('AI assistant (codex) is installed');
  } catch {
    bad('codex is not installed');
    fix('run:  npm install -g @openai/codex   then:  codex login');
    return false;
  }

  // 3. codex login
  if (fs.existsSync(path.join(os.homedir(), '.codex', 'auth.json'))) {
    ok('codex is logged in');
  } else {
    bad('codex is not logged in yet');
    fix('run:  codex login   (sign in with the ChatGPT account)');
    usable = false;
  }

  // 4. MCP registration (auto-fix)
  try {
    const listed = await run('codex', ['mcp', 'list']);
    if (/^n8n\s/m.test(listed)) {
      ok('codex can talk to n8n');
    } else {
      await run('codex', ['mcp', 'add', 'n8n', '--', 'n8n-codex', 'mcp']);
      ok('connected codex to n8n (first-time setup)');
    }
  } catch {
    bad('could not register the n8n tools with codex');
    fix('run:  n8n-codex setup');
    usable = false;
  }

  console.log('');
  return usable;
}
