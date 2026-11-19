<script lang="ts">
    import { onMount } from 'svelte';
    import { app, applyRoute, bootstrap, flushPendingReload, forgetReview, loadFeature, loadFeatures, loadProjects, loadReview, loadReviews, notify, setActiveProject, setTab, showFeaturesHome, showHelp, showProjectsHome, subscribe, writeHash } from './lib/state.svelte';
    import { removeProject as removeProjectApi, removeReview as removeReviewApi } from './lib/api';
    import type { ProjectSummary, ReviewListItem } from './lib/types';
    import type { Tab } from './lib/types';
    import { i18n, plural, setLocale, t } from './lib/i18n.svelte';
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
    import AddToFeatureDialog from './components/AddToFeatureDialog.svelte';
    import { projectColor, projectLabel } from './lib/projects';

    let paletteOpen = $state(false);
    let openDialog = $state(false);
    let addToFeatureOpen = $state(false);
    let addProjectOpen = $state(false);
    let editingProject = $state<ProjectSummary | null>(null);
    let sidebarOpen = $state(true);
    const SIDEBAR_KEY = 'revdeck.sidebar';

    const currentProject = $derived(app.projects.find((project) => project.key === app.activeProject) ?? null);
    const openThreads = $derived(app.review ? app.review.threads.filter((thread) => !thread.resolved).length : 0);
    const draftFindings = $derived(
        app.review ? app.review.findings.filter((finding) => finding.status !== 'published' && finding.status !== 'stale').length : 0,
    );

    const tabs = $derived<{ id: Tab; label: string; count?: number }[]>([
        { id: 'overview', label: t('Обзор', 'Overview') },
        { id: 'threads', label: t('Треды', 'Threads'), count: openThreads },
        { id: 'findings', label: t('Замечания', 'Findings'), count: draftFindings },
        { id: 'diff', label: 'Diff' },
        { id: 'rules', label: t('Правила', 'Rules') },
        { id: 'analytics', label: t('Аналитика', 'Analytics') },
    ]);

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

    function refresh(): void {
        const id = app.review?.id;
        if (!id) return;
        void loadReview(id, { refresh: true });
        notify(t('Обновлено', 'Updated'), 'info');
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
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !typing) {
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
        if (event.key >= '1' && event.key <= '5') {
            const tab = tabs[Number(event.key) - 1];
            if (tab) setTab(tab.id);
        } else if (event.key === 'r') {
            refresh();
        } else if (event.key === 's') {
            toggleSidebar();
        } else if (event.key === 'o') {
            openDialog = true;
        } else if (event.key === '?') {
            paletteOpen = true;
        } else if (event.key === 'h') {
            showHelp();
        } else if (event.key === 'p') {
            if (publishTarget) app.publishing = publishTarget;
            else app.projectSwitcher = !app.projectSwitcher;
        }
    }

    onMount(() => {
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
        <div class="sidebar-footer">
            <div class="sidebar-project-summary">
                {app.projects.length} {plural(app.projects.length, ['проект', 'проекта', 'проектов'], ['project', 'projects'])} · {app.reviews.length} {plural(app.reviews.length, ['ревью', 'ревью', 'ревью'], ['review', 'reviews'])}
            </div>
            {#if app.review}
                {app.review.files.length} {plural(app.review.files.length, ['файл', 'файла', 'файлов'], ['file', 'files'])} · {app.review.threads.length} {plural(app.review.threads.length, ['тред', 'треда', 'тредов'], ['thread', 'threads'])}
            {:else}
                <span class="mono">revdeck open &lt;N&gt;</span>
            {/if}
            <button class="sidebar-help" type="button" onclick={() => showHelp()} title={t('Справка по командам (h)', 'Command reference (h)')}>
                <span class="sidebar-help-mark">?</span> {t('Справка по командам', 'Command reference')}
            </button>
            <div class="lang-switch" aria-label={t('Язык интерфейса', 'Interface language')}>
                <button class:on={i18n.locale === 'ru'} onclick={() => setLocale('ru')}>RU</button>
                <button class:on={i18n.locale === 'en'} onclick={() => setLocale('en')}>EN</button>
            </div>
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
            <header class="header">
                <div class="breadcrumbs">
                    <button class="breadcrumb-link" type="button" onclick={() => showProjectsHome()}>{t('Проекты', 'Projects')}</button>
                    <span class="sep">/</span>
                    <span>{currentProject ? projectLabel(currentProject, app.projects) : review.info.ref.project}</span>
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
                            <span>+{review.stats.additions} −{review.stats.deletions}</span>
                            {#if review.stale}<span class="badge">{t('устарело', 'stale')}</span>{/if}
                        </div>
                        <div class="review-feature-badges">
                            {#each app.reviewFeatures as item (item.id)}
                                <button class="feature-badge" type="button" onclick={() => void loadFeature(item.id)}>◇ {item.title}</button>
                            {/each}
                            <button class="feature-add" type="button" onclick={() => (addToFeatureOpen = true)}>+ {t('В фичу', 'To feature')}</button>
                        </div>
                    </div>
                    <div class="header-actions">
                        <button
                            class="btn icon"
                            onclick={toggleSidebar}
                            title={t('Скрыть/показать сайдбар (s)', 'Hide/show sidebar (s)')}
                            aria-label={t('Скрыть/показать сайдбар', 'Hide/show sidebar')}
                            aria-expanded={sidebarOpen}
                        >
                            ☰
                        </button>
                        <button class="btn" onclick={refresh} title={t('Обновить (r)', 'Refresh (r)')}>{t('Обновить', 'Refresh')}</button>
                        <a class="btn" href={review.info.webUrl} target="_blank" rel="noreferrer noopener">{t('Открыть в платформе', 'Open in platform')}</a>
                        <button
                            class="btn primary"
                            disabled={!publishTarget}
                            onclick={() => publishTarget && (app.publishing = publishTarget)}
                            title={t('Опубликовать (p)', 'Publish (p)')}
                        >
                            {t('Опубликовать', 'Publish')}{publishTarget ? ` · ${publishTarget.ids.length}` : ''}
                        </button>
                    </div>
                </div>
            </header>

            {#if review.readOnly}
                <div class="alert readonly-banner">
                    <strong>{t('Read-only', 'Read-only')}</strong>
                    {t('Это ревью настроено только для чтения: изменения, публикация и проверки отключены.', 'This review is read-only: changes, publishing and checks are disabled.')}
                </div>
            {/if}

            {#if app.loading}
                <div class="loading-bar" role="progressbar" aria-label={t('Загрузка ревью', 'Loading review')}></div>
            {/if}

            <nav class="tabs" aria-label={t('Разделы ревью', 'Review sections')}>
                {#each tabs as tab (tab.id)}
                    <button class="tab" class:active={app.tab === tab.id} onclick={() => setTab(tab.id)}>
                        {tab.label}{#if tab.count}<span class="count">{tab.count}</span>{/if}
                    </button>
                {/each}
            </nav>

            <section class="content">
                {#if app.loading && !review}
                    <p class="muted">{t('Загрузка…', 'Loading…')}</p>
                {:else if app.tab === 'overview'}
                    <Overview />
                {:else if app.tab === 'threads'}
                    <Threads />
                {:else if app.tab === 'findings'}
                    <Findings />
                {:else if app.tab === 'diff'}
                    <Diff />
                {:else if app.tab === 'analytics'}
                    <Analytics />
                {:else}
                    <Rules />
                {/if}
            </section>
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
    <PublishDialog kind={app.publishing.kind} ids={app.publishing.ids} onclose={() => (app.publishing = null)} />
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
