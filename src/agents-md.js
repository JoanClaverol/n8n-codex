export function agentsMd(wf) {
  return `# n8n workflow editing session

You are editing \`workflow.json\` — a live n8n workflow named **"${wf.name}"** (id \`${wf.id}\`).
Every time this file is saved, it is automatically validated and deployed to the user's
local n8n instance. There is no separate deploy step.

## Rules

- Keep the file valid JSON at all times. Invalid JSON is rejected and NOT deployed.
- Never change the top-level \`id\`.
- \`connections\` is keyed by node **name**. If you rename a node, update every
  occurrence of that name inside \`connections\` (both as key and as \`"node"\` target).
- Preserve each existing node's \`id\`. For brand-new nodes, generate a fresh UUID.
- Give every node a unique \`name\` and a sensible \`position\` \`[x, y]\`
  (place nodes left-to-right, roughly 200–250px apart).

## Workflow JSON structure

- Top level: \`{ id, name, nodes, connections, settings, ... }\`
- \`nodes\`: array of \`{ id, name, type, typeVersion, position, parameters }\`
- Common node types:
  - \`n8n-nodes-base.manualTrigger\`, \`n8n-nodes-base.scheduleTrigger\`, \`n8n-nodes-base.webhook\`
  - \`n8n-nodes-base.httpRequest\`, \`n8n-nodes-base.set\`, \`n8n-nodes-base.if\`, \`n8n-nodes-base.code\`
- The Code node's JavaScript lives in \`parameters.jsCode\` as a string.
- Connection shape:
  \`{ "<source node name>": { "main": [[ { "node": "<target node name>", "type": "main", "index": 0 } ]] } }\`
- Dynamic values in parameters use n8n expression syntax: \`"={{ $json.someField }}"\`.

## After each change

Remind the user to refresh their n8n browser tab to see the update on the canvas.
If the workflow is *active* (has live triggers), they should toggle it off and on
in the n8n UI so triggers reload.

After each save, check \`deploy.log\` (in this folder): a new \`✓ deployed\` line means
your change is live in n8n; a \`✗\` line explains why it was rejected — fix and save again.
`;
}
