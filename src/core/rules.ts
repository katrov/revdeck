import path from 'node:path';
import { existsSync } from 'node:fs';
import type { EffectiveRules, RuleDocument, RuleScope } from './types.js';
import type { ReviewConfig } from './config.js';
import { assertConfigPath, checksForPaths } from './config.js';
import { classifyFile, globToRegExp } from './glob.js';
import { readTextNoFollow } from './paths.js';
import { redactLine } from './redact.js';
import type { Locale } from './locale.js';

/** Жёсткий предохранитель на чтение одного файла, когда лимит отключён. */
const MAX_READ_BYTES = 16 * 1024 * 1024;

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
    /** Язык предупреждений и контекста правил. */
    language?: Locale;
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
    const language = options.language ?? 'ru';
    const t = (ru: string, en: string): string => (language === 'ru' ? ru : en);
    const warnings: string[] = [];
    const files = options.files.filter((file) => !config.rules.ignore.some((pattern) => globToRegExp(pattern).test(file)));
    const ignored = options.files.length - files.length;
    if (ignored > 0) warnings.push(`${ignored} ${t('файл(ов) исключены настройкой rules.ignore', 'file(s) excluded by rules.ignore')}`);

    const documentLimit = config.rules.maxDocumentBytes > 0 ? config.rules.maxDocumentBytes : Number.POSITIVE_INFINITY;
    const totalLimit = config.rules.maxTotalBytes > 0 ? config.rules.maxTotalBytes : Number.POSITIVE_INFINITY;
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
                warnings.push(`${t('документ', 'document')} ${relative} ${t('не найден', 'not found')}`);
            } else {
                try {
                    const readLimit = Number.isFinite(documentLimit) ? Math.max(documentLimit * 2, 4096) : MAX_READ_BYTES;
                    const raw = await readTextNoFollow(resolved, readLimit);
                    const truncated = Number.isFinite(documentLimit) && raw.length > documentLimit;
                    cached = { exists: true, text: truncated ? raw.slice(0, documentLimit) : raw, truncated };
                } catch (error) {
                    cached = { exists: false, text: '', truncated: false };
                    warnings.push(`${relative}: ${redactLine(error)}`);
                }
            }
            cache.set(resolved, cached);
        }
        const selectors = selector.includes('#') ? [selector.slice(selector.indexOf('#') + 1)] : [];
        const excerpt = extractExcerpt(cached.text, selectors, relative, warnings, language);
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
                warnings.push(`${file}: ${t('нет правил — путь не сопоставлен в rules.map, а rules.sources пуст', 'no rules — the path is not mapped in rules.map and rules.sources is empty')}`);
            }
        }
        const documents: RuleDocument[] = [];
        for (const doc of docs) {
            if (Number.isFinite(totalLimit) && totalBytes > totalLimit) {
                warnings.push(t('контекст правил обрезан: превышен лимит размера', 'rules context truncated: size limit exceeded'));
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
        if (!documents.length) warnings.push(t('общие правила: rules.sources пуст, документы не выбраны', 'general rules: rules.sources is empty, no documents selected'));
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
export function extractExcerpt(text: string, selectors: string[], label: string, warnings: string[], language: Locale = 'ru'): string {
    const t = (ru: string, en: string): string => (language === 'ru' ? ru : en);
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
                warnings.push(`${label}#${selector}: ${t('диапазон строк вне документа', 'line range is outside the document')}`);
                continue;
            }
            parts.push(lines.slice(start - 1, Math.min(end, lines.length)).join('\n'));
            continue;
        }
        const section = headingSection(text, selector);
        if (section === null) {
            warnings.push(`${label}#${selector}: ${t('секция не найдена', 'section not found')}`);
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
export function renderRules(rules: EffectiveRules, options: { withExcerpts?: boolean; maxBytes?: number; language?: Locale } = {}): string {
    const maxBytes = options.maxBytes ?? 200_000;
    const limit = maxBytes > 0 ? maxBytes : Number.POSITIVE_INFINITY;
    const withExcerpts = options.withExcerpts ?? true;
    const language = options.language ?? 'ru';
    const t = (ru: string, en: string): string => (language === 'ru' ? ru : en);
    const out: string[] = [];
    out.push(`# ${t('Правила ревью', 'Review rules')}${rules.configPath ? ` (${rules.configPath})` : ` (${t('автообнаружение', 'auto-discovery')})`}`);
    if (rules.warnings.length) out.push(`${t('Предупреждения', 'Warnings')}:\n${rules.warnings.map((item) => `- ${item}`).join('\n')}`);
    const seen = new Set<string>();
    for (const scope of rules.scopes) {
        out.push(`\n## ${scope.file || `(${t('общие правила', 'general rules')})`} — ${scope.kind}`);
        for (const doc of scope.documents) {
            const key = `${doc.path}#${doc.sections.join(',')}`;
            const label = `${doc.path}${doc.sections.length ? `#${doc.sections.join(', ')}` : ''}`;
            out.push(`- ${label}${doc.exists ? '' : ` (${t('не найден', 'not found')})`}`);
            if (!withExcerpts || !doc.exists) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(`\n> ${label}\n\n${doc.excerpt}${doc.truncated ? `\n\n[${t('документ обрезан', 'document truncated')}]` : ''}`);
            if (Number.isFinite(limit) && out.join('\n').length > limit) {
                out.push(`\n[${t('контекст правил обрезан по размеру', 'rules context truncated by size')}]`);
                return out.join('\n');
            }
        }
    }
    if (rules.checks.length) {
        out.push(`\n## ${t('Проверки проекта', 'Project checks')}`);
        for (const check of rules.checks) {
            out.push(`- ${check.id}${check.matched ? '' : ` (${t('не относится к diff', 'does not match the diff')})`}: \`${check.argv.join(' ')}\`${check.consent ? ` — ${t('требует согласия пользователя', 'requires user consent')}` : ''}`);
        }
    }
    return out.join('\n');
}
