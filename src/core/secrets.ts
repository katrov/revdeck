import { classifyFile, globToRegExp } from './glob.js';

export interface SecretPattern {
    id: string;
    title: string;
    regex: RegExp;
}

export interface SecretFinding {
    rule: string;
    title: string;
    file: string;
    line: number;
    preview: string;
}

export interface SecretScanOptions {
    allowlist?: string[];
    includeTests?: boolean;
}

const PATTERNS: SecretPattern[] = [
    { id: 'aws-access-key', title: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
    { id: 'github-token', title: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
    { id: 'gitlab-token', title: 'GitLab token', regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
    { id: 'stripe-live-key', title: 'Stripe live key', regex: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
    { id: 'openai-key', title: 'OpenAI key', regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
    {
        id: 'private-key',
        title: 'Private key',
        regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    },
    {
        id: 'generic-secret',
        title: 'Generic secret assignment',
        regex: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*['"`][^'"`\n]{12,}['"`]/gi,
    },
];

/** Маскируем значение, чтобы оно не попало в UI, context или лог. */
export function maskSecret(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length <= 8) return '***';
    return `${trimmed.slice(0, 4)}…${trimmed.slice(-2)}`;
}

export function isAllowlisted(path: string, rule: string, allowlist: string[]): boolean {
    return allowlist.some((entry) => {
        const normalized = entry.trim();
        if (!normalized) return false;
        if (normalized === rule || normalized === `rule:${rule}`) return true;
        if (normalized.startsWith('rule:')) return false;
        return globToRegExp(normalized).test(path);
    });
}

/** Ищет секреты в уже подготовленных строках; возвращает только redacted-совпадения. */
export function scanLines(path: string, lines: { number: number; text: string }[], options: SecretScanOptions = {}): SecretFinding[] {
    if (!options.includeTests && classifyFile(path) === 'test') return [];
    const allowlist = options.allowlist ?? [];
    const findings: SecretFinding[] = [];
    for (const line of lines) {
        let specific = false;
        for (const pattern of PATTERNS) {
            if (isAllowlisted(path, pattern.id, allowlist)) continue;
            if (pattern.id === 'generic-secret' && specific) continue;
            pattern.regex.lastIndex = 0;
            const match = pattern.regex.exec(line.text);
            if (!match) continue;
            if (pattern.id !== 'generic-secret') specific = true;
            findings.push({
                rule: pattern.id,
                title: pattern.title,
                file: path,
                line: line.number,
                preview: maskSecret(match[0]),
            });
        }
    }
    return findings;
}
