import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { POLL_INTERVAL_MS, START_DELAY_MS } from "./config";
import { ghJson } from "./gh-client";
import type { ConversationComment, PullRequestRef, ReviewComment, RuntimeContext } from "./types";
import {
	asNumber,
	bumpCursor,
	isNewer,
	normalizePrState,
	nowIso,
	shouldIncludeCodex,
	toPrKey,
	truncateBody,
} from "./utils";

export function stopMonitor(runtime: RuntimeContext, key: string): void {
	const handle = runtime.monitors.get(key);
	if (handle?.startupTimer) clearTimeout(handle.startupTimer);
	if (handle?.pollTimer) clearInterval(handle.pollTimer);
	runtime.monitors.delete(key);
}

function notifyAgent(pi: ExtensionAPI, runtime: RuntimeContext, text: string): void {
	if (runtime.agentBusy) {
		pi.sendUserMessage(text, { deliverAs: "followUp" });
	} else {
		pi.sendUserMessage(text);
	}
}

export async function pollPr(
	pi: ExtensionAPI,
	runtime: RuntimeContext,
	persistState: () => Promise<void>,
	key: string,
): Promise<void> {
	const pr = runtime.state.prs[key];
	if (!pr || !pr.monitorActive) return;

	if (!pr.cursor.reviewComments) {
		const seedTs = pr.createdAt ?? pr.lastPollAt ?? pr.updatedAt ?? nowIso();
		pr.cursor.reviewComments = { ts: seedTs, id: 0 };
	}

	if (!pr.cursor.conversationComments) {
		// Migration safety: older state files may not have this cursor yet.
		// Seed from last known poll/update time to avoid replaying old PR-thread comments.
		const seedTs = pr.lastPollAt ?? pr.updatedAt ?? pr.createdAt ?? nowIso();
		pr.cursor.conversationComments = { ts: seedTs, id: 0 };
	}

	const prInfo = await ghJson<{
		state: string;
		merged_at?: string | null;
	}>(pi, ["api", `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`]);

	if (!prInfo) {
		pr.lastError = "Failed to fetch PR status via gh api";
		pr.updatedAt = nowIso();
		await persistState();
		return;
	}

	pr.state = normalizePrState(prInfo.state, prInfo.merged_at);
	if (pr.state !== "open") {
		pr.monitorActive = false;
		pr.updatedAt = nowIso();
		stopMonitor(runtime, key);
		await persistState();
		return;
	}

	const [reviewComments, conversationComments] = await Promise.all([
		ghJson<ReviewComment[]>(pi, [
			"api",
			`/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments?per_page=100`,
		]),
		ghJson<ConversationComment[]>(pi, [
			"api",
			`/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments?per_page=100`,
		]),
	]);

	if (!reviewComments && !conversationComments) {
		pr.lastError = "Failed to fetch both PR Codex comment endpoints";
		pr.lastPollAt = nowIso();
		pr.updatedAt = pr.lastPollAt;
		await persistState();
		return;
	}

	const newFeedback: Array<{ when: string; text: string; id: number }> = [];

	let reviewCommentCursor = pr.cursor.reviewComments;
	if (reviewComments) {
		for (const c of reviewComments) {
			if (!shouldIncludeCodex(c.user?.login)) continue;
			const ts = c.created_at;
			const id = asNumber(c.id);
			if (!ts || !id) continue;
			if (isNewer(ts, id, reviewCommentCursor)) {
				const location = c.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : "";
				newFeedback.push({
					when: ts,
					id,
					text: `- [inline review comment${location}] ${truncateBody(c.body)}`,
				});
			}
			reviewCommentCursor = bumpCursor(reviewCommentCursor, ts, id);
		}
	}

	let conversationCommentCursor = pr.cursor.conversationComments ?? {};
	if (conversationComments) {
		for (const c of conversationComments) {
			if (!shouldIncludeCodex(c.user?.login)) continue;
			const ts = c.created_at;
			const id = asNumber(c.id);
			if (!ts || !id) continue;
			if (isNewer(ts, id, conversationCommentCursor)) {
				newFeedback.push({
					when: ts,
					id,
					text: `- [pr conversation comment] ${truncateBody(c.body)}`,
				});
			}
			conversationCommentCursor = bumpCursor(conversationCommentCursor, ts, id);
		}
	}

	pr.cursor.reviewComments = reviewCommentCursor;
	pr.cursor.conversationComments = conversationCommentCursor;
	pr.lastPollAt = nowIso();
	pr.updatedAt = pr.lastPollAt;

	if (!reviewComments && conversationComments) {
		pr.lastError = "Failed to fetch inline review comments endpoint; processed PR conversation comments";
	} else if (reviewComments && !conversationComments) {
		pr.lastError = "Failed to fetch PR conversation comments endpoint; processed inline review comments";
	} else {
		pr.lastError = undefined;
	}

	if (newFeedback.length > 0) {
		newFeedback.sort((a, b) => a.when.localeCompare(b.when));
		pr.stats.notificationsSent += 1;
		pr.stats.reviewCommentsSeen += newFeedback.length;

		const header = `New Codex PR feedback detected on ${pr.owner}/${pr.repo}#${pr.number}.`;
		const body = newFeedback.map((f) => f.text).join("\n");
		const instruction =
			"Review this Codex feedback critically. You MUST act only on concrete, actionable code defects tied to specific files/behavior. If feedback is non-actionable (for example: no-issue praise, generic boilerplate, environment/setup reminders, or any comment without a concrete fix target), you MUST NOT post a PR comment and MUST NOT ping @codex; keep an internal note only and wait. You MUST post a PR comment only when you made code changes in direct response to actionable feedback in this turn, and that comment MUST summarize exactly what was fixed and what was not fixed (with reasons). You MAY ask @codex to re-check only after such code changes; otherwise do nothing and await further instructions.";
		notifyAgent(pi, runtime, `${header}\n\n${body}\n\n${instruction}`);
	}

	await persistState();
}

export function scheduleMonitor(
	pi: ExtensionAPI,
	runtime: RuntimeContext,
	persistState: () => Promise<void>,
	key: string,
	delayMs: number,
): void {
	stopMonitor(runtime, key);
	const pr = runtime.state.prs[key];
	if (!pr || !pr.monitorActive) return;

	const handle = {} as { startupTimer?: ReturnType<typeof setTimeout>; pollTimer?: ReturnType<typeof setInterval> };
	handle.startupTimer = setTimeout(() => {
		void pollPr(pi, runtime, persistState, key);
		handle.pollTimer = setInterval(() => {
			void pollPr(pi, runtime, persistState, key);
		}, POLL_INTERVAL_MS);
	}, Math.max(0, delayMs));
	runtime.monitors.set(key, handle);
}

export async function upsertAndMonitor(
	pi: ExtensionAPI,
	runtime: RuntimeContext,
	persistState: () => Promise<void>,
	prRef: PullRequestRef,
	withDelay = true,
): Promise<void> {
	const key = toPrKey(prRef.owner, prRef.repo, prRef.number);
	const existing = runtime.state.prs[key];
	const createdAt = prRef.createdAt ?? existing?.createdAt;

	runtime.state.prs[key] = {
		key,
		owner: prRef.owner,
		repo: prRef.repo,
		number: prRef.number,
		url: prRef.url,
		createdAt,
		state: normalizePrState(prRef.state),
		detectedAt: existing?.detectedAt ?? nowIso(),
		updatedAt: nowIso(),
		monitorActive: normalizePrState(prRef.state) === "open",
		monitorStartedAt: existing?.monitorStartedAt,
		lastPollAt: existing?.lastPollAt,
		lastError: undefined,
		cursor: {
			reviewComments: existing?.cursor?.reviewComments ?? (createdAt ? { ts: createdAt, id: 0 } : {}),
			conversationComments: existing?.cursor?.conversationComments ?? (createdAt ? { ts: createdAt, id: 0 } : {}),
		},
		stats: existing?.stats ?? {
			notificationsSent: 0,
			reviewCommentsSeen: 0,
		},
	};

	const prState = runtime.state.prs[key];
	if (prState.monitorActive) {
		if (!prState.monitorStartedAt) prState.monitorStartedAt = nowIso();
		scheduleMonitor(pi, runtime, persistState, key, withDelay ? START_DELAY_MS : 0);
	} else {
		stopMonitor(runtime, key);
	}

	await persistState();
}
