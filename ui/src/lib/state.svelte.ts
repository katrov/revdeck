import { getReviews, getState, refreshReview } from './api';
import type { ReviewListItem, ReviewView, Tab } from './types';
import { i18n, localeTag, t } from './i18n.svelte';

export interface Toast {
    text: string;
    kind: 'info' | 'ok' | 'error';
    id: number;
}

export const app = $state({
    reviews: [] as ReviewListItem[],
    review: null as ReviewView | null,
    tab: 'overview' as Tab,
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

export function setTab(tab: Tab): void {
    app.tab = tab;
    writeHash();
}

export async function loadReviews(): Promise<void> {
    try {
        app.reviews = (await getReviews()).reviews;
    } catch (error) {
        app.error = errorText(error);
    }
}

export async function loadReview(id: string, options: { refresh?: boolean; silent?: boolean } = {}): Promise<void> {
    if (!options.silent) app.loading = true;
    app.error = '';
    try {
        const data = options.refresh ? await refreshReview(id) : await getState(id);
        app.review = data.review;
        app.reviews = data.reviews;
        if (!app.diffFile && data.review.files.length) app.diffFile = data.review.files[0]!.path;
        writeHash();
    } catch (error) {
        app.error = errorText(error);
        if (!options.silent) notify(app.error, 'error');
    } finally {
        app.loading = false;
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
    return () => source.close();
}

export function parseHash(): { id: string | null; tab: Tab } {
    const match = /^#\/r\/([^/]+)(?:\/([a-z]+))?$/.exec(location.hash);
    if (!match) return { id: null, tab: 'overview' };
    const tab = (['overview', 'threads', 'findings', 'diff', 'rules'] as const).includes(match[2] as Tab) ? (match[2] as Tab) : 'overview';
    return { id: decodeURIComponent(match[1]!), tab };
}

export function writeHash(): void {
    const id = app.review?.id;
    if (!id) return;
    const hash = `#/r/${encodeURIComponent(id)}/${app.tab}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
}

export async function bootstrap(): Promise<void> {
    await loadReviews();
    const route = parseHash();
    const queryReview = new URLSearchParams(location.search).get('review');
    const id = route.id ?? queryReview ?? app.reviews[0]?.id ?? null;
    app.tab = route.tab;
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
    setTab('diff');
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
