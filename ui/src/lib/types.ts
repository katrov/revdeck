export type Locale = 'ru' | 'en';

export type Level = 'blocker' | 'major' | 'minor' | 'question';
export type FindingStatus = 'draft' | 'accepted' | 'rejected' | 'published' | 'fixed' | 'stale';
export type Decision = 'accept' | 'reject' | 'discuss';
export type Platform = 'gitlab' | 'github';
export type Tab = 'overview' | 'threads' | 'findings' | 'diff' | 'rules';

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
    commit: { base: string; start: string; head: string };
    updatedAt: string;
    stats: { files: number; additions: number; deletions: number };
}

export interface Note {
    id: string;
    author: string;
    authorName: string;
    createdAt: string;
    body: string;
    system: boolean;
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
    status: FindingStatus;
    discussionId: string | null;
    publishedAt: string | null;
    decision: Decision | null;
    note: string;
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
    summary: ReviewSummary | null;
    findings: Finding[];
    drafts: ReplyDraft[];
    notes: LineNote[];
    decisions: Record<string, { decision: Decision | null; note: string }>;
    user: { username: string; name: string } | null;
    syncedAt: string;
    errors: string[];
    files: FileSummary[];
    stats: { files: number; additions: number; deletions: number };
    stale: boolean;
}

export interface ReviewListItem {
    id: string;
    platform: Platform;
    host: string;
    project: string;
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
