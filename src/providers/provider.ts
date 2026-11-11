import type { ReviewConfig } from '../core/config.js';
import type { DiffFile, Platform, ReviewInfo, ReviewRef, Thread, User, Note } from '../core/types.js';
import type { Runner } from '../core/exec.js';
import { currentBranch, gitRemote } from '../core/git.js';
import { ProviderError } from '../core/errors.js';
import { parseReviewUrl } from '../core/refs.js';

export interface ProviderOptions {
    root: string;
    /** Для тестов: подмена запуска CLI. */
    runImpl?: Runner;
}

export interface ListOptions {
    scope?: 'open' | 'mine' | 'reviewing';
    limit?: number;
}

export interface ReviewListItem {
    ref: ReviewRef;
    title: string;
    author: string;
    updatedAt: string;
    state: string;
    draft: boolean;
    webUrl: string;
}

export interface CreateThreadInput {
    file: string;
    /** null — общий комментарий к ревью, без привязки к строке. */
    line: number | null;
    oldLine: number | null;
    body: string;
}

export interface CreatedThread {
    discussionId: string;
    noteId: string;
}

export interface ProviderCapabilities {
    reactions: boolean;
    resolve: boolean;
    nativeDrafts: boolean;
}

/**
 * Платформенный провайдер. Единственное место, которое знает про GitLab/GitHub.
 * Все методы — только те, что нужны ревью; ничего исполняющего код проекта.
 */
export interface Provider {
    readonly ref: ReviewRef;
    readonly platform: Platform;
    readonly capabilities: ProviderCapabilities;
    info(): Promise<ReviewInfo>;
    diff(): Promise<DiffFile[]>;
    threads(): Promise<Thread[]>;
    currentUser(): Promise<User>;
    list(options?: ListOptions): Promise<ReviewListItem[]>;
    findByBranch(branch: string): Promise<ReviewRef | null>;
    reply(thread: Thread, body: string): Promise<Note>;
    resolve(threadId: string, resolved: boolean): Promise<void>;
    react(noteId: string, emoji: string): Promise<{ active: boolean }>;
    createThread(input: CreateThreadInput): Promise<CreatedThread>;
}

export interface ProjectContext {
    platform: Platform;
    host: string;
    project: string;
}

/**
 * Вычисляет платформу/хост/проект по явным аргументам, конфигу и git remote.
 * Явные аргументы важнее конфига, конфиг важнее remote: так ревью нельзя
 * перенаправить, подменив `.git/config`.
 */
export async function projectContext(root: string, config: ReviewConfig, overrides: Partial<ProjectContext> = {}): Promise<ProjectContext> {
    const remote = await gitRemote(root);
    const platform = overrides.platform ?? (config.provider.type !== 'auto' ? config.provider.type : remote?.platform ?? undefined);
    const host = overrides.host ?? config.provider.host ?? remote?.host;
    const project = overrides.project ?? config.provider.project ?? remote?.project;
    if (!platform) {
        throw new ProviderError(
            'не удалось определить платформу: укажите provider.type в .revdeck.yml или --platform',
            'git remote не похож на GitHub/GitLab (самостоятельный хост определите явно)',
        );
    }
    if (!host || !project) {
        throw new ProviderError('не удалось определить хост и проект', 'укажите project и host в .revdeck.yml или передайте URL ревью');
    }
    return { platform, host, project };
}

export async function resolveReviewRef(
    options: { root: string; config: ReviewConfig; input?: string; platform?: Platform; project?: string; host?: string; branch?: string },
): Promise<ReviewRef> {
    const { root, config, input } = options;
    if (input && /^(https?:)?\/\//.test(input.trim())) {
        return parseReviewUrl(input);
    }
    const context = await projectContext(root, config, {
        ...(options.platform ? { platform: options.platform } : {}),
        ...(options.project ? { project: options.project } : {}),
        ...(options.host ? { host: options.host } : {}),
    });
    if (input && /^\d+$/.test(input.trim())) {
        return { ...context, number: Number(input.trim()) };
    }
    if (input && /^[^#!]+[#!]\d+$/.test(input.trim())) {
        return parseReviewUrl(input);
    }
    if (input) throw new ProviderError(`не удалось разобрать ревью: ${input}`);
    // Без номера ищем открытое ревью текущей ветки.
    const branch = options.branch ?? (await currentBranch(root));
    if (!branch || branch === 'HEAD') {
        throw new ProviderError('не удалось определить ветку для поиска ревью', 'передайте номер ревью явно');
    }
    const probe = await createProvider({ ...context, number: 0 }, { root });
    const found = await probe.findByBranch(branch);
    if (!found) throw new ProviderError(`открытое ревью для ветки ${branch} не найдено`, 'передайте номер ревью явно');
    return found;
}

export async function createProvider(ref: ReviewRef, options: ProviderOptions): Promise<Provider> {
    if (ref.platform === 'gitlab') {
        const { GitLabProvider } = await import('./gitlab.js');
        return new GitLabProvider(ref, options);
    }
    const { GitHubProvider } = await import('./github.js');
    return new GitHubProvider(ref, options);
}
