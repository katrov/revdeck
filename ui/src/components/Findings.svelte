<script lang="ts">
    import { app, errorText, focusLine, notify, relativeTime } from '../lib/state.svelte';
    import { saveDecisions, saveFindings } from '../lib/api';
    import type { Finding, Level } from '../lib/types';
    import { truncate } from '../lib/format';
    import Markdown from './Markdown.svelte';

    let levelFilter = $state<'all' | Level>('all');
    let statusFilter = $state<'all' | 'open' | 'published'>('all');
    let selected = $state<string[]>([]);
    let saving = $state(false);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const findings = $derived(
        (app.review?.findings ?? []).filter((finding) => {
            if (levelFilter !== 'all' && finding.level !== levelFilter) return false;
            if (statusFilter === 'published' && finding.status !== 'published') return false;
            if (statusFilter === 'open' && (finding.status === 'published' || finding.status === 'rejected')) return false;
            return true;
        }),
    );
    const publishable = $derived(
        (app.review?.findings ?? []).filter((finding) => finding.status !== 'published' && finding.status !== 'rejected' && finding.decision !== 'reject'),
    );

    function scheduleSave(): void {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void saveAll(), 700);
    }

    async function saveAll(): Promise<void> {
        const review = app.review;
        if (!review) return;
        saving = true;
        try {
            const result = await saveFindings(review.id, review.findings);
            for (const updated of result.findings) {
                const local = review.findings.find((finding) => finding.id === updated.id);
                if (!local) continue;
                local.status = updated.status;
                local.discussionId = updated.discussionId;
                local.publishedAt = updated.publishedAt;
                local.comment = updated.comment;
                local.publishError = updated.publishError;
            }
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            saving = false;
        }
    }

    function toggleSelected(id: string): void {
        selected = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    }

    async function decide(finding: Finding, decision: 'accept' | 'reject' | 'discuss'): Promise<void> {
        const review = app.review;
        if (!review) return;
        try {
            await saveDecisions(review.id, { [finding.id]: { decision, note: finding.note } });
            review.decisions[finding.id] = { decision, note: finding.note };
            notify(decision === 'accept' ? 'Принято' : decision === 'reject' ? 'Отклонено' : 'На обсуждение', 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        }
    }

    function publishSelected(): void {
        const ids = selected.length ? selected : publishable.map((finding) => finding.id);
        if (!ids.length) {
            notify('Нет замечаний для публикации', 'info');
            return;
        }
        app.publishing = { kind: 'finding', ids };
    }
</script>

<div class="row" style="margin-bottom: 12px">
    <select style="width: auto" value={levelFilter} onchange={(event) => (levelFilter = event.currentTarget.value as 'all' | Level)}>
        <option value="all">Все уровни</option>
        <option value="blocker">blocker</option>
        <option value="major">major</option>
        <option value="minor">minor</option>
        <option value="question">question</option>
    </select>
    <select style="width: auto" value={statusFilter} onchange={(event) => (statusFilter = event.currentTarget.value as 'all' | 'open' | 'published')}>
        <option value="all">Все статусы</option>
        <option value="open">Не опубликованные</option>
        <option value="published">Опубликованные</option>
    </select>
    <span class="muted small">{findings.length} из {app.review?.findings.length ?? 0}</span>
    <div style="flex: 1"></div>
    {#if saving}<span class="muted small">сохранение…</span>{/if}
    <button class="btn" onclick={publishSelected} disabled={!publishable.length}>
        Опубликовать {selected.length ? `(${selected.length})` : `(${publishable.length})`}
    </button>
</div>

{#each findings as finding (finding.id)}
    {@const decision = app.review?.decisions[finding.id]?.decision ?? finding.decision}
    <section class="card">
        <div class="card-head">
            <input
                type="checkbox"
                checked={selected.includes(finding.id)}
                onchange={() => toggleSelected(finding.id)}
                aria-label="Выбрать замечание"
                style="width: auto"
            />
            <span class="badge {finding.level}">{finding.level}</span>
            <span class="badge">{finding.status}</span>
            {#if finding.publishedAt}<span class="muted small">опубликовано {relativeTime(finding.publishedAt)}</span>{/if}
            <div class="grow"></div>
            <button class="path-link" onclick={() => focusLine(finding.file, finding.line)}>{finding.file}:{finding.line ?? '—'}</button>
        </div>

        <div class="card-title" style="margin-top: 6px">{finding.title}</div>
        {#if finding.body}<div class="md"><Markdown source={finding.body} /></div>{/if}

        {#if finding.snippet}
            <div class="snippet">
                {#each finding.snippet as line}
                    <div class="snippet-line" class:add={line.kind === '+'} class:del={line.kind === '-'} class:target={line.target}>
                        <span class="n">{line.newLine ?? line.oldLine ?? ''}</span>
                        <span class="k">{line.kind === ' ' ? '' : line.kind}</span>
                        <span>{line.text}</span>
                    </div>
                {/each}
            </div>
        {/if}

        {#if finding.publishError}<div class="alert error" style="margin-top: 8px">{finding.publishError}</div>{/if}

        <label class="muted small" for={`comment-${finding.id}`}>Текст комментария для платформы</label>
        <textarea
            id={`comment-${finding.id}`}
            value={finding.comment}
            oninput={(event) => {
                finding.comment = event.currentTarget.value;
                scheduleSave();
            }}
            rows="3"
            disabled={finding.status === 'published'}
        ></textarea>

        <div class="row" style="margin-top: 8px">
            <button class="btn" class:primary={decision === 'accept'} onclick={() => void decide(finding, 'accept')}>Принять</button>
            <button class="btn" onclick={() => void decide(finding, 'discuss')}>Обсудить</button>
            <button class="btn danger" class:primary={decision === 'reject'} onclick={() => void decide(finding, 'reject')}>Отклонить</button>
            <div style="flex: 1"></div>
            <span class="muted small">{truncate(finding.fingerprint, 16)}</span>
        </div>
    </section>
{:else}
    <p class="muted">Замечаний нет. Агент запишет их через <span class="mono">revdeck_draft_findings</span>.</p>
{/each}
