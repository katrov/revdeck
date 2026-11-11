import type { DiffFile, DiffLine, FileStatus, Hunk } from './types.js';

const MAX_DIFF_BYTES = 32 * 1024 * 1024;

export class DiffParseError extends Error {}

/** Убирает префикс a//b/ и кавычки, отбрасывает табуляцию с временем файла. */
function cleanPath(raw: string): string {
    let value = raw.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    value = value.replace(/\t.*$/, '');
    return value.replace(/^[ab]\//, '');
}

function splitGitHeader(line: string): { oldPath: string; newPath: string } {
    // `diff --git a/x b/y`; пути могут содержать пробелы, поэтому ищем разделитель ` b/`.
    const body = line.slice('diff --git '.length).trim();
    const quoted = /^"(.*)"\s+"(.*)"$/.exec(body);
    if (quoted) return { oldPath: cleanPath(quoted[1]!), newPath: cleanPath(quoted[2]!) };
    const index = body.lastIndexOf(' b/');
    if (index > 0) {
        return { oldPath: cleanPath(body.slice(0, index)), newPath: cleanPath(body.slice(index + 1)) };
    }
    const [left, right] = body.split(/\s+/);
    return { oldPath: cleanPath(left ?? ''), newPath: cleanPath(right ?? left ?? '') };
}

function parseHunkHeader(line: string): Hunk {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (!match) throw new DiffParseError(`некорректный заголовок хунка: ${line.slice(0, 120)}`);
    return {
        header: line,
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
    };
}

/**
 * Разбирает unified diff (формат git) в структуру файлов и хунков.
 *
 * Толерантен к неполным патчам (xdiff, `glab mr diff`, `gh pr diff`): имена
 * берутся из `+++`/`---`, если они есть, иначе из `diff --git`. Счётчики хунка
 * используются как подсказка и не роняют разбор при расхождении.
 */
export function parseUnifiedDiff(patch: string): DiffFile[] {
    if (patch.length > MAX_DIFF_BYTES) {
        throw new DiffParseError(`diff больше ${Math.round(MAX_DIFF_BYTES / 1024 / 1024)} МБ: откройте меньший диапазон`);
    }
    const lines = patch.replace(/\r\n/g, '\n').split('\n');
    const files: DiffFile[] = [];
    let current: DiffFile | null = null;
    let index = 0;

    const start = (oldPath: string, newPath: string): DiffFile => {
        const file: DiffFile = {
            path: newPath || oldPath,
            oldPath: oldPath || newPath,
            status: 'modified',
            binary: false,
            hunks: [],
        };
        files.push(file);
        return file;
    };

    while (index < lines.length) {
        const line = lines[index]!;
        if (line.startsWith('diff --git ')) {
            const { oldPath, newPath } = splitGitHeader(line);
            current = start(oldPath, newPath);
            index++;
            continue;
        }
        if (!current && line.startsWith('--- ')) {
            current = start(cleanPath(line.slice(4)), '');
            current.status = 'modified';
            index++;
            continue;
        }
        if (!current) {
            index++;
            continue;
        }
        if (line.startsWith('new file mode')) {
            current.status = 'added';
            index++;
            continue;
        }
        if (line.startsWith('deleted file mode')) {
            current.status = 'deleted';
            index++;
            continue;
        }
        if (line.startsWith('rename from ')) {
            current.oldPath = cleanPath(line.slice('rename from '.length));
            current.status = 'renamed';
            index++;
            continue;
        }
        if (line.startsWith('rename to ')) {
            current.path = cleanPath(line.slice('rename to '.length));
            current.status = 'renamed';
            index++;
            continue;
        }
        if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
            current.binary = true;
            index++;
            continue;
        }
        if (current.hunks.length === 0 && line.startsWith('--- ')) {
            const value = line.slice(4).trim();
            if (value === '/dev/null') {
                current.status = 'added';
            } else {
                current.oldPath = cleanPath(value);
            }
            index++;
            continue;
        }
        if (current.hunks.length === 0 && line.startsWith('+++ ')) {
            const value = line.slice(4).trim();
            if (value === '/dev/null') {
                current.status = 'deleted';
            } else {
                current.path = cleanPath(value);
            }
            index++;
            continue;
        }
        if (line.startsWith('@@')) {
            const hunk = parseHunkHeader(line);
            current.hunks.push(hunk);
            index++;
            let oldLeft = hunk.oldLines;
            let newLeft = hunk.newLines;
            let oldNo = hunk.oldStart;
            let newNo = hunk.newStart;
            while (index < lines.length) {
                const body = lines[index]!;
                // Строки `--- `/`+++ ` внутри хунка — это удалённая `-- x` или добавленная `++ x`,
                // поэтому границей считаются только заголовок следующего хунка и новый файл.
                if (body.startsWith('diff --git ') || body.startsWith('@@')) break;
                // Финальный перевод строки патча даёт пустой элемент; пустая строка-контекст
                // в git-диффе всегда начинается с пробела.
                if (body === '' && index === lines.length - 1) break;
                if (body.startsWith('\\')) {
                    index++;
                    continue;
                }
                const marker = body[0] ?? '';
                let parsed: DiffLine;
                if (marker === '+') {
                    parsed = { kind: '+', text: body.slice(1), oldLine: null, newLine: newNo };
                    newNo++;
                    newLeft--;
                } else if (marker === '-') {
                    parsed = { kind: '-', text: body.slice(1), oldLine: oldNo, newLine: null };
                    oldNo++;
                    oldLeft--;
                } else {
                    // Контекст: строка с пробелом или пустая строка (некоторые генераторы теряют пробел).
                    parsed = { kind: ' ', text: marker === ' ' ? body.slice(1) : body, oldLine: oldNo, newLine: newNo };
                    oldNo++;
                    newNo++;
                    oldLeft--;
                    newLeft--;
                }
                hunk.lines.push(parsed);
                index++;
                if (oldLeft <= 0 && newLeft <= 0) break;
            }
            continue;
        }
        index++;
    }

    return files.filter((file) => file.path && file.path !== '/dev/null');
}

export function diffStats(files: DiffFile[]): { files: number; additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
        for (const hunk of file.hunks) {
            for (const line of hunk.lines) {
                if (line.kind === '+') additions++;
                else if (line.kind === '-') deletions++;
            }
        }
    }
    return { files: files.length, additions, deletions };
}

export function changedPaths(files: DiffFile[]): string[] {
    return files.map((file) => file.path);
}

export function findFile(files: DiffFile[], path: string): DiffFile | undefined {
    return files.find((file) => file.path === path) ?? files.find((file) => file.oldPath === path);
}

/** Строка нового файла (контекст или добавленная), к которой можно привязать комментарий. */
export function findNewLine(files: DiffFile[], path: string, line: number): DiffLine | undefined {
    const file = findFile(files, path);
    if (!file) return undefined;
    for (const hunk of file.hunks) {
        for (const item of hunk.lines) {
            if (item.newLine === line) return item;
        }
    }
    return undefined;
}

export function isLineInDiff(files: DiffFile[], path: string, line: number): boolean {
    return findNewLine(files, path, line) !== undefined;
}

export interface SnippetLine {
    kind: '+' | '-' | ' ';
    oldLine: number | null;
    newLine: number | null;
    text: string;
    target: boolean;
}

/** Фрагмент diff вокруг строки — для карточек замечаний в UI. */
export function snippetAround(files: DiffFile[], path: string, line: number | null, radius = 6): SnippetLine[] | null {
    const file = findFile(files, path);
    if (!file || line == null) return null;
    const flat: DiffLine[] = file.hunks.flatMap((hunk) => hunk.lines);
    const target = flat.findIndex((item) => item.newLine === line);
    if (target < 0) return null;
    return flat
        .slice(Math.max(0, target - radius), target + radius + 1)
        .map((item) => ({
            kind: item.kind,
            oldLine: item.oldLine,
            newLine: item.newLine,
            text: item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text,
            target: item.newLine === line,
        }));
}

/** Позиция для GitLab: неизменённая строка требует и old_line, добавленная — только new_line. */
export function linePosition(
    files: DiffFile[],
    path: string,
    line: number,
): { newPath: string; newLine: number; oldPath: string; oldLine: number | null } | null {
    const file = findFile(files, path);
    const found = findNewLine(files, path, line);
    if (!file || !found) return null;
    return { newPath: file.path, newLine: line, oldPath: file.oldPath, oldLine: found.kind === ' ' ? found.oldLine : null };
}
