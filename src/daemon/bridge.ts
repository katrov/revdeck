import { unlink } from 'node:fs/promises';
import path from 'node:path';
import {
    devcontainerBridgeDir,
    devcontainerInfoPath,
    devcontainerRunDir,
    devcontainerSocketPath,
    devcontainerStateDir,
    ensureDir,
    writeFileAtomic,
} from '../core/paths.js';
import type { ReviewService } from './service.js';
import { startRpcServer } from './rpc.js';
import { AGENT_POLICY } from './capabilities.js';

export interface DevcontainerBridgeInfo {
    pid: number;
    port: number;
    url: string;
    socket: string;
    startedAt: string;
    version: string;
    protocol: number;
    capabilities: string[];
    /** Только agent-scoped токен; UI-токен в контейнер не попадает. */
    agentToken: string;
}

/**
 * Второй RPC-сокет в стабильном домашнем каталоге. Контейнер монтирует его
 * как /run/revdeck и не зависит от XDG_RUNTIME_DIR/XDG_STATE_HOME хоста.
 */
export async function startDevcontainerBridge(
    service: ReviewService,
    info: { pid: number; port: number; url: string; startedAt: string; version: string; protocol: number; agentToken: string },
): Promise<{ close(): Promise<void> }> {
    // Мост монтируется в контейнер с другим uid: каталоги и файлы должны быть читаемы.
    // Родительский ~/.local/state/revdeck остаётся 0700, поэтому другие пользователи хоста
    // до моста не дойдут; монтирование обходит родительские каталоги.
    await ensureDir(path.dirname(devcontainerBridgeDir()), 0o700);
    await ensureDir(devcontainerBridgeDir(), 0o700);
    await ensureDir(devcontainerRunDir(), 0o755);
    await ensureDir(devcontainerStateDir(), 0o755);
    const rpc = await startRpcServer(service, devcontainerSocketPath(), {
        mode: 0o666,
        dirMode: 0o755,
        policy: AGENT_POLICY,
    });
    try {
        // Токен UI в контейнер не попадает: мост даёт только агентские методы.
        const payload: DevcontainerBridgeInfo = {
            pid: info.pid,
            port: info.port,
            url: info.url,
            socket: devcontainerSocketPath(),
            startedAt: info.startedAt,
            version: info.version,
            protocol: info.protocol,
            capabilities: [...AGENT_POLICY.capabilities],
            agentToken: info.agentToken,
        };
        await writeFileAtomic(devcontainerInfoPath(), `${JSON.stringify(payload, null, 2)}\n`, 0o644, 0o755);
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
