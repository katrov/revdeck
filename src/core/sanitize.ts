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
const MD_IMAGE_REF = /!\[[^\]]*\]\s*\[/;
const MD_IMAGE_LINK = /!\[[^\]]*\]\s*\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
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
    /** Хост платформы: картинки разрешены только с него и из /uploads/. */
    host?: string;
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
    const imageProblem = imageIssue(text, options.host);
    if (imageProblem) return { ok: false, reason: imageProblem, text };
    if (MASS_MENTION.test(text)) return { ok: false, reason: tr('массовое упоминание: укажите конкретных людей', 'mass mention: name specific people'), text };
    if (checkQuickActions && QUICK_ACTION.test(text)) {
        return { ok: false, reason: tr('строка-команда GitLab (/approve, /merge …): перефразируйте', 'GitLab quick action line (/approve, /merge …): rephrase it'), text };
    }
    return { ok: true, reason: '', text };
}

/**
 * Картинки и видео разрешены только с хоста платформы или из её `/uploads/`.
 * Внешняя картинка — это запрос к чужому серверу из ленты MR и утечка факта просмотра.
 */
function imageIssue(text: string, host: string | undefined): string | null {
    if (MD_IMAGE_REF.test(text)) {
        return tr('в тексте есть картинка со ссылочной сноской: вставьте абсолютную ссылку', 'the text contains a reference-style image: use an absolute link');
    }
    for (const match of text.matchAll(MD_IMAGE_LINK)) {
        const url = match[1]!;
        if (!host) {
            return tr('картинки разрешены только с хоста платформы', 'images are allowed only from the platform host');
        }
        if (url.startsWith('/uploads/')) continue;
        try {
            const parsed = new URL(url);
            if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host === host) continue;
        } catch {
            // ниже — общая ошибка
        }
        return tr(`внешняя картинка ${url}: разрешены только загрузки с ${host}`, `external image ${url}: only uploads from ${host} are allowed`);
    }
    return null;
}

/**
 * Приводит относительные ссылки на загруженные файлы GitLab к абсолютному URL.
 * Без хоста платформа не показывает картинку в тексте комментария.
 */
export function normalizeMediaLinks(body: string, platform: Platform, host: string): string {
    if (platform !== 'gitlab' || !host) return body;
    const base = `https://${host}`;
    return body.replace(/(!?\[[^\]]*\]\(\s*)(\/?uploads\/[^)\s]+)/g, (_match, prefix: string, path: string) => {
        return `${prefix}${path.startsWith('/') ? base : `${base}/`}${path}`;
    });
}

/** Текст, который отправляется в GitHub: быстрые действия не исполняются, но остальное актуально. */
export function sanitizeGithubBody(body: string, options: SanitizeOptions = {}): SanitizeResult {
    return sanitizeBody(body, 'github', { ...options, quickActions: false });
}

export function isSafeBody(body: string, platform: Platform, options: SanitizeOptions = {}): boolean {
    return sanitizeBody(body, platform, options).ok;
}
