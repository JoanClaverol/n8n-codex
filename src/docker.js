import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const TMP = '/tmp/.n8n-codex.json';

export class BridgeError extends Error {}

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
      `If you have not set up n8n yet, run:\n\n` +
      `  docker volume create n8n_data\n` +
      `  docker run -d --name ${container} -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n\n\n` +
      `Then open http://localhost:5678 and try again.`
    );
  }
  if (state !== 'true') {
    throw new BridgeError(`Container "${container}" exists but is stopped. Run:  docker start ${container}`);
  }
}

/** Export one workflow (by id) or all workflows. Returns an array. */
export async function exportWorkflows(container, id) {
  const selector = id ? [`--id=${id}`] : ['--all'];
  await docker(['exec', container, 'n8n', 'export:workflow', ...selector, `--output=${TMP}`]);
  const raw = await docker(['exec', container, 'cat', TMP]);
  return JSON.parse(raw);
}

/** Import (create or update by id) a single workflow object. */
export async function importWorkflow(container, workflow) {
  const payload = JSON.stringify([workflow]);
  await new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', '-i', container, 'sh', '-c', `cat > ${TMP}`], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new BridgeError(err.trim() || `docker exec exited ${code}`))));
    p.stdin.end(payload);
  });
  await docker(['exec', container, 'n8n', 'import:workflow', `--input=${TMP}`]);
}
