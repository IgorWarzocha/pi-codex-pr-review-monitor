# codex-pr-review-monitor

Always-on project-local Pi extension that:

- Detects `gh pr create` usage from Pi (agent `bash` tool + `!gh ...` user bash).
- Monitors Codex comments on the PR via:
  - `pulls/{pr}/comments` (inline review comments)
  - `issues/{pr}/comments` (PR conversation thread comments)
- Does **not** consume review-summary bodies from `pulls/{pr}/reviews`.
- Filters to **Codex-only** authors with an exact allow-list:
  - `chatgpt-codex-connector[bot]`
- Waits 3 minutes after PR detection, then polls every 60 seconds.
- Injects new Codex feedback into the main agent as inline user messages.

## Installation

Install globally as a Pi package:

```bash
pi install git:github.com/IgorWarzocha/pi-codex-pr-review-monitor
```

Or install project-local:

```bash
pi install -l git:github.com/IgorWarzocha/pi-codex-pr-review-monitor
```

## Scope and state location

This extension is safe to install globally because it resolves each active repo root at runtime and writes state into that repo.

## State file

State is persisted to:

- `.pi/state/codex-pr-review-monitor.json`

Tracked data is compact metadata only (no full historical comment archive), including:

- PR status (`open` / `closed` / `merged`)
- monitor status
- cursors (`timestamp + id`) for deduplication (so already-seen comments are not re-injected)
- counters (notifications sent / comments seen)

To prevent unbounded growth, state keeps:

- **all open PRs**
- only the **latest 10 non-open PRs** (`closed`/`merged`)
