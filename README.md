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

## For students — one-time setup (~10 min)

This repo contains the full course n8n installation. You need
[Docker Desktop](https://www.docker.com/products/docker-desktop/) (pick the
installer for your chip — see the Module 3 lesson) and
[Node.js](https://nodejs.org). Then copy-paste each line into a terminal:

```sh
git clone https://github.com/JoanClaverol/n8n-codex.git && cd n8n-codex
docker compose up -d              # 1. install & start n8n  (container "n8n", port 5678,
                                  #    persistent volume "n8n_data", course env vars)
npm install -g @openai/codex      # 2. the AI assistant
codex login                       # 3. sign in with the ChatGPT account
npm install -g .                  # 4. this tool
```

First time only: open http://localhost:5678 and create the n8n owner account
(email, name, password with 8+ characters, a number, and a capital letter).

Already installed n8n by hand following the lesson? `docker compose up -d`
adopts your existing `n8n_data` volume — nothing is lost. Timezone or version
overrides go in `.env` (copy `.env.example`).

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

## Safety

- **The canvas locks while the AI works.** During a chat turn the embedded editor is
  covered by a lock screen, and any save you attempt to that workflow is rejected
  until the AI finishes — no more two-writers accidents.
- **Every AI change is backed up first.** Before each save, the previous state is
  snapshotted to `~/.n8n-codex/backups/<workflow-id>/` (the newest 30 are kept).
- **Undo from the terminal:** `n8n-codex restore <id>` puts back the state before the
  last saved change; run it again to go further back.
- You can hide the chat with the ⟩ button — the AI keeps working, the canvas keeps
  updating, and the 💬 rail blinks when there's a new reply.
- Invalid workflow JSON is never deployed — it's rejected with an error instead.
- If a workflow is **active**, toggle it off/on in the n8n UI after editing so its
  triggers reload.
- Credentials are never stored in workflow JSON (only credential *references*), so
  the files are safe to share or commit.


## Troubleshooting

| Symptom | Fix |
|---|---|
| `Docker CLI not found` | Install/start Docker Desktop |
| `no n8n container found` | `docker compose up -d` in this folder; or `n8n-codex --container=<your-name>` |
| Chat says codex is not logged in | Run `codex login` once |
| `Port 5680 is already in use` | Dashboard already running — just open http://localhost:5680 |
| `codex not found on PATH` | `npm install -g @openai/codex` (session keeps watching meanwhile) |
| Changes not visible in n8n | Refresh the browser tab |
