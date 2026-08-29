const { n8nUrl } = JSON.parse(document.getElementById('page-data').textContent);

async function load() {
  const status = document.getElementById('status');
  try {
    const res = await fetch('/api/workflows');
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    const tbody = document.querySelector('#tbl tbody');
    tbody.innerHTML = '';
    for (const workflow of rows) {
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
    document.getElementById('tbl').hidden = false;
    status.textContent = rows.length + ' workflow(s).';
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
}

load();
