import { unlink } from 'node:fs/promises';
import {
    devcontainerInfoPath,
    devcontainerRunDir,
    devcontainerSocketPath,
    devcontainerStateDir,
    ensureDir,
    writeFileAtomic,
} from '../core/paths.js';
import type { ReviewService } from './service.js';
import { startRpcServer } from './rpc.js';

export interface DevcontainerBridgeInfo {
    pid: number;
    port: number;
    token: string;
    url: string;
    socket: string;
    startedAt: string;
    version: string;
    protocol: number;
}

/**
 * Второй RPC-сокет в стабильном домашнем каталоге. Контейнер монтирует его
 * как /run/revdeck и не зависит от XDG_RUNTIME_DIR/XDG_STATE_HOME хоста.
 */
export async function startDevcontainerBridge(
    service: ReviewService,
    info: Omit<DevcontainerBridgeInfo, 'socket'>,
): Promise<{ close(): Promise<void> }> {
    await ensureDir(devcontainerRunDir(), 0o700);
    await ensureDir(devcontainerStateDir(), 0o700);
    const rpc = await startRpcServer(service, devcontainerSocketPath());
    try {
        const payload: DevcontainerBridgeInfo = { ...info, socket: devcontainerSocketPath() };
        await writeFileAtomic(devcontainerInfoPath(), `${JSON.stringify(payload, null, 2)}\n`, 0o600);
    } catch (error) {
        await rpc.close();
        throw error;
    }
    return {
        close: async () => {
            await rpc.close();
            await unlink(devcontainerInfoPath()).catch(() => undefined);
        },
    };
}
