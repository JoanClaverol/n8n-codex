// Fake `codex` CLI for tests. Records exactly how it was invoked (argv +
// stdin) to FAKE_CODEX_LOG and replies with canned events, so tests can
// assert what n8n-codex passes without spending real ChatGPT quota.
//
// Env knobs:
//   FAKE_CODEX_LOG      — ndjson file to append {argv, stdin} per invocation
//   FAKE_CODEX_DELAY_MS — sleep before replying (busy-lock tests)
//   FAKE_CODEX_EXIT     — nonzero: write stderr and exit with that code
//   FAKE_CODEX_THREAD   — thread id to announce (default fake-thread-1)
import fs from 'node:fs';

const argv = process.argv.slice(2);

async function readStdin() {
  let s = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

// `-` means "read the prompt from stdin" — same contract as the real codex.
const stdin = argv[argv.length - 1] === '-' ? await readStdin() : '';

if (process.env.FAKE_CODEX_LOG) {
  fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ argv, stdin }) + '\n');
}

const delay = Number(process.env.FAKE_CODEX_DELAY_MS || 0);
if (delay) await new Promise((r) => setTimeout(r, delay));

if (process.env.FAKE_CODEX_EXIT && process.env.FAKE_CODEX_EXIT !== '0') {
  process.stderr.write('fake codex: simulated failure\n');
  process.exit(Number(process.env.FAKE_CODEX_EXIT));
}

if (argv[0] === '--version') {
  console.log('codex-cli 0.0.0-fake');
} else if (argv[0] === 'mcp' && argv[1] === 'list') {
  console.log('n8n  n8n-codex mcp');
} else if (argv[0] === 'mcp' && argv[1] === 'add') {
  // accept silently, like the real thing
} else if (argv[0] === 'exec') {
  const emit = (o) => console.log(JSON.stringify(o));
  emit({ type: 'thread.started', thread_id: process.env.FAKE_CODEX_THREAD || 'fake-thread-1' });
  emit({ type: 'item.started', item: { type: 'mcp_tool_call', tool: 'get_workflow' } });
  emit({ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'get_workflow', status: 'completed' } });
  emit({ type: 'item.completed', item: { type: 'agent_message', text: 'echo:' + stdin } });
}
