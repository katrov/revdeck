import type { ProjectSummary } from './types.js';

const COLORS = ['#3b6ef5', '#7c5cff', '#1f8f4e', '#d97706', '#0e7490', '#b4236b', '#6b7280'];

export function projectKeyFromReviewId(id: string): string {
    const raw = id.replace(/!\d+$/, '');
    const match = /^(gitlab|github):([^/]+)\/(.+)$/.exec(raw);
    if (!match) return raw;
    return `${match[1]}:${match[2]!.toLowerCase()}/${match[3]!.toLowerCase()}`;
}

export function projectColor(key: string): string {
    let hash = 0;
    for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length]!;
}

/** Короткое имя; при совпадении последнего сегмента показываем полный путь. */
export function projectLabel(project: ProjectSummary, all: ProjectSummary[]): string {
    const base = project.title || project.project.split('/').pop() || project.project;
    const clash = all.some(
        (item) => item.key !== project.key && (item.title || item.project.split('/').pop() || item.project) === base,
    );
    return clash ? project.project : base;
}

export function sortProjects(projects: ProjectSummary[], pinned: string[]): ProjectSummary[] {
    const rank = new Map(pinned.map((key, index) => [key, index]));
    return [...projects].sort((left, right) => {
        const leftPin = rank.get(left.key);
        const rightPin = rank.get(right.key);
        if (leftPin !== undefined || rightPin !== undefined) {
            if (leftPin === undefined) return 1;
            if (rightPin === undefined) return -1;
            return leftPin - rightPin;
        }
        return right.lastActivity.localeCompare(left.lastActivity) || left.key.localeCompare(right.key);
    });
}
