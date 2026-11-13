#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { daemonInfoPath, findRepoRoot, logPath } from '../core/paths.js';
import { loadConfig } from '../core/config.js';
import { buildEffectiveRules, renderRules } from '../core/rules.js';
import { changedPaths } from '../core/diff.js';
import type { ReviewView } from '../daemon/view.js';
import { daemonBinaries, isDaemonRunning, ensureDaemon, daemonInfo, uiBaseUrl, isDevContainer, type DaemonClient } from '../client.js';
import { resolveExecutable, run } from '../core/exec.js';
import { redactLine } from '../core/redact.js';
import { gitRemote } from '../core/git.js';
import { VERSION } from '../version.js';
import { detectLocale, locale, plural, setLocale, tr } from '../core/locale.js';
import { fail, parseList, printJson, reviewLine, truncate, usage, when, writers } from './format.js';
import { installService, runInit } from './init.js';
import { runEject } from './eject.js';
import { runDevcontainer } from './devcontainer.js';
import { exportReview, importReview } from './export.js';
import { attachmentSpec, MAX_ATTACHMENT_BYTES } from '../core/attachments.js';
import { contextPayload, renderContext } from '../context.js';
import type { ResolvedReviewRole } from '../core/review-roles.js';

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
    'keep-config': { type: 'boolean', default: false },
    write: { type: 'boolean', default: false },
    explain: { type: 'string' },
    limit: { type: 'string' },
    decision: { type: 'string' },
    note: { type: 'string' },
    emoji: { type: 'string' },
    text: { type: 'string' },
    line: { type: 'string' },
    id: { type: 'string' },
    toAgent: { type: 'boolean', default: true },
    all: { type: 'boolean', default: false },
    lang: { type: 'string' },
    role: { type: 'string' },
    shard: { type: 'string' },
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

const HELP_RU = `revdeck ${VERSION} — ревью GitLab/GitHub для людей и агентов

  revdeck init            настроить проект: .revdeck.yml, адаптеры, MCP
  revdeck eject           удалить revdeck из проекта (--yes; --keep-config)
  revdeck devcontainer    подключить devcontainer к демону хоста (--write)
  revdeck doctor          проверить окружение и доступы
  revdeck daemon <start|stop|restart|status|logs|install|uninstall>
  revdeck list            открытые ревью (локальный кеш), --remote — с платформы
  revdeck open <url|N...>  открыть одно или несколько ревью
  revdeck ui [N]          ссылка на локальный интерфейс
  revdeck context <N>     контекст для агента: правила, diff, треды [--role <роль>] [--shard i/N]
  revdeck stats <N>       аналитика ревью: решения, отклонения, треды
  revdeck scan <N>        скан секретов (если включён review.secrets)
  revdeck versions <N>    история версий ревью
  revdeck threads <N>     обсуждения
  revdeck diff <N> [--file <путь>]
  revdeck findings <N> [list|set --file <json>|decide --id <id> --decision accept|reject|discuss]
  revdeck summary <N> [--file <json>]      выжимка MR
  revdeck reply <N> --thread <id> (--body <текст> | --body-file <файл> | -) [--resolve] [--publish --yes]
  revdeck notes <N> <list|add|update|delete|reply>
  revdeck react <N> --note <id> --emoji <name>   поставить или снять реакцию
  revdeck attach <N> --file <путь>               загрузить картинку/видео в платформу
  revdeck publish <N> [--kind reply|finding|note] [--ids a,b] [--yes]
  revdeck rules [<N>] [--explain <путь>]
  revdeck checks <N> [--run --yes]
  revdeck export <N> [--dir .revdeck]   выгрузка в старый файловый формат
  revdeck import <N> [--dir .revdeck]   импорт из старого формата
  revdeck config [--json]                 эффективный конфиг проекта
  revdeck mcp                             запустить MCP-сервер (stdio)

Общие флаги: --json, --root <путь>, --review <id>, --lang ru|en, --help.
Публикация без --yes никогда не выполняется: сначала показывается план.`;
const HELP_EN = `revdeck ${VERSION} — code review for GitLab/GitHub, for humans and agents

  revdeck init            set up a project: .revdeck.yml, adapters, MCP
  revdeck eject           remove revdeck from the project (--yes; --keep-config)
  revdeck devcontainer    connect a devcontainer to the host daemon (--write)
  revdeck doctor          check the environment and access
  revdeck daemon <start|stop|restart|status|logs|install|uninstall>
  revdeck list            open reviews (local cache), --remote — from the platform
  revdeck open <url|N...>  open one or more reviews
  revdeck ui [N]          link to the local UI
  revdeck context <N>     agent context: rules, diff, threads [--role <role>] [--shard i/N]
  revdeck stats <N>       review analytics: decisions, rejections, threads
  revdeck scan <N>        secret scan (when review.secrets is enabled)
  revdeck versions <N>    review version history
  revdeck threads <N>     discussions
  revdeck diff <N> [--file <path>]
  revdeck findings <N> [list|set --file <json>|decide --id <id> --decision accept|reject|discuss]
  revdeck summary <N> [--file <json>]      review summary
  revdeck reply <N> --thread <id> (--body <text> | --body-file <file> | -) [--resolve] [--publish --yes]
  revdeck notes <N> <list|add|update|delete|reply>
  revdeck react <N> --note <id> --emoji <name>   add or remove a reaction
  revdeck attach <N> --file <path>               upload an image/video to the platform
  revdeck publish <N> [--kind reply|finding|note] [--ids a,b] [--yes]
  revdeck rules [<N>] [--explain <path>]
  revdeck checks <N> [--run --yes]
  revdeck export <N> [--dir .revdeck]   export to the legacy file format
  revdeck import <N> [--dir .revdeck]   import from the legacy format
  revdeck config [--json]                 effective project config
  revdeck mcp                             start the MCP server (stdio)

Common flags: --json, --root <path>, --review <id>, --lang ru|en, --help.
Publishing never happens without --yes: the plan is shown first.`;
const helpText = (): string => tr(HELP_RU, HELP_EN);

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    // Глобальный --lang можно ставить и до команды: revdeck --lang en context 42.
    const globals: string[] = [];
    while (argv[0] === '--lang' || argv[0]?.startsWith('--lang=')) {
        const arg = argv.shift()!;
        globals.push(arg);
        if (arg === '--lang' && argv[0] && !argv[0].startsWith('-')) globals.push(argv.shift()!);
    }
    const command = argv[0];
    const { values, positionals } = parse([...argv.slice(1), ...globals]);
    setLocale(values.lang === 'ru' || values.lang === 'en' ? values.lang : detectLocale());
    if (!command || command === 'help' || command === '--help' || values.help) {
        writers.out(helpText());
        return;
    }
    if (command === 'version' || command === '--version') {
        writers.out(VERSION);
        return;
    }
    const root = String(values.root ?? findRepoRoot());

    switch (command) {
        case 'init':
            return runInit(root, { force: values.force === true, adapters: parseList(values.adapters as string), noService: values['no-service'] === true, locale: values.lang === 'ru' || values.lang === 'en' ? values.lang : detectLocale(), outputLanguage: values.lang === 'ru' || values.lang === 'en' ? values.lang : 'auto' });
        case 'eject':
            return runEject(root, { yes: values.yes === true && values['dry-run'] !== true, keepConfig: values['keep-config'] === true });
        case 'devcontainer':
            return runDevcontainer(root, { write: values.write === true });
        case 'doctor':
            return doctor(root);
        case 'daemon':
            return daemon(positionals[0] ?? 'status', values);
        case 'list':
            return list(root, values);
        case 'open':
            return openReview(root, positionals, values);
        case 'ui':
            return ui(positionals[0], values);
        case 'status':
            return status();
        case 'context':
        case 'review':
            return context(root, positionals[0], values);
        case 'stats':
        case 'analytics':
            return stats(positionals[0], values);
        case 'scan':
        case 'secrets':
            return secrets(positionals[0], values);
        case 'versions':
            return versions(positionals[0], values);
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
        case 'react':
            return react(positionals[0], values);
        case 'attach':
            return attach(positionals[0], values);
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
            usage([`${tr('неизвестная команда', 'unknown command')}: ${command}`, '', helpText()]);
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
    if (!listed.reviews.length) fail(tr('ревью не открыто', 'no review is open'), tr('укажите номер или ссылку: revdeck open 42', 'pass a number or URL: revdeck open 42'));
    fail(tr('открыто несколько ревью: укажите номер или id', 'several reviews are open: pass a number or an id'), listed.reviews.map((item) => `  ${item.id}`).join('\n'));
}

function formatInfo(review: ReviewView): string[] {
    const info = review.info;
    return [
        `#${info.ref.number} ${info.title}`,
        `${info.webUrl}`,
        `${info.ref.project} · ${info.sourceBranch} → ${info.targetBranch} · ${info.state}${info.draft ? ' · draft' : ''} · ${tr('автор', 'by')} ${info.author}`,
        `${review.stats.files} ${plural(review.stats.files, 'файл', 'файла', 'файлов', 'file', 'files')}, +${review.stats.additions} −${review.stats.deletions} · ${tr('обновлено', 'updated')} ${when(review.syncedAt)}${review.stale ? tr(' (устарело)', ' (stale)') : ''}`,
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
            if (!result.items.length) writers.out(tr('открытых ревью нет', 'no open reviews'));
        });
        return;
    }
    await withClient(async ({ client }) => {
        const { reviews } = await client.request<{ reviews: { number: number; title: string; author: string; project: string; syncedAt: string }[] }>('reviews.list');
        if (values.json) return printJson({ reviews });
        if (!reviews.length) return writers.out(tr('ревью ещё не открывались: revdeck open <N>', 'no reviews opened yet: revdeck open <N>'));
        for (const item of reviews) writers.out(reviewLine(item));
    });
}

async function openReview(root: string, args: string[], values: Values): Promise<void> {
    if (!args.length) fail(tr('укажите номер или ссылку на ревью', 'pass a review number or URL'));
    await withClient(async ({ client }) => {
        const requests = args.map(async (input) => {
            const result = await client.request<{ review: ReviewView }>('reviews.open', {
                root,
                input,
                ...(values.platform ? { platform: values.platform as 'gitlab' | 'github' } : {}),
                ...(values.project ? { project: values.project } : {}),
                ...(values.host ? { host: values.host } : {}),
                ...(values.branch ? { branch: values.branch } : {}),
            });
            return result.review;
        });
        const settled = await Promise.allSettled(requests);
        const reviews = settled.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
        const failures = settled.flatMap((item) => (item.status === 'rejected' ? [item.reason as Error] : []));
        if (values.json) {
            if (args.length === 1 && reviews[0]) return printJson(reviews[0]);
            if (!reviews.length) fail(failures[0]?.message ?? tr('ревью не открыто', 'no review was opened'));
            return printJson(reviews);
        }
        for (const review of reviews) {
            writers.out(formatInfo(review).join('\n'));
            if (review.errors.length) writers.err(`${tr('предупреждения', 'warnings')}:\n${review.errors.map((item) => `  ${item}`).join('\n')}`);
        }
        for (const failure of failures) writers.err(tr(`не удалось открыть: ${failure.message}`, `could not open: ${failure.message}`));
        if (values.ui && reviews.length) printUi(reviews[reviews.length - 1]!.id, values);
        if (!reviews.length) fail(failures[0]?.message ?? tr('ревью не открыто', 'no review was opened'));
    });
}

async function ui(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        if (arg) await resolveReview(client, findRepoRoot(), arg, values).catch(() => undefined);
    });
    const info = await daemonInfo();
    if (!info) fail(tr('демон не запущен', 'the daemon is not running'), 'revdeck daemon start');
    const url = `${uiBaseUrl(info)}/?t=${info.token}`;
    writers.out(url);
    if (values.open) openBrowser(url);
}

function printUi(reviewId: string | undefined, values: Values): void {
    const info = daemonInfoSync();
    if (!info) return writers.err(tr('демон не запущен: revdeck daemon start', 'the daemon is not running: revdeck daemon start'));
    const url = `${uiBaseUrl(info)}/?t=${info.token}${reviewId ? `&review=${encodeURIComponent(reviewId)}` : ''}`;
    writers.out(`UI: ${url}`);
    if (values.open) openBrowser(url);
}

function daemonInfoSync(): { url: string; token: string; port: number } | null {
    try {
        return JSON.parse(readFileSync(daemonInfoPath(), 'utf8')) as { url: string; token: string; port: number };
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

async function daemon(action: string, values: Values = {}): Promise<void> {
    if (isDevContainer() && ['start', 'stop', 'restart', 'install', 'uninstall'].includes(action)) {
        fail(
            tr(
                'в devcontainer демоном управляет хост: выполните команду на хосте',
                'the daemon is managed by the host in a devcontainer: run this command on the host',
            ),
            tr('revdeck daemon restart на хосте', 'revdeck daemon restart on the host'),
        );
    }
    if (action === 'start') {
        const { client, started } = await ensureDaemon({
            ...(values.host ? { daemonArgs: ['--host', String(values.host)] } : {}),
        });
        const ping = await client.request<{ pid: number; version: string }>('ping');
        client.close();
        const info = await daemonInfo();
        writers.out(`${started ? tr('запущен', 'started') : tr('уже работает', 'already running')} ${tr('демон', 'daemon')} pid ${ping.pid}, ${tr('версия', 'version')} ${ping.version}`);
        if (values.host && !started) {
            writers.err(tr('! уже запущенный демон не меняет bind-адрес: используйте revdeck daemon restart --host 0.0.0.0', '! a running daemon does not rebind: use revdeck daemon restart --host 0.0.0.0'));
        }
        if (info) writers.out(`${uiBaseUrl(info)}/?t=${info.token}`);
        return;
    }
    if (action === 'status') {
        const running = await isDaemonRunning();
        const info = await daemonInfo();
        if (!running || !info) {
            writers.out(tr('демон не запущен', 'the daemon is not running'));
            process.exit(1);
        }
        writers.out(`pid ${info.pid} · ${info.url} · ${when(info.startedAt)}`);
        return;
    }
    if (action === 'install') {
        await installService(values.host ? String(values.host) : undefined);
        return;
    }
    if (action === 'uninstall') {
        writers.out(tr('удалите unit вручную: systemctl --user disable --now revdeck (Linux) или launchctl unload (macOS)', 'remove the unit manually: systemctl --user disable --now revdeck (Linux) or launchctl unload (macOS)'));
        return;
    }
    if (action === 'stop') {
        const info = await daemonInfo();
        if (!info) {
            writers.out(tr('демон не запущен', 'the daemon is not running'));
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
        writers.out(tr('демон остановлен', 'daemon stopped'));
        return;
    }
    if (action === 'restart') {
        await daemon('stop');
        return daemon('start', values);
    }
    if (action === 'logs') {
        try {
            const text = await readFile(logPath(), 'utf8');
            writers.out(text.split('\n').slice(-80).join('\n'));
        } catch {
            writers.out(tr('лог пуст', 'the log is empty'));
        }
        return;
    }
    usage(['daemon <start|stop|status|restart|logs|install|uninstall>']);
}

async function status(): Promise<void> {
    await withClient(async ({ client }) => {
        const { reviews } = await client.request<{ reviews: { id: string; number: number; title: string; author: string; project: string; syncedAt: string }[] }>('reviews.list');
        if (!reviews.length) {
            writers.out(tr('ревью ещё не открывались', 'no reviews opened yet'));
            return;
        }
        for (const item of reviews) writers.out(reviewLine(item));
    });
}

function parseRole(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value;
}

function parseShard(value: string | undefined): { index: number; count: number } | undefined {
    if (!value) return undefined;
    const match = /^(\d+)\/(\d+)$/.exec(value);
    if (!match) fail(tr(`некорректный шард ${value}`, `invalid shard ${value}`), tr('формат: --shard 1/3', 'format: --shard 1/3'));
    const index = Number(match[1]);
    const count = Number(match[2]);
    if (index < 1 || count < 1 || index > count) fail(tr(`некорректный шард ${value}`, `invalid shard ${value}`), tr('индекс от 1 до количества', 'index must be between 1 and the count'));
    return { index, count };
}

async function context(root: string, arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, root, reviewArg(values, arg), values);
        const { rules } = await client.request<{ rules: { markdown: string; configPath: string | null; warnings: string[]; checks: { id: string; name: string; argv: string[]; consent: boolean; matched: boolean }[]; language: 'ru' | 'en'; maxBytes?: number; agents: number; roles: ResolvedReviewRole[] } }>('rules.get', {
            review: review.id,
        });
        if (values.json) return printJson(contextPayload(review, rules));
        const role = parseRole(values.role as string | undefined);
        if (role && !rules.roles.some((item) => item.id === role)) {
            fail(tr(`неизвестная роль ${role}`, `unknown role ${role}`), `--role <${rules.roles.map((item) => item.id).join('|')}>`);
        }
        const shard = parseShard(values.shard as string | undefined);
        writers.out(renderContext(review, rules, {
            language: rules.language,
            ...(rules.maxBytes !== undefined ? { maxBytes: rules.maxBytes } : {}),
            ...(role ? { role } : {}),
            ...(shard ? { shard } : {}),
        }));
    });
}

async function versions(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const { versions } = await client.request<{ versions: { id: number; headSha: string; baseSha: string; createdAt: string; files: number; findings: number; additions: number; deletions: number }[] }>('versions.list', { review: review.id });
        if (values.json) return printJson(versions);
        if (!versions.length) {
            writers.out(tr('история версий пуста: включите review.history.enabled', 'version history is empty: enable review.history.enabled'));
            return;
        }
        for (const version of versions) {
            writers.out(`#${version.id} · ${version.headSha.slice(0, 12) || '—'} · ${version.createdAt} · ${version.files} ${tr('файлов', 'files')} · +${version.additions} −${version.deletions} · ${version.findings} ${tr('замечаний', 'findings')}`);
        }
    });
}

async function secrets(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const result = await client.request<{ enabled: boolean; scan: string; findings: { rule: string; title: string; file: string; line: number; preview: string }[] }>('secrets.get', { review: review.id });
        if (values.json) return printJson(result);
        if (!result.enabled) {
            writers.out(tr('скан секретов выключен: review.secrets.enabled: true', 'secret scan is disabled: set review.secrets.enabled: true'));
            return;
        }
        writers.out(`${tr('скан', 'scan')}: ${result.scan} · ${result.findings.length} ${tr('находок', 'findings')}`);
        for (const finding of result.findings) writers.out(`✖ ${finding.rule} · ${finding.file}:${finding.line} · ${finding.preview}`);
    });
}

async function stats(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const { analytics } = await client.request<{ analytics: Record<string, unknown> }>('analytics.get', { review: review.id });
        if (values.json) return printJson(analytics);
        const findings = analytics.findings as { total: number; accepted: number; rejected: number; pending: number; published: number };
        const threads = analytics.threads as { total: number; open: number; resolved: number };
        const rate = analytics.acceptanceRate as number | null;
        writers.out(`#${review.info.ref.number} ${review.info.title}`);
        writers.out(`${tr('замечания', 'findings')}: ${findings.total} · ${tr('принято', 'accepted')} ${findings.accepted} · ${tr('отклонено', 'rejected')} ${findings.rejected} · ${tr('без решения', 'pending')} ${findings.pending} · ${tr('опубликовано', 'published')} ${findings.published}`);
        writers.out(`${tr('треды', 'threads')}: ${threads.total} · ${tr('открыто', 'open')} ${threads.open} · ${tr('закрыто', 'resolved')} ${threads.resolved}`);
        writers.out(`${tr('acceptance rate', 'acceptance rate')}: ${rate == null ? '—' : `${Math.round(rate * 100)}%`}`);
        for (const rejection of analytics.rejections as { level: string; title: string; file: string; line: number | null; note: string }[]) {
            writers.out(`✖ ${rejection.level} ${rejection.title} (${rejection.file}:${rejection.line ?? '—'})${rejection.note ? ` — ${rejection.note}` : ''}`);
        }
    });
}

async function threads(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), arg, values);
        if (values.json) return printJson({ threads: review.threads });
        if (!review.threads.length) return writers.out(tr('обсуждений нет', 'no discussions'));
        for (const thread of review.threads) {
            writers.out(`${thread.resolved ? '✔' : '○'} ${thread.path ?? tr('общий', 'general')}:${thread.line ?? '-'} · ${thread.id}`);
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
        if (!file) fail(`${tr('файла', 'file')} ${values.file} ${tr('нет в diff', 'is not in the diff')}`);
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
            if (!values.file) fail(tr('укажите --file с JSON замечаний', 'pass --file with findings JSON'));
            const raw = JSON.parse(await readFile(String(values.file), 'utf8')) as unknown;
            const list = Array.isArray(raw) ? raw : (raw as { findings?: unknown[] }).findings;
            if (!Array.isArray(list)) fail(tr('ожидался массив или {findings: [...]}', 'expected an array or {findings: [...]}'));
            const { findings: saved } = await client.request<{ findings: unknown[] }>('findings.put', { review: review.id, findings: list });
            if (values.json) return printJson({ findings: saved });
            writers.out(`${tr('сохранено замечаний', 'findings saved')}: ${saved.length}`);
            return;
        }
        if (action === 'decide') {
            if (!values.id || !values.decision) fail(tr('нужны --id и --decision', '--id and --decision are required'));
            await client.request('decisions.put', {
                review: review.id,
                decisions: { [String(values.id)]: { decision: values.decision, note: String(values.note ?? '') } },
            });
            writers.out(tr('решение сохранено', 'decision saved'));
            return;
        }
        if (values.json) return printJson({ findings: review.findings });
        if (!review.findings.length) return writers.out(tr('замечаний нет', 'no findings'));
        for (const finding of review.findings) {
            writers.out(`${finding.level.padEnd(8)} ${finding.status.padEnd(10)} ${finding.file}:${finding.line ?? '-'} · ${finding.id}`);
            writers.out(`  ${truncate(finding.title, 200)}`);
        }
    });
}

async function summary(arg: string | undefined, values: Values): Promise<void> {
    if (!values.file && process.stdin.isTTY) fail(tr('укажите --file с JSON выжимки или передайте её через stdin', 'pass --file with summary JSON or pipe it via stdin'));
    const raw = values.file ? JSON.parse(await readFile(String(values.file), 'utf8')) : JSON.parse(await readStdin());
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const result = await client.request<{ summary: unknown }>('summary.put', { review: review.id, summary: raw });
        if (values.json) return printJson(result);
        writers.out(tr('выжимка сохранена', 'summary saved'));
    });
}

async function reply(arg: string | undefined, values: Values): Promise<void> {
    const body = await readBodyInput(values);
    if (body === null) fail(tr('нужен ответ: --body, --body-file или stdin (-)', 'a reply is required: --body, --body-file or stdin (-)'));
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        if (!values.thread) fail(tr('укажите --thread <id>', 'pass --thread <id>'));
        const { draft } = await client.request<{ draft: { threadId: string; body: string; replied: boolean } }>('drafts.put', {
            review: review.id,
            threadId: String(values.thread),
            patch: { body, resolve: values.resolve === true },
        });
        writers.out(`${tr('черновик сохранён для', 'draft saved for')} ${draft.threadId}`);
        if (values.publish) await publishSelection(client, review.id, 'reply', [draft.threadId], values);
    });
}

async function notes(arg: string | undefined, action: string, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        if (action === 'add') {
            if (!values.file || !values.line || !values.text) fail(tr('нужны --file, --line, --text', '--file, --line and --text are required'));
            await client.request('notes.add', {
                review: review.id,
                file: values.file,
                line: Number(values.line),
                text: values.text,
                toAgent: values.toAgent !== false,
            });
            writers.out(tr('комментарий добавлен', 'comment added'));
            return;
        }
        if (action === 'reply') {
            if (!values.id || !values.text) fail(tr('нужны --id и --text', '--id and --text are required'));
            await client.request('notes.update', { review: review.id, noteId: values.id, patch: { agentReply: values.text } });
            writers.out(tr('ответ агента сохранён', 'agent reply saved'));
            return;
        }
        if (action === 'delete') {
            if (!values.id) fail(tr('нужен --id', '--id is required'));
            await client.request('notes.delete', { review: review.id, noteId: values.id });
            writers.out(tr('комментарий удалён', 'comment deleted'));
            return;
        }
        if (action === 'update') {
            if (!values.id) fail(tr('нужен --id', '--id is required'));
            await client.request('notes.update', {
                review: review.id,
                noteId: values.id,
                patch: {
                    ...(values.text !== undefined ? { text: values.text } : {}),
                    ...(values.toAgent !== undefined ? { toAgent: values.toAgent } : {}),
                },
            });
            writers.out(tr('комментарий обновлён', 'comment updated'));
            return;
        }
        if (values.json) return printJson({ notes: review.notes });
        if (!review.notes.length) writers.out(tr('комментариев нет', 'no comments'));
        for (const note of review.notes) {
            writers.out(`${note.file}:${note.line} · ${note.toAgent ? tr('агенту', 'to agent') : tr('себе', 'private')} · ${note.id}`);
            writers.out(`  ${truncate(note.text, 300)}${note.agentReply ? `\n  → ${truncate(note.agentReply, 300)}` : ''}`);
        }
    });
}

async function react(arg: string | undefined, values: Values): Promise<void> {
    if (!values.note || !values.emoji) fail(tr('нужны --note <id> и --emoji <name>', '--note <id> and --emoji <name> are required'));
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const result = await client.request<{ active: boolean; reactions: { name: string; count: number; mine: boolean }[] }>('reactions.toggle', {
            review: review.id,
            noteId: String(values.note),
            emoji: String(values.emoji),
        });
        if (values.json) return printJson(result);
        writers.out(`${result.active ? '✔' : '○'} ${values.emoji}${result.active ? ` · ${tr('поставлена', 'added')}` : ` · ${tr('снята', 'removed')}`}`);
        for (const reaction of result.reactions) writers.out(`  ${reaction.name}${reaction.mine ? ' ·' : ''} ${reaction.count}`);
    });
}

async function attach(arg: string | undefined, values: Values): Promise<void> {
    if (!values.file) fail(tr('укажите --file с картинкой или видео', 'pass --file with an image or video'));
    const name = path.basename(String(values.file));
    const spec = attachmentSpec(name);
    if (!spec) fail(tr('разрешены PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, OGV и MOV', 'PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, OGV and MOV are allowed'));
    const file = String(values.file);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) fail(tr(`нет файла ${file}`, `file ${file} does not exist`));
    if (info.size > MAX_ATTACHMENT_BYTES) {
        fail(tr(`файл больше ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} МБ`, `file is larger than ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB`));
    }
    const data = await readFile(file);
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const result = await client.request<{ attachment: { name: string; url: string; markdown: string } }>('attachments.upload', {
            review: review.id,
            name,
            contentType: spec.contentType,
            data: data.toString('base64'),
        });
        if (values.json) return printJson(result.attachment);
        writers.out(`${tr('загружено', 'uploaded')}: ${result.attachment.url}`);
        writers.out(result.attachment.markdown);
    });
}

async function publish(arg: string | undefined, values: Values): Promise<void> {
    await withClient(async ({ client }) => {
        const { review } = await resolveReview(client, findRepoRoot(), reviewArg(values, arg), values);
        const kind = (values.kind as 'reply' | 'finding' | 'note') ?? 'reply';
        let ids = parseList(values.ids as string);
        if (!ids.length) ids = defaultSelection(review, kind);
        if (!ids.length) fail(tr('нечего публиковать: нет выбранных элементов', 'nothing to publish: no items selected'));
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
        writers.out(`${tr('План публикации', 'Publish plan')} (${preview.plan.items.length}):`);
        for (const item of preview.plan.items) {
            writers.out(`- ${item.kind} ${item.id}: ${truncate(item.body, 200)}`);
        }
        for (const warning of preview.warnings) writers.err(`${tr('пропуск', 'skipped')}: ${warning}`);
        writers.out(`${tr('хеш', 'hash')}: ${preview.plan.hash}`);
    }
    if (!values.yes) {
        writers.out(tr('публикация не выполнена: добавьте --yes или подтвердите в UI', 'not published: add --yes or confirm in the UI'));
        return;
    }
    if (values['dry-run']) {
        writers.out(tr('dry-run: публикация пропущена', 'dry-run: publishing skipped'));
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
        if (item.ok) writers.out(`✔ ${item.id}${item.skipped ? tr(' (уже опубликовано)', ' (already published)') : ''}`);
        else writers.err(`✖ ${item.id}: ${item.error ?? tr('ошибка', 'error')}`);
    }
}

async function rules(root: string, arg: string | undefined, values: Values): Promise<void> {
    if (!arg) {
        const loaded = await loadConfig(root);
        const language = locale();
        const effective = await buildEffectiveRules({
            root,
            config: loaded.config,
            configPath: loaded.path,
            files: values.explain ? [String(values.explain)] : [],
            language,
        });
        if (values.json) return printJson(effective);
        return writers.out(renderRules(effective, { language, maxBytes: loaded.config.rules.maxTotalBytes }));
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
        if (values.run && !values.yes) fail(tr('запуск проверок меняет окружение: добавьте --yes, чтобы подтвердить', 'running checks changes the environment: add --yes to confirm'));
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
    if (values.json) return printJson({ path: loaded.path, localPath: loaded.localPath, config: loaded.config, warnings: loaded.warnings });
    writers.out(`${tr('конфиг', 'config')}: ${loaded.path ?? tr('нет (.revdeck.yml)', 'none (.revdeck.yml)')}`);
    if (loaded.localPath) writers.out(`${tr('локальный конфиг', 'local config')}: ${loaded.localPath}`);
    writers.out(`${tr('роли', 'roles')}: ${loaded.config.review.agents} · ${loaded.config.review.roles.join(', ')}${loaded.config.review.readOnly ? tr(' · read-only', ' · read-only') : ''}`);
    writers.out(`${tr('правила', 'rules')}: ${loaded.config.rules.sources.join(', ') || '—'}`);
    writers.out(`${tr('проверки', 'checks')}: ${loaded.config.checks.map((check) => check.id).join(', ') || '—'}`);
    writers.out(`${tr('публикация', 'publishing')}: requireApproval=${loaded.config.publish.requireApproval}, ${tr('максимум', 'max')} ${loaded.config.publish.maxComments}`);
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
    const container = isDevContainer();
    const major = Number(process.version.slice(1).split('.')[0]);
    rows.push(['node', major >= 22 ? 'ok' : 'fail', process.version]);
    if (container) {
        rows.push(['mode', 'ok', tr('devcontainer: revdeck и gh/glab работают на хосте', 'devcontainer: revdeck and gh/glab run on the host')]);
    }
    const binaries: Record<string, boolean> = {};
    for (const bin of ['glab', 'gh', 'git']) {
        const resolved = await resolveExecutable(bin);
        const present = resolved !== null;
        binaries[bin] = present;
        if (container && (bin === 'glab' || bin === 'gh')) {
            rows.push([bin, 'ok', present ? tr('есть в контейнере, но не используется', 'present in the container but unused') : tr('не нужен в контейнере: работает на хосте', 'not needed in the container: the host runs it')]);
            continue;
        }
        rows.push([
            bin,
            present ? 'ok' : 'warn',
            present
                ? resolved
                : tr(
                      `не найден: установите ${bin} или добавьте его в PATH (REVDECK_${bin.toUpperCase()})`,
                      `not found: install ${bin} or add it to PATH (REVDECK_${bin.toUpperCase()})`,
                  ),
        ]);
    }

    let host: string | undefined;
    try {
        const loaded = await loadConfig(root);
        host = loaded.config.provider.host ?? (await gitRemote(root))?.host;
        rows.push(['config', loaded.path ? 'ok' : 'warn', loaded.path ?? tr('нет .revdeck.yml (автообнаружение)', 'no .revdeck.yml (auto-discovery)')]);
        if (loaded.localPath) rows.push(['local config', 'ok', loaded.localPath]);
        for (const warning of loaded.warnings) rows.push(['warning', 'warn', warning]);
    } catch (error) {
        rows.push(['config', 'fail', redactLine(error)]);
    }

    if (!container) {
        if (host && binaries.glab) {
            try {
                await run('glab', ['auth', 'status', '--hostname', host], { timeoutMs: 15_000 });
                rows.push(['glab auth', 'ok', host]);
            } catch (error) {
                rows.push(['glab auth', 'warn', `${tr('нет доступа к', 'no access to')} ${host}: ${redactLine(error).slice(0, 120)}`]);
            }
        }
        if (host && binaries.gh) {
            try {
                await run('gh', ['auth', 'status'], { timeoutMs: 15_000, env: { GH_HOST: host } });
                rows.push(['gh auth', 'ok', host]);
            } catch (error) {
                rows.push(['gh auth', 'warn', `${tr('нет доступа к', 'no access to')} ${host}: ${redactLine(error).slice(0, 120)}`]);
            }
        }
    }

    const running = await isDaemonRunning();
    const info = await daemonInfo();
    const daemonStatus: 'ok' | 'warn' | 'fail' = running ? 'ok' : container ? 'fail' : 'warn';
    rows.push([
        'daemon',
        daemonStatus,
        running && info
            ? `${uiBaseUrl(info)} (pid ${info.pid})`
            : container
              ? tr('не найден: на хосте выполните revdeck daemon start', 'not found: run revdeck daemon start on the host')
              : tr('не запущен (запустится сам)', 'not running (starts on demand)'),
    ]);
    rows.push(['ui', running ? 'ok' : 'warn', info ? uiBaseUrl(info) : tr('будет доступен после запуска', 'available after the daemon starts')]);
    if (running) {
        const seen = await daemonBinaries();
        for (const bin of ['glab', 'gh'] as const) {
            if (!seen) {
                rows.push([`daemon ${bin}`, 'warn', tr('демон старой версии: перезапустите его', 'old daemon version: restart it')]);
                continue;
            }
            rows.push([
                `daemon ${bin}`,
                seen[bin] ? 'ok' : 'fail',
                seen[bin] ?? tr('демон не видит бинарник: обновите PATH или переустановите сервис', 'the daemon cannot see the binary: update PATH or reinstall the service'),
            ]);
        }
    }

    const { existsSync } = await import('node:fs');
    const skill =
        existsSync(path.join(root, '.agents', 'skills', 'revdeck', 'SKILL.md')) ||
        existsSync(path.join(root, '.claude', 'skills', 'revdeck', 'SKILL.md')) ||
        existsSync(path.join(root, '.cursor', 'commands', 'revdeck.md'));
    rows.push(['adapter', skill ? 'ok' : 'warn', skill ? tr('установлен', 'installed') : tr('нет: revdeck init', 'missing: revdeck init')]);

    for (const [name, status, detail] of rows) {
        writers.out(`${status === 'ok' ? '✔' : status === 'warn' ? '!' : '✖'} ${name.padEnd(10)} ${detail}`);
    }
    if (!host) writers.out(tr('! хост платформы не определён: укажите provider.host в .revdeck.yml', '! platform host is unknown: set provider.host in .revdeck.yml'));
}

main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error), (error as { hint?: string }).hint);
});
