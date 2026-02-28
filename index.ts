import { isToolCallEventType, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PR_CREATE_REGEX } from "./src/config";
import { detectFromCommandResult } from "./src/detection";
import { discoverCurrentBranchPr, ensureRepoRootAndSlug } from "./src/gh-client";
import { scheduleMonitor, stopMonitor, upsertAndMonitor } from "./src/monitor";
import { loadState, persistState } from "./src/state-store";
import type { RuntimeContext } from "./src/types";
import { contentToText, nowIso } from "./src/utils";

export default function (pi: ExtensionAPI) {
	const runtime: RuntimeContext = {
		repoRoot: process.cwd(),
		repoSlug: undefined,
		state: {
			version: 1,
			repoRoot: process.cwd(),
			updatedAt: nowIso(),
			prs: {},
		},
		agentBusy: false,
		pendingCreateToolCalls: new Set<string>(),
		monitors: new Map(),
	};

	const persist = () => persistState(runtime);

	pi.on("session_start", async () => {
		runtime.agentBusy = false;
		await ensureRepoRootAndSlug(pi, runtime);
		await loadState(runtime);

		for (const [key, pr] of Object.entries(runtime.state.prs)) {
			if (!pr.monitorActive) continue;
			if (pr.state !== "open") continue;
			scheduleMonitor(pi, runtime, persist, key, 0);
		}

		const currentPr = await discoverCurrentBranchPr(pi, runtime);
		if (currentPr) {
			await upsertAndMonitor(pi, runtime, persist, currentPr, false);
		}
	});

	pi.on("agent_start", async () => {
		runtime.agentBusy = true;
	});

	pi.on("agent_end", async () => {
		runtime.agentBusy = false;
	});

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;
		if (PR_CREATE_REGEX.test(event.input.command)) {
			runtime.pendingCreateToolCalls.add(event.toolCallId);
		}
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return;
		if (!runtime.pendingCreateToolCalls.has(event.toolCallId)) return;
		runtime.pendingCreateToolCalls.delete(event.toolCallId);
		if (event.isError) return;
		const outputText = contentToText(event.content);
		await detectFromCommandResult(pi, runtime, persist, outputText);
	});

	pi.on("user_bash", async (event) => {
		if (!PR_CREATE_REGEX.test(event.command)) return;
		setTimeout(() => {
			void (async () => {
				const pr = await discoverCurrentBranchPr(pi, runtime);
				if (pr) await upsertAndMonitor(pi, runtime, persist, pr, true);
			})();
		}, 15_000);
	});

	pi.on("session_shutdown", async () => {
		for (const key of [...runtime.monitors.keys()]) stopMonitor(runtime, key);
		await persist();
	});
}
