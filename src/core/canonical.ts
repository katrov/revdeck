/**
 * Канонический JSON: ключи отсортированы, значения без undefined.
 * Нужен для хеша, который подтверждает человек: любое изменение текста
 * меняет хеш, и публикация по устаревшему подтверждению отклоняется.
 */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const item = (value as Record<string, unknown>)[key];
            if (item !== undefined) out[key] = normalize(item);
        }
        return out;
    }
    return value;
}
