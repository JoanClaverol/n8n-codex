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
<details class="help">
  <summary>What does “active” mean?</summary>
  <p><b>Active</b> means the workflow's triggers are switched on: schedules fire and
  webhooks answer on their own, without you pressing anything. <b>Inactive</b>
  workflows only run when you test them manually in the editor. Any number of
  workflows can be active at the same time — each one listens independently.</p>
  <p>The badge saves the on/off state straight to n8n. One catch: the running n8n
  only re-arms its triggers when the change happens inside its own editor. So after
  toggling here — or after the AI edits an <b>active</b> workflow — flip the switch
  off and on in the n8n editor, or restart n8n (<code>docker compose restart</code>),
  to make the triggers really start or stop.</p>
</details>
<input id="search" type="search" placeholder="Search workflows by name or ID…" hidden>
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
