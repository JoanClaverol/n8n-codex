import http from 'node:http';
import { spawn } from 'node:child_process';
import { list } from './bridge.js';
import { chatTurn } from './chat.js';

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 780px; margin: 0 auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; } h1 span { color: #e94e63; }
  h1 a { color: inherit; text-decoration: none; }
  p.sub { opacity: .7; margin-top: -.5rem; }
  code { background: rgba(128,128,128,.15); padding: .1rem .4rem; border-radius: 4px; }
  button, a.btn { font: inherit; font-size: .85rem; padding: .3rem .7rem; border-radius: 6px;
    border: 1px solid rgba(128,128,128,.4); background: transparent; cursor: pointer;
    color: inherit; text-decoration: none; display: inline-block; }
  button:hover, a.btn:hover { border-color: #e94e63; }
  button:disabled { opacity: .4; cursor: default; }
  button.primary { background: #e94e63; border-color: #e94e63; color: #fff; }
`;

const DASHBOARD = (cfg) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>n8n-codex</title>
<style>${CSS}
  body { margin-top: 3rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
  th, td { text-align: left; padding: .55rem .7rem; border-bottom: 1px solid rgba(128,128,128,.25); }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; opacity: .6; }
  td.name { font-weight: 600; }
  .badge { font-size: .75rem; padding: .1rem .5rem; border-radius: 99px; background: rgba(128,128,128,.15); }
  .badge.on { background: #22a06b22; color: #22a06b; }
  #status { opacity: .6; }
</style>
</head>
<body>
<h1><span>n8n</span>-codex</h1>
<p class="sub">Chat with the AI about a workflow, or copy the terminal command for a full Codex session.</p>
<p id="status">Loading workflows…</p>
<table id="tbl" hidden>
  <thead><tr><th>Workflow</th><th>Nodes</th><th>Status</th><th></th><th></th><th></th></tr></thead>
  <tbody></tbody>
</table>
<script>
async function load() {
  const status = document.getElementById('status');
  try {
    const res = await fetch('/api/workflows');
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    const tbody = document.querySelector('#tbl tbody');
    tbody.innerHTML = '';
    for (const w of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="name">' + w.name + '<br><code>' + w.id + '</code></td>' +
        '<td>' + w.nodes + '</td>' +
        '<td><span class="badge' + (w.active ? ' on' : '') + '">' + (w.active ? 'active' : 'inactive') + '</span></td>' +
        '<td><a class="btn primary" href="/chat/' + w.id + '">Chat</a></td>' +
        '<td><button data-cmd="n8n-codex ' + w.id + '">Copy terminal command</button></td>' +
        '<td><a class="btn" target="_blank" href="${cfg.n8nUrl}/workflow/' + w.id + '">Open in n8n</a></td>';
      tbody.appendChild(tr);
    }
    document.getElementById('tbl').hidden = false;
    status.textContent = rows.length + ' workflow(s).';
    tbody.onclick = async (e) => {
      const b = e.target.closest('button[data-cmd]');
      if (!b) return;
      await navigator.clipboard.writeText(b.dataset.cmd);
      const t = b.textContent; b.textContent = 'Copied!';
      setTimeout(() => (b.textContent = t), 1200);
    };
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
}
load();
</script>
</body>
</html>`;

const CHAT = (cfg, id) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat — n8n-codex</title>
<style>${CSS}
  body { display: flex; flex-direction: column; height: 100dvh; padding-bottom: 1rem; }
  header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  header .grow { flex: 1; }
  #msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: .6rem; padding: 1rem 0; }
  .msg { max-width: 85%; padding: .55rem .85rem; border-radius: 12px; white-space: pre-wrap; overflow-wrap: break-word; }
  .user { align-self: flex-end; background: #e94e63; color: #fff; border-bottom-right-radius: 4px; }
  .bot  { align-self: flex-start; background: rgba(128,128,128,.15); border-bottom-left-radius: 4px; }
  .tool { align-self: flex-start; font-size: .8rem; opacity: .65; padding: 0 .85rem; }
  .err  { align-self: flex-start; color: #e94e63; font-size: .9rem; padding: 0 .85rem; }
  form { display: flex; gap: .5rem; }
  textarea { flex: 1; font: inherit; padding: .55rem .85rem; border-radius: 12px; resize: none;
    border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
  textarea:focus { outline: none; border-color: #e94e63; }
  .typing { align-self: flex-start; opacity: .5; padding: 0 .85rem; }
</style>
</head>
<body>
<header>
  <h1><a href="/"><span>n8n</span>-codex</a></h1>
  <span id="wfname" class="grow">…</span>
  <a class="btn" target="_blank" href="${cfg.n8nUrl}/workflow/${id}">Open in n8n</a>
</header>
<div id="msgs"></div>
<form id="f">
  <textarea id="inp" rows="2" placeholder="e.g. add an HTTP Request node that fetches a random joke and connect it after the trigger" autofocus></textarea>
  <button class="primary" id="send" type="submit">Send</button>
</form>
<script>
const id = ${JSON.stringify(id)};
const msgs = document.getElementById('msgs');
const inp = document.getElementById('inp');
const send = document.getElementById('send');
const toolNames = { list_workflows: 'looking at your workflows', get_workflow: 'reading the workflow', update_workflow: 'saving to n8n' };

fetch('/api/workflows').then(r => r.json()).then(rows => {
  const w = rows.find(w => w.id === id);
  document.getElementById('wfname').textContent = w ? w.name : id;
}).catch(() => {});

function add(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}

document.getElementById('f').onsubmit = async (e) => {
  e.preventDefault();
  const message = inp.value.trim();
  if (!message || send.disabled) return;
  inp.value = '';
  send.disabled = true;
  add('msg user', message);
  const typing = add('typing', 'thinking…');
  try {
    const res = await fetch('/api/chat/' + id, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.kind === 'tool') add('tool', '⚙ ' + (toolNames[ev.text] || ev.text) + '…');
        else if (ev.kind === 'tool_done' && ev.text === 'update_workflow' && ev.ok)
          add('tool', '✓ saved — refresh your n8n tab to see it');
        else if (ev.kind === 'reply') add('msg bot', ev.text);
        else if (ev.kind === 'error') add('err', ev.text);
        msgs.scrollTop = msgs.scrollHeight;
      }
    }
  } catch (err) {
    add('err', 'Connection lost: ' + err.message);
  } finally {
    typing.remove();
    send.disabled = false;
    inp.focus();
  }
};
inp.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('f').requestSubmit(); }
});
</script>
</body>
</html>`;

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

export function serve(cfg) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/api/workflows') {
        const rows = await list(cfg);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(rows));
        return;
      }

      const chatApi = req.url.match(/^\/api\/chat\/([A-Za-z0-9_-]+)$/);
      if (chatApi && req.method === 'POST') {
        const id = chatApi[1];
        const { message } = await readBody(req);
        if (!message) { res.writeHead(400); res.end('missing message'); return; }
        const rows = await list(cfg);
        const wf = rows.find((w) => w.id === id);
        if (!wf) { res.writeHead(404); res.end('workflow not found'); return; }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
        try {
          await chatTurn(cfg, id, wf.name, message, emit);
        } catch (err) {
          emit({ kind: 'error', text: err.message });
        }
        res.end();
        return;
      }

      const chatPage = req.url.match(/^\/chat\/([A-Za-z0-9_-]+)$/);
      if (chatPage) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(CHAT(cfg, chatPage[1]));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD(cfg));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err.message);
    }
  });

  server.requestTimeout = 0; // codex turns can take minutes
  server.headersTimeout = 60_000;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${cfg.port} is already in use — is n8n-codex already running?\nOpen http://localhost:${cfg.port} or start this one with --port=<other>.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(cfg.port, '127.0.0.1', () => {
    const url = `http://localhost:${cfg.port}`;
    console.log(`n8n-codex dashboard: ${url}  (Ctrl-C to stop)`);
    if (cfg.open) openBrowser(url);
  });
  return server;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] :
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] :
    ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}
