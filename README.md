# Taskfolk

Taskfolk is a visual mission control dashboard that lets you watch your AI team at work.

![Taskfolk pixel office](docs/taskfolk_day.gif)


## Features

- 2D office-style OpenClaw agent dashboard on the landing page.
- At-a-glance active, idle, and blocked agent states.
- Light/dark/system theme toggle retained from the folder app.
- Folder view switch retains upload, download, preview, edit, and archive features.
- Optional `OPENCLAW_AGENTS_JSON` environment variable to feed live agent status data.
- Agent view refreshes live by default and bypasses cached `/api/agents` responses.

## Run locally

```bash
npm install
npm start
```

Open <http://localhost:3000>.

## Taskfolk desktop companion

Taskfolk includes an Electron companion that shows the pixel office in a small native window. Left-click and drag anywhere inside the window to move it; a narrow six-pixel edge remains reserved for resizing. The window remembers separate bounds for each display mode, can stay above other windows, and keeps running from the system tray or menu bar.

The packaged desktop app uses the universal digital-agent icon at `desktop/icon.png` for application windows, the Dock, and installers.

Launch the desktop app:

```bash
npm run desktop
```

On first launch, choose one of two office sources:

- **Run in this app** starts a private Taskfolk server bound to a random loopback port. It requires no separately running server and currently offers local OpenCode and VS Code Copilot agents only. Local server data is kept in the desktop app's user-data directory, and a new private gateway token is generated for every app launch.
- **Connect to a remote server** uses a running Taskfolk URL (for example `http://127.0.0.1:3000`), its gateway token, and optional gateway password. The companion exchanges those credentials for the normal Taskfolk session cookie.

Remote credentials are never placed in the URL and are encrypted with Electron `safeStorage` when operating-system encryption is available. You can switch office sources later from **Setup**.

For managed or temporary launches, settings can be supplied without saving them:

```bash
TASKFOLK_URL=http://127.0.0.1:3000 \
TASKFOLK_TOKEN=your-gateway-token \
npm run desktop
```

Set `TASKFOLK_PASSWORD` too when the gateway requires one. Environment credentials take precedence over saved settings for that launch.

### Track OpenCode Desktop and terminal sessions

The desktop companion can publish local OpenCode activity into the connected Taskfolk dashboard. OpenCode Desktop is detected automatically while it is running. The companion reads session title, workspace, model, agent, completion state, and timestamps from OpenCode's local SQLite database; it does not read prompts, message text, tool output, or credentials.

For OpenCode terminal sessions, start the TUI on a fixed loopback port so the companion can attach to the same session server:

```bash
opencode --port 4096
```

In **Setup**, enable **Track OpenCode Desktop and terminal sessions**, then choose **One agent per project** or **One agent for all projects**. The adapter merges automatically discovered Desktop activity with the terminal server's `/session/status` and `/session` endpoints, sends normalized session metadata to Taskfolk, and removes runtime agents when OpenCode becomes unavailable. Each grouping mode keeps its own stable avatar configuration.

Each OpenCode project gets its own stable avatar configuration key, so it keeps an independent avatar across new sessions and restarts even though OpenCode changes the underlying session ID. Up to 24 recently active projects can appear at once. The Config page automatically migrates the former global and older per-session OpenCode assignments onto discovered projects. Use **Disable** to hide a project while preserving its configuration, or **Remove** to forget its avatar and task settings and drop it from the current discovery snapshot. A removed project can reappear with the default configuration the next time OpenCode publishes it.

If the OpenCode server uses HTTP Basic authentication, enter its username and password in Setup. The default username is `opencode`. The password is encrypted with Electron `safeStorage` when operating-system encryption is available. Managed launches can provide `OPENCODE_SERVER_USERNAME` and `OPENCODE_SERVER_PASSWORD` instead.

### Track Visual Studio Code Copilot chats

The desktop companion can also publish GitHub Copilot chat activity from Visual Studio Code and Visual Studio Code Insiders. In **Setup**, enable **Track Visual Studio Code Copilot chats**, then choose **One agent per project** or **One agent for all projects**. No Copilot server, token, or additional VS Code extension is required.

This connector reads VS Code's local, machine-scoped chat index and session file timestamps in read-only mode. It uses only the workspace identity, session title, empty-session flag, and timestamps needed to build Taskfolk agents. It does not load or publish prompt bodies, response text, tool output, attachments, or Copilot credentials. Sessions are shown only while VS Code is running, empty chats are ignored, and each workspace keeps a stable avatar configuration key across chat sessions and restarts.

The Taskfolk server keeps desktop-published runtime agents in memory and expires them after 90 seconds without an update. Override this with `RUNTIME_AGENT_TTL_MS` if needed.

The setup page can choose between the full office and a single live avatar on a transparent background. In avatar mode, choose which connected agent to display; its pose continues to update from the live agent state. The setup page also controls window opacity from 25% to 100%.

Choose **Most recently updated (automatic)** in Setup or the single-avatar right-click menu to follow agent activity automatically. On every live refresh, the companion compares the agents' latest activity timestamps and switches to the avatar whose status or session data changed most recently.

In single-avatar mode, transparent pixels are click-through: clicks and scrolling pass to the application underneath. Opaque avatar pixels remain interactive so they can be dragged or right-clicked to open the companion menu.

The single-avatar right-click menu includes **Avatar Size** presets for Tiny (120×150), Extra Small (150×190), Small (220×280), Medium (300×380), Large (420×540), and Extra Large (560×720). Presets resize around the current window center, remain inside the active screen, and are remembered for the next launch.

Setup also accepts a custom avatar width and height. Values are constrained to 120–1200 pixels wide and 150–1200 pixels high. Use **Reset to 300 × 380** to restore the default avatar dimensions before applying the settings.

Right-click anywhere in the companion window to switch back to **Office View**, choose a different agent from **Single Avatar**, change an opacity preset, open **Setup** or the full **Config** page, reload, hide, toggle **Always on Top**, or quit. Setup and Config are also available from the **Office** application menu and tray icon. Config opens in a separate authenticated desktop window and works with both local and remote office modes.

When changing views or reloading, the companion hides the remote page immediately, displays an animated loading indicator, waits for the office or avatar artwork to finish rendering, and then fades the completed view into place.

The web dashboard's dedicated companion displays can also be opened directly after logging in:

- Full office: `/index.html?companion=1`
- One avatar: `/index.html?companion=1&companionView=avatar&agent=AGENT_ID`

To produce an installer for the current platform:

```bash
npm run desktop:dist
```

Installers are written to `dist/`, which is gitignored.

## Run in docker

docker compose up -d --build

## Gateway login

Taskfolk supports the same auth shape as OpenClaw gateway config:

```json
{
  "gateway": {
    "auth": {
      "token": "required-token",
      "password": "optional-password"
    }
  }
}
```

When `gateway.auth.token` exists, the web UI and app APIs require a browser login. If `gateway.auth.password` also exists, login requires both values.

For Docker Compose, put the values in a project `.env` file:

```dotenv
GATEWAY_AUTH_TOKEN=required-token
GATEWAY_AUTH_PASSWORD=optional-password
GATEWAY_AUTH_SECURE_COOKIE=false
```

Docker Compose reads that `.env` file for the `${GATEWAY_AUTH_*}` substitutions in `docker-compose.yml`, and the service maps them into Taskfolk auth. Env values take precedence over `gateway.auth.*` in the mounted `openclaw.json`, so you can keep secrets outside the config file.

Leave `GATEWAY_AUTH_SECURE_COOKIE=false` for local plain-HTTP access such as `http://127.0.0.1:3000`. Set it to `true` only when the page is served over HTTPS.

## Agent data

The dashboard reads OpenClaw data from the mounted runtime paths:

- `OPENCLAW_CONFIG_PATH` — defaults to `/config/openclaw.json`
- `OPENCLAW_LOG_DIR` — defaults to `/tmp/openclaw`
- `OPENCLAW_SESSIONS_DIR` — defaults to `/openclaw-agents`

It reads configured agents from `openclaw.json`, then overlays safe session metadata from mounted OpenClaw `sessions.json` files and recent gateway logs. Session stores are expected at paths like `/openclaw-agents/<agentId>/sessions/sessions.json`; transcript `.jsonl` files are not required. Recent errors mark an agent as blocked.

For local demos or overrides, set `OPENCLAW_AGENTS_JSON` to an array:

```json
[
  { "id": "main", "name": "Main Agent", "role": "Coordinator", "status": "active", "task": "Working item 7", "x": 24, "y": 52 }
]
```

`status` can be `active`, `idle`, or `blocked`. If no config or logs are available, the UI falls back to sample agents.

The office scene config can include `emptyDesks` to reserve desk slots in the pixel office. Manage it from the Config page's Pixel office controls, or set it in the saved avatar scene config:

```json
{
  "officeScene": { "floor": "wood", "windowView": "sf", "poster": 10, "emptyDesks": 2 }
}
```

`poster` is a zero-based index for files in `public/office-scenes/posters`, so `10` renders `poster11.jpeg`.

## Manual agents

The Config page at `/avatar-legend.html` can add agents that do not come from logs or OpenClaw session stores. Use **Add agent** at the bottom of the live agent list, then choose an avatar variant, set the display name, and copy the generated token. Manual agents can be disabled without deleting their token or avatar assignment; disabled manual agents stay editable on the Config page but are omitted from the office view and cannot update status. Manual agents are saved in `avatar-assignments.json` alongside avatar assignments:

```json
{
  "assignments": { "manual-example": 2 },
  "manualAgents": [
    { "id": "manual-example", "name": "Manual Example", "token": "generated-token", "enabled": true }
  ]
}
```

Manual agents update their current office state through the agent state API:

```bash
curl -X POST http://localhost:3000/api/agent-state \
  -H 'Content-Type: application/json' \
  -d '{"token":"generated-token","state":"Working","task":"Handling queue item 42"}'
```

You can also pass the token as `X-Agent-Token` and omit `token` from the JSON body. The accepted states are `Working`, `Blocked`, `Sleeping`, `Reading`, `Gaming`, `Coffee break`, `Listening`, and `Walking`. API calls update `state.json` in `CONFIG_DIR` (default `/config/state.json`), and `/api/agents` merges that file into the office view so manual agents appear beside detected agents.

### Agent status skill

This repo includes a reusable skill at `skills/taskfolk-agent-status/SKILL.md` for agents that should update their own office status. Add the manual agent token to that agent's environment as `TASKFOLK_AGENT_TOKEN`; optionally set `TASKFOLK_AGENT_STATUS_URL` if Taskfolk is not at `http://localhost:3000/api/agent-state`.

Add this to the agent's `SOUL.MD`:

```md
Use the `taskfolk-agent-status` skill for every task. Set your Taskfolk status to Working before beginning work, and set it to Sleeping before sending the final response.
```

### Status calculation

Taskfolk starts from configured agents in `openclaw.json` and overlays matching session/log activity:

- The primary source is `agents.list[]` in `openclaw.json`; each entry uses `id` and `name` for the dashboard card.
- If `agents.list[]` is missing, config entries under agent-like containers such as `agents`, `agentProfiles`, `agentConfigs`, `assistants`, or `sessions` are used as a fallback.
- Mounted `sessions.json` files are matched by their path, `agentId` fields, or session keys like `agent:<id>:...`; the newest available session timestamp (including nested message/run metadata and file modification time) becomes the agent's last activity.
- Log lines are matched by fields like `agentId`, `agent_id`, `agent`, `agentName`, `sessionKey`, `session`, `label`, or `name`.
- `active`: latest matching session or log timestamp is within `AGENT_ACTIVE_MS` (default 2 minutes).
- `idle`: configured agent has no matching runtime activity, or latest activity is older than the active window.
- `blocked`: latest task/log text contains `error`, `failed`, `failure`, `exception`, `blocked`, or `fatal`.

If a log line has no timestamp, the log file modification time is used as a fallback. The `/api/agents` response includes `statusRules` so the UI/API makes these thresholds visible.
