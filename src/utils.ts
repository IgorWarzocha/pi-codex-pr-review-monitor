import { ALLOWED_CODEX_LOGINS, MAX_COMMENT_BODY_CHARS } from "./config";
import type { Cursor, PullRequestRef, PullRequestState } from "./types";

interface MinimalContentPart {
	type: string;
	text?: string;
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function toPrKey(owner: string, repo: string, number: number): string {
	return `${owner}/${repo}#${number}`;
}

export function normalizePrState(state: string | undefined, mergedAt?: string | null): PullRequestState["state"] {
	if (mergedAt) return "merged";
	if (!state) return "open";
	if (state.toLowerCase() === "closed") return "closed";
	return "open";
}

export function truncateBody(text: string | undefined): string {
	const clean = (text ?? "").trim();
	if (!clean) return "(empty)";
	if (clean.length <= MAX_COMMENT_BODY_CHARS) return clean;
	return `${clean.slice(0, MAX_COMMENT_BODY_CHARS)}…`;
}

export function contentToText(content: MinimalContentPart[]): string {
	return content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

export function parsePrUrl(text: string): PullRequestRef | undefined {
	const regex = /https?:\/\/[^\s)]+\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/g;
	const match = regex.exec(text);
	if (!match) return undefined;
	const owner = match[1];
	const repo = match[2].replace(/\.git$/i, "");
	const number = Number.parseInt(match[3], 10);
	if (!owner || !repo || Number.isNaN(number)) return undefined;
	return {
		owner,
		repo,
		number,
		url: match[0],
	};
}

export function parseOwnerRepoFromSlug(slug?: string): { owner: string; repo: string } | undefined {
	if (!slug || !slug.includes("/")) return undefined;
	const [owner, repo] = slug.split("/");
	if (!owner || !repo) return undefined;
	return { owner, repo };
}

export function parseOwnerRepoFromRemote(url: string | undefined): { owner: string; repo: string } | undefined {
	if (!url) return undefined;
	const trimmed = url.trim();
	const https = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
	if (https) {
		return { owner: https[1], repo: https[2] };
	}
	return undefined;
}

export function asNumber(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function shouldIncludeCodex(login: string | undefined): boolean {
	if (!login) return false;
	return ALLOWED_CODEX_LOGINS.has(login);
}

export function isNewer(ts: string | undefined, id: number | undefined, cursor: Cursor): boolean {
	if (!ts || !id) return false;
	if (!cursor.ts) return true;
	if (ts > cursor.ts) return true;
	if (ts < cursor.ts) return false;
	return id > (cursor.id ?? 0);
}

export function bumpCursor(cursor: Cursor, ts: string | undefined, id: number | undefined): Cursor {
	if (!ts || !id) return cursor;
	if (!cursor.ts || ts > cursor.ts || (ts === cursor.ts && id > (cursor.id ?? 0))) {
		return { ts, id };
	}
	return cursor;
}
