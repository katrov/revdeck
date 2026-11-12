export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = 'ApiError';
    }
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

export const getReviews = () => api<{ reviews: import('./types').ReviewListItem[] }>('/api/reviews');

export const getDiff = (review: string, file: string) =>
    api<{ file: import('./types').DiffPayload }>(`/api/diff?review=${encodeURIComponent(review)}&file=${encodeURIComponent(file)}`);

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

export const previewPublish = (review: string, kind: 'reply' | 'finding' | 'note', ids: string[]) =>
    api<{ preview: import('./types').PublishPreview }>('/api/publish/preview', { body: { review, kind, ids } });

export const approvePublish = (review: string, kind: 'reply' | 'finding' | 'note', ids: string[], hash: string) =>
    api<{ approval: { id: string; expiresAt: string } }>('/api/publish/approve', { body: { review, kind, ids, hash } });

export const commitPublish = (review: string, approvalId: string) =>
    api<{ result: import('./types').PublishResult }>('/api/publish/commit', { body: { review, approvalId } });
