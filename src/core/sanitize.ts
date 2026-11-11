import type { Platform } from './types.js';
import { tr } from './locale.js';

/**
 * Проверка текста, который уйдёт в публичный комментарий.
 *
 * Часть текста пишет агент, а часть — модель, прочитавшая недоверенный MR.
 * Поэтому запрещаем всё, что исполняется платформой или прячет содержимое от
 * человека в окне подтверждения: быстрые команды GitLab, HTML, скрытые и
 * bidi-символы, массовые упоминания и внешние картинки.
 */

const CONTROL_OR_HIDDEN =
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0]/;

const QUICK_ACTION = /^[\s\p{Z}\p{Cf}]*\/[a-z_]+(?=[\s\p{Z}\p{Cf}]|$)/imu;
const MASS_MENTION = /(^|[^\w@./-])@(all|here|everyone)(?![\w-])/i;
const MD_IMAGE = /!\[[^\]]*\]\s*\(|!\[[^\]]*\]\s*\[/;
const HTML_TAG = /<(?:img|script|iframe|style|video|audio|object|embed|svg|math)\b/i;
const HTML_COMMENT = /<!--/;
const MAX_LENGTH = 64 * 1024;

export interface SanitizeResult {
    ok: boolean;
    reason: string;
    /** Текст после нормализации переводов строк. */
    text: string;
}

export interface SanitizeOptions {
    maxLength?: number;
    /** Проверять быстрые команды GitLab (по умолчанию — только для GitLab). */
    quickActions?: boolean;
}

export function sanitizeBody(body: string, platform: Platform, options: SanitizeOptions = {}): SanitizeResult {
    const text = String(body ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const maxLength = options.maxLength ?? MAX_LENGTH;
    const checkQuickActions = options.quickActions ?? platform === 'gitlab';

    if (text.trim() === '') return { ok: false, reason: tr('текст пуст', 'the text is empty'), text };
    if (text.length > maxLength) return { ok: false, reason: tr(`текст длиннее ${maxLength} символов`, `the text is longer than ${maxLength} characters`), text };
    if (CONTROL_OR_HIDDEN.test(text)) return { ok: false, reason: tr('в тексте есть управляющие или невидимые символы', 'the text contains control or invisible characters'), text };
    if (HTML_COMMENT.test(text)) return { ok: false, reason: tr('в тексте есть HTML-комментарий', 'the text contains an HTML comment'), text };
    if (HTML_TAG.test(text)) return { ok: false, reason: tr('в тексте есть HTML-тег', 'the text contains an HTML tag'), text };
    if (MD_IMAGE.test(text)) return { ok: false, reason: tr('в тексте есть картинка: замените ссылкой', 'the text contains an image: replace it with a link'), text };
    if (MASS_MENTION.test(text)) return { ok: false, reason: tr('массовое упоминание: укажите конкретных людей', 'mass mention: name specific people'), text };
    if (checkQuickActions && QUICK_ACTION.test(text)) {
        return { ok: false, reason: tr('строка-команда GitLab (/approve, /merge …): перефразируйте', 'GitLab quick action line (/approve, /merge …): rephrase it'), text };
    }
    return { ok: true, reason: '', text };
}

/** Текст, который отправляется в GitHub: быстрые действия не исполняются, но остальное актуально. */
export function sanitizeGithubBody(body: string): SanitizeResult {
    return sanitizeBody(body, 'github', { quickActions: false });
}

export function isSafeBody(body: string, platform: Platform): boolean {
    return sanitizeBody(body, platform).ok;
}
