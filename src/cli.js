import path from 'node:path';
import { findLocal, list, pull, push, restore, session } from './bridge.js';
import { serve } from './server.js';
import { BridgeError } from './error.js';
import { HELP } from './cli/help.js';
import { mcpAddArgs, parseArgs } from './cli/args.js';

function requireId(id, usage) {
  if (!id) { console.error(`Usage: n8n-codex ${usage}`); process.exit(1); }
  return id;
}

/** Dispatch one CLI invocation. Returns the process exit code. */
export async function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) { console.log(HELP); return 0; }
  if (parsed.error) {
    console.error(parsed.usage ? `${parsed.error}\n\n${HELP}` : parsed.error);
    return 1;
  }
  const { cfg, cmd, arg } = parsed;

  try {
    switch (cmd) {
      case undefined: {
        const { preflight } = await import('./preflight.js');
        if (!(await preflight(cfg))) return 1;
        serve(cfg);
        return 0;
      }

      case 'mcp': {
        const { serveMcp } = await import('./mcp.js');
        serveMcp(cfg);
        return 0;
      }

      case 'setup': {
        const { execFileSync } = await import('node:child_process');
        execFileSync('codex', mcpAddArgs(cfg), {
          stdio: 'inherit',
          shell: process.platform === 'win32',
        });
        console.log('Registered MCP server "n8n" with codex. Try:  codex  →  "list my n8n workflows"');
        return 0;
      }

      case 'list': {
        const rows = await list(cfg);
        if (!rows.length) { console.log('No workflows in n8n yet.'); return 0; }
        const w = Math.max(...rows.map((r) => r.id.length));
        for (const r of rows) {
          console.log(`${r.id.padEnd(w)}  ${r.active ? 'active  ' : 'inactive'}  ${String(r.nodes).padStart(2)} nodes  ${r.name}`);
        }
        return 0;
      }

      case 'pull': {
        const { file } = await pull(cfg, requireId(arg, 'pull <workflow-id>'));
        console.log(`pulled -> ${path.relative(process.cwd(), file)}`);
        return 0;
      }

      case 'push': {
        const id = requireId(arg, 'push <workflow-id>');
        const file = findLocal(cfg, id);
        if (!file) throw new BridgeError(`No local copy of "${id}" in ${cfg.dir} — run: n8n-codex pull ${id}`);
        const pushed = await push(cfg, file);
        console.log(`deployed "${pushed.name}" — refresh the n8n tab.`);
        return 0;
      }

      case 'restore': {
        const id = requireId(arg, 'restore <workflow-id>');
        const { wf, when, remaining } = await restore(cfg, id);
        console.log(`Restored "${wf.name}" to its state from ${when} — refresh the n8n tab.`);
        console.log(remaining ? `${remaining} older backup(s) remain; run again to go further back.` : 'No older backups remain.');
        return 0;
      }

      case 'watch': {
        const id = requireId(arg, 'watch <workflow-id>');
        await session({ ...cfg, codex: false }, id);
        return 0;
      }

      default:
        // anything else is treated as a workflow id → full codex session
        return (await session(cfg, cmd)) || 0;
    }
  } catch (err) {
    console.error(err instanceof BridgeError ? `\x1b[31m${err.message}\x1b[0m` : err);
    return 1;
  }
}
