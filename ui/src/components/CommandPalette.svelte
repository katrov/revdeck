<script lang="ts">
    import { app, loadReview, notify, setTab } from '../lib/state.svelte';
    import type { Tab } from '../lib/types';

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
            ['overview', 'Обзор'],
            ['threads', 'Треды'],
            ['findings', 'Замечания'],
            ['diff', 'Diff'],
            ['rules', 'Правила'],
        ];
        for (const [id, label] of tabs) list.push({ id: `tab-${id}`, label: `Перейти: ${label}`, hint: '1–5', run: () => setTab(id) });
        if (review) {
            list.push({ id: 'refresh', label: 'Обновить ревью', hint: 'r', run: () => void loadReview(review.id, { refresh: true }) });
            list.push({ id: 'publish', label: 'Опубликовать изменения', hint: 'p', run: onpublish });
            list.push({
                id: 'copy-context',
                label: 'Скопировать команду контекста',
                hint: 'CLI',
                run: () => {
                    void navigator.clipboard?.writeText(`revdeck context ${review.info.ref.number}`).then(
                        () => notify('Команда скопирована', 'ok'),
                        () => notify('Не удалось скопировать', 'error'),
                    );
                },
            });
            list.push({ id: 'platform', label: 'Открыть в платформе', hint: '↗', run: () => window.open(review.info.webUrl, '_blank', 'noopener') });
        }
        for (const item of app.reviews) {
            if (item.id === review?.id) continue;
            list.push({ id: `review-${item.id}`, label: `Открыть: #${item.number} ${item.title}`, hint: item.project, run: () => void loadReview(item.id) });
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
    <button class="backdrop" type="button" aria-label="Закрыть" onclick={onclose}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Команды">
        <input
            bind:this={input}
            type="text"
            value={query}
            oninput={(event) => (query = event.currentTarget.value)}
            onkeydown={onKeydown}
            placeholder="Команда… (↑↓, Enter)"
        />
        <div style="max-height: 50vh; overflow: auto">
            {#each filtered as action, i (action.id)}
                <button class="palette-item" class:on={i === index} onclick={() => run(action)} onmouseenter={() => (index = i)}>
                    <span>{action.label}</span>
                    <span class="muted small" style="float: right">{action.hint}</span>
                </button>
            {:else}
                <p class="muted small" style="padding: 12px">Ничего не найдено.</p>
            {/each}
        </div>
    </div>
</div>
