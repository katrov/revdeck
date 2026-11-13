<script lang="ts">
    import { app, errorText } from '../lib/state.svelte';
    import { getAnalytics } from '../lib/api';
    import { t } from '../lib/i18n.svelte';

    type Analytics = Awaited<ReturnType<typeof getAnalytics>>['analytics'];
    let data = $state<Analytics | null>(null);
    let loading = $state(true);
    let error = $state('');

    $effect(() => {
        const id = app.review?.id;
        if (!id) return;
        loading = true;
        error = '';
        void getAnalytics(id)
            .then((result) => {
                data = result.analytics;
            })
            .catch((cause) => {
                error = errorText(cause);
            })
            .finally(() => {
                loading = false;
            });
    });

    const rate = $derived(data?.acceptanceRate == null ? '—' : `${Math.round(data.acceptanceRate * 100)}%`);
</script>

{#if loading}
    <p class="muted">{t('Загрузка аналитики…', 'Loading analytics…')}</p>
{:else if error}
    <div class="alert error">{error}</div>
{:else if data}
    <section class="card">
        <div class="card-title">{t('Аналитика ревью', 'Review analytics')}</div>
        <div class="stats" style="margin-top: 10px">
            <div><div class="value">{data.findings.total}</div><div class="label">{t('замечаний', 'findings')}</div></div>
            <div><div class="value" style="color: var(--ok)">{data.findings.accepted}</div><div class="label">{t('принято', 'accepted')}</div></div>
            <div><div class="value" style="color: var(--danger)">{data.findings.rejected}</div><div class="label">{t('отклонено', 'rejected')}</div></div>
            <div><div class="value">{data.findings.pending}</div><div class="label">{t('без решения', 'pending')}</div></div>
            <div><div class="value">{data.findings.published}</div><div class="label">{t('опубликовано', 'published')}</div></div>
            <div><div class="value">{rate}</div><div class="label">{t('принято из решённых', 'accepted / decided')}</div></div>
        </div>
    </section>

    <section class="card">
        <div class="card-title">{t('Треды и черновики', 'Threads and drafts')}</div>
        <div class="row" style="margin-top: 8px">
            <span class="badge">{t('тредов', 'threads')} {data.threads.total}</span>
            <span class="badge ok">{t('закрыто', 'resolved')} {data.threads.resolved}</span>
            <span class="badge">{t('открыто', 'open')} {data.threads.open}</span>
            <span class="badge">{t('черновиков', 'drafts')} {data.drafts.ready}</span>
            <span class="badge ok">{t('опубликовано', 'published')} {data.drafts.published}</span>
        </div>
        <div class="row" style="margin-top: 8px">
            {#each Object.entries(data.levels) as [level, count] (level)}
                <span class="badge {level}">{level} · {count}</span>
            {/each}
        </div>
    </section>

    <section class="card">
        <div class="card-title">{t('Отклонённые предложения', 'Rejected suggestions')}</div>
        {#if data.rejections.length}
            {#each data.rejections as item (item.id)}
                <div class="stack" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border)">
                    <div class="row">
                        <span class="badge {item.level}">{item.level}</span>
                        <strong>{item.title}</strong>
                        <span class="muted small mono">{item.file}:{item.line ?? '—'}</span>
                    </div>
                    {#if item.note}<div class="muted small">{item.note}</div>{/if}
                </div>
            {/each}
        {:else}
            <p class="muted" style="margin: 8px 0 0">{t('Отклонённых предложений нет.', 'No rejected suggestions.')}</p>
        {/if}
    </section>
{/if}
