import type { Locale } from './types';

const STORAGE_KEY = 'revdeck-locale';

function initialLocale(): Locale {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'ru' || saved === 'en') return saved;
    } catch {
        // localStorage может быть недоступен
    }
    const language = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
    return language.startsWith('ru') ? 'ru' : 'en';
}

export const i18n = $state<{ locale: Locale }>({ locale: initialLocale() });

export function setLocale(value: Locale): void {
    i18n.locale = value;
    try {
        localStorage.setItem(STORAGE_KEY, value);
    } catch {
        // не критично
    }
    if (typeof document !== 'undefined') document.documentElement.lang = value;
}

/** Двуязычная строка: первый аргумент — русский, второй — английский. */
export function t(ru: string, en: string): string {
    return i18n.locale === 'ru' ? ru : en;
}

export function plural(count: number, ruForms: [string, string, string], enForms: [string, string]): string {
    if (i18n.locale === 'en') return count === 1 ? enForms[0] : enForms[1];
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return ruForms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return ruForms[1];
    return ruForms[2];
}

export function localeTag(): string {
    return i18n.locale === 'ru' ? 'ru-RU' : 'en-US';
}

export function currentLocale(): Locale {
    return i18n.locale;
}
