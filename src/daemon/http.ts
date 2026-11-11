import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { redact } from '../core/redact.js';
import { messageOf } from '../core/errors.js';
import type { ReviewService } from './service.js';
import type { PublishKind } from '../core/types.js';
import { dispatch } from './rpc.js';

export interface HttpOptions {
    service: ReviewService;
    token: string;
    uiDir: string;
    port?: number;
    host?: string;
    version?: string;
}

export interface HttpHandle {
    url: string;
    port: number;
    close(): Promise<void>;
}

const MAX_BODY = 4 * 1024 * 1024;

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ico': 'image/x-icon',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const COOKIE = 'revdeck_session';

function safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

function cookies(header: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (header ?? '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return out;
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY) throw Object.assign(new Error('слишком большой запрос'), { status: 413 });
        chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8').trim();
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('ожидался JSON-объект'), { status: 400 });
    return parsed as Record<string, unknown>;
}

function reply(res: http.ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        ...SECURITY_HEADERS,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(body);
}

export async function startHttpServer(options: HttpOptions): Promise<HttpHandle> {
    const { service, token } = options;
    const host = options.host ?? '127.0.0.1';

    const server = http.createServer(async (req, res) => {
        const port = (server.address() as { port: number } | null)?.port ?? 0;
        const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
        if (!expectedHosts.has(String(req.headers.host ?? ''))) {
            reply(res, 403, { ok: false, error: 'недопустимый Host' });
            return;
        }
        if (req.method !== 'GET' && req.headers.origin && !expectedHosts.has(String(req.headers.origin).replace(/^http:\/\//, ''))) {
            reply(res, 403, { ok: false, error: 'недопустимый Origin' });
            return;
        }
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const jar = cookies(req.headers.cookie);
        const authorized = safeEqual(String(jar[COOKIE] ?? ''), token);

        try {
            if (req.method === 'GET' && url.pathname === '/') {
                const provided = url.searchParams.get('t');
                if (provided && safeEqual(provided, token)) {
                    // Остальные параметры (например, review) сохраняем при переходе на чистый URL.
                    const next = new URL('/', url);
                    next.searchParams.delete('t');
                    res.writeHead(302, {
                        ...SECURITY_HEADERS,
                        'set-cookie': `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
                        location: `${next.pathname}${next.search}`,
                    });
                    res.end();
                    return;
                }
                if (!authorized) {
                    res.writeHead(401, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                    res.end('<meta charset="utf-8"><h1>Нужна ссылка запуска</h1><p>Откройте адрес из терминала: он содержит одноразовый токен.</p>');
                    return;
                }
                const html = await readFile(path.join(options.uiDir, 'index.html'));
                res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': MIME['.html']!, 'cache-control': 'no-store' });
                res.end(html);
                return;
            }

            if (req.method === 'GET' && (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg')) {
                const relative = url.pathname === '/favicon.svg' ? 'favicon.svg' : url.pathname.slice('/assets/'.length);
                const target = path.resolve(options.uiDir, url.pathname === '/favicon.svg' ? '' : 'assets', relative);
                if (!target.startsWith(path.resolve(options.uiDir) + path.sep) || relative.includes('..')) {
                    reply(res, 404, { ok: false, error: 'нет файла' });
                    return;
                }
                const info = await stat(target).catch(() => null);
                if (!info?.isFile()) {
                    reply(res, 404, { ok: false, error: 'нет файла' });
                    return;
                }
                res.writeHead(200, {
                    ...SECURITY_HEADERS,
                    'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
                    'cache-control': 'public, max-age=31536000, immutable',
                });
                createReadStream(target).pipe(res);
                return;
            }

            if (!url.pathname.startsWith('/api/')) {
                reply(res, 404, { ok: false, error: 'не найдено' });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/events') {
                if (!authorized) {
                    reply(res, 401, { ok: false, error: 'нет авторизации' });
                    return;
                }
                res.writeHead(200, {
                    ...SECURITY_HEADERS,
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-store',
                    connection: 'keep-alive',
                });
                res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
                const listener = (event: { reviewId: string; at: string }) => {
                    res.write(`event: review\ndata: ${JSON.stringify(event)}\n\n`);
                };
                service.events.on('review', listener);
                const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
                heartbeat.unref?.();
                req.on('close', () => {
                    clearInterval(heartbeat);
                    service.events.off('review', listener);
                });
                return;
            }
            if (!authorized) {
                reply(res, 401, { ok: false, error: 'нет авторизации' });
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/health') {
                reply(res, 200, { ok: true, version: options.version ?? 'dev', reviews: service.listReviews().length });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/reviews') {
                reply(res, 200, { ok: true, reviews: service.listReviews() });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/state') {
                const review = url.searchParams.get('review');
                if (!review) {
                    reply(res, 400, { ok: false, error: 'нужен параметр review' });
                    return;
                }
                const view = await service.refreshIfStale(review);
                reply(res, 200, { ok: true, review: view, reviews: service.listReviews() });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/diff') {
                const review = url.searchParams.get('review') ?? '';
                const file = url.searchParams.get('file') ?? '';
                const diff = service.diffFile(review, file);
                if (!diff) {
                    reply(res, 404, { ok: false, error: 'файла нет в diff' });
                    return;
                }
                reply(res, 200, { ok: true, file: diff });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/rules') {
                const review = url.searchParams.get('review') ?? '';
                reply(res, 200, { ok: true, rules: await service.rules(review) });
                return;
            }
            if (req.method === 'POST') {
                const body = await readBody(req);
                const review = String(body.review ?? '');
                switch (url.pathname) {
                    case '/api/reviews/open': {
                        const root = String(body.root ?? '');
                        if (!root) throw Object.assign(new Error('нужен root рабочей копии'), { status: 400 });
                        const opened = await service.openReview(root, {
                            ...(typeof body.input === 'string' ? { input: body.input } : {}),
                            ...(typeof body.platform === 'string' ? { platform: body.platform as 'gitlab' | 'github' } : {}),
                            ...(typeof body.project === 'string' ? { project: body.project } : {}),
                            ...(typeof body.host === 'string' ? { host: body.host } : {}),
                            ...(typeof body.branch === 'string' ? { branch: body.branch } : {}),
                        });
                        reply(res, 200, { ok: true, review: service.getView(opened.id), reviews: service.listReviews() });
                        return;
                    }
                    case '/api/reviews/refresh': {
                        const updated = await service.refreshReview(review);
                        reply(res, 200, { ok: true, review: service.getView(updated.id), reviews: service.listReviews() });
                        return;
                    }
                    case '/api/drafts': {
                        const draft = service.setDraft(review, String(body.threadId ?? ''), (body.patch ?? {}) as Record<string, never>);
                        reply(res, 200, { ok: true, draft });
                        return;
                    }
                    case '/api/findings': {
                        const findings = service.setFindings(review, body.findings);
                        reply(res, 200, { ok: true, findings });
                        return;
                    }
                    case '/api/summary': {
                        const summary = service.setSummary(review, body.summary);
                        reply(res, 200, { ok: true, summary });
                        return;
                    }
                    case '/api/decisions': {
                        const decisions = service.setDecisions(review, body.decisions);
                        reply(res, 200, { ok: true, decisions });
                        return;
                    }
                    case '/api/notes': {
                        const action = String(body.action ?? 'add');
                        if (action === 'add') {
                            const note = service.addNote(review, {
                                file: String(body.file ?? ''),
                                line: Number(body.line ?? 0),
                                side: body.side === 'old' ? 'old' : 'new',
                                text: String(body.text ?? ''),
                                toAgent: body.toAgent !== false,
                            });
                            reply(res, 200, { ok: true, note });
                            return;
                        }
                        if (action === 'delete') {
                            service.deleteNote(review, String(body.noteId ?? ''));
                            reply(res, 200, { ok: true });
                            return;
                        }
                        const note = service.updateNote(review, String(body.noteId ?? ''), (body.patch ?? {}) as Record<string, never>);
                        reply(res, 200, { ok: true, note });
                        return;
                    }
                    case '/api/publish/preview': {
                        const preview = service.previewPublish(review, String(body.kind ?? 'reply') as PublishKind, Array.isArray(body.ids) ? body.ids.map(String) : []);
                        reply(res, 200, { ok: true, preview });
                        return;
                    }
                    case '/api/publish/approve': {
                        const approval = service.approve(
                            review,
                            String(body.kind ?? 'reply') as PublishKind,
                            Array.isArray(body.ids) ? body.ids.map(String) : [],
                            String(body.hash ?? ''),
                        );
                        reply(res, 200, { ok: true, approval: { id: approval.id, expiresAt: approval.expiresAt } });
                        return;
                    }
                    case '/api/publish/commit': {
                        const result = await service.publish(review, String(body.approvalId ?? ''));
                        reply(res, 200, { ok: true, result });
                        return;
                    }
                    case '/api/rpc': {
                        const result = await dispatch(service, String(body.method ?? ''), (body.params ?? {}) as Record<string, unknown>);
                        reply(res, 200, { ok: true, result });
                        return;
                    }
                    case '/api/checks': {
                        const results = await service.runChecks(review, { allowRun: body.run === true, ids: Array.isArray(body.ids) ? body.ids.map(String) : undefined });
                        reply(res, 200, { ok: true, results });
                        return;
                    }
                    default:
                        reply(res, 404, { ok: false, error: 'не найдено' });
                        return;
                }
            }
            reply(res, 404, { ok: false, error: 'не найдено' });
        } catch (error) {
            const status = (error as { status?: number }).status ?? 500;
            reply(res, status, { ok: false, error: redact(messageOf(error)) });
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, host, () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    return {
        url: `http://127.0.0.1:${port}`,
        port,
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                setTimeout(() => resolve(), 1500).unref?.();
            }),
    };
}
