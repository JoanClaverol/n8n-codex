import http from 'node:http';
import { spawn } from 'node:child_process';
import { list } from './bridge.js';

const PAGE = (cfg) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>n8n-codex</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 780px; margin: 3rem auto; padding: 0 1rem; }
  h1 { font-size: 1.4rem; } h1 span { color: #e94e63; }
  p.sub { opacity: .7; margin-top: -.5rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
  th, td { text-align: left; padding: .55rem .7rem; border-bottom: 1px solid rgba(128,128,128,.25); }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .05em; opacity: .6; }
  td.name { font-weight: 600; }
  .badge { font-size: .75rem; padding: .1rem .5rem; border-radius: 99px; background: rgba(128,128,128,.15); }
  .badge.on { background: #22a06b22; color: #22a06b; }
  button, a.btn { font: inherit; font-size: .85rem; padding: .3rem .7rem; border-radius: 6px;
    border: 1px solid rgba(128,128,128,.4); background: transparent; cursor: pointer;
    color: inherit; text-decoration: none; display: inline-block; }
  button:hover, a.btn:hover { border-color: #e94e63; }
  code { background: rgba(128,128,128,.15); padding: .1rem .4rem; border-radius: 4px; }
  #status { opacity: .6; }
</style>
</head>
<body>
<h1><span>n8n</span>-codex</h1>
<p class="sub">Pick a workflow, copy its command, run it in a terminal — Codex opens ready to edit that workflow.</p>
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
      const cmd = 'n8n-codex ' + w.id;
      tr.innerHTML =
        '<td class="name">' + w.name + '<br><code>' + w.id + '</code></td>' +
        '<td>' + w.nodes + '</td>' +
        '<td><span class="badge' + (w.active ? ' on' : '') + '">' + (w.active ? 'active' : 'inactive') + '</span></td>' +
        '<td><button data-cmd="' + cmd + '">Copy edit command</button></td>' +
        '<td><a class="btn" target="_blank" href="${cfg.n8nUrl}/workflow/' + w.id + '">Open in n8n</a></td>';
      tbody.appendChild(tr);
    }
    document.getElementById('tbl').hidden = false;
    status.textContent = rows.length + ' workflow(s). Run the copied command in any terminal.';
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

export function serve(cfg) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/workflows') {
      try {
        const rows = await list(cfg);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(rows));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end(err.message);
      }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(cfg));
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
