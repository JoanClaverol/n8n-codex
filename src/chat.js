import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeError } from './error.js';
import { chatInstructions } from './agent/chat-instructions.js';
import { plainText } from './agent/plain-text.js';

/** In-memory chat threads: workflowId -> { threadId, busy }. Lives as long as the dashboard. */
const sessions = new Map();

/** A codex turn that produces nothing for this long is stuck (network stall,
 * unexpected interactive prompt): kill it and free the busy lock, or the chat
 * AND the student's own editor saves (423 gate) stay wedged until restart. */
const TURN_TIMEOUT_MS = 15 * 60_000;

/** True while a codex turn is editing this workflow — used to lock out concurrent edits. */
export function isBusy(id) {
  return sessions.get(id)?.busy === true;
}

/** Per-workflow working dir for `codex exec` — its AGENTS.md carries the
 * instructions, so they apply on every turn (not just the first). Workflow
 * ids are [A-Za-z0-9_-], so they are safe as path segments. */
export function chatDir(id) {
  return path.join(os.tmpdir(), 'n8n-codex', 'chat', id);
}

/**
 * Run one chat turn via `codex exec`, streaming progress through onEvent:
 *   { kind: 'tool',  text }   — a tool call started
 *   { kind: 'tool_done', text, ok } — tool call finished
 *   { kind: 'reply', text }   — an assistant message
 *   { kind: 'error', text }
 */
export function chatTurn(cfg, id, name, message, model, onEvent) {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { threadId: null, busy: false }));
  if (s.busy) return Promise.reject(new BridgeError('Still working on the previous message — wait for the reply.'));

  // Instructions live in AGENTS.md inside the chat dir; rewritten each turn
  // so a renamed workflow or changed n8n URL stays current. This runs before
  // the busy flag is set: if it throws, the lock must not leak.
  const dir = chatDir(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), chatInstructions(cfg, { id, name }));
  s.busy = true;

  // exec-level options must come BEFORE the `resume` subcommand.
  // --approve-for-me auto-reviews approvals under the workspace-write
  // sandbox; the workspace is a throwaway tmpdir, so workflow content that
  // tries to prompt-inject the agent can reach no further than the n8n MCP
  // tools it already has.
  const args = ['exec', '--json', '--skip-git-repo-check', '--approve-for-me', '--cd', dir];
  if (model) args.push('--model', model);
  if (s.threadId) args.push('resume', s.threadId);
  // `-` = read the prompt from stdin. Never put the student's message in argv:
  // on Windows spawn uses cmd.exe for the .cmd shim, which would interpret
  // metacharacters (&, |, %, quotes) in free-form text as shell syntax.
  args.push('-');

  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    // cmd.exe gets argv joined with spaces un-escaped — quote so the tmpdir
    // path (which may contain spaces) survives; all args are shell-safe literals
    const p = spawn('codex', win ? args.map((a) => `"${a}"`) : args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: win,
    });
    // one exit path: whatever settles first clears the lock and the watchdog
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      s.busy = false;
      fn(value);
    };
    const watchdog = setTimeout(() => {
      p.kill();
      settle(reject, new BridgeError('The AI got stuck and was stopped. Check the canvas for partial changes, then send your message again.'));
    }, cfg.turnTimeoutMs ?? TURN_TIMEOUT_MS);
    p.stdin.on('error', () => {}); // EPIPE if codex dies before reading
    p.stdin.end(message);
    let buf = '';
    let stderr = '';
    let sawReply = false;

    p.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'thread.started' && ev.thread_id) s.threadId = ev.thread_id;
        const item = ev.item;
        if (!item) continue;
        if (ev.type === 'item.started' && item.type === 'mcp_tool_call') {
          onEvent({ kind: 'tool', text: item.tool });
        } else if (ev.type === 'item.completed' && item.type === 'mcp_tool_call') {
          onEvent({ kind: 'tool_done', text: item.tool, ok: item.status === 'completed' });
        } else if (ev.type === 'item.completed' && item.type === 'agent_message' && item.text) {
          sawReply = true;
          onEvent({ kind: 'reply', text: plainText(item.text) });
        }
      }
    });
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (err) => {
      settle(reject, new BridgeError(err.code === 'ENOENT'
        ? 'codex not found on PATH — install it with: npm install -g @openai/codex'
        : `codex failed to start: ${err.message}`));
    });
    p.on('close', (code) => {
      if (code !== 0 && !sawReply) {
        const tail = stderr.trim().split('\n').slice(-3).join('\n');
        settle(reject, new BridgeError(tail || `codex exited with code ${code}`));
      } else {
        settle(resolve);
      }
    });
  });
}
