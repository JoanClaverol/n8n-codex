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
const refresh = document.getElementById('refresh');
const greeting = messages.firstElementChild;
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

/** The saved workflow the canvas is showing right now, or null (dashboard
 * views, an unsaved /workflow/new draft, cross-origin pages). */
function canvasWorkflowId() {
  try {
    const match = canvas.contentWindow.location.pathname.match(/^\/workflow\/([A-Za-z0-9_-]+)/);
    return match && match[1] !== 'new' ? match[1] : null;
  } catch {
    return null; // cross-origin frame
  }
}

function resetChatContext(id) {
  return fetch('/api/chat/' + id + '/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

// ↻ — wipe the context and re-home the chat onto whatever saved workflow the
// canvas is showing. Cancels a running turn (its stream ends without an error).
refresh.addEventListener('click', async () => {
  refresh.disabled = true;
  try {
    const target = canvasWorkflowId();
    await resetChatContext(workflowId);
    if (target && target !== workflowId) {
      await resetChatContext(target); // the target may have old context of its own
      location.href = '/chat/' + target;
      return; // page reload finishes the switch
    }
    messages.replaceChildren(greeting);
    warnedOffWorkflow = false;
    if (!target) {
      add('msg bot', 'Fresh start! The canvas isn\u2019t on a saved workflow right now, so I\u2019m still on "'
        + document.getElementById('wfname').textContent + '".');
    } else {
      add('msg bot', 'Fresh start! I\u2019ve forgotten our earlier conversation.');
    }
  } catch {
    add('err', 'Could not reset the chat — is the dashboard still running?');
  } finally {
    refresh.disabled = false;
  }
});

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
