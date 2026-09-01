// CLI argument validation: beginners must get one clear line, never a stack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { docsMcpAddArgs, mcpAddArgs, parseArgs } from '../src/cli/args.js';
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

function run(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], (err, stdout, stderr) =>
      resolve({ code: err?.code ?? 0, stdout, stderr }));
  });
}

test('--help exits 0 and lists the options', async () => {
  const r = await run(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--container=<name>/);
});

test('invalid ports are rejected with a clear message', async () => {
  for (const bad of ['--port=abc', '--port=0', '--port=70000', '--port=5.5']) {
    const r = await run([bad, 'list']);
    assert.equal(r.code, 1, `${bad} must exit 1`);
    assert.match(r.stderr, /Invalid --port value/);
    assert.ok(!r.stderr.includes('at '), 'no stack trace for beginners');
  }
});

test('https n8n URLs are rejected up front', async () => {
  const r = await run(['--n8n-url=https://example.com', 'list']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /http:\/\//);
});

test('unknown options are rejected with usage help', async () => {
  const r = await run(['--bogus']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Unknown option: --bogus/);
});

test('an explicit --n8n-url is marked so port discovery never overrides it', () => {
  const auto = parseArgs(['list']);
  assert.equal(auto.cfg.n8nUrlExplicit, false);
  assert.equal(auto.cfg.n8nUrl, 'http://localhost:5678');
  const pinned = parseArgs(['--n8n-url=http://localhost:9999/', 'list']);
  assert.equal(pinned.cfg.n8nUrlExplicit, true);
  assert.equal(pinned.cfg.n8nUrl, 'http://localhost:9999', 'trailing slash stripped');
});

test('MCP registration carries non-default container/url flags', () => {
  const def = parseArgs(['list']);
  assert.deepEqual(mcpAddArgs(def.cfg), ['mcp', 'add', 'n8n', '--', 'n8n-codex', 'mcp'],
    'defaults registered without flags');
  const custom = parseArgs(['--container=my-n8n', '--n8n-url=http://localhost:9999', 'list']);
  assert.deepEqual(mcpAddArgs(custom.cfg), [
    'mcp', 'add', 'n8n', '--', 'n8n-codex', 'mcp', '--container=my-n8n', '--n8n-url=http://localhost:9999',
  ], 'chat tool calls must hit the same n8n the dashboard shows');
});

test('docs MCP registration targets the official GitBook server', () => {
  assert.deepEqual(docsMcpAddArgs(), ['mcp', 'add', 'n8n-docs', '--url', 'https://docs.n8n.io/~gitbook/mcp']);
});
