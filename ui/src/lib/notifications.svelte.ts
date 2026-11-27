import { t } from './i18n.svelte';
import type { ReviewView, Thread } from './types';

const KEY = 'revdeck.notifyThreads';

function stored(): boolean {
    try {
        return localStorage.getItem(KEY) === '1';
    } catch {
        return false;
    }
}

function permission(): NotificationPermission | 'unsupported' {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

const initialPermission = permission();
export const notifications = $state({ enabled: stored() && initialPermission === 'granted', permission: initialPermission });

export async function setNotificationsEnabled(value: boolean): Promise<void> {
    if (value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
    }
    notifications.permission = permission();
    notifications.enabled = value && notifications.permission === 'granted';
    try {
        localStorage.setItem(KEY, notifications.enabled ? '1' : '0');
    } catch {
        // localStorage может быть недоступен.
    }
}

function bodyOf(thread: Thread): string {
    const text = (thread.notes[0]?.body ?? '').replace(/\s+/g, ' ').trim();
    return `${thread.path ?? ''}${thread.line ? `:${thread.line}` : ''}${text ? ` — ${text.slice(0, 120)}` : ''}`;
}

/** Браузерное уведомление только для новых открытых тредов и только в фоновой вкладке. */
export function notifyNewThreads(previous: ReviewView | null, next: ReviewView): void {
    if (!notifications.enabled || notifications.permission !== 'granted') return;
    if (typeof document === 'undefined' || !document.hidden || typeof Notification === 'undefined') return;
    if (previous?.id !== next.id) return;
    const known = new Set((previous?.threads ?? []).map((thread) => thread.id));
    for (const thread of next.threads) {
        if (thread.resolved || known.has(thread.id)) continue;
        try {
            new Notification(t('Новый тред в revdeck', 'New thread in revdeck'), { body: bodyOf(thread), tag: thread.id });
        } catch {
            // некоторые браузеры запрещают конструктор без service worker
        }
    }
}
