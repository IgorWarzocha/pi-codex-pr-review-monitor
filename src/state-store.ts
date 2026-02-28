import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MAX_CLOSED_PRS_TO_KEEP, STATE_FILE_RELATIVE_PATH } from "./config";
import type { RuntimeContext } from "./types";
import { nowIso } from "./utils";

function statePath(runtime: RuntimeContext): string {
	return path.join(runtime.repoRoot, STATE_FILE_RELATIVE_PATH);
}

function pruneState(runtime: RuntimeContext) {
	const entries = Object.entries(runtime.state.prs);
	if (entries.length === 0) return;

	const openEntries = entries.filter(([, pr]) => pr.state === "open" || pr.monitorActive);
	const closedEntries = entries
		.filter(([, pr]) => !(pr.state === "open" || pr.monitorActive))
		.sort((a, b) => (b[1].updatedAt || "").localeCompare(a[1].updatedAt || ""));

	const keep = new Set([
		...openEntries.map(([key]) => key),
		...closedEntries.slice(0, MAX_CLOSED_PRS_TO_KEEP).map(([key]) => key),
	]);

	for (const key of Object.keys(runtime.state.prs)) {
		if (!keep.has(key)) {
			delete runtime.state.prs[key];
		}
	}
}

export async function persistState(runtime: RuntimeContext): Promise<void> {
	runtime.state.repoRoot = runtime.repoRoot;
	runtime.state.repoSlug = runtime.repoSlug;
	runtime.state.updatedAt = nowIso();
	pruneState(runtime);
	const fullPath = statePath(runtime);
	await fs.mkdir(path.dirname(fullPath), { recursive: true });
	await fs.writeFile(fullPath, `${JSON.stringify(runtime.state, null, 2)}\n`, "utf-8");
}

export async function loadState(runtime: RuntimeContext): Promise<void> {
	try {
		const raw = await fs.readFile(statePath(runtime), "utf-8");
		const parsed = JSON.parse(raw);
		if (parsed && parsed.version === 1 && parsed.prs) {
			runtime.state = parsed;
			for (const pr of Object.values(runtime.state.prs)) {
				const seedCreatedTs = pr.createdAt ?? pr.updatedAt ?? nowIso();
				const seedConversationTs = pr.lastPollAt ?? pr.updatedAt ?? pr.createdAt ?? nowIso();
				pr.cursor = pr.cursor ?? { reviewComments: { ts: seedCreatedTs, id: 0 } };
				pr.cursor.reviewComments = pr.cursor.reviewComments ?? { ts: seedCreatedTs, id: 0 };
				pr.cursor.conversationComments = pr.cursor.conversationComments ?? { ts: seedConversationTs, id: 0 };
				pr.stats = pr.stats ?? { notificationsSent: 0, reviewCommentsSeen: 0 };
				pr.stats.notificationsSent = pr.stats.notificationsSent ?? 0;
				pr.stats.reviewCommentsSeen = pr.stats.reviewCommentsSeen ?? 0;
			}
		}
	} catch {
		// first run or invalid JSON -> start fresh
	}
}
