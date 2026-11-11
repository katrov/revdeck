import { setLocale } from '../src/core/locale.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEffectiveRules } from '../src/core/rules.js';
import { reviewConfigSchema } from '../src/core/config.js';

async function root(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-rules-'));
    await writeFile(path.join(dir, 'AGENTS.md'), '# Agents\n\n- общее правило\n');
    await writeFile(path.join(dir, 'guide.md'), '# Guide\n\n## Python\n\n- py rule\n\n## Go\n\n- go rule\n');
    return dir;
}

setLocale('ru');

describe('buildEffectiveRules', () => {
    it('selects documents and sections by path', async () => {
        const dir = await root();
        const config = reviewConfigSchema.parse({
            rules: {
                sources: ['AGENTS.md'],
                map: [{ match: 'src/**', docs: ['guide.md#Python'] }],
            },
        });
        const rules = await buildEffectiveRules({ root: dir, config, configPath: null, files: ['src/app.py', 'README.md'] });
        expect(rules.scopes).toHaveLength(2);
        expect(rules.scopes[0]!.documents[0]!.excerpt).toContain('py rule');
        expect(rules.scopes[0]!.documents[0]!.excerpt).not.toContain('go rule');
        // README не попал в map → используется sources.
        expect(rules.scopes[1]!.documents[0]!.path).toBe('AGENTS.md');
        expect(rules.warnings).toEqual([]);
    });

    it('warns when a path has no mapping and sources are empty', async () => {
        const dir = await root();
        const config = reviewConfigSchema.parse({ rules: { sources: [], map: [{ match: 'src/**', docs: ['guide.md'] }] } });
        const rules = await buildEffectiveRules({ root: dir, config, configPath: null, files: ['migrations/001.sql'] });
        expect(rules.warnings.join('\n')).toContain('нет правил');
        expect(rules.scopes[0]!.documents).toEqual([]);
    });

    it('warns about missing sections and missing documents', async () => {
        const dir = await root();
        const config = reviewConfigSchema.parse({ rules: { sources: [], map: [{ match: 'src/**', docs: ['guide.md#Nope', 'missing.md'] }] } });
        const rules = await buildEffectiveRules({ root: dir, config, configPath: null, files: ['src/x.ts'] });
        expect(rules.warnings.join('\n')).toContain('секция не найдена');
        expect(rules.warnings.join('\n')).toContain('не найден');
    });

    it('ignores paths from rules.ignore', async () => {
        const dir = await root();
        const config = reviewConfigSchema.parse({ rules: { sources: ['AGENTS.md'], ignore: ['**/generated/**'] } });
        const rules = await buildEffectiveRules({ root: dir, config, configPath: null, files: ['src/a.ts', 'src/generated/b.ts'] });
        expect(rules.scopes.map((scope) => scope.file)).toEqual(['src/a.ts']);
        expect(rules.warnings.join('\n')).toContain('исключены');
    });
});
