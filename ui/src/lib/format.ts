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

/** Убирает markdown-разметку для однострочных превью. */
export function plainText(value: string): string {
    return value
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^>\s?/gm, '');
}
