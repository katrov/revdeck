import { getFeature, getFeatureContext, getFeatures, getFeaturesForReview, getProjects, getReactions, getReviews, getState, openPreview as openPreviewApi, refreshReview } from './api';
import type { FeatureDetail, FeatureSummary, PreviewRef, ProjectSummary, ReviewListItem, ReviewView, Tab } from './types';
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
    mrList: false,
    settings: false,
    featuresHidden: false,
    projectSwitcher: false,
    help: false,
    features: [] as FeatureSummary[],
    featureRevision: 0,
    feature: null as FeatureDetail | null,
    featuresHome: false,
    featureContext: '',
    reviewFeatures: [] as FeatureSummary[],
    reviews: [] as ReviewListItem[],
    review: null as ReviewView | null,
    /** Просмотр MR/PR без записи в ревью. */
    preview: false,
    previewRef: null as PreviewRef | null,
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
type ReloadScope = 'review' | 'feature' | 'project';
const pendingReloadScopes = new Set<ReloadScope>();
let loadRequest = 0;
let featureRequest = 0;
let reviewFeaturesRequest = 0;
let routeEpoch = 0;

interface CachedReviewState {
    review: ReviewView;
    reviews: ReviewListItem[];
}
/** Последние открытые ревью: переключение назад не ждёт /api/state. */
const reviewCache = new Map<string, CachedReviewState>();
const REVIEW_CACHE_LIMIT = 4;

export function forgetReview(id: string): void {
    reviewCache.delete(id);
}

function rememberReview(state: CachedReviewState): void {
    const id = state.review.id;
    reviewCache.delete(id);
    reviewCache.set(id, state);
    while (reviewCache.size > REVIEW_CACHE_LIMIT) {
        const oldest = reviewCache.keys().next().value;
        if (!oldest) break;
        reviewCache.delete(oldest);
    }
}

/** Дешёвое сравнение небольших списков, чтобы не перерисовывать сайдбар зря. */
function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/** syncedAt меняется на каждом sync; для сайдбара важны только видимые поля. */
function sameReviewList(left: ReviewListItem[], right: ReviewListItem[]): boolean {
    const signature = (list: ReviewListItem[]): string =>
        JSON.stringify(list.map((item) => [item.id, item.number, item.title, item.author, item.project, item.projectKey, item.state]));
    return signature(left) === signature(right);
}

/** lastActivity — это MAX(synced_at); сама по себе она не требует перерисовки списка. */
function sameProjectList(left: ProjectSummary[], right: ProjectSummary[]): boolean {
    const signature = (list: ProjectSummary[]): string =>
        JSON.stringify(list.map((item) => [item.key, item.title, item.host, item.project, item.reviews, item.roots, item.updatedAt]));
    return signature(left) === signature(right);
}

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
    if (app.preview && !['overview', 'threads', 'diff'].includes(tab)) return;
    app.tab = tab;
    app.focus = null;
    writeHash(push);
}

const FEATURES_HIDDEN_KEY = 'revdeck.featuresHidden';

export function setFeaturesHidden(hidden: boolean): void {
    app.featuresHidden = hidden;
    try {
        localStorage.setItem(FEATURES_HIDDEN_KEY, hidden ? '1' : '0');
    } catch {
        // localStorage may be unavailable.
    }
}

export function initFeaturesHidden(): void {
    try {
        app.featuresHidden = localStorage.getItem(FEATURES_HIDDEN_KEY) === '1';
    } catch {
        app.featuresHidden = false;
    }
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
        const next = (await getProjects()).projects;
        if (!sameProjectList(next, app.projects)) app.projects = next;
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
        const next = (await getReviews(app.activeProject ?? undefined)).reviews;
        if (!sameReviewList(next, app.reviews)) app.reviews = next;
    } catch (error) {
        app.error = errorText(error);
    }
}

export async function loadFeatures(): Promise<void> {
    try {
        const next = (await getFeatures(app.activeProject ?? undefined)).features;
        if (sameJson(next, app.features)) return;
        app.features = next;
        app.featureRevision += 1;
    } catch (error) {
        app.error = errorText(error);
    }
}

export async function loadReviewFeatures(review: string): Promise<void> {
    const request = ++reviewFeaturesRequest;
    try {
        const result = (await getFeaturesForReview(review)).features;
        if (request === reviewFeaturesRequest && app.review?.id === review && !sameJson(result, app.reviewFeatures)) {
            app.reviewFeatures = result;
        }
    } catch {
        if (request === reviewFeaturesRequest && app.review?.id === review && app.reviewFeatures.length) app.reviewFeatures = [];
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
        if (!sameJson(feature, app.feature)) app.feature = feature;
        app.featuresHome = false;
        app.help = false;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
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

export function showSettings(push = true): void {
    app.settings = true;
    app.projectsHome = false;
    app.mrList = false;
    app.featuresHome = false;
    app.help = false;
    app.feature = null;
    app.projectSwitcher = false;
    app.review = null;
    app.preview = false;
    app.previewRef = null;
    writeHash(push);
}

export async function showMrList(push = true): Promise<void> {
    app.mrList = true;
    app.settings = false;
    app.projectsHome = false;
    app.featuresHome = false;
    app.help = false;
    app.feature = null;
    app.projectSwitcher = false;
    app.review = null;
    app.preview = false;
    app.previewRef = null;
    await Promise.all([loadProjects(), loadReviews(), loadFeatures()]);
    writeHash(push);
}

export async function showFeaturesHome(push = true): Promise<void> {
    const epoch = routeEpoch;
    app.featuresHome = true;
    app.feature = null;
    app.review = null;
    app.preview = false;
    app.previewRef = null;
    app.help = false;
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
    app.mrList = false;
    app.settings = false;
    app.featuresHome = false;
    app.help = false;
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
        app.preview = false;
        app.previewRef = null;
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
        app.preview = false;
        app.previewRef = null;
        writeHash(false);
    }
}

export async function adoptOpenedReview(review: ReviewView): Promise<void> {
    const key = projectKeyFromReviewId(review.id);
    app.activeProject = key;
    storeProject(key);
    app.projectsHome = false;
    app.featuresHome = false;
    app.help = false;
    app.feature = null;
    app.preview = false;
    app.previewRef = null;
    app.mrList = false;
    app.review = review;
    await loadProjects();
    await loadReviews();
    rememberReview({ review, reviews: app.reviews });
    void loadReviewFeatures(review.id);
    void loadFeatures();
    writeHash(true);
}

export function showProjectsHome(push = true): void {
    app.projectsHome = true;
    app.mrList = false;
    app.settings = false;
    app.featuresHome = false;
    app.help = false;
    app.feature = null;
    app.featureContext = '';
    app.projectSwitcher = false;
    app.review = null;
    app.preview = false;
    app.previewRef = null;
    app.focus = null;
    writeHash(push);
}

export function showHelp(push = true): void {
    app.help = true;
    app.projectsHome = false;
    app.featuresHome = false;
    app.feature = null;
    app.featureContext = '';
    app.projectSwitcher = false;
    app.review = null;
    app.preview = false;
    app.previewRef = null;
    app.focus = null;
    app.diffFocus = null;
    writeHash(push);
}

function applyReviewState(state: CachedReviewState, push: boolean, hydrate: boolean, force = false): void {
    const key = projectKeyFromReviewId(state.review.id);
    if (key !== app.activeProject) {
        app.activeProject = key;
        storeProject(key);
    }
    app.projectsHome = false;
    app.featuresHome = false;
    app.help = false;
    app.feature = null;
    app.featureContext = '';
    app.preview = false;
    app.previewRef = null;
    const current = app.review;
    const switching = !current || current.id !== state.review.id;
    if (force || switching) {
        app.review = state.review;
    } else if (current !== state.review) {
        // Фоновый reload не должен менять identity app.review: иначе все эффекты,
        // завязанные на app.review?.id (Rules, Analytics, Diff), перезапускаются
        // и страница мигает «Загрузка…» каждые несколько секунд.
        Object.assign(current, state.review);
    }
    if (switching) app.reviewFeatures = [];
    const nextReviews = state.reviews.filter((item) => item.projectKey === key);
    if (!sameReviewList(nextReviews, app.reviews)) app.reviews = nextReviews;
    if (!app.diffFile || !state.review.files.some((file) => file.path === app.diffFile)) {
        app.diffFile = state.review.files[0]?.path ?? null;
    }
    if (hydrate) {
        void loadReviewFeatures(state.review.id);
        // Передаём proxied app.review, иначе запись note.reactions в сырой объект
        // не уведомит Svelte и реакции не появятся до ручного переключения.
        if (app.review) void loadReactions(app.review);
    }
    writeHash(push);
}

export async function loadPreview(ref: PreviewRef, options: { tab?: Tab; push?: boolean; refresh?: boolean } = {}): Promise<void> {
    const request = ++loadRequest;
    ++featureRequest;
    const epoch = routeEpoch;
    app.loading = true;
    app.error = '';
    try {
        if (!app.projects.length) await loadProjects();
        const key = `${ref.platform}:${ref.host}/${ref.project}`;
        const project = app.projects.find((item) => item.key === key);
        let remembered = '';
        try {
            remembered = localStorage.getItem(`revdeck.previewRoot.${key}`) ?? '';
        } catch {
            // localStorage может быть недоступен.
        }
        const root = project?.roots[0] ?? app.reviews.find((item) => item.projectKey === key)?.root ?? remembered;
        if (!root) throw new Error(t('Проект не зарегистрирован: добавьте рабочую копию.', 'The project is not registered: add a working copy.'));
        const result = await openPreviewApi(root, String(ref.number), {
            platform: ref.platform,
            host: ref.host,
            project: ref.project,
            ...(options.refresh ? { force: true } : {}),
        });
        if (request !== loadRequest || epoch !== routeEpoch) return;
        const same = app.preview && app.review?.id === result.preview.id;
        const previousFile = app.diffFile;
        app.preview = true;
        app.mrList = false;
        app.settings = false;
        app.previewRef = ref;
        app.review = result.preview;
        app.activeProject = key;
        storeProject(key);
        void loadReviews();
        void loadFeatures();
        app.projectsHome = false;
        app.featuresHome = false;
        app.help = false;
        app.feature = null;
        app.featureContext = '';
        app.tab = options.tab && ['overview', 'threads', 'diff'].includes(options.tab) ? options.tab : 'overview';
        if (!same) app.focus = null;
        if (!same) app.diffFocus = null;
        app.diffFile = previousFile && result.preview.files.some((file) => file.path === previousFile)
            ? previousFile
            : (result.preview.files[0]?.path ?? null);
        writeHash(options.push ?? false);
    } catch (error) {
        if (request !== loadRequest || epoch !== routeEpoch) return;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        app.error = errorText(error);
        notify(app.error, 'error');
    } finally {
        if (request === loadRequest) app.loading = false;
    }
}

export function adoptPreview(view: ReviewView, root?: string): void {
    const key = `${view.info.ref.platform}:${view.info.ref.host}/${view.info.ref.project}`;
    if (root) {
        try {
            localStorage.setItem(`revdeck.previewRoot.${key}`, root);
        } catch {
            // localStorage может быть недоступен.
        }
    }
    app.preview = true;
    app.mrList = false;
    app.settings = false;
    app.previewRef = { ...view.info.ref };
    app.review = view;
    app.projectsHome = false;
    app.featuresHome = false;
    app.help = false;
    app.feature = null;
    app.activeProject = `${view.info.ref.platform}:${view.info.ref.host}/${view.info.ref.project}`;
    storeProject(app.activeProject);
    void loadReviews();
    void loadFeatures();
    app.tab = 'overview';
    app.focus = null;
    app.diffFocus = null;
    app.diffFile = view.files[0]?.path ?? null;
    writeHash(true);
}

export async function loadReview(id: string, options: { refresh?: boolean; silent?: boolean; push?: boolean } = {}): Promise<void> {
    const request = ++loadRequest;
    ++featureRequest;
    const epoch = routeEpoch;
    const push = options.push ?? !options.refresh;
    // При переключении на другое ревью показываем последний снимок сразу,
    // не дожидаясь ответа /api/state. Свежие данные придут следом.
    const cached = !options.refresh && app.review?.id !== id ? reviewCache.get(id) : undefined;
    if (cached) applyReviewState(cached, push, false);
    if (!options.silent) app.loading = !cached;
    app.error = '';
    try {
        const data = options.refresh ? await refreshReview(id) : await getState(id);
        if (request !== loadRequest || epoch !== routeEpoch) return;
        applyReviewState(data, cached ? false : push, true, options.refresh === true);
        rememberReview({ review: app.review ?? data.review, reviews: data.reviews });
    } catch (error) {
        if (request !== loadRequest || epoch !== routeEpoch) return;
        app.error = errorText(error);
        if (!options.silent) notify(app.error, 'error');
    } finally {
        if (request === loadRequest) {
            app.loading = false;
            // Событие, пришедшее во время загрузки, не должно потеряться.
            if (reloadPending || pendingReloadScopes.size) scheduleReload();
        }
    }
}

export function scheduleReload(scope?: ReloadScope): void {
    if (scope) pendingReloadScopes.add(scope);
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
        // Без явного scope (поллинг-страховка) обновляем всё; SSE-событие
        // обновляет только затронутую часть.
        const scopes: Set<ReloadScope> = pendingReloadScopes.size
            ? new Set(pendingReloadScopes)
            : new Set<ReloadScope>(['review', 'feature', 'project']);
        pendingReloadScopes.clear();
        reloadPending = false;
        const reviewScope = scopes.has('review');
        const featureScope = scopes.has('feature');
        const projectScope = scopes.has('project');
        if (reviewScope && !app.preview) {
            const id = app.review?.id;
            if (id) void loadReview(id, { silent: true, push: false });
        }
        if (featureScope) {
            void loadFeatures();
            const featureId = app.feature?.id;
            if (featureId) void loadFeature(featureId, { push: false });
            // Участие ревью в фиче влияет на бейджи в его заголовке.
            const reviewId = app.review?.id;
            if (reviewId) void loadReviewFeatures(reviewId);
        }
        if (projectScope) {
            // Сначала проекты: от них зависит activeProject для списка ревью.
            void loadProjects().then(() => {
                void loadReviews();
                if (!featureScope) void loadFeatures();
            });
        } else if (reviewScope) {
            void loadReviews();
            void loadProjects();
        }
    }, 350);
}

export function subscribe(): () => void {
    const source = new EventSource('/api/events');
    let lastEventAt = Date.now();
    const markAlive = (): void => {
        lastEventAt = Date.now();
    };
    source.addEventListener('review', () => {
        markAlive();
        scheduleReload('review');
    });
    source.addEventListener('feature', () => {
        markAlive();
        scheduleReload('feature');
    });
    source.addEventListener('project', () => {
        markAlive();
        scheduleReload('project');
    });
    source.addEventListener('hello', markAlive);
    source.addEventListener('heartbeat', markAlive);
    // Страховка только для действительно мёртвого/забуференного SSE: пока идут
    // heartbeat'ы, поллинг не нужен и не дёргает /api/state каждые 10 секунд.
    const poll = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (Date.now() - lastEventAt < 35_000) return;
        scheduleReload();
    }, 10_000);
    return () => {
        source.close();
        clearInterval(poll);
    };
}

const TABS: readonly Tab[] = ['overview', 'threads', 'findings', 'diff', 'rules', 'analytics'];

export interface Route {
    id: string | null;
    view: PreviewRef | null;
    tab: Tab;
    focus: Focus;
    project: string | null;
    projects: boolean;
    mrList: boolean;
    settings: boolean;
    feature: string | null;
    features: boolean;
    help: boolean;
}

export function encodePreviewRef(ref: PreviewRef): string {
    const bytes = new TextEncoder().encode(JSON.stringify(ref));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodePreviewRef(value: string): PreviewRef | null {
    try {
        const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PreviewRef>;
        if (
            (parsed.platform === 'gitlab' || parsed.platform === 'github') &&
            typeof parsed.host === 'string' &&
            typeof parsed.project === 'string' &&
            typeof parsed.number === 'number'
        ) {
            return { platform: parsed.platform, host: parsed.host, project: parsed.project, number: parsed.number };
        }
    } catch {
        // Некорректная ссылка — обычный пустой маршрут.
    }
    return null;
}

export function parseHash(): Route {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const empty: Route = { id: null, view: null, tab: 'overview', focus: null, project: null, projects: false, mrList: false, settings: false, feature: null, features: false, help: false };
    if (parts[0] === 'help') return { ...empty, help: true };
    if (parts[0] === 'projects') return { ...empty, projects: true };
    if (parts[0] === 'mrs') return { ...empty, mrList: true };
    if (parts[0] === 'settings') return { ...empty, settings: true };
    if (parts[0] === 'features') return { ...empty, features: true };
    if (parts[0] === 'f' && parts[1]) return { ...empty, feature: decodeURIComponent(parts[1]) };
    if (parts[0] === 'p' && parts[1]) return { ...empty, project: decodeURIComponent(parts[1]) };
    if (parts[0] === 'view' && parts[1]) {
        const view = decodePreviewRef(parts[1]);
        if (!view) return empty;
        const tab = TABS.includes(parts[2] as Tab) ? (parts[2] as Tab) : 'overview';
        return { ...empty, view, tab };
    }
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
    return { id, view: null, tab, focus, project: null, projects: false, mrList: false, settings: false, feature: null, features: false, help: false };
}

export function hashFor(tab: Tab, focus: Focus): string {
    if (app.help) return '#/help';
    if (app.preview && app.previewRef) return `#/view/${encodePreviewRef(app.previewRef)}/${tab}`;
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
    if (app.mrList) return '#/mrs';
    if (app.settings) return '#/settings';
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
    app.help = false;
    app.tab = route.tab;
    app.focus = route.focus;
    if (route.focus?.kind === 'line') {
        app.diffFile = route.focus.file;
        app.diffFocus = { file: route.focus.file, line: route.focus.line };
    }
    if (route.view) {
        app.projectsHome = false;
        app.featuresHome = false;
        app.help = false;
        app.feature = null;
        app.previewRef = route.view;
        void loadPreview(route.view, { tab: route.tab, push: false });
        return;
    }
    if (route.help) {
        app.help = true;
        app.projectsHome = false;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        writeHash(false);
        return;
    }
    if (route.settings) {
        app.settings = true;
        app.projectsHome = false;
        app.mrList = false;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        writeHash(false);
        return;
    }
    if (route.settings) {
        app.settings = true;
        app.projectsHome = false;
        app.mrList = false;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        writeHash(false);
        return;
    }
    if (route.mrList) {
        app.mrList = true;
        app.settings = false;
        app.projectsHome = false;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        void loadProjects();
        writeHash(false);
        return;
    }
    if (route.projects) {
        app.projectsHome = true;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        writeHash(false);
        return;
    }
    if (route.features) {
        app.projectsHome = false;
        app.featuresHome = true;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
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
        app.preview = false;
        app.previewRef = null;
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
        for (const note of notes) {
            const next = reactions[note.id] ?? [];
            if (!sameJson(note.reactions, next)) note.reactions = next;
        }
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
    if (route.help) {
        app.help = true;
        app.projectsHome = false;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        await loadReviews();
        writeHash(false);
        return;
    }
    if (route.mrList) {
        app.mrList = true;
        app.projectsHome = false;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        await Promise.all([loadProjects(), loadReviews(), loadFeatures()]);
        writeHash(false);
        return;
    }
    if (route.projects) {
        app.projectsHome = true;
        app.featuresHome = false;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
        await loadReviews();
        writeHash(false);
        return;
    }
    if (route.features) {
        app.projectsHome = false;
        app.featuresHome = true;
        app.feature = null;
        app.review = null;
        app.preview = false;
        app.previewRef = null;
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
    if (route.view) {
        app.projectsHome = false;
        app.featuresHome = false;
        await loadReviews();
        await loadFeatures();
        await loadPreview(route.view, { tab: route.tab, push: false });
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
