import { readFile } from 'node:fs/promises';

async function fileLines(file: string): Promise<string[]> {
    const text = await readFile(file, 'utf8').catch(() => '');
    return text.trimEnd() ? text.trimEnd().split('\n') : [];
}

/**
 * Хвост текущего лога; если строк мало, добираем из ротированного `daemon.log.1`.
 * `rotated` — путь предыдущего файла, если он реально попал в вывод.
 */
export async function logTail(file: string, limit: number): Promise<{ lines: string[]; rotated: string | null }> {
    const current = await fileLines(file);
    if (current.length >= limit) return { lines: current.slice(-limit), rotated: null };
    const previousFile = `${file}.1`;
    const previous = await fileLines(previousFile);
    const needed = limit - current.length;
    const head = needed > 0 ? previous.slice(-needed) : [];
    return { lines: [...head, ...current], rotated: head.length ? previousFile : null };
}
