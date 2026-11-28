import os from 'node:os';
import { locale, plural, tr } from '../core/locale.js';

/**
 * Оформление терминального вывода. Цвет — только в TTY: вывод в pipe, CI и
 * systemd/journald остаётся чистым текстом, который удобно грепать и сравнивать.
 */
export interface Palette {
    readonly enabled: boolean;
    bold(text: string): string;
    dim(text: string): string;
    red(text: string): string;
    green(text: string): string;
    yellow(text: string): string;
    blue(text: string): string;
    magenta(text: string): string;
    cyan(text: string): string;
    /** Ссылка: подчёркивание + синий, читаемо и на светлом, и на тёмном фоне. */
    link(text: string): string;
}

function createPalette(stream: NodeJS.WriteStream): Palette {
    const enabled = (() => {
        if (process.env.NO_COLOR) return false;
        const force = process.env.FORCE_COLOR;
        if (force === '0') return false;
        if (force !== undefined && force !== '') return true;
        return Boolean(stream.isTTY) && process.env.TERM !== 'dumb';
    })();
    const wrap = (open: string, close: string) =>
        (text: string): string => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : text);
    return {
        enabled,
        bold: wrap('1', '22'),
        dim: wrap('2', '22'),
        red: wrap('31', '39'),
        green: wrap('32', '39'),
        yellow: wrap('33', '39'),
        blue: wrap('34', '39'),
        magenta: wrap('35', '39'),
        cyan: wrap('36', '39'),
        link: (text: string): string => (enabled ? `\x1b[4;34m${text}\x1b[0m` : text),
    };
}

export const colors = createPalette(process.stdout);
export const errorColors = createPalette(process.stderr);

/** `~` вместо домашнего каталога: пути в выводе заметно короче. */
export function tildify(value: string, home = os.homedir()): string {
    if (!value || !home) return value;
    const prefix = home.replace(/[\\/]+$/, '');
    if (value === prefix) return '~';
    if (value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}\\`)) return `~${value.slice(prefix.length)}`;
    return value;
}

function padEnd(value: string, width: number): string {
    const length = [...value].length;
    return length >= width ? value : value + ' '.repeat(width - length);
}

function rows(fields: [string, string][]): string[] {
    const width = Math.max(...fields.map(([label]) => [...label].length));
    return fields.map(([label, value]) => `    ${colors.dim(padEnd(label, width))}  ${value}`);
}

export interface DaemonView {
    version: string;
    pid: number;
    /** URL интерфейса; для запуска с launch-токеном, для статуса — без него. */
    url: string;
    socket: string;
    stateDir: string;
    logPath: string;
}

export interface DaemonStatusView extends DaemonView {
    /** Когда демон запущен, по-человечески: «5 мин назад». */
    startedAt: string;
    /** Состояние /api/health; undefined — не проверяли. */
    health?: string;
}

type StartMode = 'started' | 'running' | 'restarted';

function startTitle(mode: StartMode): string {
    if (mode === 'restarted') return tr('Демон перезапущен', 'Daemon restarted');
    if (mode === 'running') return tr('Демон уже работает', 'Daemon already running');
    return tr('Демон запущен', 'Daemon started');
}

const START_FOOTER = (): string =>
    `  ${colors.dim(tr('Открыть интерфейс:', 'Open the UI:'))} ${colors.cyan('revdeck ui --open')}`;

/** Блок после `revdeck daemon start` и при старте демона в foreground. */
export function daemonStartedLines(view: DaemonView, mode: StartMode = 'started'): string[] {
    return [
        '',
        `  ${colors.dim('revdeck')} ${colors.dim(view.version)}`,
        '',
        `  ${colors.green('●')} ${colors.bold(startTitle(mode))} ${colors.dim(`· pid ${view.pid}`)}`,
        '',
        ...rows([
            [tr('интерфейс', 'ui'), colors.link(view.url)],
            [tr('сокет', 'socket'), colors.dim(tildify(view.socket))],
            [tr('данные', 'state'), colors.dim(tildify(view.stateDir))],
            [tr('лог', 'log'), colors.dim(tildify(view.logPath))],
        ]),
        '',
        START_FOOTER(),
        '',
    ];
}

/** Блок `revdeck daemon status` для работающего демона. */
export function daemonStatusLines(view: DaemonStatusView): string[] {
    return [
        '',
        `  ${colors.green('●')} ${colors.bold(tr('Демон работает', 'Daemon is running'))} ${colors.dim(`· pid ${view.pid}`)}`,
        '',
        ...rows([
            [tr('версия', 'version'), view.version],
            [tr('интерфейс', 'ui'), colors.link(view.url)],
            [tr('запущен', 'started'), view.startedAt],
            ...(view.health ? [[tr('здоровье', 'health'), view.health] as [string, string]] : []),
            [tr('сокет', 'socket'), colors.dim(tildify(view.socket))],
            [tr('лог', 'log'), colors.dim(tildify(view.logPath))],
        ]),
        '',
        `  ${colors.dim(tr('Ссылка для входа:', 'Sign-in link:'))} ${colors.cyan('revdeck ui --open')}`,
        '',
    ];
}

export function daemonNotRunningLines(): string[] {
    return [
        '',
        `  ${colors.dim('○')} ${colors.bold(tr('Демон не запущен', 'Daemon is not running'))}`,
        '',
        `  ${colors.dim(tr('Запустить:', 'Start it:'))} ${colors.cyan('revdeck daemon start')}`,
        '',
    ];
}

/** Короткая строка для stop, когда останавливать нечего. */
export function daemonNotRunningLine(): string {
    return `  ${colors.dim('○')} ${colors.dim(tr('Демон не запущен', 'Daemon is not running'))}`;
}

export function daemonStoppedLines(info: { pid?: number; uptime?: string | null }): string[] {
    const details = [
        ...(info.pid ? [`pid ${info.pid}`] : []),
        ...(info.uptime ? [tr(`работал ${info.uptime}`, `was up ${info.uptime}`)] : []),
    ];
    return [
        '',
        `  ${colors.dim('○')} ${colors.bold(tr('Демон остановлен', 'Daemon stopped'))}${details.length ? ` ${colors.dim(`· ${details.join(' · ')}`)}` : ''}`,
        '',
    ];
}

/** Шапка `revdeck daemon logs`. */
export function daemonLogHeader(logPath: string, limit: number, follow = false, rotatedPath?: string): string[] {
    const hint = follow
        ? tr('· слежение, Ctrl-C — выход', '· following, Ctrl-C to stop')
        : `· ${tr('последние', 'last')} ${limit} ${plural(limit, 'строка', 'строки', 'строк', 'line', 'lines')}`;
    return [
        '',
        `  ${colors.bold(tr('Лог демона', 'Daemon log'))} ${colors.dim(hint)}`,
        `  ${colors.dim(tildify(logPath))}`,
        ...(rotatedPath ? [`  ${colors.dim(tr('плюс предыдущий', 'plus the previous'))} ${colors.dim(tildify(rotatedPath))}`] : []),
        '',
    ];
}

export function daemonLogEmptyLines(logPath: string): string[] {
    return [
        '',
        `  ${colors.dim('○')} ${colors.bold(tr('Лог пуст', 'The log is empty'))} ${colors.dim(tr('· демон ещё не запускался', '· the daemon has not started yet'))}`,
        `  ${colors.dim(tildify(logPath))}`,
        '',
    ];
}

/** Строка лога: ISO-время → локальное время; тело строки не меняем. */
export function formatLogLine(line: string): string {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (.+)$/.exec(line);
    if (!match) return `  ${line}`;
    const at = new Date(match[1]!);
    const body = match[2]!;
    if (Number.isNaN(at.getTime())) return `  ${line}`;
    const time = at.toLocaleTimeString(locale() === 'ru' ? 'ru-RU' : 'en-GB', { hour12: false });
    const marked = /error|failed|unavailable|fatal/i.test(body) ? colors.red(body) : body;
    return `  ${colors.dim(time)}  ${marked}`;
}

/** Строки `revdeck doctor`: значок, имя проверки и деталь в несколько строк. */
export function doctorLines(name: string, status: 'ok' | 'warn' | 'fail', detail: string): string[] {
    const mark = status === 'ok' ? colors.green('✔') : status === 'warn' ? colors.yellow('!') : colors.red('✖');
    const [first = '', ...rest] = detail.split('\n');
    return [
        `  ${mark} ${colors.dim(padEnd(name, 10))} ${first}`,
        ...rest.filter(Boolean).map((line) => `${' '.repeat(15)}${colors.dim(line)}`),
    ];
}

/** Подсказка под ошибкой не должна конкурировать с самим сообщением. */
export function errorLine(message: string, hint?: string): string[] {
    return [
        `${errorColors.red('revdeck:')} ${message}`,
        ...(hint ? [`  ${errorColors.dim(hint)}`] : []),
    ];
}

export function warningLine(message: string): string {
    return `${errorColors.yellow('!')} ${message}`;
}

/** Короткая деталь для doctor: первая непустая строка, обрезанная по слову. */
export function compactDetail(value: string, max = 160): string {
    const first = value.split('\n').map((line) => line.trim()).find(Boolean) ?? value.trim();
    if (first.length <= max) return first;
    const cut = first.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[.,;:\s]+$/, '')}…`;
}

/** Длительность от ISO-времени до сейчас: «меньше минуты», «12 мин», «3 ч». */
export function durationSince(iso: string): string | null {
    const started = new Date(iso).getTime();
    if (!Number.isFinite(started)) return null;
    const ms = Math.max(0, Date.now() - started);
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return tr('меньше минуты', 'less than a minute');
    if (minutes < 60) return tr(`${minutes} мин`, `${minutes} min`);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return tr(`${hours} ч`, `${hours} h`);
    const days = Math.floor(hours / 24);
    return tr(`${days} дн`, `${days} d`);
}
