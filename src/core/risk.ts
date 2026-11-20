import type { ReviewStats } from './types.js';

export type ReviewRiskLevel = 'low' | 'medium' | 'high';
export type ReviewMode = 'fast' | 'full';

export interface RiskFile {
    path: string;
    status: string;
    additions: number;
    deletions: number;
}

export interface ReviewRisk {
    level: ReviewRiskLevel;
    mode: ReviewMode;
    files: number;
    changedLines: number;
    reasons: string[];
}

const SENSITIVE_PATHS: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /(^|\/)(migrations?|database|db|schema)(\/|\.|$)/i, reason: 'database-or-migration' },
    { pattern: /(^|\/)(auth|security|crypto|permissions?|payments?|billing)(\/|\.|$)/i, reason: 'security-sensitive' },
    { pattern: /(^|\/)\.github\/workflows\//i, reason: 'ci-workflow' },
    { pattern: /(^|\/)\.(gitlab-ci|circleci|buildkite)(\/|\.|$)/i, reason: 'ci-workflow' },
    { pattern: /(^|\/)(Jenkinsfile|azure-pipelines[^/]*|bitbucket-pipelines[^/]*)$/i, reason: 'ci-workflow' },
    { pattern: /(^|\/)(Dockerfile|docker-compose[^/]*)$/i, reason: 'container' },
    { pattern: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock)$/i, reason: 'dependency-lock' },
    { pattern: /(^|\/)(openapi|swagger|proto)(\/|\.|$)/i, reason: 'public-contract' },
];

const CONFIG_PATHS = /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config[^/]*|\.eslintrc[^/]*|jest\.config[^/]*|vitest\.config[^/]*|\.revdeck\.yml)$/i;
const DOC_PATH = /\.(md|mdx|txt|rst)$/i;

/**
 * Консервативная эвристика для выбора длины процедуры ревью. Она не заменяет
 * суждение агента: high/medium всегда идут полным проходом, fast — только
 * маленький diff без рискованных путей.
 */
export function assessReviewRisk(files: RiskFile[], stats: ReviewStats): ReviewRisk {
    const changedLines = stats.additions + stats.deletions;
    const reasons: string[] = [];
    const sensitive = files.filter((file) => SENSITIVE_PATHS.some((item) => item.pattern.test(file.path)));
    for (const file of sensitive.slice(0, 5)) {
        const matched = SENSITIVE_PATHS.find((item) => item.pattern.test(file.path));
        reasons.push(`${matched?.reason ?? 'sensitive'}:${file.path}`);
    }
    const configs = files.filter((file) => CONFIG_PATHS.test(file.path));
    if (configs.length) reasons.push(`config:${configs[0]!.path}${configs.length > 1 ? ` (+${configs.length - 1})` : ''}`);
    if (files.length > 40) reasons.push(`large:files:${files.length}`);
    if (changedLines > 1500) reasons.push(`large:lines:${changedLines}`);
    const deleted = files.filter((file) => file.status === 'deleted');
    if (deleted.length) reasons.push(`deleted-files:${deleted.length}`);

    const docsOnly = files.length > 0 && files.every((file) => DOC_PATH.test(file.path));
    if (docsOnly) reasons.push('docs-only');
    const small = files.length <= 5 && changedLines <= 150;
    if (small) reasons.push('small-diff');

    let level: ReviewRiskLevel;
    if (sensitive.length || files.length > 40 || changedLines > 1500 || deleted.length > 0) level = 'high';
    else if (docsOnly || (small && configs.length === 0)) level = 'low';
    else level = 'medium';

    return {
        level,
        mode: level === 'low' ? 'fast' : 'full',
        files: files.length,
        changedLines,
        reasons,
    };
}
