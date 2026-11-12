<script lang="ts">
    import { app, copyFocusLink, errorText, focusNote, notify } from '../lib/state.svelte';
    import { addNote, deleteNote, getDiff, updateNote } from '../lib/api';
    import type { DiffPayload } from '../lib/types';
    import { truncate } from '../lib/format';
    import { t } from '../lib/i18n.svelte';
    import MarkdownEditor from './MarkdownEditor.svelte';
    import Markdown from './Markdown.svelte';

    let diff = $state<DiffPayload | null>(null);
    let loading = $state(false);
    let error = $state('');
    let limit = $state(2600);
    let noteTarget = $state<{ line: number } | null>(null);
    let noteText = $state('');
    let savingNote = $state(false);
    let fileQuery = $state('');
    let hideViewed = $state(false);
    let viewed = $state<Record<string, boolean>>({});
    let editingNote = $state<string | null>(null);
    let editNoteText = $state('');
    let editingAgent = $state<string | null>(null);
    let editAgentText = $state('');
    let noteBusy = $state<string | null>(null);

    const file = $derived(app.diffFile);
    const fileInfo = $derived(app.review?.files.find((item) => item.path === file) ?? null);
    const files = $derived(
        (app.review?.files ?? []).filter((item) => {
            if (fileQuery.trim() && !item.path.toLowerCase().includes(fileQuery.trim().toLowerCase())) return false;
            if (hideViewed && viewed[item.path]) return false;
            return true;
        }),
    );
    const currentIndex = $derived(files.findIndex((item) => item.path === file));
    const viewedCount = $derived(Object.values(viewed).filter(Boolean).length);

    $effect(() => {
        const id = app.review?.id;
        if (!id) return;
        try {
            const stored = JSON.parse(localStorage.getItem(`revdeck.viewed.${id}`) ?? '{}') as unknown;
            viewed = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, boolean>) : {};
        } catch {
            viewed = {};
        }
    });

    $effect(() => {
        if (!files.some((item) => item.path === app.diffFile)) app.diffFile = files[0]?.path ?? null;
    });

    function toggleViewed(path: string, value: boolean): void {
        viewed = { ...viewed, [path]: value };
        const id = app.review?.id;
        if (id) {
            try {
                localStorage.setItem(`revdeck.viewed.${id}`, JSON.stringify(viewed));
            } catch {
                // localStorage может быть недоступен.
            }
        }
    }

    function copyPath(file: string, line: number): void {
        void navigator.clipboard?.writeText(`${file}:${line}`).then(
            () => notify(t('Путь скопирован', 'Path copied'), 'ok'),
            () => notify(t('Не удалось скопировать', 'Could not copy'), 'error'),
        );
    }

    function startNoteEdit(note: { id: string; text: string }): void {
        editingNote = note.id;
        editNoteText = note.text;
    }

    function startAgentEdit(note: { id: string; agentReply: string }): void {
        editingAgent = note.id;
        editAgentText = note.agentReply;
    }

    async function saveAgentEdit(note: { id: string; agentReply: string }): Promise<void> {
        const review = app.review;
        if (!review) return;
        noteBusy = note.id;
        try {
            await updateNote(review.id, note.id, { agentReply: editAgentText });
            note.agentReply = editAgentText;
            editingAgent = null;
            notify(t('Ответ агента обновлён', 'Agent reply updated'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            noteBusy = null;
        }
    }

    async function saveNoteEdit(note: { id: string; text: string }): Promise<void> {
        const review = app.review;
        if (!review) return;
        noteBusy = note.id;
        try {
            await updateNote(review.id, note.id, { text: editNoteText });
            note.text = editNoteText;
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
            await deleteNote(review.id, note.id);
            review.notes = review.notes.filter((item) => item.id !== note.id);
            notify(t('Комментарий удалён', 'Comment deleted'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            noteBusy = null;
        }
    }

    function selectRelative(delta: number): void {
        if (!files.length) return;
        const index = currentIndex >= 0 ? currentIndex : 0;
        const next = Math.max(0, Math.min(files.length - 1, index + delta));
        app.diffFile = files[next]!.path;
    }

    $effect(() => {
        const reviewId = app.review?.id;
        const path = app.diffFile;
        if (!reviewId || !path) {
            diff = null;
            return;
        }
        loading = true;
        error = '';
        void getDiff(reviewId, path)
            .then((data) => {
                diff = data.file;
            })
            .catch((cause) => {
                error = errorText(cause);
                diff = null;
            })
            .finally(() => {
                loading = false;
            });
    });

    const rows = $derived.by(() => {
        if (!diff) return [] as ({ kind: 'hunk'; header: string } | { kind: 'line'; line: DiffPayload['hunks'][number]['lines'][number] })[];
        const out: ({ kind: 'hunk'; header: string } | { kind: 'line'; line: DiffPayload['hunks'][number]['lines'][number] })[] = [];
        for (const hunk of diff.hunks) {
            out.push({ kind: 'hunk', header: hunk.header });
            for (const line of hunk.lines) out.push({ kind: 'line', line });
        }
        return out;
    });

    const marks = $derived.by(() => {
        const map = new Map<number, string[]>();
        const review = app.review;
        if (!review || !diff) return map;
        for (const finding of review.findings) {
            if (finding.file === diff.path && finding.line) {
                map.set(finding.line, [...(map.get(finding.line) ?? []), `${t('замечание', 'finding')} ${finding.id}`]);
            }
        }
        for (const thread of review.threads) {
            if (thread.path === diff.path && thread.line && !thread.resolved) {
                map.set(thread.line, [...(map.get(thread.line) ?? []), t('открытый тред', 'open thread')]);
            }
        }
        for (const note of review.notes) {
            if (note.file === diff.path && note.line) {
                map.set(note.line, [...(map.get(note.line) ?? []), t('комментарий к строке', 'line comment')]);
            }
        }
        return map;
    });

    const fileNotes = $derived((app.review?.notes ?? []).filter((note) => note.file === file));

    function pickLine(lineNumber: number | null): void {
        if (!lineNumber) return;
        noteTarget = { line: lineNumber };
        noteText = '';
    }

    async function submitNote(): Promise<void> {
        const review = app.review;
        if (!review || !file || !noteTarget) return;
        if (!noteText.trim()) return;
        savingNote = true;
        try {
            const result = await addNote(review.id, file, noteTarget.line, noteText.trim());
            review.notes = [...review.notes, result.note];
            notify(t('Комментарий сохранён: агент увидит его в контексте', 'Comment saved: the agent sees it in the review context'), 'ok');
            noteTarget = null;
            noteText = '';
        } catch (cause) {
            notify(errorText(cause), 'error');
        } finally {
            savingNote = false;
        }
    }

    $effect(() => {
        const focus = app.diffFocus;
        if (!focus || !diff || focus.file !== diff.path) return;
        requestAnimationFrame(() => {
            document.getElementById(`line-${focus.line}`)?.scrollIntoView({ block: 'center' });
        });
    });

    $effect(() => {
        const focus = app.focus;
        if (focus?.kind !== 'note') return;
        requestAnimationFrame(() => document.getElementById(`note-${focus.id}`)?.scrollIntoView({ block: 'center' }));
    });
</script>

<div class="split">
    <div class="file-list">
        <div class="file-tools">
            <input bind:value={fileQuery} placeholder={t('Найти файл…', 'Filter files…')} aria-label={t('Найти файл', 'Filter files')} />
            <div class="spread">
                <label class="switch small">
                    <input type="checkbox" bind:checked={hideViewed} style="width: auto" />
                    {t('Скрыть просмотренные', 'Hide viewed')}
                </label>
                <span class="muted small">{viewedCount}/{app.review?.files.length ?? 0}</span>
            </div>
            <div class="file-nav">
                <button class="btn icon" type="button" onclick={() => selectRelative(-1)} disabled={currentIndex <= 0} title={t('Предыдущий файл', 'Previous file')}>←</button>
                <span class="muted small">{files.length ? `${currentIndex + 1}/${files.length}` : '0/0'}</span>
                <button class="btn icon" type="button" onclick={() => selectRelative(1)} disabled={currentIndex < 0 || currentIndex >= files.length - 1} title={t('Следующий файл', 'Next file')}>→</button>
            </div>
        </div>
        {#each files as item (item.path)}
            <div class="file-row" class:active={app.diffFile === item.path}>
                <input
                    type="checkbox"
                    class="file-check"
                    checked={viewed[item.path] ?? false}
                    aria-label={t('Файл просмотрен', 'File viewed')}
                    onchange={(event) => toggleViewed(item.path, event.currentTarget.checked)}
                />
                <button class="file-item" class:active={app.diffFile === item.path} onclick={() => (app.diffFile = item.path)}>
                    {#if item.status === 'added'}<span class="badge ok">A</span>{:else if item.status === 'deleted'}<span class="badge err">D</span>{:else if item.status === 'renamed'}<span class="badge">R</span>{:else}<span class="badge">M</span>{/if}
                    <span class="name" title={item.path}>{item.path}</span>
                    <span class="counts">{item.additions}/{item.deletions}</span>
                </button>
            </div>
        {:else}
            <p class="muted small" style="padding: 8px">{t('Файлов не найдено.', 'No files found.')}</p>
        {/each}
    </div>

    <div class="diff-view">
        {#if loading && !diff}
            <p class="muted" style="padding: 12px">{t('Загрузка diff…', 'Loading diff…')}</p>
        {:else if error}
            <div class="alert error" style="margin: 12px">{error}</div>
        {:else if !diff}
            <p class="muted" style="padding: 12px">{t('Выберите файл слева.', 'Pick a file on the left.')}</p>
        {:else if diff.binary}
            <p class="muted" style="padding: 12px">{t('Бинарный файл: diff не отображается.', 'Binary file: no diff to display.')}</p>
        {:else}
            <div class="diff-content">
                {#each rows.slice(0, limit) as row}
                    {#if row.kind === 'hunk'}
                        <div class="hunk-head">{row.header}</div>
                    {:else}
                        {@const line = row.line}
                        {@const number = line.newLine ?? line.oldLine ?? 0}
                        <div
                            class="diff-line"
                            class:add={line.kind === '+'}
                            class:del={line.kind === '-'}
                            class:target-line={app.diffFocus?.line === number && app.diffFocus?.file === diff.path}
                            id={`line-${number}`}
                            onclick={() => pickLine(line.newLine)}
                            onkeydown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    pickLine(line.newLine);
                                }
                            }}
                            role="button"
                            tabindex="0"
                            title={marks.get(number)?.join(', ') ?? ''}
                        >
                            <span class="n">{line.newLine ?? ''}</span>
                            <span class="n">{line.oldLine ?? ''}</span>
                            <span class="k">{line.kind === ' ' ? '' : line.kind}</span>
                            <span class="text">
                                {line.text}{#if marks.has(number)}<span class="badge minor" style="margin-left: 8px">{truncate(marks.get(number)!.join(', '), 40)}</span>{/if}
                            </span>
                        </div>
                    {/if}
                {/each}
            </div>
            {#if rows.length > limit}
                <div style="padding: 12px">
                    <button class="btn" onclick={() => (limit += 2600)}>{t('Показать ещё', 'Show more')} ({rows.length - limit} {t('строк', 'lines')})</button>
                </div>
            {/if}

            {#if noteTarget}
                <div class="note-composer">
                    <div class="spread" style="margin-bottom: 6px">
                        <strong>{t('Комментарий к строке', 'Comment on line')} {noteTarget.line}</strong>
                        <button class="btn" onclick={() => (noteTarget = null)}>{t('Отмена', 'Cancel')}</button>
                    </div>
                    <MarkdownEditor
                        bind:value={noteText}
                        rows={2}
                        placeholder={t('Комментарий уйдёт агенту', 'The comment goes to the agent')}
                    />
                    <div class="row end" style="margin-top: 6px">
                        <span class="muted small">{t('Агент увидит комментарий в контексте ревью.', 'The agent sees this comment in the review context.')}</span>
                        <button class="btn icon" type="button" title={t('Скопировать ссылку на строку', 'Copy line link')} onclick={() => copyFocusLink({ kind: 'line', file: file ?? '', line: noteTarget?.line ?? 0 }, 'diff')}>🔗</button>
                        <button class="btn primary" onclick={() => void submitNote()} disabled={savingNote || !noteText.trim()}>{t('Сохранить', 'Save')}</button>
                    </div>
                </div>
            {/if}

            {#if fileNotes.length}
                <div style="padding: 12px">
                    <div class="section-title">{t('Комментарии к строкам этого файла', 'Line comments in this file')}</div>
                    {#each fileNotes as note (note.id)}
                        <section class="card flat" id={`note-${note.id}`} class:highlight={app.focus?.kind === 'note' && app.focus.id === note.id}>
                            <div class="card-head">
                                <span class="note-location">
                                    <button class="path-link" type="button" title={`${note.file}:${note.line}`} onclick={() => focusNote(note)}>{note.file}:{note.line}</button>
                                    <button class="btn icon" type="button" title={t('Скопировать путь', 'Copy path')} aria-label={t('Скопировать путь', 'Copy path')} onclick={() => copyPath(note.file, note.line)}>⧉</button>
                                </span>
                                <button class="btn icon" type="button" title={t('Скопировать ссылку на комментарий', 'Copy comment link')} onclick={() => copyFocusLink({ kind: 'note', id: note.id }, 'diff')}>🔗</button>
                                {#if !note.posted && editingNote !== note.id}
                                    <button class="btn icon" type="button" title={t('Редактировать', 'Edit')} disabled={noteBusy !== null} onclick={() => startNoteEdit(note)}>✎</button>
                                    <button class="btn icon" type="button" title={t('Удалить', 'Delete')} disabled={noteBusy !== null} onclick={() => void removeNote(note)}>🗑</button>
                                {/if}
                                {#if note.posted}<span class="badge ok">{t('опубликовано', 'published')}</span>{/if}
                                {#if note.agentReply}<span class="badge">{t('ответ агента', 'agent reply')}</span>{/if}
                                {#if note.agentReply && editingAgent !== note.id}
                                    <button class="btn icon" type="button" title={t('Редактировать ответ агента', 'Edit agent reply')} disabled={noteBusy !== null} onclick={() => startAgentEdit(note)}>✎</button>
                                {/if}
                            </div>
                            {#if editingNote === note.id}
                                <MarkdownEditor bind:value={editNoteText} rows={2} />
                                <div class="row end" style="margin-top: 4px">
                                    <button class="btn" type="button" onclick={() => (editingNote = null)}>{t('Отмена', 'Cancel')}</button>
                                    <button class="btn primary" type="button" disabled={noteBusy !== null} onclick={() => void saveNoteEdit(note)}>{noteBusy ? t('Сохранение…', 'Saving…') : t('Сохранить', 'Save')}</button>
                                </div>
                            {:else}
                                <div class="md"><Markdown source={note.text} /></div>
                            {/if}
                            {#if editingAgent === note.id}
                                <MarkdownEditor bind:value={editAgentText} rows={2} />
                                <div class="row end" style="margin-top: 4px">
                                    <button class="btn" type="button" onclick={() => (editingAgent = null)}>{t('Отмена', 'Cancel')}</button>
                                    <button class="btn primary" type="button" disabled={noteBusy !== null} onclick={() => void saveAgentEdit(note)}>{noteBusy ? t('Сохранение…', 'Saving…') : t('Сохранить', 'Save')}</button>
                                </div>
                            {:else if note.agentReply}
                                <div class="muted small">→ {note.agentReply}</div>
                            {/if}
                            {#if note.error}<div class="alert error">{note.error}</div>{/if}
                        </section>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</div>
