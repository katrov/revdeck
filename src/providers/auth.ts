import { tmpdir } from 'node:os';
import { resolveExecutable, run as realRun, type Runner } from '../core/exec.js';
import { AuthError, MrReviewError } from '../core/errors.js';
import { tr } from '../core/locale.js';
import { redact } from '../core/redact.js';

export type AuthPlatform = 'gitlab' | 'github';

export interface AuthTarget {
    platform: AuthPlatform;
    /** Хост без схемы: gitlab.example.com, github.com. */
    host: string;
}

export interface AuthInstall {
    /** Официальная инструкция по установке CLI. */
    url: string;
    /** Команда для найденного на хосте пакетного менеджера; ничего не запускает. */
    command?: string;
}

export interface AuthState {
    platform: AuthPlatform;
    host: string;
    /** CLI платформы найден в PATH демона. */
    binary: boolean;
    authenticated: boolean;
    /** Логин в платформе; только для показа, без секретов. */
    account?: string;
    /** Что сделать, если доступа нет. */
    hint?: string;
    /** Ответ CLI без токенов. */
    error?: string;
    /** Как поставить отсутствующий CLI: ссылка и подсказка пакетного менеджера. */
    install?: AuthInstall;
}

/** Подмена процесса для тестов. */
export interface AuthDeps {
    run?: Runner;
    resolve?: (command: string) => Promise<string | null>;
}

const HOST_RE = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*(?::\d{1,5})?$/i;
const TOKEN_MIN = 8;
const TOKEN_MAX = 4096;

export function binaryFor(platform: AuthPlatform): 'glab' | 'gh' {
    return platform === 'gitlab' ? 'glab' : 'gh';
}

/** Платформа и хост из параметров RPC; хост — без схемы, пути и порта вне диапазона. */
export function parseAuthTarget(platform: unknown, host: unknown): AuthTarget {
    const value = String(platform ?? '').trim().toLowerCase();
    if (value !== 'gitlab' && value !== 'github') {
        throw new MrReviewError(tr('платформа должна быть gitlab или github', 'platform must be gitlab or github'), 'BAD_INPUT');
    }
    const name = String(host ?? '').trim().toLowerCase();
    if (!HOST_RE.test(name)) {
        throw new MrReviewError(
            tr('некорректный хост платформы', 'invalid platform host'),
            'BAD_INPUT',
            tr('хост без схемы и пути, например gitlab.example.com', 'a host without a scheme or path, for example gitlab.example.com'),
        );
    }
    return { platform: value, host: name };
}

/** Токен из UI: обрезаем перевод строки от вставки, но не принимаем внутренние пробелы. */
export function parseToken(token: unknown): string {
    const value = String(token ?? '').trim();
    const bad = value.length < TOKEN_MIN || value.length > TOKEN_MAX || /\s/.test(value) || /[\u0000-\u001f\u007f]/.test(value);
    if (bad) {
        throw new MrReviewError(
            tr('токен выглядит некорректно', 'the token looks invalid'),
            'BAD_INPUT',
            tr('вставьте токен целиком, без пробелов и переносов', 'paste the whole token without spaces or line breaks'),
        );
    }
    return value;
}

/** Уникальные платформенные хосты из реестра проектов: что имеет смысл проверять. */
export function authTargets(projects: { platform: string; host: string }[]): AuthTarget[] {
    const targets = new Map<string, AuthTarget>();
    for (const project of projects) {
        if (project.platform !== 'gitlab' && project.platform !== 'github') continue;
        try {
            const target = parseAuthTarget(project.platform, project.host);
            targets.set(`${target.platform}:${target.host}`, target);
        } catch {
            // В реестре мог остаться хост из старой версии — такую запись пропускаем.
        }
    }
    return [...targets.values()];
}

interface Probe {
    account?: string;
    error?: string;
}

/**
 * Проверка доступа дешёвым запросом `GET /user`. Для проверки присланного токена
 * токен передаётся только через окружение дочернего процесса, не через argv.
 */
async function probe(target: AuthTarget, deps: AuthDeps, token?: string): Promise<Probe> {
    const bin = binaryFor(target.platform);
    const runner: Runner = deps.run ?? realRun;
    const args = target.platform === 'gitlab' ? ['api', '--hostname', target.host, 'user'] : ['api', 'user'];
    const env: Record<string, string> =
        target.platform === 'gitlab'
            ? token
                ? { GITLAB_TOKEN: token }
                : {}
            : { GH_HOST: target.host, ...(token ? { GH_TOKEN: token } : {}) };
    try {
        const { stdout } = await runner(bin, args, { cwd: tmpdir(), timeoutMs: 30_000, env });
        let data: { username?: string; login?: string; name?: string } = {};
        try {
            data = JSON.parse(stdout) as typeof data;
        } catch {
            return { error: tr(`${bin}: ответ не JSON`, `${bin}: response is not JSON`) };
        }
        const account = String(data.username ?? data.login ?? data.name ?? '').trim();
        return account ? { account } : {};
    } catch (error) {
        return { error: redact((error as Error)?.message ?? error).replace(/\s+/g, ' ').trim().slice(0, 300) };
    }
}

/**
 * Состояние доступа к хосту. Ничего не сохраняет и не меняет: годится и для UI,
 * и для `doctor`, и для проверки перед записью токена.
 */
/** Ссылка на официальную инструкцию и команда, только если пакетный менеджер реально найден. */
async function installHint(
    platform: AuthPlatform,
    resolve: (command: string) => Promise<string | null>,
): Promise<AuthInstall> {
    const bin = binaryFor(platform);
    const url = platform === 'gitlab' ? 'https://docs.gitlab.com/cli/installation/' : 'https://cli.github.com/';
    // Ничего не запускаем: UI лишь показывает команду, которую человек выполнит сам.
    if (await resolve('brew')) return { url, command: `brew install ${bin}` };
    if (process.platform === 'linux' && (await resolve('pacman'))) {
        return { url, command: `sudo pacman -S ${platform === 'gitlab' ? 'glab' : 'github-cli'}` };
    }
    if (platform === 'github' && process.platform === 'win32' && (await resolve('winget'))) {
        return { url, command: 'winget install --id GitHub.cli' };
    }
    return { url };
}

export async function authStatus(target: AuthTarget, deps: AuthDeps = {}): Promise<AuthState> {
    const bin = binaryFor(target.platform);
    const resolve = deps.resolve ?? resolveExecutable;
    const base: AuthState = { platform: target.platform, host: target.host, binary: false, authenticated: false };
    if (!(await resolve(bin))) {
        return {
            ...base,
            hint: tr(
                `${bin} не найден в PATH демона: установите его на хосте и перезапустите демон или задайте REVDECK_${bin.toUpperCase()}`,
                `${bin} is not in the daemon PATH: install it on the host and restart the daemon, or set REVDECK_${bin.toUpperCase()}`,
            ),
            install: await installHint(target.platform, resolve),
        };
    }
    const result = await probe(target, deps);
    if (result.account) return { ...base, binary: true, authenticated: true, account: result.account };
    return {
        ...base,
        binary: true,
        ...(result.error ? { error: result.error } : {}),
        hint: tr(
            `вставьте токен ниже или выполните ${bin} auth login --hostname ${target.host} на хосте`,
            `paste a token below or run ${bin} auth login --hostname ${target.host} on the host`,
        ),
    };
}

/**
 * Проверяет токен и передаёт его самому CLI: `gh`/`glab` сохраняют его в своей
 * конфигурации, revdeck копии не держит. Токен идёт через stdin — в argv и в
 * списке процессов его нет.
 */
export async function authLogin(target: AuthTarget, token: string, deps: AuthDeps = {}): Promise<AuthState> {
    const bin = binaryFor(target.platform);
    const resolve = deps.resolve ?? resolveExecutable;
    const runner: Runner = deps.run ?? realRun;
    if (!(await resolve(bin))) {
        throw new MrReviewError(
            tr(`${bin} не найден в PATH демона`, `${bin} is not in the daemon PATH`),
            'ENVIRONMENT',
            tr(`установите ${bin} на хосте и перезапустите демон`, `install ${bin} on the host and restart the daemon`),
        );
    }

    // Сначала проверяем сам токен: неверный или просроченный не должен попасть в конфиг CLI.
    const checked = await probe(target, deps, token);
    if (!checked.account) {
        throw new AuthError(
            tr(
                `токен не принят ${target.host}${checked.error ? `: ${checked.error}` : ''}`,
                `the token was rejected by ${target.host}${checked.error ? `: ${checked.error}` : ''}`,
            ),
            tr(
                'проверьте срок действия и права: GitLab — api, GitHub — repo и read:org',
                'check the expiry and scopes: GitLab — api, GitHub — repo and read:org',
            ),
        );
    }

    try {
        if (target.platform === 'gitlab') {
            await runner(bin, ['auth', 'login', '--hostname', target.host, '--stdin'], {
                cwd: tmpdir(),
                timeoutMs: 60_000,
                input: token,
            });
        } else {
            await runner(bin, ['auth', 'login', '--hostname', target.host, '--with-token'], {
                cwd: tmpdir(),
                timeoutMs: 60_000,
                input: token,
            });
        }
    } catch (error) {
        throw new AuthError(
            tr(
                `${bin} не сохранил токен: ${redact((error as Error)?.message ?? error).replace(/\s+/g, ' ').trim().slice(0, 300)}`,
                `${bin} did not store the token: ${redact((error as Error)?.message ?? error).replace(/\s+/g, ' ').trim().slice(0, 300)}`,
            ),
            tr(
                `выполните ${bin} auth login --hostname ${target.host} вручную на хосте`,
                `run ${bin} auth login --hostname ${target.host} manually on the host`,
            ),
        );
    }

    return authStatus(target, deps);
}
