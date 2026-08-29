/**
 * Parse CLI argv (already sliced past node + script). Pure — no printing,
 * no exiting. Returns one of:
 *   { help: true }                       — user asked for help
 *   { error, usage? }                    — bad input; usage: true appends HELP
 *   { cfg, cmd, arg }                    — ready to dispatch
 */
export function parseArgs(argv) {
  const cfg = {
    container: 'n8n',
    n8nUrl: 'http://localhost:5678',
    dir: './n8n-workflows',
    port: 5680,
    codex: true,
    open: true,
  };

  const rest = [];
  for (const a of argv) {
    if (a === '--no-codex') cfg.codex = false;
    else if (a === '--no-open') cfg.open = false;
    else if (a.startsWith('--container=')) cfg.container = a.slice('--container='.length);
    else if (a.startsWith('--n8n-url=')) cfg.n8nUrl = a.slice('--n8n-url='.length).replace(/\/$/, '');
    else if (a.startsWith('--dir=')) cfg.dir = a.slice('--dir='.length);
    else if (a.startsWith('--port=')) {
      cfg.port = Number(a.slice('--port='.length));
      if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
        return { error: `Invalid --port value: ${a.slice('--port='.length)} (use a number between 1 and 65535)` };
      }
    }
    else if (a === '-h' || a === '--help') return { help: true };
    else if (a.startsWith('-')) return { error: `Unknown option: ${a}`, usage: true };
    else rest.push(a);
  }

  if (!cfg.n8nUrl.startsWith('http://')) {
    return { error: '--n8n-url must start with http:// — the dashboard proxy does not support https URLs.' };
  }

  const [cmd, arg] = rest;
  return { cfg, cmd, arg };
}
