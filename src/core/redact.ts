const TOKEN_PATTERNS: [RegExp, string][] = [
    [/\bgl[a-z]{2,6}-[A-Za-z0-9_-]{10,}/g, 'gl-***'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh-***'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'gh-***'],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'xox-***'],
    [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***'],
    [/\bsk-[A-Za-z0-9]{20,}/g, 'sk-***'],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'jwt-***'],
    [/\b[0-9a-f]{40,}\b/gi, 'hex-***'],
    [/((?:private[-_]token|access[-_]token|authorization|bearer|password|passwd|secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1***'],
    [/([?&](?:private_token|access_token|token|key)=)[^&\s]+/gi, '$1***'],
];

/** Убирает ANSI, управляющие символы и секреты из текста, который уходит в лог/UI. */
export function redact(value: unknown): string {
    let text = String(value ?? '')
        .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ');
    for (const [pattern, replacement] of TOKEN_PATTERNS) {
        text = text.replace(pattern, replacement);
    }
    return text.slice(0, 4000);
}

/** Однострочная версия для терминала. */
export function redactLine(value: unknown, max = 300): string {
    return redact(value).replace(/\s+/g, ' ').trim().slice(0, max);
}
