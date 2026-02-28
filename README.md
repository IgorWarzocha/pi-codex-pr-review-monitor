# codex-pr-review-monitor

Always-on project-local Pi extension that:

- Detects `gh pr create` usage from Pi (agent `bash` tool + `!gh ...` user bash).
- Monitors only **PR inline review comments** (no issue comments, no review-summary bodies):
  - `pulls/{pr}/comments`
- Filters to **Codex-only** authors with an exact allow-list:
  - `chatgpt-codex-connector[bot]`
- Waits 3 minutes after PR detection, then polls every 60 seconds.
- Injects new Codex feedback into the main agent as inline user messages.

## State file

State is persisted to:

- `.pi/state/codex-pr-review-monitor.json`

Tracked data is compact metadata only (no full historical comment archive), including:

- PR status (`open` / `closed` / `merged`)
- monitor status
- cursor (`timestamp + id`) for deduplication (so already-seen comments are not re-injected)
- counters (notifications sent / comments seen)

To prevent unbounded growth, state keeps:

- **all open PRs**
- only the **latest 10 non-open PRs** (`closed`/`merged`)
