export const HELP = `n8n-codex — edit n8n workflows with the Codex CLI

Usage:
  n8n-codex                    open the dashboard (pick a workflow visually)
  n8n-codex <workflow-id>      pull workflow, launch codex, auto-deploy on save
  n8n-codex list               list workflows in your n8n
  n8n-codex pull <id>          just download workflow.json (+ AGENTS.md)
  n8n-codex push <id>          deploy your local workflow.json
  n8n-codex watch <id>         auto-deploy on save, without launching codex
  n8n-codex restore <id>       undo the AI's last saved change (repeat to go further back)
  n8n-codex setup              register the n8n MCP server with codex (run once)
  n8n-codex mcp                run the MCP server (codex launches this itself)

Options:
  --container=<name>   n8n Docker container name        (default: n8n)
  --n8n-url=<url>      n8n editor URL                   (default: http://localhost:5678)
  --dir=<path>         where workflow folders are kept  (default: ./n8n-workflows)
  --port=<n>           dashboard port                   (default: 5680)
  --no-codex           watch only; don't launch codex
  --no-open            don't auto-open the dashboard in a browser
`;
