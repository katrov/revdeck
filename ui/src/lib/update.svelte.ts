import { getUpdate } from './api';
import { errorText, notify } from './state.svelte';
import { t } from './i18n.svelte';
import type { UpdateInfo } from './types';

const DISMISSED_KEY = 'revdeck.update.dismissedVersion';

function storedDismissed(): string | null {
    try {
        return localStorage.getItem(DISMISSED_KEY);
    } catch {
        return null;
    }
}

export const update = $state<{ info: UpdateInfo | null; loading: boolean; dismissedVersion: string | null }>({
    info: null,
    loading: false,
    dismissedVersion: storedDismissed(),
});

let started = false;
let requestId = 0;

/** Один автоматический запрос за сессию; ручная проверка — из настроек. */
export function initUpdateCheck(): void {
    if (started) return;
    started = true;
    void checkForUpdates();
}

export function updateBannerVisible(): boolean {
    const info = update.info;
    return Boolean(info?.updateAvailable && info.latest && info.latest !== update.dismissedVersion);
}

export function dismissUpdate(): void {
    const latest = update.info?.latest;
    if (!latest) return;
    update.dismissedVersion = latest;
    try {
        localStorage.setItem(DISMISSED_KEY, latest);
    } catch {
        // localStorage может быть недоступен.
    }
}

export async function checkForUpdates(options: { force?: boolean; announce?: boolean } = {}): Promise<void> {
    const request = ++requestId;
    update.loading = true;
    try {
        const data = await getUpdate(options.force === true);
        if (request !== requestId) return;
        update.info = data.update;
        if (!options.announce) return;
        if (data.update.error) notify(data.update.error, 'error');
        else if (data.update.updateAvailable && data.update.latest) {
            notify(t(`Доступна revdeck ${data.update.latest}`, `revdeck ${data.update.latest} is available`), 'info');
        } else if (!data.update.enabled) {
            notify(t('Проверка обновлений отключена', 'Update checks are disabled'), 'info');
        } else {
            notify(t('Обновлений нет', 'No updates available'), 'ok');
        }
    } catch (error) {
        if (request !== requestId) return;
        if (options.announce) notify(errorText(error), 'error');
    } finally {
        if (request === requestId) update.loading = false;
    }
}
