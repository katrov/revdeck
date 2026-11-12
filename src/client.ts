import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { daemonInfoPath, socketPath } from './core/paths.js';
import { VERSION } from './version.js';
import type { DaemonInfo } from './daemon/main.js';

export class RpcError extends Error {
    readonly code: string;
    readonly hint?: string;

    constructor(message: string, code = 'RPC', hint?: string) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
        this.hint = hint;
    }
}

export interface DaemonClient {
    readonly transport: 'socket' | 'http';
    request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
    close(): void;
}

interface Pending {
    resolve(value: unknown): void;
    reject(error: Error): void;
}

class SocketClient implements DaemonClient {
    readonly transport = 'socket' as const;
    private buffer = '';
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();

    constructor(private readonly socket: net.Socket) {
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => this.onData(chunk));
        socket.on('close', () => this.failAll(new RpcError('демон закрыл соединение', 'DISCONNECTED')));
        socket.on('error', (error) => this.failAll(new RpcError(error.message, 'DISCONNECTED')));
    }

    private onData(chunk: string): void {
        this.buffer += chunk;
        let index = this.buffer.indexOf('\n');
        while (index >= 0) {
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            if (line.trim()) this.handleLine(line);
            index = this.buffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        let message: { id?: number; result?: unknown; error?: { message?: string; code?: string; hint?: string } };
        try {
            message = JSON.parse(line);
        } catch {
            return;
        }
        if (typeof message.id !== 'number') return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new RpcError(message.error.message ?? 'ошибка RPC', message.error.code, message.error.hint));
        else pending.resolve(message.result);
    }

    private failAll(error: Error): void {
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
    }

    request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
            this.socket.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
                if (error) {
                    this.pending.delete(id);
                    reject(new RpcError(error.message, 'WRITE'));
                }
            });
        });
    }

    close(): void {
        this.socket.end();
    }
}

class HttpClient implements DaemonClient {
    readonly transport = 'http' as const;

    constructor(
        private readonly baseUrl: string,
        private readonly token: string,
    ) {}

    async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/rpc`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: `revdeck_session=${encodeURIComponent(this.token)}` },
            body: JSON.stringify({ method, params }),
        });
        const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: string };
        if (!response.ok || !data.ok) throw new RpcError(data.error ?? `HTTP ${response.status}`, 'HTTP');
        return data.result as T;
    }

    close(): void {
        // HTTP-соединения не удерживаются.
    }
}

export async function connectSocket(file = socketPath(), timeoutMs = 1500): Promise<DaemonClient> {
    return new Promise<DaemonClient>((resolve, reject) => {
        const socket = net.connect(file);
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new RpcError(`демон не отвечает: ${file}`, 'TIMEOUT'));
        }, timeoutMs);
        socket.once('connect', () => {
            clearTimeout(timer);
            socket.removeAllListeners('error');
            resolve(new SocketClient(socket));
        });
        socket.once('error', (error) => {
            clearTimeout(timer);
            reject(new RpcError(error.message, 'CONNECT'));
        });
    });
}

/** Есть ли уже запущенный демон (без автозапуска). */
export async function daemonInfo(): Promise<DaemonInfo | null> {
    try {
        return JSON.parse(await readFile(daemonInfoPath(), 'utf8')) as DaemonInfo;
    } catch {
        return null;
    }
}

/** Запущены ли мы внутри devcontainer, где демон и gh/glab остаются на хосте. */
export function isDevContainer(): boolean {
    return process.env.REVDECK_DEV_CONTAINER === '1';
}

export function devcontainerHint(): string {
    const runtime = process.env.REVDECK_RUNTIME_DIR ?? '(REVDECK_RUNTIME_DIR)';
    const state = process.env.REVDECK_STATE_DIR ?? '(REVDECK_STATE_DIR)';
    return [
        'демон revdeck не найден на хосте',
        'на хосте: revdeck daemon start',
        `проверьте mounts из revdeck devcontainer --write: ${runtime} и ${state}`,
        'gh/glab должны оставаться на хосте: внутри контейнера их запускать не нужно',
    ].join('; ');
}

export async function ensureDaemon(options: { autoStart?: boolean; daemonArgs?: string[] } = {}): Promise<{ client: DaemonClient; started: boolean }> {
    const url = process.env.REVDECK_URL;
    if (url) {
        const token = process.env.REVDECK_TOKEN;
        if (!token) throw new RpcError('REVDECK_URL задан, но REVDECK_TOKEN пуст', 'CONFIG');
        return { client: new HttpClient(url, token), started: false };
    }
    try {
        return { client: await connectSocket(), started: false };
    } catch (error) {
        if (isDevContainer()) {
            throw new RpcError(`devcontainer: ${devcontainerHint()}`, 'DEVCONTAINER', 'revdeck devcontainer --write и пересоберите контейнер');
        }
        if (options.autoStart === false) throw error;
    }
    await spawnDaemon(options.daemonArgs ?? []);
    const deadline = Date.now() + 15_000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
        try {
            return { client: await connectSocket(undefined, 500), started: true };
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    throw new RpcError(
        `не удалось запустить демон: ${(lastError as Error)?.message ?? 'неизвестно'}`,
        'DAEMON',
        'запустите вручную: revdeck daemon start --foreground',
    );
}

async function spawnDaemon(extraArgs: string[] = []): Promise<void> {
    const entry = daemonEntry();
    const child = spawn(entry.command, [...entry.args, ...extraArgs], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
        env: { ...process.env, REVDECK_VERSION: VERSION },
    });
    child.unref();
    // Даём процессу шанс упасть сразу (например, нет прав на state dir).
    await new Promise((resolve) => setTimeout(resolve, 200));
}

function daemonEntry(): { command: string; args: string[] } {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const built = path.join(here, 'daemon.js');
    if (existsSync(built)) return { command: process.execPath, args: [built] };
    const source = path.join(here, 'daemon', 'main.ts');
    if (existsSync(source)) {
        return { command: process.execPath, args: ['--import', 'tsx', source] };
    }
    // Бандл CLI лежит в dist, демон — рядом.
    const sibling = path.join(here, '..', 'dist', 'daemon.js');
    if (existsSync(sibling)) return { command: process.execPath, args: [sibling] };
    throw new RpcError('не найден вход демона (dist/daemon.js)', 'DAEMON');
}

/** URL интерфейса с учётом devcontainer: host.docker.internal вместо 127.0.0.1. */
export function uiBaseUrl(info: { url: string; port: number }): string {
    const host = process.env.REVDECK_UI_HOST;
    if (!isDevContainer() || !host) return info.url;
    return `http://${host}:${info.port}`;
}

export interface DaemonBinaries {
    glab: string | null;
    gh: string | null;
    git: string | null;
}

/** Пути, которые видит уже запущенный демон (а не текущий shell). */
export async function daemonBinaries(): Promise<DaemonBinaries | null> {
    try {
        const client = await connectSocket(undefined, 800);
        const ping = await client.request<{ binaries?: DaemonBinaries }>('ping');
        client.close();
        return ping.binaries ?? null;
    } catch {
        return null;
    }
}

export async function isDaemonRunning(): Promise<boolean> {
    try {
        const client = await connectSocket(undefined, 400);
        await client.request('ping');
        client.close();
        return true;
    } catch {
        return false;
    }
}
