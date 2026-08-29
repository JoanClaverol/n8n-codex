const STORAGE_KEY = 'n8n-codex-collapsed';

export function setupCollapse({ body, rail, collapseButton }) {
  const setCollapsed = (collapsed) => {
    body.classList.toggle('collapsed', collapsed);
    if (!collapsed) rail.classList.remove('unread');
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '');
  };

  collapseButton.addEventListener('click', () => setCollapsed(true));
  rail.addEventListener('click', () => setCollapsed(false));
  if (localStorage.getItem(STORAGE_KEY)) setCollapsed(true);

  return {
    notify() {
      if (body.classList.contains('collapsed')) rail.classList.add('unread');
    },
  };
}
