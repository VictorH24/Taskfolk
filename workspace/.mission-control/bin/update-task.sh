#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
VALUE="${2:-}"
NOTE="${3:-}"

MC_DIR=".mission-control"
TASK_FILE="$MC_DIR/inbox/current-task.json"
OUTBOX="$MC_DIR/outbox/task-events.jsonl"

if [ ! -f "$TASK_FILE" ]; then
  echo "No current task found at $TASK_FILE"
  exit 1
fi

TASK_ID=$(node -e "const t=require('./$TASK_FILE'); console.log(t.taskId || '')")
AGENT_ID=$(node -e "const t=require('./$TASK_FILE'); console.log(t.assignedAgentId || 'unknown-agent')")
EVENT_ID="agent_evt_$(date +%s%N)"
CREATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

mkdir -p "$(dirname "$OUTBOX")"
touch "$OUTBOX"

if [ "$ACTION" = "status" ]; then
  case "$VALUE" in
    in_progress|blocked|review)
      ;;
    *)
      echo "Invalid status: $VALUE"
      echo "Allowed statuses: in_progress, blocked, review"
      exit 1
      ;;
  esac

  if [ -z "$NOTE" ]; then
    echo "A note is required for status changes."
    exit 1
  fi

  node -e '
    const fs = require("fs");
    const event = {
      eventId: process.argv[1],
      taskId: process.argv[2],
      agentId: process.argv[3],
      type: "status_change",
      toStatus: process.argv[4],
      note: process.argv[5],
      createdAt: process.argv[6]
    };
    fs.appendFileSync(process.argv[7], JSON.stringify(event) + "\n");
  ' "$EVENT_ID" "$TASK_ID" "$AGENT_ID" "$VALUE" "$NOTE" "$CREATED_AT" "$OUTBOX"

  echo "Task status written: $VALUE"

elif [ "$ACTION" = "note" ]; then
  if [ -z "$VALUE" ]; then
    echo "Missing note text."
    exit 1
  fi

  node -e '
    const fs = require("fs");
    const event = {
      eventId: process.argv[1],
      taskId: process.argv[2],
      agentId: process.argv[3],
      type: "note",
      note: process.argv[4],
      createdAt: process.argv[5]
    };
    fs.appendFileSync(process.argv[6], JSON.stringify(event) + "\n");
  ' "$EVENT_ID" "$TASK_ID" "$AGENT_ID" "$VALUE" "$CREATED_AT" "$OUTBOX"

  echo "Task note written."

else
  echo "Usage:"
  echo "  .mission-control/bin/update-task status in_progress \"Starting task\""
  echo "  .mission-control/bin/update-task status blocked \"Blocked because...\""
  echo "  .mission-control/bin/update-task status review \"Ready for review\""
  echo "  .mission-control/bin/update-task note \"Progress note here\""
  exit 1
fi