import http from 'node:http';
import { spawn } from 'node:child_process';
import { hostAllowed, proxyToN8n, proxyUpgrade } from './server/proxy.js';
import { createRoutes } from './server/routes.js';

export function serve(cfg) {
  const routes = createRoutes(cfg);

  const server = http.createServer(async (req, res) => {
    try {
      // Only requests addressed to this dashboard are served — blocks
      // DNS-rebinding pages that resolve their own hostname to 127.0.0.1.
      if (!hostAllowed(cfg, req)) { res.writeHead(403); res.end('forbidden'); return; }
      if (await routes(req, res)) return;
      // everything else (assets, /rest, /workflow/<id>, …) is n8n, served
      // same-origin so the canvas can live in an iframe next to the chat
      proxyToN8n(cfg, req, res);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(err.message);
    }
  });

  server.on('upgrade', (req, socket) => {
    if (!hostAllowed(cfg, req)) { socket.destroy(); return; }
    proxyUpgrade(cfg, req, socket);
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
