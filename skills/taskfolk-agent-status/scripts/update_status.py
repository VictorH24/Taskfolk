#!/usr/bin/env python3
"""Update a Taskfolk manual agent status."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


ACCEPTED_STATES = {
    "Working",
    "Blocked",
    "Sleeping",
    "Reading",
    "Gaming",
    "Coffee break",
    "Listening",
    "Walking",
}

DEFAULT_URL = "http://localhost:3000/api/agent-state"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update a Taskfolk agent status.")
    parser.add_argument("--state", required=True, help="Agent state to publish.")
    parser.add_argument("--task", default="", help="Optional short task/status text.")
    parser.add_argument(
        "--token",
        default=os.environ.get("TASKFOLK_AGENT_TOKEN", ""),
        help="Manual agent token. Defaults to TASKFOLK_AGENT_TOKEN.",
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("TASKFOLK_AGENT_STATUS_URL", DEFAULT_URL),
        help=f"Agent status API URL. Defaults to TASKFOLK_AGENT_STATUS_URL or {DEFAULT_URL}.",
    )
    parser.add_argument("--timeout", type=float, default=5.0, help="Request timeout in seconds.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.state not in ACCEPTED_STATES:
        print(
            f"Invalid state: {args.state}. Use one of: {', '.join(sorted(ACCEPTED_STATES))}",
            file=sys.stderr,
        )
        return 2
    if not args.token:
        print("Missing agent token. Set TASKFOLK_AGENT_TOKEN or pass --token.", file=sys.stderr)
        return 2

    payload = {"token": args.token, "state": args.state}
    if args.task:
        payload["task"] = args.task

    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        args.url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        message = err.read().decode("utf-8", errors="replace")
        print(f"Status update failed: HTTP {err.code} {message}", file=sys.stderr)
        return 1
    except urllib.error.URLError as err:
        print(f"Status update failed: {err.reason}", file=sys.stderr)
        return 1
    except TimeoutError:
        print("Status update failed: request timed out", file=sys.stderr)
        return 1

    if body:
        print(body)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
