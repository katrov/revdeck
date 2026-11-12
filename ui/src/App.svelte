<script lang="ts">
    import { onMount } from 'svelte';
    import { app, applyRoute, bootstrap, loadReview, loadReviews, notify, setTab, subscribe } from './lib/state.svelte';
    import type { Tab } from './lib/types';
    import { i18n, plural, setLocale, t } from './lib/i18n.svelte';
    import Overview from './components/Overview.svelte';
    import Threads from './components/Threads.svelte';
    import Findings from './components/Findings.svelte';
    import Diff from './components/Diff.svelte';
    import Rules from './components/Rules.svelte';
    import PublishDialog from './components/PublishDialog.svelte';
    import CommandPalette from './components/CommandPalette.svelte';
    import OpenReviewDialog from './components/OpenReviewDialog.svelte';

    let paletteOpen = $state(false);
    let openDialog = $state(false);
    let sidebarOpen = $state(true);
    const SIDEBAR_KEY = 'revdeck.sidebar';

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
    ]);

    const publishTarget = $derived.by((): { kind: 'reply' | 'finding' | 'note'; ids: string[] } | null => {
        const review = app.review;
        if (!review) return null;
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
        } else if (event.key === 'p' && publishTarget) {
            app.publishing = publishTarget;
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
        void loadReviews();
        const unsubscribe = subscribe();
        window.addEventListener('keydown', onKeydown);
        window.addEventListener('popstate', applyRoute);
        window.addEventListener('hashchange', applyRoute);
        return () => {
            unsubscribe();
            window.removeEventListener('keydown', onKeydown);
            window.removeEventListener('popstate', applyRoute);
            window.removeEventListener('hashchange', applyRoute);
        };
    });
</script>

<div class="shell" class:sidebar-collapsed={!sidebarOpen}>
    {#if sidebarOpen}
        <button class="sidebar-backdrop" type="button" aria-label={t('Закрыть сайдбар', 'Close sidebar')} onclick={toggleSidebar}></button>
    {/if}
    <aside class="sidebar">
        <div class="brand">
            <span class="dot"></span> revdeck
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
        <div class="sidebar-actions">
            <button class="btn" type="button" onclick={() => (openDialog = true)}>{t('+ Открыть ревью', '+ Open review')}</button>
        </div>
        <div class="sidebar-list">
            {#each app.reviews as review (review.id)}
                <button class="review-row" class:active={app.review?.id === review.id} onclick={() => openReview(review.id)}>
                    <span class="title">#{review.number} {review.title}</span>
                    <span class="meta">{review.project} · {review.author}</span>
                </button>
            {:else}
                <p class="muted small" style="padding: 8px">{t('Ревью ещё не открывались.', 'No reviews opened yet.')}</p>
            {/each}
        </div>
        <div class="sidebar-footer">
            {#if app.review}
                {app.review.files.length} {plural(app.review.files.length, ['файл', 'файла', 'файлов'], ['file', 'files'])} · {app.review.threads.length} {plural(app.review.threads.length, ['тред', 'треда', 'тредов'], ['thread', 'threads'])}
            {:else}
                <span class="mono">revdeck open &lt;N&gt;</span>
            {/if}
            <div class="lang-switch" aria-label={t('Язык интерфейса', 'Interface language')}>
                <button class:on={i18n.locale === 'ru'} onclick={() => setLocale('ru')}>RU</button>
                <button class:on={i18n.locale === 'en'} onclick={() => setLocale('en')}>EN</button>
            </div>
        </div>
    </aside>

    <main class="main">
        {#if app.review}
            {@const review = app.review}
            <header class="header">
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
                {:else}
                    <Rules />
                {/if}
            </section>
        {:else}
            <div class="empty">
                <div class="row" style="justify-content: center; margin-bottom: 12px">
                    {#if !sidebarOpen}
                        <button class="btn" type="button" onclick={toggleSidebar} title={t('Показать сайдбар (s)', 'Show sidebar (s)')}>☰ {t('Показать сайдбар', 'Show sidebar')}</button>
                    {/if}
                    <button class="btn primary" type="button" onclick={() => (openDialog = true)}>{t('Открыть ревью', 'Open review')}</button>
                </div>
                <h2>revdeck</h2>
                <p>{t('Откройте ревью из терминала — оно появится здесь и останется в списке.', 'Open a review from the terminal; it will appear here and stay in the list.')}</p>
                <pre>revdeck open 42
revdeck open https://gitlab.com/group/project/-/merge_requests/42</pre>
                {#if app.error}<div class="alert error">{app.error}</div>{/if}
            </div>
        {/if}
    </main>
</div>

{#if app.publishing}
    <PublishDialog kind={app.publishing.kind} ids={app.publishing.ids} onclose={() => (app.publishing = null)} />
{/if}

{#if paletteOpen}
    <CommandPalette
        onclose={() => (paletteOpen = false)}
        onpublish={() => publishTarget && (app.publishing = publishTarget)}
        onopen={() => {
            paletteOpen = false;
            openDialog = true;
        }}
    />
{/if}

{#if openDialog}
    <OpenReviewDialog onclose={() => (openDialog = false)} />
{/if}

{#if app.toast}
    <div class="toast" class:error={app.toast.kind === 'error'} class:ok={app.toast.kind === 'ok'}>{app.toast.text}</div>
{/if}
