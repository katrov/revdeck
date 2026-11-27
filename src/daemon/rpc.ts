import net from 'node:net';
import { chmod, unlink } from 'node:fs/promises';
import { ensureDir } from '../core/paths.js';
import { redact } from '../core/redact.js';
import { messageOf, MrReviewError } from '../core/errors.js';
import { PROTOCOL_VERSION, VERSION } from '../version.js';
import { resolveExecutable } from '../core/exec.js';
import { authLogin, authStatus, authTargets, parseAuthTarget, parseToken } from '../providers/auth.js';
import type { ReviewService } from './service.js';
import type { PublishKind } from '../core/types.js';
import { HUMAN_POLICY, type RpcPolicy } from './capabilities.js';

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

function featureReviewInput(value: unknown): { review: string; role?: string } {
    if (typeof value === 'string') return { review: value };
    const item = (value ?? {}) as Record<string, unknown>;
    return {
        review: String(item.review ?? ''),
        ...(typeof item.role === 'string' ? { role: item.role } : {}),
    };
}

/** Агент может менять только собственные feature-заметки; автор ставится сервером. */
function assertAgentFeatureNote(service: ReviewService, featureId: string, noteId: string, policy: RpcPolicy): void {
    if (policy.name !== 'agent') return;
    const note = service.getFeature(featureId).notes.find((item) => item.id === noteId);
    if (!note || note.author !== 'agent') {
        throw new MrReviewError(
            'агент может изменять только свои feature-заметки',
            'CAPABILITY',
            'заметки человека редактирует и удаляет человек в UI/CLI',
        );
    }
}

export async function dispatch(
    service: ReviewService,
    method: string,
    params: Record<string, unknown>,
    policy: RpcPolicy = HUMAN_POLICY,
): Promise<unknown> {
    if (!policy.allows(method)) {
        throw new MrReviewError(
            `метод ${method} недоступен этому клиенту`,
            'CAPABILITY',
            policy.name === 'agent'
                ? 'публикация, checks, решения и администрирование выполняются человеком в UI или CLI на хосте'
                : undefined,
        );
    }
    switch (method) {
        case 'ping': {
            const [glab, gh, git] = await Promise.all(['glab', 'gh', 'git'].map((name) => resolveExecutable(name)));
            return {
                ok: true,
                version: VERSION,
                protocol: PROTOCOL_VERSION,
                pid: process.pid,
                capabilities: [...policy.capabilities],
                binaries: { glab, gh, git },
            };
        }
        case 'auth.status': {
            // Без параметров — все платформенные хосты из реестра проектов.
            if (params.platform !== undefined || params.host !== undefined) {
                return { hosts: [await authStatus(parseAuthTarget(params.platform, params.host))] };
            }
            const targets = authTargets(service.listProjects());
            return { hosts: await Promise.all(targets.map((target) => authStatus(target))) };
        }
        case 'auth.login': {
            // Токен проверяется запросом к платформе и уходит в stdin glab/gh:
            // revdeck его не сохраняет и не возвращает обратно.
            const target = parseAuthTarget(params.platform, params.host);
            const token = parseToken(params.token);
            return { host: await authLogin(target, token) };
        }
        case 'settings.get':
            return { settings: service.uiSettings() };
        case 'settings.put':
            return { settings: service.updateUiSettings(params.patch ?? {}) };
        case 'projects.list':
            return { projects: service.listProjects() };
        case 'projects.register': {
            const root = String(params.root ?? '');
            if (!root) throw new MrReviewError('нужен root рабочей копии');
            const project = await service.registerProject(root);
            return { project, projects: service.listProjects() };
        }
        case 'projects.update': {
            const project = String(params.project ?? '');
            if (!project) throw new MrReviewError('нужен ключ проекта');
            return {
                project: service.updateProject(project, {
                    ...(typeof params.title === 'string' ? { title: params.title } : {}),
                    ...(Array.isArray(params.roots) ? { roots: params.roots.map(String) } : {}),
                }),
                projects: service.listProjects(),
            };
        }
        case 'projects.remove': {
            const project = String(params.project ?? '');
            if (!project) throw new MrReviewError('нужен ключ проекта');
            const removedReviews = service.removeProject(project);
            return { removedReviews, projects: service.listProjects() };
        }
        case 'features.list': {
            const project = typeof params.project === 'string' && params.project.trim() ? params.project.trim() : undefined;
            return { features: service.listFeatures(project, params.includeArchived === true) };
        }
        case 'features.get':
            return { feature: service.getFeature(String(params.feature ?? '')) };
        case 'features.create':
            return {
                feature: service.createFeature({
                    title: String(params.title ?? ''),
                    ...(typeof params.brief === 'string' ? { brief: params.brief } : {}),
                    ...(typeof params.contract === 'string' ? { contract: params.contract } : {}),
                    ...(Array.isArray(params.reviews) ? { reviews: params.reviews.map(featureReviewInput) } : {}),
                }),
            };
        case 'features.update':
            return {
                feature: service.updateFeature(String(params.feature ?? ''), {
                    ...(typeof params.title === 'string' ? { title: params.title } : {}),
                    ...(typeof params.brief === 'string' ? { brief: params.brief } : {}),
                    ...(typeof params.contract === 'string' ? { contract: params.contract } : {}),
                    ...(params.status === 'open' || params.status === 'archived' ? { status: params.status } : {}),
                }),
            };
        case 'features.addReviews':
            return {
                feature: service.addFeatureReviews(
                    String(params.feature ?? ''),
                    Array.isArray(params.reviews) ? params.reviews.map(featureReviewInput) : [],
                ),
            };
        case 'features.removeReview':
            return { feature: service.removeFeatureReview(String(params.feature ?? ''), String(params.review ?? '')) };
        case 'features.reorder':
            return {
                feature: service.reorderFeature(
                    String(params.feature ?? ''),
                    Array.isArray(params.reviews) ? params.reviews.map(String) : [],
                ),
            };
        case 'features.addNote': {
            const featureId = String(params.feature ?? '');
            return {
                note: service.addFeatureNote(featureId, {
                    ...(params.kind === 'finding' || params.kind === 'note' ? { kind: params.kind } : {}),
                    ...(typeof params.level === 'string' ? { level: params.level } : {}),
                    title: String(params.title ?? ''),
                    body: String(params.body ?? ''),
                    author: policy.name === 'agent'
                        ? 'agent'
                        : params.author === 'agent' || params.author === 'human'
                          ? params.author
                          : 'human',
                }),
            };
        }
        case 'features.updateNote': {
            const featureId = String(params.feature ?? '');
            const noteId = String(params.note ?? '');
            assertAgentFeatureNote(service, featureId, noteId, policy);
            return {
                note: service.updateFeatureNote(featureId, noteId, {
                    ...(params.kind === 'finding' || params.kind === 'note' ? { kind: params.kind } : {}),
                    ...(typeof params.level === 'string' ? { level: params.level } : {}),
                    ...(typeof params.title === 'string' ? { title: params.title } : {}),
                    ...(typeof params.body === 'string' ? { body: params.body } : {}),
                }),
            };
        }
        case 'features.deleteNote': {
            const featureId = String(params.feature ?? '');
            const noteId = String(params.note ?? '');
            assertAgentFeatureNote(service, featureId, noteId, policy);
            service.deleteFeatureNote(featureId, noteId);
            return { ok: true };
        }
        case 'features.delete':
            service.deleteFeature(String(params.feature ?? ''));
            return { ok: true };
        case 'features.forReview':
            return { features: service.featuresForReview(String(params.review ?? '')) };
        case 'features.context':
            return service.featureContext(String(params.feature ?? ''), {
                ...(Number.isFinite(Number(params.maxBytes)) && Number(params.maxBytes) >= 0 ? { maxBytes: Number(params.maxBytes) } : {}),
            });
        case 'reviews.list': {
            const project = typeof params.project === 'string' && params.project.trim() ? params.project.trim() : undefined;
            const root = typeof params.root === 'string' && params.root.trim() ? params.root.trim() : undefined;
            if (project) return { reviews: service.listReviews(project) };
            if (root) return { reviews: service.listReviews(await service.projectForRoot(root)) };
            return { reviews: service.listReviews() };
        }
        case 'reviews.open': {
            const root = String(params.root ?? '');
            if (!root) throw new MrReviewError('нужен root рабочей копии');
            const review = await service.openReview(root, {
                ...(typeof params.input === 'string' ? { input: params.input } : {}),
                ...(typeof params.platform === 'string' ? { platform: params.platform as 'gitlab' | 'github' } : {}),
                ...(typeof params.project === 'string' ? { project: params.project } : {}),
                ...(typeof params.host === 'string' ? { host: params.host } : {}),
                ...(typeof params.branch === 'string' ? { branch: params.branch } : {}),
                actor: policy.name,
            });
            return { review: service.getView(review.id), reviews: service.listReviews() };
        }
        case 'reviews.refresh': {
            const review = await service.refreshReview(String(params.review ?? ''), policy.name);
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
        case 'versions.list':
            return { versions: service.listVersions(String(params.review ?? '')) };
        case 'versions.get':
            return { version: service.getVersion(String(params.review ?? ''), Number(params.id ?? 0)) };
        case 'secrets.get':
            return service.secrets(String(params.review ?? ''));
        case 'metrics.get':
            return {
                metrics: service.qualityMetrics(
                    String(params.project ?? ''),
                    typeof params.from === 'string' ? params.from : undefined,
                    typeof params.to === 'string' ? params.to : undefined,
                ),
            };
        case 'analytics.get':
            return service.analytics(String(params.review ?? ''));
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
            return { findings: service.setFindings(String(params.review ?? ''), params.findings, policy.name) };
        case 'findings.list':
            return { findings: service.getReview(String(params.review ?? '')).findings };
        case 'summary.put':
            return { summary: service.setSummary(String(params.review ?? ''), params.summary, policy.name) };
        case 'decisions.put':
            return { decisions: service.setDecisions(String(params.review ?? ''), params.decisions, policy.name) };
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
        case 'notes.update': {
            const patch = { ...((params.patch ?? {}) as Record<string, unknown>) };
            if (policy.name === 'agent') {
                // Серверные поля публикации агенту недоступны: он не может «пометить» комментарий опубликованным.
                delete patch.posted;
                delete patch.discussionId;
                delete patch.noteId;
                delete patch.error;
            }
            return { note: service.updateNote(String(params.review ?? ''), String(params.noteId ?? ''), patch as never) };
        }
        case 'notes.delete':
            service.deleteNote(String(params.review ?? ''), String(params.noteId ?? ''));
            return { ok: true };
        case 'messages.list':
            return { messages: service.getReview(String(params.review ?? '')).agentMessages };
        case 'messages.add':
            return {
                message: service.addAgentMessage(
                    String(params.review ?? ''),
                    String(params.text ?? ''),
                    policy.name === 'agent' || params.asAgent === true ? 'agent' : 'human',
                ),
            };
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
    options: { mode?: number; dirMode?: number; policy?: RpcPolicy } = {},
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
                        const response = await respond(service, request, options.policy ?? HUMAN_POLICY);
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

async function respond(service: ReviewService, request: RpcRequest, policy: RpcPolicy): Promise<Record<string, unknown>> {
    const id = request.id ?? null;
    if (typeof request.method !== 'string') return { id, error: { message: 'не указан method' } };
    try {
        const result = await dispatch(service, request.method, request.params ?? {}, policy);
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
