export const AUTO_REFRESH_KEY = 'revdeck.autoRefreshMinutes';
export const AUTO_REFRESH_CHOICES = [0, 1, 5, 15] as const;

/** 0 — автообновление выключено; иначе период в минутах для открытого ревью/preview. */
export const autoRefresh = $state({ minutes: 5 as number });

export function setAutoRefreshMinutes(minutes: number): void {
    const next = (AUTO_REFRESH_CHOICES as readonly number[]).includes(minutes) ? minutes : 0;
    autoRefresh.minutes = next;
    try {
        localStorage.setItem(AUTO_REFRESH_KEY, String(next));
    } catch {
        // localStorage может быть недоступен.
    }
}

export function initAutoRefresh(): void {
    let minutes = 5;
    try {
        const stored = Number(localStorage.getItem(AUTO_REFRESH_KEY));
        if ((AUTO_REFRESH_CHOICES as readonly number[]).includes(stored)) minutes = stored;
    } catch {
        // localStorage может быть недоступен.
    }
    autoRefresh.minutes = minutes;
}
