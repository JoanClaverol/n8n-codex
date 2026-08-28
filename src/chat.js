import { spawn } from 'node:child_process';
import os from 'node:os';
import { BridgeError } from './docker.js';

/** In-memory chat threads: workflowId -> { threadId, busy }. Lives as long as the dashboard. */
const sessions = new Map();

/** True while a codex turn is editing this workflow — used to lock out concurrent edits. */
export function isBusy(id) {
  return sessions.get(id)?.busy === true;
}

function preamble(cfg, id, name) {
  return `You are helping a student edit their n8n workflow through the "n8n" MCP tools
(list_workflows, get_workflow, update_workflow). Rules:

- Work ONLY on workflow id "${id}" (named "${name}") unless told otherwise.
- Always call get_workflow first to see the current state before changing anything.
- update_workflow requires the COMPLETE workflow JSON — never a partial diff.
- "connections" is keyed by node NAME; renaming a node means updating connections too.
- New nodes need a fresh UUID id, a unique name, and a sensible position (~220px apart).
- After a successful update, remind the student to refresh their n8n tab: ${cfg.n8nUrl}/workflow/${id}
- The student is a beginner: keep replies short, friendly, and jargon-free.

Student's request:`;
}

/**
 * Run one chat turn via `codex exec`, streaming progress through onEvent:
 *   { kind: 'tool',  text }   — a tool call started
 *   { kind: 'tool_done', text, ok } — tool call finished
 *   { kind: 'reply', text }   — an assistant message
 *   { kind: 'error', text }
 */
export function chatTurn(cfg, id, name, message, onEvent) {
  let s = sessions.get(id);
  if (!s) sessions.set(id, (s = { threadId: null, busy: false }));
  if (s.busy) return Promise.reject(new BridgeError('Still working on the previous message — wait for the reply.'));
  s.busy = true;

  // exec-level options must come BEFORE the `resume` subcommand
  const args = ['exec', '--json', '--skip-git-repo-check', '--approve-for-me', '--cd', os.tmpdir()];
  if (s.threadId) args.push('resume', s.threadId);
  args.push(s.threadId ? message : `${preamble(cfg, id, name)}\n\n${message}`);

  return new Promise((resolve, reject) => {
    const p = spawn('codex', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
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
          onEvent({ kind: 'reply', text: item.text });
        }
      }
    });
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (err) => {
      s.busy = false;
      reject(new BridgeError(err.code === 'ENOENT'
        ? 'codex not found on PATH — install it with: npm install -g @openai/codex'
        : `codex failed to start: ${err.message}`));
    });
    p.on('close', (code) => {
      s.busy = false;
      if (code !== 0 && !sawReply) {
        const tail = stderr.trim().split('\n').slice(-3).join('\n');
        reject(new BridgeError(tail || `codex exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}
