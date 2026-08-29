#!/usr/bin/env node
import { findLocal, list, pull, push, restore, session } from '../src/bridge.js';
import { serve } from '../src/server.js';
import { BridgeError } from '../src/error.js';
import path from 'node:path';

const HELP = `n8n-codex — edit n8n workflows with the Codex CLI

Usage:
  n8n-codex                    open the dashboard (pick a workflow visually)
  n8n-codex <workflow-id>      pull workflow, launch codex, auto-deploy on save
  n8n-codex list               list workflows in your n8n
  n8n-codex pull <id>          just download workflow.json (+ AGENTS.md)
  n8n-codex push <id>          deploy your local workflow.json
  n8n-codex watch <id>         auto-deploy on save, without launching codex
  n8n-codex restore <id>       undo the AI's last saved change (repeat to go further back)
  n8n-codex setup              register the n8n MCP server with codex (run once)
  n8n-codex mcp                run the MCP server (codex launches this itself)

Options:
  --container=<name>   n8n Docker container name        (default: n8n)
  --n8n-url=<url>      n8n editor URL                   (default: http://localhost:5678)
  --dir=<path>         where workflow folders are kept  (default: ./n8n-workflows)
  --port=<n>           dashboard port                   (default: 5680)
  --no-codex           watch only; don't launch codex
  --no-open            don't auto-open the dashboard in a browser
`;

const cfg = {
  container: 'n8n',
  n8nUrl: 'http://localhost:5678',
  dir: './n8n-workflows',
  port: 5680,
  codex: true,
  open: true,
};

const rest = [];
for (const a of process.argv.slice(2)) {
  if (a === '--no-codex') cfg.codex = false;
  else if (a === '--no-open') cfg.open = false;
  else if (a.startsWith('--container=')) cfg.container = a.slice('--container='.length);
  else if (a.startsWith('--n8n-url=')) cfg.n8nUrl = a.slice('--n8n-url='.length).replace(/\/$/, '');
  else if (a.startsWith('--dir=')) cfg.dir = a.slice('--dir='.length);
  else if (a.startsWith('--port=')) {
    cfg.port = Number(a.slice('--port='.length));
    if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
      console.error(`Invalid --port value: ${a.slice('--port='.length)} (use a number between 1 and 65535)`);
      process.exit(1);
    }
  }
  else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a.startsWith('-')) { console.error(`Unknown option: ${a}\n\n${HELP}`); process.exit(1); }
  else rest.push(a);
}

if (!cfg.n8nUrl.startsWith('http://')) {
  console.error('--n8n-url must start with http:// — the dashboard proxy does not support https URLs.');
  process.exit(1);
}

const [cmd, arg] = rest;

function requireId(id, usage) {
  if (!id) { console.error(`Usage: n8n-codex ${usage}`); process.exit(1); }
  return id;
}

try {
  switch (cmd) {
    case undefined: {
      const { preflight } = await import('../src/preflight.js');
      if (!(await preflight(cfg))) process.exit(1);
      serve(cfg);
      break;
    }

    case 'mcp': {
      const { serveMcp } = await import('../src/mcp.js');
      serveMcp(cfg);
      break;
    }

    case 'setup': {
      const { execFileSync } = await import('node:child_process');
      execFileSync('codex', ['mcp', 'add', 'n8n', '--', 'n8n-codex', 'mcp'], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      console.log('Registered MCP server "n8n" with codex. Try:  codex  →  "list my n8n workflows"');
      break;
    }

    case 'list': {
      const rows = await list(cfg);
      if (!rows.length) { console.log('No workflows in n8n yet.'); break; }
      const w = Math.max(...rows.map((r) => r.id.length));
      for (const r of rows) {
        console.log(`${r.id.padEnd(w)}  ${r.active ? 'active  ' : 'inactive'}  ${String(r.nodes).padStart(2)} nodes  ${r.name}`);
      }
      break;
    }

    case 'pull': {
      const { file } = await pull(cfg, requireId(arg, 'pull <workflow-id>'));
      console.log(`pulled -> ${path.relative(process.cwd(), file)}`);
      break;
    }

    case 'push': {
      const id = requireId(arg, 'push <workflow-id>');
      const file = findLocal(cfg, id);
      if (!file) throw new BridgeError(`No local copy of "${id}" in ${cfg.dir} — run: n8n-codex pull ${id}`);
      const pushed = await push(cfg, file);
      console.log(`deployed "${pushed.name}" — refresh the n8n tab.`);
      break;
    }

    case 'restore': {
      const id = requireId(arg, 'restore <workflow-id>');
      const { wf, when, remaining } = await restore(cfg, id);
      console.log(`Restored "${wf.name}" to its state from ${when} — refresh the n8n tab.`);
      console.log(remaining ? `${remaining} older backup(s) remain; run again to go further back.` : 'No older backups remain.');
      break;
    }

    case 'watch': {
      const id = requireId(arg, 'watch <workflow-id>');
      await session({ ...cfg, codex: false }, id);
      break;
    }

    default:
      // anything else is treated as a workflow id → full codex session
      process.exitCode = (await session(cfg, cmd)) || 0;
  }
} catch (err) {
  console.error(err instanceof BridgeError ? `\x1b[31m${err.message}\x1b[0m` : err);
  process.exit(1);
}

