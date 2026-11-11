import { createHash } from 'node:crypto';
import { LEVELS, type Decision, type Finding, type FindingStatus, type Level } from './types.js';
import { normalizeLevel } from './refs.js';

export interface FindingDraft {
    id?: string;
    level: Level;
    file: string;
    line: number | null;
    endLine?: number | null;
    title: string;
    body: string;
    comment: string;
}

export interface FindingValidation {
    value: FindingDraft | null;
    error: string;
}

const LEVEL_ORDER: Record<Level, number> = { blocker: 0, major: 1, minor: 2, question: 3 };

/** Проверяет и нормализует замечание, пришедшее от агента (CLI/MCP). */
export function validateFinding(raw: unknown): FindingValidation {
    if (!raw || typeof raw !== 'object') return { value: null, error: 'замечание должно быть объектом' };
    const item = raw as Record<string, unknown>;
    const file = typeof item.file === 'string' ? item.file.trim() : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const body = typeof item.body === 'string' ? item.body.trim() : '';
    const comment = typeof item.comment === 'string' ? item.comment.trim() : body;
    if (!file) return { value: null, error: 'не указан file' };
    if (!title) return { value: null, error: 'не указан title' };
    if (!comment) return { value: null, error: 'пустой comment' };
    const line = item.line === null || item.line === undefined || item.line === '' ? null : Number(item.line);
    if (line !== null && (!Number.isInteger(line) || line < 1)) return { value: null, error: `некорректный line: ${String(item.line)}` };
    const endLine = item.endLine === null || item.endLine === undefined ? null : Number(item.endLine);
    if (endLine !== null && (!Number.isInteger(endLine) || line === null || endLine < line)) {
        return { value: null, error: 'endLine должен быть не меньше line' };
    }
    const level = normalizeLevel(item.level);
    if (item.level !== undefined && !(LEVELS as readonly string[]).includes(String(item.level))) {
        return { value: null, error: `неизвестный level: ${String(item.level)} (ожидается ${LEVELS.join(', ')})` };
    }
    return {
        value: {
            ...(typeof item.id === 'string' && item.id ? { id: item.id } : {}),
            level,
            file,
            line,
            endLine,
            title,
            body,
            comment,
        },
        error: '',
    };
}

/**
 * Отпечаток замечания для повторного ревью: не зависит от номера строки,
 * поэтому после новых коммитов замечание остаётся тем же.
 */
export function fingerprintOf(input: { file: string; level: string; title: string }): string {
    return createHash('sha256')
        .update(`${input.file.trim().toLowerCase()}|${input.level}|${input.title.trim().toLowerCase().replace(/\s+/g, ' ')}`)
        .digest('hex');
}

export interface MergeOptions {
    now?: string;
}

/**
 * Сливает новый набор замечаний с прежним, сохраняя решения пользователя и
 * статус публикации. Замечания, которых больше нет в diff, помечаются stale,
 * а не удаляются: от их id зависят решения и уже отправленные комментарии.
 */
export function mergeFindings(previous: Finding[], incoming: FindingDraft[], options: MergeOptions = {}): Finding[] {
    const now = options.now ?? new Date().toISOString();
    const byId = new Map(previous.map((item) => [item.id, item]));
    const byFingerprint = new Map(previous.map((item) => [item.fingerprint, item]));
    const byPlace = new Map(previous.filter((item) => item.line !== null).map((item) => [`${item.file}:${item.line}:${item.level}`, item]));
    const used = new Set<string>();
    const result: Finding[] = [];

    for (const draft of incoming) {
        const fingerprint = fingerprintOf(draft);
        const match =
            (draft.id ? byId.get(draft.id) : undefined) ??
            byFingerprint.get(fingerprint) ??
            (draft.line !== null ? byPlace.get(`${draft.file}:${draft.line}:${draft.level}`) : undefined);

        if (match) {
            used.add(match.id);
            result.push({
                ...match,
                level: draft.level,
                file: draft.file,
                line: draft.line,
                endLine: draft.endLine ?? null,
                title: draft.title,
                body: draft.body,
                // Опубликованный текст не переписываем: он уже виден автору MR.
                comment: match.status === 'published' ? match.comment : draft.comment,
                status: match.status === 'stale' ? 'draft' : match.status,
                fingerprint,
            });
            continue;
        }

        const id = draft.id && !used.has(draft.id) ? draft.id : uniqueId(fingerprint, used, byId);
        used.add(id);
        result.push({
            id,
            fingerprint,
            level: draft.level,
            file: draft.file,
            line: draft.line,
            endLine: draft.endLine ?? null,
            title: draft.title,
            body: draft.body,
            comment: draft.comment,
            status: 'draft',
            discussionId: null,
            publishedAt: null,
            decision: null,
            note: '',
            publishError: '',
        });
    }

    for (const old of previous) {
        if (used.has(old.id)) continue;
        result.push({
            ...old,
            status: old.status === 'published' ? 'published' : 'stale',
        });
    }

    return result.sort((a, b) => levelOrder(a.level) - levelOrder(b.level) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

function uniqueId(fingerprint: string, used: Set<string>, byId: Map<string, Finding>): string {
    for (let length = 8; length <= fingerprint.length; length += 2) {
        const candidate = `f-${fingerprint.slice(0, length)}`;
        if (!used.has(candidate) && !byId.has(candidate)) return candidate;
    }
    return `f-${fingerprint}`;
}

export function levelOrder(level: Level): number {
    return LEVEL_ORDER[level];
}

/** Применяет решения пользователя к замечаниям (accept/reject/discuss). */
export function applyDecisions(findings: Finding[], decisions: Record<string, { decision: Decision | null; note: string }>): Finding[] {
    return findings.map((item) => {
        const decision = decisions[item.id];
        if (!decision) return item;
        return { ...item, decision: decision.decision, note: decision.note };
    });
}

export function statusLabel(status: FindingStatus): string {
    switch (status) {
        case 'draft':
            return 'черновик';
        case 'accepted':
            return 'принято';
        case 'rejected':
            return 'отклонено';
        case 'published':
            return 'опубликовано';
        case 'fixed':
            return 'исправлено';
        case 'stale':
            return 'устарело';
    }
}
