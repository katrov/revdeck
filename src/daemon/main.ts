#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, open, readFile, unlink } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { daemonInfoPath, ensureDir, databasePath, logPath, runtimeDir, socketPath, stateDir, writeFileAtomic } from '../core/paths.js';
import { redactLine } from '../core/redact.js';
import { PROTOCOL_VERSION, VERSION } from '../version.js';
import { detectLocale, setLocale, tr } from '../core/locale.js';
import { Store } from './store.js';
import { ReviewService } from './service.js';
import { startHttpServer } from './http.js';
import { startRpcServer } from './rpc.js';
import { startDevcontainerBridge } from './bridge.js';

export interface DaemonInfo {
    pid: number;
    port: number;
    token: string;
    url: string;
    socket: string;
    startedAt: string;
    version: string;
    protocol: number;
}

async function main(): Promise<void> {
    setLocale(detectLocale());
    const { values } = parseArgs({
        options: {
            port: { type: 'string' },
            host: { type: 'string' },
            'state-dir': { type: 'string' },
            'runtime-dir': { type: 'string' },
            'ui-dir': { type: 'string' },
            foreground: { type: 'boolean', default: false },
            'sync-interval': { type: 'string' },
        },
        allowPositionals: false,
    });

    if (values['state-dir']) process.env.REVDECK_STATE_DIR = values['state-dir'];
    if (values['runtime-dir']) process.env.REVDECK_RUNTIME_DIR = values['runtime-dir'];

    const foreground = values.foreground === true;
    const log = async (line: string): Promise<void> => {
        const message = `${new Date().toISOString()} ${redactLine(line, 4000)}\n`;
        if (foreground) process.stderr.write(message);
        try {
            await appendFile(logPath(), message, { mode: 0o600 });
        } catch {
            // Лог не обязателен: демон должен работать и без него.
        }
    };

    const existing = await runningDaemon();
    if (existing) {
        process.stdout.write(`revdeck daemon ${tr('уже запущен', 'is already running')} (pid ${existing.pid}): ${existing.url}/\n`);
        return;
    }

    await ensureDir(stateDir(), 0o700);
    await ensureDir(runtimeDir(), 0o700);
    const lock = await acquireLock();
    if (!lock) {
        process.stdout.write(`revdeck daemon ${tr('уже запускается или запущен', 'is already starting or running')}\n`);
        return;
    }
    const token = (await import('node:crypto')).randomBytes(32).toString('hex');
    const store = new Store(databasePath());
    const service = new ReviewService({
        store,
        syncIntervalMs: values['sync-interval'] ? Number(values['sync-interval']) : 120_000,
    });
    const socket = socketPath();
    const rpc = await startRpcServer(service, socket);
    const uiDir = values['ui-dir'] ? path.resolve(values['ui-dir']) : path.join(packageRoot(), 'dist', 'ui');
    const http = await startHttpServer({
        service,
        token,
        uiDir,
        ...(values.port ? { port: Number(values.port) } : {}),
        ...(values.host ? { host: String(values.host) } : {}),
        version: VERSION,
    });
    const info: DaemonInfo = {
        pid: process.pid,
        port: http.port,
        token,
        url: http.url,
        socket,
        startedAt: new Date().toISOString(),
        version: VERSION,
        protocol: PROTOCOL_VERSION,
    };
    await writeFileAtomic(daemonInfoPath(), `${JSON.stringify(info, null, 2)}\n`, 0o600);
    let bridge: { close(): Promise<void> } | null = null;
    try {
        bridge = await startDevcontainerBridge(service, info);
    } catch (error) {
        // Мост нужен только devcontainer; его сбой не должен ронять демон.
        await log(`devcontainer bridge unavailable: ${redactLine(error instanceof Error ? error.message : error)}`);
    }
    service.startSync();

    process.stdout.write(
        [
            `revdeck daemon ${VERSION} (pid ${process.pid})`,
            `UI:      ${http.url}/?t=${token}`,
            `${tr('сокет', 'socket')}:   ${socket}`,
            `${tr('состояние', 'state')}: ${stateDir()}`,
            '',
        ].join('\n'),
    );
    await log(`daemon started pid=${process.pid} port=${http.port}`);

    let closing = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (closing) return;
        closing = true;
        await log(`daemon stopping (${signal})`);
        try {
            await bridge?.close();
            await rpc.close();
            await http.close();
        } finally {
            service.close();
            await unlink(daemonInfoPath()).catch(() => undefined);
            await lock.close().catch(() => undefined);
            await unlink(path.join(stateDir(), 'daemon.lock')).catch(() => undefined);
            process.exit(0);
        }
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => {
            if (signal === 'SIGHUP' && !foreground) return; // отвязанный демон переживает закрытие терминала
            void shutdown(signal);
        });
    }
}

function packageRoot(): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const candidate = path.join(dir, 'package.json');
        if (existsSync(candidate)) {
            try {
                const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string };
                if (parsed.name === 'revdeck') return dir;
            } catch {
                // продолжаем подниматься
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return process.cwd();
        dir = parent;
    }
}

async function runningDaemon(): Promise<DaemonInfo | null> {
    const infoPath = daemonInfoPath();
    if (!existsSync(infoPath)) return null;
    let info: DaemonInfo;
    try {
        info = JSON.parse(readFileSync(infoPath, 'utf8')) as DaemonInfo;
    } catch {
        return null;
    }
    if (!info?.pid || !info?.socket) return null;
    try {
        process.kill(info.pid, 0);
    } catch {
        return null;
    }
    const reachable = await new Promise<boolean>((resolve) => {
        const socket = net.connect(info.socket);
        const timer = setTimeout(() => {
            socket.destroy();
            resolve(false);
        }, 500);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
    return reachable ? info : null;
}

async function acquireLock(): Promise<Awaited<ReturnType<typeof open>> | null> {
    const file = path.join(stateDir(), 'daemon.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const handle = await open(file, 'wx', 0o600);
            await handle.writeFile(String(process.pid));
            return handle;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const pid = Number(await readFile(file, 'utf8').catch(() => ''));
            if (pid) {
                try {
                    process.kill(pid, 0);
                    return null;
                } catch {
                    // процесс мёртв — замок устарел
                }
            }
            await unlink(file).catch(() => undefined);
        }
    }
    return null;
}

void main().catch((error) => {
    process.stderr.write(`revdeck: ${redactLine(error instanceof Error ? error.message : error)}\n`);
    process.exit(1);
});
