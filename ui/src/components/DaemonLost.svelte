<script lang="ts">
    import { onMount } from 'svelte';
    import { t } from '../lib/i18n.svelte';
    import { notify, retryDaemonConnection, type DaemonLostKind } from '../lib/state.svelte';
    import { copyToClipboard } from '../lib/clipboard';

    let { kind }: { kind: DaemonLostKind } = $props();

    let copied = $state(false);
    let copyTimer: ReturnType<typeof setTimeout> | null = null;
    let retryButton = $state<HTMLButtonElement | null>(null);
    const command = 'revdeck daemon start && revdeck ui --open';

    onMount(() => {
        // Экран модальный: фокус должен оказаться в нём, а не в inert-оболочке.
        retryButton?.focus();
    });

    function trapFocus(event: KeyboardEvent): void {
        if (event.key !== 'Tab') return;
        const root = event.currentTarget as HTMLElement;
        const nodes = [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
            (node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0,
        );
        if (!nodes.length) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    async function copy(): Promise<void> {
        if (!(await copyToClipboard(command))) {
            notify(t('Не удалось скопировать команду', 'Could not copy the command'), 'error');
            return;
        }
        copied = true;
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
            copied = false;
            copyTimer = null;
        }, 1800);
    }
</script>

<div class="lost-screen" role="alertdialog" aria-modal="true" aria-labelledby="lost-title" tabindex="-1" onkeydown={trapFocus}>
    <div class="lost-card">
        <div class="lost-brand">
            <img src="/favicon.svg" alt="" aria-hidden="true" /> revdeck
            <span class="lost-chip">{t('локальный демон', 'local daemon')}</span>
        </div>
        <div class="lost-pill" class:ok={kind === 'expired'}>
            <span class="lost-dot" aria-hidden="true"></span>
            {kind === 'expired' ? t('демон работает', 'daemon is running') : t('нет связи', 'offline')}
        </div>
        <h1 id="lost-title">{kind === 'expired' ? t('Сессия демона устарела', 'The daemon session expired') : t('Связь с демоном потеряна', 'Lost connection to the daemon')}</h1>
        <p class="lost-lead">
            {#if kind === 'expired'}
                {t(
                    'Демон работает, но эта вкладка больше не авторизована: launch-токен меняется при каждом перезапуске. Откройте свежую ссылку — и страница восстановится сама.',
                    'The daemon is running, but this tab is no longer authorized: the launch token rotates on every restart. Open a fresh link and this page will recover by itself.',
                )}
            {:else}
                {t(
                    'Демон остановлен, перезапущен или сменил порт — эта вкладка подключена к прежнему адресу. Запустите демон и откройте новую ссылку.',
                    'The daemon was stopped, restarted or moved to another port, so this tab still points at the old address. Start the daemon and open a fresh link.',
                )}
            {/if}
        </p>
        <div class="lost-command">
            <code>{command}</code>
            <button class="btn" type="button" onclick={() => void copy()}>{copied ? t('Скопировано', 'Copied') : t('Копировать', 'Copy')}</button>
        </div>
        <p class="lost-hint">{t('Команда запустит демон, если он остановлен, и откроет интерфейс в браузере.', 'The command starts the daemon if needed and opens the interface in your browser.')}</p>
        <div class="lost-actions">
            <button class="btn primary" type="button" bind:this={retryButton} onclick={() => void retryDaemonConnection()}>{t('Проверить снова', 'Check again')}</button>
            <span class="lost-hint">{t('Вкладка переподключится автоматически.', 'This tab reconnects automatically.')}</span>
        </div>
        <div class="lost-foot">
            <span>{t('адрес этой вкладки', 'this tab')}: <span class="mono">{typeof location === 'undefined' ? '' : location.origin}</span></span>
            <span>{t('данные не покидают хост', 'data stays on this host')}</span>
        </div>
    </div>
</div>
