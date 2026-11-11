import { z } from 'zod';
import { readTextNoFollow, findConfigFile, findRepoRoot } from './paths.js';
import { ConfigError } from './errors.js';
import { parse as parseYaml } from 'yaml';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp } from './glob.js';

const matchSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

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
        .default({}),
    output: z
        .object({
            language: z.enum(['ru', 'en']).default('ru'),
        })
        .default({}),
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
        })
        .default({}),
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
        .default({}),
});

export type ReviewConfig = z.infer<typeof reviewConfigSchema>;

export interface LoadedConfig {
    config: ReviewConfig;
    path: string | null;
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
        throw new ConfigError(`${source}: некорректный YAML: ${(error as Error).message}`);
    }
    if (data === null || data === undefined) data = {};
    const result = reviewConfigSchema.safeParse(data);
    if (!result.success) {
        const issues = result.error.issues
            .slice(0, 10)
            .map((issue) => `${issue.path.join('.') || '<корень>'}: ${issue.message}`)
            .join('; ');
        throw new ConfigError(`${source}: ${issues}`, 'проверьте схему в docs/configuration.md');
    }
    return result.data;
}

export async function loadConfig(root = findRepoRoot()): Promise<LoadedConfig> {
    const warnings: string[] = [];
    const file = findConfigFile(root);
    let config: ReviewConfig;
    if (file) {
        config = parseConfig(await readTextNoFollow(file), path.relative(root, file) || file);
    } else {
        config = reviewConfigSchema.parse({});
        warnings.push('файл .revdeck.yml не найден: правила взяты из автообнаруженных документов');
    }
    if (!config.rules.sources.length && !config.rules.map.length) {
        const found = DISCOVERED_SOURCES.filter((item) => existsSync(path.join(root, item)));
        config.rules.sources = found;
        if (!found.length) {
            warnings.push('документы с правилами не найдены: ревью будет опираться только на код и здравый смысл');
        }
    }
    return { config, path: file, warnings };
}

/** Проверка, что путь из конфига не выводит за пределы репозитория. */
export function assertConfigPath(root: string, relative: string): string {
    const cleaned = relative.split('#')[0]!;
    const resolved = path.resolve(root, cleaned);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new ConfigError(`путь ${relative} выходит за пределы репозитория`);
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
