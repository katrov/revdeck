#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { daemonInfoPath, findRepoRoot, logPath } from '../core/paths.js';
import { loadConfig } from '../core/config.js';
import { buildEffectiveRules, renderRules } from '../core/rules.js';
import { changedPaths } from '../core/diff.js';
import type { ReviewView } from '../daemon/view.js';
import { isDaemonRunning, ensureDaemon, daemonInfo, type DaemonClient } from '../client.js';
import { run, which } from '../core/exec.js';
import { redactLine } from '../core/redact.js';
import { gitRemote } from '../core/git.js';
import { VERSION } from '../version.js';
import { fail, parseList, printJson, reviewLine, truncate, usage, when, writers } from './format.js';
import { installService, runInit } from './init.js';
import { exportReview, importReview } from './export.js';
import { contextPayload, renderContext } from '../context.js';

const OPTIONS = {
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    review: { type: 'string' },
    root: { type: 'string' },
    platform: { type: 'string' },
    project: { type: 'string' },
    host: { type: 'string' },
    branch: { type: 'string' },
    file: { type: 'string' },
    body: { type: 'string' },
    'body-file': { type: 'string' },
    thread: { type: 'string' },
    resolve: { type: 'boolean', default: false },
    kind: { type: 'string' },
    ids: { type: 'string' },
    scope: { type: 'string' },
    remote: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    ui: { type: 'boolean', default: false },
    open: { type: 'boolean', default: false },
    run: { type: 'boolean', default: false },
    dir: { type: 'string' },
    force: { type: 'boolean', default: false },
    adapters: { type: 'string' },
    'no-service': { type: 'boolean', default: false },
    explain: { type: 'string' },
    limit: { type: 'string' },
    decision: { type: 'string' },
    note: { type: 'string' },
    text: { type: 'string' },
    line: { type: 'string' },
    id: { type: 'string' },
    toAgent: { type: 'boolean', default: true },
    all: { type: 'boolean', default: false },
} as const;

type Values = Record<string, string | boolean | undefined>;

function parse(argv: string[]): { values: Values; positionals: string[] } {
    try {
        const result = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
        return { values: result.values as Values, positionals: result.positionals };
    } catch (error) {
        usage([`revdeck: ${(error as Error).message}`]);
    }
}

const HELP = `revdeck ${VERSION} — ревью GitLab/GitHub для людей и агентов

  revdeck init            настроить проект: .revdeck.yml, адаптеры, MCP
  revdeck doctor          проверить окружение и доступы
  revdeck daemon <start|stop|status|logs|restart>
  revdeck list            открытые ревью (локальный кеш), --remote — с платформы
  revdeck open <url|N>    открыть ревью и получить контекст
  revdeck ui [N]          ссылка на локальный интерфейс
  revdeck context <N>     контекст для агента: правила, diff, треды
  revdeck threads <N>     обсуждения
  revdeck diff <N> [--file <путь>]
  revdeck findings <N> [list|set --file <json>|decide --id <id> --decision accept|reject|discuss]
  revdeck summary <N> [--file <json>]      выжимка MR
  revdeck reply <N> --thread <id> (--body <текст> | --body-file <файл> | -) [--resolve] [--publish --yes]
  revdeck notes <N> <list|add|update|delete|reply>
  revdeck publish <N> [--kind reply|finding|note] [--ids a,b] [--yes]
  revdeck rules [<N>] [--explain <путь>]
  revdeck checks <N> [--run --yes]
  revdeck export <N> [--dir .revdeck]   выгрузка в старый файловый формат
  revdeck import <N> [--dir .revdeck]   импорт из старого формата
  revdeck config [--json]                 эффективный конфиг проекта
  revdeck mcp                             запустить MCP-сервер (stdio)

Общие флаги: --json, --root <путь>, --review <id>, --help.
Публикация без --yes никогда не выполняется: сначала показывается план.`;

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const command = argv[0];
    const { values, positionals } = parse(argv.slice(1));
    if (!command || command === 'help' || values.help) {
        writers.out(HELP);
        return;
    }
    if (command === 'version' || command === '--version') {
        writers.out(VERSION);
        return;
    }
    const root = String(values.root ?? findRepoRoot());

    switch (command) {
        case 'init':
            return runInit(root, { force: values.force === true, adapters: parseList(values.adapters as string), noService: values['no-service'] === true });
        case 'doctor':
            return doctor(root);
        case 'daemon':
            return daemon(positionals[0] ?? 'status');
        case 'list':
            return list(root, values);
        case 'open':
            return openReview(root, positionals[0], values);
        case 'ui':
            return ui(positionals[0], values);
        case 'status':
            return status();
        case 'context':
        case 'review':
            return context(root, positionals[0], values);
        case 'threads':
            return threads(positionals[0], values);
        case 'diff':
            return diff(positionals[0], values);
        case 'findings':
            return findings(positionals[0], positionals[1] ?? 'list', values);
        case 'summary':
            return summary(positionals[0], values);
        case 'reply':
            return reply(positionals[0], values);
        case 'notes':
            return notes(positionals[0], positionals[1] ?? 'list', values);
        case 'publish':
            return publish(positionals[0], values);
        case 'rules':
            return rules(root, positionals[0], values);
        case 'checks':
            return checks(root, positionals[0], values);
        case 'export':
            return exportReview(root, positionals[0], String(values.dir ?? '.revdeck'));
        case 'import':
            return importReview(root, positionals[0], String(values.dir ?? '.revdeck'));
        case 'config':
            return config(root, values);
        case 'mcp': {
            await import('../mcp/main.js');
            return;
        }
        default:
            usage([`неизвестная команда: ${command}`, '', HELP]);
    }
}

interface ClientContext {
    client: DaemonClient;
}

async function withClient<T>(fn: (ctx: ClientContext) => Promise<T>): Promise<T> {
    const { client } = await ensureDaemon();
    try {
        return await fn({ client });
    } finally {
        client.close();
    }
}

function reviewArg(values: Values, positional?: string): string | undefined {
    return (values.review as string | undefined) ?? positional;
}

async function resolveReview(client: DaemonClient, root: string, arg: string | undefined, values: Values): Promise<{ review: ReviewView; id: string }> {
    if (arg && /^(gitlab|github):/.test(arg)) {
        const result = await client.request<{ review: ReviewView }>('reviews.get', { review: arg });
        return { review: result.review, id: result.review.id };
    }
    if (arg) {
        const result = await client.request<{ review: ReviewView }>('reviews.open', {
            root,
            input: arg,
            ...(values.platform ? { platform: values.platform as 'gitlab' | 'github' } : {}),
            ...(values.project ? { project: values.project } : {}),
            ...(values.host ? { host: values.host } : {}),
            ...(values.branch ? { branch: values.branch } : {}),
        });
        return { review: result.review, id: result.review.id };
    }
    const listed = await client.request<{ reviews: { id: string; number: number }[] }>('reviews.list');
    if (listed.reviews.length === 1) {
        const result = await client.request<{ review: ReviewView }>('reviews.get', { review: listed.reviews[0]!.id });
        return { review: result.review, id: result.review.id };
    }
    if (!listed.reviews.length) fail('ревью не открыто', 'укажите номер или ссылку: revdeck open 42');
    fail('открыто несколько ревью: укажите номер или id', listed.reviews.map((item) => `  ${item.id}`).join('\n'));
}

function formatInfo(review: ReviewView): string[] {
    const info = review.info;
    return [
        `#${info.ref.number} ${info.title}`,
        `${info.webUrl}`,
        `${info.ref.project} · ${info.sourceBranch} → ${info.targetBranch} · ${info.state}${info.draft ? ' · draft' : ''} · автор ${info.author}`,
        `${review.stats.files} файлов, +${review.stats.additions} −${review.stats.deletions} · обновлено ${when(review.syncedAt)}${review.stale ? ' (устарело)' : ''}`,
    ];
}

async function list(root: string, values: Values): Promise<void> {
    if (values.remote) {
        await withClient(async ({ client }) => {
            const result = await client.request<{
                items: { ref: { number: number }; title: string; author: string; updatedAt: string }[];
                platform: string;
                project: string;
            }>('reviews.remoteList', {
                root,
                scope: (values.scope as 'open' | 'mine' | 'reviewing') ?? 'open',
                limit: Number(values.limit ?? 50),
            });
            if (values.json) return printJson(result);
            for (const item of result.items) {
                writers.out(`#${item.ref.number} ${truncate(item.title, 70)} · ${item.author} · ${when(item.updatedAt)}`);
            }
            if (!result.items.length) writers.out('открытых ревью нет');
        });
        return;
    }
    await withClient(async ({ client }) => {
        const { reviews } = await client.request<{ reviews: { number: number; title: string; author: string; project: string; syncedAt: string }[] }>('reviews.list');
        if (values.json) return printJson({ reviews });
        if (!reviews.length) return writers.out('ревью ещё не открывались: revdeck open <N>');
        for (const item of reviews) writers.out(reviewLine(item));
    });
}

async function openReview(root: string, arg: string | undefined, values: Values): Promise<void> {
    if (!arg) fail('укажите номер или ссылку на ревью');
    await withClient(async ({ client }) => {
        const result = await client.request<{ review: ReviewView }>('reviews.open', {
            root,
            input: arg,
            ...(values.platform ? { platform: values.platform as 'gitlab' | 'github' } : {}),
            ...(values.project ? { project: values.project } : {}),
            ...(values.host ? { host: values.host } : {}),
            ...(values.branch ? { branch: values.branch } : {}),
        });
        const review = result.review;
        if (values.json) return printJson(review);
        writers.out(formatInfo(review).join('\n'));
        if (review.errors.length) writers.err(`предупреждения:\n${review.errors.map((item) => `  ${item}`).join('\n')}`);
        if (values.ui) printUi(review.id, values);
    });
}

async function ui(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        if (arg) await resolveReview(client, findRepoRoot(), arg, values).catch(() => undefined);
    });
    const info = await daemonInfo();
    if (!info) fail('демон не запущен', 'revdeck daemon start');
    writers.out(`${info.url}/?t=${info.token}`);
    if (values.open) openBrowser(`${info.url}/?t=${info.token}`);
}

function printUi(reviewId: string | undefined, values: Values): void {
    const info = daemonInfoSync();
    if (!info) return writers.err('демон не запущен: revdeck daemon start');
    const url = `${info.url}/?t=${info.token}${reviewId ? `&review=${encodeURIComponent(reviewId)}` : ''}`;
    writers.out(`UI: ${url}`);
    if (values.open) openBrowser(url);
}

function daemonInfoSync(): { url: string; token: string } | null {
    try {
        return JSON.parse(readFileSync(daemonInfoPath(), 'utf8')) as { url: string; token: string };
    } catch {
        return null;
    }
}

function openBrowser(url: string): void {
    void import('node:child_process').then(({ spawn }) => {
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
        const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
        spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    });
}

async function daemon(action: string): Promise<void> {
    if (action === 'start') {
        const { client, started } = await ensureDaemon();
        const ping = await client.request<{ pid: number; version: string }>('ping');
        client.close();
        const info = await daemonInfo();
        writers.out(`${started ? 'запущен' : 'уже работает'} демон pid ${ping.pid}, версия ${ping.version}`);
        if (info) writers.out(`${info.url}/?t=${info.token}`);
        return;
    }
    if (action === 'status') {
        const running = await isDaemonRunning();
        const info = await daemonInfo();
        if (!running || !info) {
            writers.out('демон не запущен');
            process.exit(1);
        }
        writers.out(`pid ${info.pid} · ${info.url} · ${when(info.startedAt)}`);
        return;
    }
    if (action === 'install') {
        await installService();
        return;
    }
    if (action === 'uninstall') {
        writers.out('удалите unit вручную: systemctl --user disable --now revdeck (Linux) или launchctl unload (macOS)');
        return;
    }
    if (action === 'stop') {
        const info = await daemonInfo();
        if (!info) {
            writers.out('демон не запущен');
            return;
        }
        try {
            process.kill(info.pid, 'SIGTERM');
        } catch {
            // уже остановлен
        }
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && (await isDaemonRunning())) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        writers.out('демон остановлен');
        return;
    }
    if (action === 'restart') {
        await daemon('stop');
        return daemon('start');
    }
    if (action === 'logs') {
        try {
            const text = await readFile(logPath(), 'utf8');
            writers.out(text.split('\n').slice(-80).join('\n'));
        } catch {
            writers.out('лог пуст');
        }
        return;
    }
    usage(['daemon <start|stop|status|restart|logs|install|uninstall>']);
}

async function status(): Promise<void> {
    await withClient(async ({ client }) => {
        const { reviews } = await client.request<{ reviews: { id: string; number: number; title: string; author: string; project: string; syncedAt: string }[] }>('reviews.list');
        if (!reviews.length) {
            writers.out('ревью ещё не открывались');
            return;
        }
        for (const item of reviews) writers.out(reviewLine(item));
    });
}

async function context(root: string, arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, root, reviewArg(values, arg), values);
        const { rules } = await client.request<{ rules: { markdown: string; configPath: string | null; warnings: string[]; checks: { id: string; name: string; argv: string[]; consent: boolean; matched: boolean }[] } }>('rules.get', {
            review: review.id,
        });
        if (values.json) return printJson(contextPayload(review, rules));
        writers.out(renderContext(review, rules));
    });
}

async function threads(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), arg, values);
        if (values.json) return printJson({ threads: review.threads });
        if (!review.threads.length) return writers.out('обсуждений нет');
        for (const thread of review.threads) {
            writers.out(`${thread.resolved ? '✔' : '○'} ${thread.path ?? 'общий'}:${thread.line ?? '-'} · ${thread.id}`);
            for (const note of thread.notes) writers.out(`  ${note.author} (${when(note.createdAt)}): ${truncate(note.body, 300)}`);
        }
    });
}

async function diff(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), arg, values);
        if (!values.file) {
            if (values.json) return printJson({ files: review.files, stats: review.stats });
            for (const file of review.files) writers.out(`${file.status.padEnd(9)} +${String(file.additions).padStart(4)} −${String(file.deletions).padStart(4)}  ${file.path}`);
            return;
        }
        const { file } = await client.request<{ file: { path: string; hunks: { header: string; lines: { kind: string; text: string }[] }[] } | null }>('diff.get', {
            review: review.id,
            file: values.file,
        });
        if (!file) fail(`файла ${values.file} нет в diff`);
        if (values.json) return printJson(file);
        for (const hunk of file.hunks) {
            writers.out(hunk.header);
            for (const line of hunk.lines) writers.out(`${line.kind}${line.text}`);
        }
    });
}

async function findings(arg: string | undefined, action: string, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        if (action === 'set') {
            if (!values.file) fail('укажите --file с JSON замечаний');
            const raw = JSON.parse(await readFile(String(values.file), 'utf8')) as unknown;
            const list = Array.isArray(raw) ? raw : (raw as { findings?: unknown[] }).findings;
            if (!Array.isArray(list)) fail('ожидался массив или {findings: [...]}');
            const { findings: saved } = await client.request<{ findings: unknown[] }>('findings.put', { review: review.id, findings: list });
            if (values.json) return printJson({ findings: saved });
            writers.out(`сохранено замечаний: ${saved.length}`);
            return;
        }
        if (action === 'decide') {
            if (!values.id || !values.decision) fail('нужны --id и --decision');
            await client.request('decisions.put', {
                review: review.id,
                decisions: { [String(values.id)]: { decision: values.decision, note: String(values.note ?? '') } },
            });
            writers.out('решение сохранено');
            return;
        }
        if (values.json) return printJson({ findings: review.findings });
        if (!review.findings.length) return writers.out('замечаний нет');
        for (const finding of review.findings) {
            writers.out(`${finding.level.padEnd(8)} ${finding.status.padEnd(10)} ${finding.file}:${finding.line ?? '-'} · ${finding.id}`);
            writers.out(`  ${truncate(finding.title, 200)}`);
        }
    });
}

async function summary(arg: string | undefined, values: Values): Promise<void> {
    if (!values.file && process.stdin.isTTY) fail('укажите --file с JSON выжимки или передайте её через stdin');
    const raw = values.file ? JSON.parse(await readFile(String(values.file), 'utf8')) : JSON.parse(await readStdin());
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const result = await client.request<{ summary: unknown }>('summary.put', { review: review.id, summary: raw });
        if (values.json) return printJson(result);
        writers.out('выжимка сохранена');
    });
}

async function reply(arg: string | undefined, values: Values): Promise<void> {
    const body = await readBodyInput(values);
    if (body === null) fail('нужен ответ: --body, --body-file или stdin (-)');
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        if (!values.thread) fail('укажите --thread <id>');
        const { draft } = await client.request<{ draft: { threadId: string; body: string; replied: boolean } }>('drafts.put', {
            review: review.id,
            threadId: String(values.thread),
            patch: { body, resolve: values.resolve === true },
        });
        writers.out(`черновик сохранён для ${draft.threadId}`);
        if (values.publish) await publishSelection(client, review.id, 'reply', [draft.threadId], values);
    });
}

async function notes(arg: string | undefined, action: string, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        if (action === 'add') {
            if (!values.file || !values.line || !values.text) fail('нужны --file, --line, --text');
            await client.request('notes.add', {
                review: review.id,
                file: values.file,
                line: Number(values.line),
                text: values.text,
                toAgent: values.toAgent !== false,
            });
            writers.out('комментарий добавлен');
            return;
        }
        if (action === 'reply') {
            if (!values.id || !values.text) fail('нужны --id и --text');
            await client.request('notes.update', { review: review.id, noteId: values.id, patch: { agentReply: values.text } });
            writers.out('ответ агента сохранён');
            return;
        }
        if (action === 'delete') {
            if (!values.id) fail('нужен --id');
            await client.request('notes.delete', { review: review.id, noteId: values.id });
            writers.out('комментарий удалён');
            return;
        }
        if (action === 'update') {
            if (!values.id) fail('нужен --id');
            await client.request('notes.update', {
                review: review.id,
                noteId: values.id,
                patch: {
                    ...(values.text !== undefined ? { text: values.text } : {}),
                    ...(values.toAgent !== undefined ? { toAgent: values.toAgent } : {}),
                },
            });
            writers.out('комментарий обновлён');
            return;
        }
        if (values.json) return printJson({ notes: review.notes });
        if (!review.notes.length) writers.out('комментариев нет');
        for (const note of review.notes) {
            writers.out(`${note.file}:${note.line} · ${note.toAgent ? 'агенту' : 'себе'} · ${note.id}`);
            writers.out(`  ${truncate(note.text, 300)}${note.agentReply ? `\n  → ${truncate(note.agentReply, 300)}` : ''}`);
        }
    });
}

async function publish(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const kind = (values.kind as 'reply' | 'finding' | 'note') ?? 'reply';
        let ids = parseList(values.ids as string);
        if (!ids.length) ids = defaultSelection(review, kind);
        if (!ids.length) fail('нечего публиковать: нет выбранных элементов');
        await publishSelection(client, review.id, kind, ids, values);
    });
}

function defaultSelection(review: ReviewView, kind: 'reply' | 'finding' | 'note'): string[] {
    if (kind === 'reply') {
        return review.drafts
            .filter((draft) => (draft.body.trim() && !draft.replied) || draft.resolve !== review.threads.find((thread) => thread.id === draft.threadId)?.resolved)
            .map((draft) => draft.threadId);
    }
    if (kind === 'finding') {
        return review.findings.filter((finding) => finding.status !== 'published' && finding.status !== 'rejected' && finding.decision !== 'reject').map((finding) => finding.id);
    }
    return review.notes.filter((note) => !note.posted).map((note) => note.id);
}

async function publishSelection(client: DaemonClient, reviewId: string, kind: 'reply' | 'finding' | 'note', ids: string[], values: Values): Promise<void> {
    const { preview } = await client.request<{ preview: { plan: { items: { kind: string; id: string; body: string }[]; hash: string }; warnings: string[] } }>('publish.preview', {
        review: reviewId,
        kind,
        ids,
    });
    if (values.json) printJson({ preview });
    else {
        writers.out(`План публикации (${preview.plan.items.length}):`);
        for (const item of preview.plan.items) {
            writers.out(`- ${item.kind} ${item.id}: ${truncate(item.body, 200)}`);
        }
        for (const warning of preview.warnings) writers.err(`пропуск: ${warning}`);
        writers.out(`хеш: ${preview.plan.hash}`);
    }
    if (!values.yes) {
        writers.out('публикация не выполнена: добавьте --yes или подтвердите в UI');
        return;
    }
    if (values['dry-run']) {
        writers.out('dry-run: публикация пропущена');
        return;
    }
    const { approval } = await client.request<{ approval: { id: string; expiresAt: string } }>('publish.approve', {
        review: reviewId,
        kind,
        ids,
        hash: preview.plan.hash,
    });
    const { result } = await client.request<{ result: { results: { ok: boolean; id: string; skipped?: boolean; error?: string }[] } }>('publish.commit', {
        review: reviewId,
        approvalId: approval.id,
    });
    for (const item of result.results) {
        if (item.ok) writers.out(`✔ ${item.id}${item.skipped ? ' (уже опубликовано)' : ''}`);
        else writers.err(`✖ ${item.id}: ${item.error ?? 'ошибка'}`);
    }
}

async function rules(root: string, arg: string | undefined, values: Values): Promise<void> {
    if (!arg) {
        const loaded = await loadConfig(root);
        const effective = await buildEffectiveRules({
            root,
            config: loaded.config,
            configPath: loaded.path,
            files: values.explain ? [String(values.explain)] : [],
        });
        if (values.json) return printJson(effective);
        return writers.out(renderRules(effective));
    }
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, root, reviewArg(values, arg), values);
        const { rules: result } = await client.request<{ rules: { markdown: string; warnings: string[] } }>('rules.get', { review: review.id });
        if (values.json) return printJson(result);
        writers.out(result.markdown);
    });
}

async function checks(root: string, arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, root, reviewArg(values, arg), values);
        if (values.run && !values.yes) fail('запуск проверок меняет окружение: добавьте --yes, чтобы подтвердить');
        const { results } = await client.request<{ results: { id: string; status: string; output: string }[] }>('checks.run', {
            review: review.id,
            allowRun: values.run === true && values.yes === true,
            ...(values.ids ? { ids: parseList(values.ids as string) } : {}),
        });
        if (values.json) return printJson({ results });
        for (const item of results) {
            writers.out(`${item.status === 'passed' ? '✔' : item.status === 'skipped' ? '○' : '✖'} ${item.id}: ${item.status}`);
            if (item.output) writers.out(item.output.split('\n').slice(0, 20).join('\n'));
        }
    });
}

async function config(root: string, values: Values): Promise<void> {
    const loaded = await loadConfig(root);
    if (values.json) return printJson({ path: loaded.path, config: loaded.config, warnings: loaded.warnings });
    writers.out(`конфиг: ${loaded.path ?? 'нет (.revdeck.yml)'}`);
    writers.out(`правила: ${loaded.config.rules.sources.join(', ') || '—'}`);
    writers.out(`проверки: ${loaded.config.checks.map((check) => check.id).join(', ') || '—'}`);
    writers.out(`публикация: requireApproval=${loaded.config.publish.requireApproval}, максимум ${loaded.config.publish.maxComments}`);
    for (const warning of loaded.warnings) writers.err(`! ${warning}`);
}

async function readBodyInput(values: Values): Promise<string | null> {
    if (values.body !== undefined) return String(values.body);
    if (values['body-file'] !== undefined) {
        const file = String(values['body-file']);
        if (file === '-') return readStdin();
        return readFile(file, 'utf8');
    }
    if (process.stdin.isTTY) return null;
    return readStdin();
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

async function doctor(root: string): Promise<void> {
    const rows: [string, 'ok' | 'warn' | 'fail', string][] = [];
    const major = Number(process.version.slice(1).split('.')[0]);
    rows.push(['node', major >= 22 ? 'ok' : 'fail', process.version]);
    const binaries: Record<string, boolean> = {};
    for (const bin of ['glab', 'gh', 'git']) {
        const present = await which(bin);
        binaries[bin] = present;
        rows.push([bin, present ? 'ok' : 'warn', present ? 'найден' : 'не найден']);
    }

    let host: string | undefined;
    try {
        const loaded = await loadConfig(root);
        host = loaded.config.provider.host ?? (await gitRemote(root))?.host;
        rows.push(['config', loaded.path ? 'ok' : 'warn', loaded.path ?? 'нет .revdeck.yml (автообнаружение)']);
        for (const warning of loaded.warnings) rows.push(['warning', 'warn', warning]);
    } catch (error) {
        rows.push(['config', 'fail', redactLine(error)]);
    }

    if (host && binaries.glab) {
        try {
            await run('glab', ['auth', 'status', '--hostname', host], { timeoutMs: 15_000 });
            rows.push(['glab auth', 'ok', host]);
        } catch (error) {
            rows.push(['glab auth', 'warn', `нет доступа к ${host}: ${redactLine(error).slice(0, 120)}`]);
        }
    }
    if (host && binaries.gh) {
        try {
            await run('gh', ['auth', 'status'], { timeoutMs: 15_000, env: { GH_HOST: host } });
            rows.push(['gh auth', 'ok', host]);
        } catch (error) {
            rows.push(['gh auth', 'warn', `нет доступа к ${host}: ${redactLine(error).slice(0, 120)}`]);
        }
    }

    const running = await isDaemonRunning();
    const info = await daemonInfo();
    rows.push(['daemon', running ? 'ok' : 'warn', running && info ? `${info.url} (pid ${info.pid})` : 'не запущен (запустится сам)']);
    rows.push(['ui', 'ok', info?.url ?? 'будет доступен после запуска']);

    const { existsSync } = await import('node:fs');
    const skill =
        existsSync(path.join(root, '.agents', 'skills', 'revdeck', 'SKILL.md')) ||
        existsSync(path.join(root, '.claude', 'skills', 'revdeck', 'SKILL.md')) ||
        existsSync(path.join(root, '.cursor', 'commands', 'revdeck.md'));
    rows.push(['adapter', skill ? 'ok' : 'warn', skill ? 'установлен' : 'нет: revdeck init']);

    for (const [name, status, detail] of rows) {
        writers.out(`${status === 'ok' ? '✔' : status === 'warn' ? '!' : '✖'} ${name.padEnd(10)} ${detail}`);
    }
    if (!host) writers.out('! хост платформы не определён: укажите provider.host в .revdeck.yml');
}

main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error), (error as { hint?: string }).hint);
});
