const STATIC_ROOT = '/_n8n-codex/static';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serializePageData(data) {
  return JSON.stringify(data)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export function renderDocument({ title, styles, body, script, pageData = {} }) {
  const stylesheetLinks = styles
    .map((name) => `<link rel="stylesheet" href="${STATIC_ROOT}/${name}">`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${stylesheetLinks}
</head>
<body>
${body}
<script id="page-data" type="application/json">${serializePageData(pageData)}</script>
<script type="module" src="${STATIC_ROOT}/${script}"></script>
</body>
</html>`;
}
