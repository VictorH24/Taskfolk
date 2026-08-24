# Changelog

Notable changes to Taskfolk are recorded here. Add new entries under **Unreleased**, then move them into a version dated section when released.

## Unreleased


## Version 1.0.40 (August 24, 2026)

- Show the Hermes Success state for quick turns that complete between polls, including local and remote gateway sessions, before returning the folk to Idle

## Version 1.0.39 (August 24, 2026)

- Restore saved Codex folk after app relaunch and refresh the renderer as soon as initial Codex discovery completes, without requiring a manual reload

## Version 1.0.38 (August 24, 2026)

- Preserve each folk's last rendered status across Low Energy sleep and restore cached provider rosters before the first post-wake screen refresh
- Avoid showing a workspace-less Hermes profile fallback as a second agent when the same profile already has a project-backed agent

## Version 1.0.37 (August 23, 2026)

- Keep last-known agents available in Low Energy Mode while visible-provider-only polling skips their providers, and immediately refresh a provider when its preserved folk is selected
- Repair the native **Add Another Folk** roster when an unchanged provider roster reappears after its server snapshot expires

## Version 1.0.36 (August 21, 2026)

- Add authenticated remote Hermes gateway connections with profile discovery, live-session status, secure URL validation, encrypted token storage, and a Setup connection test

## Version 1.0.35 (August 20, 2026)

- Add first-class Hermes Desktop and CLI session tracking with project and combined grouping, profile discovery, read-only metadata access, and approval/working lifecycle states
- Show Hermes Desktop sessions that do not carry a workspace by using their Hermes profile as the stable agent identity
- Include Hermes profile- and Bot-owned hidden sessions in activity tracking while continuing to exclude archived and internal tool/kanban sessions
- Follow Hermes' durable activity-label lifecycle so profiles switch to Working during a turn and return to Idle as soon as Hermes clears the completed turn

## Version 1.0.34 (August 20, 2026)

- Detect pending VS Code Copilot Agent Host tool confirmations as approval state until every permission response arrives

## Version 1.0.33 (August 19, 2026)

- Add VS Code Agents view support for Codex sessions, including distinct Codex labels and live rollout lifecycle states
- Keep active Copilot and Codex tools visible while they run instead of allowing newer idle session summaries to hide their Working state

## Version 1.0.32 (August 17, 2026)

- Reduce Codex polling work by caching session-file discovery and unchanged rollout lifecycle parsing
- Reduce OpenCode polling work by caching unchanged approval-log parsing while preserving time-based approval expiry
- Reduce VS Code Copilot Chat polling work by caching privacy-safe lifecycle state for unchanged session files while retaining immediate file-watcher refreshes
- Publish changed Codex, OpenCode, and VS Code Copilot states immediately while replacing unchanged five-second status posts with 60-second heartbeats

## Version 1.0.31 (August 4, 2026)

- Fix blank macOS Dock artwork in installed builds by loading the external bundled application icon whenever the Dock entry is created or restored
- Show update-download percentages live beside the menu-bar icon and on the Dock progress overlay, avoiding the macOS limitation that prevents an already-open native menu from repainting its label

## Version 1.0.30 (August 4, 2026)

- Improve macOS app access with independent Dock and menu-bar icon settings, a safeguard that keeps at least one icon available, and a full right-click menu on the Dock icon
- Keep update-download menu labels current without rebuilding every native menu for each progress event

## Version 1.0.29 (August 4, 2026)

- Add a session-only **Pause Provider Checks** option to every native menu; pausing freezes the current folk in grayscale and stops provider timers, file watchers, and snapshot refreshes, while resuming checks providers immediately or restarting Taskfolk clears Pause

## Version 1.0.28 (August 4, 2026)

- Expand Low Energy Mode Setup with an optional global provider refresh override and visible-provider-only polling, enabled by default
- Add optional static artwork for idle poses or every pose; selecting every pose disables and dims the idle-only option

## Version 1.0.27 (August 3, 2026)

- Add a persistent desktop Low Energy Mode to Setup and native menus, using static idle poses, approximately 5 FPS active and attention animations, and no live avatar drop shadow
- Pause desktop integration refreshes, companion snapshots, and achievement sampling while the computer is asleep or the session is locked when Low Energy Mode is enabled

## Version 1.0.26 (August 1, 2026)
- Add a configurable refresh speed for every integration, from one second to five minutes
- Fix Buzz managed agents skipping the Working pose by sampling privacy-safe local process activity

## Version 1.0.25 (August 1, 2026)
- Add first-class Goose Desktop and CLI session tracking with project and combined grouping
- Add first-class Buzz managed-agent tracking with privacy-safe lifecycle detection
- Add branded Goose and Buzz integration icons

## Version 1.0.24 (July 31, 2026)
- Discover Codex sessions through ACP before using the read-only local-index fallback
- Discover VScode Copilot (in agents) using AHP
- improve VScode Chat status detection speed


## Version 1.0.23 (July 30, 2026)
- Fix VScode Copilot status detection

## Version 1.0.22 (July 29, 2026)
- Add Cursor agent
- Handling of Network error as blocked in codex
- Allow to delete agent from rankboard when disconnected
- Add failover to TV screen

## Version 1.0.21 (July 28, 2026)
- New TV-screens added

## Version 1.0.20 (July 28, 2026)
- New gaming/working screens added
- New watching TV status

## Version 1.0.19 (July 27, 2026)
- Refresh cadence updated form 8 to 5 seconds
- Achievement rank board with separate global and last-7-days rankings

## Version 1.0.18 (July 26, 2026)
- Check for signed app updates shortly after launch and every six hours, prompting only when a new release is available
- Include avatar assignments and Rank Board achievements in Setup configuration exports and restore them during import
- Update config page and top menu

## Version 1.0.17 (July 25, 2026)
- Add a dedicated persistent agent achievement Rank Board with cumulative worked time, successful-run counts, approval-request counts, blocked-event counts, fun pose statistics, confirmed per-agent resets, and desktop menu access

## Version 1.0.16 (July 24, 2026)
- Display version in Setup page
- Add an in-app update check, download progress, and restart-to-install flow to the companion, tray, and Office menus

## Version 1.0.15 (July 24, 2026)
- Documentation update
- API add approval state

## Version 1.0.14 (July 23, 2026)
- WebP animation migration

## Version 1.0.13 (July 23, 2026)
- Signed macOS DMG build
- Codex and OpenCode approval detection
- VS Code Copilot approval detection
- OpenClaw approval detection
- Gemini and Antigravity approval detection
- Claude approval detection
- LM Studio approval detection
- Ollama approval detection
- Approval artwork for all avatars
- Avatar skill approval support

## Version 1.0.12 (July 21, 2026)

- Ollama integration
- LM Studio integration
- Random status showcase
- New gaming and working screens
- Configuration reset
- Agent deletion warnings
- Improved desktop reload
- Simplified integration defaults
- Updated provider icons and text
- Centralized agent polling
- Visibility-aware throttling
- Snapshot caching
- Incremental UI rendering
- Long-running OpenCode status fix
- OpenClaw success-state fix
