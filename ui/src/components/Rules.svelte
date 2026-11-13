<script lang="ts">
    import { app, errorText, notify } from '../lib/state.svelte';
    import { getRules, getSecrets, runChecks } from '../lib/api';
    import { t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';

    let loading = $state(true);
    let error = $state('');
    let rules = $state<{ markdown: string; configPath: string | null; warnings: string[]; checks: { id: string; name: string; argv: string[]; consent: boolean; matched: boolean }[] } | null>(null);
    let checkResults = $state<Record<string, { status: string; output: string; durationMs: number }>>({});
    let checkBusy = $state<string | null>(null);
    let secrets = $state<{ enabled: boolean; scan: string; findings: { rule: string; title: string; file: string; line: number; preview: string }[] } | null>(null);

    $effect(() => {
        const id = app.review?.id;
        if (!id) return;
        void getSecrets(id).then((result) => (secrets = result)).catch(() => undefined);
    });

    async function runCheck(id?: string): Promise<void> {
        const review = app.review;
        if (!review || review.readOnly) return;
        const ids = id ? [id] : rules?.checks.filter((check) => check.matched).map((check) => check.id);
        if (!ids?.length) return;
        if (!confirm(t(`Запустить проверки: ${ids.join(', ')}?`, `Run checks: ${ids.join(', ')}?`))) return;
        checkBusy = id ?? '*';
        try {
            const { results } = await runChecks(review.id, ids);
            for (const result of results) checkResults[result.id] = result;
            const failed = results.filter((result) => result.status !== 'passed' && result.status !== 'skipped');
            notify(failed.length ? t(`Проверки: ${failed.length} с ошибками`, `Checks: ${failed.length} failed`) : t('Проверки прошли', 'Checks passed'), failed.length ? 'error' : 'ok');
        } catch (cause) {
            notify(errorText(cause), 'error');
        } finally {
            checkBusy = null;
        }
    }

    $effect(() => {
        const id = app.review?.id;
        if (!id) return;
        loading = true;
        error = '';
        void getRules(id)
            .then((data) => {
                rules = data.rules;
            })
            .catch((cause) => {
                error = errorText(cause);
            })
            .finally(() => {
                loading = false;
            });
    });
</script>

{#if loading}
    <p class="muted">{t('Загрузка правил…', 'Loading rules…')}</p>
{:else if error}
    <div class="alert error">{error}</div>
{:else if rules}
    {#if rules.warnings.length}
        <div class="alert">
            <strong>{t('Что не нашлось', 'What was not found')}</strong>
            <ul style="margin: 6px 0 0; padding-left: 18px">
                {#each rules.warnings as warning}<li>{warning}</li>{/each}
            </ul>
        </div>

{/if}
    <section class="card flat">
        <div class="spread">
            <div class="card-title">{t('Правила проекта', 'Project rules')}</div>
            <span class="muted small mono">{rules.configPath ?? t('автообнаружение', 'auto-discovery')}</span>
        </div>
        <p class="muted small" style="margin: 4px 0 0">
            {t('Для каждого изменённого пути выбраны документы и конкретные секции. Это единственный источник правил: общие best practices без опоры на документ репозитория не применяются.', 'For every changed path revdeck selected documents and exact sections. This is the only source of rules: generic best practices without a repository document are not applied.')}
        </p>
    </section>
    <section class="card">
        <div class="md"><Markdown source={rules.markdown} /></div>
    </section>
    {#if rules.checks.length}
        <section class="card">
            <div class="card-title">{t('Проверки', 'Checks')}</div>
            <table style="width: 100%; border-collapse: collapse; margin-top: 8px">
                <thead>
                    <tr class="muted small" style="text-align: left">
                        <th style="padding: 4px 6px">id</th>
                        <th style="padding: 4px 6px">{t('команда', 'command')}</th>
                        <th style="padding: 4px 6px">{t('относится к diff', 'matched by diff')}</th>
                        <th style="padding: 4px 6px"></th>
                    </tr>
                </thead>
                <tbody>
                    {#each rules.checks as check (check.id)}
                        <tr>
                            <td style="padding: 4px 6px" class="mono">{check.id}</td>
                            <td style="padding: 4px 6px" class="mono small">{check.argv.join(' ')}</td>
                            <td style="padding: 4px 6px">{check.matched ? t('да', 'yes') : t('нет', 'no')}</td>
                            <td style="padding: 4px 6px">
                                {#if check.matched && !app.review?.readOnly}
                                    <button class="btn icon" type="button" title={t('Запустить проверку', 'Run check')} disabled={checkBusy !== null} onclick={() => void runCheck(check.id)}>▶</button>
                                {/if}
                                {#if checkResults[check.id]}
                                    <span class="badge {checkResults[check.id]!.status === 'passed' ? 'ok' : 'err'}">{checkResults[check.id]!.status}</span>
                                {/if}
                            </td>
                        </tr>
                        {#if checkResults[check.id]?.output}
                            <tr>
                                <td colspan="4" style="padding: 4px 6px">
                                    <pre style="margin: 0; max-height: 220px">{checkResults[check.id]!.output}</pre>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
            <p class="muted small">
                {t('Запуск проверок — только вручную:', 'Checks run only manually:')}
                {#if !app.review?.readOnly}
                    <button class="btn" type="button" disabled={checkBusy !== null} onclick={() => void runCheck()}>{checkBusy === '*' ? t('Запуск…', 'Running…') : t('Запустить подходящие', 'Run matching')}</button>
                {/if}
                <span class="mono">revdeck checks &lt;N&gt; --run --yes</span>.
            </p>
        </section>
    {/if}
    {#if secrets?.enabled}
        <section class="card">
            <div class="card-title">{t('Секреты', 'Secrets')} <span class="badge {secrets.findings.length ? 'err' : 'ok'}">{secrets.findings.length}</span></div>
            <p class="muted small" style="margin: 4px 0 0">{t('Скан:', 'Scan:')} <span class="mono">{secrets.scan}</span> · {t('значения замаскированы', 'values are masked')}</p>
            {#if secrets.findings.length}
                {#each secrets.findings as finding (finding.rule + finding.file + finding.line)}
                    <div class="row" style="margin-top: 6px">
                        <span class="badge err">{finding.rule}</span>
                        <span class="mono small">{finding.file}:{finding.line}</span>
                        <span class="muted small">{finding.preview}</span>
                    </div>
                {/each}
            {:else}
                <p class="muted small" style="margin: 8px 0 0">{t('Секретов не найдено.', 'No secrets found.')}</p>
            {/if}
        </section>
    {/if}
{/if}
