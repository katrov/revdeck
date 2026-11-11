/**
 * Минимальный безопасный markdown: сначала экранируется весь HTML, затем
 * добавляется разметка. Картинки не поддерживаются (внешние URL не грузятся).
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function inline(value: string): string {
    return value
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>')
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer noopener">$2</a>');
}

export function renderMarkdown(source: string): string {
    const lines = escapeHtml(source.replace(/\r\n/g, '\n')).split('\n');
    const out: string[] = [];
    let inCode = false;
    let list: 'ul' | 'ol' | null = null;
    let paragraph: string[] = [];

    const flushParagraph = (): void => {
        if (paragraph.length) {
            out.push(`<p>${inline(paragraph.join(' '))}</p>`);
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
            out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
            continue;
        }
        if (/^>\s?/.test(line)) {
            flushParagraph();
            closeList();
            out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
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
            out.push(`<li>${inline(bullet[1]!)}</li>`);
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
            out.push(`<li>${inline(ordered[1]!)}</li>`);
            continue;
        }
        paragraph.push(line);
    }
    flushParagraph();
    closeList();
    if (inCode) out.push('</code></pre>');
    return out.join('\n');
}
