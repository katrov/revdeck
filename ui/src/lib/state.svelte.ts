import { getFeature, getFeatureContext, getFeatures, getFeaturesForReview, getProjects, getReactions, getReviews, getState, refreshReview } from './api';
import type { FeatureDetail, FeatureSummary, ProjectSummary, ReviewListItem, ReviewView, Tab } from './types';
import { projectKeyFromReviewId } from './projects';
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
    projects: [] as ProjectSummary[],
    activeProject: null as string | null,
    projectsHome: false,
    projectSwitcher: false,
    features: [] as FeatureSummary[],
    featureRevision: 0,
    feature: null as FeatureDetail | null,
    featuresHome: false,
    featureContext: '',
    reviewFeatures: [] as FeatureSummary[],
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
let reloadPending = false;
let loadRequest = 0;
let featureRequest = 0;
let reviewFeaturesRequest = 0;
let routeEpoch = 0;

/** Не перезагружаем ревью, пока пользователь печатает: SSE/поллинг не должны затирать текст. */
export function isEditingText(): boolean {
    if (typeof document === 'undefined') return false;
    const element = document.activeElement;
    if (!element) return false;
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLInputElement) {
        return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(element.type);
    }
    return (element as HTMLElement).isContentEditable;
}

export function flushPendingReload(): void {
    if (!reloadPending || isEditingText()) return;
    reloadPending = false;
    scheduleReload();
}

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

const ACTIVE_PROJECT_KEY = 'revdeck.project';
const PINNED_PROJECTS_KEY = 'revdeck.pinnedProjects';

export function storedProject(): string | null {
    try {
        return localStorage.getItem(ACTIVE_PROJECT_KEY);
    } catch {
        return null;
    }
}

export function storeProject(key: string | null): void {
    try {
        if (key) localStorage.setItem(ACTIVE_PROJECT_KEY, key);
        else localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } catch {
        // localStorage может быть недоступен.
    }
}

export function pinnedProjects(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(PINNED_PROJECTS_KEY) ?? '[]') as unknown;
        return Array.isArray(value) ? value.map(String) : [];
    } catch {
        return [];
    }
}

export function togglePinnedProject(key: string): void {
    const current = pinnedProjects();
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    try {
        localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(next));
    } catch {
        // localStorage может быть недоступен.
    }
    app.projects = [...app.projects];
}

export async function loadProjects(): Promise<void> {
    try {
        app.projects = (await getProjects()).projects;
        if (app.activeProject && !app.projects.some((project) => project.key === app.activeProject)) {
            app.activeProject = app.projects[0]?.key ?? null;
            storeProject(app.activeProject);
        }
        if (!app.activeProject) {
            app.activeProject = app.projects[0]?.key ?? null;
            storeProject(app.activeProject);
        }
    } catch (error) {
        app.error = errorText(error);
    }
}

export async function loadReviews(): Promise<void> {
    try {
        app.reviews = (await getReviews(app.activeProject ?? undefined)).reviews;
    } catch (error) {
        app.error = errorText(error);
    }
}

export async function loadFeatures(): Promise<void> {
    try {
        app.features = (await getFeatures(app.activeProject ?? undefined)).features;
        app.featureRevision += 1;
    } catch (error) {
        app.error = errorText(error);
    }
}

export async function loadReviewFeatures(review: string): Promise<void> {
    const request = ++reviewFeaturesRequest;
    try {
        const result = (await getFeaturesForReview(review)).features;
        if (request === reviewFeaturesRequest && app.review?.id === review) app.reviewFeatures = result;
    } catch {
        if (request === reviewFeaturesRequest && app.review?.id === review) app.reviewFeatures = [];
    }
}

export async function loadFeature(id: string, options: { push?: boolean } = {}): Promise<void> {
    const request = ++featureRequest;
    ++loadRequest;
    const epoch = routeEpoch;
    try {
        const { feature } = await getFeature(id);
        if (request !== featureRequest || epoch !== routeEpoch) return;
        app.error = '';
        app.feature = feature;
        app.featuresHome = false;
        app.review = null;
        app.featureContext = '';
        app.projectSwitcher = false;
        writeHash(options.push ?? true);
    } catch (error) {
        if (request !== featureRequest || epoch !== routeEpoch) return;
        app.error = errorText(error);
    }
}

export async function loadFeatureContext(id: string, maxBytes?: number): Promise<void> {
    const result = await getFeatureContext(id, maxBytes);
    app.featureContext = result.markdown;
}

export async function showFeaturesHome(push = true): Promise<void> {
    const epoch = routeEpoch;
    app.featuresHome = true;
    app.feature = null;
    app.review = null;
    app.featureContext = '';
    app.projectSwitcher = false;
    await loadReviews();
    await loadFeatures();
    if (epoch !== routeEpoch) return;
    writeHash(push);
}

export async function setActiveProject(key: string, selectFirst = true): Promise<void> {
    const epoch = routeEpoch;
    app.projectsHome = false;
    app.featuresHome = false;
    app.feature = null;
    app.featureContext = '';
    app.projectSwitcher = false;
    app.focus = null;
    app.diffFocus = null;
    if (app.activeProject !== key) {
        app.activeProject = key;
        storeProject(key);
        if (app.review && projectKeyFromReviewId(app.review.id) !== key) {
            app.review = null;
            app.diffFile = null;
        }
    }
    await loadReviews();
    await loadFeatures();
    if (epoch !== routeEpoch) return;
    const first = app.reviews[0];
    if (selectFirst && first) {
        await loadReview(first.id);
    } else if (!first) {
        app.review = null;
        writeHash(false);
    }
}

export async function adoptOpenedReview(review: ReviewView): Promise<void> {
    const key = projectKeyFromReviewId(review.id);
    app.activeProject = key;
    storeProject(key);
    app.projectsHome = false;
    app.featuresHome = false;
    app.feature = null;
    app.review = review;
    await loadProjects();
    await loadReviews();
    void loadReviewFeatures(review.id);
    void loadFeatures();
    writeHash(true);
}

export function showProjectsHome(push = true): void {
    app.projectsHome = true;
    app.featuresHome = false;
    app.feature = null;
    app.featureContext = '';
    app.projectSwitcher = false;
    app.review = null;
    app.focus = null;
    writeHash(push);
}

export async function loadReview(id: string, options: { refresh?: boolean; silent?: boolean; push?: boolean } = {}): Promise<void> {
    const request = ++loadRequest;
    ++featureRequest;
    const epoch = routeEpoch;
    if (!options.silent) app.loading = true;
    app.error = '';
    try {
        const data = options.refresh ? await refreshReview(id) : await getState(id);
        if (request !== loadRequest || epoch !== routeEpoch) return;
        const key = projectKeyFromReviewId(data.review.id);
        if (key !== app.activeProject) {
            app.activeProject = key;
            storeProject(key);
        }
        app.projectsHome = false;
        app.featuresHome = false;
        app.feature = null;
        app.featureContext = '';
        app.review = data.review;
        app.reviews = data.reviews.filter((item) => item.projectKey === key);
        void loadReviewFeatures(data.review.id);
        if (!app.diffFile || !data.review.files.some((file) => file.path === app.diffFile)) {
            app.diffFile = data.review.files[0]?.path ?? null;
        }
        // Передаём proxied app.review, иначе запись note.reactions в сырой объект
        // не уведомит Svelte и реакции не появятся до ручного переключения.
        if (app.review) void loadReactions(app.review);
        writeHash(options.push ?? !options.refresh);
    } catch (error) {
        if (request !== loadRequest || epoch !== routeEpoch) return;
        app.error = errorText(error);
        if (!options.silent) notify(app.error, 'error');
    } finally {
        if (request === loadRequest) app.loading = false;
    }
}

export function scheduleReload(): void {
    if (isEditingText()) {
        reloadPending = true;
        return;
    }
    // Пока пользователь открывает другое ревью, фоновый reload старого id
    // мог бы выиграть гонку и вернуть старый сайдбар/контент.
    if (app.loading) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
        reloadTimer = null;
        if (isEditingText()) {
            reloadPending = true;
            return;
        }
        if (app.loading) return;
        const id = app.review?.id;
        if (id) void loadReview(id, { silent: true, push: false });
        const featureId = app.feature?.id;
        if (featureId) void loadFeature(featureId, { push: false });
        void loadProjects();
        void loadReviews();
        void loadFeatures();
    }, 350);
}

export function subscribe(): () => void {
    const source = new EventSource('/api/events');
    source.addEventListener('review', () => scheduleReload());
    source.addEventListener('feature', () => scheduleReload());
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

const TABS: readonly Tab[] = ['overview', 'threads', 'findings', 'diff', 'rules', 'analytics'];

export interface Route {
    id: string | null;
    tab: Tab;
    focus: Focus;
    project: string | null;
    projects: boolean;
    feature: string | null;
    features: boolean;
}

export function parseHash(): Route {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const empty: Route = { id: null, tab: 'overview', focus: null, project: null, projects: false, feature: null, features: false };
    if (parts[0] === 'projects') return { ...empty, projects: true };
    if (parts[0] === 'features') return { ...empty, features: true };
    if (parts[0] === 'f' && parts[1]) return { ...empty, feature: decodeURIComponent(parts[1]) };
    if (parts[0] === 'p' && parts[1]) return { ...empty, project: decodeURIComponent(parts[1]) };
    if (parts[0] !== 'r' || !parts[1]) return empty;
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
    return { id, tab, focus, project: null, projects: false, feature: null, features: false };
}

export function hashFor(tab: Tab, focus: Focus): string {
    if (app.feature) return `#/f/${encodeURIComponent(app.feature.id)}`;
    if (app.featuresHome) return '#/features';
    const id = app.review?.id;
    if (id) {
        let hash = `#/r/${encodeURIComponent(id)}/${tab}`;
        if (focus?.kind === 'thread') hash += `/thread/${encodeURIComponent(focus.id)}`;
        else if (focus?.kind === 'finding') hash += `/finding/${encodeURIComponent(focus.id)}`;
        else if (focus?.kind === 'note') hash += `/note/${encodeURIComponent(focus.id)}`;
        else if (focus?.kind === 'line') hash += `/line/${encodeURIComponent(focus.file)}/${focus.line}`;
        return hash;
    }
    if (app.projectsHome) return '#/projects';
    if (app.activeProject) return `#/p/${encodeURIComponent(app.activeProject)}`;
    return '';
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
    routeEpoch += 1;
    const route = parseHash();
    app.projectSwitcher = false;
    app.tab = route.tab;
    app.focus = route.focus;
    if (route.focus?.kind === 'line') {
        app.diffFile = route.focus.file;
        app.diffFocus = { file: route.focus.file, line: route.focus.line };
    }
    if (route.projects) {
        app.projectsHome = true;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        writeHash(false);
        return;
    }
    if (route.features) {
        app.projectsHome = false;
        app.featuresHome = true;
        app.feature = null;
        app.review = null;
        void loadReviews();
        void loadFeatures();
        writeHash(false);
        return;
    }
    if (route.feature) {
        app.projectsHome = false;
        app.featuresHome = false;
        void loadFeature(route.feature, { push: false });
        return;
    }
    app.projectsHome = false;
    app.featuresHome = false;
    app.feature = null;
    if (route.project) {
        if (route.project !== app.activeProject) {
            app.activeProject = route.project;
            storeProject(route.project);
            app.review = null;
            void loadReviews().then(async () => {
                await loadFeatures();
                const first = app.reviews[0];
                if (first) void loadReview(first.id, { push: false });
                else writeHash(false);
            });
        } else if (!app.review) {
            const first = app.reviews[0];
            if (first) void loadReview(first.id, { push: false });
            else writeHash(false);
        }
        return;
    }
    if (route.id && route.id !== app.review?.id) {
        void loadReview(route.id, { silent: true, push: false });
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
    const route = parseHash();
    const stored = storedProject();
    await loadProjects();
    if (route.project) {
        app.activeProject = route.project;
        storeProject(route.project);
    } else if (route.id) {
        app.activeProject = projectKeyFromReviewId(route.id);
        storeProject(app.activeProject);
    } else if (stored && app.projects.some((project) => project.key === stored)) {
        app.activeProject = stored;
        storeProject(stored);
    }
    app.tab = route.tab;
    app.focus = route.focus;
    if (route.focus?.kind === 'line') {
        app.diffFile = route.focus.file;
        app.diffFocus = { file: route.focus.file, line: route.focus.line };
    }
    if (route.projects) {
        app.projectsHome = true;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        await loadReviews();
        writeHash(false);
        return;
    }
    if (route.features) {
        app.projectsHome = false;
        app.featuresHome = true;
        app.feature = null;
        app.review = null;
        await loadReviews();
        await loadFeatures();
        writeHash(false);
        return;
    }
    if (route.feature) {
        app.projectsHome = false;
        app.featuresHome = false;
        await loadReviews();
        await loadFeature(route.feature, { push: false });
        return;
    }
    app.projectsHome = false;
    app.featuresHome = false;
    app.feature = null;
    await loadReviews();
    await loadFeatures();
    const queryReview = new URLSearchParams(location.search).get('review');
    const id = route.id ?? queryReview ?? (app.activeProject ? app.reviews[0]?.id : null);
    if (id) await loadReview(id, { push: false });
    else writeHash(false);
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
