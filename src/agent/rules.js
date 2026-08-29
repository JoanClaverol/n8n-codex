/**
 * Workflow-editing invariants shared by every agent flow (CLI session, web chat).
 * Framing-neutral: nothing here assumes file editing vs MCP tools.
 * mcp.js repeats the connection shape in its tool descriptions — keep in sync.
 */
export function workflowRules() {
  return `- Never change the top-level \`id\`.
- \`connections\` is keyed by node **name**. If you rename a node, update every
  occurrence of that name inside \`connections\` (both as key and as \`"node"\` target).
- Preserve each existing node's \`id\`. For brand-new nodes, generate a fresh UUID.
- Give every node a unique \`name\` and a sensible \`position\` \`[x, y]\`
  (place nodes left-to-right, ~220px apart).`;
}
