// "Is the prompt passed properly?" — the core contract between the dashboard
// chat and `codex exec`: the student's message must reach codex via stdin,
// byte-for-byte, with the instructions in an AGENTS.md inside the per-workflow
// chat dir (so they apply every turn) and `resume` after the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installFakeCodex } from './helpers.js';
import { chatDir, chatTurn } from '../src/chat.js';

const cfg = { n8nUrl: 'http://localhost:5678' };
const NASTY = 'add a joke node & del /q * | echo "quoted" %PATH% $(uname)\nsecond line — émoji 🚀';

test('first turn: message arrives verbatim on stdin, instructions via AGENTS.md, prompt never in argv', async (t) => {
  const fake = installFakeCodex(t);
  const id = 'wf-first-' + Date.now();
  t.after(() => fs.rmSync(chatDir(id), { recursive: true, force: true }));
  const events = [];
  await chatTurn(cfg, id, 'My "Workflow" & Co', NASTY, null, (e) => events.push(e));

  const [call] = fake.calls();
  assert.deepEqual(call.argv, [
    'exec', '--json', '--skip-git-repo-check', '--approve-for-me', '--cd', chatDir(id), '-',
  ]);
  assert.equal(call.stdin, NASTY, 'stdin is exactly the student message');
  const md = fs.readFileSync(path.join(chatDir(id), 'AGENTS.md'), 'utf8');
  assert.ok(md.includes(`workflow id "${id}"`), 'instructions name the workflow id');
  assert.ok(md.includes('My "Workflow" & Co'), 'instructions name the workflow');
  assert.ok(/PLAIN TEXT/.test(md), 'instructions demand plain-text replies');

  assert.deepEqual(events.map((e) => e.kind), ['tool', 'tool_done', 'reply']);
  assert.equal(events[2].text, 'echo:' + call.stdin, 'reply streamed back to the UI');
});

test('second turn: resumes the announced thread with the raw message', async (t) => {
  const fake = installFakeCodex(t, { FAKE_CODEX_THREAD: 't-abc-123' });
  const id = 'wf-resume-' + Date.now();
  t.after(() => fs.rmSync(chatDir(id), { recursive: true, force: true }));
  await chatTurn(cfg, id, 'WF', 'first message', 'model-fast', () => {});
  await chatTurn(cfg, id, 'WF', NASTY, 'model-default', () => {});

  const calls = fake.calls();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].argv.slice(-3), ['--model', 'model-fast', '-']);
  const resume = calls[1];
  const i = resume.argv.indexOf('resume');
  assert.ok(i > 0, 'second turn must use resume');
  assert.equal(resume.argv[i + 1], 't-abc-123', 'thread id from thread.started is reused');
  assert.deepEqual(resume.argv.slice(i - 2, i), ['--model', 'model-default'],
    'a resumed conversation can switch models');
  assert.equal(resume.argv[resume.argv.length - 1], '-');
  assert.equal(resume.stdin, NASTY, 'resumed turn sends the raw message, nothing else');
});

test('busy lock: a second message while codex runs is rejected', async (t) => {
  installFakeCodex(t, { FAKE_CODEX_DELAY_MS: '1500' });
  const id = 'wf-busy-' + Date.now();
  const first = chatTurn(cfg, id, 'WF', 'slow one', null, () => {});
  await new Promise((r) => setTimeout(r, 300)); // let codex spawn
  await assert.rejects(chatTurn(cfg, id, 'WF', 'impatient', null, () => {}), /Still working/);
  await first; // and the first turn still completes cleanly
});

test('codex failure surfaces its stderr as a friendly error', async (t) => {
  installFakeCodex(t, { FAKE_CODEX_EXIT: '3' });
  const id = 'wf-fail-' + Date.now();
  await assert.rejects(chatTurn(cfg, id, 'WF', 'hello', null, () => {}), /simulated failure/);
});
