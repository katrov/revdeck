/** Перевод glob в регулярное выражение. Поддерживает `**`, `*`, `?`, `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
    let source = '';
    let index = 0;
    const pattern = glob.replace(/^\.\//, '').replace(/^\/+/, '');
    while (index < pattern.length) {
        const char = pattern[index]!;
        if (char === '*') {
            if (pattern[index + 1] === '*') {
                // `**/` — любая глубина, `**` в конце — всё остальное.
                if (pattern[index + 2] === '/') {
                    source += '(?:[^/]+/)*';
                    index += 3;
                } else {
                    source += '.*';
                    index += 2;
                }
            } else {
                source += '[^/]*';
                index += 1;
            }
            continue;
        }
        if (char === '?') {
            source += '[^/]';
            index += 1;
            continue;
        }
        if (char === '{') {
            const end = pattern.indexOf('}', index);
            if (end > index) {
                const options = pattern
                    .slice(index + 1, end)
                    .split(',')
                    .map((item) => escapeRegExp(item.trim()));
                source += `(?:${options.join('|')})`;
                index = end + 1;
                continue;
            }
        }
        source += escapeRegExp(char);
        index += 1;
    }
    return new RegExp(`^${source}$`);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesAny(patterns: readonly string[], value: string): boolean {
    return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

/** Приблизительный тип файла — только для выбора правил, не для оценки кода. */
export function classifyFile(path: string): 'app' | 'test' | 'style' | 'config' | 'docs' | 'generated' | 'other' {
    const lower = path.toLowerCase();
    if (/(^|\/)(node_modules|dist|build|coverage|vendor)\//.test(lower)) return 'generated';
    if (/\.(md|mdx|rst|txt|adoc)$/.test(lower) || /(^|\/)(docs?|adr)\//.test(lower)) return 'docs';
    if (/(^|\/)(__tests__|tests?|spec|e2e)\//.test(lower) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(lower) || /_test\.go$/.test(lower)) return 'test';
    if (/\.(css|scss|sass|less|styl)$/.test(lower)) return 'style';
    if (/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json|[^/]*\.config\.[cm]?[jt]s|\.eslintrc[^/]*|\.prettierrc[^/]*|Dockerfile|Makefile|\.github\/workflows\/|\.gitlab-ci\.yml)/.test(lower)) return 'config';
    if (/\.(generated|g)\.[cm]?[jt]s$|\.d\.ts$|(^|\/)generated\//.test(lower)) return 'generated';
    if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|rs|java|kt|rb|php|cs|c|cpp|h|hpp|swift|scala|ex|exs)$/.test(lower)) return 'app';
    return 'other';
}
