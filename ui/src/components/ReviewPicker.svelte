<script lang="ts">
    import type { ReviewListItem } from '../lib/types';
    import { projectColor } from '../lib/projects';
    import { t } from '../lib/i18n.svelte';

    let {
        reviews,
        selected,
        exclude = [],
        onchange,
    }: {
        reviews: ReviewListItem[];
        selected: string[];
        exclude?: string[];
        onchange: (ids: string[]) => void;
    } = $props();

    let query = $state('');
    const excluded = $derived(new Set(exclude));
    const list = $derived(
        reviews.filter((review) => {
            const q = query.trim().toLowerCase();
            if (!q) return true;
            return `${review.projectKey} ${review.project} #${review.number} ${review.title}`.toLowerCase().includes(q);
        }),
    );

    function toggle(id: string): void {
        if (excluded.has(id)) return;
        onchange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
    }
</script>

<div class="review-picker">
    <input class="project-home-search" bind:value={query} placeholder={t('Найти ревью…', 'Find a review…')} autocomplete="off" />
    <div class="review-picker-list">
        {#each list as review (review.id)}
            <label class="review-picker-row" class:added={excluded.has(review.id)}>
                <input
                    type="checkbox"
                    checked={selected.includes(review.id)}
                    disabled={excluded.has(review.id)}
                    onchange={() => toggle(review.id)}
                />
                <span class="project-dot" style={`--project-color:${projectColor(review.projectKey)}`}></span>
                <span class="review-picker-text">
                    <span class="review-picker-title">#{review.number} {review.title}</span>
                    <span class="review-picker-meta">{review.project} · {review.state}</span>
                </span>
                {#if excluded.has(review.id)}<span class="badge">{t('уже в фиче', 'in feature')}</span>{/if}
            </label>
        {:else}
            <p class="muted small">{t('Ревью не найдены.', 'No reviews found.')}</p>
        {/each}
    </div>
</div>
