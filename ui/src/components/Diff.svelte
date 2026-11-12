<script lang="ts">
    import { app, errorText, notify } from '../lib/state.svelte';
    import { addNote, getDiff } from '../lib/api';
    import type { DiffPayload } from '../lib/types';
    import { truncate } from '../lib/format';
    import { t } from '../lib/i18n.svelte';
    import MarkdownEditor from './MarkdownEditor.svelte';

    let diff = $state<DiffPayload | null>(null);
    let loading = $state(false);
    let error = $state('');
    let limit = $state(2600);
    let noteTarget = $state<{ line: number } | null>(null);
    let noteText = $state('');
    let savingNote = $state(false);

    const file = $derived(app.diffFile);
    const fileInfo = $derived(app.review?.files.find((item) => item.path === file) ?? null);

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
</script>

<div class="split">
    <div class="file-list">
        {#each app.review?.files ?? [] as item (item.path)}
            <button class="file-item" class:active={app.diffFile === item.path} onclick={() => (app.diffFile = item.path)}>
                {#if item.status === 'added'}<span class="badge ok">A</span>{:else if item.status === 'deleted'}<span class="badge err">D</span>{:else if item.status === 'renamed'}<span class="badge">R</span>{:else}<span class="badge">M</span>{/if}
                <span class="name" title={item.path}>{item.path}</span>
                <span class="counts">{item.additions}/{item.deletions}</span>
            </button>
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
                        <button class="btn primary" onclick={() => void submitNote()} disabled={savingNote || !noteText.trim()}>{t('Сохранить', 'Save')}</button>
                    </div>
                </div>
            {/if}

            {#if fileNotes.length}
                <div style="padding: 12px">
                    <div class="section-title">{t('Комментарии к строкам этого файла', 'Line comments in this file')}</div>
                    {#each fileNotes as note (note.id)}
                        <section class="card flat">
                            <div class="card-head">
                                <span class="mono small">{note.file}:{note.line}</span>
                                {#if note.posted}<span class="badge ok">{t('опубликовано', 'published')}</span>{/if}
                                {#if note.agentReply}<span class="badge">{t('ответ агента', 'agent reply')}</span>{/if}
                            </div>
                            <div class="md"><span>{note.text}</span></div>
                            {#if note.agentReply}<div class="muted small">→ {note.agentReply}</div>{/if}
                            {#if note.error}<div class="alert error">{note.error}</div>{/if}
                        </section>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</div>
