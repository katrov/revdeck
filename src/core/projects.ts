import type { Platform } from './types.js';

/** Идентичность проекта: платформа, хост и полный путь проекта. */
export interface ProjectRef {
    platform: Platform;
    host: string;
    project: string;
}

/**
 * Стабильный ключ проекта. Для сравнения приводим хост и путь к нижнему
 * регистру: GitHub регистронезависим, а GitLab-маршруты не различают регистр.
 * Исходные значения сохраняются в БД отдельно для отображения.
 */
export function projectKey(ref: ProjectRef): string {
    return `${ref.platform}:${ref.host.trim().toLowerCase()}/${ref.project.trim().toLowerCase()}`;
}

export function parseProjectKey(key: string): ProjectRef {
    const match = /^(gitlab|github):([^/]+)\/(.+)$/.exec(key.trim());
    if (!match) throw new Error(`invalid project key: ${key}`);
    return {
        platform: match[1] as Platform,
        host: match[2]!,
        project: match[3]!,
    };
}

/** Отображаемое имя по умолчанию — последний сегмент пути проекта. */
export function projectTitle(project: string): string {
    const parts = project.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? project;
}
