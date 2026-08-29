export function setupModelPicker({ workflowId, select, status }) {
  const storageKey = 'n8n-codex-model:' + workflowId;
  let catalog = [];
  let ready = false;
  let busy = false;

  const updateDisabled = () => {
    select.disabled = busy || !ready;
  };

  fetch('/api/models').then((response) => {
    if (!response.ok) throw new Error('request failed');
    return response.json();
  }).then(({ models, warning }) => {
    if (!Array.isArray(models) || !models.length) {
      throw new Error(warning || 'No models returned');
    }

    catalog = models;
    select.replaceChildren();
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.displayName;
      select.appendChild(option);
    }

    const saved = localStorage.getItem(storageKey);
    const selected = models.find((model) => model.id === saved)
      || models.find((model) => model.isDefault)
      || models[0];
    select.value = selected.id;
    if (saved && saved !== selected.id) localStorage.removeItem(storageKey);
    status.textContent = selected.description;
    ready = true;
    updateDisabled();
  }).catch(() => {
    const option = document.createElement('option');
    option.textContent = 'Codex default';
    select.replaceChildren(option);
    ready = false;
    updateDisabled();
    status.textContent = 'Model list unavailable — using the Codex default.';
  });

  select.addEventListener('change', () => {
    localStorage.setItem(storageKey, select.value);
    status.textContent = catalog.find((model) => model.id === select.value)?.description || '';
  });

  return {
    getSelectedModel() {
      return ready ? select.value : null;
    },
    setBusy(value) {
      busy = value;
      updateDisabled();
    },
  };
}
