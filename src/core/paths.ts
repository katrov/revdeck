import { existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** Корень репозитория: ближайший родитель с `.git`; иначе текущий каталог. */
export function findRepoRoot(start = process.cwd()): string {
    let dir = path.resolve(start);
    for (;;) {
        if (existsSync(path.join(dir, '.git'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return path.resolve(start);
        dir = parent;
    }
}

export const CONFIG_FILES = ['.revdeck.yml', '.revdeck.yaml'] as const;
export const CACHE_DIR = '.revdeck';

export function findConfigFile(root: string): string | null {
    for (const name of CONFIG_FILES) {
        const candidate = path.join(root, name);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/** Состояние демона: ~/.local/state/revdeck (или $XDG_STATE_HOME). */
export function stateDir(): string {
    if (process.env.REVDECK_STATE_DIR) return path.resolve(process.env.REVDECK_STATE_DIR);
    const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    return path.join(base, 'revdeck');
}

/** Сокет и pid: $XDG_RUNTIME_DIR/revdeck, иначе приватный каталог в tmp. */
export function runtimeDir(): string {
    if (process.env.REVDECK_RUNTIME_DIR) return path.resolve(process.env.REVDECK_RUNTIME_DIR);
    const base = process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `revdeck-${process.getuid?.() ?? 'user'}`);
    return path.join(base, 'revdeck');
}

export function socketPath(): string {
    return path.join(runtimeDir(), 'daemon.sock');
}

export function daemonInfoPath(): string {
    return path.join(stateDir(), 'daemon.json');
}

/**
 * Стабильный мост для devcontainer: каталог в домашней директории, не зависящий
 * от XDG/REVDECK_* переменных. В отличие от runtime/state, этот путь можно
 * записать в общий devcontainer.json как ${localEnv:HOME}/...
 */
export function devcontainerBridgeDir(): string {
    if (process.env.REVDECK_DEVCONTAINER_DIR) return path.resolve(process.env.REVDECK_DEVCONTAINER_DIR);
    return path.join(os.homedir(), '.local', 'state', 'revdeck', 'devcontainer');
}

export function devcontainerRunDir(): string {
    return path.join(devcontainerBridgeDir(), 'run');
}

export function devcontainerStateDir(): string {
    return path.join(devcontainerBridgeDir(), 'state');
}

export function devcontainerSocketPath(): string {
    return path.join(devcontainerRunDir(), 'daemon.sock');
}

export function devcontainerInfoPath(): string {
    return path.join(devcontainerStateDir(), 'daemon.json');
}

export function logPath(): string {
    return path.join(stateDir(), 'daemon.log');
}

export function databasePath(): string {
    return path.join(stateDir(), 'revdeck.sqlite3');
}

export async function ensureDir(dir: string, mode = 0o700): Promise<void> {
    await mkdir(dir, { recursive: true, mode });
    const info = await lstat(dir);
    if (!info.isDirectory()) throw new Error(`${dir}: expected a directory`);
    if (process.platform !== 'win32') {
        const { chmod } = await import('node:fs/promises');
        await chmod(dir, mode);
    }
}

/** Путь находится внутри root (после resolve, без учёта ссылок). */
export function isInside(root: string, target: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Читает текстовый файл, отказываясь идти по символическим ссылкам.
 * Каталог `.revdeck` и рабочие каталоги может менять агент — ссылка не должна
 * увести чтение за пределы ожидаемого места.
 */
export async function readTextNoFollow(file: string, maxBytes = 4 * 1024 * 1024): Promise<string> {
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`${path.basename(file)}: symbolic link, read refused`);
    if (!info.isFile()) throw new Error(`${path.basename(file)}: not a regular file`);
    if (info.size > maxBytes) throw new Error(`${path.basename(file)}: file is larger than ${Math.round(maxBytes / 1024)} KB`);
    const handle = await open(file, 'r');
    try {
        return await handle.readFile({ encoding: 'utf8' });
    } finally {
        await handle.close();
    }
}

/** Атомарная запись: временный файл в том же каталоге и rename. */
export async function writeFileAtomic(file: string, data: string, mode = 0o600): Promise<void> {
    await ensureDir(path.dirname(file));
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.tmp`);
    let handle;
    try {
        handle = await open(tmp, 'wx', mode);
        await handle.writeFile(data, 'utf8');
        await handle.sync();
    } finally {
        await handle?.close();
    }
    try {
        await rename(tmp, file);
    } catch (error) {
        await unlink(tmp).catch(() => undefined);
        throw error;
    }
}

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await readTextNoFollow(file)) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
        throw error;
    }
}

/** Корень npm-пакета revdeck: от него ищутся skills/ и dist/ui. */
export function packageRoot(): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const candidate = path.join(dir, 'package.json');
        if (existsSync(candidate)) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return process.cwd();
        dir = parent;
    }
}

export async function realDirectory(dir: string): Promise<string> {
    const resolved = await realpath(dir);
    return resolved;
}
