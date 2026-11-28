import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { redact } from '../core/redact.js';
import { locale as daemonLocale, type Locale } from '../core/locale.js';
import { messageOf } from '../core/errors.js';
import type { ReviewService } from './service.js';
import type { PublishKind } from '../core/types.js';
import { dispatch } from './rpc.js';
import { AGENT_POLICY, HUMAN_POLICY } from './capabilities.js';

export interface HttpOptions {
    service: ReviewService;
    token: string;
    /** Ограниченный токен для /api/rpc; UI-эндпоинты требуют основной токен. */
    agentToken?: string;
    uiDir: string;
    port?: number;
    host?: string;
    /** Дополнительные значения Host, например host.docker.internal. */
    allowedHosts?: string[];
    version?: string;
}

export interface HttpHandle {
    url: string;
    port: number;
    close(): Promise<void>;
}

// Вложения передаются base64: 25 МБ файла — это ~34 МБ JSON.
const MAX_BODY = 40 * 1024 * 1024;

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
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; media-src 'self' http: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/** Адрес интерфейса для UI: wildcard-адреса показываем как loopback. */
function hostAuthority(host: string): string {
    if (host === '0.0.0.0') return '127.0.0.1';
    if (host === '::') return '[::1]';
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

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

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Язык страницы — по браузеру: она показывается человеку, а не CLI. */
function pageLocale(header: string | undefined): Locale {
    const first = String(header ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
    if (first.startsWith('ru')) return 'ru';
    if (first.startsWith('en')) return 'en';
    return daemonLocale();
}

interface LaunchPageOptions {
    /** Браузер прислал cookie, но launch-токен уже сменился перезапуском. */
    stale: boolean;
    nonce: string;
    version?: string;
    locale: Locale;
}

/**
 * Страница вместо голого 401: после перезапуска демона старый адрес и cookie
 * перестают работать. Объясняем это по-человечески, даём команду для новой
 * ссылки и сами перезагружаем вкладку, когда доступ восстановится.
 */
function launchPage(options: LaunchPageOptions): string {
    const text = (ru: string, en: string): string => (options.locale === 'ru' ? ru : en);
    const title = options.stale
        ? text('Сессия демона устарела', 'The daemon session expired')
        : text('Нужна ссылка запуска', 'A launch link is required');
    const lead = options.stale
        ? text(
              'Демон перезапускался и сменил launch-токен и порт. Cookie-сессия этого браузера больше не действует.',
              'The daemon restarted and rotated its launch token and port. This browser’s cookie session is no longer valid.',
          )
        : text(
              'Интерфейс открывается по одноразовой ссылке из терминала: она авторизует браузер и не требует пароля.',
              'The interface opens from a one-time link in your terminal: it authorizes this browser and needs no password.',
          );
    const command = 'revdeck daemon start && revdeck ui --open';
    const labels = {
        copy: text('Копировать', 'Copy'),
        copied: text('Скопировано', 'Copied'),
        checking: text('Проверяем доступ…', 'Checking access…'),
        waiting: text('Нужна новая ссылка', 'A new link is required'),
        ok: text('Доступ восстановлен, обновляем…', 'Access restored, reloading…'),
        offline: text('Демон не отвечает', 'The daemon is not responding'),
    };
    const version = options.version ? `<span>revdeck ${escapeHtml(options.version)}</span>` : '<span>revdeck</span>';
    return `<!doctype html>
<html lang="${options.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>revdeck — ${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
    :root {
        color-scheme: light dark;
        --bg: #f6f7f9; --panel: #ffffff; --border: #dfe3e8; --text: #16191d; --muted: #68707a;
        --accent: #3b6ef5; --accent-soft: #e6edff; --code: #f1f3f6; --ok: #1f8f4e; --warn: #b26a00; --danger: #c93838;
        --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
        --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, 'Helvetica Neue', sans-serif;
    }
    @media (prefers-color-scheme: dark) {
        :root {
            --bg: #101216; --panel: #171a20; --border: #2a2f38; --text: #e6e9ee; --muted: #98a1ad;
            --accent: #6f95ff; --accent-soft: #1e2a4d; --code: #1f242c; --ok: #4cc27d; --warn: #e0a33a; --danger: #f07a7a;
        }
    }
    * { box-sizing: border-box; }
    body {
        margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 26px;
        background:
            radial-gradient(900px 520px at 12% -12%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 62%),
            radial-gradient(760px 460px at 112% 112%, color-mix(in srgb, #7c5cff 13%, transparent), transparent 60%),
            var(--bg);
        color: var(--text); font: 14px/1.55 var(--sans);
    }
    .card {
        width: 100%; max-width: 574px; background: var(--panel); border: 1px solid var(--border);
        border-radius: 18px; padding: 26px 30px 22px;
        box-shadow: 0 1px 2px rgb(16 24 40 / 6%), 0 18px 50px rgb(16 24 40 / 10%);
    }
    .brand { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
    .brand img { width: 24px; height: 24px; }
    .chip {
        margin-left: auto; padding: 3px 9px; border: 1px solid var(--border); border-radius: 999px;
        color: var(--muted); font-size: 10.5px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase;
    }
    h1 { margin: 28px 0 10px; font-size: 25px; line-height: 1.2; letter-spacing: -0.025em; }
    .lead { margin: 0 0 20px; color: var(--muted); font-size: 13.5px; }
    .command {
        display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px;
        background: var(--code); border: 1px solid var(--border); border-radius: 10px;
    }
    .command code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; font: 12.5px/1.5 var(--mono); }
    .command button, .reload {
        border: 1px solid var(--border); background: var(--panel); color: var(--text);
        border-radius: 7px; padding: 5px 10px; font: inherit; font-size: 12px; font-weight: 600;
        white-space: nowrap; cursor: pointer;
    }
    .command button:hover, .reload:hover { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
        .command button:focus, .reload:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
    .command button.copied { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
    .hint { margin: 10px 0 0; color: var(--muted); font-size: 12.5px; }
    .status {
        display: flex; align-items: center; gap: 8px; margin-top: 22px; padding-top: 15px;
        border-top: 1px solid var(--border); color: var(--muted); font-size: 12.5px;
    }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
    .status[data-state="checking"] .dot { background: var(--warn); animation: pulse 1.4s ease-in-out infinite; }
    .status[data-state="waiting"] .dot { background: var(--warn); }
    .status[data-state="ok"] .dot { background: var(--ok); }
    .status[data-state="offline"] .dot { background: var(--danger); }
    @keyframes pulse { 50% { opacity: 0.3; } }
    .actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
    .actions .hint { margin: 0; }
    .foot { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 18px; color: var(--muted); font-size: 11.5px; }
    .origin { font-family: var(--mono); overflow-wrap: anywhere; }
    @media (max-width: 480px) { .card { padding: 22px 20px 18px; } h1 { font-size: 22px; } .actions { flex-wrap: wrap; } }
</style>
</head>
<body>
<main class="card">
    <div class="brand"><img src="/favicon.svg" alt="">revdeck<span class="chip">${text('локальный демон', 'local daemon')}</span></div>
    <h1>${escapeHtml(title)}</h1>
    <p class="lead">${escapeHtml(lead)}</p>
    <div class="command">
        <code>${escapeHtml(command)}</code>
        <button id="copy" type="button">${escapeHtml(labels.copy)}</button>
    </div>
    <p class="hint">${text(
        'Команда запустит демон, если он остановлен, и откроет свежую ссылку. Данные остаются на этом хосте.',
        'The command starts the daemon if needed and opens a fresh link. Everything stays on this host.',
    )}</p>
    <div class="status" id="status" data-state="checking" role="status" aria-live="polite">
        <span class="dot" aria-hidden="true"></span><span id="status-text">${escapeHtml(labels.checking)}</span>
    </div>
    <div class="actions">
        <button class="reload" id="reload" type="button">${text('Проверить снова', 'Check again')}</button>
        <span class="hint">${text(
            'Вкладка переподключится сама, когда появится доступ.',
            'This tab reconnects by itself once access is restored.',
        )}</span>
    </div>
    <div class="foot">${version}<span class="origin" id="origin"></span></div>
</main>
<script nonce="${options.nonce}">
(function () {
    var command = ${JSON.stringify(command)};
    var labels = ${JSON.stringify(labels)};
    var copyButton = document.getElementById('copy');
    var reloadButton = document.getElementById('reload');
    var status = document.getElementById('status');
    var statusText = document.getElementById('status-text');
    var origin = document.getElementById('origin');
    if (origin) origin.textContent = location.origin;
    copyButton.addEventListener('click', function () {
        function done() {
            copyButton.textContent = labels.copied;
            copyButton.classList.add('copied');
            setTimeout(function () {
                copyButton.textContent = labels.copy;
                copyButton.classList.remove('copied');
            }, 1800);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(command).then(done, function () { fallback(); done(); });
            return;
        }
        fallback();
        done();
        function fallback() {
            var area = document.createElement('textarea');
            area.value = command;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            try { document.execCommand('copy'); } catch (error) {}
            area.remove();
        }
    });
    reloadButton.addEventListener('click', function () { location.reload(); });
    var checking = false;
    function probe() {
        if (checking) return;
        checking = true;
        fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
            checking = false;
            if (response.ok) {
                status.dataset.state = 'ok';
                statusText.textContent = labels.ok;
                setTimeout(function () { location.reload(); }, 250);
                return;
            }
            status.dataset.state = 'waiting';
            statusText.textContent = labels.waiting;
        }, function () {
            checking = false;
            status.dataset.state = 'offline';
            statusText.textContent = labels.offline;
        });
    }
    setTimeout(probe, 1500);
    setInterval(probe, 5000);
})();
</script>
</body>
</html>`;
}

export async function startHttpServer(options: HttpOptions): Promise<HttpHandle> {
    const { service, token } = options;
    const host = options.host ?? '127.0.0.1';

    const server = http.createServer(async (req, res) => {
        const port = (server.address() as { port: number } | null)?.port ?? 0;
        const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
        // При --host на конкретный интерфейс браузер/health приходят именно на него.
        if (host !== '0.0.0.0' && host !== '::') expectedHosts.add(`${hostAuthority(host).toLowerCase()}:${port}`);
        for (const name of options.allowedHosts ?? []) expectedHosts.add(`${name}:${port}`);
        // Docker Desktop на macOS доставляет host.docker.internal на loopback-порт хоста.
        expectedHosts.add(`host.docker.internal:${port}`);
        if (!expectedHosts.has(String(req.headers.host ?? ''))) {
            reply(res, 403, { ok: false, error: 'недопустимый Host' });
            return;
        }
        if (req.method !== 'GET' && req.headers.origin && !expectedHosts.has(String(req.headers.origin).replace(/^http:\/\//, ''))) {
            reply(res, 403, { ok: false, error: 'недопустимый Origin' });
            return;
        }
        let url: URL;
        let jar: Record<string, string>;
        try {
            url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
            jar = cookies(req.headers.cookie);
        } catch {
            reply(res, 400, { ok: false, error: 'некорректный запрос' });
            return;
        }
        const presented = String(jar[COOKIE] ?? '');
        const isHuman = safeEqual(presented, token);
        const isAgent = Boolean(options.agentToken) && safeEqual(presented, options.agentToken!);
        const authorized = isHuman || isAgent;
        const isRpc = req.method === 'POST' && url.pathname === '/api/rpc';
        // Агентский HTTP-токен даёт только /api/rpc; UI-эндпоинты — human-only.
        if (authorized && !isHuman && !isRpc) {
            reply(res, 403, { ok: false, error: 'агентский токен: доступен только /api/rpc' });
            return;
        }

        try {
            if (req.method === 'GET' && url.pathname === '/') {
                const provided = url.searchParams.get('t');
                if (provided && safeEqual(provided, token)) {
                    // Остальные параметры (например, review) сохраняем при переходе на чистый URL.
                    // new URL('/', url) теряет query — копируем текущий адрес и убираем только t.
                    const next = new URL(url.href);
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
                    const nonce = randomBytes(16).toString('base64');
                    res.writeHead(401, {
                        ...SECURITY_HEADERS,
                        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
                        'content-type': 'text/html; charset=utf-8',
                        'cache-control': 'no-store',
                    });
                    res.end(launchPage({ stale: presented !== '', nonce, version: options.version, locale: pageLocale(req.headers['accept-language']) }));
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
                const reviewListener = (event: { reviewId: string; at: string }) => {
                    res.write(`event: review\ndata: ${JSON.stringify(event)}\n\n`);
                };
                const featureListener = (event: { featureId: string; at: string }) => {
                    res.write(`event: feature\ndata: ${JSON.stringify(event)}\n\n`);
                };
                const projectListener = (event: { key: string; at: string }) => {
                    res.write(`event: project\ndata: ${JSON.stringify(event)}\n\n`);
                };
                service.events.on('review', reviewListener);
                service.events.on('feature', featureListener);
                service.events.on('project', projectListener);
                // Named event, not a comment: the UI uses it to tell a live SSE from a
                // buffered/blocked stream and skips its polling fallback while it ticks.
                const heartbeat = setInterval(() => res.write('event: heartbeat\ndata: {}\n\n'), 25_000);
                heartbeat.unref?.();
                req.on('close', () => {
                    clearInterval(heartbeat);
                    service.events.off('review', reviewListener);
                    service.events.off('feature', featureListener);
                    service.events.off('project', projectListener);
                });
                return;
            }
            if (!authorized) {
                reply(res, 401, { ok: false, error: 'нет авторизации' });
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/update') {
                const update = await service.updateInfo(url.searchParams.get('refresh') === '1');
                reply(res, 200, { ok: true, update });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/codeowners') {
                const review = url.searchParams.get('review') ?? '';
                const codeowners = await service.codeowners(review, url.searchParams.get('refresh') === '1');
                reply(res, 200, { ok: true, codeowners });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/readiness') {
                const review = url.searchParams.get('review') ?? '';
                const readiness = await service.readiness(review, url.searchParams.get('refresh') === '1');
                reply(res, 200, { ok: true, readiness });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/health') {
                reply(res, 200, { ok: true, version: options.version ?? 'dev', reviews: service.listReviews().length });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/projects') {
                reply(res, 200, { ok: true, projects: service.listProjects() });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/reviews') {
                const project = url.searchParams.get('project');
                reply(res, 200, { ok: true, reviews: project ? service.listReviews(project) : service.listReviews() });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/state') {
                const review = url.searchParams.get('review');
                if (!review) {
                    reply(res, 400, { ok: false, error: 'нужен параметр review' });
                    return;
                }
                // Отдаём кеш сразу; устаревший снимок обновляется в фоне и приходит через SSE.
                const view = service.getView(review);
                service.refreshInBackground(review);
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
            if (req.method === 'GET' && url.pathname === '/api/file') {
                const review = url.searchParams.get('review') ?? '';
                const file = url.searchParams.get('file') ?? '';
                const content = await service.fileContent(review, file);
                reply(res, 200, { ok: true, file: content });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/rules') {
                const review = url.searchParams.get('review') ?? '';
                reply(res, 200, { ok: true, rules: await service.rules(review) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/reactions') {
                const review = url.searchParams.get('review') ?? '';
                const noteIds = (url.searchParams.get('notes') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
                reply(res, 200, { ok: true, reactions: await service.reactions(review, noteIds) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/metrics') {
                reply(res, 200, {
                    ok: true,
                    metrics: service.qualityMetrics(
                        url.searchParams.get('project') ?? '',
                        url.searchParams.get('from') ?? undefined,
                        url.searchParams.get('to') ?? undefined,
                    ),
                });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/messages') {
                const review = url.searchParams.get('review') ?? '';
                reply(res, 200, { ok: true, messages: service.getReview(review).agentMessages });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/versions') {
                const review = url.searchParams.get('review') ?? '';
                reply(res, 200, { ok: true, versions: service.listVersions(review) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/version') {
                const review = url.searchParams.get('review') ?? '';
                const id = Number(url.searchParams.get('id') ?? 0);
                reply(res, 200, { ok: true, version: service.getVersion(review, id) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/secrets') {
                const review = url.searchParams.get('review') ?? '';
                reply(res, 200, { ok: true, ...(await service.secrets(review)) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/analytics') {
                const review = url.searchParams.get('review') ?? '';
                reply(res, 200, { ok: true, analytics: service.analytics(review) });
                return;
            }
            if (req.method === 'GET' && url.pathname === '/api/review-reactions') {
                const review = url.searchParams.get('review') ?? '';
                const view = service.getReview(review);
                reply(res, 200, { ok: true, reactions: view.reactions });
                return;
            }
            if (req.method === 'POST') {
                const body = await readBody(req);
                const review = String(body.review ?? '');
                switch (url.pathname) {
                    case '/api/projects/register': {
                        const root = String(body.root ?? '');
                        if (!root) throw Object.assign(new Error('нужен root рабочей копии'), { status: 400 });
                        const project = await service.registerProject(root);
                        reply(res, 200, { ok: true, project, projects: service.listProjects() });
                        return;
                    }
                    case '/api/projects/update': {
                        const project = String(body.project ?? '');
                        if (!project) throw Object.assign(new Error('нужен ключ проекта'), { status: 400 });
                        const updated = service.updateProject(project, {
                            ...(typeof body.title === 'string' ? { title: body.title } : {}),
                            ...(Array.isArray(body.roots) ? { roots: body.roots.map(String) } : {}),
                        });
                        reply(res, 200, { ok: true, project: updated, projects: service.listProjects() });
                        return;
                    }
                    case '/api/projects/remove': {
                        const project = String(body.project ?? '');
                        if (!project) throw Object.assign(new Error('нужен ключ проекта'), { status: 400 });
                        const removedReviews = service.removeProject(project);
                        reply(res, 200, { ok: true, removedReviews, projects: service.listProjects() });
                        return;
                    }
                    case '/api/previews/open': {
                        const root = String(body.root ?? '');
                        if (!root) throw Object.assign(new Error('нужен root рабочей копии'), { status: 400 });
                        const input = String(body.input ?? '');
                        if (!input) throw Object.assign(new Error('нужен номер или ссылка на MR/PR'), { status: 400 });
                        const preview = await service.openPreview({
                            root,
                            input,
                            ...(typeof body.platform === 'string' ? { platform: body.platform as 'gitlab' | 'github' } : {}),
                            ...(typeof body.project === 'string' ? { project: body.project } : {}),
                            ...(typeof body.host === 'string' ? { host: body.host } : {}),
                            ...(typeof body.branch === 'string' ? { branch: body.branch } : {}),
                            ...(body.force === true ? { force: true } : {}),
                        });
                        reply(res, 200, { ok: true, preview });
                        return;
                    }
                    case '/api/reviews/open': {
                        const root = String(body.root ?? '');
                        if (!root) throw Object.assign(new Error('нужен root рабочей копии'), { status: 400 });
                        const opened = await service.openReview(root, {
                            ...(typeof body.input === 'string' ? { input: body.input } : {}),
                            ...(typeof body.platform === 'string' ? { platform: body.platform as 'gitlab' | 'github' } : {}),
                            ...(typeof body.project === 'string' ? { project: body.project } : {}),
                            ...(typeof body.host === 'string' ? { host: body.host } : {}),
                            ...(typeof body.branch === 'string' ? { branch: body.branch } : {}),
                            actor: 'human',
                        });
                        reply(res, 200, { ok: true, review: service.getView(opened.id), reviews: service.listReviews() });
                        return;
                    }
                    case '/api/reviews/remove': {
                        service.removeReview(review);
                        reply(res, 200, { ok: true });
                        return;
                    }
                    case '/api/reviews/refresh': {
                        const updated = await service.refreshReview(review, 'human');
                        reply(res, 200, { ok: true, review: service.getView(updated.id), reviews: service.listReviews() });
                        return;
                    }
                    case '/api/comments': {
                        const noteId = String(body.noteId ?? '');
                        if (String(body.action ?? '') === 'delete') await service.deleteComment(review, noteId);
                        else await service.updateComment(review, noteId, String(body.body ?? ''));
                        reply(res, 200, { ok: true });
                        return;
                    }
                    case '/api/attachments': {
                        const attachment = await service.uploadAttachment(review, {
                            name: String(body.name ?? ''),
                            contentType: String(body.type ?? ''),
                            data: String(body.data ?? ''),
                        });
                        reply(res, 200, { ok: true, attachment });
                        return;
                    }
                    case '/api/reactions': {
                        const result = await service.react(review, String(body.noteId ?? ''), String(body.emoji ?? ''));
                        reply(res, 200, { ok: true, ...result });
                        return;
                    }
                    case '/api/review-reactions': {
                        const result = await service.reactToReview(review, String(body.emoji ?? ''));
                        reply(res, 200, { ok: true, ...result });
                        return;
                    }
                    case '/api/drafts': {
                        const draft = service.setDraft(review, String(body.threadId ?? ''), (body.patch ?? {}) as Record<string, never>);
                        reply(res, 200, { ok: true, draft });
                        return;
                    }
                    case '/api/findings': {
                        const findings = service.setFindings(review, body.findings, 'human');
                        reply(res, 200, { ok: true, findings });
                        return;
                    }
                    case '/api/summary': {
                        const summary = service.setSummary(review, body.summary, 'human');
                        reply(res, 200, { ok: true, summary });
                        return;
                    }
                    case '/api/decisions': {
                        const decisions = service.setDecisions(review, body.decisions, 'human');
                        reply(res, 200, { ok: true, decisions });
                        return;
                    }
                    case '/api/messages': {
                        const message = service.addAgentMessage(review, String(body.text ?? ''), 'human');
                        reply(res, 200, { ok: true, message });
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
                        const preview = service.previewPublish(
                            review,
                            String(body.kind ?? 'reply') as PublishKind,
                            Array.isArray(body.ids) ? body.ids.map(String) : [],
                            body.verdict === 'approve' || body.verdict === 'request_changes' ? body.verdict : 'comment',
                        );
                        reply(res, 200, { ok: true, preview });
                        return;
                    }
                    case '/api/publish/approve': {
                        const approval = service.approve(
                            review,
                            String(body.kind ?? 'reply') as PublishKind,
                            Array.isArray(body.ids) ? body.ids.map(String) : [],
                            String(body.hash ?? ''),
                            body.verdict === 'approve' || body.verdict === 'request_changes' ? body.verdict : 'comment',
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
                        const result = await dispatch(
                            service,
                            String(body.method ?? ''),
                            (body.params ?? {}) as Record<string, unknown>,
                            isHuman ? HUMAN_POLICY : AGENT_POLICY,
                        );
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
        url: `http://${hostAuthority(host)}:${port}`,
        port,
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                setTimeout(() => resolve(), 1500).unref?.();
            }),
    };
}
