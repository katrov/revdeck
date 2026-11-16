<script lang="ts">
    import { app, loadFeature, loadFeatureContext, loadFeatures, loadReview, notify, showFeaturesHome } from '../lib/state.svelte';
    import { projectColor } from '../lib/projects';
    import { addFeatureReviews, deleteFeature, removeFeatureReview, reorderFeature, updateFeature } from '../lib/api';
    import { plural, t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';
    import FeatureAddDialog from './FeatureAddDialog.svelte';
    import FeatureEditDialog from './FeatureEditDialog.svelte';
    import FeatureNotes from './FeatureNotes.svelte';

    let addOpen = $state(false);
    let editOpen = $state(false);
    let contextOpen = $state(false);
    let contextLoading = $state(false);

    const feature = $derived(app.feature);
    const groups = $derived.by(() => {
        const current = app.feature;
        if (!current) return [];
        const map = new Map<string, { key: string; title: string; host: string; project: string; members: typeof current.members }>();
        for (const member of current.members) {
            const project = current.projects.find((item) => item.key === member.review.projectKey);
            const group = map.get(member.review.projectKey) ?? {
                key: member.review.projectKey,
                title: project?.title ?? member.review.project,
                host: project?.host ?? '',
                project: project?.project ?? member.review.project,
                members: [],
            };
            group.members.push(member);
            map.set(member.review.projectKey, group);
        }
        return [...map.values()];
    });

    async function openReview(id: string): Promise<void> {
        await loadReview(id);
    }

    async function setRole(review: string, role: string): Promise<void> {
        if (!feature) return;
        try {
            await addFeatureReviews(feature.id, [{ review, role }]);
            await loadFeature(feature.id, { push: false });
        } catch (cause) {
            notify(cause instanceof Error ? cause.message : String(cause), 'error');
        }
    }

    async function remove(member: { review: { id: string; number: number } }): Promise<void> {
        if (!feature) return;
        if (!confirm(t(`Убрать #${member.review.number} из фичи? Ревью останется в проекте.`, `Remove #${member.review.number} from the feature? The review stays in its project.`))) return;
        try {
            await removeFeatureReview(feature.id, member.review.id);
            await loadFeature(feature.id, { push: false });
            await loadFeatures();
            notify(t('Ревью убрано из фичи', 'Review removed from the feature'), 'ok');
        } catch (cause) {
            notify(cause instanceof Error ? cause.message : String(cause), 'error');
        }
    }

    async function copyContext(): Promise<void> {
        if (!feature) return;
        contextLoading = true;
        try {
            await loadFeatureContext(feature.id);
            contextOpen = true;
            if (app.featureContext) {
                await navigator.clipboard?.writeText(app.featureContext);
                notify(t('Контекст фичи скопирован', 'Feature context copied'), 'ok');
            }
        } catch (cause) {
            notify(cause instanceof Error ? cause.message : String(cause), 'error');
        } finally {
            contextLoading = false;
        }
    }

    async function copyAgentCommand(): Promise<void> {
        if (!feature) return;
        const command = `REVDECK_FEATURE=${feature.id} revdeck mcp`;
        try {
            await navigator.clipboard?.writeText(command);
            notify(t('Команда для агента скопирована', 'Agent command copied'), 'ok');
        } catch {
            notify(t('Не удалось скопировать', 'Could not copy'), 'error');
        }
    }

    function groupNeighbor(review: string, delta: number): string | null {
        if (!feature) return null;
        const member = feature.members.find((item) => item.review.id === review);
        if (!member) return null;
        const group = feature.members.filter((item) => item.review.projectKey === member.review.projectKey);
        const index = group.findIndex((item) => item.review.id === review);
        return group[index + delta]?.review.id ?? null;
    }

    async function move(review: string, delta: number): Promise<void> {
        if (!feature) return;
        const neighbor = groupNeighbor(review, delta);
        if (!neighbor) return;
        const ids = feature.members.map((member) => member.review.id);
        const index = ids.indexOf(review);
        const target = ids.indexOf(neighbor);
        if (index < 0 || target < 0) return;
        [ids[index], ids[target]] = [ids[target]!, ids[index]!];
        try {
            await reorderFeature(feature.id, ids);
            await loadFeature(feature.id, { push: false });
        } catch (cause) {
            notify(cause instanceof Error ? cause.message : String(cause), 'error');
        }
    }

    async function removeFeature(): Promise<void> {
        if (!feature) return;
        if (!confirm(t(`Удалить фичу «${feature.title}»? Ревью останутся в проектах.`, `Delete feature “${feature.title}”? Reviews stay in their projects.`))) return;
        try {
            await deleteFeature(feature.id);
            await loadFeatures();
            await showFeaturesHome(false);
        } catch (cause) {
            notify(cause instanceof Error ? cause.message : String(cause), 'error');
        }
    }

    async function toggleArchive(): Promise<void> {
        if (!feature) return;
        try {
            const wasArchived = feature.status === 'archived';
            await updateFeature(feature.id, { status: wasArchived ? 'open' : 'archived' });
            await loadFeature(feature.id, { push: false });
            await loadFeatures();
            notify(wasArchived ? t('Фича возвращена', 'Feature reopened') : t('Фича архивирована', 'Feature archived'), 'ok');
        } catch (cause) {
            notify(cause instanceof Error ? cause.message : String(cause), 'error');
        }
    }
</script>

{#if feature}
    <section class="feature-page">
        <header class="feature-page-head">
            <div class="breadcrumbs">
                <button class="breadcrumb-link" type="button" onclick={() => void showFeaturesHome()}>{t('Фичи', 'Features')}</button>
                <span class="sep">/</span>
                <span class="cur">{feature.title}</span>
            </div>
            <div class="feature-title-row">
                <div style="min-width: 0; flex: 1">
                    <h1>
                        {feature.title}
                        {#if feature.status === 'archived'}<span class="badge">{t('архив', 'archived')}</span>{/if}
                    </h1>
                    <div class="feature-meta">
                        <span class="badge">◇ {feature.projects.length} {plural(feature.projects.length, ['проект', 'проекта', 'проектов'], ['project', 'projects'])}</span>
                        <span class="badge">{feature.reviews} {plural(feature.reviews, ['ревью', 'ревью', 'ревью'], ['review', 'reviews'])}</span>
                        <span class="muted small">{feature.id}</span>
                    </div>
                </div>
                <div class="feature-actions">
                    <button class="btn" type="button" onclick={() => (editOpen = true)}>{t('Редактировать', 'Edit')}</button>
                    <button class="btn primary" type="button" onclick={() => (addOpen = true)} disabled={feature.status === 'archived'}>+ {t('Добавить ревью', 'Add reviews')}</button>
                    <button class="btn" type="button" onclick={copyContext} disabled={contextLoading}>{contextLoading ? t('Сборка…', 'Building…') : t('Скопировать контекст', 'Copy context')}</button>
                    <button class="btn" type="button" onclick={copyAgentCommand}>{t('Команда агенту', 'Agent command')}</button>
                    <button class="btn" type="button" onclick={toggleArchive}>{feature.status === 'archived' ? t('Вернуть', 'Reopen') : t('Архивировать', 'Archive')}</button>
                    <button class="btn danger" type="button" onclick={removeFeature}>{t('Удалить', 'Delete')}</button>
                </div>
            </div>
        </header>

        {#if app.error}<div class="alert error">{app.error}</div>{/if}

        <div class="feature-body">
            <div class="card feature-brief">
                <div class="card-title">{t('Бриф', 'Brief')}</div>
                {#if feature.brief.trim()}
                    <Markdown source={feature.brief} />
                {:else}
                    <p class="muted">{t('Бриф не заполнен. Опишите цель, non-goals и порядок выката — агент прочитает это первым.', 'The brief is empty. Describe the goal, non-goals and rollout order; the agent reads it first.')}</p>
                {/if}
            </div>
            {#if feature.contract.trim()}
                <div class="card feature-brief">
                    <div class="card-title">{t('Контракт API', 'API contract')}</div>
                    <pre class="feature-contract">{feature.contract}</pre>
                </div>
            {/if}

            <div class="feature-projects">
                {#each groups as group (group.key)}
                    <section class="card feature-project">
                        <div class="feature-project-head">
                            <span class="project-dot" style={`--project-color:${projectColor(group.key)}`}></span>
                            <span class="feature-project-name">{group.title}</span>
                            <span class="muted small">{group.host}/{group.project}</span>
                            <span class="badge">{group.members.length}</span>
                        </div>
                        {#each group.members as member (member.review.id)}
                            <div class="feature-member">
                                <input
                                    class="feature-role-input"
                                    value={member.role}
                                    placeholder={t('роль', 'role')}
                                    title={t('Роль ревью в фиче', 'Review role in the feature')}
                                    onchange={(event) => void setRole(member.review.id, event.currentTarget.value)}
                                />
                                <div class="feature-member-text">
                                    <button class="feature-member-title" type="button" onclick={() => void openReview(member.review.id)}>
                                        #{member.review.number} {member.review.title}
                                    </button>
                                    <div class="muted small">{member.review.state} · {member.review.webUrl}</div>
                                </div>
                                <button class="btn" type="button" title={t('Выше', 'Move up')} aria-label={t('Выше', 'Move up')} disabled={!groupNeighbor(member.review.id, -1)} onclick={() => void move(member.review.id, -1)}>↑</button>
                                <button class="btn" type="button" title={t('Ниже', 'Move down')} aria-label={t('Ниже', 'Move down')} disabled={!groupNeighbor(member.review.id, 1)} onclick={() => void move(member.review.id, 1)}>↓</button>
                                <button class="btn" type="button" onclick={() => void openReview(member.review.id)}>{t('Открыть', 'Open')}</button>
                                <button class="btn danger" type="button" title={t('Убрать из фичи', 'Remove from feature')} aria-label={t('Убрать из фичи', 'Remove from feature')} onclick={() => void remove(member)}>×</button>
                            </div>
                        {/each}
                    </section>
                {:else}
                    <div class="card">
                        <p class="muted">{t('В фиче пока нет ревью. Добавьте MR из нужных проектов.', 'No reviews in the feature yet. Add MRs from the projects you need.')}</p>
                    </div>
                {/each}
            </div>

            <FeatureNotes {feature} />

            {#if contextOpen}
                <div class="card feature-context">
                    <div class="card-head">
                        <div class="card-title">{t('Общий контекст фичи', 'Feature context')}</div>
                        <button class="btn" type="button" onclick={() => (contextOpen = false)}>{t('Скрыть', 'Hide')}</button>
                    </div>
                    <pre>{app.featureContext || t('Контекст ещё не собран.', 'The context has not been built yet.')}</pre>
                </div>
            {/if}
        </div>
    </section>
{/if}

{#if addOpen && feature}
    <FeatureAddDialog {feature} onclose={() => (addOpen = false)} />
{/if}
{#if editOpen && feature}
    <FeatureEditDialog {feature} onclose={() => (editOpen = false)} />
{/if}
