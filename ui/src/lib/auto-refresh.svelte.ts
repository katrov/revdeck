import { rememberSetting } from './settings-sync';

export const AUTO_REFRESH_KEY = 'revdeck.autoRefreshMinutes';
const LEGACY_SECONDS_KEY = 'revdeck.autoRefreshSeconds';
/** Минуты; 0 — автообновление выключено. */
export const AUTO_REFRESH_CHOICES = [0, 10, 30, 60] as const;
const DEFAULT_MINUTES = 10;

export const autoRefresh = $state({ minutes: DEFAULT_MINUTES });

/** Применить значение без записи на сервер: для загрузки сохранённых настроек. */
export function applyAutoRefreshMinutes(minutes: number): void {
    const next = (AUTO_REFRESH_CHOICES as readonly number[]).includes(minutes) ? minutes : 0;
    autoRefresh.minutes = next;
    try {
        localStorage.setItem(AUTO_REFRESH_KEY, String(next));
    } catch {
        // localStorage может быть недоступен.
    }
}

export function setAutoRefreshMinutes(minutes: number): void {
    applyAutoRefreshMinutes(minutes);
    rememberSetting('autoRefreshMinutes', autoRefresh.minutes);
}

export function initAutoRefresh(): void {
    let minutes = DEFAULT_MINUTES;
    try {
        const raw = localStorage.getItem(AUTO_REFRESH_KEY);
        const stored = raw === null ? Number.NaN : Number(raw);
        if ((AUTO_REFRESH_CHOICES as readonly number[]).includes(stored)) {
            minutes = stored;
        } else {
            // В короткой версии шкала была в секундах: 10/30/60 с не совпадают
            // с новыми 10/30/60 минутами. Явное «Выкл» сохраняем, остальное
            // откатываем на дефолт.
            const legacyRaw = localStorage.getItem(LEGACY_SECONDS_KEY);
            const legacy = legacyRaw === null ? Number.NaN : Number(legacyRaw);
            if (Number.isFinite(legacy) && legacy === 0) minutes = 0;
            localStorage.removeItem(LEGACY_SECONDS_KEY);
        }
    } catch {
        // localStorage может быть недоступен.
    }
    applyAutoRefreshMinutes(minutes);
}
