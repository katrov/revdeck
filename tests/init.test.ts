import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/core/locale.js';
import { runEject } from '../src/cli/eject.js';
import { runInit } from '../src/cli/init.js';

let root: string;

beforeEach(async () => {
    setLocale('ru');
    root = await mkdtemp(path.join(tmpdir(), 'revdeck-eject-'));
    await mkdir(path.join(root, '.git'), { recursive: true });
});

async function seed(): Promise<void> {
    await writeFile(path.join(root, '.revdeck.yml'), 'version: 1\n');
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\n.revdeck/\n');
    await mkdir(path.join(root, '.agents', 'skills', 'revdeck', 'agents'), { recursive: true });
    await writeFile(path.join(root, '.agents', 'skills', 'revdeck', 'SKILL.md'), '---\nname: revdeck\n---\n');
    await mkdir(path.join(root, '.claude', 'commands'), { recursive: true });
    await writeFile(path.join(root, '.claude', 'commands', 'revdeck.md'), 'Run revdeck context.\n');
    await mkdir(path.join(root, '.github', 'prompts'), { recursive: true });
    await writeFile(path.join(root, '.github', 'prompts', 'revdeck.prompt.md'), 'This is a user prompt without the tool name.\n');
    await writeFile(
        path.join(root, '.mcp.json'),
        JSON.stringify({ mcpServers: { revdeck: { command: 'npx' }, other: { command: 'other' } }, keep: true }, null, 2),
    );
    await mkdir(path.join(root, '.revdeck'), { recursive: true });
    await writeFile(path.join(root, '.revdeck', 'state.json'), '{}');
}

describe('revdeck init', () => {
    const options = { force: false, adapters: ['claude'], noService: true, locale: 'en' as const, outputLanguage: 'en' as const };

    it('keeps the canonical skill in .agents and links only SKILL.md into .claude', async () => {
        await runInit(root, options);

        expect(existsSync(path.join(root, '.agents', 'skills', 'revdeck', 'SKILL.md'))).toBe(true);
        expect(existsSync(path.join(root, '.agents', 'skills', 'revdeck', 'Review.md'))).toBe(true);
        expect(existsSync(path.join(root, '.agents', 'skills', 'revdeck', 'agents', 'openai.yaml'))).toBe(true);

        const dir = path.join(root, '.claude', 'skills', 'revdeck');
        const link = path.join(dir, 'SKILL.md');
        expect((await lstat(dir)).isDirectory()).toBe(true);
        expect((await lstat(link)).isSymbolicLink()).toBe(true);
        expect((await readlink(link)).replaceAll('\\', '/')).toBe('../../../.agents/skills/revdeck/SKILL.md');
        expect(existsSync(path.join(dir, 'Review.md'))).toBe(false);
        expect(existsSync(path.join(dir, 'agents'))).toBe(false);
        expect(existsSync(path.join(root, '.claude', 'commands', 'revdeck.md'))).toBe(true);
        expect(existsSync(path.join(root, '.mcp.json'))).toBe(true);
    });

    it('replaces an old copied .claude skill with a single SKILL.md link', async () => {
        await mkdir(path.join(root, '.claude', 'skills', 'revdeck'), { recursive: true });
        await writeFile(path.join(root, '.claude', 'skills', 'revdeck', 'SKILL.md'), '---\nname: revdeck\n---\n');
        await writeFile(path.join(root, '.claude', 'skills', 'revdeck', 'Review.md'), 'old copy');

        await runInit(root, options);

        const dir = path.join(root, '.claude', 'skills', 'revdeck');
        expect((await lstat(path.join(dir, 'SKILL.md'))).isSymbolicLink()).toBe(true);
        expect(existsSync(path.join(dir, 'Review.md'))).toBe(false);
    });
});

describe('revdeck eject', () => {
    it('removes only revdeck-owned artifacts and keeps foreign files', async () => {
        await seed();
        await runEject(root, { yes: true });

        expect(existsSync(path.join(root, '.revdeck.yml'))).toBe(false);
        expect(existsSync(path.join(root, '.agents', 'skills', 'revdeck'))).toBe(false);
        expect(existsSync(path.join(root, '.claude', 'commands', 'revdeck.md'))).toBe(false);
        expect(existsSync(path.join(root, '.revdeck'))).toBe(false);
        expect(existsSync(path.join(root, '.github', 'prompts', 'revdeck.prompt.md'))).toBe(true);

        const mcp = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8')) as { mcpServers: Record<string, unknown>; keep: boolean };
        expect(mcp.keep).toBe(true);
        expect(mcp.mcpServers.other).toEqual({ command: 'other' });
        expect(mcp.mcpServers.revdeck).toBeUndefined();
        expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n');
    });

    it('removes a .claude skill symlink without touching its target', async () => {
        await seed();
        await mkdir(path.join(root, '.claude', 'skills'), { recursive: true });
        await symlink('../../.agents/skills/revdeck', path.join(root, '.claude', 'skills', 'revdeck'));

        await runEject(root, { yes: true, keepConfig: true });

        expect(existsSync(path.join(root, '.claude', 'skills', 'revdeck'))).toBe(false);
        expect(existsSync(path.join(root, '.revdeck.yml'))).toBe(true);
    });

    it('only prints the plan without --yes', async () => {
        await seed();
        await runEject(root, { yes: false });

        expect(existsSync(path.join(root, '.revdeck.yml'))).toBe(true);
        expect(existsSync(path.join(root, '.agents', 'skills', 'revdeck'))).toBe(true);
        expect(existsSync(path.join(root, '.mcp.json'))).toBe(true);
    });
});
