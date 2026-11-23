<script lang="ts">
    import { app, setFeaturesHidden, showHelp } from '../lib/state.svelte';
    import { i18n, setLocale, t } from '../lib/i18n.svelte';
    import { setTheme, theme, type ThemeMode } from '../lib/theme.svelte';

    const themes: { id: ThemeMode; label: string; icon: string }[] = [
        { id: 'auto', label: 'Auto', icon: '◐' },
        { id: 'light', label: 'Light', icon: '☀' },
        { id: 'dark', label: 'Dark', icon: '☾' },
    ];
</script>

<div class="settings">
    <h1>{t('Настройки', 'Settings')}</h1>
    <p class="muted small">{t('Интерфейс, язык и разделы revdeck.', 'Interface, language and revdeck sections.')}</p>

    <section class="card">
        <div class="card-title">{t('Тема', 'Theme')}</div>
        <p class="muted small">{t('Как в системе или принудительно светлая/тёмная.', 'Follow the system or force light/dark.')}</p>
        <div class="settings-segment">
            {#each themes as item (item.id)}
                <button class="btn" class:primary={theme.mode === item.id} type="button" onclick={() => setTheme(item.id)}>
                    {item.icon} {t(item.id === 'auto' ? 'Авто' : item.id === 'light' ? 'Светлая' : 'Тёмная', item.label)}
                </button>
            {/each}
        </div>
    </section>

    <section class="card">
        <div class="card-title">{t('Язык интерфейса', 'Interface language')}</div>
        <p class="muted small">{t('Язык подписей revdeck; язык ревью задаётся отдельно.', 'Language of revdeck UI; review output has its own setting.')}</p>
        <div class="settings-segment">
            <button class="btn" class:primary={i18n.locale === 'ru'} type="button" onclick={() => setLocale('ru')}>Русский</button>
            <button class="btn" class:primary={i18n.locale === 'en'} type="button" onclick={() => setLocale('en')}>English</button>
        </div>
    </section>

    <section class="card">
        <div class="card-title">{t('Разделы', 'Sections')}</div>
        <label class="settings-toggle">
            <input type="checkbox" checked={!app.featuresHidden} onchange={(event) => setFeaturesHidden(!event.currentTarget.checked)} />
            <span>
                <strong>{t('Показывать «Фичи» в сайдбаре', 'Show “Features” in the sidebar')}</strong>
                <span class="muted small">{t('Если скрыть, раздел не занимает место; открыть его можно здесь.', 'When hidden it takes no sidebar space; you can restore it here.')}</span>
            </span>
        </label>
    </section>

    <section class="card">
        <div class="card-title">{t('Справка', 'Help')}</div>
        <p class="muted small">{t('Команды CLI, горячие клавиши и сценарии.', 'CLI commands, shortcuts and scenarios.')}</p>
        <button class="btn" type="button" onclick={() => showHelp()}>{t('Открыть справку', 'Open command reference')}</button>
    </section>
</div>
