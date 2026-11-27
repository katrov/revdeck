<script lang="ts">
    import { app, errorText, focusLine, focusNote, focusThread, notify, relativeTime, setTab } from '../lib/state.svelte';
    import { addAgentMessage, getCodeowners, getReadiness, getVersions } from '../lib/api';
    import { plainText, truncate } from '../lib/format';
    import { plural, t } from '../lib/i18n.svelte';
import type { CodeownersInfo, ReviewReadiness } from '../lib/types';
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
    let readiness = $state<ReviewReadiness | null>(null);
    let readinessLoading = $state(false);
    let codeowners = $state<CodeownersInfo | null>(null);
    let reviewedHead = $state<string | null>(null);

    const newCommits = $derived(Boolean(reviewedHead && review.info.commit.head && reviewedHead !== review.info.commit.head));
    const staleFindings = $derived(review.findings.filter((finding) => finding.status === 'stale').length);

    function markReviewed(): void {
        const head = review.info.commit.head;
        if (!head) return;
        reviewedHead = head;
        try {
            localStorage.setItem(`revdeck.reviewedHead.${review.id}`, head);
        } catch {
            // localStorage может быть недоступен.
        }
        notify(t('Версия отмечена как просмотренная', 'Version marked as reviewed'), 'ok');
    }

    async function loadCodeowners(): Promise<void> {
        try {
            codeowners = (await getCodeowners(review.id)).codeowners;
        } catch {
            codeowners = null;
        }
    }

    async function loadReadiness(force = false): Promise<void> {
        if (readinessLoading) return;
        readinessLoading = true;
        try {
            const result = await getReadiness(review.id, force);
            readiness = result.readiness;
        } catch {
            // Панель готовности не должна ломать Overview; ошибка видна в самой карточке.
            readiness = { checks: [], approvals: null, errors: [t('Не удалось прочитать готовность к мержу.', 'Could not read merge readiness.')], checkedAt: new Date().toISOString() };
        } finally {
            readinessLoading = false;
        }
    }

    const mergeLabel = $derived(
        review.info.merge?.state === 'clean'
            ? t('конфликтов нет', 'no conflicts')
            : review.info.merge?.state === 'conflict'
              ? t('конфликт', 'conflict')
              : review.info.merge?.state === 'behind'
                ? t('ветка отстаёт', 'behind target')
                : t('статус неизвестен', 'unknown'),
    );
    const failedChecks = $derived((readiness?.checks ?? []).filter((check) => check.status === 'failed').length);
    const pendingChecks = $derived((readiness?.checks ?? []).filter((check) => check.status === 'pending').length);
    const readinessState = $derived.by(() => {
        const merge = review.info.merge?.state ?? 'unknown';
        const changes = readiness?.approvals?.changesRequested ?? 0;
        const required = readiness?.approvals?.required ?? null;
        const approved = readiness?.approvals?.approved ?? 0;
        if (merge === 'conflict' || failedChecks > 0 || changes > 0 || (required !== null && approved < required)) return 'blocked';
        if (merge !== 'clean' || pendingChecks > 0 || openThreads.length > 0 || !readiness) return 'attention';
        return 'ready';
    });

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

    $effect(() => {
        review.id;
        void loadReadiness();
        void loadCodeowners();
    });

    $effect(() => {
        try {
            reviewedHead = localStorage.getItem(`revdeck.reviewedHead.${review.id}`);
        } catch {
            reviewedHead = null;
        }
    });

    function publishReview(verdict: 'comment' | 'approve' | 'request_changes'): void {
        app.publishing = { kind: 'review', ids: ['review'], verdict };
    }

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

<section class="card">
    <div class="card-head">
        <div class="card-title">{t('Готовность к мержу', 'Merge readiness')}</div>
        <span class="badge" class:ok={readinessState === 'ready'} class:err={readinessState === 'blocked'}>
            {readinessState === 'ready' ? t('готово', 'ready') : readinessState === 'blocked' ? t('есть блокеры', 'blocked') : t('нужно внимание', 'needs attention')}
        </span>
        <div class="grow"></div>
        <button class="btn icon" type="button" title={t('Обновить готовность', 'Refresh readiness')} aria-label={t('Обновить готовность', 'Refresh readiness')} disabled={readinessLoading} onclick={() => void loadReadiness(true)}>↻</button>
    </div>
    <div class="row readiness-chips">
        <span class="readiness-chip" class:bad={review.info.merge?.state === 'conflict'}>{t('Мерж', 'Merge')}: {mergeLabel}</span>
        <span class="readiness-chip" class:bad={openThreads.length > 0}>{t('Открытые треды', 'Open threads')}: {openThreads.length}</span>
        {#if readiness?.approvals}
            <span class="readiness-chip" class:bad={(readiness.approvals.changesRequested ?? 0) > 0}>
                {t('Approvals', 'Approvals')}: {readiness.approvals.approved}{readiness.approvals.required === null ? '' : ` / ${readiness.approvals.required}`}
                {#if readiness.approvals.changesRequested > 0} · {t('запрошены изменения', 'changes requested')}{/if}
            </span>
        {:else}
            <span class="readiness-chip">{t('Approvals', 'Approvals')}: {t('нет данных', 'no data')}</span>
        {/if}
        {#if readiness?.checks.length}
            <span class="readiness-chip" class:bad={failedChecks > 0}>{t('Checks', 'Checks')}: {readiness.checks.length - failedChecks - pendingChecks}/{readiness.checks.length}</span>
        {:else}
            <span class="readiness-chip">{t('Checks', 'Checks')}: {t('нет данных', 'no data')}</span>
        {/if}
    </div>
    {#if readiness?.checks.length}
        <div class="readiness-checks">
            {#each readiness.checks as check (check.id)}
                <a class="readiness-check {check.status}" href={check.url ?? undefined} target="_blank" rel="noreferrer noopener">
                    <span class="check-dot"></span>
                    <span>{check.name}</span>
                    <span class="muted small">{check.status}</span>
                </a>
            {/each}
        </div>
    {/if}
    {#each readiness?.errors ?? [] as error}
        <p class="muted small" style="margin: 6px 0 0">{error}</p>
    {/each}
</section>

{#if newCommits && !app.preview}
    <div class="alert update-note">
        <strong>{t('Появились новые коммиты', 'New commits since your last review')}</strong>
        <span class="mono small">{reviewedHead?.slice(0, 8)} → {review.info.commit.head.slice(0, 8)}</span>
        {#if staleFindings}<span class="muted small">· {staleFindings} {t('замечаний устарели', 'findings became stale')}</span>{/if}
        <div class="row end" style="margin-top: 8px">
            <button class="btn" type="button" onclick={() => setTab('diff')}>{t('Смотреть diff', 'Open diff')}</button>
            <button class="btn primary" type="button" onclick={markReviewed}>{t('Отметить версию просмотренной', 'Mark this version reviewed')}</button>
        </div>
    </div>
{/if}

{#if codeowners?.matches.length}
    <section class="card">
        <div class="card-head">
            <div class="card-title">{t('Code owners', 'Code owners')}</div>
            {#if codeowners.path}<span class="muted small mono">{codeowners.path}</span>{/if}
        </div>
        <div class="stack" style="margin-top: 8px">
            {#each codeowners.matches as match (match.file)}
                <div class="row" style="gap: 8px">
                    <button class="path-link mono small" type="button" onclick={() => focusLine(match.file, null)}>{match.file}</button>
                    <div style="flex: 1"></div>
                    {#each match.owners as owner (owner)}<span class="badge">{owner}</span>{/each}
                </div>
            {/each}
        </div>
    </section>
{/if}

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
        {#if !app.preview && !review.readOnly}
            <div class="row end" style="margin-top: 12px">
                <span class="muted small">{t('Опубликовать выжимку в платформу:', 'Publish this summary to the platform:')}</span>
                <button class="btn" type="button" onclick={() => publishReview('comment')}>{t('Комментарием', 'As a comment')}</button>
                <button class="btn" type="button" onclick={() => publishReview('request_changes')}>{t('Запросить изменения', 'Request changes')}</button>
                <button class="btn primary" type="button" onclick={() => publishReview('approve')}>{t('Одобрить', 'Approve')}</button>
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
