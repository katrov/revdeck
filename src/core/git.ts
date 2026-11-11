import { run } from './exec.js';
import type { Platform } from './types.js';

export interface RemoteInfo {
    host: string;
    project: string;
    platform: Platform | null;
    url: string;
}

const SSH_SCP = /^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)(?::(\d+))?[:/](.+?)(?:\.git)?\/?$/;

/** Разбирает git remote в хост/проект. Понимает scp-подобный и URL-виды. */
export function parseRemote(url: string): RemoteInfo | null {
    const value = url.trim();
    if (!value) return null;
    let host = '';
    let projectPath = '';
    const http = /^(?:https?|git|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(value);
    if (http) {
        host = http[1]!;
        projectPath = http[2]!;
    } else {
        const scp = SSH_SCP.exec(value);
        if (!scp) return null;
        host = scp[1]!;
        projectPath = scp[3]!;
    }
    projectPath = projectPath.replace(/\/+$/, '').replace(/\.git$/, '');
    if (!host || !projectPath || !projectPath.includes('/')) return null;
    return { host, project: projectPath, platform: detectPlatform(host), url: value };
}

export function detectPlatform(host: string): Platform | null {
    const lower = host.toLowerCase();
    if (lower === 'github.com' || lower.endsWith('.github.com') || lower.includes('github')) return 'github';
    if (lower === 'gitlab.com' || lower.endsWith('.gitlab.com') || lower.includes('gitlab')) return 'gitlab';
    return null;
}

export async function gitRemote(root: string, remote = 'origin'): Promise<RemoteInfo | null> {
    try {
        const { stdout } = await run('git', ['config', '--get', `remote.${remote}.url`], { cwd: root, timeoutMs: 10_000 });
        return parseRemote(stdout.trim());
    } catch {
        return null;
    }
}

export async function remoteNames(root: string): Promise<string[]> {
    try {
        const { stdout } = await run('git', ['remote'], { cwd: root, timeoutMs: 10_000 });
        return stdout.split('\n').map((item) => item.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

export async function currentBranch(root: string): Promise<string> {
    try {
        const { stdout } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, timeoutMs: 10_000 });
        return stdout.trim();
    } catch {
        return '';
    }
}

export async function headSha(root: string): Promise<string> {
    try {
        const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10_000 });
        return stdout.trim();
    } catch {
        return '';
    }
}

/** Ветка по умолчанию из origin/HEAD, иначе первая из существующих. */
export async function defaultBranch(root: string): Promise<string> {
    try {
        const { stdout } = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, timeoutMs: 10_000 });
        const name = stdout.trim().replace(/^origin\//, '');
        if (name) return name;
    } catch {
        // fallthrough
    }
    for (const candidate of ['develop', 'main', 'master']) {
        try {
            await run('git', ['rev-parse', '--verify', candidate], { cwd: root, timeoutMs: 10_000 });
            return candidate;
        } catch {
            // next
        }
    }
    return 'main';
}

/** Diff локальной ветки относительно базы; для ревью без платформы. */
export async function localDiff(root: string, base: string): Promise<string> {
    const { stdout } = await run('git', ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', `${base}...HEAD`], {
        cwd: root,
        timeoutMs: 60_000,
        maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
}

export async function isCleanWorktree(root: string): Promise<boolean> {
    try {
        const { stdout } = await run('git', ['status', '--porcelain'], { cwd: root, timeoutMs: 10_000 });
        return stdout.trim() === '';
    } catch {
        return false;
    }
}

export async function commitOf(root: string, ref: string): Promise<string> {
    try {
        const { stdout } = await run('git', ['rev-parse', ref], { cwd: root, timeoutMs: 10_000 });
        return stdout.trim();
    } catch {
        return '';
    }
}
