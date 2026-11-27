import { globToRegExp } from './glob.js';

export interface CodeownersEntry {
    pattern: string;
    owners: string[];
}

export interface CodeownersMatch {
    file: string;
    owners: string[];
}

/** Строки CODEOWNERS: последний подходящий шаблон важнее предыдущих. */
export function parseCodeowners(text: string): CodeownersEntry[] {
    const entries: CodeownersEntry[] = [];
    for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const [pattern, ...owners] = line.split(/\s+/);
        if (!pattern || !owners.length) continue;
        entries.push({ pattern, owners });
    }
    return entries;
}

function matches(path: string, pattern: string): boolean {
    const cleaned = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!cleaned) return false;
    // Без слэша CODEOWNERS матчит имя файла/каталога на любой глубине.
    if (!cleaned.includes('/')) {
        const segment = cleaned.includes('*') || cleaned.includes('?') ? cleaned : cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|/)${segment}(/|$)`).test(path);
    }
    if (globToRegExp(cleaned).test(path)) return true;
    return globToRegExp(`${cleaned}/**`).test(path);
}

export function codeownersFor(files: string[], entries: CodeownersEntry[]): CodeownersMatch[] {
    const result: CodeownersMatch[] = [];
    for (const file of files) {
        let owners: string[] = [];
        for (const entry of entries) {
            if (matches(file, entry.pattern)) owners = entry.owners;
        }
        if (owners.length) result.push({ file, owners });
    }
    return result;
}
