import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeError } from './error.js';

const exec = promisify(execFile);
let seq = 0;
const tmpName = () => `/tmp/.n8n-codex-${process.pid}-${++seq}.json`;

export const backupDir = (id) => path.join(os.homedir(), '.n8n-codex', 'backups', id);

/** Best-effort snapshot of a workflow's current state before it is overwritten. */
async function backupBefore(container, id) {
  if (!id) return;
  try {
    const [current] = await exportWorkflows(container, id);
    if (!current) return;
    const dir = backupDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(current, null, 2));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, -30)) fs.unlinkSync(path.join(dir, f)); // keep newest 30
  } catch {
    /* backups never block a save */
  }
}

async function docker(args) {
  try {
    const { stdout } = await exec('docker', args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new BridgeError('Docker CLI not found. Install Docker Desktop, start it, and try again.');
    }
    // the n8n CLI logs its error text to stdout, not stderr — keep both
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    throw new BridgeError(detail || (err.message || '').trim());
  }
}

export async function ensureContainer(container) {
  let state;
  try {
    state = (await docker(['inspect', '-f', '{{.State.Running}}', container])).trim();
  } catch {
    throw new BridgeError(
      `No Docker container named "${container}" found.\n\n` +
      `If you have not set up n8n yet, run this from the n8n-codex folder:\n\n` +
      `  docker compose up -d\n\n` +
      `Then open http://localhost:5678 and try again.`
    );
  }
  if (state !== 'true') {
    throw new BridgeError(`Container "${container}" exists but is stopped. Run:  docker start ${container}`);
  }
}

/** Host port the container publishes for n8n's internal 5678, or null if unknown. */
export async function publishedPort(container) {
  try {
    const out = (await docker(['inspect', '-f',
      '{{(index (index .NetworkSettings.Ports "5678/tcp") 0).HostPort}}', container])).trim();
    return /^\d+$/.test(out) ? Number(out) : null;
  } catch {
    return null; // container missing, docker down, or no published port
  }
}

/**
 * Adopt the container's actual published port unless the user pinned --n8n-url.
 * Best-effort: on any failure cfg keeps its default. Returns true if cfg changed.
 */
export async function resolveN8nUrl(cfg) {
  if (cfg.n8nUrlExplicit) return false;
  const port = await publishedPort(cfg.container);
  if (!port || cfg.n8nUrl === `http://localhost:${port}`) return false;
  cfg.n8nUrl = `http://localhost:${port}`;
  return true;
}

/** Export one workflow (by id) or all workflows. Returns an array. */
export async function exportWorkflows(container, id) {
  const tmp = tmpName();
  const selector = id ? [`--id=${id}`] : ['--all'];
  try {
    await docker(['exec', container, 'n8n', 'export:workflow', ...selector, `--output=${tmp}`]);
    const raw = await docker(['exec', container, 'cat', tmp]);
    return JSON.parse(raw);
  } catch (err) {
    // fresh install (--id miss or zero workflows): not an error, just empty
    if (err instanceof BridgeError && /No workflows found/i.test(err.message)) return [];
    throw err;
  } finally {
    docker(['exec', container, 'rm', '-f', tmp]).catch(() => {});
  }
}

/** Import (create or update by id) a single workflow object, snapshotting the previous state. */
export async function importWorkflow(container, workflow) {
  await backupBefore(container, workflow.id);
  return importWorkflowRaw(container, workflow);
}

/** Import without taking a backup — used by restore, which consumes backups instead. */
export async function importWorkflowRaw(container, workflow) {
  const tmp = tmpName();
  const payload = JSON.stringify([workflow]);
  try {
    await new Promise((resolve, reject) => {
      const p = spawn('docker', ['exec', '-i', container, 'sh', '-c', `cat > ${tmp}`], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let err = '';
      p.stderr.on('data', (d) => (err += d));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new BridgeError(err.trim() || `docker exec exited ${code}`))));
      p.stdin.end(payload);
    });
    await docker(['exec', container, 'n8n', 'import:workflow', `--input=${tmp}`]);
  } finally {
    docker(['exec', container, 'rm', '-f', tmp]).catch(() => {});
  }
}
