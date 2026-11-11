import type { SnippetLine } from './types';

export function truncate(value: string, max = 200): string {
    const text = value.replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function lineClass(kind: SnippetLine['kind']): string {
    return kind === '+' ? 'add' : kind === '-' ? 'del' : '';
}

export function levelLabel(level: string): string {
    return level;
}

export function plural(count: number, one: string, few: string, many: string): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

/** Убирает markdown-разметку для однострочных превью. */
export function plainText(value: string): string {
    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^>\s?/gm, '');
}
