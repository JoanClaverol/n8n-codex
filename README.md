# n8n-codex

Edit your local [n8n](https://n8n.io) workflows with the [Codex CLI](https://github.com/openai/codex).

n8n stores workflows inside a database, not as files — so AI coding tools can't touch them
directly. `n8n-codex` bridges that gap: it pulls a workflow out of n8n into a real
`workflow.json`, launches Codex in that folder (with instructions on how n8n workflows work),
and **auto-deploys every save back to n8n**.

```
┌─────────┐  pull   ┌────────────────┐  edit   ┌───────┐
│   n8n   │ ──────► │ workflow.json  │ ◄────── │ codex │
│ (Docker)│ ◄────── │  + AGENTS.md   │         └───────┘
└─────────┘ deploy  └────────────────┘
            on save
```

## Prerequisites

1. **Docker Desktop** running n8n in a container named `n8n`:
   ```sh
   docker volume create n8n_data
   docker run -d --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
   ```
2. **Node.js 18+** — https://nodejs.org
3. **Codex CLI** — `npm install -g @openai/codex`, then `codex login`

## Install

```sh
git clone <this-repo-url>
cd n8n-codex
npm install -g .
n8n-codex setup        # registers the n8n MCP server with codex (once)
```

Works on macOS, Windows, and Linux. To update later: `git pull && npm install -g .`
inside the folder.

## Use

**Easiest path — the dashboard:**

```sh
n8n-codex
```

Opens http://localhost:5680 with a list of your workflows. Click **Chat** on the one
you want and just talk to it:

> add an HTTP Request node that fetches a random joke from
> https://official-joke-api.appspot.com/random_joke and connect it after the trigger

The AI reads and updates the workflow in n8n directly (via MCP tools) and tells you
when it saved. Refresh the n8n tab to see each change. The conversation remembers
context, so "actually, undo that" works.

**Prefer the terminal?** Two more ways, same result:

- `codex` anywhere — after `n8n-codex setup`, Codex has `list_workflows`,
  `get_workflow`, and `update_workflow` tools. Say "add a Set node to my workflow
  <id>" in any codex conversation.
- A file-based session (see below) if you want to inspect or hand-edit the JSON.

**File-based session, if you know the workflow id** (it's in the n8n URL:
`http://localhost:5678/workflow/<id>`):

```sh
n8n-codex 8ttNSVVkk2MYIaCf
```

This pulls the workflow to `./n8n-workflows/<name>-<id>/workflow.json` and opens Codex
there. Ask Codex things like:

> add an HTTP Request node that fetches a random joke from
> https://official-joke-api.appspot.com/random_joke and connect it after the trigger

Every time Codex (or you) saves `workflow.json`, it is validated and deployed to n8n.
**Refresh the n8n browser tab** to see changes on the canvas.

### Other commands

```sh
n8n-codex list          # all workflows with ids
n8n-codex pull <id>     # just download workflow.json
n8n-codex push <id>     # deploy your local workflow.json
n8n-codex watch <id>    # auto-deploy on save, use your own editor instead of codex
n8n-codex --help        # all options (custom container name, ports, folders)
n8n-codex setup         # register the n8n MCP server with codex (run once)
n8n-codex mcp           # the MCP server itself (codex launches this; not for humans)
```

## Rules of the road

- **Edit in one place at a time.** While a session is running, don't also edit the same
  workflow in the n8n UI — the file wins on save, the UI wins on the next pull.
- Invalid JSON is never deployed; the session just shows `✗` and waits for the next save.
- If a workflow is **active**, toggle it off/on in the n8n UI after editing so its
  triggers reload.
- Credentials are never stored in `workflow.json` (only credential *references*), so the
  files are safe to share or commit.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Docker CLI not found` | Install/start Docker Desktop |
| `No Docker container named "n8n"` | Run the `docker run` command from Prerequisites |
| Chat says codex is not logged in | Run `codex login` once |
| `Port 5680 is already in use` | Dashboard already running — just open http://localhost:5680 |
| `codex not found on PATH` | `npm install -g @openai/codex` (session keeps watching meanwhile) |
| Changes not visible in n8n | Refresh the browser tab |
| Different container name | `n8n-codex --container=my-n8n <id>` |
