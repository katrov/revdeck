import { existsSync } from 'node:fs';
import { lstat, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepoRoot } from '../core/paths.js';
import { tr } from '../core/locale.js';
import { writers } from './format.js';

export interface EjectOptions {
    /** Без подтверждения команда только показывает план. */
    yes: boolean;
    /** Оставить .revdeck.yml (например, чтобы удалить только адаптеры). */
    keepConfig?: boolean;
}

const CONFIG_FILES = ['.revdeck.yml', '.revdeck.yaml'] as const;

const COMMAND_FILES = [
    '.claude/commands/revdeck.md',
    '.cursor/commands/revdeck.md',
    '.codex/prompts/revdeck.md',
    '.gemini/commands/revdeck.toml',
    '.opencode/command/revdeck.md',
    '.github/prompts/revdeck.prompt.md',
] as const;

const SKILL_DIRS = ['.agents/skills/revdeck', '.claude/skills/revdeck'] as const;

const MCP_FILES = ['.mcp.json', '.cursor/mcp.json'] as const;

interface Change {
    path: string;
    action: string;
    remove: () => Promise<void>;
}

/**
 * Удаляет из репозитория только артефакты, которые создаёт `revdeck init`.
 * Чужие файлы и ключи не трогаются: команды и скиллы проверяются по содержимому,
 * а в MCP-конфиге удаляется только сервер `revdeck`.
 */
export async function runEject(rootInput: string, options: EjectOptions): Promise<void> {
    const root = findRepoRoot(rootInput);
    const changes: Change[] = [];
    const warnings: string[] = [];

    if (!options.keepConfig) {
        for (const name of CONFIG_FILES) {
            const file = path.join(root, name);
            if (existsSync(file)) changes.push({ path: name, action: tr('удалить конфиг', 'remove config'), remove: () => rm(file, { force: true }) });
        }
    }

    for (const name of SKILL_DIRS) {
        const target = path.join(root, name);
        if (!existsSync(target)) continue;
        const managed = await isManagedSkill(target);
        if (!managed) {
            warnings.push(`${name}: ${tr('скилл не похож на revdeck — оставляю', 'does not look like the revdeck skill — leaving it')}`);
            continue;
        }
        changes.push({ path: name, action: tr('удалить скилл', 'remove skill'), remove: () => rm(target, { recursive: true, force: true }) });
    }

    for (const name of COMMAND_FILES) {
        const file = path.join(root, name);
        if (!existsSync(file)) continue;
        const text = await readFile(file, 'utf8').catch(() => '');
        if (!/revdeck/i.test(text)) {
            warnings.push(`${name}: ${tr('файл не содержит revdeck — оставляю', 'file does not mention revdeck — leaving it')}`);
            continue;
        }
        changes.push({ path: name, action: tr('удалить команду', 'remove command'), remove: () => rm(file, { force: true }) });
    }

    for (const name of MCP_FILES) {
        const file = path.join(root, name);
        if (!existsSync(file)) continue;
        const text = await readFile(file, 'utf8').catch(() => '');
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(text) as Record<string, unknown>;
        } catch {
            warnings.push(`${name}: ${tr('не JSON — не трогаю', 'not JSON — leaving it untouched')}`);
            continue;
        }
        const servers = data.mcpServers as Record<string, unknown> | undefined;
        if (!servers || !('revdeck' in servers)) continue;
        changes.push({
            path: name,
            action: tr('убрать MCP-сервер revdeck', 'remove the revdeck MCP server'),
            remove: async () => {
                delete servers.revdeck;
                await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
            },
        });
    }

    const cache = path.join(root, '.revdeck');
    if (existsSync(cache)) {
        changes.push({ path: '.revdeck/', action: tr('удалить локальный кеш', 'remove local cache'), remove: () => rm(cache, { recursive: true, force: true }) });
    }

    const gitignore = path.join(root, '.gitignore');
    if (existsSync(gitignore)) {
        const text = await readFile(gitignore, 'utf8');
        if (/(^|\n)\.revdeck\/?\s*(\n|$)/.test(text)) {
            changes.push({
                path: '.gitignore',
                action: tr('убрать строку .revdeck/', 'remove the .revdeck/ line'),
                remove: async () => {
                    const next = text
                        .split('\n')
                        .filter((line) => line.trim() !== '.revdeck/' && line.trim() !== '.revdeck')
                        .join('\n');
                    await writeFile(gitignore, next);
                },
            });
        }
    }

    if (!changes.length) {
        writers.out(tr('в репозитории нет установленного revdeck', 'revdeck is not installed in this repository'));
        for (const warning of warnings) writers.err(`! ${warning}`);
        return;
    }

    writers.out(tr('Будет изменено:', 'Will change:'));
    for (const change of changes) writers.out(`  ${change.action}: ${change.path}`);
    for (const warning of warnings) writers.err(`! ${warning}`);

    if (!options.yes) {
        writers.out('');
        writers.out(tr('Ничего не удалено: добавьте --yes, чтобы применить.', 'Nothing was removed: add --yes to apply.'));
        return;
    }

    for (const change of changes) {
        await change.remove();
        writers.out(`✔ ${change.action}: ${change.path}`);
    }
    writers.out(tr('revdeck удалён из репозитория.', 'revdeck was removed from the repository.'));
}

async function isManagedSkill(target: string): Promise<boolean> {
    try {
        const info = await lstat(target);
        if (info.isSymbolicLink()) return true;
        if (!info.isDirectory()) return false;
        const skill = path.join(target, 'SKILL.md');
        if (!existsSync(skill)) return false;
        const text = await readFile(skill, 'utf8');
        return /^name:\s*revdeck\s*$/m.test(text) || /revdeck/i.test(text.slice(0, 2000));
    } catch {
        return false;
    }
}
