import { execFile } from 'node:child_process';

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

export const run: Runner = (command, args, options = {}) =>
    new Promise((resolve, reject) => {
        const child = execFile(
            command,
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

/** Есть ли исполняемый файл в PATH. */
export async function which(command: string): Promise<boolean> {
    try {
        await run(process.platform === 'win32' ? 'where' : 'which', [command], { timeoutMs: 5000 });
        return true;
    } catch {
        return false;
    }
}
