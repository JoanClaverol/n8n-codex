// The dashboard must render hostile workflow names as inert text: run the
// page's actual inline script in a stub DOM and feed it attacker-controlled
// names. (This is the client half of the workflow-name XSS fix.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { startDashboard } from './helpers.js';

const HOSTILE = '<img src=x onerror=alert(1)><script>alert(2)</script>';

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.className = '';
    this.hidden = false;
    this._text = '';
    this._html = '';
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  appendChild(c) { this.children.push(c); return c; }
}

test('workflow names render as text, never as markup', async (t) => {
  const { url } = await startDashboard(t);
  const page = await fetch(url + '/');
  assert.equal(page.status, 200);
  const html = await page.text();
  const scriptPath = html.match(/<script[^>]+src="([^"]*dashboard\.js)"/)?.[1];
  assert.ok(scriptPath, 'dashboard page references its browser script');
  const scriptResponse = await fetch(url + scriptPath);
  assert.equal(scriptResponse.status, 200);
  const script = await scriptResponse.text();

  const created = [];
  const htmlWrites = [];
  const pageData = new El('script');
  pageData.textContent = JSON.stringify({ n8nUrl: 'http://localhost:5678' });
  const byId = { status: new El('p'), tbl: new El('table'), 'page-data': pageData };
  const tbody = new El('tbody');
  Object.defineProperty(tbody, 'innerHTML', {
    set(v) { htmlWrites.push(String(v)); this.children = []; },
  });
  Object.defineProperty(El.prototype, 'innerHTML', {
    set(v) { htmlWrites.push(String(v)); },
    configurable: true,
  });

  const rows = [{ id: 'abc123', name: HOSTILE, nodes: 2, active: false }];
  const ctx = vm.createContext({
    document: {
      getElementById: (id) => byId[id],
      querySelector: (sel) => (sel === '#tbl tbody' ? tbody : null),
      createElement: (tag) => { const el = new El(tag); created.push(el); return el; },
    },
    fetch: async () => ({ ok: true, json: async () => rows, text: async () => '' }),
  });
  vm.runInContext(script, ctx);
  await new Promise((r) => setTimeout(r, 20)); // let async load() settle

  assert.equal(byId.status.textContent, '1 workflow(s).', 'script ran to completion');
  const nameTd = tbody.children[0]?.children.find((c) => c.className === 'name');
  assert.ok(nameTd, 'name cell was built');
  assert.equal(nameTd._text, HOSTILE, 'hostile name stored as plain text');
  assert.ok(!created.some((el) => el.tagName === 'IMG' || el.tagName === 'SCRIPT'),
    'no element was ever created from the name');
  assert.ok(!htmlWrites.some((h) => h.includes('<img') || h.includes(HOSTILE)),
    'hostile name never flows through innerHTML');
});
