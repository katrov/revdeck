<script lang="ts">
    import { app, errorText } from '../lib/state.svelte';
    import { getRules } from '../lib/api';
    import { t } from '../lib/i18n.svelte';
    import Markdown from './Markdown.svelte';

    let loading = $state(true);
    let error = $state('');
    let rules = $state<{ markdown: string; configPath: string | null; warnings: string[]; checks: { id: string; name: string; argv: string[]; consent: boolean; matched: boolean }[] } | null>(null);

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
                    </tr>
                </thead>
                <tbody>
                    {#each rules.checks as check (check.id)}
                        <tr>
                            <td style="padding: 4px 6px" class="mono">{check.id}</td>
                            <td style="padding: 4px 6px" class="mono small">{check.argv.join(' ')}</td>
                            <td style="padding: 4px 6px">{check.matched ? t('да', 'yes') : t('нет', 'no')}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
            <p class="muted small">{t('Запуск проверок — только вручную:', 'Checks run only manually:')} <span class="mono">revdeck checks &lt;N&gt; --run --yes</span>.</p>
        </section>
    {/if}
{/if}
