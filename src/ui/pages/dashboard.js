import { renderBrand } from '../brand.js';
import { renderDocument } from '../document.js';

function renderWorkflowTable() {
  return `<table id="tbl" hidden>
  <thead><tr><th>Workflow</th><th>Nodes</th><th>Status</th><th></th><th></th></tr></thead>
  <tbody></tbody>
</table>`;
}

export function renderDashboardPage(cfg) {
  const body = `${renderBrand()}
<p class="sub">Click <b>Chat</b> on a workflow to build it by talking to the AI — you'll see the canvas update live.</p>
<p id="status">Loading workflows…</p>
${renderWorkflowTable()}`;

  return renderDocument({
    title: 'n8n-codex',
    styles: ['base.css', 'dashboard.css'],
    body,
    script: 'dashboard.js',
    pageData: { n8nUrl: cfg.n8nUrl },
  });
}
