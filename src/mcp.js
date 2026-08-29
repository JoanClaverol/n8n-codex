import readline from 'node:readline';
import { ensureContainer, exportWorkflows, importWorkflow } from './docker.js';
import { BridgeError } from './error.js';

const TOOLS = [
  {
    name: 'list_workflows',
    description: 'List all workflows in the local n8n instance (id, name, active, node count).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_workflow',
    description: 'Get the full JSON of one n8n workflow by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'workflow id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_workflow',
    description:
      'Create or update an n8n workflow. Pass the COMPLETE workflow JSON (partial updates are not merged). ' +
      'Keep the existing top-level "id" to update a workflow. Requirements: "nodes" is an array of ' +
      '{ id, name, type, typeVersion, position, parameters }; "connections" is keyed by node NAME ' +
      '(shape: { "<source name>": { "main": [[ { "node": "<target name>", "type": "main", "index": 0 } ]] } }); ' +
      'every node keeps a stable unique id (UUID for new nodes) and a unique name. ' +
      'After updating, the user must refresh their n8n browser tab to see the change.',
    inputSchema: {
      type: 'object',
      properties: { workflow: { type: 'object', description: 'complete workflow JSON object' } },
      required: ['workflow'],
      additionalProperties: false,
    },
  },
];

async function callTool(cfg, name, args) {
  await ensureContainer(cfg.container);
  switch (name) {
    case 'list_workflows': {
      const all = await exportWorkflows(cfg.container);
      return all.map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active === true,
        nodes: Array.isArray(w.nodes) ? w.nodes.length : 0,
      }));
    }
    case 'get_workflow': {
      const [wf] = await exportWorkflows(cfg.container, args.id);
      if (!wf) throw new BridgeError(`Workflow "${args.id}" not found.`);
      return wf;
    }
    case 'update_workflow': {
      const wf = args.workflow;
      if (!wf || typeof wf !== 'object') throw new BridgeError('"workflow" must be the workflow JSON object.');
      if (!Array.isArray(wf.nodes) || typeof wf.connections !== 'object' || wf.connections === null) {
        throw new BridgeError('Workflow must contain "nodes" (array) and "connections" (object). Nothing was saved.');
      }
      await importWorkflow(cfg.container, wf);
      return {
        ok: true,
        id: wf.id,
        name: wf.name,
        note: `Saved to n8n. Tell the user to refresh ${cfg.n8nUrl}/workflow/${wf.id ?? ''} to see it.`,
      };
    }
    default:
      throw new BridgeError(`Unknown tool: ${name}`);
  }
}

/** Minimal MCP server over stdio (JSON-RPC 2.0, one message per line). */
export function serveMcp(cfg) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const reply = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return; // not JSON — ignore
    }
    if (req.id === undefined) return; // notification

    const respond = (result) => reply({ jsonrpc: '2.0', id: req.id, result });
    const fail = (code, message) => reply({ jsonrpc: '2.0', id: req.id, error: { code, message } });

    try {
      switch (req.method) {
        case 'initialize':
          respond({
            protocolVersion: req.params?.protocolVersion || '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'n8n-codex', version: '0.1.0' },
          });
          break;
        case 'ping':
          respond({});
          break;
        case 'tools/list':
          respond({ tools: TOOLS });
          break;
        case 'tools/call': {
          const { name, arguments: args = {} } = req.params ?? {};
          try {
            const result = await callTool(cfg, name, args);
            respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
          } catch (err) {
            respond({ content: [{ type: 'text', text: String(err.message) }], isError: true });
          }
          break;
        }
        default:
          fail(-32601, `Method not found: ${req.method}`);
      }
    } catch (err) {
      fail(-32603, String(err?.message ?? err));
    }
  });
}
