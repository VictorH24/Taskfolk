cron script

task may be assigned to you.

First, read this file:

.mission-control/inbox/current-task.json

Current detected task:

Task ID: $TASK_ID
Title: $TITLE
Status: $STATUS
Assigned agent: $AGENT_ID

Your job:

1. Read .mission-control/inbox/current-task.json.
2. Check .mission-control/outbox/task-events.jsonl to see whether this task already has a status_change event.
3. If this task has no status_change event yet, run:

   .mission-control/bin/update-task status in_progress "Starting task: $TITLE"

4. Work on the task described in current-task.json.
5. When you find something important, run:

   .mission-control/bin/update-task note "Progress update here"

6. If you are blocked, run:

   .mission-control/bin/update-task status blocked "Blocked because..."

7. When the task is completed, do not mark it done. Run:

   .mission-control/bin/update-task status review "Work completed. Ready for review."

Rules:

- Never use status done.
- Allowed statuses are only: in_progress, blocked, review.
- Always include a useful note.
- Do not edit Mission Control central files.
- Do not rewrite task-events.jsonl manually unless the helper script fails.
- Use .mission-control/bin/update-task to update the Kanban board.

Now check the assigned task and proceed.