import { getReactions, getReviews, getState, refreshReview } from './api';
import type { ReviewListItem, ReviewView, Tab } from './types';
import { i18n, localeTag, t } from './i18n.svelte';

export interface Toast {
    text: string;
    kind: 'info' | 'ok' | 'error';
    id: number;
}

export type Focus =
    | { kind: 'thread'; id: string }
    | { kind: 'finding'; id: string }
    | { kind: 'note'; id: string }
    | { kind: 'line'; file: string; line: number }
    | null;

export const app = $state({
    reviews: [] as ReviewListItem[],
    review: null as ReviewView | null,
    tab: 'overview' as Tab,
    focus: null as Focus,
    loading: false,
    error: '',
    toast: null as Toast | null,
    diffFile: null as string | null,
    diffFocus: null as { file: string; line: number } | null,
    publishing: null as null | { kind: 'reply' | 'finding' | 'note'; ids: string[] },
    palette: false,
});

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let loadRequest = 0;

export function notify(text: string, kind: Toast['kind'] = 'info'): void {
    app.toast = { text, kind, id: Date.now() };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        app.toast = null;
    }, 4500);
}

export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function setTab(tab: Tab, push = true): void {
    app.tab = tab;
    app.focus = null;
    writeHash(push);
}

export async function loadReviews(): Promise<void> {
    try {
        app.reviews = (await getReviews()).reviews;
    } catch (error) {
        app.error = errorText(error);
    }
}

export async function loadReview(id: string, options: { refresh?: boolean; silent?: boolean } = {}): Promise<void> {
    const request = ++loadRequest;
    if (!options.silent) app.loading = true;
    app.error = '';
    try {
        const data = options.refresh ? await refreshReview(id) : await getState(id);
        if (request !== loadRequest) return;
        app.review = data.review;
        app.reviews = data.reviews;
        if (!app.diffFile || !data.review.files.some((file) => file.path === app.diffFile)) {
            app.diffFile = data.review.files[0]?.path ?? null;
        }
        void loadReactions(data.review);
        writeHash(false);
    } catch (error) {
        if (request !== loadRequest) return;
        app.error = errorText(error);
        if (!options.silent) notify(app.error, 'error');
    } finally {
        if (request === loadRequest) app.loading = false;
    }
}

export function scheduleReload(): void {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
        const id = app.review?.id;
        if (id) void loadReview(id, { silent: true });
        void loadReviews();
    }, 350);
}

export function subscribe(): () => void {
    const source = new EventSource('/api/events');
    source.addEventListener('review', () => scheduleReload());
    source.addEventListener('hello', () => undefined);
    // Страховка на случай, если SSE не доходит (прокси, devcontainer):
    // агент пишет черновики, UI подхватывает их без ручного «Обновить».
    const poll = setInterval(() => {
        if (document.visibilityState === 'visible') scheduleReload();
    }, 10_000);
    return () => {
        source.close();
        clearInterval(poll);
    };
}

const TABS: readonly Tab[] = ['overview', 'threads', 'findings', 'diff', 'rules'];

export interface Route {
    id: string | null;
    tab: Tab;
    focus: Focus;
}

export function parseHash(): Route {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] !== 'r' || !parts[1]) return { id: null, tab: 'overview', focus: null };
    const id = decodeURIComponent(parts[1]);
    const tab = TABS.includes(parts[2] as Tab) ? (parts[2] as Tab) : 'overview';
    const rest = parts.slice(3);
    let focus: Focus = null;
    if (rest[0] === 'thread' && rest[1]) focus = { kind: 'thread', id: decodeURIComponent(rest[1]) };
    else if (rest[0] === 'finding' && rest[1]) focus = { kind: 'finding', id: decodeURIComponent(rest[1]) };
    else if (rest[0] === 'note' && rest[1]) focus = { kind: 'note', id: decodeURIComponent(rest[1]) };
    else if (rest[0] === 'line' && rest[1] && rest[2]) {
        const line = Number(rest[2]);
        if (Number.isInteger(line) && line > 0) focus = { kind: 'line', file: decodeURIComponent(rest[1]), line };
    }
    return { id, tab, focus };
}

export function hashFor(tab: Tab, focus: Focus): string {
    const id = app.review?.id;
    if (!id) return '';
    let hash = `#/r/${encodeURIComponent(id)}/${tab}`;
    if (focus?.kind === 'thread') hash += `/thread/${encodeURIComponent(focus.id)}`;
    else if (focus?.kind === 'finding') hash += `/finding/${encodeURIComponent(focus.id)}`;
    else if (focus?.kind === 'note') hash += `/note/${encodeURIComponent(focus.id)}`;
    else if (focus?.kind === 'line') hash += `/line/${encodeURIComponent(focus.file)}/${focus.line}`;
    return hash;
}

export function writeHash(push = false): void {
    const hash = hashFor(app.tab, app.focus);
    if (!hash || location.hash === hash) return;
    history[push ? 'pushState' : 'replaceState'](null, '', hash);
}

export function copyFocusLink(focus: Focus, tab: Tab = app.tab): void {
    const hash = hashFor(tab, focus);
    if (!hash) return;
    const url = `${location.origin}${location.pathname}${hash}`;
    void navigator.clipboard?.writeText(url).then(
        () => notify(t('Ссылка скопирована', 'Link copied'), 'ok'),
        () => notify(t('Не удалось скопировать', 'Could not copy'), 'error'),
    );
}

export function applyRoute(): void {
    const route = parseHash();
    app.tab = route.tab;
    app.focus = route.focus;
    if (route.focus?.kind === 'line') {
        app.diffFile = route.focus.file;
        app.diffFocus = { file: route.focus.file, line: route.focus.line };
    }
    if (route.id && route.id !== app.review?.id) {
        void loadReview(route.id, { silent: true });
        return;
    }
    writeHash(false);
}

export function focusThread(id: string): void {
    app.tab = 'threads';
    app.focus = { kind: 'thread', id };
    writeHash(true);
}

export function focusFinding(id: string): void {
    app.tab = 'findings';
    app.focus = { kind: 'finding', id };
    writeHash(true);
}

export function focusNote(note: { id: string; file: string; line: number }): void {
    app.tab = 'diff';
    app.focus = { kind: 'note', id: note.id };
    app.diffFile = note.file;
    app.diffFocus = { file: note.file, line: note.line };
    writeHash(true);
}

async function loadReactions(review: ReviewView): Promise<void> {
    const notes = review.threads.flatMap((thread) => thread.notes);
    if (!notes.length) return;
    try {
        const { reactions } = await getReactions(review.id, notes.map((note) => note.id));
        if (app.review?.id !== review.id) return;
        for (const note of notes) note.reactions = reactions[note.id] ?? [];
    } catch {
        // Реакции не критичны для чтения ревью.
    }
}

export async function bootstrap(): Promise<void> {
    await loadReviews();
    const route = parseHash();
    const queryReview = new URLSearchParams(location.search).get('review');
    const id = route.id ?? queryReview ?? app.reviews[0]?.id ?? null;
    app.tab = route.tab;
    app.focus = route.focus;
    if (route.focus?.kind === 'line') {
        app.diffFile = route.focus.file;
        app.diffFocus = { file: route.focus.file, line: route.focus.line };
    }
    if (id) await loadReview(id);
}

export function draftFor(threadId: string) {
    return app.review?.drafts.find((draft) => draft.threadId === threadId) ?? null;
}

export function threadFor(threadId: string) {
    return app.review?.threads.find((thread) => thread.id === threadId) ?? null;
}

export function focusLine(file: string, line: number | null): void {
    app.diffFile = file;
    app.diffFocus = line ? { file, line } : null;
    app.tab = 'diff';
    app.focus = line ? { kind: 'line', file, line } : null;
    writeHash(true);
}

export function relativeTime(iso: string): string {
    if (!iso) return '';
    const value = new Date(iso).getTime();
    if (Number.isNaN(value)) return iso;
    const minutes = Math.round((Date.now() - value) / 60000);
    if (minutes < 1) return t('только что', 'just now');
    if (minutes < 60) return i18n.locale === 'ru' ? `${minutes} мин назад` : `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return i18n.locale === 'ru' ? `${hours} ч назад` : `${hours} h ago`;
    return new Date(iso).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' });
}
