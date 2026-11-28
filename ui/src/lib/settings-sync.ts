import { rpc } from './api';

/**
 * Настройки UI хранит демон, а не localStorage: порт обычно переиспользуется,
 * но может смениться (занят, --port, смена хоста), а значит origin и localStorage
 * после перезапуска могут оказаться другими.
 * localStorage остаётся кешем для мгновенной отрисовки.
 */
let queue: Record<string, unknown> = {};
let timer: ReturnType<typeof setTimeout> | undefined;

/** Запомнить изменение; запись уходит пачкой через 300 мс. */
export function rememberSetting(key: string, value: unknown): void {
    queue[key] = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushSettings, 300);
}

/** Отправить накопленные изменения немедленно. */
export function flushSettings(): void {
    if (timer) {
        clearTimeout(timer);
        timer = undefined;
    }
    const patch = queue;
    queue = {};
    if (!Object.keys(patch).length) return;
    void rpc<{ settings: Record<string, unknown> }>('settings.put', { patch }).catch(() => {
        // Демон остановлен или старее клиента: остаётся localStorage-кеш.
    });
}

/** Настройки с демона; null — демон недоступен, работаем на значениях по умолчанию. */
export async function loadServerSettings(): Promise<Record<string, unknown> | null> {
    try {
        const result = await rpc<{ settings: Record<string, unknown> }>('settings.get');
        return result.settings ?? {};
    } catch {
        return null;
    }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSettings);
