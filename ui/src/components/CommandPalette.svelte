<script lang="ts">
    import { app, loadReview, notify, setTab } from '../lib/state.svelte';
    import type { Tab } from '../lib/types';
    import { t } from '../lib/i18n.svelte';

    let { onclose, onpublish }: { onclose: () => void; onpublish: () => void } = $props();

    interface Action {
        id: string;
        label: string;
        hint: string;
        run(): void;
    }

    let query = $state('');
    let index = $state(0);
    let input: HTMLInputElement | undefined = $state();

    $effect(() => {
        input?.focus();
    });

    const actions = $derived.by((): Action[] => {
        const review = app.review;
        const list: Action[] = [];
        const tabs: [Tab, string][] = [
            ['overview', t('Обзор', 'Overview')],
            ['threads', t('Треды', 'Threads')],
            ['findings', t('Замечания', 'Findings')],
            ['diff', 'Diff'],
            ['rules', t('Правила', 'Rules')],
        ];
        for (const [id, label] of tabs) list.push({ id: `tab-${id}`, label: `${t('Перейти:', 'Go to:')} ${label}`, hint: '1–5', run: () => setTab(id) });
        if (review) {
            list.push({ id: 'refresh', label: t('Обновить ревью', 'Refresh review'), hint: 'r', run: () => void loadReview(review.id, { refresh: true }) });
            list.push({ id: 'publish', label: t('Опубликовать изменения', 'Publish changes'), hint: 'p', run: onpublish });
            list.push({
                id: 'copy-context',
                label: t('Скопировать команду контекста', 'Copy context command'),
                hint: 'CLI',
                run: () => {
                    void navigator.clipboard?.writeText(`revdeck context ${review.info.ref.number}`).then(
                        () => notify(t('Команда скопирована', 'Command copied'), 'ok'),
                        () => notify(t('Не удалось скопировать', 'Could not copy'), 'error'),
                    );
                },
            });
            list.push({ id: 'platform', label: t('Открыть в платформе', 'Open in platform'), hint: '↗', run: () => window.open(review.info.webUrl, '_blank', 'noopener') });
        }
        for (const item of app.reviews) {
            if (item.id === review?.id) continue;
            list.push({ id: `review-${item.id}`, label: `${t('Открыть:', 'Open:')} #${item.number} ${item.title}`, hint: item.project, run: () => void loadReview(item.id) });
        }
        return list;
    });

    const filtered = $derived(
        actions.filter((action) => {
            const q = query.toLowerCase().trim();
            return !q || action.label.toLowerCase().includes(q) || action.hint.toLowerCase().includes(q);
        }),
    );

    function run(action: Action): void {
        action.run();
        onclose();
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            index = Math.min(filtered.length - 1, index + 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            index = Math.max(0, index - 1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const action = filtered[index];
            if (action) run(action);
        } else if (event.key === 'Escape') {
            onclose();
        }
    }

    $effect(() => {
        index = 0;
    });
</script>

<div class="overlay" style="padding-top: 6vh">
    <button class="backdrop" type="button" aria-label={t('Закрыть', 'Close')} onclick={onclose}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label={t('Команды', 'Commands')}>
        <input
            bind:this={input}
            type="text"
            value={query}
            oninput={(event) => (query = event.currentTarget.value)}
            onkeydown={onKeydown}
            placeholder={t('Команда… (↑↓, Enter)', 'Command… (↑↓, Enter)')}
        />
        <div style="max-height: 50vh; overflow: auto">
            {#each filtered as action, i (action.id)}
                <button class="palette-item" class:on={i === index} onclick={() => run(action)} onmouseenter={() => (index = i)}>
                    <span>{action.label}</span>
                    <span class="muted small" style="float: right">{action.hint}</span>
                </button>
            {:else}
                <p class="muted small" style="padding: 12px">{t('Ничего не найдено.', 'Nothing found.')}</p>
            {/each}
        </div>
    </div>
</div>
