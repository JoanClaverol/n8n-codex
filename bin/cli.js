#!/usr/bin/env node
import { list, pull, push, session, sessionDir, watchFile } from '../src/bridge.js';
import { serve } from '../src/server.js';
import { BridgeError } from '../src/docker.js';
import path from 'node:path';

const HELP = `n8n-codex — edit n8n workflows with the Codex CLI

Usage:
  n8n-codex                    open the dashboard (pick a workflow visually)
  n8n-codex <workflow-id>      pull workflow, launch codex, auto-deploy on save
  n8n-codex list               list workflows in your n8n
  n8n-codex pull <id>          just download workflow.json (+ AGENTS.md)
  n8n-codex push <id>          deploy your local workflow.json
  n8n-codex watch <id>         auto-deploy on save, without launching codex

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
  else if (a.startsWith('--port=')) cfg.port = Number(a.slice('--port='.length));
  else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a.startsWith('-')) { console.error(`Unknown option: ${a}\n\n${HELP}`); process.exit(1); }
  else rest.push(a);
}

const [cmd, arg] = rest;

function requireId(id, usage) {
  if (!id) { console.error(`Usage: n8n-codex ${usage}`); process.exit(1); }
  return id;
}

try {
  switch (cmd) {
    case undefined:
      serve(cfg);
      break;

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
      const { wf, file } = await locate(id);
      await push(cfg, file);
      console.log(`deployed "${wf.name}" — refresh the n8n tab.`);
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

/** Find the local session folder for an id (matches the pull naming scheme). */
async function locate(id) {
  const { exportWorkflows, ensureContainer } = await import('../src/docker.js');
  await ensureContainer(cfg.container);
  const [wf] = await exportWorkflows(cfg.container, id);
  if (!wf) throw new BridgeError(`Workflow "${id}" not found in n8n.`);
  return { wf, file: path.join(sessionDir(cfg, wf), 'workflow.json') };
}
