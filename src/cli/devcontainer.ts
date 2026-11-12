import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, findRepoRoot, runtimeDir, stateDir } from '../core/paths.js';
import { isRecord, parseJsonc } from '../core/jsonc.js';
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
 * Патч devcontainer: сокет и state демона хоста монтируются в контейнер.
 * Демон, gh и glab остаются на хосте; контейнер только подключается к сокету.
 */
export function devcontainerPatch(): DevcontainerPatch {
    const mountSource = { runtime: runtimeDir(), state: stateDir() };
    return {
        mounts: [
            { type: 'bind', source: mountSource.runtime, target: CONTAINER_RUNTIME_DIR },
            { type: 'bind', source: mountSource.state, target: CONTAINER_STATE_DIR, readonly: true },
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

export async function runDevcontainer(rootInput: string, options: DevcontainerOptions): Promise<void> {
    const root = findRepoRoot(rootInput);
    const patch = devcontainerPatch();
    await ensureDir(runtimeDir());
    await ensureDir(stateDir());
    const dir = path.join(root, '.devcontainer');
    const file = path.join(dir, 'devcontainer.json');

    writers.out(tr('Хост-каталоги revdeck:', 'revdeck host directories:'));
    writers.out(`  ${tr('сокет', 'socket')}: ${runtimeDir()} -> ${CONTAINER_RUNTIME_DIR}`);
    writers.out(`  ${tr('состояние', 'state')}: ${stateDir()} -> ${CONTAINER_STATE_DIR} (${tr('только чтение', 'read-only')})`);
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
    let existing: Record<string, unknown> = {};
    if (existed) {
        const text = await readFile(file, 'utf8');
        let parsed: unknown;
        try {
            parsed = parseJsonc(text);
        } catch (error) {
            throw new Error(
                tr(
                    `${path.relative(root, file)}: не удалось разобрать JSONC (${(error as Error).message}); добавьте mounts вручную`,
                    `${path.relative(root, file)}: could not parse JSONC (${(error as Error).message}); add the mounts manually`,
                ),
            );
        }
        if (!isRecord(parsed)) throw new Error(`${path.relative(root, file)}: ${tr('ожидался объект', 'expected an object')}`);
        existing = parsed;
    } else {
        existing = { image: 'mcr.microsoft.com/devcontainers/base:bookworm' };
    }
    const merged = mergeDevcontainerConfig(existing, patch);
    await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
    writers.out(`✔ ${path.relative(root, file)}`);
    if (existed) {
        writers.out(tr('  комментарии в существующем JSONC не сохраняются: проверьте diff.', '  comments in an existing JSONC are not preserved: review the diff.'));
    }
    writers.out('');
    writers.out(tr('Дальше:', 'Next:'));
    writers.out(tr('  1. Пересоберите/переоткройте devcontainer.', '  1. Rebuild/reopen the devcontainer.'));
    writers.out(tr('  2. На хосте: revdeck daemon start.', '  2. On the host: revdeck daemon start.'));
    writers.out(tr('  3. В контейнере: revdeck doctor — он не будет искать glab/gh внутри.', '  3. In the container: revdeck doctor — it will not look for glab/gh inside.'));
    writers.out(tr('  Для UI из контейнера запустите демон на хосте с --host 0.0.0.0.', '  For the UI from the container, start the daemon on the host with --host 0.0.0.0.'));
}
