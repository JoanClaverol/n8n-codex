import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Ask the installed Codex CLI for the same picker-visible model catalog used by
 * first-party clients. A short-lived app-server process keeps this tied to the
 * user's current Codex version, configuration, authentication, and access.
 */
export function listModels({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const args = ['app-server'];
    const child = spawn('codex', win ? args.map((arg) => `"${arg}"`) : args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: win,
    });

    let settled = false;
    let initialized = false;
    let pendingListId = null;
    let nextId = 1;
    let stdout = '';
    let stderr = '';
    const models = new Map();

    const stop = () => {
      clearTimeout(timer);
      if (!child.killed) child.kill();
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      stop();
      resolve([...models.values()]);
    };
    const fail = (detail) => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error(`Could not load Codex models: ${detail}`));
    };
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const requestPage = (cursor = null) => {
      pendingListId = nextId++;
      send({
        method: 'model/list',
        id: pendingListId,
        params: { cursor, limit: 100, includeHidden: false },
      });
    };

    const timer = setTimeout(() => fail('request timed out'), timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        if (!line.trim()) continue;

        let message;
        try { message = JSON.parse(line); } catch { continue; }

        if (message.id === 0 && !initialized) {
          if (message.error) {
            fail(message.error.message || 'initialization failed');
            return;
          }
          initialized = true;
          send({ method: 'initialized', params: {} });
          requestPage();
          continue;
        }

        if (message.id !== pendingListId) continue;
        if (message.error) {
          fail(message.error.message || 'model/list failed');
          return;
        }

        const data = message.result?.data;
        if (!Array.isArray(data)) {
          fail('model/list returned an invalid response');
          return;
        }
        for (const entry of data) {
          if (entry?.hidden || typeof entry?.model !== 'string' || !entry.model) continue;
          models.set(entry.model, {
            id: entry.model,
            displayName: typeof entry.displayName === 'string' && entry.displayName
              ? entry.displayName
              : entry.model,
            description: typeof entry.description === 'string' ? entry.description : '',
            isDefault: entry.isDefault === true,
          });
        }

        if (message.result.nextCursor) requestPage(message.result.nextCursor);
        else succeed();
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.stdin.on('error', (err) => {
      if (!settled) fail(err.message);
    });
    child.on('error', (err) => {
      fail(err.code === 'ENOENT'
        ? 'codex not found on PATH'
        : `codex failed to start: ${err.message}`);
    });
    child.on('close', (code) => {
      if (!settled) fail(stderr.trim() || `codex app-server exited with code ${code}`);
    });

    send({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: { name: 'n8n_codex', title: 'n8n-codex', version: '0.1.0' },
      },
    });
  });
}
