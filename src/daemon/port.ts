import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { stateDir, writeFileAtomic } from '../core/paths.js';

/** Подсказка о прошлом порте: перезапуск не должен менять origin UI без нужды. */
export function portHintPath(state = stateDir()): string {
    return path.join(state, 'daemon.port');
}

export async function readPortHint(file = portHintPath()): Promise<number | null> {
    try {
        const value = Number((await readFile(file, 'utf8')).trim());
        return Number.isInteger(value) && value > 0 && value < 65_536 ? value : null;
    } catch {
        return null;
    }
}

export async function writePortHint(port: number, file = portHintPath()): Promise<void> {
    if (!Number.isInteger(port) || port <= 0 || port >= 65_536) return;
    await writeFileAtomic(file, `${port}\n`, 0o600);
}
