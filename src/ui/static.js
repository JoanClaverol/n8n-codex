import { readFileSync } from 'node:fs';

const ROOT = new URL('./assets/', import.meta.url);
const CONTENT_TYPES = new Map([
  ['base.css', 'text/css; charset=utf-8'],
  ['dashboard.css', 'text/css; charset=utf-8'],
  ['dashboard.js', 'text/javascript; charset=utf-8'],
  ['chat.css', 'text/css; charset=utf-8'],
  ['chat.js', 'text/javascript; charset=utf-8'],
  ['chat/collapse.js', 'text/javascript; charset=utf-8'],
  ['chat/models.js', 'text/javascript; charset=utf-8'],
  ['chat/stream.js', 'text/javascript; charset=utf-8'],
]);

const ASSETS = new Map(
  [...CONTENT_TYPES].map(([name, contentType]) => [
    `/_n8n-codex/static/${name}`,
    { contentType, body: readFileSync(new URL(name, ROOT)) },
  ]),
);

export function getUiAsset(url) {
  return ASSETS.get(url.split('?', 1)[0]) || null;
}
