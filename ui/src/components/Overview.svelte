<script lang="ts">
    import { app, focusLine, relativeTime, setTab } from '../lib/state.svelte';
    import { plainText, plural, truncate } from '../lib/format';
    import Markdown from './Markdown.svelte';

    const review = $derived(app.review!);
    const openThreads = $derived(review.threads.filter((thread) => !thread.resolved));
    const levels = $derived({
        blocker: review.findings.filter((finding) => finding.level === 'blocker' && finding.status !== 'stale').length,
        major: review.findings.filter((finding) => finding.level === 'major' && finding.status !== 'stale').length,
        minor: review.findings.filter((finding) => finding.level === 'minor' && finding.status !== 'stale').length,
        question: review.findings.filter((finding) => finding.level === 'question' && finding.status !== 'stale').length,
    });
    const pendingNotes = $derived(review.notes.filter((note) => note.toAgent && !note.agentReply));
</script>

{#if review.errors.length}
    <div class="alert">
        <strong>Предупреждения</strong>
        <ul style="margin: 6px 0 0; padding-left: 18px">
            {#each review.errors as error}
                <li>{error}</li>
            {/each}
        </ul>
    </div>
{/if}

<div class="stats">
    <div><div class="value">{review.stats.files}</div><div class="label">{plural(review.stats.files, 'файл', 'файла', 'файлов')}</div></div>
    <div><div class="value" style="color: var(--add-text)">+{review.stats.additions}</div><div class="label">добавлено</div></div>
    <div><div class="value" style="color: var(--del-text)">−{review.stats.deletions}</div><div class="label">удалено</div></div>
    <div><div class="value">{openThreads.length}</div><div class="label">{plural(openThreads.length, 'открытый тред', 'открытых треда', 'открытых тредов')}</div></div>
    <div><div class="value">{review.findings.length}</div><div class="label">{plural(review.findings.length, 'замечание', 'замечания', 'замечаний')}</div></div>
</div>

{#if review.summary}
    <section class="card">
        <div class="card-head">
            <div class="grow">
                <div class="card-title">{review.summary.title || 'Выжимка'}</div>
                {#if review.summary.scope}<div class="muted small mono">{review.summary.scope}</div>{/if}
            </div>
        </div>
        <div class="md" style="margin-top: 6px"><Markdown source={review.summary.summary} /></div>
        {#if review.summary.changes.length}
            <div class="section-title">Что изменено</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.changes as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
        {#if review.summary.focus.length}
            <div class="section-title">На что смотреть</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.focus as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
    </section>
{:else}
    <section class="card flat">
        <div class="muted">Выжимки пока нет. Агент запишет её через <span class="mono">revdeck_set_summary</span> или <span class="mono">revdeck context</span>.</div>
    </section>
{/if}

<div class="section-title">Замечания по уровням</div>
<div class="row">
    <span class="badge blocker">blocker · {levels.blocker}</span>
    <span class="badge major">major · {levels.major}</span>
    <span class="badge minor">minor · {levels.minor}</span>
    <span class="badge question">question · {levels.question}</span>
    <button class="btn" onclick={() => setTab('findings')}>Разобрать</button>
</div>

<div class="section-title">Открытые треды</div>
{#if openThreads.length}
    {#each openThreads.slice(0, 6) as thread (thread.id)}
        <section class="card flat">
            <div class="card-head">
                <div class="grow">
                    <div class="card-title">{truncate(plainText(thread.notes[0]?.body ?? 'Без текста'), 160)}</div>
                    <div class="muted small">
                        {thread.notes[0]?.author ?? '?'} · {relativeTime(thread.notes[0]?.createdAt ?? '')}
                        {#if thread.path}
                            · <button class="path-link" onclick={() => focusLine(thread.path!, thread.line)}>{thread.path}:{thread.line ?? '?'}</button>
                        {/if}
                    </div>
                </div>
                <button class="btn" onclick={() => setTab('threads')}>Ответить</button>
            </div>
        </section>
    {/each}
    {#if openThreads.length > 6}<p class="muted small">И ещё {openThreads.length - 6} — на вкладке «Треды».</p>{/if}
{:else}
    <p class="muted">Открытых тредов нет.</p>
{/if}

{#if pendingNotes.length}
    <div class="section-title">Комментарии к строкам без ответа агента</div>
    {#each pendingNotes.slice(0, 5) as note (note.id)}
        <section class="card flat">
            <div class="card-head">
                <div class="grow">
                    <div class="card-title">{truncate(plainText(note.text), 200)}</div>
                    <div class="muted small">
                        <button class="path-link" onclick={() => focusLine(note.file, note.line)}>{note.file}:{note.line}</button>
                        · {relativeTime(note.createdAt)}
                    </div>
                </div>
            </div>
        </section>
    {/each}
{/if}

<div class="section-title">Как это работает</div>
<p class="muted small">
    Агент пишет черновики ответов и замечаний. Публикует только человек: кнопка «Опубликовать» показывает точный план и отправляет его
    от вашего имени в {review.info.ref.platform === 'gitlab' ? 'GitLab' : 'GitHub'}. Токены платформы агенту не передаются.
</p>
