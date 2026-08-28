import http from 'node:http';
import { spawn } from 'node:child_process';
import { list } from './bridge.js';
import { chatTurn, isBusy } from './chat.js';

const CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; }
  h1 { font-size: 1.3rem; margin: 0; } h1 span { color: #e94e63; }
  h1 a { color: inherit; text-decoration: none; }
  code { background: rgba(128,128,128,.15); padding: .1rem .4rem; border-radius: 4px; }
  button, a.btn { font: inherit; font-size: .85rem; padding: .3rem .7rem; border-radius: 6px;
    border: 1px solid rgba(128,128,128,.4); background: transparent; cursor: pointer;
    color: inherit; text-decoration: none; display: inline-block; }
  button:hover, a.btn:hover { border-color: #e94e63; }
  button:disabled { opacity: .4; cursor: default; }
  button.primary, a.btn.primary { background: #e94e63; border-color: #e94e63; color: #fff; }
`;

const DASHBOARD = (cfg) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>n8n-codex</title>
<style>${CSS}
  body { max-width: 780px; margin: 3rem auto; padding: 0 1rem; }
  p.sub { opacity: .7; }
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
<p class="sub">Click <b>Chat</b> on a workflow to build it by talking to the AI — you'll see the canvas update live.</p>
<p id="status">Loading workflows…</p>
<table id="tbl" hidden>
  <thead><tr><th>Workflow</th><th>Nodes</th><th>Status</th><th></th><th></th></tr></thead>
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
        '<td><a class="btn" target="_blank" href="${cfg.n8nUrl}/workflow/' + w.id + '">Open in n8n</a></td>';
      tbody.appendChild(tr);
    }
    document.getElementById('tbl').hidden = false;
    status.textContent = rows.length + ' workflow(s).';
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
  body { display: flex; height: 100dvh; }
  .stage { position: relative; flex: 1; min-width: 0; display: flex; }
  #canvas { flex: 1; border: none; min-width: 0; }
  #lock { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,.45); backdrop-filter: blur(1.5px); z-index: 5; }
  #lock.on { display: flex; }
  #lock div { background: #1d1d1f; color: #fff; padding: .8rem 1.2rem; border-radius: 12px;
    font-size: .95rem; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
  aside { width: 420px; max-width: 45vw; display: flex; flex-direction: column;
    border-left: 1px solid rgba(128,128,128,.25); padding: .8rem 1rem 1rem; }
  body.collapsed aside { display: none; }
  #rail { display: none; width: 44px; border-left: 1px solid rgba(128,128,128,.25);
    align-items: center; justify-content: center; cursor: pointer; position: relative; }
  #rail:hover { background: rgba(128,128,128,.1); }
  #rail span { writing-mode: vertical-rl; font-size: .85rem; opacity: .8; user-select: none; }
  #rail .dot { display: none; position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    width: 10px; height: 10px; border-radius: 99px; background: #e94e63;
    animation: pulse 1.2s ease-in-out infinite; }
  #rail.unread .dot { display: block; }
  @keyframes pulse { 50% { opacity: .35; } }
  body.collapsed #rail { display: flex; }
  #collapse { margin-left: auto; }
  header { display: flex; align-items: baseline; gap: .8rem; flex-wrap: wrap; padding-bottom: .4rem; }
  header .grow { flex: 1; font-weight: 600; }
  #msgs { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: .6rem; padding: .6rem 0; }
  .msg { max-width: 92%; padding: .55rem .85rem; border-radius: 12px; white-space: pre-wrap; overflow-wrap: break-word; }
  .user { align-self: flex-end; background: #e94e63; color: #fff; border-bottom-right-radius: 4px; }
  .bot  { align-self: flex-start; background: rgba(128,128,128,.15); border-bottom-left-radius: 4px; }
  .tool { align-self: flex-start; font-size: .8rem; opacity: .65; }
  .err  { align-self: flex-start; color: #e94e63; font-size: .9rem; }
  form { display: flex; gap: .5rem; }
  textarea { flex: 1; font: inherit; padding: .55rem .85rem; border-radius: 12px; resize: none;
    border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; }
  textarea:focus { outline: none; border-color: #e94e63; }
  .typing { align-self: flex-start; opacity: .5; }
  @media (max-width: 900px) {
    body { flex-direction: column; }
    #canvas { min-height: 40dvh; }
    aside { width: auto; max-width: none; flex: 1; border-left: none; border-top: 1px solid rgba(128,128,128,.25); }
  }
</style>
</head>
<body>
<div class="stage">
  <iframe id="canvas" src="/workflow/${id}" title="n8n canvas"></iframe>
  <div id="lock"><div>🔒 The AI is editing this workflow — the canvas unlocks when it's done.</div></div>
</div>
<div id="rail" title="Open the chat"><span>💬 Chat</span><i class="dot"></i></div>
<aside>
  <header>
    <h1><a href="/"><span>n8n</span>-codex</a></h1>
    <span id="wfname" class="grow">…</span>
    <button id="collapse" type="button" title="Hide the chat">⟩</button>
  </header>
  <div id="msgs">
    <div class="msg bot">Hi! Tell me what this workflow should do and I'll build it — you'll see the canvas on the left update as I work. You can hide me with ⟩ while I work; I'll blink when there's news.</div>
  </div>
  <form id="f">
    <textarea id="inp" rows="2" placeholder="e.g. add an HTTP Request node that fetches a random joke" autofocus></textarea>
    <button class="primary" id="send" type="submit">Send</button>
  </form>
</aside>
<script>
const id = ${JSON.stringify(id)};
const msgs = document.getElementById('msgs');
const inp = document.getElementById('inp');
const send = document.getElementById('send');
const canvas = document.getElementById('canvas');
const toolNames = { list_workflows: 'looking at your workflows', get_workflow: 'reading the workflow', update_workflow: 'saving to n8n' };
const lock = document.getElementById('lock');
const rail = document.getElementById('rail');

// chat panel collapse
const collapsed = (on) => {
  document.body.classList.toggle('collapsed', on);
  if (!on) rail.classList.remove('unread');
  localStorage.setItem('n8n-codex-collapsed', on ? '1' : '');
};
document.getElementById('collapse').onclick = () => collapsed(true);
rail.onclick = () => collapsed(false);
if (localStorage.getItem('n8n-codex-collapsed')) collapsed(true);
const notify = () => { if (document.body.classList.contains('collapsed')) rail.classList.add('unread'); };

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
  lock.classList.add('on');
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
        else if (ev.kind === 'tool_done' && ev.text === 'update_workflow' && ev.ok) {
          add('tool', '✓ saved — updating the canvas');
          canvas.contentWindow.location.reload();
          notify();
        }
        else if (ev.kind === 'reply') { add('msg bot', ev.text); notify(); }
        else if (ev.kind === 'error') add('err', ev.text);
        msgs.scrollTop = msgs.scrollHeight;
      }
    }
  } catch (err) {
    add('err', 'Connection lost: ' + err.message);
  } finally {
    typing.remove();
    send.disabled = false;
    lock.classList.remove('on');
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

/** Forward a request to n8n, stripping headers that block iframing. */
function proxyToN8n(cfg, req, res) {
  const target = new URL(cfg.n8nUrl);
  const up = http.request(
    { host: target.hostname, port: target.port || 80, path: req.url, method: req.method,
      headers: { ...req.headers, host: target.host } },
    (upRes) => {
      const headers = { ...upRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      res.writeHead(upRes.statusCode, headers);
      upRes.pipe(res);
    },
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`n8n is not reachable at ${cfg.n8nUrl} — is the Docker container running?`);
  });
  req.pipe(up);
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

      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(DASHBOARD(cfg));
        return;
      }

      // safety: while the AI is editing a workflow, reject the student's own
      // saves to that workflow coming through the embedded editor
      const wfWrite = req.url.match(/^\/rest\/workflows\/([A-Za-z0-9_-]+)/);
      if (wfWrite && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && isBusy(wfWrite[1])) {
        res.writeHead(423, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'The AI is editing this workflow right now — wait for it to finish, then try again.' }));
        return;
      }

      // everything else (assets, /rest, /workflow/<id>, …) is n8n, served
      // same-origin so the canvas can live in an iframe next to the chat
      proxyToN8n(cfg, req, res);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err.message);
    }
  });

  // pass n8n's websocket (live canvas push) through the proxy
  server.on('upgrade', (req, socket) => {
    const target = new URL(cfg.n8nUrl);
    const up = http.request({
      host: target.hostname, port: target.port || 80, path: req.url, method: 'GET',
      headers: { ...req.headers, host: target.host },
    });
    up.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 101 Switching Protocols`];
      for (const [k, v] of Object.entries(upRes.headers)) lines.push(`${k}: ${v}`);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (upHead?.length) socket.write(upHead);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      const drop = () => { upSocket.destroy(); socket.destroy(); };
      upSocket.on('error', drop);
      socket.on('error', drop);
    });
    up.on('error', () => socket.destroy());
    up.end();
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
    console.log(`Ready! Open ${url} in your browser  (keep this window open; Ctrl-C stops it)`);
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
