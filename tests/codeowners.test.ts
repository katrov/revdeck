import { describe, expect, it } from 'vitest';
import { codeownersFor, parseCodeowners } from '../src/core/codeowners.js';

describe('CODEOWNERS', () => {
    it('parses patterns/owners and ignores comments', () => {
        const entries = parseCodeowners('# comment\n*.ts @frontend\n/docs/ @docs\n');
        expect(entries).toEqual([
            { pattern: '*.ts', owners: ['@frontend'] },
            { pattern: '/docs/', owners: ['@docs'] },
        ]);
    });

    it('uses the last matching rule and matches directories', () => {
        const entries = parseCodeowners(
            ['* @all', 'src/** @backend', 'src/ui/** @frontend', '/docs/ @docs'].join('\n'),
        );
        expect(codeownersFor(['src/ui/App.tsx', 'src/api.ts', 'docs/guide.md', 'README.md'], entries)).toEqual([
            { file: 'src/ui/App.tsx', owners: ['@frontend'] },
            { file: 'src/api.ts', owners: ['@backend'] },
            { file: 'docs/guide.md', owners: ['@docs'] },
            { file: 'README.md', owners: ['@all'] },
        ]);
    });
});
