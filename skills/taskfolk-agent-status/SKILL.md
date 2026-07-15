---
name: taskfolk-agent-status
description: Use this skill when an agent should publish its current Taskfolk avatar status through the agent status API, especially from SOUL.MD instructions that require setting Working before a task and Sleeping before finishing.
---

# Taskfolk Agent Status

Use this skill to keep the Taskfolk office view in sync with what the agent is doing.

## Required configuration

The agent needs:

- `TASKFOLK_AGENT_TOKEN`: the token shown for the manual agent in `avatar-legend.html`
- `TASKFOLK_AGENT_STATUS_URL`: optional; defaults to `http://localhost:3000/api/agent-state`

Never invent or expose a token. If no token is configured, continue the task and mention that status updates were skipped.

## Status lifecycle

Before starting any user task, update the agent to `Working`.

Before sending the final response, update the agent to `Sleeping`.

If the task becomes blocked, update to `Blocked` with a short task/message explaining the blocker.

## Accepted states

Only send one of these states:

- `Working`
- `Blocked`
- `Sleeping`
- `Reading`
- `Gaming`
- `Coffee break`
- `Listening`
- `Walking`

## API call

Prefer the bundled Python helper when Python is available:

```bash
python3 skills/taskfolk-agent-status/scripts/update_status.py \
  --state Working \
  --task "Starting task"
```

The helper reads `TASKFOLK_AGENT_TOKEN` and `TASKFOLK_AGENT_STATUS_URL` from the environment. You can also pass all API inputs as parameters:

```bash
python3 skills/taskfolk-agent-status/scripts/update_status.py \
  --url "http://localhost:3000/api/agent-state" \
  --token "$TASKFOLK_AGENT_TOKEN" \
  --state Working \
  --task "Starting task"
```

If Python is unavailable, send a JSON `POST` request with curl:

```bash
curl -sS -X POST "${TASKFOLK_AGENT_STATUS_URL:-http://localhost:3000/api/agent-state}" \
  -H "Content-Type: application/json" \
  -d '{"token":"'"$TASKFOLK_AGENT_TOKEN"'","state":"Working","task":"Starting task"}'
```

The `task` field is optional but recommended. Keep it short because it appears in the office view.

## Workflow

1. At task start, call the API with `state: "Working"` and a concise `task`. Use `scripts/update_status.py` if Python is available.
2. Do the requested work.
3. If blocked, call the API with `state: "Blocked"` and describe the blocker.
4. Before the final response, call the API with `state: "Sleeping"` and a task like `Task complete`.

## Minimal helpers

Python:

```bash
python3 skills/taskfolk-agent-status/scripts/update_status.py --state Working --task "Starting task"
```

Then before finishing:

```bash
python3 skills/taskfolk-agent-status/scripts/update_status.py --state Sleeping --task "Task complete"
```

Curl fallback:

```bash
status_url="${TASKFOLK_AGENT_STATUS_URL:-http://localhost:3000/api/agent-state}"
curl -sS -X POST "$status_url" \
  -H "Content-Type: application/json" \
  -d '{"token":"'"$TASKFOLK_AGENT_TOKEN"'","state":"Working","task":"Starting task"}'
```

Then before finishing:

```bash
status_url="${TASKFOLK_AGENT_STATUS_URL:-http://localhost:3000/api/agent-state}"
curl -sS -X POST "$status_url" \
  -H "Content-Type: application/json" \
  -d '{"token":"'"$TASKFOLK_AGENT_TOKEN"'","state":"Sleeping","task":"Task complete"}'
```

If the API call fails, do not retry endlessly and do not let status updates prevent completion of the user task.
