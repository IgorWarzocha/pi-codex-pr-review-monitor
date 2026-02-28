import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { discoverCurrentBranchPr } from "./gh-client";
import { upsertAndMonitor } from "./monitor";
import type { RuntimeContext } from "./types";
import { parsePrUrl } from "./utils";

export async function detectFromCommandResult(
	pi: ExtensionAPI,
	runtime: RuntimeContext,
	persistState: () => Promise<void>,
	outputText: string,
): Promise<void> {
	const fromUrl = parsePrUrl(outputText);
	if (fromUrl) {
		await upsertAndMonitor(pi, runtime, persistState, fromUrl, true);
		return;
	}

	const fallback = await discoverCurrentBranchPr(pi, runtime);
	if (fallback) {
		await upsertAndMonitor(pi, runtime, persistState, fallback, true);
	}
}
