<script lang="ts">
    import { app, errorText, focusLine, focusNote, focusThread, notify, relativeTime, setTab } from '../lib/state.svelte';
    import { addAgentMessage, getVersions } from '../lib/api';
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
    const agentMessages = $derived(review.agentMessages ?? []);
    let versions = $state<{ id: number; headSha: string; createdAt: string; files: number; findings: number; additions: number; deletions: number }[]>([]);
    let question = $state('');
    let sending = $state(false);

    async function askAgent(): Promise<void> {
        const text = question.trim();
        if (!text || sending) return;
        sending = true;
        try {
            const { message } = await addAgentMessage(review.id, text);
            const current = review.agentMessages ?? [];
            if (!current.some((item) => item.id === message.id)) review.agentMessages = [...current, message];
            question = '';
            notify(t('Вопрос отправлен агенту', 'Question sent to the agent'), 'ok');
        } catch (error) {
            notify(errorText(error), 'error');
        } finally {
            sending = false;
        }
    }

    $effect(() => {
        if (app.preview) {
            versions = [];
            return;
        }
        const id = review.id;
        void getVersions(id).then((result) => (versions = result.versions)).catch(() => undefined);
    });

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
    {#if !app.preview}<Reactions reviewId={review.id} mode="review" />{/if}
</section>

<div class="stats">
    <div><div class="value">{review.stats.files}</div><div class="label">{plural(review.stats.files, ['файл', 'файла', 'файлов'], ['file', 'files'])}</div></div>
    <div><div class="value" style="color: var(--add-text)">+{review.stats.additions}</div><div class="label">{t('добавлено', 'added')}</div></div>
    <div><div class="value" style="color: var(--del-text)">−{review.stats.deletions}</div><div class="label">{t('удалено', 'removed')}</div></div>
    <div><div class="value">{openThreads.length}</div><div class="label">{plural(openThreads.length, ['открытый тред', 'открытых треда', 'открытых тредов'], ['open thread', 'open threads'])}</div></div>
    {#if !app.preview}
        <div><div class="value">{review.findings.length}</div><div class="label">{plural(review.findings.length, ['замечание', 'замечания', 'замечаний'], ['finding', 'findings'])}</div></div>
    {/if}
</div>

{#if !app.preview}
<section class="card">
    <div class="card-head">
        <div class="card-title">{t('Спросить агента', 'Ask the agent')}</div>
    </div>
    <p class="muted small" style="margin: 6px 0 10px">
        {t(
            'Вопрос по задаче, контексту или конкретному месту в ревью. Сообщение сохраняется в revdeck и попадёт в следующий контекст агента; в платформу оно не публикуется.',
            'A question about the task, context or a specific part of the review. The message is stored in revdeck and appears in the agent’s next context; it is not published to the platform.',
        )}
    </p>
    {#if agentMessages.length}
        <div class="stack" style="margin-bottom: 12px">
            {#each agentMessages as message (message.id)}
                <div class="agent-message" class:from-agent={message.role === 'agent'}>
                    <div class="muted small">
                        <strong>{message.role === 'agent' ? t('Агент', 'Agent') : t('Вы', 'You')}</strong>
                        · {relativeTime(message.createdAt)}
                    </div>
                    <div class="md"><Markdown source={message.text} /></div>
                </div>
            {/each}
        </div>
    {/if}
    <textarea
        bind:value={question}
        rows={3}
        placeholder={t('Например: подробнее про задачу, риски или это место в коде…', 'For example: explain the task, risks or this part of the code…')}
        aria-label={t('Вопрос агенту', 'Question to the agent')}
        disabled={sending || review.readOnly}
    ></textarea>
    <div class="row end" style="margin-top: 8px">
        <span class="muted small">
            {review.readOnly
                ? t('Ревью read-only: отправка вопросов отключена.', 'The review is read-only: sending questions is disabled.')
                : t('Ответ появится здесь после следующего прохода агента.', 'The answer appears here after the agent’s next pass.')}
        </span>
        <button class="btn primary" type="button" disabled={!question.trim() || sending || review.readOnly} onclick={() => void askAgent()}>
            {sending ? t('Отправка…', 'Sending…') : t('Отправить агенту', 'Send to agent')}
        </button>
    </div>
</section>
{/if}

{#if versions.length && !app.preview}
    <section class="card">
        <div class="card-head">
            <div class="card-title">{t('История версий', 'Version history')}</div>
        </div>
        {#each versions.slice(0, 8) as version (version.id)}
            <div class="row" style="margin-top: 6px">
                <span class="mono small">#{version.id} · {version.headSha.slice(0, 10) || '—'}</span>
                <span class="muted small">{relativeTime(version.createdAt)}</span>
                <span class="muted small">+{version.additions} −{version.deletions} · {version.findings} {t('замечаний', 'findings')}</span>
            </div>
        {/each}
    </section>
{/if}

{#if review.groups.length}
    <section class="card">
        <div class="card-head">
            <div class="card-title">{t('Группы изменений', 'Change groups')}</div>
        </div>
        <div class="row" style="margin-top: 8px">
            {#each review.groups as group (group.id)}
                <span class="badge" title={group.files.join(', ')}>{group.title} · {group.files.length} {t('файл(ов)', 'file(s)')} · +{group.additions} −{group.deletions}</span>
            {/each}
        </div>
    </section>
{/if}

{#if !app.preview}
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
        {#if review.summary.coverage?.length}
            <div class="section-title">{t('Что проверено', 'What was checked')}</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.coverage as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
        {#if review.summary.unknowns?.length}
            <div class="section-title">{t('Что не проверено', 'Not checked')}</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.unknowns as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
        {#if review.summary.duplicates?.length}
            <div class="section-title">{t('Не добавлены как дубли', 'Skipped as duplicates')}</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.duplicates as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
        {#if review.summary.ruleCandidates?.length}
            <div class="section-title">{t('Кандидаты в правила', 'Rule candidates')}</div>
            <ul style="margin: 0; padding-left: 18px">
                {#each review.summary.ruleCandidates as item}<li><Markdown source={item} /></li>{/each}
            </ul>
        {/if}
        {#if !review.summary.coverage?.length}
            <div class="alert" style="margin-top: 10px; margin-bottom: 0">
                {t(
                    'Покрытие не указано. Пока агент не запишет coverage (что проверено) и unknowns (что не проверено), «замечаний нет» не означает «проверено».',
                    'Coverage is missing. Until the agent records coverage (what was checked) and unknowns (what was not), “no findings” does not mean “checked”.',
                )}
            </div>
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
{/if}

{#if !app.preview}
<div class="section-title">{t('Замечания по уровням', 'Findings by level')}</div>
<div class="row">
    <span class="badge blocker">blocker · {levels.blocker}</span>
    <span class="badge major">major · {levels.major}</span>
    <span class="badge minor">minor · {levels.minor}</span>
    <span class="badge question">question · {levels.question}</span>
    <button class="btn" onclick={() => setTab('findings')}>{t('Разобрать', 'Triage')}</button>
</div>
{/if}

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
                {#if !app.preview}<button class="btn" onclick={() => focusThread(thread.id)}>{t('Ответить', 'Reply')}</button>{/if}
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
