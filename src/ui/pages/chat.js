import { renderBrand } from '../brand.js';
import { renderDocument } from '../document.js';

function renderStage(id) {
  return `<div class="stage">
  <iframe id="canvas" src="/workflow/${encodeURIComponent(id)}" title="n8n canvas"></iframe>
  <div id="lock"><div>🔒 The AI is editing this workflow — the canvas unlocks when it's done.</div></div>
</div>`;
}

function renderRail() {
  return '<div id="rail" title="Open the chat"><span>💬 Chat</span><i class="dot"></i></div>';
}

function renderSidebar() {
  return `<aside>
  <header>
    ${renderBrand({ linked: true })}
    <span id="wfname" class="grow">…</span>
    <button id="collapse" type="button" title="Hide the chat">⟩</button>
  </header>
  <div class="model-bar">
    <label for="model">Model</label>
    <select id="model" disabled><option>Loading models…</option></select>
  </div>
  <div id="model-status" role="status"></div>
  <div id="msgs">
    <div class="msg bot">Hi! Tell me what this workflow should do and I'll build it — you'll see the canvas on the left update as I work. You can hide me with ⟩ while I work; I'll blink when there's news.</div>
  </div>
  <form id="f">
    <textarea id="inp" rows="2" placeholder="e.g. add an HTTP Request node that fetches a random joke" autofocus></textarea>
    <button class="primary" id="send" type="submit">Send</button>
  </form>
</aside>`;
}

export function renderChatPage(id) {
  return renderDocument({
    title: 'Chat — n8n-codex',
    styles: ['base.css', 'chat.css'],
    body: `${renderStage(id)}\n${renderRail()}\n${renderSidebar()}`,
    script: 'chat.js',
    pageData: { workflowId: id },
  });
}
