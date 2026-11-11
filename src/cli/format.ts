import { redact } from '../core/redact.js';
import { locale, type Locale } from '../core/locale.js';

export interface CliWriters {
    out(text: string): void;
    err(text: string): void;
}

export const writers: CliWriters = {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
};

export function printJson(value: unknown): void {
    writers.out(JSON.stringify(value, null, 2));
}

export function fail(message: string, hint?: string): never {
    writers.err(`revdeck: ${redact(message)}`);
    if (hint) writers.err(`  ${redact(hint)}`);
    process.exit(1);
}

export function usage(lines: string[]): never {
    writers.err(lines.join('\n'));
    process.exit(2);
}

export function truncate(value: string, max = 400): string {
    const single = value.replace(/\s+/g, ' ').trim();
    return single.length > max ? `${single.slice(0, max)}…` : single;
}

export function when(iso: string, language: Locale = locale()): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const diff = Date.now() - date.getTime();
    const minutes = Math.round(diff / 60000);
    const en = language === 'en';
    if (minutes < 1) return en ? 'just now' : 'только что';
    if (minutes < 60) return en ? `${minutes} min ago` : `${minutes} мин назад`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return en ? `${hours} h ago` : `${hours} ч назад`;
    return date.toLocaleString(en ? 'en-US' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export function pad(value: string, width: number): string {
    const length = [...value].length;
    return length >= width ? value : value + ' '.repeat(width - length);
}

export function reviewLine(item: { number: number; title: string; author: string; project: string; syncedAt: string }): string {
    return `#${item.number} ${pad(truncate(item.title, 60), 62)} ${pad(item.author, 18)} ${item.project} · ${when(item.syncedAt)}`;
}

export function parseList(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
