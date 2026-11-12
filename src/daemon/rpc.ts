import net from 'node:net';
import { chmod, unlink } from 'node:fs/promises';
import { ensureDir } from '../core/paths.js';
import { redact } from '../core/redact.js';
import { messageOf, MrReviewError } from '../core/errors.js';
import { PROTOCOL_VERSION, VERSION } from '../version.js';
import { resolveExecutable } from '../core/exec.js';
import type { ReviewService } from './service.js';
import type { PublishKind } from '../core/types.js';

export interface RpcServerHandle {
    path: string;
    close(): Promise<void>;
}

interface RpcRequest {
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
}

// Вложения передаются base64: 25 МБ файла — это ~34 МБ строки.
const MAX_LINE = 40 * 1024 * 1024;

export async function dispatch(service: ReviewService, method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
        case 'ping': {
            const [glab, gh, git] = await Promise.all(['glab', 'gh', 'git'].map((name) => resolveExecutable(name)));
            return { ok: true, version: VERSION, protocol: PROTOCOL_VERSION, pid: process.pid, binaries: { glab, gh, git } };
        }
        case 'reviews.list':
            return { reviews: service.listReviews() };
        case 'reviews.open': {
            const root = String(params.root ?? '');
            if (!root) throw new MrReviewError('нужен root рабочей копии');
            const review = await service.openReview(root, {
                ...(typeof params.input === 'string' ? { input: params.input } : {}),
                ...(typeof params.platform === 'string' ? { platform: params.platform as 'gitlab' | 'github' } : {}),
                ...(typeof params.project === 'string' ? { project: params.project } : {}),
                ...(typeof params.host === 'string' ? { host: params.host } : {}),
                ...(typeof params.branch === 'string' ? { branch: params.branch } : {}),
            });
            return { review: service.getView(review.id), reviews: service.listReviews() };
        }
        case 'reviews.refresh': {
            const review = await service.refreshReview(String(params.review ?? ''));
            return { review: service.getView(review.id), reviews: service.listReviews() };
        }
        case 'reviews.remoteList': {
            const scope = (['open', 'mine', 'reviewing'] as const).includes(params.scope as never)
                ? (params.scope as 'open' | 'mine' | 'reviewing')
                : 'open';
            return service.listRemote(String(params.root ?? process.cwd()), scope, Number(params.limit ?? 50));
        }
        case 'reviews.get': {
            const id = String(params.review ?? '');
            if (params.refresh === true) await service.refreshReview(id);
            return { review: service.getView(id), reviews: service.listReviews() };
        }
        case 'reviews.remove':
            service.removeReview(String(params.review ?? ''));
            return { ok: true };
        case 'diff.get': {
            const file = service.diffFile(String(params.review ?? ''), String(params.file ?? ''));
            return { file };
        }
        case 'reactions.list':
            return {
                reactions: await service.reactions(
                    String(params.review ?? ''),
                    Array.isArray(params.noteIds) ? params.noteIds.map(String) : [],
                ),
            };
        case 'reactions.toggle':
            return service.react(String(params.review ?? ''), String(params.noteId ?? ''), String(params.emoji ?? ''));
        case 'reactions.reviewToggle':
            return service.reactToReview(String(params.review ?? ''), String(params.emoji ?? ''));
        case 'comments.update':
            await service.updateComment(String(params.review ?? ''), String(params.noteId ?? ''), String(params.body ?? ''));
            return { ok: true };
        case 'comments.delete':
            await service.deleteComment(String(params.review ?? ''), String(params.noteId ?? ''));
            return { ok: true };
        case 'attachments.upload':
            return {
                attachment: await service.uploadAttachment(String(params.review ?? ''), {
                    name: String(params.name ?? ''),
                    contentType: String(params.contentType ?? ''),
                    data: String(params.data ?? ''),
                }),
            };
        case 'drafts.put':
            return { draft: service.setDraft(String(params.review ?? ''), String(params.threadId ?? ''), (params.patch ?? {}) as Record<string, never>) };
        case 'findings.put':
            return { findings: service.setFindings(String(params.review ?? ''), params.findings) };
        case 'findings.list':
            return { findings: service.getReview(String(params.review ?? '')).findings };
        case 'summary.put':
            return { summary: service.setSummary(String(params.review ?? ''), params.summary) };
        case 'decisions.put':
            return { decisions: service.setDecisions(String(params.review ?? ''), params.decisions) };
        case 'notes.add':
            return {
                note: service.addNote(String(params.review ?? ''), {
                    file: String(params.file ?? ''),
                    line: Number(params.line ?? 0),
                    side: params.side === 'old' ? 'old' : 'new',
                    text: String(params.text ?? ''),
                    toAgent: params.toAgent !== false,
                }),
            };
        case 'notes.update':
            return { note: service.updateNote(String(params.review ?? ''), String(params.noteId ?? ''), (params.patch ?? {}) as Record<string, never>) };
        case 'notes.delete':
            service.deleteNote(String(params.review ?? ''), String(params.noteId ?? ''));
            return { ok: true };
        case 'publish.preview':
            return {
                preview: service.previewPublish(
                    String(params.review ?? ''),
                    String(params.kind ?? 'reply') as PublishKind,
                    Array.isArray(params.ids) ? params.ids.map(String) : [],
                ),
            };
        case 'publish.approve': {
            const approval = service.approve(
                String(params.review ?? ''),
                String(params.kind ?? 'reply') as PublishKind,
                Array.isArray(params.ids) ? params.ids.map(String) : [],
                String(params.hash ?? ''),
            );
            return { approval: { id: approval.id, expiresAt: approval.expiresAt } };
        }
        case 'publish.commit':
            return { result: await service.publish(String(params.review ?? ''), String(params.approvalId ?? '')) };
        case 'rules.get':
            return { rules: await service.rules(String(params.review ?? '')) };
        case 'checks.run':
            return {
                results: await service.runChecks(String(params.review ?? ''), {
                    allowRun: params.allowRun === true,
                    ...(Array.isArray(params.ids) ? { ids: params.ids.map(String) } : {}),
                }),
            };
        default:
            throw new MrReviewError(`неизвестный метод RPC: ${method}`, 'METHOD', 'обновите revdeck: версия демона и клиента должны совпадать');
    }
}

export async function startRpcServer(
    service: ReviewService,
    socketFile: string,
    options: { mode?: number; dirMode?: number } = {},
): Promise<RpcServerHandle> {
    await ensureDir(pathDirname(socketFile), options.dirMode ?? 0o700);
    await unlink(socketFile).catch(() => undefined);

    const server = net.createServer((socket) => {
        socket.setEncoding('utf8');
        let buffer = '';
        let queue: Promise<void> = Promise.resolve();
        socket.on('data', (chunk: string) => {
            buffer += chunk;
            if (buffer.length > MAX_LINE) {
                socket.destroy();
                return;
            }
            let index = buffer.indexOf('\n');
            while (index >= 0) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                if (line.trim()) {
                    const request = parseRequest(line);
                    queue = queue.then(async () => {
                        if (!request) return;
                        const response = await respond(service, request);
                        if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
                    });
                }
                index = buffer.indexOf('\n');
            }
        });
        socket.on('error', () => undefined);
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketFile, () => resolve());
    });
    await chmod(socketFile, options.mode ?? 0o600);

    return {
        path: socketFile,
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                setTimeout(() => resolve(), 1000).unref?.();
                unlink(socketFile).catch(() => undefined);
            }),
    };
}

function pathDirname(file: string): string {
    return file.replace(/[/\\][^/\\]+$/, '');
}

function parseRequest(line: string): RpcRequest | null {
    try {
        const value = JSON.parse(line) as RpcRequest;
        if (!value || typeof value !== 'object') return null;
        return value;
    } catch {
        return null;
    }
}

async function respond(service: ReviewService, request: RpcRequest): Promise<Record<string, unknown>> {
    const id = request.id ?? null;
    if (typeof request.method !== 'string') return { id, error: { message: 'не указан method' } };
    try {
        const result = await dispatch(service, request.method, request.params ?? {});
        return { id, result };
    } catch (error) {
        return {
            id,
            error: {
                message: redact(messageOf(error)),
                ...(error instanceof MrReviewError ? { code: error.code, hint: error.hint } : {}),
            },
        };
    }
}
