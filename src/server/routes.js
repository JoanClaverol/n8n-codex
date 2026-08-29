import { list } from '../bridge.js';
import { chatTurn, isBusy, resetChat } from '../chat.js';
import { listModels } from '../models.js';
import { renderChatPage } from '../ui/pages/chat.js';
import { renderDashboardPage } from '../ui/pages/dashboard.js';
import { getUiAsset } from '../ui/static.js';

const CATALOG_TTL_MS = 5 * 60_000;

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

/**
 * Dashboard-owned routes: UI assets, pages, /api/*, and the busy-lock on
 * workflow saves. Returns a handler that responds and yields true when it
 * owned the request; false means "not ours — proxy it to n8n".
 */
export function createRoutes(cfg) {
  // model catalog: cached for 5 min, concurrent misses share one in-flight request
  let catalog = null;
  let loadedAt = 0;
  let inFlight = null;
  const getModelCatalog = () => {
    if (catalog && Date.now() - loadedAt < CATALOG_TTL_MS) return Promise.resolve(catalog);
    if (!inFlight) {
      inFlight = listModels()
        .then((models) => { catalog = models; loadedAt = Date.now(); return models; })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  };

  return async (req, res) => {
    if (['GET', 'HEAD'].includes(req.method)) {
      const asset = getUiAsset(req.url);
      if (asset) {
        res.writeHead(200, {
          'content-type': asset.contentType,
          'cache-control': 'no-cache',
        });
        res.end(req.method === 'HEAD' ? undefined : asset.body);
        return true;
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
      return true;
    }

    if (req.url === '/api/workflows') {
      const rows = await list(cfg);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(rows));
      return true;
    }

    // wipe the chat context (kills a running turn) — used by the ↻ button
    const chatReset = req.url.match(/^\/api\/chat\/([A-Za-z0-9_-]+)\/reset$/);
    if (chatReset && req.method === 'POST') {
      if (!/^application\/json/.test(req.headers['content-type'] || '')) {
        res.writeHead(403); res.end('forbidden'); return true;
      }
      resetChat(chatReset[1]);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return true;
    }

    const chatApi = req.url.match(/^\/api\/chat\/([A-Za-z0-9_-]+)$/);
    if (chatApi && req.method === 'POST') {
      const id = chatApi[1];
      // require a JSON content type: cross-origin "simple" POSTs from a
      // drive-by web page can only send text/plain without a CORS preflight
      if (!/^application\/json/.test(req.headers['content-type'] || '')) {
        res.writeHead(403); res.end('forbidden'); return true;
      }
      const { message, model } = await readBody(req);
      if (!message) { res.writeHead(400); res.end('missing message'); return true; }
      let selectedModel = null;
      if (model !== undefined && model !== null && model !== '') {
        if (typeof model !== 'string') {
          res.writeHead(400); res.end('invalid model'); return true;
        }
        let models;
        try {
          models = await getModelCatalog();
        } catch {
          res.writeHead(503); res.end('model catalog unavailable'); return true;
        }
        if (!models.some((entry) => entry.id === model)) {
          res.writeHead(400); res.end('unknown model'); return true;
        }
        selectedModel = model;
      }
      const rows = await list(cfg);
      const wf = rows.find((w) => w.id === id);
      if (!wf) {
        res.writeHead(404);
        res.end('This workflow no longer exists in n8n — it may have been deleted. Go back to the dashboard and pick a workflow.');
        return true;
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
      try {
        await chatTurn(cfg, id, wf.name, message, selectedModel, emit);
      } catch (err) {
        emit({ kind: 'error', text: err.message });
      }
      res.end();
      return true;
    }

    const chatPage = req.url.match(/^\/chat\/([A-Za-z0-9_-]+)$/);
    if (chatPage) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderChatPage(chatPage[1]));
      return true;
    }

    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderDashboardPage(cfg));
      return true;
    }

    // safety: while the AI is editing a workflow, reject the student's own
    // saves to that workflow coming through the embedded editor
    const wfWrite = req.url.match(/^\/rest\/workflows\/([A-Za-z0-9_-]+)/);
    if (wfWrite && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && isBusy(wfWrite[1])) {
      res.writeHead(423, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'The AI is editing this workflow right now — wait for it to finish, then try again.' }));
      return true;
    }

    return false;
  };
}
