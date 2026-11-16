<script lang="ts">
    import { onMount } from 'svelte';
    import { addFeatureReviews, getFeatures } from '../lib/api';
    import { errorText, loadFeatures, loadReviewFeatures, notify } from '../lib/state.svelte';
    import type { FeatureSummary } from '../lib/types';
    import { plural, t } from '../lib/i18n.svelte';
    import { projectColor } from '../lib/projects';
    import FeatureCreateDialog from './FeatureCreateDialog.svelte';

    let { review, onclose }: { review: string; onclose: () => void } = $props();
    let features = $state<FeatureSummary[]>([]);
    let error = $state('');
    let saving = $state(false);
    let createOpen = $state(false);

    onMount(() => {
        void getFeatures(undefined, false)
            .then((result) => {
                features = result.features;
            })
            .catch((cause) => {
                error = errorText(cause);
            });
    });

    async function add(feature: FeatureSummary): Promise<void> {
        saving = true;
        try {
            await addFeatureReviews(feature.id, [{ review }]);
            await loadFeatures();
            await loadReviewFeatures(review);
            notify(t('Ревью добавлено в фичу', 'Review added to the feature'), 'ok');
            onclose();
        } catch (cause) {
            error = errorText(cause);
        } finally {
            saving = false;
        }
    }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="overlay">
    <button class="backdrop" type="button" aria-label={t('Закрыть', 'Close')} onclick={onclose}></button>
    <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Добавить в фичу', 'Add to feature')}>
        <div class="spread">
            <h2 style="margin: 0; font-size: 16px">{t('Добавить в фичу', 'Add to feature')}</h2>
            <button class="btn" type="button" onclick={onclose}>{t('Закрыть', 'Close')}</button>
        </div>
        {#if error}<div class="alert error">{error}</div>{/if}
        {#if features.length}
            <div class="feature-pick-list">
                {#each features as feature (feature.id)}
                    <button class="feature-list-row" type="button" disabled={saving} onclick={() => void add(feature)}>
                        <span class="feature-list-main">
                            <span class="feature-list-title">{feature.title}</span>
                            <span class="muted small">{feature.projects.length} {plural(feature.projects.length, ['проект', 'проекта', 'проектов'], ['project', 'projects'])} · {feature.reviews} {plural(feature.reviews, ['ревью', 'ревью', 'ревью'], ['review', 'reviews'])}</span>
                        </span>
                        <span class="feature-list-projects">
                            {#each feature.projects.slice(0, 4) as project (project.key)}
                                <span class="project-dot" style={`--project-color:${projectColor(project.key)}`}></span>
                            {/each}
                        </span>
                    </button>
                {/each}
            </div>
        {:else}
            <p class="muted">{t('Активных фич нет. Создайте новую.', 'No active features. Create one.')}</p>
        {/if}
        <div class="row end" style="margin-top: 12px">
            <button class="btn primary" type="button" onclick={() => (createOpen = true)}>+ {t('Новая фича', 'New feature')}</button>
        </div>
    </div>
</div>

{#if createOpen}
    <FeatureCreateDialog preselect={review} onclose={() => { createOpen = false; onclose(); }} />
{/if}
