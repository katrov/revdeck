/**
 * Резервная копия несохранённого текста в localStorage.
 *
 * Автосохранение в демон отложено, а при обрыве связи вкладка перезагружается
 * после восстановления доступа. Без копии последние набранные символы исчезли
 * бы. Копия стирается, как только демон подтвердил сохранение.
 */

export type DraftKind = 'thread' | 'finding';

export interface DraftBackup {
    /** Момент последнего ввода, мс. */
    at: number;
    body?: string;
    noteForAgent?: string;
    comment?: string;
    agentNote?: string;
}

const PREFIX = 'revdeck.draftBackup.';

function storageKey(review: string, kind: DraftKind, id: string): string {
    return `${PREFIX}${review}.${kind}.${id}`;
}

export function readDraftBackup(review: string, kind: DraftKind, id: string): DraftBackup | null {
    try {
        const raw = localStorage.getItem(storageKey(review, kind, id));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DraftBackup>;
        if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;
        const backup: DraftBackup = { at: parsed.at };
        for (const field of ['body', 'noteForAgent', 'comment', 'agentNote'] as const) {
            if (typeof parsed[field] === 'string') backup[field] = parsed[field];
        }
        return backup;
    } catch {
        return null;
    }
}

export function writeDraftBackup(review: string, kind: DraftKind, id: string, patch: Partial<Omit<DraftBackup, 'at'>>): void {
    try {
        const previous = readDraftBackup(review, kind, id) ?? { at: 0 };
        const next: DraftBackup = { ...previous, ...patch, at: Date.now() };
        localStorage.setItem(storageKey(review, kind, id), JSON.stringify(next));
    } catch {
        // localStorage может быть недоступен или переполнен: это только страховка.
    }
}

export function clearDraftBackup(review: string, kind: DraftKind, id: string): void {
    try {
        localStorage.removeItem(storageKey(review, kind, id));
    } catch {
        // см. writeDraftBackup
    }
}

/** Убрать копии всех черновиков ревью: например, когда ревью удаляют из списка. */
export function clearReviewDraftBackups(review: string): void {
    try {
        const prefix = `${PREFIX}${review}.`;
        const keys: string[] = [];
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (key?.startsWith(prefix)) keys.push(key);
        }
        for (const key of keys) localStorage.removeItem(key);
    } catch {
        // см. writeDraftBackup
    }
}
