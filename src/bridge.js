import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BridgeError, ensureContainer, exportWorkflows, importWorkflow } from './docker.js';
import { agentsMd } from './agents-md.js';

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const now = () => new Date().toLocaleTimeString();

function slug(name) {
  return (
    String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workflow'
  );
}

export function sessionDir(cfg, wf) {
  return path.resolve(cfg.dir, `${slug(wf.name)}-${wf.id}`);
}

/** Parse + sanity-check a local workflow file. Throws BridgeError with a friendly message. */
function readWorkflowFile(file) {
  let wf;
  try {
    wf = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new BridgeError(`workflow.json is not valid JSON (${err.message}) — nothing was deployed.`);
  }
  if (!Array.isArray(wf.nodes) || typeof wf.connections !== 'object' || wf.connections === null) {
    throw new BridgeError('workflow.json is missing "nodes" or "connections" — nothing was deployed.');
  }
  return wf;
}

export async function list(cfg) {
  await ensureContainer(cfg.container);
  const all = await exportWorkflows(cfg.container);
  return all.map((w) => ({
    id: w.id,
    name: w.name,
    active: w.active === true,
    nodes: Array.isArray(w.nodes) ? w.nodes.length : 0,
  }));
}

export async function pull(cfg, id) {
  await ensureContainer(cfg.container);
  const [wf] = await exportWorkflows(cfg.container, id);
  if (!wf) throw new BridgeError(`Workflow "${id}" not found in n8n.`);
  const dir = sessionDir(cfg, wf);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'workflow.json');
  fs.writeFileSync(file, JSON.stringify(wf, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), agentsMd(wf));
  return { wf, dir, file };
}

export async function push(cfg, file) {
  await ensureContainer(cfg.container);
  const wf = readWorkflowFile(file);
  await importWorkflow(cfg.container, wf);
  return wf;
}

/**
 * Watch a workflow file; deploy on every change.
 * Returns { stop, lastPushed } — lastPushed() gives the mtime of the last successful push.
 */
export function watchFile(cfg, file) {
  let lastPushed = fs.statSync(file).mtimeMs;
  let busy = false;
  let again = false;

  async function deploy(mtime) {
    if (busy) { again = true; return; }
    busy = true;
    try {
      await push(cfg, file);
      lastPushed = mtime;
      console.log(`${dim(now())} ${ok('✓ deployed to n8n')} ${dim('(refresh the n8n tab)')}`);
    } catch (err) {
      console.log(`${dim(now())} ${warn('✗ ' + err.message)}`);
    } finally {
      busy = false;
      if (again) { again = false; deploy(fs.statSync(file).mtimeMs); }
    }
  }

  fs.watchFile(file, { interval: 700 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs) deploy(cur.mtimeMs);
  });

  return {
    stop: () => fs.unwatchFile(file),
    lastPushed: () => lastPushed,
    deploy,
  };
}

/** Pull → watch → launch codex → final sync on exit. The main student command. */
export async function session(cfg, id) {
  const { wf, dir, file } = await pull(cfg, id);
  console.log(`Workflow ${ok(`"${wf.name}"`)} pulled to ${dim(path.relative(process.cwd(), file) || file)}`);
  console.log(`Saves to workflow.json deploy to n8n automatically — refresh ${dim(cfg.n8nUrl + '/workflow/' + wf.id)} to see them.\n`);

  const watcher = watchFile(cfg, file);

  if (!cfg.codex) {
    console.log('Watching for changes (Ctrl-C to stop). Edit workflow.json with any editor.');
    await new Promise((resolve) => process.on('SIGINT', resolve));
    watcher.stop();
    return;
  }

  console.log(dim('Launching codex — ask it to modify the workflow. Exit codex to end the session.\n'));
  const code = await new Promise((resolve) => {
    const p = spawn('codex', [], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    p.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.log(warn('codex not found on PATH.') + ' Staying in watch mode instead (Ctrl-C to stop).');
        process.on('SIGINT', () => resolve(0));
      } else {
        console.log(warn(`codex failed to start: ${err.message}`));
        resolve(1);
      }
    });
    p.on('close', resolve);
  });

  // Catch a save that landed after the watcher's last poll.
  const finalMtime = fs.statSync(file).mtimeMs;
  if (finalMtime > watcher.lastPushed()) await watcher.deploy(finalMtime);
  watcher.stop();
  console.log(`\nSession ended. Your workflow: ${cfg.n8nUrl}/workflow/${wf.id}`);
  return code;
}
