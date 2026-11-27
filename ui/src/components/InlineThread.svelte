<script lang="ts">
    import { app, draftFor, errorText, focusThread, notify, relativeTime } from '../lib/state.svelte';
    import { saveDraft } from '../lib/api';
    import type { Thread } from '../lib/types';
    import { plural, t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';
    import MarkdownEditor from './MarkdownEditor.svelte';

    let { thread }: { thread: Thread } = $props();

    let busy = $state(false);
    const draft = $derived(draftFor(thread.id));
    const visibleNotes = $derived(thread.notes.length <= 2 ? thread.notes : [thread.notes[0]!, thread.notes[thread.notes.length - 1]!]);
    const hiddenNotes = $derived(Math.max(0, thread.notes.length - visibleNotes.length));

    async function reply(): Promise<void> {
        const review = app.review;
        if (!review || !draft || !draft.body.trim() || busy) return;
        busy = true;
        try {
            const sent = {
                body: draft.body,
                resolve: draft.resolve,
                noteForAgent: draft.noteForAgent,
                agentAction: draft.agentAction,
            };
            const result = await saveDraft(review.id, thread.id, sent);
            if (draft.body === sent.body) draft.body = result.draft.body;
            draft.posted = result.draft.posted;
            draft.replied = result.draft.replied;
            draft.error = result.draft.error;
            app.publishing = { kind: 'reply', ids: [thread.id] };
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            busy = false;
        }
    }
</script>

<section class="inline-card inline-thread">
    <div class="inline-card-head">
        <span class="badge">{t('тред', 'thread')}</span>
        {#if thread.outdated}<span class="badge">{t('устарело', 'outdated')}</span>{/if}
        <span class="muted small">
            {thread.notes.length}
            {plural(thread.notes.length, ['комментарий', 'комментария', 'комментариев'], ['comment', 'comments'])} ·
            {relativeTime(thread.updatedAt)}
        </span>
        <div class="grow"></div>
        <button class="btn" type="button" onclick={() => focusThread(thread.id)}>{t('Открыть', 'Open')}</button>
    </div>

    {#each visibleNotes as note (note.id)}
        <div class="inline-note">
            <div class="inline-note-head">
                <strong>{note.author}</strong>
                <span class="muted small">{relativeTime(note.createdAt)}</span>
            </div>
            <div class="md"><Markdown source={note.body} /></div>
        </div>
    {/each}
    {#if hiddenNotes > 0}
        <button class="inline-more" type="button" onclick={() => focusThread(thread.id)}>
            {t(`Ещё ${hiddenNotes} в треде`, `${hiddenNotes} more in the thread`)}
        </button>
    {/if}

    {#if !app.preview && draft}
        <div class="inline-reply">
            <MarkdownEditor
                bind:value={draft.body}
                rows={2}
                disabled={busy}
                placeholder={t('Быстрый ответ. Публикуется после подтверждения.', 'Quick reply. Published after confirmation.')}
            />
            <div class="row end" style="margin-top: 5px">
                <button class="btn primary" type="button" disabled={busy || !draft.body.trim()} onclick={() => void reply()}>
                    {busy ? t('Сохранение…', 'Saving…') : t('Ответить', 'Reply')}
                </button>
            </div>
        </div>
    {/if}
</section>
