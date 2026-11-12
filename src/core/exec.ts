import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface RunOptions {
    cwd?: string;
    /** Дополнительные переменные; секреты из окружения вычищаются всегда. */
    env?: Record<string, string>;
    timeoutMs?: number;
    maxBuffer?: number;
    /** Разрешённые коды возврата сверх нуля. */
    allowExitCodes?: number[];
    input?: string;
}

export interface RunResult {
    stdout: string;
    stderr: string;
    code: number;
}

export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

/** Переменные, которые не должны попадать дочернему процессу: токены платформ и подсказки агенту. */
const SECRET_ENV = [
    'GITLAB_TOKEN',
    'GITLAB_PRIVATE_TOKEN',
    'GLAB_TOKEN',
    'CI_JOB_TOKEN',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN',
    'GIT_ASKPASS',
    'SSH_ASKPASS',
    'REVDECK_TOKEN',
];

export function scrubEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (SECRET_ENV.includes(key)) continue;
        env[key] = value;
    }
    // Стабильное неинтерактивное поведение CLI: без пейджера, цвета и запросов пароля.
    env.PAGER = 'cat';
    env.GIT_PAGER = 'cat';
    env.GIT_TERMINAL_PROMPT = '0';
    env.NO_COLOR = '1';
    env.CLICOLOR = '0';
    env.FORCE_COLOR = '0';
    env.TERM = 'dumb';
    return { ...env, ...extra };
}

const RESOLVED = new Map<string, string | null>();

/**
 * Ищет исполняемый файл не только в PATH демона: systemd/launchd и
 * devcontainer часто не видят mise/asdf/homebrew shims.
 */
export async function resolveExecutable(command: string): Promise<string | null> {
    if (command.includes('/') || command.includes('\\')) {
        try {
            await access(command, constants.X_OK);
            return command;
        } catch {
            return null;
        }
    }
    const override = process.env[`REVDECK_${command.toUpperCase()}`];
    if (override) return override;
    const cached = RESOLVED.get(command);
    if (cached) return cached;
    const dirs = [
        ...(process.env.PATH ?? '').split(path.delimiter),
        path.join(os.homedir(), '.local', 'bin'),
        path.join(os.homedir(), '.local', 'share', 'mise', 'shims'),
        path.join(os.homedir(), '.asdf', 'shims'),
        path.join(os.homedir(), '.npm-global', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
    ].filter(Boolean);
    const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
    for (const dir of [...new Set(dirs)]) {
        for (const extension of extensions) {
            const candidate = path.join(dir, `${command}${extension}`);
            try {
                await access(candidate, constants.X_OK);
                RESOLVED.set(command, candidate);
                return candidate;
            } catch {
                // продолжаем поиск
            }
        }
    }
    return null;
}

export const run: Runner = async (command, args, options = {}) => {
    const executable = (await resolveExecutable(command)) ?? command;
    return new Promise((resolve, reject) => {
        const child = execFile(
            executable,
            args,
            {
                cwd: options.cwd,
                env: scrubEnv(options.env),
                timeout: options.timeoutMs ?? 120_000,
                maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
                encoding: 'utf8',
                windowsHide: true,
                shell: false,
            },
            (error, stdout, stderr) => {
                const exitCode = (error as { code?: unknown } | null)?.code;
                const code = typeof exitCode === 'number' ? exitCode : error ? 1 : 0;
                if (error && !(options.allowExitCodes ?? []).includes(code)) {
                    const reason = (stderr || stdout || error.message).trim();
                    reject(Object.assign(new Error(reason.slice(0, 4000)), { command, code, stderr, stdout }));
                    return;
                }
                resolve({ stdout, stderr, code });
            },
        );
        if (options.input !== undefined) {
            child.stdin?.end(options.input);
        }
    });
};

/** Есть ли исполняемый файл (PATH + типичные каталоги пакетных менеджеров). */
export async function which(command: string): Promise<boolean> {
    return (await resolveExecutable(command)) !== null;
}
