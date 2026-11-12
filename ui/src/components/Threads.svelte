<script lang="ts">
    import { app, copyFocusLink, draftFor, errorText, focusLine, loadReview, notify, relativeTime } from '../lib/state.svelte';
    import { deleteComment, saveDraft, updateComment } from '../lib/api';
    import type { ReplyDraft } from '../lib/types';
    import { plural, t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';
    import Reactions from './Reactions.svelte';
    import MarkdownEditor from './MarkdownEditor.svelte';

    let filter = $state<'open' | 'all'>('open');
    let selected = $state<string[]>([]);
    let saving = $state<string[]>([]);
    let openAgent = $state<string[]>([]);
    let editingNote = $state<string | null>(null);
    let editBody = $state('');
    let noteBusy = $state<string | null>(null);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const threads = $derived((app.review?.threads ?? []).filter((thread) => filter === 'all' || !thread.resolved));
    const changedDrafts = $derived(
        (app.review?.drafts ?? []).filter((draft) => {
            const thread = app.review?.threads.find((item) => item.id === draft.threadId);
            return (draft.body.trim() !== '' && !draft.replied) || draft.resolve !== thread?.resolved;
        }),
    );

    function draftOf(threadId: string): ReplyDraft {
        return draftFor(threadId)!;
    }

    function scheduleSave(threadId: string): void {
        const existing = timers.get(threadId);
        if (existing) clearTimeout(existing);
        timers.set(
            threadId,
            setTimeout(() => void save(threadId), 650),
        );
    }

    async function save(threadId: string): Promise<void> {
        const review = app.review;
        const draft = draftFor(threadId);
        if (!review || !draft) return;
        if (!saving.includes(threadId)) saving = [...saving, threadId];
        try {
            const sent = {
                body: draft.body,
                resolve: draft.resolve,
                noteForAgent: draft.noteForAgent,
                agentAction: draft.agentAction,
            };
            const result = await saveDraft(review.id, threadId, sent);
            // Не затираем то, что пользователь успел напечатать, пока шёл запрос.
            if (draft.body === sent.body) draft.body = result.draft.body;
            if (draft.resolve === sent.resolve) draft.resolve = result.draft.resolve;
            if (draft.noteForAgent === sent.noteForAgent) draft.noteForAgent = result.draft.noteForAgent;
            if (draft.agentAction === sent.agentAction) draft.agentAction = result.draft.agentAction;
            draft.posted = result.draft.posted;
            draft.replied = result.draft.replied;
            draft.resolved = result.draft.resolved;
            draft.error = result.draft.error;
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            saving = saving.filter((item) => item !== threadId);
        }
    }

    function toggleSelected(threadId: string): void {
        selected = selected.includes(threadId) ? selected.filter((item) => item !== threadId) : [...selected, threadId];
    }

    function toggleResolve(threadId: string, value: boolean): void {
        const draft = draftFor(threadId);
        if (!draft) return;
        draft.resolve = value;
        void save(threadId);
    }

    function publishSelected(): void {
        const ids = selected.length ? selected : changedDrafts.map((draft) => draft.threadId);
        if (!ids.length) {
            notify(t('Нет черновиков для публикации', 'No drafts to publish'), 'info');
            return;
        }
        app.publishing = { kind: 'reply', ids };
    }

    function selectAllChanged(): void {
        selected = changedDrafts.map((draft) => draft.threadId);
    }

    function canEdit(note: { author: string }): boolean {
        return Boolean(app.review?.user && note.author === app.review.user.username);
    }

    function startEdit(note: { id: string; body: string }): void {
        editingNote = note.id;
        editBody = note.body;
    }

    async function saveEdit(note: { id: string }): Promise<void> {
        const review = app.review;
        if (!review) return;
        noteBusy = note.id;
        try {
            await updateComment(review.id, note.id, editBody);
            await loadReview(review.id, { silent: true });
            editingNote = null;
            notify(t('Комментарий обновлён', 'Comment updated'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            noteBusy = null;
        }
    }

    async function removeNote(note: { id: string }): Promise<void> {
        const review = app.review;
        if (!review) return;
        if (!confirm(t('Удалить комментарий?', 'Delete the comment?'))) return;
        noteBusy = note.id;
        try {
            await deleteComment(review.id, note.id);
            await loadReview(review.id, { silent: true });
            notify(t('Комментарий удалён', 'Comment deleted'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            noteBusy = null;
        }
    }

    $effect(() => {
        const focus = app.focus;
        if (focus?.kind !== 'thread') return;
        const thread = app.review?.threads.find((item) => item.id === focus.id);
        if (!thread) return;
        if (filter === 'open' && thread.resolved) filter = 'all';
        requestAnimationFrame(() => document.getElementById(`thread-${focus.id}`)?.scrollIntoView({ block: 'center' }));
    });
</script>

<div class="row" style="margin-bottom: 12px">
    <button class="btn" class:primary={filter === 'open'} onclick={() => (filter = 'open')}>{t('Открытые', 'Open')}</button>
    <button class="btn" class:primary={filter === 'all'} onclick={() => (filter = 'all')}>{t('Все', 'All')}</button>
    <span class="muted small">{threads.length} {t('из', 'of')} {app.review?.threads.length ?? 0}</span>
    <div style="flex: 1"></div>
    <button class="btn" onclick={selectAllChanged} disabled={!changedDrafts.length}>{t('Выбрать изменённые', 'Select changed')}</button>
    <button class="btn primary" onclick={publishSelected} disabled={!changedDrafts.length && !selected.length}>
        {t('Опубликовать', 'Publish')} {selected.length ? `(${selected.length})` : ''}
    </button>
</div>

{#each threads as thread (thread.id)}
    {@const draft = draftOf(thread.id)}
    {@const busy = saving.includes(thread.id)}
    <section class="card" id={`thread-${thread.id}`} class:highlight={app.focus?.kind === 'thread' && app.focus.id === thread.id}>
        <div class="card-head">
            <input
                type="checkbox"
                checked={selected.includes(thread.id)}
                onchange={() => toggleSelected(thread.id)}
                aria-label={t('Выбрать тред', 'Select thread')}
                style="width: auto"
            />
            <div class="grow">
                <div class="card-title">
                    {thread.resolved ? t('Закрыт', 'Resolved') : t('Открыт', 'Open')}
                    {#if thread.path}
                        · <button class="path-link" onclick={() => focusLine(thread.path!, thread.line)}>{thread.path}:{thread.line ?? '?'}</button>
                    {/if}
                </div>
                <div class="muted small">
                    {thread.notes.length}
                    {plural(thread.notes.length, ['комментарий', 'комментария', 'комментариев'], ['comment', 'comments'])} ·
                    {t('обновлён', 'updated')} {relativeTime(thread.updatedAt)}
                </div>
            </div>
            <button class="btn icon" type="button" title={t('Скопировать ссылку на тред', 'Copy thread link')} onclick={() => copyFocusLink({ kind: 'thread', id: thread.id }, 'threads')}>🔗</button>
            {#if draft.replied}<span class="badge ok">{t('ответ опубликован', 'reply published')}</span>{/if}
            {#if draft.error}<span class="badge err" title={draft.error}>{t('ошибка', 'error')}</span>{/if}
            {#if busy}<span class="muted small">{t('сохранение…', 'saving…')}</span>{/if}
        </div>

        <div class="stack" style="margin-top: 10px">
            {#each thread.notes as note (note.id)}
                <div>
                    <div class="spread">
                        <div class="muted small"><strong style="color: var(--text)">{note.author}</strong> · {relativeTime(note.createdAt)}</div>
                        {#if canEdit(note) && editingNote !== note.id}
                            <div class="row" style="gap: 2px">
                                <button class="btn icon" type="button" title={t('Редактировать', 'Edit')} disabled={noteBusy !== null} onclick={() => startEdit(note)}>✎</button>
                                <button class="btn icon" type="button" title={t('Удалить', 'Delete')} disabled={noteBusy !== null} onclick={() => void removeNote(note)}>🗑</button>
                            </div>
                        {/if}
                    </div>
                    {#if editingNote === note.id}
                        <MarkdownEditor bind:value={editBody} rows={2} />
                        <div class="row end" style="margin-top: 4px">
                            <button class="btn" type="button" onclick={() => (editingNote = null)}>{t('Отмена', 'Cancel')}</button>
                            <button class="btn primary" type="button" disabled={noteBusy !== null} onclick={() => void saveEdit(note)}>{noteBusy ? t('Сохранение…', 'Saving…') : t('Сохранить', 'Save')}</button>
                        </div>
                    {:else}
                        <div class="md"><Markdown source={note.body} /></div>
                        <Reactions reviewId={app.review!.id} {note} />
                    {/if}
                </div>
            {/each}
        </div>

        {#if thread.snippet}
            <details style="margin-top: 8px">
                <summary class="muted small" style="cursor: pointer">{t('Фрагмент кода', 'Code context')}</summary>
                <div class="snippet">
                    {#each thread.snippet as line}
                        <div class="snippet-line" class:add={line.kind === '+'} class:del={line.kind === '-'} class:target={line.target}>
                            <span class="n">{line.newLine ?? line.oldLine ?? ''}</span>
                            <span class="k">{line.kind === ' ' ? '' : line.kind}</span>
                            <span>{line.text}</span>
                        </div>
                    {/each}
                </div>
            </details>
        {/if}

        <div class="stack" style="margin-top: 12px">
            <MarkdownEditor
                bind:value={draft.body}
                onchange={() => scheduleSave(thread.id)}
                placeholder={t('Черновик ответа. Публикуется только после подтверждения.', 'Draft reply. Published only after confirmation.')}
                rows={3}
            />
            <div class="row">
                <label class="switch">
                    <input
                        type="checkbox"
                        checked={draft.resolve}
                        onchange={(event) => toggleResolve(thread.id, event.currentTarget.checked)}
                        style="width: auto"
                    />
                    {t('Предложить закрыть тред', 'Propose resolving the thread')}
                </label>
                <div style="flex: 1"></div>
                {#if busy}<span class="muted small">{t('сохранение…', 'saving…')}</span>{:else}<span class="muted small">{t('сохранено', 'saved')}</span>{/if}
                <button class="btn" onclick={() => void save(thread.id)}>{t('Сохранить', 'Save')}</button>
            </div>
            <details
                open={openAgent.includes(thread.id)}
                ontoggle={(event) => {
                    const open = event.currentTarget.open;
                    openAgent = open ? [...new Set([...openAgent, thread.id])] : openAgent.filter((item) => item !== thread.id);
                }}
            >
                <summary class="muted small" style="cursor: pointer">{t('Заметка агенту', 'Note for the agent')}</summary>
                <div class="stack" style="margin-top: 6px">
                    <textarea
                        class="agent"
                        value={draft.noteForAgent}
                        oninput={(event) => {
                            draft.noteForAgent = event.currentTarget.value;
                            scheduleSave(thread.id);
                        }}
                        placeholder={t('Что сделать: исправить, переписать ответ, пересмотреть правку…', 'What to do: fix, rewrite the reply, revise the change…')}
                        rows="2"
                    ></textarea>
                    <select
                        value={draft.agentAction}
                        onchange={(event) => {
                            draft.agentAction = event.currentTarget.value as ReplyDraft['agentAction'];
                            scheduleSave(thread.id);
                        }}
                    >
                        <option value="">{t('— действие —', '— action —')}</option>
                        <option value="fix">{t('исправить', 'fix')}</option>
                        <option value="reply">{t('ответить', 'reply')}</option>
                        <option value="revise">{t('пересмотреть', 'revise')}</option>
                        <option value="skip">{t('пропустить', 'skip')}</option>
                    </select>
                    <div class="muted small">
                        {t('Агент прочитает заметку при следующем проходе:', 'The agent reads this note on the next pass:')}
                        <span class="mono">revdeck threads {app.review?.info.ref.number}</span>.
                    </div>
                </div>
            </details>
        </div>
    </section>
{:else}
    <p class="muted">
        {filter === 'open' ? t('Открытых тредов нет.', 'No open threads.') : t('Тредов нет.', 'No threads.')}
    </p>
{/each}
