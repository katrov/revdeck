import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthError, ProviderError } from '../core/errors.js';
import { redact } from '../core/redact.js';
import type { Platform } from '../core/types.js';
import { tr } from '../core/locale.js';

/** JSON из stdout CLI; ошибка разбора не должна превращаться в «пустой ответ». */
export function parseJson<T>(stdout: string, source: string): T {
    const text = stdout.trim();
    if (!text) throw new ProviderError(tr(`${source}: пустой ответ`, `${source}: empty response`));
    try {
        return JSON.parse(text) as T;
    } catch {
        throw new ProviderError(tr(`${source}: ответ не является JSON (${redact(text).slice(0, 200)})`, `${source}: response is not JSON (${redact(text).slice(0, 200)})`));
    }
}

/** Ошибка CLI → понятное сообщение без токенов и подсказкой про авторизацию. */
export function cliError(error: unknown, platform: Platform, host: string): never {
    const message = redact((error as Error)?.message ?? error).trim();
    const lower = message.toLowerCase();
    if (/enoent|executable file not found|spawn .* enoent/.test(lower)) {
        const binary = platform === 'gitlab' ? 'glab' : 'gh';
        throw new ProviderError(
            `${platform}: ${message}`,
            tr(
                `${binary} не найден в PATH демона: установите его, добавьте каталог в PATH или задайте REVDECK_${binary.toUpperCase()}; проверьте revdeck doctor. Если демон запущен в контейнере — перенесите его на хост`,
                `${binary} is not in the daemon PATH: install it, add its directory to PATH or set REVDECK_${binary.toUpperCase()}; check revdeck doctor. If the daemon runs in a container, move it to the host`,
            ),
        );
    }
    if (/(auth|unauthor|401|403|not logged|token|credential|forbidden)/.test(lower)) {
        const hint =
            platform === 'gitlab'
                ? tr(`войдите в glab на этом хосте: glab auth login --hostname ${host}`, `log in to glab for this host: glab auth login --hostname ${host}`)
                : tr(`войдите в gh: GH_HOST=${host} gh auth login`, `log in to gh: GH_HOST=${host} gh auth login`);
        throw new AuthError(`${platform}: ${message || tr('нет авторизации', 'not authenticated')}`, hint);
    }
    if (/(not found|404)/.test(lower)) throw new ProviderError(`${platform}: ${message}`, tr('проверьте номер ревью и доступ к проекту', 'check the review number and project access'));
    throw new ProviderError(`${platform}: ${message || tr('команда завершилась с ошибкой', 'the command failed')}`);
}

/** Временный файл с JSON-телом 0600 для `--input`; удаляется после вызова. */
export async function withTempJson<T>(data: unknown, fn: (file: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-'));
    const file = path.join(dir, 'payload.json');
    try {
        await writeFile(file, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
        return await fn(file);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

export function query(path: string, params: Record<string, string | number | undefined>): string {
    // Ведущий слэш добавляется парсером URL; API glab/gh ожидает путь без него.
    const url = new URL(path.startsWith('/') ? path : `/${path}`, 'http://local');
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    return `${url.pathname.replace(/^\//, '')}${url.search}`;
}
