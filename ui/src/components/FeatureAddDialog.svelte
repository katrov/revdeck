<script lang="ts">
    import { onMount } from 'svelte';
    import { addFeatureReviews, getReviews } from '../lib/api';
    import { errorText, loadFeature, loadFeatures, notify } from '../lib/state.svelte';
    import type { FeatureDetail, ReviewListItem } from '../lib/types';
    import { t } from '../lib/i18n.svelte';
    import ReviewPicker from './ReviewPicker.svelte';

    let { feature, onclose }: { feature: FeatureDetail; onclose: () => void } = $props();
    let reviews = $state<ReviewListItem[]>([]);
    let selected = $state<string[]>([]);
    let saving = $state(false);
    let error = $state('');

    const existing = $derived(feature.members.map((member) => member.review.id));

    onMount(() => {
        void getReviews()
            .then((result) => {
                reviews = result.reviews;
            })
            .catch((cause) => {
                error = errorText(cause);
            });
    });

    async function submit(): Promise<void> {
        if (!selected.length || saving) return;
        saving = true;
        error = '';
        try {
            await addFeatureReviews(feature.id, selected.map((review) => ({ review })));
            await loadFeature(feature.id, { push: false });
            await loadFeatures();
            notify(t('Ревью добавлены в фичу', 'Reviews added to the feature'), 'ok');
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
    <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Добавить ревью', 'Add reviews')}>
        <div class="spread">
            <h2 style="margin: 0; font-size: 16px">{t('Добавить ревью в фичу', 'Add reviews to feature')}</h2>
            <button class="btn" type="button" onclick={onclose}>{t('Закрыть', 'Close')}</button>
        </div>
        <ReviewPicker {reviews} {selected} exclude={existing} onchange={(ids) => (selected = ids)} />
        {#if error}<div class="alert error">{error}</div>{/if}
        <div class="row end" style="margin-top: 14px">
            <button class="btn" type="button" onclick={onclose} disabled={saving}>{t('Отмена', 'Cancel')}</button>
            <button class="btn primary" type="button" onclick={submit} disabled={saving || !selected.length}>
                {saving ? t('Добавление…', 'Adding…') : t('Добавить', 'Add')}
            </button>
        </div>
    </div>
</div>
