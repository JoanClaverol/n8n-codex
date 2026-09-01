// MCP server contract — the surface real codex chats actually use.
// Hermetic: JSON-RPC 2.0 framing over stdio (initialize, ping, tools/list,
// notifications, garbage lines, unknown methods). Docker-gated: the three
// tools against a throwaway n8n container, including the "invalid workflow
// is never saved" guarantee for the AI path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasDocker, seedWorkflow, startThrowawayN8n, testWorkflowId } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');

const docker = await hasDocker();

/** Spawn `n8n-codex mcp` and speak line-delimited JSON-RPC to it. */
function startMcp(t, extraArgs = []) {
  const p = spawn(process.execPath, [cliPath, 'mcp', ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => p.kill());
  const waiters = new Map(); // request id -> resolve(reply)
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
      waiters.delete(msg.id);
    }
  });
  let nextId = 1;
  return {
    writeRaw: (line) => p.stdin.write(line + '\n'),
    request(method, params) {
      const id = nextId++;
      const reply = new Promise((resolve, reject) => {
        waiters.set(id, resolve);
        setTimeout(() => reject(new Error(`no reply to ${method} (id ${id}) within 30s`)), 30_000).unref();
      });
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return reply;
    },
  };
}

test('mcp: JSON-RPC framing over stdio', async (t) => {
  const mcp = startMcp(t);

  // garbage and id-less notifications are ignored without breaking the stream
  mcp.writeRaw('not json at all');
  mcp.writeRaw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));

  const init = await mcp.request('initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.result.protocolVersion, '2024-11-05', 'a supported client version is accepted as-is');
  assert.equal(init.result.serverInfo.name, 'n8n-codex');
  assert.deepEqual(init.result.capabilities, { tools: {} });

  // Unknown (e.g. future) client versions must not be echoed back — the spec
  // says answer with the latest version the server actually implements.
  const future = await mcp.request('initialize', { protocolVersion: '2099-01-01' });
  assert.equal(future.result.protocolVersion, '2025-06-18', 'never claims an unsupported protocol version');

  assert.deepEqual((await mcp.request('ping')).result, {});

  const { tools } = (await mcp.request('tools/list')).result;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['get_workflow', 'list_workflows', 'update_workflow']);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} has an object schema`);
    assert.ok(tool.description, `${tool.name} has a description`);
  }

  const missing = await mcp.request('no/such-method');
  assert.equal(missing.error.code, -32601);
});

test('mcp: tool calls against throwaway n8n', { skip: !docker && 'no linux docker daemon' }, async (t) => {
  const { backupDir } = await import('../src/docker.js');
  const id = testWorkflowId();
  const container = await startThrowawayN8n(t, seedWorkflow(id, 'mcp self-test'));
  t.after(() => fs.rmSync(backupDir(id), { recursive: true, force: true }));
  const mcp = startMcp(t, [`--container=${container}`]);
  const call = async (name, args) => {
    const { result } = await mcp.request('tools/call', { name, arguments: args });
    return { isError: result.isError === true, body: result.content[0].text };
  };

  const listed = JSON.parse((await call('list_workflows')).body);
  assert.ok(listed.some((w) => w.id === id && w.name === 'mcp self-test'), 'seed workflow listed');

  const wf = JSON.parse((await call('get_workflow', { id })).body);
  assert.equal(wf.name, 'mcp self-test');
  assert.ok(Array.isArray(wf.nodes), 'full workflow JSON returned');

  // update round-trip, with the pre-save backup snapshot
  wf.name = 'renamed via mcp';
  const saved = await call('update_workflow', { workflow: wf });
  assert.equal(saved.isError, false, saved.body);
  assert.equal(JSON.parse((await call('get_workflow', { id })).body).name, 'renamed via mcp');
  const backups = fs.readdirSync(backupDir(id)).filter((f) => f.endsWith('.json'));
  assert.equal(backups.length, 1, 'previous state snapshotted before the save');

  // invalid shapes are rejected with a friendly error and nothing is saved
  const badShape = await call('update_workflow', { workflow: { id, name: 'clobbered' } });
  assert.equal(badShape.isError, true);
  assert.match(badShape.body, /Nothing was saved/);
  const notObject = await call('update_workflow', { workflow: 'nope' });
  assert.equal(notObject.isError, true);
  assert.equal(JSON.parse((await call('get_workflow', { id })).body).name, 'renamed via mcp', 'invalid updates saved nothing');

  const missing = await call('get_workflow', { id: 'does-not-exist' });
  assert.equal(missing.isError, true);
  assert.match(missing.body, /not found/);

  const unknown = await call('nonexistent_tool', {});
  assert.equal(unknown.isError, true);
  assert.match(unknown.body, /Unknown tool/);
});
