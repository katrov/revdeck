<script lang="ts">
    import { onMount } from 'svelte';
    import { getAuthStatus, loginAuth } from '../lib/api';
    import type { AuthState, Platform } from '../lib/types';
    import { app, errorText, notify, relativeTime, setFeaturesHidden, showHelp } from '../lib/state.svelte';
    import { i18n, setLocale, t } from '../lib/i18n.svelte';
    import { setTheme, theme, type ThemeMode } from '../lib/theme.svelte';
    import { AUTO_REFRESH_CHOICES, autoRefresh, setAutoRefreshMinutes } from '../lib/auto-refresh.svelte';
    import { checkForUpdates, update } from '../lib/update.svelte';
    import { notifications, setNotificationsEnabled } from '../lib/notifications.svelte';

    const themes: { id: ThemeMode; label: string; icon: string }[] = [
        { id: 'auto', label: 'Auto', icon: '◐' },
        { id: 'light', label: 'Light', icon: '☀' },
        { id: 'dark', label: 'Dark', icon: '☾' },
    ];

    // Токен уходит демону и дальше в stdin glab/gh: в браузере и в состоянии UI его нет.
    let authHosts = $state<AuthState[]>([]);
    let authLoaded = $state(false);
    let authLoading = $state(false);
    let authError = $state('');
    let authPlatform = $state<Platform>('gitlab');
    let authHost = $state('');
    let authToken = $state('');
    let authSaving = $state(false);
    let authChecking = $state(false);

    // Проверка запускается только с loopback: иначе токен поедет по сети без TLS.
    const loopback = typeof location === 'undefined' || ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
    const targets = $derived(projectTargets());

    function platformLabel(platform: Platform): string {
        return platform === 'gitlab' ? 'GitLab' : 'GitHub';
    }

    function mergeAuth(next: AuthState): void {
        const rest = authHosts.filter((item) => item.platform !== next.platform || item.host !== next.host);
        authHosts = [...rest, next].sort((left, right) => {
            if (left.authenticated !== right.authenticated) return left.authenticated ? -1 : 1;
            return `${left.platform}:${left.host}`.localeCompare(`${right.platform}:${right.host}`);
        });
    }

    function projectTargets(): { platform: Platform; host: string }[] {
        const seen = new Map<string, { platform: Platform; host: string }>();
        for (const project of app.projects) seen.set(`${project.platform}:${project.host}`, { platform: project.platform, host: project.host });
        return [...seen.values()];
    }

    async function loadAuth(): Promise<void> {
        authLoading = true;
        try {
            const result = await getAuthStatus();
            authHosts = result.hosts.sort((left, right) => {
                if (left.authenticated !== right.authenticated) return left.authenticated ? -1 : 1;
                return `${left.platform}:${left.host}`.localeCompare(`${right.platform}:${right.host}`);
            });
            authError = '';
        } catch (cause) {
            authError = errorText(cause);
        } finally {
            authLoading = false;
            authLoaded = true;
        }
    }

    function suggestTarget(): void {
        const active = app.projects.find((project) => project.key === app.activeProject);
        const target = active ?? app.projects[0];
        authPlatform = target?.platform ?? 'gitlab';
        authHost = target?.host ?? 'gitlab.com';
    }

    async function checkHost(platform: Platform, host: string): Promise<void> {
        if (!host.trim()) {
            authError = t('Укажите хост платформы', 'Enter the platform host');
            return;
        }
        authChecking = true;
        authError = '';
        try {
            const result = await getAuthStatus({ platform, host: host.trim() });
            for (const state of result.hosts) mergeAuth(state);
        } catch (cause) {
            authError = errorText(cause);
        } finally {
            authChecking = false;
        }
    }

    async function submitAuth(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        if (authSaving) return;
        const host = authHost.trim();
        const token = authToken.trim();
        if (!host) {
            authError = t('Укажите хост платформы', 'Enter the platform host');
            return;
        }
        if (!token) {
            authError = t('Вставьте токен доступа', 'Paste an access token');
            return;
        }
        authSaving = true;
        authError = '';
        try {
            const result = await loginAuth(authPlatform, host, token);
            authToken = '';
            mergeAuth(result.host);
            if (result.host.authenticated) {
                notify(
                    t(
                        `Доступ к ${platformLabel(result.host.platform)} настроен: ${result.host.account ?? result.host.host}`,
                        `${platformLabel(result.host.platform)} access is set up: ${result.host.account ?? result.host.host}`,
                    ),
                    'ok',
                );
            } else {
                authError = result.host.error ?? result.host.hint ?? t('Токен сохранён, но доступ не подтверждён', 'The token was saved but access is not confirmed');
            }
        } catch (cause) {
            authError = errorText(cause);
        } finally {
            authSaving = false;
        }
    }

    onMount(() => {
        suggestTarget();
        void loadAuth();
    });

    function copyUpdateCommand(): void {
        void navigator.clipboard?.writeText('npm install -g revdeck@latest').then(
            () => notify(t('Команда скопирована', 'Command copied'), 'ok'),
            () => notify(t('Не удалось скопировать', 'Could not copy'), 'error'),
        );
    }
</script>

<div class="settings">
    <h1>{t('Настройки', 'Settings')}</h1>
    <p class="muted small">{t('Интерфейс, доступ к платформам и разделы revdeck.', 'Interface, platform access and revdeck sections.')}</p>

    <section class="card">
        <div class="card-title">{t('Доступ к GitLab и GitHub', 'GitLab and GitHub access')}</div>
        <p class="muted small">
            {t(
                'Токен проверяется запросом к платформе и сохраняется в конфигурации glab/gh на хосте: revdeck его не хранит и не показывает. Права: GitLab — api, GitHub — repo и read:org.',
                'The token is checked against the platform and stored in the host glab/gh configuration: revdeck neither keeps nor shows it. Scopes: GitLab — api, GitHub — repo and read:org.',
            )}
        </p>
        {#if !loopback}
            <p class="muted small auth-warning">
                {t(
                    'Страница открыта не с 127.0.0.1: токен пойдёт к демону по сети без TLS. Вводите его только в доверенной сети.',
                    'The page is not served from 127.0.0.1: the token reaches the daemon over the network without TLS. Enter it only on a trusted network.',
                )}
            </p>
        {/if}

        {#if authLoading && !authLoaded}
            <p class="muted small">{t('Проверяю доступ…', 'Checking access…')}</p>
        {:else if authHosts.length}
            <ul class="auth-list">
                {#each authHosts as item (`${item.platform}:${item.host}`)}
                    <li class="auth-row">
                        <div class="auth-ident">
                            <span class="auth-platform">{platformLabel(item.platform)}</span>
                            <span class="mono">{item.host}</span>
                        </div>
                        <span
                            class="auth-badge"
                            class:ok={item.authenticated}
                            class:warn={!item.binary}
                            class:muted={item.binary && !item.authenticated}
                        >
                            {item.binary
                                ? item.authenticated
                                    ? `✓ ${item.account ?? t('есть доступ', 'authenticated')}`
                                    : t('нет доступа', 'not authenticated')
                                : t('CLI не найден', 'CLI not found')}
                        </span>
                        <button
                            class="btn"
                            type="button"
                            disabled={authChecking}
                            onclick={() => void checkHost(item.platform, item.host)}
                        >{t('Проверить', 'Check')}</button>
                        {#if !item.authenticated && (item.error || item.hint)}
                            <div class="auth-detail muted small">
                                {#if item.error}<span class="mono">{item.error}</span>{:else}{item.hint}{/if}
                            </div>
                        {/if}
                    </li>
                {/each}
            </ul>
        {:else}
            <p class="muted small">
                {t('Проектов пока нет: укажите платформу и хост вручную ниже.', 'No projects yet: pick a platform and host below.')}
            </p>
        {/if}

        <form class="auth-form" onsubmit={submitAuth}>
            <label class="field">
                <span>{t('Платформа', 'Platform')}</span>
                <select bind:value={authPlatform}>
                    <option value="gitlab">GitLab</option>
                    <option value="github">GitHub</option>
                </select>
            </label>
            <label class="field">
                <span>{t('Хост', 'Host')}</span>
                <input type="text" bind:value={authHost} placeholder="gitlab.example.com" autocomplete="off" spellcheck="false" list="auth-hosts" />
                <datalist id="auth-hosts">
                    {#each targets as target (`${target.platform}:${target.host}`)}
                        <option value={target.host}>{platformLabel(target.platform)}</option>
                    {/each}
                </datalist>
            </label>
            <label class="field auth-token">
                <span>{t('Токен доступа', 'Access token')}</span>
                <input
                    type="password"
                    bind:value={authToken}
                    placeholder="glpat-… / ghp_…"
                    autocomplete="off"
                    spellcheck="false"
                    disabled={!loopback}
                />
                {#if !loopback}
                    <small class="muted">
                        {t('Ввод отключён: откройте UI по 127.0.0.1.', 'Disabled: open the UI via 127.0.0.1.')}
                    </small>
                {/if}
            </label>
            <div class="row">
                <button class="btn primary" type="submit" disabled={authSaving || !loopback}>
                    {authSaving ? t('Сохраняю…', 'Saving…') : t('Проверить и сохранить', 'Check and save')}
                </button>
                <button class="btn" type="button" disabled={authChecking} onclick={() => void checkHost(authPlatform, authHost)}>
                    {t('Только проверить', 'Check only')}
                </button>
            </div>
        </form>
        {#if authError}
            <p class="auth-error">{authError}</p>
        {/if}
    </section>

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
        <div class="card-title">{t('Автообновление', 'Auto-refresh')}</div>
        <p class="muted small">
            {t(
                'Как часто повторять «Обновить», пока открыто ревью. В фоновой вкладке и во время ввода тик пропускается.',
                'How often to run “Refresh” while a review is open. Ticks are skipped in a background tab and while typing.',
            )}
        </p>
        <div class="settings-segment">
            {#each AUTO_REFRESH_CHOICES as minutes (minutes)}
                <button
                    class="btn"
                    class:primary={autoRefresh.minutes === minutes}
                    type="button"
                    onclick={() => setAutoRefreshMinutes(minutes)}
                >{minutes === 0 ? t('Выкл', 'Off') : `${minutes} ${t('мин', 'min')}`}</button>
            {/each}
        </div>
    </section>

    <section class="card">
        <div class="card-title">{t('Уведомления', 'Notifications')}</div>
        <label class="settings-toggle">
            <input
                type="checkbox"
                checked={notifications.enabled}
                onchange={(event) => void setNotificationsEnabled(event.currentTarget.checked)}
            />
            <span>
                <strong>{t('Новые треды в фоне', 'New threads in the background')}</strong>
                <span class="muted small">{t('Браузерное уведомление, когда вкладка revdeck не активна. Потребуется разрешение браузера.', 'A browser notification while the revdeck tab is in the background. Browser permission is required.')}</span>
            </span>
        </label>
        {#if notifications.permission === 'denied'}
            <p class="muted small">{t('Браузер запретил уведомления для этого адреса. Разрешите их в настройках сайта.', 'The browser blocked notifications for this origin. Allow them in the site settings.')}</p>
        {:else if notifications.permission === 'unsupported'}
            <p class="muted small">{t('Этот браузер не поддерживает Notification API.', 'This browser does not support the Notification API.')}</p>
        {/if}
    </section>

    <section class="card">
        <div class="card-title">{t('О программе', 'About')}</div>
        <div class="spread" style="gap: 12px; flex-wrap: wrap">
            <span>
                <span class="mono">revdeck v{update.info?.current ?? '—'}</span>
                {#if update.info?.checkedAt}
                    <span class="muted small">· {t('проверено', 'checked')} {relativeTime(update.info.checkedAt)}</span>
                {/if}
            </span>
            <button
                class="btn"
                type="button"
                disabled={update.loading}
                onclick={() => void checkForUpdates({ force: true, announce: true })}
            >{update.loading ? t('Проверяю…', 'Checking…') : t('Проверить обновления', 'Check for updates')}</button>
        </div>
        {#if update.info?.updateAvailable && update.info.latest}
            <div class="update-callout">
                <strong>{t(`Доступна версия ${update.info.latest}`, `Version ${update.info.latest} is available`)}</strong>
                <p class="muted small">{t('Обновите глобальный пакет и перезапустите демон.', 'Update the global package and restart the daemon.')}</p>
                <div class="row">
                    <code class="update-command">npm install -g revdeck@latest</code>
                    <button class="btn icon" type="button" title={t('Скопировать команду', 'Copy command')} aria-label={t('Скопировать команду', 'Copy command')} onclick={copyUpdateCommand}>⧉</button>
                    {#if update.info.releaseUrl}
                        <a class="btn" href={update.info.releaseUrl} target="_blank" rel="noreferrer noopener">{t('Что нового', "What's new")}</a>
                    {/if}
                </div>
            </div>
        {:else if update.info?.checkedAt}
            <p class="muted small">{t('Обновлений нет.', 'No updates available.')}</p>
        {/if}
        {#if update.info && !update.info.enabled}
            <p class="muted small">
                {t('Проверка обновлений отключена (REVDECK_UPDATE_CHECK=0).', 'Update checks are disabled (REVDECK_UPDATE_CHECK=0).')}
            </p>
        {/if}
        {#if update.info?.error}
            <p class="muted small">{update.info.error}</p>
        {/if}
    </section>

    <section class="card">
        <div class="card-title">{t('Справка', 'Help')}</div>
        <p class="muted small">{t('Команды CLI, горячие клавиши и сценарии.', 'CLI commands, shortcuts and scenarios.')}</p>
        <button class="btn" type="button" onclick={() => showHelp()}>{t('Открыть справку', 'Open command reference')}</button>
    </section>
</div>
