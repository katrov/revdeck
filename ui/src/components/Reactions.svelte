<script lang="ts">
    import { toggleReaction, toggleReviewReaction } from '../lib/api';
    import { app, errorText, notify } from '../lib/state.svelte';
    import type { Note } from '../lib/types';
    import { t } from '../lib/i18n.svelte';

    let {
        reviewId,
        note = null,
        mode = 'note',
    }: { reviewId: string; note?: Note | null; mode?: 'note' | 'review' } = $props();

    const reactions = $derived(mode === 'review' ? (app.review?.reactions ?? []) : (note?.reactions ?? []));

    const EMOJI: Record<string, string> = {
        thumbsup: '👍',
        thumbsdown: '👎',
        smile: '😄',
        tada: '🎉',
        confused: '😕',
        heart: '❤️',
        rocket: '🚀',
        eyes: '👀',
    };
    const LABELS: Record<string, [string, string]> = {
        thumbsup: ['Нравится', 'Like'],
        thumbsdown: ['Не нравится', 'Dislike'],
        smile: ['Смех', 'Laugh'],
        tada: ['Ура', 'Hooray'],
        confused: ['Смущение', 'Confused'],
        heart: ['Сердце', 'Heart'],
        rocket: ['Ракета', 'Rocket'],
        eyes: ['Смотрю', 'Eyes'],
    };
    const PICKER = Object.keys(EMOJI);

    let picker = $state(false);
    let busy = $state<string | null>(null);

    async function toggle(name: string): Promise<void> {
        if (busy) return;
        busy = name;
        try {
            if (mode === 'review') {
                const result = await toggleReviewReaction(reviewId, name);
                if (app.review) app.review.reactions = result.reactions;
            } else if (note) {
                const result = await toggleReaction(reviewId, note.id, name);
                note.reactions = result.reactions;
            }
            picker = false;
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            busy = null;
        }
    }
</script>

<div class="reactions">
    {#each reactions as reaction (reaction.name)}
        <button
            type="button"
            class="reaction"
            class:mine={reaction.mine}
            class:pending={busy === reaction.name}
            title={reaction.users.join(', ') || t('Нет авторов', 'No users')}
            disabled={busy !== null}
            onclick={() => void toggle(reaction.name)}
        >
            {EMOJI[reaction.name] ?? reaction.name} {reaction.count}
        </button>
    {/each}
    <button
        type="button"
        class="reaction add"
        title={t('Поставить реакцию', 'Add a reaction')}
        aria-label={t('Поставить реакцию', 'Add a reaction')}
        disabled={busy !== null}
        onclick={() => (picker = !picker)}
    >
        +
    </button>
    {#if picker}
        <span class="reaction-picker">
            {#each PICKER as name (name)}
                <button
                    type="button"
                    class="reaction"
                    class:mine={reactions.some((reaction) => reaction.name === name && reaction.mine)}
                    title={t(LABELS[name]![0], LABELS[name]![1])}
                    aria-label={t(LABELS[name]![0], LABELS[name]![1])}
                    disabled={busy !== null}
                    onclick={() => void toggle(name)}
                >
                    {EMOJI[name]}
                </button>
            {/each}
        </span>
    {/if}
</div>
