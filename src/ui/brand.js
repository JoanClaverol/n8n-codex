export function renderBrand({ linked = false } = {}) {
  const name = '<span>n8n</span>-codex';
  return linked ? `<h1><a href="/">${name}</a></h1>` : `<h1>${name}</h1>`;
}
