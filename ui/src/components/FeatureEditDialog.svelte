<script lang="ts">
    import { updateFeature } from '../lib/api';
    import { errorText, loadFeature, loadFeatures, notify } from '../lib/state.svelte';
    import type { FeatureDetail } from '../lib/types';
    import { t } from '../lib/i18n.svelte';

    let { feature, onclose }: { feature: FeatureDetail; onclose: () => void } = $props();
    // svelte-ignore state_referenced_locally
    let title = $state(feature.title);
    // svelte-ignore state_referenced_locally
    let brief = $state(feature.brief);
    // svelte-ignore state_referenced_locally
    let contract = $state(feature.contract);
    let saving = $state(false);
    let error = $state('');

    async function submit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (!title.trim() || saving) return;
        saving = true;
        try {
            await updateFeature(feature.id, { title: title.trim(), brief, contract });
            await loadFeature(feature.id, { push: false });
            await loadFeatures();
            notify(t('Фича обновлена', 'Feature updated'), 'ok');
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
    <div class="dialog" role="dialog" aria-modal="true" aria-label={t('Редактировать фичу', 'Edit feature')}>
        <form onsubmit={submit}>
            <div class="spread">
                <h2 style="margin: 0; font-size: 16px">{t('Редактировать фичу', 'Edit feature')}</h2>
                <button class="btn" type="button" onclick={onclose}>{t('Закрыть', 'Close')}</button>
            </div>
            <label class="field">
                <span>{t('Название', 'Title')}</span>
                <input bind:value={title} autocomplete="off" />
            </label>
            <label class="field">
                <span>{t('Бриф', 'Brief')}</span>
                <textarea bind:value={brief} rows="6"></textarea>
            </label>
            <label class="field">
                <span>{t('Контракт API (OpenAPI или Markdown)', 'API contract (OpenAPI or Markdown)')}</span>
                <textarea bind:value={contract} rows="8"></textarea>
            </label>
            {#if error}<div class="alert error">{error}</div>{/if}
            <div class="row end" style="margin-top: 14px">
                <button class="btn" type="button" onclick={onclose} disabled={saving}>{t('Отмена', 'Cancel')}</button>
                <button class="btn primary" type="submit" disabled={saving || !title.trim()}>{saving ? t('Сохранение…', 'Saving…') : t('Сохранить', 'Save')}</button>
            </div>
        </form>
    </div>
</div>
