<script lang="ts">
    import { getFeatures } from '../lib/api';
    import { app, errorText, loadFeature } from '../lib/state.svelte';
    import { projectColor } from '../lib/projects';
    import type { FeatureSummary } from '../lib/types';
    import { plural, t } from '../lib/i18n.svelte';
    import FeatureCreateDialog from './FeatureCreateDialog.svelte';

    let features = $state<FeatureSummary[]>([]);
    let query = $state('');
    let includeArchived = $state(false);
    let createOpen = $state(false);
    let error = $state('');

    const list = $derived(
        features.filter((feature) => {
            if (!includeArchived && feature.status === 'archived') return false;
            const q = query.trim().toLowerCase();
            if (!q) return true;
            return `${feature.id} ${feature.title} ${feature.brief} ${feature.projects.map((project) => project.key).join(' ')}`.toLowerCase().includes(q);
        }),
    );

    async function load(): Promise<void> {
        try {
            features = (await getFeatures(undefined, true)).features;
        } catch (cause) {
            error = errorText(cause);
        }
    }

    $effect(() => {
        // Revision меняется только когда loadFeatures действительно получил другой список.
        app.featureRevision;
        void load();
    });
</script>

<section class="feature-list-page">
    <header class="feature-page-head">
        <div class="breadcrumbs">
            <span class="cur">{t('Фичи', 'Features')}</span>
        </div>
        <div class="feature-title-row">
            <div style="min-width: 0; flex: 1">
                <h1>{t('Фичи', 'Features')}</h1>
                <p class="muted">{t('Явные наборы ревью из разных проектов. Создаёт человек; агент видит только те фичи, где участвует его проект.', 'Explicit review bundles across projects. Created by a human; an agent sees only features that include its project.')}</p>
            </div>
            <div class="feature-actions">
                <input class="project-home-search" bind:value={query} placeholder={t('Найти фичу…', 'Find a feature…')} autocomplete="off" />
                <button class="btn primary" type="button" onclick={() => (createOpen = true)}>+ {t('Новая фича', 'New feature')}</button>
            </div>
        </div>
        <label class="muted small row" style="gap: 6px; margin-top: 8px">
            <input type="checkbox" bind:checked={includeArchived} />
            {t('Показывать архив', 'Show archived')}
        </label>
    </header>

    <div class="feature-body">
        {#if app.error}<div class="alert error">{app.error}</div>{/if}
        {#if error}<div class="alert error">{error}</div>{/if}
        {#if list.length}
            <div class="feature-list">
                {#each list as feature (feature.id)}
                    <button class="feature-list-row" type="button" onclick={() => void loadFeature(feature.id)}>
                        <span class="feature-list-main">
                            <span class="feature-list-title">
                                {feature.title}
                                {#if feature.status === 'archived'}<span class="badge">{t('архив', 'archived')}</span>{/if}
                            </span>
                            <span class="muted small">
                                {feature.projects.length} {plural(feature.projects.length, ['проект', 'проекта', 'проектов'], ['project', 'projects'])} · {feature.reviews} {plural(feature.reviews, ['ревью', 'ревью', 'ревью'], ['review', 'reviews'])} · {feature.id}
                            </span>
                        </span>
                        <span class="feature-list-projects">
                            {#each feature.projects.slice(0, 4) as project (project.key)}
                                <span class="project-dot" style={`--project-color:${projectColor(project.key)}`} title={project.key}></span>
                            {/each}
                        </span>
                    </button>
                {/each}
            </div>
        {:else if features.length}
            <p class="muted">{t('Фичи не найдены.', 'No features found.')}</p>
        {:else}
            <div class="card">
                <div class="card-title">{t('Фич пока нет', 'No features yet')}</div>
                <p class="muted">{t('Создайте фичу и добавьте в неё MR из разных проектов.', 'Create a feature and add MRs from several projects.')}</p>
            </div>
        {/if}
    </div>
</section>

{#if createOpen}
    <FeatureCreateDialog
        onclose={() => {
            createOpen = false;
            void load();
        }}
    />
{/if}
