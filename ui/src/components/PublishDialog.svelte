<script lang="ts">
    import { app, errorText, loadReview, notify } from '../lib/state.svelte';
    import { approvePublish, commitPublish, previewPublish } from '../lib/api';
    import type { PublishPreview } from '../lib/types';
    import { truncate } from '../lib/format';

    let { kind, ids, onclose }: { kind: 'reply' | 'finding' | 'note'; ids: string[]; onclose: () => void } = $props();

    let preview = $state<PublishPreview | null>(null);
    let loading = $state(true);
    let error = $state('');
    let publishing = $state(false);
    let results = $state<{ id: string; ok: boolean; error?: string; skipped?: boolean }[] | null>(null);

    const labels: Record<string, string> = {
        reply: 'Ответы в треды',
        finding: 'Замечания к строкам',
        note: 'Комментарии к строкам',
    };

    $effect(() => {
        const reviewId = app.review?.id;
        if (!reviewId) return;
        loading = true;
        error = '';
        void previewPublish(reviewId, kind, ids)
            .then((data) => {
                preview = data.preview;
            })
            .catch((cause) => {
                error = errorText(cause);
            })
            .finally(() => {
                loading = false;
            });
    });

    async function confirm(): Promise<void> {
        const review = app.review;
        if (!review || !preview) return;
        publishing = true;
        error = '';
        try {
            const approval = await approvePublish(review.id, kind, ids, preview.plan.hash);
            const committed = await commitPublish(review.id, approval.approval.id);
            results = committed.result.results;
            const failed = results.filter((item) => !item.ok);
            notify(failed.length ? `Опубликовано с ошибками: ${failed.length}` : 'Опубликовано', failed.length ? 'error' : 'ok');
            await loadReview(review.id, { silent: true });
        } catch (cause) {
            error = errorText(cause);
        } finally {
            publishing = false;
        }
    }
</script>

<div class="overlay">
    <button class="backdrop" type="button" aria-label="Закрыть" onclick={onclose}></button>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Публикация">
        <div class="spread">
            <h2 style="margin: 0; font-size: 16px">{labels[kind]}: подтверждение</h2>
            <button class="btn" onclick={onclose}>Закрыть</button>
        </div>

        {#if loading}
            <p class="muted">Готовлю план…</p>
        {:else if error && !results}
            <div class="alert error">{error}</div>
        {:else if preview}
            <p class="muted small">
                Будет отправлено от вашего имени в {app.review?.info.ref.platform === 'gitlab' ? 'GitLab' : 'GitHub'}:
                <strong>{preview.plan.items.length}</strong>. Текст ниже — ровно то, что уйдёт в платформу.
            </p>
            {#if preview.warnings.length}
                <div class="alert">
                    <strong>Пропущено</strong>
                    <ul style="margin: 6px 0 0; padding-left: 18px">
                        {#each preview.warnings as warning}<li>{warning}</li>{/each}
                    </ul>
                </div>
            {/if}
            <div class="stack">
                {#each preview.plan.items as item (item.kind + item.id)}
                    <section class="card flat">
                        <div class="card-head">
                            <span class="badge">{item.kind}</span>
                            <span class="mono small muted">{truncate(item.id, 40)}</span>
                            {#if item.resolve !== undefined}
                                <span class="badge" class:ok={item.resolve}>{item.resolve ? 'закрыть тред' : 'оставить открытым'}</span>
                            {/if}
                        </div>
                        <pre style="white-space: pre-wrap; margin: 8px 0 0">{item.body || '(только закрытие треда)'}</pre>
                    </section>
                {/each}
            </div>
            <div class="muted small mono" style="margin: 8px 0">hash: {preview.plan.hash}</div>

            {#if results}
                <div class="section-title">Результат</div>
                {#each results as item (item.id)}
                    <div class="row" style="margin-bottom: 4px">
                        {#if item.ok}<span class="badge ok">✔</span>{:else}<span class="badge err">✖</span>{/if}
                        <span class="mono small">{truncate(item.id, 40)}</span>
                        {#if item.skipped}<span class="muted small">уже опубликовано</span>{/if}
                        {#if item.error}<span class="small" style="color: var(--danger)">{item.error}</span>{/if}
                    </div>
                {/each}
                <div class="row end" style="margin-top: 10px">
                    <button class="btn primary" onclick={onclose}>Готово</button>
                </div>
            {:else}
                {#if error}<div class="alert error">{error}</div>{/if}
                <div class="row end" style="margin-top: 12px">
                    <button class="btn" onclick={onclose} disabled={publishing}>Отмена</button>
                    <button class="btn primary" onclick={() => void confirm()} disabled={publishing || !preview.plan.items.length}>
                        {publishing ? 'Публикую…' : `Опубликовать ${preview.plan.items.length}`}
                    </button>
                </div>
            {/if}
        {/if}
    </div>
</div>
