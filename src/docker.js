import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
let seq = 0;
const tmpName = () => `/tmp/.n8n-codex-${process.pid}-${++seq}.json`;

export class BridgeError extends Error {}

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
    const files = fs.readdirSync(dir).sort();
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
    throw new BridgeError((err.stderr || err.message || '').trim());
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

/** Export one workflow (by id) or all workflows. Returns an array. */
export async function exportWorkflows(container, id) {
  const tmp = tmpName();
  const selector = id ? [`--id=${id}`] : ['--all'];
  try {
    await docker(['exec', container, 'n8n', 'export:workflow', ...selector, `--output=${tmp}`]);
    const raw = await docker(['exec', container, 'cat', tmp]);
    return JSON.parse(raw);
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
