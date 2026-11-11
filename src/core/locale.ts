export type Locale = 'ru' | 'en';

/**
 * Локаль интерфейса/CLI. Приоритет: REVDECK_LANG → системная LANG/LC_ALL → en.
 * Язык результатов ревью задаётся отдельно (output.language) и может отличаться.
 */
export function detectLocale(explicit?: string): Locale {
    const value = (explicit ?? process.env.REVDECK_LANG ?? process.env.LC_ALL ?? process.env.LANG ?? '').toLowerCase();
    return value.startsWith('ru') ? 'ru' : 'en';
}

export function isLocale(value: unknown): value is Locale {
    return value === 'ru' || value === 'en';
}

let current: Locale = detectLocale();

export function locale(): Locale {
    return current;
}

export function setLocale(value: Locale): void {
    current = value;
    // Наследуется дочерним демоном/MCP, чтобы язык не расходился.
    process.env.REVDECK_LANG = value;
}

/** Двуязычная строка: ru — для русской локали, en — для английской. */
export function tr(ru: string, en: string): string {
    return current === 'ru' ? ru : en;
}

/** Выбор формы по числу: русские one/few/many или английские one/other. */
export function plural(count: number, ruOne: string, ruFew: string, ruMany: string, enOne: string, enMany: string): string {
    if (current === 'en') return count === 1 ? enOne : enMany;
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return ruOne;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return ruFew;
    return ruMany;
}

/** Язык текста: кириллица или латиница. Нужен для output.language: auto. */
export function detectTextLocale(text: string, fallback: Locale = current): Locale {
    const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
    const latin = (text.match(/[A-Za-z]/g) ?? []).length;
    if (cyrillic === 0 && latin === 0) return fallback;
    return cyrillic >= latin ? 'ru' : 'en';
}

/** auto → язык текста ревью; явное ru/en — как задано. */
export function resolveOutputLanguage(setting: 'auto' | 'ru' | 'en', texts: string[]): Locale {
    if (setting === 'ru' || setting === 'en') return setting;
    return detectTextLocale(texts.join('\n'), 'en');
}
