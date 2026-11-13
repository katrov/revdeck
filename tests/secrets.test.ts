import { describe, expect, it } from 'vitest';
import { scanLines } from '../src/core/secrets.js';

describe('secret scan', () => {
    it('finds known keys and masks values', () => {
        const findings = scanLines('src/config.ts', [
            { number: 3, text: 'const key = "AKIAABCDEFGHIJKLMNOP";' },
            { number: 4, text: 'const token = "ghp_abcdefghijklmnopqrstuvwxyz012345";' },
        ]);
        expect(findings.map((item) => item.rule)).toEqual(['aws-access-key', 'github-token']);
        expect(findings[0]!.preview).not.toContain('AKIAABCDEFGHIJKLMNOP');
        expect(findings[0]!.preview).toContain('…');
    });

    it('respects rule and path allowlists and skips tests by default', () => {
        expect(scanLines('src/a.ts', [{ number: 1, text: 'AKIAABCDEFGHIJKLMNOP' }], { allowlist: ['rule:aws-access-key'] })).toEqual([]);
        expect(scanLines('src/a.ts', [{ number: 1, text: 'AKIAABCDEFGHIJKLMNOP' }], { allowlist: ['src/**'] })).toEqual([]);
        expect(scanLines('tests/a.test.ts', [{ number: 1, text: 'AKIAABCDEFGHIJKLMNOP' }])).toEqual([]);
        expect(scanLines('tests/a.test.ts', [{ number: 1, text: 'AKIAABCDEFGHIJKLMNOP' }], { includeTests: true })).toHaveLength(1);
    });
});
