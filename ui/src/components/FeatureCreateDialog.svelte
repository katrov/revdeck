<script lang="ts">
    import { onMount } from 'svelte';
    import { createFeature, getReviews } from '../lib/api';
    import { loadFeature, loadFeatures } from '../lib/state.svelte';
    import type { ReviewListItem } from '../lib/types';
    import { t } from '../lib/i18n.svelte';
    import ReviewPicker from './ReviewPicker.svelte';

    let { onclose, preselect }: { onclose: () => void; preselect?: string } = $props();
    let title = $state('');
    let brief = $state('');
    let contract = $state('');
    let reviews = $state<ReviewListItem[]>([]);
    // svelte-ignore state_referenced_locally
    let selected = $state<string[]>(preselect ? [preselect] : []);
    let saving = $state(false);
    let error = $state('');

    onMount(() => {
        void getReviews()
            .then((result) => {
                reviews = result.reviews;
            })
            .catch((cause) => {
                error = cause instanceof Error ? cause.message : String(cause);
            });
    });

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!title.trim() || saving) return;
        saving = true;
        error = '';
        try {
            const { feature } = await createFeature({
                title: title.trim(),
                ...(brief.trim() ? { brief } : {}),
                ...(contract.trim() ? { contract } : {}),
                ...(selected.length ? { reviews: selected.map((review) => ({ review })) } : {}),
            });
            await loadFeatures();
            await loadFeature(feature.id);
            onclose();
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            saving = false;
        }
    }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="overlay">
    <button class="backdrop" type="button" aria-label={t('Закрыть', 'Close')} onclick={onclose}></button>
    <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Новая фича', 'New feature')}>
        <form onsubmit={submit}>
            <div class="spread">
                <h2 style="margin: 0; font-size: 16px">{t('Новая фича', 'New feature')}</h2>
                <button class="btn" type="button" onclick={onclose}>{t('Закрыть', 'Close')}</button>
            </div>
            <label class="field">
                <span>{t('Название', 'Title')}</span>
                <input bind:value={title} placeholder="Checkout v2" autocomplete="off" />
            </label>
            <label class="field">
                <span>{t('Бриф', 'Brief')}</span>
                <textarea bind:value={brief} rows="5" placeholder={t('Цель, non-goals, порядок выката…', 'Goal, non-goals, rollout order…')}></textarea>
            </label>
            <label class="field">
                <span>{t('Контракт API (OpenAPI или Markdown)', 'API contract (OpenAPI or Markdown)')}</span>
                <textarea bind:value={contract} rows="7" placeholder="openapi: 3.1.0&#10;paths:&#10;  /refunds:&#10;    post: ..."></textarea>
            </label>
            <div class="field">
                <span>{t('Ревью в фиче', 'Reviews in the feature')}</span>
                <ReviewPicker {reviews} {selected} onchange={(ids) => (selected = ids)} />
            </div>
            {#if error}<div class="alert error">{error}</div>{/if}
            <div class="row end" style="margin-top: 14px">
                <button class="btn" type="button" onclick={onclose} disabled={saving}>{t('Отмена', 'Cancel')}</button>
                <button class="btn primary" type="submit" disabled={saving || !title.trim()}>{saving ? t('Создание…', 'Creating…') : t('Создать фичу', 'Create feature')}</button>
            </div>
        </form>
    </div>
</div>
