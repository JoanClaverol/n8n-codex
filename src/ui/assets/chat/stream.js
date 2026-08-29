export async function streamChatTurn({ workflowId, message, model, onEvent }) {
  const response = await fetch('/api/chat/' + workflowId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(model ? { message, model } : { message }),
  });
  if (!response.ok) {
    const text = (await response.text()).trim();
    onEvent({ kind: 'error', text: text || `The server said no (HTTP ${response.status}) — try again.` });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}
