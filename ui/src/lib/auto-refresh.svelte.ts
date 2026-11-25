export const AUTO_REFRESH_KEY = 'revdeck.autoRefreshSeconds';
const LEGACY_KEY = 'revdeck.autoRefreshMinutes';
/** Секунды; 0 — автообновление выключено. */
export const AUTO_REFRESH_CHOICES = [0, 10, 30, 60] as const;
const DEFAULT_SECONDS = 30;

export const autoRefresh = $state({ seconds: DEFAULT_SECONDS });

export function setAutoRefreshSeconds(seconds: number): void {
    const next = (AUTO_REFRESH_CHOICES as readonly number[]).includes(seconds) ? seconds : 0;
    autoRefresh.seconds = next;
    try {
        localStorage.setItem(AUTO_REFRESH_KEY, String(next));
    } catch {
        // localStorage может быть недоступен.
    }
}

export function initAutoRefresh(): void {
    let seconds = DEFAULT_SECONDS;
    try {
        const raw = localStorage.getItem(AUTO_REFRESH_KEY);
        const stored = raw === null ? Number.NaN : Number(raw);
        if ((AUTO_REFRESH_CHOICES as readonly number[]).includes(stored)) {
            seconds = stored;
        } else {
            // Старую шкалу в минутах не переносим: 1/5/15 минут не совпадают
            // с новыми 10/30/60 секундами. Явное «Выкл» сохраняем.
            const legacy = Number(localStorage.getItem(LEGACY_KEY));
            if (localStorage.getItem(LEGACY_KEY) !== null && legacy === 0) seconds = 0;
            localStorage.removeItem(LEGACY_KEY);
        }
    } catch {
        // localStorage может быть недоступен.
    }
    autoRefresh.seconds = seconds;
}
