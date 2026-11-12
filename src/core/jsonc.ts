/**
 * Минимальный JSONC: devcontainer.json разрешает комментарии и висячие запятые.
 * Нужен, чтобы `revdeck devcontainer --write` не терял чужие настройки.
 */
export function parseJsonc(text: string): unknown {
    let withoutComments = '';
    let inString = false;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index]!;
        const next = text[index + 1];
        if (lineComment) {
            if (char === '\n') {
                lineComment = false;
                withoutComments += char;
            }
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            } else if (char === '\n') {
                withoutComments += char;
            }
            continue;
        }
        if (inString) {
            withoutComments += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            withoutComments += char;
            continue;
        }
        if (char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        withoutComments += char;
    }

    let cleaned = '';
    inString = false;
    escaped = false;
    for (let index = 0; index < withoutComments.length; index++) {
        const char = withoutComments[index]!;
        if (inString) {
            cleaned += char;
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            cleaned += char;
            continue;
        }
        if (char === ',') {
            let lookahead = index + 1;
            while (lookahead < withoutComments.length && /\s/.test(withoutComments[lookahead]!)) lookahead += 1;
            const next = withoutComments[lookahead];
            if (next === '}' || next === ']') continue;
        }
        cleaned += char;
    }

    return JSON.parse(cleaned) as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
