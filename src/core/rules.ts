import path from 'node:path';
import { existsSync } from 'node:fs';
import type { EffectiveRules, RuleDocument, RuleScope } from './types.js';
import type { ReviewConfig } from './config.js';
import { assertConfigPath, checksForPaths } from './config.js';
import { classifyFile, globToRegExp } from './glob.js';
import { readTextNoFollow } from './paths.js';
import { redactLine } from './redact.js';

const MAX_DOC_BYTES = 96 * 1024;
const MAX_TOTAL_BYTES = 320 * 1024;

interface CachedDoc {
    exists: boolean;
    text: string;
    truncated: boolean;
}

export interface BuildRulesOptions {
    root: string;
    config: ReviewConfig;
    configPath: string | null;
    files: string[];
}

/**
 * Компилятор правил: для каждого изменённого файла выбирает документы
 * репозитория и ровно те секции, по которым его надо проверять.
 *
 * Это замена ручной таблице «путь → документ»: агент получает детерминированный
 * и ограниченный по размеру контекст вместо всего docs/.
 */
export async function buildEffectiveRules(options: BuildRulesOptions): Promise<EffectiveRules> {
    const { root, config, configPath } = options;
    const warnings: string[] = [];
    const files = options.files.filter((file) => !config.rules.ignore.some((pattern) => globToRegExp(pattern).test(file)));
    const ignored = options.files.length - files.length;
    if (ignored > 0) warnings.push(`${ignored} файл(ов) исключены настройкой rules.ignore`);

    const cache = new Map<string, CachedDoc>();
    let totalBytes = 0;

    const readDoc = async (selector: string): Promise<RuleDocument> => {
        const [rawPath] = selector.split('#');
        const relative = rawPath!;
        let resolved: string;
        try {
            resolved = assertConfigPath(root, relative);
        } catch (error) {
            warnings.push(`${relative}: ${(error as Error).message}`);
            return { path: relative, exists: false, sections: [], excerpt: '', truncated: false };
        }
        let cached = cache.get(resolved);
        if (!cached) {
            if (!existsSync(resolved)) {
                cached = { exists: false, text: '', truncated: false };
                warnings.push(`документ ${relative} не найден`);
            } else {
                try {
                    const raw = await readTextNoFollow(resolved, MAX_DOC_BYTES * 2);
                    const truncated = raw.length > MAX_DOC_BYTES;
                    cached = { exists: true, text: truncated ? raw.slice(0, MAX_DOC_BYTES) : raw, truncated };
                } catch (error) {
                    cached = { exists: false, text: '', truncated: false };
                    warnings.push(`${relative}: ${redactLine(error)}`);
                }
            }
            cache.set(resolved, cached);
        }
        const selectors = selector.includes('#') ? [selector.slice(selector.indexOf('#') + 1)] : [];
        const excerpt = extractExcerpt(cached.text, selectors, relative, warnings);
        totalBytes += excerpt.length;
        return { path: relative, exists: cached.exists, sections: selectors, excerpt, truncated: cached.truncated };
    };

    const scopes: RuleScope[] = [];
    for (const file of files) {
        const docs = new Set<string>();
        for (const entry of config.rules.map) {
            const patterns = Array.isArray(entry.match) ? entry.match : [entry.match];
            if (patterns.some((pattern) => globToRegExp(pattern).test(file))) {
                for (const doc of entry.docs) docs.add(doc);
            }
        }
        if (!docs.size) {
            for (const doc of config.rules.sources) docs.add(doc);
            if (!docs.size) {
                warnings.push(`${file}: нет правил — путь не сопоставлен в rules.map, а rules.sources пуст`);
            }
        }
        const documents: RuleDocument[] = [];
        for (const doc of docs) {
            if (totalBytes > MAX_TOTAL_BYTES) {
                warnings.push('контекст правил обрезан: превышен лимит размера');
                break;
            }
            documents.push(await readDoc(doc));
        }
        scopes.push({ file, kind: classifyFile(file), documents });
    }

    // Общие правила (если файлов нет) — чтобы ревью по описанию MR тоже имело критерии.
    if (!files.length) {
        const documents: RuleDocument[] = [];
        for (const doc of config.rules.sources) documents.push(await readDoc(doc));
        if (!documents.length) warnings.push('общие правила: rules.sources пуст, документы не выбраны');
        scopes.push({ file: '', kind: 'other', documents });
    }

    return {
        configPath: configPath ? path.relative(root, configPath) : null,
        scopes,
        checks: checksForPaths(config, files),
        warnings: [...new Set(warnings)],
    };
}

/**
 * Вырезает запрошенные секции документа.
 * Поддерживает `#Заголовок`, `#anchor`, `#L10-L20`, `#10-20`.
 */
export function extractExcerpt(text: string, selectors: string[], label: string, warnings: string[]): string {
    if (!text) return '';
    if (!selectors.length) return text;
    const parts: string[] = [];
    for (const selector of selectors) {
        const range = /^L?(\d+)(?:-L?(\d+))?$/.exec(selector.trim());
        if (range) {
            const start = Number(range[1]);
            const end = range[2] ? Number(range[2]) : start;
            const lines = text.split('\n');
            if (start < 1 || end < start || start > lines.length) {
                warnings.push(`${label}#${selector}: диапазон строк вне документа`);
                continue;
            }
            parts.push(lines.slice(start - 1, Math.min(end, lines.length)).join('\n'));
            continue;
        }
        const section = headingSection(text, selector);
        if (section === null) {
            warnings.push(`${label}#${selector}: секция не найдена`);
            continue;
        }
        parts.push(section);
    }
    return parts.join('\n\n');
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function headingSection(text: string, wanted: string): string | null {
    const lines = text.split('\n');
    const target = normalizeHeading(wanted);
    let start = -1;
    let level = 0;
    for (let index = 0; index < lines.length; index++) {
        const match = HEADING.exec(lines[index]!);
        if (!match) continue;
        if (normalizeHeading(match[2]!) === target) {
            start = index;
            level = match[1]!.length;
            break;
        }
    }
    if (start < 0) return null;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index++) {
        const match = HEADING.exec(lines[index]!);
        if (match && match[1]!.length <= level) {
            end = index;
            break;
        }
    }
    return lines.slice(start, end).join('\n').trimEnd();
}

/** `#Слои и зависимости` и `#layers` приводятся к одному виду. */
export function normalizeHeading(value: string): string {
    return value
        .replace(/^#+/, '')
        .replace(/[*_`]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

/** Компактный markdown-контекст правил для агента (MCP/CLI). */
export function renderRules(rules: EffectiveRules, options: { withExcerpts?: boolean; maxBytes?: number } = {}): string {
    const maxBytes = options.maxBytes ?? 200_000;
    const withExcerpts = options.withExcerpts ?? true;
    const out: string[] = [];
    out.push(`# Правила ревью${rules.configPath ? ` (${rules.configPath})` : ' (автообнаружение)'}`);
    if (rules.warnings.length) out.push(`Предупреждения:\n${rules.warnings.map((item) => `- ${item}`).join('\n')}`);
    const seen = new Set<string>();
    for (const scope of rules.scopes) {
        out.push(`\n## ${scope.file || '(общие правила)'} — ${scope.kind}`);
        for (const doc of scope.documents) {
            const key = `${doc.path}#${doc.sections.join(',')}`;
            const label = `${doc.path}${doc.sections.length ? `#${doc.sections.join(', ')}` : ''}`;
            out.push(`- ${label}${doc.exists ? '' : ' (не найден)'}`);
            if (!withExcerpts || !doc.exists) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(`\n> ${label}\n\n${doc.excerpt}${doc.truncated ? '\n\n[документ обрезан]' : ''}`);
            if (out.join('\n').length > maxBytes) {
                out.push('\n[контекст правил обрезан по размеру]');
                return out.join('\n');
            }
        }
    }
    if (rules.checks.length) {
        out.push('\n## Проверки проекта');
        for (const check of rules.checks) {
            out.push(`- ${check.id}${check.matched ? '' : ' (не относится к diff)'}: \`${check.argv.join(' ')}\`${check.consent ? ' — требует согласия пользователя' : ''}`);
        }
    }
    return out.join('\n');
}
