import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveN8nUrl } from './docker.js';
import { mcpAddArgs, mcpNeedsFlags } from './cli/args.js';

const exec = promisify(execFile);
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const bad = (s) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
const fix = (s) => console.log(`    \x1b[33m→ ${s}\x1b[0m`);

async function run(cmd, args, opts = {}) {
  const { stdout } = await exec(cmd, args, { maxBuffer: 8 * 1024 * 1024, ...opts });
  return stdout;
}

// npm installs codex as a .cmd shim on Windows; execFile refuses those
// without a shell (CVE-2024-27980 hardening). All args here are literals.
const codexOpts = { shell: process.platform === 'win32' };

/** Launch `codex --version` the same way preflight does (shell for the
 *  Windows .cmd shim). Exported so tests can exercise the platform quirk. */
export async function codexVersion() {
  return run('codex', ['--version'], codexOpts);
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
      if (await resolveN8nUrl(cfg)) ok(`n8n is running on ${cfg.n8nUrl} (adopted from the container)`);
      else ok('n8n is running');
    } else {
      console.log(`  … n8n container is stopped — starting it for you`);
      await run('docker', ['start', cfg.container]);
      await resolveN8nUrl(cfg);
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
      fix('is Docker Desktop running? Then install n8n with:  docker compose up -d  (from the n8n-codex folder)');
    }
    return false;
  }

  // 2. codex CLI
  try {
    await codexVersion();
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

  // 4. MCP registration (auto-fix). Non-default --container/--n8n-url must be
  // baked into the registered command — the MCP process codex spawns gets no
  // other way to learn them — so re-register whenever such flags are in play.
  try {
    const listed = await run('codex', ['mcp', 'list'], codexOpts);
    const registered = /^n8n\s/m.test(listed);
    if (registered && !mcpNeedsFlags(cfg)) {
      ok('codex can talk to n8n');
    } else {
      if (registered) await run('codex', ['mcp', 'remove', 'n8n'], codexOpts).catch(() => {});
      await run('codex', mcpAddArgs(cfg), codexOpts);
      ok(registered ? 'pointed codex at this n8n (updated for your flags)' : 'connected codex to n8n (first-time setup)');
    }
  } catch {
    bad('could not register the n8n tools with codex');
    fix('run:  n8n-codex setup');
    usable = false;
  }

  console.log('');
  return usable;
}
