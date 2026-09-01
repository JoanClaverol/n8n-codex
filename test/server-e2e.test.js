// Full dashboard flow against a real (throwaway) n8n container and the fake
// codex: list workflows, run a chat turn end-to-end, and verify the busy
// lock protects the workflow from concurrent writers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasDocker, installFakeCodex, seedWorkflow, startThrowawayN8n, startDashboard, testWorkflowId } from './helpers.js';

const docker = await hasDocker();

test('dashboard end-to-end: list, activate, chat, busy lock', { skip: !docker && 'no linux docker daemon' }, async (t) => {
  const id = testWorkflowId();
  const container = await startThrowawayN8n(t, seedWorkflow(id, 'e2e self-test'));
  const fake = installFakeCodex(t);
  const { url } = await startDashboard(t, { container });

  // list
  const rows = await (await fetch(url + '/api/workflows')).json();
  const row = rows.find((w) => w.id === id);
  assert.deepEqual(row, { id, name: 'e2e self-test', active: false, nodes: 1 });

  // activate/deactivate round-trips through the n8n CLI and survives a re-list
  const flip = (wfId, active) => fetch(`${url}/api/workflows/${wfId}/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ active }),
  });
  const on = await flip(id, true);
  assert.equal(on.status, 200);
  assert.deepEqual(await on.json(), { id, name: 'e2e self-test', active: true, nodes: 1 });
  const relisted = await (await fetch(url + '/api/workflows')).json();
  assert.equal(relisted.find((w) => w.id === id).active, true, 'active flag persisted in n8n');
  const off = await flip(id, false);
  assert.equal((await off.json()).active, false);

  // guard rails: no JSON content type, missing flag, unknown workflow
  const plain = await fetch(`${url}/api/workflows/${id}/activate`, { method: 'POST', body: '{"active":true}' });
  assert.equal(plain.status, 403, 'non-JSON POSTs are rejected');
  const noFlag = await fetch(`${url}/api/workflows/${id}/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(noFlag.status, 400);
  assert.equal((await flip(testWorkflowId(), true)).status, 404);

  // models are discovered from the installed Codex CLI for this dashboard session
  const catalog = await (await fetch(url + '/api/models')).json();
  assert.deepEqual(catalog.models.map((model) => model.id), ['model-default', 'model-fast']);

  // one chat turn: message reaches codex stdin, reply streams back as ndjson
  const chat = async (message, model = null) => {
    const res = await fetch(`${url}/api/chat/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(model ? { message, model } : { message }),
    });
    assert.equal(res.status, 200, `chat API: ${res.status} ${await res.clone?.().text?.() ?? ''}`);
    return (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  };
  const events = await chat('rename the trigger & add a joke node', 'model-fast');
  const reply = events.find((e) => e.kind === 'reply');
  assert.ok(reply?.text.includes('rename the trigger & add a joke node'), 'message round-tripped');
  const firstExec = fake.calls().find((call) => call.argv[0] === 'exec');
  const chatCwd = firstExec.argv[firstExec.argv.indexOf('--cd') + 1];
  const md = fs.readFileSync(path.join(chatCwd, 'AGENTS.md'), 'utf8');
  assert.ok(md.includes(`workflow id "${id}"`), 'instructions scoped to this workflow');
  assert.deepEqual(firstExec.argv.slice(-3), ['--model', 'model-fast', '-']);

  // busy lock: while codex runs, student saves are 423 and a second chat errors.
  // The chat route lists workflows (a slow docker exec) before spawning codex,
  // so poll for the lock instead of sleeping a fixed time.
  process.env.FAKE_CODEX_DELAY_MS = '8000';
  t.after(() => delete process.env.FAKE_CODEX_DELAY_MS);
  const slow = fetch(`${url}/api/chat/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'slow turn' }),
  });
  let save;
  for (let i = 0; i < 50; i++) {
    save = await fetch(`${url}/rest/workflows/${id}`, { method: 'PATCH' });
    if (save.status === 423) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(save.status, 423, 'editor saves are locked while the AI works');
  const busyFlip = await flip(id, true);
  assert.equal(busyFlip.status, 423, 'activation is locked while the AI works');
  delete process.env.FAKE_CODEX_DELAY_MS;
  const second = await chat('impatient message');
  assert.ok(second.some((e) => e.kind === 'error' && /Still working/.test(e.text)));
  await (await slow).text(); // first turn still completes
});
