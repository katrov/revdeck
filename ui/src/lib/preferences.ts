import { applyAutoRefreshMinutes } from './auto-refresh.svelte';
import { applyLocale } from './i18n.svelte';
import { applyNotificationsEnabled } from './notifications.svelte';
import { loadServerSettings } from './settings-sync';
import { applyFeaturesHidden } from './state.svelte';
import { applyTheme } from './theme.svelte';

/**
 * Применяет настройки с демона до первого кадра. Значения проверяются по типу:
 * в базе мог остаться мусор от старой версии.
 */
export async function restorePreferences(): Promise<void> {
    const settings = await loadServerSettings();
    if (!settings) return;

    const { theme, locale, featuresHidden, autoRefreshMinutes, notificationsEnabled } = settings;
    if (theme === 'auto' || theme === 'light' || theme === 'dark') applyTheme(theme);
    if (locale === 'ru' || locale === 'en') applyLocale(locale);
    if (typeof featuresHidden === 'boolean') applyFeaturesHidden(featuresHidden);
    if (typeof autoRefreshMinutes === 'number' && Number.isFinite(autoRefreshMinutes)) applyAutoRefreshMinutes(autoRefreshMinutes);
    if (typeof notificationsEnabled === 'boolean') applyNotificationsEnabled(notificationsEnabled);
}
