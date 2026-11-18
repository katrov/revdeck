import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig, readConfigFile, readConfigPrefix } from '../src/core/config.js';
import { toHostRoot } from '../src/core/paths.js';
import { buildEffectiveRules } from '../src/core/rules.js';

describe('devcontainer root mapping', () => {
    const container = path.resolve('/workspaces/app');
    const host = path.resolve('/home/dev/app');

    it('maps a container worktree to the host worktree', () => {
        expect(toHostRoot(container, host, container)).toBe(host);
        expect(toHostRoot(path.join(container, 'src/main.ts'), host, container)).toBe(path.join(host, 'src/main.ts'));
    });

    it('leaves paths outside the container worktree unchanged', () => {
        expect(toHostRoot(path.resolve('/workspaces/other'), host, container)).toBe(path.resolve('/workspaces/other'));
        expect(toHostRoot(container, undefined, container)).toBe(container);
    });

    it('makes the host config visible through the mapped root', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'revdeck-host-'));
        try {
            await writeFile(path.join(root, '.revdeck.yml'), 'version: 1\n');
            const loaded = await loadConfig(toHostRoot(container, root, container));
            expect(loaded.path).toBe(path.join(root, '.revdeck.yml'));
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('config file reads', () => {
    it.skipIf(process.platform === 'win32')('refuses a symlinked directory that escapes the root', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'revdeck-paths-'));
        const outside = await mkdtemp(path.join(tmpdir(), 'revdeck-outside-'));
        try {
            await writeFile(path.join(outside, 'secret.md'), 'TOP-SECRET');
            await symlink(outside, path.join(root, 'docs'));
            await expect(readConfigFile(root, 'docs/secret.md')).rejects.toThrow(/escapes the repository/);
            await expect(readConfigPrefix(root, 'docs/secret.md', 100)).rejects.toThrow(/escapes the repository/);
        } finally {
            await rm(root, { recursive: true, force: true });
            await rm(outside, { recursive: true, force: true });
        }
    });

    it.skipIf(process.platform === 'win32')('refuses a final symlink that escapes the root', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'revdeck-paths-'));
        const outside = await mkdtemp(path.join(tmpdir(), 'revdeck-outside-'));
        try {
            await writeFile(path.join(outside, 'secret.md'), 'TOP-SECRET');
            await symlink(path.join(outside, 'secret.md'), path.join(root, 'secret.md'));
            await expect(readConfigFile(root, 'secret.md')).rejects.toThrow(/escapes the repository/);
        } finally {
            await rm(root, { recursive: true, force: true });
            await rm(outside, { recursive: true, force: true });
        }
    });

    it('still reads documents inside the root', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'revdeck-paths-'));
        try {
            await mkdir(path.join(root, 'docs'), { recursive: true });
            await writeFile(path.join(root, 'docs', 'App.md'), 'Inside');
            await expect(readConfigFile(root, 'docs/App.md')).resolves.toBe('Inside');
            await expect(readConfigPrefix(root, 'docs/App.md', 100)).resolves.toEqual({ text: 'Inside', truncated: false });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it.skipIf(process.platform === 'win32')('does not leak an escaped rule document', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'revdeck-paths-'));
        const outside = await mkdtemp(path.join(tmpdir(), 'revdeck-outside-'));
        try {
            await writeFile(path.join(outside, 'secret.md'), 'TOP-SECRET');
            await symlink(outside, path.join(root, 'docs'));
            const config = parseConfig('version: 1\nrules:\n  sources: [docs/secret.md]\n');
            const rules = await buildEffectiveRules({
                root,
                config,
                configPath: null,
                files: ['src/app.ts'],
                language: 'en',
            });
            const excerpt = rules.scopes[0]?.documents[0]?.excerpt ?? '';
            expect(excerpt).not.toContain('TOP-SECRET');
            expect(rules.warnings.join('\n')).toMatch(/escapes the repository/);
        } finally {
            await rm(root, { recursive: true, force: true });
            await rm(outside, { recursive: true, force: true });
        }
    });
});
