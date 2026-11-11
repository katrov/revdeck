<script lang="ts">
    import { app, draftFor, errorText, focusLine, notify, relativeTime } from '../lib/state.svelte';
    import { saveDraft } from '../lib/api';
    import type { ReplyDraft } from '../lib/types';
    import { truncate } from '../lib/format';
    import Markdown from './Markdown.svelte';

    let filter = $state<'open' | 'all'>('open');
    let selected = $state<string[]>([]);
    let saving = $state<string[]>([]);
    let openAgent = $state<string[]>([]);
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
            const result = await saveDraft(review.id, threadId, {
                body: draft.body,
                resolve: draft.resolve,
                noteForAgent: draft.noteForAgent,
                agentAction: draft.agentAction,
            });
            Object.assign(draft, result.draft);
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
            notify('Нет черновиков для публикации', 'info');
            return;
        }
        app.publishing = { kind: 'reply', ids };
    }

    function selectAllChanged(): void {
        selected = changedDrafts.map((draft) => draft.threadId);
    }
</script>

<div class="row" style="margin-bottom: 12px">
    <button class="btn" class:primary={filter === 'open'} onclick={() => (filter = 'open')}>Открытые</button>
    <button class="btn" class:primary={filter === 'all'} onclick={() => (filter = 'all')}>Все</button>
    <span class="muted small">{threads.length} из {app.review?.threads.length ?? 0}</span>
    <div style="flex: 1"></div>
    <button class="btn" onclick={selectAllChanged} disabled={!changedDrafts.length}>Выбрать изменённые</button>
    <button class="btn primary" onclick={publishSelected} disabled={!changedDrafts.length && !selected.length}>
        Опубликовать {selected.length ? `(${selected.length})` : ''}
    </button>
</div>

{#each threads as thread (thread.id)}
    {@const draft = draftOf(thread.id)}
    {@const busy = saving.includes(thread.id)}
    <section class="card">
        <div class="card-head">
            <input
                type="checkbox"
                checked={selected.includes(thread.id)}
                onchange={() => toggleSelected(thread.id)}
                aria-label="Выбрать тред"
                style="width: auto"
            />
            <div class="grow">
                <div class="card-title">
                    {thread.resolved ? 'Закрыт' : 'Открыт'}
                    {#if thread.path}
                        · <button class="path-link" onclick={() => focusLine(thread.path!, thread.line)}>{thread.path}:{thread.line ?? '?'}</button>
                    {/if}
                </div>
                <div class="muted small">{thread.notes.length} комментариев · обновлён {relativeTime(thread.updatedAt)}</div>
            </div>
            {#if draft.replied}<span class="badge ok">ответ опубликован</span>{/if}
            {#if draft.error}<span class="badge err" title={draft.error}>ошибка</span>{/if}
            {#if busy}<span class="muted small">сохранение…</span>{/if}
        </div>

        <div class="stack" style="margin-top: 10px">
            {#each thread.notes as note (note.id)}
                <div>
                    <div class="muted small"><strong style="color: var(--text)">{note.author}</strong> · {relativeTime(note.createdAt)}</div>
                    <div class="md"><Markdown source={note.body} /></div>
                </div>
            {/each}
        </div>

        {#if thread.snippet}
            <details style="margin-top: 8px">
                <summary class="muted small" style="cursor: pointer">Фрагмент кода</summary>
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
            <textarea
                value={draft.body}
                oninput={(event) => {
                    draft.body = event.currentTarget.value;
                    scheduleSave(thread.id);
                }}
                placeholder="Черновик ответа. Публикуется только после подтверждения."
                rows="3"
            ></textarea>
            <div class="row">
                <label class="switch">
                    <input
                        type="checkbox"
                        checked={draft.resolve}
                        onchange={(event) => toggleResolve(thread.id, event.currentTarget.checked)}
                        style="width: auto"
                    />
                    Предложить закрыть тред
                </label>
                <div style="flex: 1"></div>
                {#if busy}<span class="muted small">сохранение…</span>{:else}<span class="muted small">сохранено</span>{/if}
                <button class="btn" onclick={() => void save(thread.id)}>Сохранить</button>
            </div>
            <details
                open={openAgent.includes(thread.id)}
                ontoggle={(event) => {
                    const open = event.currentTarget.open;
                    openAgent = open ? [...new Set([...openAgent, thread.id])] : openAgent.filter((item) => item !== thread.id);
                }}
            >
                <summary class="muted small" style="cursor: pointer">Заметка агенту{openAgent.includes(thread.id) ? '' : ''}</summary>
                <div class="stack" style="margin-top: 6px">
                    <textarea
                        class="agent"
                        value={draft.noteForAgent}
                        oninput={(event) => {
                            draft.noteForAgent = event.currentTarget.value;
                            scheduleSave(thread.id);
                        }}
                        placeholder="Что сделать: исправить, переписать ответ, пересмотреть правку…"
                        rows="2"
                    ></textarea>
                    <select
                        value={draft.agentAction}
                        onchange={(event) => {
                            draft.agentAction = event.currentTarget.value as ReplyDraft['agentAction'];
                            scheduleSave(thread.id);
                        }}
                    >
                        <option value="">— действие —</option>
                        <option value="fix">исправить</option>
                        <option value="reply">ответить</option>
                        <option value="revise">пересмотреть</option>
                        <option value="skip">пропустить</option>
                    </select>
                    <div class="muted small">Агент прочитает заметку при следующем проходе: <span class="mono">revdeck threads {app.review?.info.ref.number}</span>.</div>
                </div>
            </details>
        </div>
    </section>
{:else}
    <p class="muted">{filter === 'open' ? 'Открытых тредов нет.' : 'Тредов нет.'}</p>
{/each}
