export type Locale = 'ru' | 'en';

export type Level = 'blocker' | 'major' | 'minor' | 'question';
export type FindingStatus = 'draft' | 'accepted' | 'rejected' | 'published' | 'fixed' | 'stale';
export type Decision = 'accept' | 'reject' | 'discuss';
export type Platform = 'gitlab' | 'github';
export type Tab = 'overview' | 'threads' | 'findings' | 'diff' | 'rules' | 'analytics';

export type MergeState = 'clean' | 'conflict' | 'behind' | 'unknown' | 'unavailable';

export interface MergeInfo {
    state: MergeState;
    targetBranch: string;
    detail: string;
    checkedAt: string;
    targetSha?: string;
    baseSha?: string;
    headSha?: string;
    conflictFiles?: string[];
}

export type ReviewRiskLevel = 'low' | 'medium' | 'high';
export type ReviewMode = 'fast' | 'full';

export interface QualityMetrics {
    project: string;
    from: string;
    to: string;
    generatedAt: string;
    reviews: { total: number; open: number; merged: number; closed: number };
    findings: {
        total: number;
        accepted: number;
        rejected: number;
        discussed: number;
        pending: number;
        published: number;
        withRule: number;
    };
    rates: { acceptance: number | null; publish: number | null; ruleGrounded: number | null };
    coverage: { reviewsWithCoverage: number; reviewsWithUnknowns: number; coverageItems: number; unknownItems: number };
    process: { duplicates: number; ruleCandidates: number };
    timing: { reviewsWithFirstFinding: number; medianTimeToFirstFindingMs: number | null; medianCycleTimeMs: number | null };
    activity: { findingsDrafted: number; summariesSaved: number; decisionsSaved: number; publishes: number; checks: number };
    actors: { human: number; agent: number; system: number };
    events: number;
}

export interface ReviewRisk {
    level: ReviewRiskLevel;
    mode: ReviewMode;
    files: number;
    changedLines: number;
    reasons: string[];
}

export interface ReviewInfo {
    ref: { platform: Platform; host: string; project: string; number: number };
    title: string;
    description: string;
    author: string;
    authorName: string;
    state: string;
    draft: boolean;
    sourceBranch: string;
    targetBranch: string;
    webUrl: string;
    projectId?: number;
    merge?: MergeInfo;
    commit: { base: string; start: string; head: string };
    updatedAt: string;
    stats: { files: number; additions: number; deletions: number };
}

export interface Reaction {
    name: string;
    count: number;
    users: string[];
    mine: boolean;
}

export interface Note {
    id: string;
    author: string;
    authorName: string;
    createdAt: string;
    body: string;
    system: boolean;
    reactions?: Reaction[];
}

export interface Thread {
    id: string;
    path: string | null;
    line: number | null;
    side: 'new' | 'old' | null;
    resolvable: boolean;
    resolved: boolean;
    notes: Note[];
    updatedAt: string;
    snippet: SnippetLine[] | null;
}

export interface SnippetLine {
    kind: '+' | '-' | ' ';
    oldLine: number | null;
    newLine: number | null;
    text: string;
    target: boolean;
}

export interface Finding {
    id: string;
    fingerprint: string;
    level: Level;
    file: string;
    line: number | null;
    endLine: number | null;
    title: string;
    body: string;
    comment: string;
    rule?: string;
    status: FindingStatus;
    discussionId: string | null;
    publishedAt: string | null;
    decision: Decision | null;
    note: string;
    agentNote?: string;
    publishError: string;
    snippet: SnippetLine[] | null;
}

export interface ReplyDraft {
    threadId: string;
    body: string;
    resolve: boolean;
    noteForAgent: string;
    agentAction: 'fix' | 'reply' | 'revise' | 'skip' | '';
    posted: string;
    replied: boolean;
    resolved: boolean;
    error: string;
    updatedAt: string;
}

export type AgentMessageRole = 'human' | 'agent';

export interface AgentMessage {
    id: string;
    role: AgentMessageRole;
    text: string;
    createdAt: string;
}

export interface LineNote {
    id: string;
    file: string;
    line: number;
    side: 'new' | 'old';
    text: string;
    toAgent: boolean;
    agentAction: 'fix' | 'reply' | '';
    agentReply: string;
    posted: string;
    discussionId: string;
    noteId: string;
    error: string;
    createdAt: string;
    updatedAt: string;
}

export interface ReviewSummary {
    title: string;
    scope: string;
    summary: string;
    changes: string[];
    focus: string[];
    coverage?: string[];
    unknowns?: string[];
    duplicates?: string[];
    ruleCandidates?: string[];
}

export interface FileSummary {
    path: string;
    oldPath: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    binary: boolean;
    additions: number;
    deletions: number;
}

export interface ReviewView {
    id: string;
    info: ReviewInfo;
    threads: Thread[];
    reactions: Reaction[];
    groups: { id: string; title: string; files: string[]; additions: number; deletions: number }[];
    summary: ReviewSummary | null;
    findings: Finding[];
    drafts: ReplyDraft[];
    notes: LineNote[];
    agentMessages: AgentMessage[];
    decisions: Record<string, { decision: Decision | null; note: string }>;
    user: { username: string; name: string } | null;
    syncedAt: string;
    errors: string[];
    readOnly: boolean;
    files: FileSummary[];
    stats: { files: number; additions: number; deletions: number };
    risk: ReviewRisk;
    stale: boolean;
}

export interface ProjectSummary {
    key: string;
    platform: Platform;
    host: string;
    project: string;
    title: string;
    roots: string[];
    reviews: number;
    createdAt: string;
    updatedAt: string;
    lastActivity: string;
}

export interface FeatureSummary {
    id: string;
    title: string;
    brief: string;
    contract: string;
    status: 'open' | 'archived';
    createdAt: string;
    updatedAt: string;
    reviews: number;
    projects: { key: string; platform: Platform; host: string; project: string; title: string }[];
}

export interface FeatureMember {
    review: ReviewListItem;
    role: string;
    sortOrder: number;
    addedAt: string;
}

export interface FeatureNote {
    id: string;
    featureId: string;
    kind: 'note' | 'finding';
    level: string;
    title: string;
    body: string;
    author: 'human' | 'agent';
    createdAt: string;
    updatedAt: string;
}

export interface FeatureDetail extends FeatureSummary {
    members: FeatureMember[];
    notes: FeatureNote[];
}

export interface PreviewRef {
    platform: Platform;
    host: string;
    project: string;
    number: number;
}

export interface ReviewListItem {
    id: string;
    platform: Platform;
    host: string;
    project: string;
    projectKey: string;
    number: number;
    title: string;
    author: string;
    state: string;
    webUrl: string;
    updatedAt: string;
    syncedAt: string;
    root: string;
}

export interface DiffLine {
    kind: '+' | '-' | ' ';
    text: string;
    oldLine: number | null;
    newLine: number | null;
}

export interface DiffHunk {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: DiffLine[];
}

export interface DiffPayload {
    path: string;
    status: string;
    binary: boolean;
    hunks: DiffHunk[];
}

export interface PublishPreview {
    plan: { reviewId: string; kind: 'reply' | 'finding' | 'note'; items: { kind: string; id: string; body: string; resolve?: boolean }[]; hash: string; createdAt: string };
    warnings: string[];
}

export interface PublishResult {
    results: { id: string; ok: boolean; skipped?: boolean; error?: string; discussionId?: string }[];
}
