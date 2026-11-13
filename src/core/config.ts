import { z } from 'zod';
import { readTextNoFollow, findConfigFile, findLocalConfigFile, findRepoRoot } from './paths.js';
import { ConfigError } from './errors.js';
import { parse as parseYaml } from 'yaml';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './glob.js';
import { tr } from './locale.js';
import { DEFAULT_REVIEW_ROLES, REVIEW_ROLE_IDS } from './review-roles.js';

const matchSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

const customRoleSchema = z.object({
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    criteria: z.array(z.string().min(1).max(20)).max(20).default([]),
    focus: z.string().max(2000).optional(),
    instructions: z.string().max(8000).optional(),
});

export const reviewConfigSchema = z.object({
    version: z.literal(1).default(1),
    provider: z
        .object({
            /** auto — по git remote; иначе явная платформа. */
            type: z.enum(['auto', 'gitlab', 'github']).default('auto'),
            host: z.string().min(1).optional(),
            /** GitLab: group/project. GitHub: owner/repo. */
            project: z.string().min(1).optional(),
            /** База для локального diff, когда ревью идёт по ветке. */
            base: z.string().min(1).optional(),
        })
        .prefault({}),
    output: z
        .object({
            language: z.enum(['auto', 'ru', 'en']).default('auto'),
        })
        .prefault({}),
    review: z
        .object({
            /** Сколько независимых ревьюеров запускать. */
            agents: z.number().int().min(1).max(8).default(3),
            /** Роли агентов; встроенные id или ключи customRoles. */
            roles: z.array(z.string().min(1).max(64)).min(1).max(10).default([...DEFAULT_REVIEW_ROLES]),
            /** Пользовательские роли с описанием и инструкциями. */
            customRoles: z.record(z.string().min(1).max(64), customRoleSchema).default({}),
            /** Явные группы изменений; остальные группируются по типу и модулю. */
            groups: z
                .array(
                    z.object({
                        id: z.string().min(1).max(64),
                        title: z.string().min(1).max(120),
                        match: matchSchema,
                    }),
                )
                .max(100)
                .default([]),
            /** Опциональный скан секретов; по умолчанию выключен. */
            secrets: z
                .object({
                    enabled: z.boolean().default(false),
                    scan: z.enum(['diff', 'files', 'both']).default('diff'),
                    includeTests: z.boolean().default(false),
                    /** Glob-пути или id правила (`rule:generic-secret`). */
                    allowlist: z.array(z.string().min(1)).default([]),
                })
                .prefault({}),
            /** История версий ревью (снимки по commit SHA). */
            history: z
                .object({
                    enabled: z.boolean().default(false),
                    keep: z.number().int().min(1).max(100).default(20),
                })
                .prefault({}),
            /** Запрет любых изменений: drafts, findings, публикация. */
            readOnly: z.boolean().default(false),
        })
        .prefault({})
        .superRefine((value, ctx) => {
            for (const key of Object.keys(value.customRoles)) {
                if ((REVIEW_ROLE_IDS as readonly string[]).includes(key)) {
                    ctx.addIssue({ code: 'custom', path: ['customRoles', key], message: `role ${key} is built in and cannot be overridden` });
                }
            }
            for (const role of value.roles) {
                if (!(REVIEW_ROLE_IDS as readonly string[]).includes(role) && !(role in value.customRoles)) {
                    ctx.addIssue({ code: 'custom', path: ['roles'], message: `unknown role: ${role}` });
                }
            }
        }),
    rules: z
        .object({
            /** Общие документы, если ни одна строка map не подошла. Пусто — автообнаружение. */
            sources: z.array(z.string().min(1)).default([]),
            /** Привязка путей к документам: match — glob, docs — пути с необязательной секцией `#…`. */
            map: z
                .array(
                    z.object({
                        match: matchSchema,
                        docs: z.array(z.string().min(1)).min(1),
                        note: z.string().optional(),
                    }),
                )
                .default([]),
            /** Пути, которые не ревьюятся (сгенерированный код и т.п.). */
            ignore: z.array(z.string().min(1)).default([]),
            /** 0 — без ограничения; иначе документ обрезается до этого размера. */
            maxDocumentBytes: z.number().int().nonnegative().default(0),
            /** 0 — без ограничения; иначе общий контекст правил обрезается. */
            maxTotalBytes: z.number().int().nonnegative().default(0),
        })
        .prefault({}),
    checks: z
        .array(
            z.object({
                id: z.string().min(1),
                name: z.string().optional(),
                /** argv без shell: первым идёт исполняемый файл. */
                argv: z.array(z.string()).min(1),
                /** Запускать, только если diff затронул эти glob-пути. */
                when: z.array(z.string()).default([]),
                consent: z.boolean().default(true),
                timeoutMs: z.number().int().positive().max(3_600_000).default(300_000),
            }),
        )
        .default([]),
    publish: z
        .object({
            requireApproval: z.boolean().default(true),
            maxComments: z.number().int().positive().max(200).default(50),
        })
        .prefault({}),
});

export type ReviewConfig = z.infer<typeof reviewConfigSchema>;

export interface LoadedConfig {
    config: ReviewConfig;
    /** Базовый .revdeck.yml, если он есть. */
    path: string | null;
    /** Личный .revdeck.local.yml, если он есть. */
    localPath: string | null;
    warnings: string[];
}

/** Документы, которые находятся автоматически, если конфиг ничего не задаёт. */
const DISCOVERED_SOURCES = [
    'AGENTS.md',
    'CLAUDE.md',
    'CONTRIBUTING.md',
    'docs/ARCHITECTURE.md',
    'docs/Architecture.md',
    'docs/STYLEGUIDE.md',
    'docs/Styleguide.md',
    'docs/CONTRIBUTING.md',
];

export function parseConfig(text: string, source = '.revdeck.yml'): ReviewConfig {
    let data: unknown;
    try {
        data = parseYaml(text);
    } catch (error) {
        throw new ConfigError(tr(`${source}: некорректный YAML: ${(error as Error).message}`, `${source}: invalid YAML: ${(error as Error).message}`));
    }
    if (data === null || data === undefined) data = {};
    const result = reviewConfigSchema.safeParse(data);
    if (!result.success) {
        const issues = result.error.issues
            .slice(0, 10)
            .map((issue) => `${issue.path.join('.') || '<корень>'}: ${issue.message}`)
            .join('; ');
        throw new ConfigError(`${source}: ${issues}`, tr('проверьте схему в docs/configuration.md', 'check the schema in docs/configuration.md'));
    }
    return result.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseYamlData(text: string, source: string): unknown {
    try {
        return parseYaml(text);
    } catch (error) {
        throw new ConfigError(tr(`${source}: некорректный YAML: ${(error as Error).message}`, `${source}: invalid YAML: ${(error as Error).message}`));
    }
}

/** Локальный файл переопределяет объекты рекурсивно, массивы заменяет целиком. */
function mergeConfigData(base: unknown, local: unknown): unknown {
    if (!isRecord(base) || !isRecord(local)) return local;
    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(local)) {
        const current = result[key];
        result[key] = isRecord(current) && isRecord(value) ? mergeConfigData(current, value) : value;
    }
    return result;
}

export async function loadConfig(root = findRepoRoot()): Promise<LoadedConfig> {
    const warnings: string[] = [];
    const file = findConfigFile(root);
    const localFile = findLocalConfigFile(root);
    const baseData = file ? parseYamlData(await readTextNoFollow(file), path.relative(root, file) || file) : {};
    const localData = localFile ? parseYamlData(await readTextNoFollow(localFile), path.relative(root, localFile) || localFile) : {};
    if (!file && !localFile) {
        warnings.push(tr('файл .revdeck.yml не найден: правила взяты из автообнаруженных документов', '.revdeck.yml not found: rules come from auto-discovered documents'));
    }
    const merged = mergeConfigData(baseData, localData);
    const config = reviewConfigSchema.parse(merged);
    // Базовый read-only нельзя снять личным файлом: OR, а не обычный override.
    const baseReadOnly = isRecord(baseData) && isRecord(baseData.review) && baseData.review.readOnly === true;
    const localReadOnly = isRecord(localData) && isRecord(localData.review) && localData.review.readOnly === true;
    config.review.readOnly = baseReadOnly || localReadOnly;
    if (!config.rules.sources.length && !config.rules.map.length) {
        const found = DISCOVERED_SOURCES.filter((item) => existsSync(path.join(root, item)));
        config.rules.sources = found;
        if (!found.length) {
            warnings.push(tr('документы с правилами не найдены: ревью будет опираться только на код и здравый смысл', 'no rule documents found: the review will rely on the code only'));
        }
    }
    return {
        config,
        path: file,
        localPath: localFile,
        warnings,
    };
}

/** Проверка, что путь из конфига не выводит за пределы репозитория. */
export function assertConfigPath(root: string, relative: string): string {
    const cleaned = relative.split('#')[0]!;
    const resolved = path.resolve(root, cleaned);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new ConfigError(tr(`путь ${relative} выходит за пределы репозитория`, `path ${relative} escapes the repository`));
    }
    return resolved;
}

/** Какие проверки из конфига относятся к изменённым путям. */
export function checksForPaths(
    config: ReviewConfig,
    paths: string[],
): { id: string; name: string; argv: string[]; consent: boolean; matched: boolean }[] {
    return config.checks.map((check) => {
        const matched = !check.when.length || paths.some((file) => check.when.some((pattern) => globToRegExp(pattern).test(file)));
        return { id: check.id, name: check.name ?? check.id, argv: check.argv, consent: check.consent, matched };
    });
}
