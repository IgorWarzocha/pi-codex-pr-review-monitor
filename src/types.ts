export interface Cursor {
	ts?: string;
	id?: number;
}

export interface PullRequestState {
	key: string;
	owner: string;
	repo: string;
	number: number;
	url: string;
	createdAt?: string;
	state: "open" | "closed" | "merged";
	detectedAt: string;
	updatedAt: string;
	monitorActive: boolean;
	monitorStartedAt?: string;
	lastPollAt?: string;
	lastError?: string;
	cursor: {
		reviewComments: Cursor;
		conversationComments?: Cursor;
	};
	stats: {
		notificationsSent: number;
		reviewCommentsSeen: number;
	};
}

export interface PersistedState {
	version: 1;
	repoRoot: string;
	repoSlug?: string;
	updatedAt: string;
	prs: Record<string, PullRequestState>;
}

export interface PullRequestRef {
	owner: string;
	repo: string;
	number: number;
	url: string;
	createdAt?: string;
	state?: string;
}

export interface ReviewComment {
	id: number;
	body?: string;
	path?: string;
	line?: number;
	created_at?: string;
	user?: { login?: string };
	html_url?: string;
}

export interface ConversationComment {
	id: number;
	body?: string;
	created_at?: string;
	user?: { login?: string };
	html_url?: string;
}

export interface MonitorHandle {
	startupTimer?: ReturnType<typeof setTimeout>;
	pollTimer?: ReturnType<typeof setInterval>;
}

export interface RuntimeContext {
	repoRoot: string;
	repoSlug?: string;
	state: PersistedState;
	agentBusy: boolean;
	pendingCreateToolCalls: Set<string>;
	monitors: Map<string, MonitorHandle>;
}
