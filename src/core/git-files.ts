import { run } from './exec.js';

export type GitTrackState = 'tracked' | 'untracked' | 'unknown';

/**
 * Отслеживается ли путь git. `untracked` — git ответил кодом 1 (нормальный
 * случай); `unknown` — git недоступен/каталог не репозиторий. Для политики
 * документов неизвестное состояние трактуется как запрет.
 */
export async function gitTrackState(root: string, relative: string): Promise<GitTrackState> {
    try {
        const { stdout } = await run('git', ['-C', root, 'ls-files', '--error-unmatch', '--', relative], {
            timeoutMs: 10_000,
        });
        return stdout.trim() ? 'tracked' : 'unknown';
    } catch (error) {
        return (error as { code?: number }).code === 1 ? 'untracked' : 'unknown';
    }
}
