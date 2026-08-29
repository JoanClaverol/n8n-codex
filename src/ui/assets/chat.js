import { setupCollapse } from './chat/collapse.js';
import { setupModelPicker } from './chat/models.js';
import { streamChatTurn } from './chat/stream.js';

const { workflowId } = JSON.parse(document.getElementById('page-data').textContent);
const messages = document.getElementById('msgs');
const input = document.getElementById('inp');
const send = document.getElementById('send');
const canvas = document.getElementById('canvas');
const lock = document.getElementById('lock');
const rail = document.getElementById('rail');
const toolNames = {
  list_workflows: 'looking at your workflows',
  get_workflow: 'reading the workflow',
  update_workflow: 'saving to n8n',
};

const { notify } = setupCollapse({
  body: document.body,
  rail,
  collapseButton: document.getElementById('collapse'),
});
const modelPicker = setupModelPicker({
  workflowId,
  select: document.getElementById('model'),
  status: document.getElementById('model-status'),
});

fetch('/api/workflows').then((response) => response.json()).then((workflows) => {
  const workflow = workflows.find((entry) => entry.id === workflowId);
  document.getElementById('wfname').textContent = workflow ? workflow.name : workflowId;
}).catch(() => {});

// The chat is pinned to one workflow, but the student can steer the embedded
// n8n editor anywhere (another workflow, a brand-new draft, external pages).
// Reloading would clobber whatever they're doing there — and reading a
// cross-origin frame throws — so only touch the canvas when it still shows
// THIS workflow.
function canvasShowsThisWorkflow() {
  try {
    const path = canvas.contentWindow.location.pathname;
    return path === '/workflow/' + workflowId || path.startsWith('/workflow/' + workflowId + '/');
  } catch {
    return false; // cross-origin frame — definitely not our workflow
  }
}

// n8n navigates with pushState, so the iframe never fires `load` events for
// in-app moves — check at the moment that matters: when the student sends.
let warnedOffWorkflow = false;
function warnIfOffWorkflow() {
  if (canvasShowsThisWorkflow()) { warnedOffWorkflow = false; return; }
  if (warnedOffWorkflow) return;
  warnedOffWorkflow = true;
  add('msg bot', 'Heads-up: the canvas is showing a different page. This chat only edits "'
    + document.getElementById('wfname').textContent
    + '" — for another workflow, go back to the dashboard and open its own Chat.');
}

function add(className, text) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  messages.appendChild(element);
  messages.scrollTop = messages.scrollHeight;
  return element;
}

function handleEvent(event) {
  if (event.kind === 'tool') {
    add('tool', '⚙ ' + (toolNames[event.text] || event.text) + '…');
  } else if (event.kind === 'tool_done' && event.text === 'update_workflow' && event.ok) {
    if (canvasShowsThisWorkflow()) {
      add('tool', '✓ saved — updating the canvas');
      canvas.contentWindow.location.reload();
    } else {
      add('tool', '✓ saved — the canvas is showing something else, so it was left alone');
    }
    notify();
  } else if (event.kind === 'reply') {
    add('msg bot', event.text);
    notify();
  } else if (event.kind === 'error') {
    add('err', event.text);
  }
  messages.scrollTop = messages.scrollHeight;
}

document.getElementById('f').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message || send.disabled) return;

  input.value = '';
  send.disabled = true;
  const selectedModel = modelPicker.getSelectedModel();
  modelPicker.setBusy(true);
  lock.classList.add('on');
  add('msg user', message);
  warnIfOffWorkflow();
  const typing = add('typing', 'thinking…');

  try {
    await streamChatTurn({
      workflowId,
      message,
      model: selectedModel,
      onEvent: handleEvent,
    });
  } catch (err) {
    add('err', 'Connection lost: ' + err.message);
  } finally {
    typing.remove();
    send.disabled = false;
    modelPicker.setBusy(false);
    lock.classList.remove('on');
    input.focus();
  }
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.getElementById('f').requestSubmit();
  }
});
