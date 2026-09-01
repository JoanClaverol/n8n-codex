const { n8nUrl } = JSON.parse(document.getElementById('page-data').textContent);

const status = document.getElementById('status');
const search = document.getElementById('search');
let workflows = [];

function render() {
  const query = search.value.trim().toLowerCase();
  const shown = query
    ? workflows.filter((workflow) =>
        workflow.name.toLowerCase().includes(query) || workflow.id.toLowerCase().includes(query))
    : workflows;

  const tbody = document.querySelector('#tbl tbody');
  tbody.innerHTML = '';
  for (const workflow of shown) {
    const tr = document.createElement('tr');
    const td = (className) => {
      const element = document.createElement('td');
      if (className) element.className = className;
      tr.appendChild(element);
      return element;
    };

    // textContent, never innerHTML — workflow names are untrusted
    const name = td('name');
    name.textContent = workflow.name;
    name.appendChild(document.createElement('br'));
    const idElement = document.createElement('code');
    idElement.textContent = workflow.id;
    name.appendChild(idElement);
    td().textContent = workflow.nodes;

    const badge = document.createElement('span');
    badge.className = 'badge' + (workflow.active ? ' on' : '');
    badge.textContent = workflow.active ? 'active' : 'inactive';
    td().appendChild(badge);

    const chat = document.createElement('a');
    chat.className = 'btn primary';
    chat.href = '/chat/' + encodeURIComponent(workflow.id);
    chat.textContent = 'Chat';
    td().appendChild(chat);

    const open = document.createElement('a');
    open.className = 'btn';
    open.target = '_blank';
    open.href = n8nUrl + '/workflow/' + encodeURIComponent(workflow.id);
    open.textContent = 'Open in n8n';
    td().appendChild(open);
    tbody.appendChild(tr);
  }

  document.getElementById('tbl').hidden = shown.length === 0;
  if (!query) status.textContent = workflows.length + ' workflow(s).';
  else if (shown.length) status.textContent = shown.length + ' of ' + workflows.length + ' workflow(s).';
  else status.textContent = 'No workflows match "' + search.value.trim() + '".'; // textContent — query stays inert
}

async function load() {
  try {
    const res = await fetch('/api/workflows');
    if (!res.ok) throw new Error(await res.text());
    workflows = await res.json();
    search.hidden = false;
    search.focus();
    render();
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
}

search.addEventListener('input', render);
search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    search.value = '';
    render();
  }
});
load();
