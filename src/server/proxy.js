import http from 'node:http';

/** Accept only requests addressed to this machine's dashboard (anti DNS-rebinding). */
export function hostAllowed(cfg, req) {
  const host = (req.headers.host || '').toLowerCase();
  return host === `localhost:${cfg.port}` || host === `127.0.0.1:${cfg.port}` || host === `[::1]:${cfg.port}`;
}

/** Forward a request to n8n, stripping headers that block iframing. */
export function proxyToN8n(cfg, req, res) {
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

/** Pass n8n's websocket (live canvas push) through the proxy. */
export function proxyUpgrade(cfg, req, socket) {
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
  // n8n answered the handshake with a plain HTTP response (e.g. still
  // booting) — fail fast so the browser retries instead of hanging.
  up.on('response', () => socket.destroy());
  up.on('error', () => socket.destroy());
  up.end();
}
