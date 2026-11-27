<script lang="ts">
    import { onMount } from 'svelte';
    import { app, applyRoute, backToMrList, bootstrap, flushPendingReload, forgetReview, initFeaturesHidden, isEditingText, loadFeature, loadFeatures, loadProjects, loadReview, loadReviews, notify, refreshCurrent, setActiveProject, setTab, showFeaturesHome, showHelp, showMrList, showProjectsHome, showSettings, subscribe, writeHash } from './lib/state.svelte';
    import { removeProject as removeProjectApi, removeReview as removeReviewApi } from './lib/api';
    import type { ProjectSummary, ReviewListItem } from './lib/types';
    import type { Tab } from './lib/types';
    import { plural, t } from './lib/i18n.svelte';
    import { initTheme } from './lib/theme.svelte';
    import { autoRefresh, initAutoRefresh } from './lib/auto-refresh.svelte';
    import { dismissUpdate, initUpdateCheck, update, updateBannerVisible } from './lib/update.svelte';
    import Overview from './components/Overview.svelte';
    import Threads from './components/Threads.svelte';
    import Findings from './components/Findings.svelte';
    import Diff from './components/Diff.svelte';
    import Rules from './components/Rules.svelte';
    import Analytics from './components/Analytics.svelte';
    import PublishDialog from './components/PublishDialog.svelte';
    import CommandPalette from './components/CommandPalette.svelte';
    import OpenReviewDialog from './components/OpenReviewDialog.svelte';
    import ProjectSwitcher from './components/ProjectSwitcher.svelte';
    import ProjectsHome from './components/ProjectsHome.svelte';
    import AddProjectDialog from './components/AddProjectDialog.svelte';
    import EditProjectDialog from './components/EditProjectDialog.svelte';
    import Help from './components/Help.svelte';
    import FeatureView from './components/FeatureView.svelte';
    import FeatureList from './components/FeatureList.svelte';
    import MrList from './components/MrList.svelte';
    import Settings from './components/Settings.svelte';
    import AddToFeatureDialog from './components/AddToFeatureDialog.svelte';
    import { projectColor, projectLabel } from './lib/projects';

    let paletteOpen = $state(false);
    let openDialog = $state(false);
    let addToFeatureOpen = $state(false);
    let addProjectOpen = $state(false);
    let editingProject = $state<ProjectSummary | null>(null);
    let sidebarOpen = $state(true);
    let chromeHidden = $state(false);
    let lastScrollTop = 0;
    let suppressChromeUntil = 0;
    let lastWheelAt = 0;
    let touchY: number | null = null;
    let chromeCheckTimer: ReturnType<typeof setTimeout> | null = null;
    let chromeScroller: HTMLElement | null = null;
    /** Ручное скрытие приоритетнее авто-раскрытия при скролле и смене вкладки. */
    let chromePinnedHidden = false;
    let autoRefreshNonce = $state(0);
    const SIDEBAR_KEY = 'revdeck.sidebar';

    function setChromeHidden(hidden: boolean, manual = false): void {
        // Ручное скрытие не должно раскрываться от скролла: только кнопка.
        if (!hidden && !manual && chromePinnedHidden) return;
        if (hidden === chromeHidden) {
            if (manual) chromePinnedHidden = hidden;
            return;
        }
        if (manual) chromePinnedHidden = hidden;
        chromeHidden = hidden;
        // Свёрнутая/раскрытая шапка меняет высоту .content и может сдвинуть scrollTop.
        // Эти программные scroll-события не должны переключать шапку обратно.
        suppressChromeUntil = performance.now() + 450;
        if (chromeCheckTimer) clearTimeout(chromeCheckTimer);
        if (hidden && !manual && !chromePinnedHidden) {
            chromeCheckTimer = setTimeout(() => {
                chromeCheckTimer = null;
                const element = chromeScroller ?? document.querySelector('.content');
                if (element && element.scrollTop <= 16) setChromeHidden(false);
            }, 520);
        }
    }

    /** На Diff прокручивается вложенный .diff-view, а не .content. */
    function scrollOwner(target: EventTarget | null, fallback: HTMLElement): HTMLElement {
        const node = target instanceof Element ? target.closest<HTMLElement>('.diff-view') : null;
        return node ?? fallback;
    }

    function onContentWheel(event: WheelEvent): void {
        lastWheelAt = performance.now();
        if (Math.abs(event.deltaY) < 1) return;
        if (event.target instanceof Element && event.target.closest('.file-list')) return;
        const element = scrollOwner(event.target, event.currentTarget as HTMLElement);
        chromeScroller = element;
        const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 40;
        if (event.deltaY > 0 && element.scrollTop > 16 && !nearBottom) setChromeHidden(true);
        else if (event.deltaY < 0) setChromeHidden(false);
    }

    function onContentTouchStart(event: TouchEvent): void {
        touchY = event.touches[0]?.clientY ?? null;
    }

    function onContentTouchMove(event: TouchEvent): void {
        const currentY = event.touches[0]?.clientY;
        if (currentY === undefined || touchY === null) return;
        const delta = currentY - touchY;
        if (Math.abs(delta) < 6) return;
        if (delta < 0) setChromeHidden(true);
        else setChromeHidden(false);
        touchY = currentY;
    }

    function handleScroll(element: HTMLElement): void {
        chromeScroller = element;
        const top = element.scrollTop;
        const now = performance.now();
        if (now < suppressChromeUntil) {
            lastScrollTop = top;
            return;
        }
        if (top <= 16) {
            setChromeHidden(false);
            lastScrollTop = top;
            return;
        }
        // Scrollbar / keyboard scrolling has no wheel events. Use position fallback
        // only when the wheel has been idle long enough to avoid fighting layout-induced
        // scroll. The nested Diff pane scrolls after its wheel event, so trust its
        // own scroll position immediately.
        const nested = element.classList.contains('diff-view');
        if (nested || now - lastWheelAt > 600) {
            const nearBottom = top + element.clientHeight >= element.scrollHeight - 40;
            if (top > lastScrollTop + 10 && !nearBottom) setChromeHidden(true);
            else if (top < lastScrollTop - 10) setChromeHidden(false);
        }
        lastScrollTop = top;
    }

    function onContentScroll(event: Event): void {
        handleScroll(event.currentTarget as HTMLElement);
    }

    $effect(() => {
        // Новое ревью — новый контекст: ручная защёлка сбрасывается.
        app.review?.id;
        chromePinnedHidden = false;
        if (chromeCheckTimer) clearTimeout(chromeCheckTimer);
        chromeCheckTimer = null;
        chromeScroller = null;
        chromeHidden = false;
        lastScrollTop = 0;
    });

    $effect(() => {
        // Вкладка не отменяет ручное скрытие шапки.
        app.tab;
        if (chromeCheckTimer) clearTimeout(chromeCheckTimer);
        chromeCheckTimer = null;
        chromeScroller = null;
        if (!chromePinnedHidden) chromeHidden = false;
        lastScrollTop = 0;
    });

    const currentProject = $derived(app.projects.find((project) => project.key === app.activeProject) ?? null);
    const openThreads = $derived(app.review ? app.review.threads.filter((thread) => !thread.resolved).length : 0);
    const draftFindings = $derived(
        app.review ? app.review.findings.filter((finding) => finding.status !== 'published' && finding.status !== 'stale').length : 0,
    );

    const tabs = $derived<{ id: Tab; label: string; count?: number }[]>(
        ([
            { id: 'overview', label: t('Обзор', 'Overview') },
            { id: 'threads', label: t('Треды', 'Threads'), count: openThreads },
            { id: 'findings', label: t('Замечания', 'Findings'), count: draftFindings },
            { id: 'diff', label: 'Diff' },
            { id: 'rules', label: t('Правила', 'Rules') },
            { id: 'analytics', label: t('Аналитика', 'Analytics') },
        ] as { id: Tab; label: string; count?: number }[]).filter(
            (item) => !app.preview || item.id === 'overview' || item.id === 'threads' || item.id === 'diff',
        ),
    );

    const publishTarget = $derived.by((): { kind: 'reply' | 'finding' | 'note'; ids: string[] } | null => {
        const review = app.review;
        if (!review || review.readOnly) return null;
        if (app.tab === 'threads') {
            const ids = review.drafts
                .filter((draft) => {
                    const thread = review.threads.find((item) => item.id === draft.threadId);
                    return (draft.body.trim() !== '' && !draft.replied) || draft.resolve !== thread?.resolved;
                })
                .map((draft) => draft.threadId);
            return ids.length ? { kind: 'reply', ids } : null;
        }
        if (app.tab === 'diff') {
            const ids = review.notes.filter((note) => !note.posted).map((note) => note.id);
            return ids.length ? { kind: 'note', ids } : null;
        }
        const ids = review.findings
            .filter((finding) => finding.status !== 'published' && finding.status !== 'rejected' && finding.decision !== 'reject')
            .map((finding) => finding.id);
        return ids.length ? { kind: 'finding', ids } : null;
    });

    function openReview(id: string): void {
        if (app.review?.id === id) return;
        app.viewOrigin = null;
        // Не сбрасываем вкладку: переключение ревью не должно выглядеть как перезагрузка UI.
        app.focus = null;
        app.diffFocus = null;
        void loadReview(id);
    }

    async function removeReview(item: ReviewListItem): Promise<void> {
        if (!confirm(t(`Удалить #${item.number} из списка? Это не удалит MR на платформе.`, `Remove #${item.number} from the list? This does not delete the MR on the platform.`))) return;
        try {
            await removeReviewApi(item.id);
            forgetReview(item.id);
            const wasCurrent = app.review?.id === item.id;
            await loadProjects();
            await loadReviews();
            await loadFeatures();
            if (!wasCurrent) {
                notify(t('Ревью убрано из списка', 'Review removed from the list'), 'ok');
                return;
            }
            const next = app.reviews[0];
            if (next) {
                openReview(next.id);
            } else {
                app.review = null;
                app.focus = null;
                app.diffFocus = null;
                app.diffFile = null;
                writeHash(false);
            }
            notify(t('Ревью убрано из списка', 'Review removed from the list'), 'ok');
        } catch (error) {
            notify(error instanceof Error ? error.message : String(error), 'error');
        }
    }

    async function removeProject(item: ProjectSummary): Promise<void> {
        const reviews = item.reviews
            ? t(
                  `Удалить проект «${item.title}» и ${item.reviews} ${plural(item.reviews, ['ревью', 'ревью', 'ревью'], ['review', 'reviews'])} из revdeck?`,
                  `Delete project "${item.title}" and ${item.reviews} ${plural(item.reviews, ['ревью', 'ревью', 'ревью'], ['review', 'reviews'])} from revdeck?`,
              )
            : t(`Удалить проект «${item.title}» из revdeck?`, `Delete project "${item.title}" from revdeck?`);
        if (!confirm(`${reviews}\n\n${t('На платформе MR/PR останутся без изменений.', 'MRs/PRs on the platform stay untouched.')}`)) return;
        try {
            const result = await removeProjectApi(item.key);
            if (app.activeProject === item.key) {
                app.review = null;
                app.focus = null;
                app.diffFocus = null;
                app.diffFile = null;
            }
            await loadProjects();
            await loadReviews();
            await loadFeatures();
            writeHash(false);
            notify(
                result.removedReviews
                    ? t(
                          `Проект удалён из revdeck · ревью: ${result.removedReviews}`,
                          `Project removed from revdeck · reviews: ${result.removedReviews}`,
                      )
                    : t('Проект удалён из revdeck', 'Project removed from revdeck'),
                'ok',
            );
        } catch (error) {
            notify(error instanceof Error ? error.message : String(error), 'error');
        }
    }

    function refresh(options: { silent?: boolean } = {}): void {
        if (!app.review) return;
        // Любое обновление, включая ручное, начинает новый интервал автообновления.
        autoRefreshNonce += 1;
        void refreshCurrent(options);
        if (!options.silent) notify(t('Обновлено', 'Updated'), 'info');
    }

    function toggleSidebar(): void {
        sidebarOpen = !sidebarOpen;
        try {
            localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0');
        } catch {
            // localStorage может быть недоступен в приватном режиме.
        }
    }

    function onKeydown(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.code === 'KeyK' && !typing) {
            event.preventDefault();
            paletteOpen = true;
            return;
        }
        if (event.key === 'Escape') {
            paletteOpen = false;
            openDialog = false;
            app.projectSwitcher = false;
            app.publishing = null;
            return;
        }
        if (typing) return;
        // Браузерные сочетания (Ctrl+R, Cmd+L и т.п.) не перехватываем.
        if (mod || event.altKey) return;
        if (event.key === '?') {
            paletteOpen = true;
            return;
        }
        // С shift цифры превращаются в символы, а буквы — в заглавные.
        if (event.shiftKey) return;
        if (event.key >= '1' && event.key <= '6') {
            const tab = tabs[Number(event.key) - 1];
            if (tab) setTab(tab.id);
            return;
        }
        // Физический код клавиши: работает и на русской раскладке.
        switch (event.code) {
            case 'KeyR':
                refresh();
                break;
            case 'KeyS':
                toggleSidebar();
                break;
            case 'KeyO':
                openDialog = true;
                break;
            case 'KeyH':
                showHelp();
                break;
            case 'KeyP':
                if (publishTarget) app.publishing = publishTarget;
                else app.projectSwitcher = !app.projectSwitcher;
                break;
        }
    }

    onMount(() => {
        initTheme();
        initFeaturesHidden();
        initAutoRefresh();
        initUpdateCheck();
        const narrow = window.innerWidth <= 860;
        try {
            const stored = localStorage.getItem(SIDEBAR_KEY);
            sidebarOpen = narrow ? false : stored === null ? true : stored !== '0';
        } catch {
            sidebarOpen = !narrow;
        }
        void bootstrap();
        const unsubscribe = subscribe();
        window.addEventListener('keydown', onKeydown);
        window.addEventListener('popstate', applyRoute);
        window.addEventListener('hashchange', applyRoute);
        const onFocusOut = (): void => {
            window.setTimeout(flushPendingReload, 900);
        };
        document.addEventListener('focusout', onFocusOut);
        return () => {
            unsubscribe();
            window.removeEventListener('keydown', onKeydown);
            window.removeEventListener('popstate', applyRoute);
            window.removeEventListener('hashchange', applyRoute);
            document.removeEventListener('focusout', onFocusOut);
        };
    });

    // Автообновление повторяет ручную кнопку: принудительный refresh из платформы.
    // Пропускаем тики в фоне и во время ввода, а ручной refresh сбрасывает отсчёт.
    $effect(() => {
        const minutes = autoRefresh.minutes;
        const target = app.preview && app.previewRef
            ? `preview:${app.previewRef.platform}:${app.previewRef.host}/${app.previewRef.project}!${app.previewRef.number}`
            : (app.review?.id ?? '');
        autoRefreshNonce;
        if (!minutes || !target) return;
        const period = minutes * 60_000;
        const checkEvery = Math.min(15_000, period);
        let last = Date.now();
        const timer = setInterval(() => {
            if (Date.now() - last < period) return;
            if (document.visibilityState !== 'visible') return;
            // Не дёргаем сеть во время ввода и поверх диалогов публикации/выбора.
            if (app.loading || isEditingText() || app.publishing || document.querySelector('.overlay, [role="dialog"]')) return;
            last = Date.now();
            refresh({ silent: true });
        }, checkEvery);
        return () => clearInterval(timer);
    });
</script>

<div class="shell" class:sidebar-collapsed={!sidebarOpen}>
    {#if sidebarOpen}
        <button class="sidebar-backdrop" type="button" aria-label={t('Закрыть сайдбар', 'Close sidebar')} onclick={toggleSidebar}></button>
    {/if}
    <aside class="sidebar">
        <div class="brand">
            <img class="brand-icon" src="/favicon.svg" alt="" aria-hidden="true" /> revdeck
            <button
                class="sidebar-collapse"
                type="button"
                title={t('Скрыть сайдбар (s)', 'Hide sidebar (s)')}
                aria-label={t('Скрыть сайдбар', 'Hide sidebar')}
                onclick={toggleSidebar}
            >
                ‹
            </button>
        </div>
        <div class="project-switch">
            <div class="project-switch-label">{t('ПРОЕКТ', 'PROJECT')}</div>
            <button
                class="project-switch-button"
                type="button"
                aria-expanded={app.projectSwitcher}
                onclick={() => (app.projectSwitcher = !app.projectSwitcher)}
            >
                <span class="project-dot" style={`--project-color:${currentProject ? projectColor(currentProject.key) : 'var(--muted)'}`}></span>
                <span class="project-switch-text">
                    <span class="project-switch-name">{currentProject ? projectLabel(currentProject, app.projects) : t('Выбрать проект', 'Choose project')}</span>
                    <span class="project-switch-path">{currentProject ? `${currentProject.host}/${currentProject.project}` : t('Нет проекта', 'No project')}</span>
                </span>
                <span class="project-switch-chev">⌄</span>
            </button>
        </div>
        {#if app.projectSwitcher}
            <ProjectSwitcher
                onclose={() => (app.projectSwitcher = false)}
                onselect={(key) => void setActiveProject(key)}
                onadd={() => {
                    app.projectSwitcher = false;
                    addProjectOpen = true;
                }}
            />
        {/if}
        <div class="sidebar-actions">
            <button class="btn" type="button" onclick={() => (openDialog = true)}>{t('+ Открыть ревью', '+ Open review')}</button>
            <button class="btn" type="button" onclick={() => void showMrList()}>{t('Открытые MR/PR', 'Open MRs/PRs')}</button>
        </div>
        <div class="sidebar-list">
            {#each app.reviews as review (review.id)}
                <div class="sidebar-review-row" class:active={app.review?.id === review.id}>
                    <button class="review-row" class:active={app.review?.id === review.id} onclick={() => openReview(review.id)}>
                        <span class="title">#{review.number} {review.title}</span>
                        <span class="meta">{review.project} · {review.author}</span>
                    </button>
                    <button class="review-remove" type="button" title={t('Удалить из списка', 'Remove from list')} aria-label={t('Удалить из списка', 'Remove from list')} onclick={() => void removeReview(review)}>×</button>
                </div>
            {:else}
                <p class="muted small" style="padding: 8px">{app.activeProject ? t('В проекте пока нет ревью.', 'No reviews in this project yet.') : t('Выберите проект.', 'Choose a project.')}</p>
            {/each}
        </div>
        {#if !app.featuresHidden}
        <div class="sidebar-features">
            <div class="sidebar-feature-head">
                <span>{t('ФИЧИ', 'FEATURES')}</span>
                <span>{app.features.length}</span>
            </div>
            {#each app.features as item (item.id)}
                <button class="sidebar-feature-row" class:active={app.feature?.id === item.id} type="button" onclick={() => void loadFeature(item.id)}>
                    <span class="f-icon">◇</span>
                    <span class="sidebar-feature-title">{item.title}</span>
                    <span class="sidebar-feature-count">{item.reviews}</span>
                </button>
            {:else}
                <p class="muted small" style="padding: 2px 8px">{t('Фич пока нет.', 'No features yet.')}</p>
            {/each}
            <button class="sidebar-feature-all" type="button" onclick={() => void showFeaturesHome()}>{t('Все фичи', 'All features')}</button>
        </div>
        {/if}
        <div class="sidebar-footer">
            <div class="sidebar-project-summary">
                {app.projects.length} {plural(app.projects.length, ['проект', 'проекта', 'проектов'], ['project', 'projects'])} · {app.reviews.length} {plural(app.reviews.length, ['ревью', 'ревью', 'ревью'], ['review', 'reviews'])}
            </div>
            {#if app.review}
                {app.review.files.length} {plural(app.review.files.length, ['файл', 'файла', 'файлов'], ['file', 'files'])} · {app.review.threads.length} {plural(app.review.threads.length, ['тред', 'треда', 'тредов'], ['thread', 'threads'])}
            {:else}
                <span class="mono">revdeck open &lt;N&gt;</span>
            {/if}
            {#if update.info}
                <div class="sidebar-version">
                    <span class="mono">v{update.info.current}</span>
                    {#if update.info.updateAvailable && update.info.latest}
                        {#if update.info.releaseUrl}
                            <a
                                class="update-badge"
                                href={update.info.releaseUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                title={t(`Доступна revdeck ${update.info.latest} — открыть релиз`, `revdeck ${update.info.latest} is available — open the release`)}
                            >↑ {update.info.latest}</a>
                        {:else}
                            <span class="update-badge">↑ {update.info.latest}</span>
                        {/if}
                    {/if}
                </div>
            {/if}
            <button class="sidebar-help" type="button" onclick={() => showSettings()} title={t('Настройки', 'Settings')}>
                <span class="sidebar-help-mark">⚙</span> {t('Настройки', 'Settings')}
            </button>
        </div>
    </aside>

    <main class="main" aria-busy={app.loading}>
        {#if !app.review && !sidebarOpen}
            <button class="btn sidebar-reopen" type="button" onclick={toggleSidebar} title={t('Открыть меню', 'Open menu')} aria-label={t('Открыть меню', 'Open menu')}>
                ☰ {t('Меню', 'Menu')}
            </button>
        {/if}
        {#if app.help}
            <Help />
        {:else if app.review}
            {@const review = app.review}
            <div class="review-chrome" class:collapsed={chromeHidden} inert={chromeHidden}>
            <header class="header">
                <div class="breadcrumbs">
                    <button class="breadcrumb-link" type="button" onclick={() => showProjectsHome()}>{t('Проекты', 'Projects')}</button>
                    <span class="sep">/</span>
                    <span>{currentProject ? projectLabel(currentProject, app.projects) : review.info.ref.project}</span>
                    {#if app.viewOrigin === 'mrs'}
                        <span class="sep">/</span>
                        <button
                            class="breadcrumb-link"
                            type="button"
                            title={t('Вернуться к списку MR/PR', 'Back to the MR/PR list')}
                            onclick={() => backToMrList()}
                        >{t('Открытые MR/PR', 'Open MRs/PRs')}</button>
                    {/if}
                    <span class="sep">/</span>
                    <span class="cur">#{review.info.ref.number}</span>
                </div>
                <div class="title-row">
                    <div style="min-width: 0; flex: 1">
                        <h1>{review.info.title}</h1>
                        <div class="meta">
                            <span>{review.info.ref.project}#{review.info.ref.number}</span>
                            <span>{review.info.sourceBranch} → {review.info.targetBranch}</span>
                            <span>{review.info.author}</span>
                            <span>{review.info.state}{review.info.draft ? ' · draft' : ''}</span>
                            {#if app.preview}<span class="badge">{t('просмотр', 'preview')}</span>{/if}
                            <span>+{review.stats.additions} −{review.stats.deletions}</span>
                            {#if review.risk && !app.preview}
                                <span class="badge" title={review.risk.reasons.join(', ')}>
                                    {review.risk.mode === 'fast' ? t('быстрый проход', 'fast pass') : t('полный проход', 'full pass')} · {
                                        review.risk.level === 'low' ? t('низкий', 'low') : review.risk.level === 'high' ? t('высокий', 'high') : t('средний', 'medium')
                                    }
                                </span>
                            {/if}
                            {#if review.stale}<span class="badge">{t('устарело', 'stale')}</span>{/if}
                        </div>
                        <div class="review-feature-badges">
                            {#if !app.preview}
                            {#each app.reviewFeatures as item (item.id)}
                                <button class="feature-badge" type="button" onclick={() => void loadFeature(item.id)}>◇ {item.title}</button>
                            {/each}
                            <button class="feature-add" type="button" onclick={() => (addToFeatureOpen = true)}>+ {t('В фичу', 'To feature')}</button>
                            {/if}
                        </div>
                    </div>
                    <div class="header-actions">
                        <button
                            class="btn icon"
                            type="button"
                            onclick={() => setChromeHidden(true, true)}
                            title={t('Скрыть шапку', 'Hide header')}
                            aria-label={t('Скрыть шапку', 'Hide header')}
                        >⌃</button>
                        <button
                            class="btn icon"
                            onclick={toggleSidebar}
                            title={t('Скрыть/показать сайдбар (s)', 'Hide/show sidebar (s)')}
                            aria-label={t('Скрыть/показать сайдбар', 'Hide/show sidebar')}
                            aria-expanded={sidebarOpen}
                        >
                            ☰
                        </button>
                        <button
                            class="btn"
                            onclick={() => refresh()}
                            title={autoRefresh.minutes
                                ? `${t('Обновить (r)', 'Refresh (r)')} · ${t('авто', 'auto')} ${autoRefresh.minutes} ${t('мин', 'min')}`
                                : t('Обновить (r)', 'Refresh (r)')}
                        >{t('Обновить', 'Refresh')}</button>
                        <a class="btn" href={review.info.webUrl} target="_blank" rel="noreferrer noopener">{t('Открыть в платформе', 'Open in platform')}</a>
                        {#if !app.preview}
                        <button
                            class="btn primary"
                            disabled={!publishTarget}
                            onclick={() => publishTarget && (app.publishing = publishTarget)}
                            title={t('Опубликовать (p)', 'Publish (p)')}
                        >
                            {t('Опубликовать', 'Publish')}{publishTarget ? ` · ${publishTarget.ids.length}` : ''}
                        </button>
                        {/if}
                    </div>
                </div>
            </header>

            {#if app.preview || review.readOnly || (review.info.merge && review.info.merge.state !== 'clean')}
            <div class="review-banners">
                {#if app.preview}
                    <div class="alert readonly-banner">
                        <strong>{t('Просмотр', 'Preview')}</strong>
                        {t('Это режим просмотра MR/PR: комментарии, замечания, реакции и публикация недоступны. Чтобы работать с ревью, откройте его через «+ Открыть ревью».', 'This is an MR/PR preview: comments, findings, reactions and publishing are disabled. To work with the review, open it via “+ Open review”.')}
                    </div>
                {:else if review.readOnly}
                    <div class="alert readonly-banner">
                        <strong>{t('Read-only', 'Read-only')}</strong>
                        {t('Это ревью настроено только для чтения: изменения, публикация и проверки отключены.', 'This review is read-only: changes, publishing and checks are disabled.')}
                    </div>
                {/if}

                {#if review.info.merge && review.info.merge.state !== 'clean'}
                {@const merge = review.info.merge}
                <div class="alert" class:error={merge.state === 'conflict'}>
                    <strong>
                        {merge.state === 'conflict'
                            ? t('Конфликт с target', 'Conflict with target')
                            : merge.state === 'behind'
                              ? t('Ветка отстаёт от target', 'Branch is behind target')
                              : merge.state === 'unavailable'
                                ? t('Статус мержа не сообщён', 'Merge status was not reported')
                                : t('Статус мержа неизвестен', 'Merge status is unknown')}
                    </strong>
                    {t('Цель', 'Target')}: <span class="mono">{merge.targetBranch || review.info.targetBranch || '?'}</span>.
                    {#if merge.state === 'conflict'}
                        {t('Сначала обновите ветку: ревью построено по старому снимку, замечания могут быть неполными.', 'Update the branch first: the review uses an old snapshot and may be incomplete.')}
                    {:else if merge.state === 'behind'}
                        {t('Diff не содержит последних изменений target; после обновления нужен повторный проход.', 'The diff does not include the latest target changes; re-review after updating.')}
                    {:else}
                        {t('Проверьте конфликты и target, прежде чем делать вывод об отсутствии замечаний.', 'Check conflicts and the target before concluding there are no findings.')}
                    {/if}
                    {#if merge.detail}<span class="muted small"> · {merge.detail}</span>{/if}
                </div>
                {/if}
            </div>
            {/if}
            </div>

            {#if app.loading}
                <div class="loading-bar" role="progressbar" aria-label={t('Загрузка ревью', 'Loading review')}></div>
            {/if}

            <nav class="tabs" aria-label={t('Разделы ревью', 'Review sections')}>
                {#each tabs as tab (tab.id)}
                    <button class="tab" class:active={app.tab === tab.id} onclick={() => setTab(tab.id)}>
                        {tab.label}{#if tab.count}<span class="count">{tab.count}</span>{/if}
                    </button>
                {/each}
                {#if chromeHidden}
                    <button
                        class="btn icon chrome-toggle"
                        type="button"
                        onclick={() => setChromeHidden(false, true)}
                        title={t('Показать шапку', 'Show header')}
                        aria-label={t('Показать шапку', 'Show header')}
                    >⌄</button>
                {/if}
            </nav>

            {#if updateBannerVisible()}
                <div class="update-banner" role="status" aria-live="polite">
                    <span class="update-banner-dot" aria-hidden="true"></span>
                    <span class="update-banner-text">
                        <strong>revdeck {update.info?.latest}</strong> — {t('доступно обновление', 'update available')}
                    </span>
                    {#if update.info?.releaseUrl}
                        <a class="btn" href={update.info.releaseUrl} target="_blank" rel="noreferrer noopener">{t('Что нового', "What's new")}</a>
                    {/if}
                    <code class="update-banner-cmd">npm install -g revdeck@latest</code>
                    <button
                        class="btn icon"
                        type="button"
                        title={t('Скрыть', 'Dismiss')}
                        aria-label={t('Скрыть уведомление об обновлении', 'Dismiss the update notification')}
                        onclick={dismissUpdate}
                    >×</button>
                </div>
            {/if}

            <section
                class="content"
                aria-label={t('Содержимое ревью', 'Review content')}
                onscroll={onContentScroll}
                onwheel={onContentWheel}
                ontouchstart={onContentTouchStart}
                ontouchmove={onContentTouchMove}
            >
                {#if app.loading && !review}
                    <p class="muted">{t('Загрузка…', 'Loading…')}</p>
                {:else if app.tab === 'overview'}
                    <Overview />
                {:else if app.tab === 'threads'}
                    <Threads />
                {:else if app.tab === 'findings'}
                    <Findings />
                {:else if app.tab === 'diff'}
                    <Diff onContentScroll={handleScroll} />
                {:else if app.tab === 'analytics'}
                    <Analytics />
                {:else}
                    <Rules />
                {/if}
            </section>
        {:else if app.settings}
            <section class="content"><Settings /></section>
        {:else if app.mrList}
            <section class="content"><MrList /></section>
        {:else if app.feature}
            {#key app.feature.id}
                <FeatureView />
            {/key}
        {:else if app.featuresHome}
            <FeatureList />
        {:else if app.projectsHome || !app.projects.length}
            <ProjectsHome
                onselect={(key) => void setActiveProject(key)}
                onopen={() => (openDialog = true)}
                onadd={() => (addProjectOpen = true)}
                onedit={(project) => (editingProject = project)}
                onremove={(project) => void removeProject(project)}
            />
        {:else}
            <div class="empty">
                <div class="row" style="justify-content: center; margin-bottom: 12px">
                    <button class="btn primary" type="button" onclick={() => (openDialog = true)}>{t('Открыть ревью', 'Open review')}</button>
                </div>
                <h2>{currentProject ? projectLabel(currentProject, app.projects) : 'revdeck'}</h2>
                <p>
                    {currentProject
                        ? t('В этом проекте пока нет ревью. Откройте MR/PR — он появится здесь.', 'No reviews in this project yet. Open an MR/PR and it will appear here.')
                        : t('Выберите проект или откройте ревью.', 'Choose a project or open a review.')}
                </p>
                <pre>revdeck open 42
revdeck open https://gitlab.com/group/project/-/merge_requests/42</pre>
                {#if app.error}<div class="alert error">{app.error}</div>{/if}
            </div>
        {/if}
    </main>
</div>

{#if addToFeatureOpen && app.review}
    <AddToFeatureDialog review={app.review.id} onclose={() => (addToFeatureOpen = false)} />
{/if}

{#if app.publishing}
    <PublishDialog
        kind={app.publishing.kind}
        ids={app.publishing.ids}
        verdict={app.publishing.verdict}
        onclose={() => (app.publishing = null)}
    />
{/if}

{#if paletteOpen}
    <CommandPalette
        onclose={() => (paletteOpen = false)}
        onpublish={() => publishTarget && (app.publishing = publishTarget)}
        onaddproject={() => {
            paletteOpen = false;
            addProjectOpen = true;
        }}
        onopen={() => {
            paletteOpen = false;
            openDialog = true;
        }}
    />
{/if}

{#if openDialog}
    <OpenReviewDialog onclose={() => (openDialog = false)} />
{/if}

{#if addProjectOpen}
    <AddProjectDialog onclose={() => (addProjectOpen = false)} />
{/if}

{#if editingProject}
    <EditProjectDialog project={editingProject} onclose={() => (editingProject = null)} />
{/if}

{#if app.toast}
    <div class="toast" class:error={app.toast.kind === 'error'} class:ok={app.toast.kind === 'ok'}>{app.toast.text}</div>
{/if}
