/**
 * Доменные модели revdeck.
 *
 * Одна ревизия (review) — это MR в GitLab или PR в GitHub. Все платформенные
 * различия нормализуются в эти типы провайдерами, остальной код о них не знает.
 */

export type Platform = 'gitlab' | 'github';

export const PLATFORMS: readonly Platform[] = ['gitlab', 'github'];

export const LEVELS = ['blocker', 'major', 'minor', 'question'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
    blocker: 'blocker',
    major: 'major',
    minor: 'minor',
    question: 'question',
};

export type FindingStatus = 'draft' | 'accepted' | 'rejected' | 'published' | 'fixed' | 'stale';
export type Decision = 'accept' | 'reject' | 'discuss';
export type ReplyAction = 'fix' | 'reply' | 'revise' | 'skip';
export type Side = 'new' | 'old';

export interface ReviewRef {
    platform: Platform;
    /** Хост платформы без схемы: gitlab.example.com, github.com. */
    host: string;
    /** GitLab: group/subgroup/project. GitHub: owner/repo. */
    project: string;
    number: number;
}

export interface ReviewStats {
    files: number;
    additions: number;
    deletions: number;
}

export type ReviewEventActor = 'human' | 'agent' | 'system';

/** Append-only событие для метрик качества; не заменяет audit. */
export interface ReviewEvent {
    id: number;
    at: string;
    reviewId: string | null;
    actor: ReviewEventActor;
    type: string;
    findingId?: string;
    threadId?: string;
    ruleRef?: string;
    commitSha?: string;
    payload: unknown;
}

export type MergeState = 'clean' | 'conflict' | 'behind' | 'unknown' | 'unavailable';

/**
 * Состояние слияния MR/PR с target на момент снимка. Diff ревью всегда
 * привязан к `commit.base`/`commit.head`; target может уйти вперёд, поэтому
 * mergeability проверяется отдельно от diff.
 */
export interface MergeInfo {
    state: MergeState;
    targetBranch: string;
    /** Сырой статус платформы: detailed_merge_status / mergeable_state. */
    detail: string;
    checkedAt: string;
    targetSha?: string;
    /** Merge-base сохранённого diff. */
    baseSha?: string;
    /** Head сохранённого diff. */
    headSha?: string;
    conflictFiles?: string[];
}

export interface ReviewInfo {
    ref: ReviewRef;
    title: string;
    description: string;
    author: string;
    authorName: string;
    state: string;
    draft: boolean;
    sourceBranch: string;
    targetBranch: string;
    webUrl: string;
    /** GitLab project ID; нужен для абсолютных ссылок на /uploads. */
    projectId?: number;
    /** Mergeability на момент последнего sync; старые снимки могут не иметь поля. */
    merge?: MergeInfo;
    commit: { base: string; start: string; head: string };
    updatedAt: string;
    mergedAt?: string;
    closedAt?: string;
    stats: ReviewStats;
}

/** Строка unified diff. oldLine/newLine — номера строк в старой и новой версии файла. */
export interface DiffLine {
    kind: '+' | '-' | ' ';
    text: string;
    oldLine: number | null;
    newLine: number | null;
}

export interface Hunk {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: DiffLine[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffFile {
    path: string;
    oldPath: string;
    status: FileStatus;
    binary: boolean;
    hunks: Hunk[];
}

/** Реакции платформы; имена совпадают с GitLab award emoji. */
export const REACTIONS = ['thumbsup', 'thumbsdown', 'smile', 'tada', 'confused', 'heart', 'rocket', 'eyes'] as const;
export type ReactionName = (typeof REACTIONS)[number];

export interface Reaction {
    name: string;
    count: number;
    users: string[];
    /** Реакция поставлена текущим пользователем. */
    mine: boolean;
}

export interface Note {
    id: string;
    author: string;
    authorName: string;
    createdAt: string;
    body: string;
    system: boolean;
    /** Может отсутствовать в старых снимках. */
    reactions?: Reaction[];
}

export interface Thread {
    id: string;
    path: string | null;
    line: number | null;
    side: Side | null;
    resolvable: boolean;
    resolved: boolean;
    notes: Note[];
    updatedAt: string;
}

export interface User {
    username: string;
    name: string;
}

/** Вложение, уже загруженное в платформу. URL всегда абсолютный. */
export interface UploadedAttachment {
    name: string;
    url: string;
    markdown: string;
}

/** Человеческое предложение/замечание ревью. Публикуется только после подтверждения. */
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
    /** Документ/секция правила, на котором основано замечание (для метрик). */
    rule?: string;
    status: FindingStatus;
    discussionId: string | null;
    publishedAt: string | null;
    decision: Decision | null;
    note: string;
    /** Инструкция агенту; не публикуется в платформу. */
    agentNote?: string;
    publishError: string;
}

/** Выжимка MR, которую пишет агент в начале ревью. */
export interface ReviewSummary {
    title: string;
    scope: string;
    summary: string;
    changes: string[];
    focus: string[];
    /** Что реально проверено: файлы, команды, ручные сценарии. */
    coverage?: string[];
    /** Что проверить не удалось и почему. */
    unknowns?: string[];
    /** Замечания, не добавленные, потому что уже есть в тредах. */
    duplicates?: string[];
    /** Предложенные кандидаты в правила. */
    ruleCandidates?: string[];
}

/** Черновик ответа в тред. */
export interface ReplyDraft {
    threadId: string;
    body: string;
    resolve: boolean;
    noteForAgent: string;
    agentAction: ReplyAction | '';
    posted: string;
    replied: boolean;
    resolved: boolean;
    error: string;
    updatedAt: string;
}

/** Комментарий пользователя к строке diff (из UI), который может уйти агенту. */
export type AgentMessageRole = 'human' | 'agent';

/** Вопрос человека к агенту и ответ агента на уровне всего ревью. */
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
    side: Side;
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

export interface Review {
    id: string;
    info: ReviewInfo;
    diff: DiffFile[];
    threads: Thread[];
    /** Реакции на сам MR/PR (описание), не на комментарий. */
    reactions: Reaction[];
    /** Семантические группы изменений. */
    groups: import('./groups.js').ChangeGroup[];
    summary: ReviewSummary | null;
    findings: Finding[];
    drafts: ReplyDraft[];
    notes: LineNote[];
    /** Вопросы человека к агенту и ответы агента (не публикуются в платформу). */
    agentMessages: AgentMessage[];
    decisions: Record<string, { decision: Decision | null; note: string }>;
    user: User | null;
    syncedAt: string;
    errors: string[];
    /** Запрет изменений и публикации, задаётся review.readOnly. */
    readOnly: boolean;
}

export type ReviewVerdict = 'comment' | 'approve' | 'request_changes';
export type PublishKind = 'reply' | 'finding' | 'note' | 'review';

export interface PublishItem {
    kind: PublishKind;
    /** threadId для reply, finding id для finding, note id для note. */
    id: string;
    body: string;
    resolve?: boolean;
    file?: string;
    line?: number | null;
    side?: Side;
    /** Только для kind=review: итоговый вердикт платформы. */
    verdict?: ReviewVerdict;
}

export interface PublishPlan {
    reviewId: string;
    kind: PublishKind;
    items: PublishItem[];
    /** sha256 канонического JSON items; подтверждается человеком и проверяется при записи. */
    hash: string;
    createdAt: string;
}

export interface PublishResultItem {
    kind: PublishKind;
    id: string;
    ok: boolean;
    discussionId?: string;
    noteId?: string;
    error?: string;
    skipped?: boolean;
}

export interface PublishResult {
    reviewId: string;
    results: PublishResultItem[];
    startedAt: string;
    finishedAt: string;
}

export interface Approval {
    id: string;
    reviewId: string;
    hash: string;
    kind: PublishKind;
    expiresAt: string;
    usedAt: string | null;
    createdAt: string;
}

export interface RuleDocument {
    path: string;
    exists: boolean;
    /** Запрошенные секции; пустой массив — документ целиком. */
    sections: string[];
    excerpt: string;
    truncated: boolean;
}

export interface RuleScope {
    /** Путь файла из diff либо '' для общих правил. */
    file: string;
    kind: 'app' | 'test' | 'style' | 'config' | 'docs' | 'generated' | 'other';
    documents: RuleDocument[];
}

export type PlatformCheckStatus = 'success' | 'failed' | 'pending' | 'neutral' | 'skipped';

export interface PlatformCheck {
    id: string;
    name: string;
    status: PlatformCheckStatus;
    url: string | null;
}

export interface ReviewApprovals {
    approved: number;
    required: number | null;
    changesRequested: number;
}

/** Платформенные checks/approvals для панели готовности к мержу. */
export interface ReviewReadiness {
    checks: PlatformCheck[];
    approvals: ReviewApprovals | null;
    errors: string[];
    checkedAt: string;
}

export interface CheckResult {
    id: string;
    name: string;
    argv: string[];
    status: 'passed' | 'failed' | 'error' | 'skipped';
    output: string;
    durationMs: number;
}

export interface EffectiveRules {
    configPath: string | null;
    scopes: RuleScope[];
    checks: { id: string; name: string; argv: string[]; consent: boolean; matched: boolean }[];
    /** Предупреждения: документ не найден, путь не сопоставлен и т.п. */
    warnings: string[];
}
