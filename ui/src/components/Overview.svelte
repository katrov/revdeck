<script lang="ts">
    import { app, focusLine, focusNote, focusThread, notify, relativeTime, setTab } from '../lib/state.svelte';
    import { plainText, truncate } from '../lib/format';
    import { plural, t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';
    import Reactions from './Reactions.svelte';

    const review = $derived(app.review!);
    const openThreads = $derived(review.threads.filter((thread) => !thread.resolved));
    const levels = $derived({
        blocker: review.findings.filter((finding) => finding.level === 'blocker' && finding.status !== 'stale').length,
        major: review.findings.filter((finding) => finding.level === 'major' && finding.status !== 'stale').length,
        minor: review.findings.filter((finding) => finding.level === 'minor' && finding.status !== 'stale').length,
        question: review.findings.filter((finding) => finding.level === 'question' && finding.status !== 'stale').length,
    });
    const pendingNotes = $derived(review.notes.filter((note) => note.toAgent && !note.agentReply));

    function copyPath(path: string, line: number | null): void {
        const value = `${path}${line ? `:${line}` : ''}`;
        void navigator.clipboard?.writeText(value).then(
            () => notify(t('Путь скопирован', 'Path copied'), 'ok'),
            () => notify(t('Не удалось скопировать', 'Could not copy'), 'error'),
        );
    }
</script>

{#if review.errors.length}
    <div class="alert">
        <strong>{t('Предупреждения', 'Warnings')}</strong>
        <ul style="margin: 6px 0 0; padding-left: 18px">
            {#each review.errors as error}
                <li>{error}</li>
            {/each}
        </ul>
    </div>
{/if}

<section class="card">
    <div class="card-head">
        <div class="card-title">{t('Описание MR/PR', 'MR/PR description')}</div>
    </div>
    {#if review.info.description.trim()}
        <div class="md" style="margin-top: 6px"><Markdown source={review.info.description} /></div>
    {:else}
        <p class="muted" style="margin: 6px 0 0">{t('Описание пустое.', 'The description is empty.')}</p>
    {/if}
    <Reactions reviewId={review.id} mode="review" />
</section>

<div class="stats">
    <div><div class="value">{review.stats.files}</div><div class="label">{plural(review.stats.files, ['файл', 'файла', 'файлов'], ['file', 'files'])}</div></div>
    <div><div class="value" style="color: var(--add-text)">+{review.stats.additions}</div><div class="label">{t('добавлено', 'added')}</div></div>
    <div><div class="value" style="color: var(--del-text)">−{review.stats.deletions}</div><div class="label">{t('удалено', 'removed')}</div></div>
    <div><div class="value">{openThreads.length}</div><div class="label">{plural(openThreads.length, ['открытый тред', 'открытых треда', 'открытых тредов'], ['open thread', 'open threads'])}</div></div>
    <div><div class="value">{review.findings.length}</div><div class="label">{plural(review.findings.length, ['замечание', 'замечания', 'замечаний'], ['finding', 'findings'])}</div></div>
</div>

{#if review.summary}
    <section class="card">
        <div class="card-head">
            <div class="grow">
                <div class="card-title">{review.summary.title || t('Выжимка', 'Summary')}</div>
                {#if review.summary.scope}<div class="muted small mono">{review.summary.scope}</div>{/if}
            </div>
        </div>
        <div class="md" style="margin-top: 6px"><Markdown source={review.summary.summary} /></div>
        {#if review.summary.changes.length}
            <div class="section-title">{t('Что изменено', 'What changed')}</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.changes as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
        {#if review.summary.focus.length}
            <div class="section-title">{t('На что смотреть', 'What to focus on')}</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.focus as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
    </section>
{:else}
    <section class="card flat">
        <div class="muted">
            {t('Выжимки пока нет. Агент запишет её через', 'No summary yet. The agent writes it via')}
            <span class="mono">revdeck_set_summary</span> {t('или', 'or')} <span class="mono">revdeck context</span>.
        </div>
    </section>
{/if}

<div class="section-title">{t('Замечания по уровням', 'Findings by level')}</div>
<div class="row">
    <span class="badge blocker">blocker · {levels.blocker}</span>
    <span class="badge major">major · {levels.major}</span>
    <span class="badge minor">minor · {levels.minor}</span>
    <span class="badge question">question · {levels.question}</span>
    <button class="btn" onclick={() => setTab('findings')}>{t('Разобрать', 'Triage')}</button>
</div>

<div class="section-title">{t('Открытые треды', 'Open threads')}</div>
{#if openThreads.length}
    {#each openThreads.slice(0, 6) as thread (thread.id)}
        <section class="card flat">
            <div class="card-head">
                <div class="grow">
                    <div class="card-title">{truncate(plainText(thread.notes[0]?.body ?? t('Без текста', 'No text')), 160)}</div>
                    <div class="muted small">
                        {thread.notes[0]?.author ?? '?'} · {relativeTime(thread.notes[0]?.createdAt ?? '')}
                        {#if thread.path}
                            · <span class="thread-location">
                                <button class="path-link" title={`${thread.path}:${thread.line ?? '?'}`} onclick={() => focusLine(thread.path!, thread.line)}>{thread.path}:{thread.line ?? '?'}</button>
                                <button class="btn icon" type="button" title={t('Скопировать путь', 'Copy path')} aria-label={t('Скопировать путь', 'Copy path')} onclick={() => copyPath(thread.path!, thread.line)}>⧉</button>
                            </span>
                        {/if}
                    </div>
                </div>
                <button class="btn" onclick={() => focusThread(thread.id)}>{t('Ответить', 'Reply')}</button>
            </div>
        </section>
    {/each}
    {#if openThreads.length > 6}
        <p class="muted small">
            {t('И ещё', 'And')} {openThreads.length - 6} {t('— на вкладке «Треды».', 'more on the Threads tab.')}
        </p>
    {/if}
{:else}
    <p class="muted">{t('Открытых тредов нет.', 'No open threads.')}</p>
{/if}

{#if pendingNotes.length}
    <div class="section-title">{t('Комментарии к строкам без ответа агента', 'Line comments without an agent reply')}</div>
    {#each pendingNotes.slice(0, 5) as note (note.id)}
        <section class="card flat">
            <div class="card-head">
                <div class="grow">
                    <div class="card-title">{truncate(plainText(note.text), 200)}</div>
                    <div class="muted small">
                        <span class="note-location">
                            <button class="path-link" title={`${note.file}:${note.line}`} onclick={() => focusNote(note)}>{note.file}:{note.line}</button>
                            <button class="btn icon" type="button" title={t('Скопировать путь', 'Copy path')} aria-label={t('Скопировать путь', 'Copy path')} onclick={() => copyPath(note.file, note.line)}>⧉</button>
                        </span>
                        · {relativeTime(note.createdAt)}
                    </div>
                </div>
            </div>
        </section>
    {/each}
{/if}

<div class="section-title">{t('Как это работает', 'How it works')}</div>
<p class="muted small">
    {t(
        'Агент пишет черновики ответов и замечаний. Публикует только человек: кнопка «Опубликовать» показывает точный план и отправляет его от вашего имени в',
        'The agent writes draft replies and findings. Only a human publishes: the Publish button shows the exact plan and sends it on your behalf to',
    )}
    {review.info.ref.platform === 'gitlab' ? 'GitLab' : 'GitHub'}.
    {t('Токены платформы агенту не передаются.', 'Platform tokens are never passed to the agent.')}
</p>
