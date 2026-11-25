export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export async function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const data = await api<{ result: T }>('/api/rpc', { body: { method, params } });
    return data.result;
}

export async function api<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
    const response = await fetch(path, {
        method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
        credentials: 'same-origin',
        headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let data: { ok?: boolean; error?: string } & Record<string, unknown> = {};
    try {
        data = text ? (JSON.parse(text) as typeof data) : {};
    } catch {
        throw new ApiError(text.slice(0, 300) || `HTTP ${response.status}`, response.status);
    }
    if (!response.ok || data.ok === false) {
        throw new ApiError(String(data.error ?? `HTTP ${response.status}`), response.status);
    }
    return data as T;
}

export const getState = (review: string) =>
    api<{ review: import('./types').ReviewView; reviews: import('./types').ReviewListItem[] }>(`/api/state?review=${encodeURIComponent(review)}`);

export const getProjects = () => api<{ projects: import('./types').ProjectSummary[] }>('/api/projects');

export interface RemoteReview {
    ref: { platform: 'gitlab' | 'github'; host: string; project: string; number: number };
    title: string;
    author: string;
    updatedAt: string;
    state: string;
    draft: boolean;
    webUrl: string;
    sourceBranch?: string;
    targetBranch?: string;
    root: string;
    projectKey: string;
}

export const getRemoteReviews = (root: string, scope: 'open' | 'mine' | 'reviewing', limit = 100) =>
    rpc<{ items: Omit<RemoteReview, 'root' | 'projectKey'>[]; platform: string; project: string }>('reviews.remoteList', {
        root,
        scope,
        limit,
    });

export const getReviews = (project?: string) =>
    api<{ reviews: import('./types').ReviewListItem[] }>(`/api/reviews${project ? `?project=${encodeURIComponent(project)}` : ''}`);

export const registerProject = (root: string) =>
    api<{ project: import('./types').ProjectSummary | null; projects: import('./types').ProjectSummary[] }>('/api/projects/register', {
        body: { root },
    });

export const updateProject = (project: string, patch: { title?: string; roots?: string[] }) =>
    api<{ project: import('./types').ProjectSummary | null; projects: import('./types').ProjectSummary[] }>('/api/projects/update', {
        body: { project, ...patch },
    });

export const removeProject = (project: string) =>
    api<{ removedReviews: number; projects: import('./types').ProjectSummary[] }>('/api/projects/remove', {
        body: { project },
    });

export const getDiff = (review: string, file: string) =>
    api<{ file: import('./types').DiffPayload }>(`/api/diff?review=${encodeURIComponent(review)}&file=${encodeURIComponent(file)}`);

export const getFileContent = (review: string, file: string) =>
    api<{ file: import('./types').FileContentPayload }>(`/api/file?review=${encodeURIComponent(review)}&file=${encodeURIComponent(file)}`);

export const getUpdate = (refresh = false) =>
    api<{ update: import('./types').UpdateInfo }>(`/api/update${refresh ? '?refresh=1' : ''}`);

export const runChecks = (review: string, ids?: string[]) =>
    api<{ results: { id: string; name: string; argv: string[]; status: 'passed' | 'failed' | 'error' | 'skipped'; output: string; durationMs: number }[] }>(
        '/api/checks',
        { body: { review, run: true, ...(ids?.length ? { ids } : {}) } },
    );

export const getRules = (review: string) =>
    api<{ rules: { markdown: string; configPath: string | null; warnings: string[]; checks: { id: string; name: string; argv: string[]; consent: boolean; matched: boolean }[] } }>(
        `/api/rules?review=${encodeURIComponent(review)}`,
    );

export const getReactions = (review: string, noteIds: string[]) =>
    api<{ reactions: Record<string, import('./types').Reaction[]> }>(
        `/api/reactions?review=${encodeURIComponent(review)}&notes=${encodeURIComponent(noteIds.join(','))}`,
    );

export const toggleReaction = (review: string, noteId: string, emoji: string) =>
    api<{ active: boolean; reactions: import('./types').Reaction[] }>('/api/reactions', { body: { review, noteId, emoji } });

export const addAgentMessage = (review: string, text: string) =>
    api<{ message: import('./types').AgentMessage }>('/api/messages', { body: { review, text } });

export const getVersions = (review: string) =>
    api<{ versions: { id: number; headSha: string; baseSha: string; createdAt: string; files: number; findings: number; additions: number; deletions: number }[] }>(
        `/api/versions?review=${encodeURIComponent(review)}`,
    );

export const getVersion = (review: string, id: number) =>
    api<{ version: { id: number; createdAt: string; data: unknown } | null }>(`/api/version?review=${encodeURIComponent(review)}&id=${id}`);

export const getSecrets = (review: string) =>
    api<{
        enabled: boolean;
        scan: string;
        findings: { rule: string; title: string; file: string; line: number; preview: string }[];
    }>(`/api/secrets?review=${encodeURIComponent(review)}`);

export const getQualityMetrics = (project: string, from?: string, to?: string) => {
    const params = new URLSearchParams({ project });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return api<{ metrics: import('./types').QualityMetrics }>(`/api/metrics?${params.toString()}`);
};

export const getAnalytics = (review: string) =>
    api<{
        analytics: {
            generatedAt: string;
            findings: { total: number; accepted: number; rejected: number; discussed: number; pending: number; published: number };
            levels: Record<string, number>;
            threads: { total: number; open: number; resolved: number };
            drafts: { ready: number; published: number };
            acceptanceRate: number | null;
            rejections: { id: string; level: string; file: string; line: number | null; title: string; note: string }[];
        };
    }>(`/api/analytics?review=${encodeURIComponent(review)}`);

export const getReviewReactions = (review: string) =>
    api<{ reactions: import('./types').Reaction[] }>(`/api/review-reactions?review=${encodeURIComponent(review)}`);

export const toggleReviewReaction = (review: string, emoji: string) =>
    api<{ active: boolean; reactions: import('./types').Reaction[] }>('/api/review-reactions', { body: { review, emoji } });

export const openPreview = (
    root: string,
    input: string,
    options: { platform?: string; project?: string; host?: string; branch?: string; force?: boolean } = {},
) =>
    api<{ preview: import('./types').ReviewView }>('/api/previews/open', {
        body: { root, input, ...options },
    });

export const openReview = (root: string, input: string, options: { platform?: string; project?: string; host?: string; branch?: string } = {}) =>
    api<{ review: import('./types').ReviewView; reviews: import('./types').ReviewListItem[] }>('/api/reviews/open', {
        body: { root, input, ...options },
    });

export const removeReview = (review: string) => api<{ ok: true }>('/api/reviews/remove', { body: { review } });

export const refreshReview = (review: string) => api<{ review: import('./types').ReviewView; reviews: import('./types').ReviewListItem[] }>('/api/reviews/refresh', { body: { review } });

export const saveDraft = (review: string, threadId: string, patch: Record<string, unknown>) =>
    api<{ draft: import('./types').ReplyDraft }>('/api/drafts', { body: { review, threadId, patch } });

export const saveFindings = (review: string, findings: import('./types').Finding[]) =>
    api<{ findings: import('./types').Finding[] }>('/api/findings', {
        body: {
            review,
            findings: findings.map((finding) => ({
                id: finding.id,
                level: finding.level,
                file: finding.file,
                line: finding.line,
                title: finding.title,
                body: finding.body,
                comment: finding.comment,
                agentNote: finding.agentNote ?? '',
            })),
        },
    });

export const saveDecisions = (review: string, decisions: Record<string, { decision: string | null; note: string }>) =>
    api<{ decisions: unknown }>('/api/decisions', { body: { review, decisions } });

export const addNote = (review: string, file: string, line: number, text: string) =>
    api<{ note: import('./types').LineNote }>('/api/notes', { body: { review, action: 'add', file, line, text, toAgent: true } });

export const updateNote = (review: string, noteId: string, patch: Record<string, unknown>) =>
    api<{ note: import('./types').LineNote }>('/api/notes', { body: { review, action: 'update', noteId, patch } });

export const deleteNote = (review: string, noteId: string) => api<{ ok: true }>('/api/notes', { body: { review, action: 'delete', noteId } });

export const updateComment = (review: string, noteId: string, body: string) =>
    api<{ ok: true }>('/api/comments', { body: { review, action: 'update', noteId, body } });

export const deleteComment = (review: string, noteId: string) =>
    api<{ ok: true }>('/api/comments', { body: { review, action: 'delete', noteId } });

export interface UploadedAttachment {
    name: string;
    url: string;
    markdown: string;
}

export async function uploadAttachment(review: string, file: File): Promise<UploadedAttachment> {
    const data = await fileToBase64(file);
    const result = await api<{ attachment: UploadedAttachment }>('/api/attachments', {
        body: { review, name: file.name, type: file.type, data },
    });
    return result.attachment;
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('не удалось прочитать файл'));
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(file);
    });
}

export const previewPublish = (review: string, kind: 'reply' | 'finding' | 'note', ids: string[]) =>
    api<{ preview: import('./types').PublishPreview }>('/api/publish/preview', { body: { review, kind, ids } });

export const approvePublish = (review: string, kind: 'reply' | 'finding' | 'note', ids: string[], hash: string) =>
    api<{ approval: { id: string; expiresAt: string } }>('/api/publish/approve', { body: { review, kind, ids, hash } });

export const commitPublish = (review: string, approvalId: string) =>
    api<{ result: import('./types').PublishResult }>('/api/publish/commit', { body: { review, approvalId } });

export const getFeatures = (project?: string, includeArchived = false) =>
    rpc<{ features: import('./types').FeatureSummary[] }>('features.list', {
        ...(project ? { project } : {}),
        includeArchived,
    });

export const getFeature = (feature: string) =>
    rpc<{ feature: import('./types').FeatureDetail }>('features.get', { feature });

export const createFeature = (input: { title: string; brief?: string; contract?: string; reviews?: { review: string; role?: string }[] }) =>
    rpc<{ feature: import('./types').FeatureDetail }>('features.create', input);

export const updateFeature = (feature: string, patch: { title?: string; brief?: string; contract?: string; status?: 'open' | 'archived' }) =>
    rpc<{ feature: import('./types').FeatureDetail }>('features.update', { feature, ...patch });

export const addFeatureReviews = (feature: string, reviews: { review: string; role?: string }[]) =>
    rpc<{ feature: import('./types').FeatureDetail }>('features.addReviews', { feature, reviews });

export const removeFeatureReview = (feature: string, review: string) =>
    rpc<{ feature: import('./types').FeatureDetail }>('features.removeReview', { feature, review });

export const getFeatureContext = (feature: string, maxBytes?: number) =>
    rpc<{ feature: import('./types').FeatureDetail; markdown: string }>('features.context', {
        feature,
        ...(maxBytes ? { maxBytes } : {}),
    });

export const getFeaturesForReview = (review: string) =>
    rpc<{ features: import('./types').FeatureSummary[] }>('features.forReview', { review });

export const addFeatureNote = (
    feature: string,
    input: { kind?: 'note' | 'finding'; level?: string; title: string; body: string; author?: 'human' | 'agent' },
) => rpc<{ note: import('./types').FeatureNote }>('features.addNote', { feature, ...input });

export const updateFeatureNote = (
    feature: string,
    note: string,
    patch: { kind?: 'note' | 'finding'; level?: string; title?: string; body?: string },
) => rpc<{ note: import('./types').FeatureNote }>('features.updateNote', { feature, note, ...patch });

export const deleteFeatureNote = (feature: string, note: string) =>
    rpc<{ ok: true }>('features.deleteNote', { feature, note });

export const reorderFeature = (feature: string, reviews: string[]) =>
    rpc<{ feature: import('./types').FeatureDetail }>('features.reorder', { feature, reviews });

export const deleteFeature = (feature: string) => rpc<{ ok: true }>('features.delete', { feature });
