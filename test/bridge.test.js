// Docker bridge round-trip against a throwaway n8n container (random loopback
// port, no volume — never touches a student install): pull → edit → push (with
// auto backup) → restore, plus the invalid-input guard rails and n8n-url
// discovery from the container's published port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasDocker, seedWorkflow, startThrowawayN8n, testWorkflowId } from './helpers.js';

const docker = await hasDocker();

test('pull → push → restore round-trip', { skip: !docker && 'no linux docker daemon' }, async (t) => {
  const { pull, push, restore } = await import('../src/bridge.js');
  const { backupDir, exportWorkflows, publishedPort, resolveN8nUrl } = await import('../src/docker.js');

  const id = testWorkflowId();
  const seed = seedWorkflow(id, 'bridge self-test');
  const container = await startThrowawayN8n(t, seed);
  const cfg = { container, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-')) };
  t.after(() => fs.rmSync(cfg.dir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(backupDir(id), { recursive: true, force: true }));

  // n8n-url discovery: the container's real published port wins over the
  // course-convention default, but never overrides an explicit --n8n-url
  const port = await publishedPort(container);
  assert.ok(Number.isInteger(port) && port > 0, 'published host port discovered');
  const auto = { container, n8nUrl: 'http://localhost:5678' };
  assert.equal(await resolveN8nUrl(auto), true);
  assert.equal(auto.n8nUrl, `http://localhost:${port}`);
  const pinned = { container, n8nUrl: 'http://localhost:9999', n8nUrlExplicit: true };
  assert.equal(await resolveN8nUrl(pinned), false);
  assert.equal(pinned.n8nUrl, 'http://localhost:9999', 'explicit URL untouched');
  assert.equal(await publishedPort('no-such-container-xyz'), null);

  // pull
  const { wf, file } = await pull(cfg, id);
  assert.equal(wf.name, 'bridge self-test');
  assert.ok(fs.existsSync(path.join(path.dirname(file), 'AGENTS.md')), 'AGENTS.md written for codex');
  await assert.rejects(pull(cfg, 'does-not-exist'), /not found in n8n/);

  // push an edit — a backup of the previous state must be taken first
  const edited = JSON.parse(fs.readFileSync(file, 'utf8'));
  edited.name = 'renamed by test';
  fs.writeFileSync(file, JSON.stringify(edited, null, 2));
  await push(cfg, file);
  const [after] = await exportWorkflows(container, id);
  assert.equal(after.name, 'renamed by test', 'edit deployed to n8n');
  const backups = fs.readdirSync(backupDir(id)).filter((f) => f.endsWith('.json'));
  assert.equal(backups.length, 1, 'exactly one backup snapshot taken');

  // invalid local files are rejected, nothing deployed
  fs.writeFileSync(file, '{ not json');
  await assert.rejects(push(cfg, file), /not valid JSON/);
  fs.writeFileSync(file, JSON.stringify({ id, name: 'x' }));
  await assert.rejects(push(cfg, file), /missing "nodes"/);
  assert.equal((await exportWorkflows(container, id))[0].name, 'renamed by test');

  // restore consumes the backup and puts the old state back
  const { remaining } = await restore(cfg, id);
  assert.equal(remaining, 0);
  assert.equal((await exportWorkflows(container, id))[0].name, 'bridge self-test');
  await assert.rejects(restore(cfg, id), /No backups/);

  // a corrupt backup fails with a friendly message, not a stack
  fs.mkdirSync(backupDir(id), { recursive: true });
  fs.writeFileSync(path.join(backupDir(id), '2026-01-01T00-00-00Z.json'), '{ truncated');
  await assert.rejects(restore(cfg, id), /corrupt/);
});
