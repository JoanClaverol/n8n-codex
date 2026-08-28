import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BridgeError, backupDir, ensureContainer, exportWorkflows, importWorkflow, importWorkflowRaw } from './docker.js';
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

/** Find the local session folder for a workflow id (folders are named <slug>-<id>). */
export function findLocal(cfg, id) {
  const base = path.resolve(cfg.dir);
  if (fs.existsSync(base)) {
    const hit = fs.readdirSync(base).find((d) => d.endsWith(`-${id}`));
    if (hit) return path.join(base, hit, 'workflow.json');
  }
  return null;
}

/** Parse + sanity-check a local workflow file. Throws BridgeError with a friendly message. */
function readWorkflowFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new BridgeError(`${file} not found — run "n8n-codex pull <id>" first.`);
  }
  let wf;
  try {
    wf = JSON.parse(raw);
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

/** Undo the last saved change: restore the newest backup and consume it (repeat to go further back). */
export async function restore(cfg, id) {
  const dir = backupDir(id);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  if (!files.length) throw new BridgeError(`No backups for "${id}" yet — backups are taken automatically before every AI change.`);
  const latest = path.join(dir, files[files.length - 1]);
  const wf = JSON.parse(fs.readFileSync(latest, 'utf8'));
  await ensureContainer(cfg.container);
  await importWorkflowRaw(cfg.container, wf);
  fs.unlinkSync(latest);
  return { wf, when: files[files.length - 1].replace('.json', ''), remaining: files.length - 1 };
}

export async function pull(cfg, id) {
  await ensureContainer(cfg.container);
  const [wf] = await exportWorkflows(cfg.container, id);
  if (!wf) throw new BridgeError(`Workflow "${id}" not found in n8n.`);
  const dir = sessionDir(cfg, wf);
  const existing = findLocal(cfg, id);
  if (existing && path.dirname(existing) !== dir) fs.renameSync(path.dirname(existing), dir);
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
 * `log` overrides the output sink (default console.log).
 * Returns { stop, lastPushed, deploy } — lastPushed() gives the mtime of the last successful push.
 */
export function watchFile(cfg, file, log = console.log) {
  let lastPushed = fs.statSync(file).mtimeMs;
  let busy = false;
  let again = false;

  async function deploy(mtime) {
    if (busy) { again = true; return; }
    busy = true;
    try {
      await push(cfg, file);
      lastPushed = mtime;
      log(`${dim(now())} ${ok('✓ deployed to n8n')} ${dim('(refresh the n8n tab)')}`);
    } catch (err) {
      log(`${dim(now())} ${warn('✗ ' + err.message)}`);
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

  const logFile = path.join(dir, 'deploy.log');
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const sink = cfg.codex ? (s) => fs.appendFileSync(logFile, strip(s) + '\n') : console.log;
  const watcher = watchFile(cfg, file, sink);

  if (!cfg.codex) {
    console.log('Watching for changes (Ctrl-C to stop). Edit workflow.json with any editor.');
    await new Promise((resolve) => process.on('SIGINT', resolve));
    watcher.stop();
    return;
  }

  fs.writeFileSync(logFile, `session started ${new Date().toISOString()}\n`);
  console.log(dim(`Launching codex — ask it to modify the workflow. Deploy status: ${path.relative(process.cwd(), logFile)}\n`));
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
