import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import {
    devcontainerRunDir,
    devcontainerSocketPath,
    devcontainerStateDir,
    ensureDir,
    findRepoRoot,
} from '../core/paths.js';
import { isRecord } from '../core/jsonc.js';
import { tr } from '../core/locale.js';
import { writers } from './format.js';

export const CONTAINER_RUNTIME_DIR = '/run/revdeck';
export const CONTAINER_STATE_DIR = '/var/lib/revdeck';
export const CONTAINER_UI_HOST = 'host.docker.internal';

export interface DevcontainerMount {
    type: 'bind';
    source: string;
    target: string;
    readonly?: boolean;
}

export interface DevcontainerPatch {
    mounts: DevcontainerMount[];
    containerEnv: Record<string, string>;
    remoteEnv: Record<string, string>;
    runArgs: string[];
}

export interface DevcontainerOptions {
    write: boolean;
}

/**
 * Патч devcontainer: сокет и state моста демона хоста монтируются в контейнер.
 * В JSON попадают только ${localEnv:...}, чтобы общий файл не содержал путь
 * конкретного пользователя.
 */
export function devcontainerPatch(): DevcontainerPatch {
    const bridge = '${localEnv:HOME}${localEnv:USERPROFILE}/.local/state/revdeck/devcontainer';
    return {
        mounts: [
            { type: 'bind', source: `${bridge}/run`, target: CONTAINER_RUNTIME_DIR },
            { type: 'bind', source: `${bridge}/state`, target: CONTAINER_STATE_DIR, readonly: true },
        ],
        containerEnv: {
            REVDECK_RUNTIME_DIR: CONTAINER_RUNTIME_DIR,
            REVDECK_STATE_DIR: CONTAINER_STATE_DIR,
            REVDECK_DEV_CONTAINER: '1',
            REVDECK_UI_HOST: CONTAINER_UI_HOST,
        },
        remoteEnv: {
            REVDECK_RUNTIME_DIR: CONTAINER_RUNTIME_DIR,
            REVDECK_STATE_DIR: CONTAINER_STATE_DIR,
            REVDECK_DEV_CONTAINER: '1',
            REVDECK_UI_HOST: CONTAINER_UI_HOST,
        },
        runArgs: [`--add-host=${CONTAINER_UI_HOST}:host-gateway`],
    };
}

/** Добавляет патч к существующему devcontainer.json, не удаляя чужие ключи. */
export function mergeDevcontainerConfig(existing: Record<string, unknown>, patch: DevcontainerPatch): Record<string, unknown> {
    const result: Record<string, unknown> = { ...existing };
    const currentMounts = Array.isArray(existing.mounts) ? [...existing.mounts] : [];
    for (const mount of patch.mounts) {
        const index = currentMounts.findIndex((item) => isRecord(item) && item.target === mount.target);
        if (index >= 0) currentMounts[index] = mount;
        else currentMounts.push(mount);
    }
    result.mounts = currentMounts;

    const containerEnv = isRecord(existing.containerEnv) ? { ...existing.containerEnv } : {};
    Object.assign(containerEnv, patch.containerEnv);
    result.containerEnv = containerEnv;

    const remoteEnv = isRecord(existing.remoteEnv) ? { ...existing.remoteEnv } : {};
    Object.assign(remoteEnv, patch.remoteEnv);
    result.remoteEnv = remoteEnv;

    const runArgs = Array.isArray(existing.runArgs) ? existing.runArgs.filter((item): item is string => typeof item === 'string') : [];
    for (const arg of patch.runArgs) if (!runArgs.includes(arg)) runArgs.push(arg);
    result.runArgs = runArgs;
    return result;
}

/**
 * Правит JSONC точечно через jsonc-parser: комментарии, порядок ключей и
 * форматирование за пределами управляемых полей сохраняются.
 */
export function applyDevcontainerPatch(text: string, patch: DevcontainerPatch): string {
    let current = text;
    const parsed = parseJsonc(current) as unknown;
    if (!isRecord(parsed)) throw new Error('devcontainer.json: expected an object');
    const formatting = { formattingOptions: { insertSpaces: true, tabSize: 2 } };

    const mounts = Array.isArray(parsed.mounts) ? [...parsed.mounts] : [];
    for (const mount of patch.mounts) {
        const index = mounts.findIndex((item) => isRecord(item) && item.target === mount.target);
        const path = ['mounts', index >= 0 ? index : mounts.length];
        current = applyEdits(current, modify(current, path, mount, formatting));
        if (index >= 0) mounts[index] = mount;
        else mounts.push(mount);
    }

    for (const [key, env] of [
        ['containerEnv', patch.containerEnv],
        ['remoteEnv', patch.remoteEnv],
    ] as const) {
        for (const [name, value] of Object.entries(env)) {
            current = applyEdits(current, modify(current, [key, name], value, formatting));
        }
    }

    const runArgs = Array.isArray(parsed.runArgs) ? parsed.runArgs.filter((item): item is string => typeof item === 'string') : [];
    for (const arg of patch.runArgs) {
        if (runArgs.includes(arg)) continue;
        current = applyEdits(current, modify(current, ['runArgs', runArgs.length], arg, formatting));
        runArgs.push(arg);
    }
    return current.endsWith('\n') ? current : `${current}\n`;
}

export async function runDevcontainer(rootInput: string, options: DevcontainerOptions): Promise<void> {
    const root = findRepoRoot(rootInput);
    const patch = devcontainerPatch();
    await ensureDir(devcontainerRunDir());
    await ensureDir(devcontainerStateDir());
    const dir = path.join(root, '.devcontainer');
    const file = path.join(dir, 'devcontainer.json');

    writers.out(tr('Мост revdeck для контейнера:', 'revdeck bridge for the container:'));
    writers.out(`  ${tr('сокет', 'socket')}: ${devcontainerRunDir()} -> ${CONTAINER_RUNTIME_DIR}`);
    writers.out(`  ${tr('состояние', 'state')}: ${devcontainerStateDir()} -> ${CONTAINER_STATE_DIR} (${tr('только чтение', 'read-only')})`);
    if (!existsSync(devcontainerSocketPath())) {
        writers.err(
            tr(
                '! сокет моста ещё не создан: на хосте выполните revdeck daemon restart',
                '! the bridge socket does not exist yet: run revdeck daemon restart on the host',
            ),
        );
    }
    writers.out(tr('В контейнере: демон, gh и glab остаются на хосте.', 'In the container: the daemon, gh and glab stay on the host.'));

    if (!options.write) {
        writers.out('');
        writers.out(tr('Фрагмент для .devcontainer/devcontainer.json:', 'Snippet for .devcontainer/devcontainer.json:'));
        writers.out(JSON.stringify(patch, null, 2));
        writers.out('');
        writers.out(tr('Применить автоматически: revdeck devcontainer --write', 'Apply automatically: revdeck devcontainer --write'));
        return;
    }

    await mkdir(dir, { recursive: true });
    const existed = existsSync(file);
    let output: string;
    if (existed) {
        const text = await readFile(file, 'utf8');
        try {
            output = applyDevcontainerPatch(text, patch);
        } catch (error) {
            throw new Error(
                tr(
                    `${path.relative(root, file)}: не удалось разобрать JSONC (${(error as Error).message}); добавьте mounts вручную`,
                    `${path.relative(root, file)}: could not parse JSONC (${(error as Error).message}); add the mounts manually`,
                ),
            );
        }
    } else {
        const existing = { image: 'mcr.microsoft.com/devcontainers/base:bookworm' };
        output = `${JSON.stringify(mergeDevcontainerConfig(existing, patch), null, 2)}\n`;
    }
    await writeFile(file, output);
    writers.out(`✔ ${path.relative(root, file)}`);
    await mergeMcpEnv(root, patch.containerEnv);
    if (existed) writers.out(tr('  комментарии сохранены.', '  comments were preserved.'));
    writers.out('');
    writers.out(tr('Дальше:', 'Next:'));
    writers.out(tr('  1. На хосте: revdeck daemon restart — он создаст сокет моста.', '  1. On the host: revdeck daemon restart — it creates the bridge socket.'));
    writers.out(tr('  2. Пересоберите/переоткройте devcontainer.', '  2. Rebuild/reopen the devcontainer.'));
    writers.out(tr('  3. В контейнере: revdeck doctor — он не будет искать glab/gh внутри.', '  3. In the container: revdeck doctor — it will not look for glab/gh inside.'));
    writers.out(tr('  Для UI/MCP из контейнера (или если сокет не монтируется) запустите демон на хосте с --host 0.0.0.0.', '  For the UI/MCP from the container (or when the socket cannot be mounted), start the daemon on the host with --host 0.0.0.0.'));
}

/** Добавляет REVDECK_* в env MCP-сервера, чтобы он не поднимал демон в контейнере. */
async function mergeMcpEnv(root: string, env: Record<string, string>): Promise<void> {
    for (const relative of ['.mcp.json', '.cursor/mcp.json']) {
        const file = path.join(root, relative);
        if (!existsSync(file)) continue;
        try {
            const data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
            const servers = isRecord(data.mcpServers) ? data.mcpServers : null;
            const server = servers && isRecord(servers.revdeck) ? servers.revdeck : null;
            if (!server) continue;
            server.env = { ...(isRecord(server.env) ? server.env : {}), ...env };
            await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
            writers.out(`✔ MCP env: ${relative}`);
        } catch (error) {
            writers.err(`! ${relative}: ${tr('не JSON — не трогаю', 'not JSON — leaving it untouched')} (${(error as Error).message})`);
        }
    }
}
