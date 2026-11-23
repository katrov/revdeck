<script lang="ts">
    import { onMount } from 'svelte';
    import { app, errorText, loadPreview, notify, adoptOpenedReview, relativeTime } from '../lib/state.svelte';
    import { getRemoteReviews, openReview as openReviewApi, type RemoteReview } from '../lib/api';
    import { plural, t } from '../lib/i18n.svelte';

    type Scope = 'open' | 'mine' | 'reviewing';
    let scope = $state<Scope>('open');
    let loading = $state(false);
    let error = $state('');
    let items = $state<RemoteReview[]>([]);
    let query = $state('');
    let projectFilter = $state('all');
    let author = $state('all');
    let target = $state('all');
    let draft = $state<'all' | 'draft' | 'ready'>('all');
    let busy = $state<string | null>(null);

    async function load(): Promise<void> {
        loading = true;
        error = '';
        const errors: string[] = [];
        const collected: RemoteReview[] = [];
        try {
            const projects = app.projects.filter((project) => projectFilter === 'all' || project.key === projectFilter);
            await Promise.all(
                projects.map(async (project) => {
                    const root = project.roots[0];
                    if (!root) return;
                    try {
                        const result = await getRemoteReviews(root, scope, 100);
                        for (const item of result.items) {
                            collected.push({ ...item, root, projectKey: project.key });
                        }
                    } catch (cause) {
                        errors.push(`${project.title || project.key}: ${errorText(cause)}`);
                    }
                }),
            );
            const unique = new Map<string, RemoteReview>();
            for (const item of collected) unique.set(`${item.projectKey}!${item.ref.number}`, item);
            items = [...unique.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
            if (errors.length) error = errors.join(' · ');
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        if (app.projects.length) void load();
    });

    const projects = $derived(app.projects);
    const authors = $derived([...new Set(items.map((item) => item.author).filter(Boolean))].sort());
    const targets = $derived([...new Set(items.map((item) => item.targetBranch).filter(Boolean) as string[])].sort());
    const visible = $derived.by(() => {
        const needle = query.trim().toLowerCase();
        return items.filter((item) => {
            if (projectFilter !== 'all' && item.projectKey !== projectFilter) return false;
            if (author !== 'all' && item.author !== author) return false;
            if (target !== 'all' && item.targetBranch !== target) return false;
            if (draft === 'draft' && !item.draft) return false;
            if (draft === 'ready' && item.draft) return false;
            if (!needle) return true;
            return [item.title, item.author, item.projectKey, item.sourceBranch ?? '', item.targetBranch ?? '', String(item.ref.number)]
                .join(' ')
                .toLowerCase()
                .includes(needle);
        });
    });

    async function open(item: RemoteReview, preview: boolean): Promise<void> {
        busy = `${item.projectKey}!${item.ref.number}`;
        try {
            if (preview) {
                await loadPreview({ ...item.ref }, { push: true });
            } else {
                const result = await openReviewApi(item.root, String(item.ref.number), {
                    platform: item.ref.platform,
                    host: item.ref.host,
                    project: item.ref.project,
                });
                await adoptOpenedReview(result.review);
                notify(t('Ревью открыто', 'Review opened'), 'ok');
            }
        } catch (cause) {
            notify(errorText(cause), 'error');
        } finally {
            busy = null;
        }
    }
</script>

<div class="mr-head">
    <div>
        <h1>{t('Открытые MR/PR', 'Open MRs/PRs')}</h1>
        <div class="muted small">
            {items.length} {t('открытых', 'open')} · {projects.length}
            {plural(projects.length, ['проект', 'проекта', 'проектов'], ['project', 'projects'])}
        </div>
    </div>
    <button class="btn" type="button" onclick={() => void load()} disabled={loading}>{loading ? t('Обновляю…', 'Refreshing…') : t('Обновить', 'Refresh')}</button>
</div>

<section class="card mr-filters">
    <div class="row" style="gap: 8px; flex-wrap: wrap">
        <select bind:value={scope} onchange={() => void load()}>
            <option value="open">{t('Все открытые', 'All open')}</option>
            <option value="mine">{t('Мои', 'Mine')}</option>
            <option value="reviewing">{t('На ревью', 'Review requested')}</option>
        </select>
        <select bind:value={projectFilter} onchange={() => void load()}>
            <option value="all">{t('Все проекты', 'All projects')}</option>
            {#each projects as project (project.key)}<option value={project.key}>{project.title || project.key}</option>{/each}
        </select>
        <input bind:value={query} placeholder={t('Поиск: название, автор, ветка, номер…', 'Search: title, author, branch, number…')} style="flex: 1; min-width: 220px" />
    </div>
    <div class="row" style="gap: 8px; flex-wrap: wrap; margin-top: 8px">
        <select bind:value={author}>
            <option value="all">{t('Автор: любой', 'Author: any')}</option>
            {#each authors as value (value)}<option value={value}>@{value}</option>{/each}
        </select>
        <select bind:value={target}>
            <option value="all">{t('Target: любой', 'Target: any')}</option>
            {#each targets as value (value)}<option value={value}>{value}</option>{/each}
        </select>
        <select bind:value={draft}>
            <option value="all">{t('Draft: все', 'Draft: all')}</option>
            <option value="draft">{t('только draft', 'only draft')}</option>
            <option value="ready">{t('без draft', 'without draft')}</option>
        </select>
        <span class="muted small" style="margin-left: auto">{visible.length} {t('из', 'of')} {items.length}</span>
    </div>
</section>

{#if error}<div class="alert error">{error}</div>{/if}

{#if loading}
    <p class="muted">{t('Загружаю MR/PR…', 'Loading MRs/PRs…')}</p>
{:else if !projects.length}
    <section class="card flat"><p class="muted">{t('Сначала добавьте проект с рабочей копией.', 'Add a project with a working copy first.')}</p></section>
{:else if !visible.length}
    <section class="card flat"><p class="muted">{t('По фильтрам ничего не найдено.', 'Nothing matches the filters.')}</p></section>
{:else}
    <div class="stack">
        {#each visible as item (item.projectKey + '!' + item.ref.number)}
            <section class="card flat">
                <div class="row mr-row" style="align-items: flex-start; gap: 14px">
                    <span class="muted mono" style="padding-top: 2px; min-width: 42px">#{item.ref.number}</span>
                    <div class="grow" style="min-width: 0">
                        <div class="card-title" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{item.title}</div>
                        <div class="muted small" style="margin-top: 4px">
                            <strong style="color: var(--text)">{item.ref.host}/{item.ref.project}</strong>
                            {#if item.sourceBranch}<span class="mono"> · {item.sourceBranch}</span>{/if}
                            {#if item.targetBranch}<span class="mono"> → {item.targetBranch}</span>{/if}
                            <span> · @{item.author}</span>
                            <span> · {relativeTime(item.updatedAt)}</span>
                            {#if item.draft}<span class="badge draft" style="margin-left: 6px">draft</span>{/if}
                        </div>
                    </div>
                    <div class="row" style="gap: 6px; flex: none">
                        <button class="btn" type="button" disabled={busy === `${item.projectKey}!${item.ref.number}`} onclick={() => void open(item, true)}>
                            {t('Просмотр', 'Preview')}
                        </button>
                        <button class="btn primary" type="button" disabled={busy === `${item.projectKey}!${item.ref.number}`} onclick={() => void open(item, false)}>
                            {t('В ревью', 'Review')}
                        </button>
                    </div>
                </div>
            </section>
        {/each}
    </div>
{/if}
