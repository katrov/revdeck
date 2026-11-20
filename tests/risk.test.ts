import { describe, expect, it } from 'vitest';
import { assessReviewRisk, type RiskFile } from '../src/core/risk.js';

const file = (path: string, additions = 10, deletions = 2, status = 'modified'): RiskFile => ({ path, additions, deletions, status });
const stats = (files: RiskFile[]) => ({
    files: files.length,
    additions: files.reduce((sum, item) => sum + item.additions, 0),
    deletions: files.reduce((sum, item) => sum + item.deletions, 0),
});

describe('review risk', () => {
    it('uses the fast pass for a small code diff', () => {
        const files = [file('src/a.ts'), file('src/b.ts')];
        expect(assessReviewRisk(files, stats(files))).toMatchObject({ level: 'low', mode: 'fast' });
    });

    it('uses a full pass for security-sensitive paths', () => {
        const files = [file('src/auth/token.ts')];
        const risk = assessReviewRisk(files, stats(files));
        expect(risk).toMatchObject({ level: 'high', mode: 'full' });
        expect(risk.reasons).toContain('security-sensitive:src/auth/token.ts');
    });

    it('uses a full pass for a large diff', () => {
        const files = Array.from({ length: 41 }, (_, index) => file(`src/file${index}.ts`, 40, 0));
        expect(assessReviewRisk(files, stats(files)).level).toBe('high');
    });

    it('uses the fast pass for docs-only changes', () => {
        const files = [file('docs/guide.md', 40, 10)];
        expect(assessReviewRisk(files, stats(files))).toMatchObject({ level: 'low', mode: 'fast' });
    });

    it('requires a full pass for config and deleted files', () => {
        const config = [file('package.json')];
        expect(assessReviewRisk(config, stats(config))).toMatchObject({ level: 'medium', mode: 'full' });
        const deleted = [file('src/removed.ts', 0, 20, 'deleted')];
        expect(assessReviewRisk(deleted, stats(deleted)).level).toBe('high');
    });
});
