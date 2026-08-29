// Optional true-integration smoke test against the real codex CLI.
// Spends ChatGPT quota and needs `codex login` — run with: REAL_CODEX=1 npm test
// Never runs in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatTurn } from '../src/chat.js';

const enabled = process.env.REAL_CODEX === '1';

test('real codex answers over stdin', { skip: !enabled && 'set REAL_CODEX=1 to run' }, async () => {
  const events = [];
  await chatTurn(
    { n8nUrl: 'http://localhost:5678' },
    'real-smoke-' + Date.now(),
    'Real Smoke Test',
    'Do NOT use any tools or change anything. Reply with exactly: PONG',
    (e) => events.push(e),
  );
  const reply = events.find((e) => e.kind === 'reply');
  assert.ok(reply, 'got a reply from real codex');
  assert.match(reply.text, /PONG/);
});
