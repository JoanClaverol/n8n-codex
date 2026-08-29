// Non-200 chat responses must surface as a friendly error bubble, not crash
// the NDJSON parser with "Unexpected token" (the server sends plain text for
// 404 workflow-gone, 503 catalog-unavailable, 400 unknown-model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamChatTurn } from '../src/ui/assets/chat/stream.js';

function withFetch(t, response) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  t.after(() => (globalThis.fetch = original));
}

async function collect(args) {
  const events = [];
  await streamChatTurn({ workflowId: 'x', message: 'hi', ...args, onEvent: (e) => events.push(e) });
  return events;
}

test('non-200 responses surface the server text as an error event', async (t) => {
  withFetch(t, new Response('workflow not found', { status: 404 }));
  assert.deepEqual(await collect(), [{ kind: 'error', text: 'workflow not found' }]);
});

test('empty error bodies get a readable fallback', async (t) => {
  withFetch(t, new Response('', { status: 503 }));
  const events = await collect();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'error');
  assert.match(events[0].text, /503/);
});

test('ok responses stream NDJSON events', async (t) => {
  const lines =
    JSON.stringify({ kind: 'tool', text: 'update_workflow' }) + '\n' +
    JSON.stringify({ kind: 'reply', text: 'done' }) + '\n';
  withFetch(t, new Response(lines, { status: 200 }));
  assert.deepEqual(await collect(), [
    { kind: 'tool', text: 'update_workflow' },
    { kind: 'reply', text: 'done' },
  ]);
});
