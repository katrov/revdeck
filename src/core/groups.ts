import { classifyFile, globToRegExp } from './glob.js';
import type { DiffFile } from './types.js';

export interface ChangeGroup {
    id: string;
    title: string;
    files: string[];
    additions: number;
    deletions: number;
}

export interface CustomGroup {
    id: string;
    title: string;
    match: string | string[];
}

const CLASS_LABEL: Record<ReturnType<typeof classifyFile>, string> = {
    docs: 'Documentation',
    test: 'Tests',
    config: 'Configuration',
    style: 'Styles',
    generated: 'Generated',
    app: 'Application',
    other: 'Other',
};

/** Группы изменений: явные правила из конфига, затем тип файла и верхний модуль. */
export function computeGroups(diff: DiffFile[], custom: CustomGroup[] = []): ChangeGroup[] {
    const groups = new Map<string, ChangeGroup>();
    const add = (group: ChangeGroup, path: string, additions: number, deletions: number): void => {
        group.files.push(path);
        group.additions += additions;
        group.deletions += deletions;
        groups.set(group.id, group);
    };
    for (const file of diff) {
        let additions = 0;
        let deletions = 0;
        for (const hunk of file.hunks) {
            for (const line of hunk.lines) {
                if (line.kind === '+') additions += 1;
                else if (line.kind === '-') deletions += 1;
            }
        }
        const customGroup = custom.find((item) => {
            const patterns = Array.isArray(item.match) ? item.match : [item.match];
            return patterns.some((pattern) => globToRegExp(pattern).test(file.path));
        });
        if (customGroup) {
            const group = groups.get(customGroup.id) ?? { id: customGroup.id, title: customGroup.title, files: [], additions: 0, deletions: 0 };
            add(group, file.path, additions, deletions);
            continue;
        }
        const kind = classifyFile(file.path);
        if (kind !== 'app' && kind !== 'other') {
            const id = kind;
            const group = groups.get(id) ?? { id, title: CLASS_LABEL[kind], files: [], additions: 0, deletions: 0 };
            add(group, file.path, additions, deletions);
            continue;
        }
        const module = file.path.split('/')[0] || 'root';
        const id = `module:${module}`;
        const group = groups.get(id) ?? { id, title: module, files: [], additions: 0, deletions: 0 };
        add(group, file.path, additions, deletions);
    }
    return [...groups.values()].sort((left, right) => right.additions + right.deletions - (left.additions + left.deletions) || left.title.localeCompare(right.title));
}
