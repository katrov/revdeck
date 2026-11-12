/**
 * Минимальный безопасный markdown: сначала экранируется весь HTML, затем
 * добавляется разметка. Картинки и видео разрешены только с хоста платформы
 * или из её /uploads/: внешние URL не загружаются, чтобы комментарий не
 * превращался в трекер.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["']([^"']*)["'])?\s*\)\s*(?:\{([^}]*)\})?/g;
const VIDEO = /\.(?:mp4|m4v|webm|ogv|mov)(?:[?#]|$)/i;

export interface MarkdownOptions {
    /** База платформы, например https://gitlab.example.com. */
    baseUrl?: string;
    /** База для /uploads: у GitLab это https://host/-/project/<id>. */
    uploadsBaseUrl?: string;
}

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function inline(value: string, options: MarkdownOptions): string {
    return value
        .replace(IMAGE, (_match, alt: string, url: string, _title: string, attributes: string | undefined) => renderMedia(alt, url, attributes, options))
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>');
}

function renderMedia(alt: string, rawUrl: string, attributes: string | undefined, options: MarkdownOptions): string {
    const url = resolveMediaUrl(rawUrl, options);
    if (!url) {
        const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
        return href ? `<a href="${href}" target="_blank" rel="noreferrer noopener">${alt || href}</a>` : alt;
    }
    const dimensions = parseDimensions(attributes);
    if (VIDEO.test(url)) {
        return `<video class="md-media" src="${url}" controls preload="metadata"${dimensions}></video>`;
    }
    return `<img class="md-media" src="${url}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer"${dimensions}>`;
}

function resolveMediaUrl(rawUrl: string, options: MarkdownOptions): string | null {
    const url = rawUrl.replace(/&amp;/g, '&');
    const baseUrl = options.baseUrl;
    if (!baseUrl) return null;
    const base = baseUrl.replace(/\/$/, '');
    if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
        const uploads = (options.uploadsBaseUrl ?? base).replace(/\/$/, '');
        return `${uploads}${url.startsWith('/') ? '' : '/'}${url}`;
    }
    if (url.startsWith('/-/')) return `${base}${url}`;
    if (!/^https?:\/\//i.test(url)) return null;
    try {
        const parsed = new URL(url);
        const host = new URL(baseUrl);
        if (parsed.host !== host.host) {
            // GitHub хранит вложения приватных репозиториев на отдельном хосте.
            if (!(host.host.toLowerCase() === 'github.com' && /\.githubusercontent\.com$/i.test(parsed.host))) return null;
        }
        // Старые ссылки без project id: https://host/uploads/...
        if (options.uploadsBaseUrl && parsed.pathname.startsWith('/uploads/')) {
            return `${options.uploadsBaseUrl.replace(/\/$/, '')}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
        return rawUrl;
    } catch {
        return null;
    }
}

function parseDimensions(attributes: string | undefined): string {
    if (!attributes) return '';
    const dimensions: string[] = [];
    for (const part of attributes.split(/\s+/)) {
        const match = /^(width|height)=(\d{1,5})(?:px)?$/i.exec(part);
        if (match) dimensions.push(`${match[1]!.toLowerCase()}="${match[2]}"`);
    }
    return dimensions.length ? ` ${dimensions.join(' ')}` : '';
}

export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
    const lines = escapeHtml(source.replace(/\r\n/g, '\n')).split('\n');
    const out: string[] = [];
    let inCode = false;
    let list: 'ul' | 'ol' | null = null;
    let paragraph: string[] = [];

    const flushParagraph = (): void => {
        if (paragraph.length) {
            out.push(`<p>${inline(paragraph.join(' '), options)}</p>`);
            paragraph = [];
        }
    };
    const closeList = (): void => {
        if (list) {
            out.push(`</${list}>`);
            list = null;
        }
    };

    for (const line of lines) {
        if (/^```/.test(line.trim())) {
            flushParagraph();
            closeList();
            if (inCode) {
                out.push('</code></pre>');
                inCode = false;
            } else {
                out.push('<pre><code>');
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            out.push(`${line}\n`);
            continue;
        }
        if (!line.trim()) {
            flushParagraph();
            closeList();
            continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line);
        if (heading) {
            flushParagraph();
            closeList();
            const level = Math.min(4, heading[1]!.length);
            out.push(`<h${level}>${inline(heading[2]!, options)}</h${level}>`);
            continue;
        }
        if (/^>\s?/.test(line)) {
            flushParagraph();
            closeList();
            out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''), options)}</blockquote>`);
            continue;
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) {
            flushParagraph();
            if (list !== 'ul') {
                closeList();
                out.push('<ul>');
                list = 'ul';
            }
            out.push(`<li>${inline(bullet[1]!, options)}</li>`);
            continue;
        }
        const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (ordered) {
            flushParagraph();
            if (list !== 'ol') {
                closeList();
                out.push('<ol>');
                list = 'ol';
            }
            out.push(`<li>${inline(ordered[1]!, options)}</li>`);
            continue;
        }
        paragraph.push(line);
    }
    flushParagraph();
    closeList();
    if (inCode) out.push('</code></pre>');
    return out.join('\n');
}
