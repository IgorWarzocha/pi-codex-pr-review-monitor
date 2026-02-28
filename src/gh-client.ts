import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PullRequestRef, RuntimeContext } from "./types";
import { parseOwnerRepoFromRemote, parseOwnerRepoFromSlug } from "./utils";

export async function ghJson<T>(pi: ExtensionAPI, args: string[]): Promise<T | undefined> {
	const result = await pi.exec("gh", args);
	if (result.code !== 0) return undefined;
	const out = result.stdout.trim();
	if (!out) return undefined;
	try {
		return JSON.parse(out) as T;
	} catch {
		return undefined;
	}
}

export async function ensureRepoRootAndSlug(pi: ExtensionAPI, runtime: RuntimeContext): Promise<void> {
	const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"]);
	if (rootResult.code === 0 && rootResult.stdout.trim()) {
		runtime.repoRoot = rootResult.stdout.trim();
	}

	const slugResult = await pi.exec("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
	if (slugResult.code === 0 && slugResult.stdout.trim()) {
		runtime.repoSlug = slugResult.stdout.trim();
		return;
	}

	const remoteResult = await pi.exec("git", ["config", "--get", "remote.origin.url"]);
	if (remoteResult.code === 0) {
		const parsed = parseOwnerRepoFromRemote(remoteResult.stdout);
		if (parsed) runtime.repoSlug = `${parsed.owner}/${parsed.repo}`;
	}
}

export async function discoverCurrentBranchPr(pi: ExtensionAPI, runtime: RuntimeContext): Promise<PullRequestRef | undefined> {
	const pr = await ghJson<{
		number: number;
		url: string;
		state: string;
		createdAt?: string;
	}>(pi, ["pr", "view", "--json", "number,url,state,createdAt"]);
	if (!pr?.number || !pr.url) return undefined;

	let ownerRepo = parseOwnerRepoFromSlug(runtime.repoSlug);
	if (!ownerRepo) {
		const repo = await ghJson<{ nameWithOwner?: string }>(pi, ["repo", "view", "--json", "nameWithOwner"]);
		ownerRepo = parseOwnerRepoFromSlug(repo?.nameWithOwner);
	}
	if (!ownerRepo) return undefined;

	return {
		owner: ownerRepo.owner,
		repo: ownerRepo.repo,
		number: pr.number,
		url: pr.url,
		createdAt: pr.createdAt,
		state: pr.state,
	};
}
