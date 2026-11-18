import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from '../src/core/config.js';
import { assertSafeDocument } from '../src/core/doc-policy.js';
import { buildEffectiveRules } from '../src/core/rules.js';
import { run } from '../src/core/exec.js';

const roots: string[] = [];

async function git(root: string, ...args: string[]): Promise<void> {
    await run('git', ['-C', root, ...args], { timeoutMs: 10_000 });
}

async function repo(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'revdeck-docs-'));
    roots.push(root);
    await git(root, 'init', '-q');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    return root;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('document policy', () => {
    it('reads tracked rule documents and rejects untracked/secret paths', async () => {
        const root = await repo();
        await writeFile(path.join(root, 'AGENTS.md'), '# Rules\n');
        await writeFile(path.join(root, 'docs', 'app.yaml'), 'title: app\n');
        await writeFile(path.join(root, '.env'), 'API_KEY=secret\n');
        await git(root, 'add', 'AGENTS.md', 'docs/app.yaml');
        await git(root, 'add', '-f', '.env');

        await expect(assertSafeDocument(root, 'AGENTS.md', 'rules')).resolves.toContain('AGENTS.md');
        await expect(assertSafeDocument(root, 'docs/app.yaml', 'profile')).resolves.toContain('app.yaml');
        await expect(assertSafeDocument(root, 'docs/app.yaml', 'rules')).rejects.toThrow(/недопустимый тип|unsupported document type/);
        await expect(assertSafeDocument(root, '.env', 'rules')).rejects.toThrow(/секрет|secret/);
        await expect(assertSafeDocument(root, '.git/config', 'rules')).rejects.toThrow(/секрет|secret/);
        await expect(assertSafeDocument(root, 'docs/missing.md', 'rules')).rejects.toThrow(/не отслеживается|not tracked/);
    });

    it('does not expose gitignored .env through rules', async () => {
        const root = await repo();
        await writeFile(path.join(root, '.env'), 'API_KEY=secret\n');
        const config = parseConfig('version: 1\nrules:\n  sources: [.env]\n');
        const rules = await buildEffectiveRules({ root, config, configPath: null, files: ['src/a.ts'], language: 'en' });
        expect(rules.scopes[0]?.documents[0]?.excerpt).toBe('');
        expect(rules.warnings.join('\n')).toMatch(/секрет|secret/);
    });

    it('ignores .revdeck.local.yml that came from the repository', async () => {
        const root = await repo();
        await writeFile(path.join(root, '.revdeck.yml'), 'version: 1\n');
        await writeFile(path.join(root, '.revdeck.local.yml'), 'rules:\n  sources: [.env]\n');
        await git(root, 'add', '.revdeck.yml', '.revdeck.local.yml');

        const loaded = await loadConfig(root);
        expect(loaded.localPath).toBeNull();
        expect(loaded.warnings.join('\n')).toMatch(/отслеживается git|tracked by git/);
        expect(loaded.config.rules.sources).not.toContain('.env');
    });

    it('still applies an untracked local override', async () => {
        const root = await repo();
        await writeFile(path.join(root, '.revdeck.yml'), 'version: 1\n');
        await writeFile(path.join(root, '.revdeck.local.yml'), 'rules:\n  sources: [.env]\n');
        await git(root, 'add', '.revdeck.yml');

        const loaded = await loadConfig(root);
        expect(loaded.localPath).not.toBeNull();
        expect(loaded.config.rules.sources).toContain('.env');
    });
});
