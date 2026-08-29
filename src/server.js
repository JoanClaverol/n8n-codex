import http from 'node:http';
import { spawn } from 'node:child_process';
import { list } from './bridge.js';
import { chatTurn, isBusy } from './chat.js';
import { listModels } from './models.js';
import { renderChatPage } from './ui/pages/chat.js';
import { renderDashboardPage } from './ui/pages/dashboard.js';
import { getUiAsset } from './ui/static.js';


async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

/** Accept only requests addressed to this machine's dashboard (anti DNS-rebinding). */
function hostAllowed(cfg, req) {
  const host = (req.headers.host || '').toLowerCase();
  return host === `localhost:${cfg.port}` || host === `127.0.0.1:${cfg.port}` || host === `[::1]:${cfg.port}`;
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
  let modelCatalog = null;
  let modelCatalogLoadedAt = 0;
  let modelCatalogRequest = null;
  const getModelCatalog = () => {
    if (modelCatalog && Date.now() - modelCatalogLoadedAt < 5 * 60_000) {
      return Promise.resolve(modelCatalog);
    }
    if (!modelCatalogRequest) {
      modelCatalogRequest = listModels()
        .then((models) => {
          modelCatalog = models;
          modelCatalogLoadedAt = Date.now();
          return models;
        })
        .finally(() => { modelCatalogRequest = null; });
    }
    return modelCatalogRequest;
  };

  const server = http.createServer(async (req, res) => {
    try {
      // Only requests addressed to this dashboard are served — blocks
      // DNS-rebinding pages that resolve their own hostname to 127.0.0.1.
      if (!hostAllowed(cfg, req)) { res.writeHead(403); res.end('forbidden'); return; }
      if (['GET', 'HEAD'].includes(req.method)) {
        const asset = getUiAsset(req.url);
        if (asset) {
          res.writeHead(200, {
            'content-type': asset.contentType,
            'cache-control': 'no-cache',
          });
          res.end(req.method === 'HEAD' ? undefined : asset.body);
          return;
        }
      }


      if (req.url === '/api/models' && req.method === 'GET') {
        let models = [];
        let warning = null;
        try {
          models = await getModelCatalog();
        } catch (err) {
          warning = err.message;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models, warning }));
        return;
      }

      if (req.url === '/api/workflows') {
        const rows = await list(cfg);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(rows));
        return;
      }

      const chatApi = req.url.match(/^\/api\/chat\/([A-Za-z0-9_-]+)$/);
      if (chatApi && req.method === 'POST') {
        const id = chatApi[1];
        // require a JSON content type: cross-origin "simple" POSTs from a
        // drive-by web page can only send text/plain without a CORS preflight
        if (!/^application\/json/.test(req.headers['content-type'] || '')) {
          res.writeHead(403); res.end('forbidden'); return;
        }
        const { message, model } = await readBody(req);
        if (!message) { res.writeHead(400); res.end('missing message'); return; }
        let selectedModel = null;
        if (model !== undefined && model !== null && model !== '') {
          if (typeof model !== 'string') {
            res.writeHead(400); res.end('invalid model'); return;
          }
          let models;
          try {
            models = await getModelCatalog();
          } catch {
            res.writeHead(503); res.end('model catalog unavailable'); return;
          }
          if (!models.some((entry) => entry.id === model)) {
            res.writeHead(400); res.end('unknown model'); return;
          }
          selectedModel = model;
        }
        const rows = await list(cfg);
        const wf = rows.find((w) => w.id === id);
        if (!wf) { res.writeHead(404); res.end('workflow not found'); return; }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
        try {
          await chatTurn(cfg, id, wf.name, message, selectedModel, emit);
        } catch (err) {
          emit({ kind: 'error', text: err.message });
        }
        res.end();
        return;
      }

      const chatPage = req.url.match(/^\/chat\/([A-Za-z0-9_-]+)$/);
      if (chatPage) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderChatPage(chatPage[1]));
        return;
      }

      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(renderDashboardPage(cfg));
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
    if (!hostAllowed(cfg, req)) { socket.destroy(); return; }
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
