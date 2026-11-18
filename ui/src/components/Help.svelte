<script lang="ts">
    import { COMMAND_GROUPS, GLOBAL_FLAGS, SHORTCUTS } from '../lib/commands';
    import { i18n, t } from '../lib/i18n.svelte';
    import { notify, showProjectsHome } from '../lib/state.svelte';

    let query = $state('');

    const filtered = $derived(
        COMMAND_GROUPS.map((group) => ({
            ...group,
            commands: group.commands.filter((command) => {
                const q = query.trim().toLowerCase();
                if (!q) return true;
                return `${command.usage} ${command.ru} ${command.en} ${command.example ?? ''}`.toLowerCase().includes(q);
            }),
        })).filter((group) => group.commands.length),
    );

    function label(item: { ru: string; en: string }): string {
        return i18n.locale === 'ru' ? item.ru : item.en;
    }

    function copy(text: string): void {
        void navigator.clipboard?.writeText(text).then(
            () => notify(t('Команда скопирована', 'Command copied'), 'ok'),
            () => notify(t('Не удалось скопировать', 'Could not copy'), 'error'),
        );
    }
</script>

<section class="help-page">
    <header class="projects-home-head">
        <div>
            <h1>{t('Справка по командам', 'Command reference')}</h1>
            <p class="muted">
                {t(
                    'Все команды revdeck для терминала. Клик по команде копирует её. Агент получает те же возможности через MCP.',
                    'Every revdeck terminal command. Click a command to copy it. Agents get the same capabilities through MCP.',
                )}
            </p>
        </div>
        <button class="btn" type="button" onclick={() => showProjectsHome()}>{t('К проектам', 'Projects')}</button>
    </header>

    <label class="help-search">
        <span aria-hidden="true">⌕</span>
        <input bind:value={query} placeholder={t('Найти команду или флаг…', 'Find a command or flag…')} autocomplete="off" />
    </label>

    {#each filtered as group (group.id)}
        <section class="help-group">
            <h2>{label(group)}</h2>
            <div class="help-commands">
                {#each group.commands as command (command.id)}
                    <article class="help-command">
                        <div class="help-command-head">
                            <button class="help-usage" type="button" onclick={() => copy(command.usage)} title={t('Скопировать команду', 'Copy command')}>
                                <code>{command.usage}</code>
                                <span class="help-copy">⧉</span>
                            </button>
                        </div>
                        <p>{label(command)}</p>
                        {#if command.example}
                            <button class="help-example" type="button" onclick={() => copy(command.example!)} title={t('Скопировать пример', 'Copy example')}>
                                <span class="mono">{command.example}</span>
                            </button>
                        {/if}
                    </article>
                {/each}
            </div>
        </section>
    {:else}
        <p class="muted">{t('Ничего не найдено.', 'Nothing found.')}</p>
    {/each}

    <section class="help-group">
        <h2>{t('Общие флаги', 'Common flags')}</h2>
        <div class="help-chips">
            {#each GLOBAL_FLAGS as flag (flag.flag)}
                <span class="help-chip"><code>{flag.flag}</code> {label(flag)}</span>
            {/each}
        </div>
    </section>

    <section class="help-group">
        <h2>{t('Горячие клавиши интерфейса', 'UI shortcuts')}</h2>
        <div class="help-chips">
            {#each SHORTCUTS as shortcut (shortcut.keys)}
                <span class="help-chip"><kbd>{shortcut.keys}</kbd> {label(shortcut)}</span>
            {/each}
        </div>
    </section>
</section>
