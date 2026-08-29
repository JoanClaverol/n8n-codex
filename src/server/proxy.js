import http from 'node:http';

/** Accept only requests addressed to this machine's dashboard (anti DNS-rebinding). */
export function hostAllowed(cfg, req) {
  const host = (req.headers.host || '').toLowerCase();
  return host === `localhost:${cfg.port}` || host === `127.0.0.1:${cfg.port}` || host === `[::1]:${cfg.port}`;
}

/** Only the dashboard's own pages may impersonate n8n's origin. */
function isDashboardOrigin(cfg, origin) {
  const o = (origin || '').toLowerCase();
  return o === `http://localhost:${cfg.port}` || o === `http://127.0.0.1:${cfg.port}` || o === `http://[::1]:${cfg.port}`;
}

/** Headers for the upstream request: n8n must see its own host — and a
 * matching Origin. n8n's push websocket accepts the upgrade, then checks
 * Origin against Host and drops the connection with "Invalid origin!"
 * (close 1008) on mismatch; a dead push connection makes the editor refuse
 * to run workflows ("Lost connection to the server").
 * Only the dashboard's OWN origin is rewritten: a foreign Origin (some
 * other local page opening ws://localhost:<port>/rest/push — websockets
 * skip CORS) passes through untouched so n8n's origin check still fires. */
function upstreamHeaders(cfg, req, target) {
  const headers = { ...req.headers, host: target.host };
  if (headers.origin && isDashboardOrigin(cfg, headers.origin)) headers.origin = `http://${target.host}`;
  return headers;
}

/** Forward a request to n8n, stripping headers that block iframing. */
export function proxyToN8n(cfg, req, res) {
  const target = new URL(cfg.n8nUrl);
  const up = http.request(
    { host: target.hostname, port: target.port || 80, path: req.url, method: req.method,
      headers: upstreamHeaders(cfg, req, target) },
    (upRes) => {
      const headers = { ...upRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      res.writeHead(upRes.statusCode, headers);
      upRes.pipe(res);
    },
  );
  up.on('error', () => {
    if (res.destroyed) return;
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`n8n is not reachable at ${cfg.n8nUrl} — is the Docker container running?`);
  });
  // client gone (tab closed, abort) — don't leave the upstream request open
  res.on('close', () => up.destroy());
  req.pipe(up);
}

/** Pass n8n's websocket (live canvas push) through the proxy. */
export function proxyUpgrade(cfg, req, socket) {
  const target = new URL(cfg.n8nUrl);
  const up = http.request({
    host: target.hostname, port: target.port || 80, path: req.url, method: 'GET',
    headers: upstreamHeaders(cfg, req, target),
  });
  // The client can reset or vanish while the upstream handshake is still
  // pending (tab closed/reloaded mid-boot). At that point the http server has
  // detached its own listeners, so without these an 'error' on the raw socket
  // would crash the whole process, and a clean FIN would leak `up` forever.
  socket.on('error', () => { up.destroy(); socket.destroy(); });
  socket.on('close', () => up.destroy());
  // http.Server sockets allow half-open: a clean client FIN emits only 'end',
  // never 'close' (our write side is still up). No websocket peer half-closes
  // legitimately, so treat it as gone. resume() guarantees the FIN is read.
  socket.on('end', () => { up.destroy(); socket.destroy(); });
  socket.resume();
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
