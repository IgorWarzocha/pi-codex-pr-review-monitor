export const START_DELAY_MS = 3 * 60 * 1000;
export const POLL_INTERVAL_MS = 60 * 1000;
export const STATE_FILE_RELATIVE_PATH = ".pi/state/codex-pr-review-monitor.json";

export const ALLOWED_CODEX_LOGINS = new Set([
	"chatgpt-codex-connector[bot]",
]);

export const MAX_CLOSED_PRS_TO_KEEP = 10;
export const MAX_COMMENT_BODY_CHARS = 1_000;

export const PR_CREATE_REGEX = /\bgh\s+pr\s+create\b/;
