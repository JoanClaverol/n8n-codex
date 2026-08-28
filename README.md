# n8n-codex

Build [n8n](https://n8n.io) workflows by chatting with an AI — and watch the canvas
update live while you talk.

```
┌──────────────────────────────┬──────────────┐
│                              │  you:  add a │
│      n8n canvas (live)       │  joke node…  │
│                              │  ai: ✓ saved │
└──────────────────────────────┴──────────────┘
        one browser window, port 5680
```

## For students — one-time setup (~5 min)

You already have Docker and n8n running. Three more steps, copy-paste each line
into a terminal:

```sh
npm install -g @openai/codex      # 1. the AI assistant  (needs Node.js from nodejs.org)
codex login                       # 2. sign in with the ChatGPT account
git clone <this-repo-url> && cd n8n-codex && npm install -g .   # 3. this tool
```

## Every day after that

```sh
n8n-codex
```

That's it. It checks everything (and starts n8n for you if it's stopped), then opens
http://localhost:5680. Click **Chat** on a workflow and just say what you want:

> add an HTTP Request node that fetches a random joke from
> https://official-joke-api.appspot.com/random_joke and connect it after the trigger

The n8n canvas sits right next to the chat and refreshes itself every time the AI
saves. You can say things like "actually, undo that" or "explain what this workflow
does" — the conversation remembers context.

Keep the terminal window open while you work; Ctrl-C stops the tool.

---

## How it works (for the curious)

n8n stores workflows in a database, not files. `n8n-codex` exposes them to the
[Codex CLI](https://github.com/openai/codex) two ways:

- **MCP tools** (`list_workflows`, `get_workflow`, `update_workflow`) — registered
  automatically; any codex conversation can edit your workflows, including the
  dashboard chat, which drives `codex exec` behind the scenes.
- **A file bridge** — `n8n-codex <workflow-id>` pulls a workflow to
  `./n8n-workflows/<name>-<id>/workflow.json`, opens codex there, and auto-deploys
  every save. Useful when you want to see or hand-edit the JSON.

The dashboard also proxies n8n through its own port so the canvas can live in an
iframe beside the chat and reload after each save.

### Other ways to edit (optional)

- **Plain codex in a terminal** — codex has the n8n tools everywhere, so any codex
  conversation can say "add a Set node to my workflow <id>".
- **File-based session** — `n8n-codex <workflow-id>` (the id is in the n8n URL) pulls
  the workflow to `./n8n-workflows/<name>-<id>/workflow.json`, opens codex there, and
  auto-deploys every save. Good for inspecting or hand-editing the JSON.

### All commands

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

- **Edit in one place at a time.** While chatting or in a file session, don't also edit
  the same workflow in the n8n UI — the last save wins.
- Invalid JSON is never deployed; the session just shows `✗` and waits for the next save.
- If a workflow is **active**, toggle it off/on in the n8n UI after editing so its
  triggers reload.
- Credentials are never stored in `workflow.json` (only credential *references*), so the
  files are safe to share or commit.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Docker CLI not found` | Install/start Docker Desktop |
| `no n8n container found` | Start Docker Desktop; or `n8n-codex --container=<your-name>` |
| Chat says codex is not logged in | Run `codex login` once |
| `Port 5680 is already in use` | Dashboard already running — just open http://localhost:5680 |
| `codex not found on PATH` | `npm install -g @openai/codex` (session keeps watching meanwhile) |
| Changes not visible in n8n | Refresh the browser tab |
