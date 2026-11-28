import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../src/core/locale.js';

let report: typeof import('../src/cli/report.js');

beforeAll(async () => {
    // Форматтеры проверяем без ANSI: в CI и pipe цвета и так выключены.
    setLocale('ru');
    process.env.NO_COLOR = '1';
    report = await import('../src/cli/report.js');
});

describe('daemon report', () => {
    it('prints one readable start block without ANSI in a pipe', () => {
        const text = report
            .daemonStartedLines(
                {
                    version: '1.2.3',
                    pid: 42,
                    url: 'http://127.0.0.1:4711/?t=secret',
                    socket: '/tmp/run/daemon.sock',
                    stateDir: '/tmp/state',
                    logPath: '/tmp/state/daemon.log',
                },
                'started',
            )
            .join('\n');
        expect(text).toContain('Демон запущен');
        expect(text).toContain('pid 42');
        expect(text).toContain('http://127.0.0.1:4711/?t=secret');
        expect(text).toContain('revdeck ui --open');
        expect(text).not.toContain('\x1b[');
    });

    it('uses a restarted title and includes health in status', () => {
        setLocale('ru');
        expect(report.daemonStartedLines({ version: '1', pid: 1, url: 'u', socket: 's', stateDir: 'd', logPath: 'l' }, 'restarted').join('\n')).toContain('перезапущен');
        const status = report
            .daemonStatusLines({ version: '1', pid: 1, url: 'http://x', socket: 's', stateDir: 'd', logPath: 'l', startedAt: 'только что', health: 'ok · 3 ревью' })
            .join('\n');
        expect(status).toContain('здоровье');
        expect(status).toContain('ok · 3 ревью');
    });

    it('formats log lines, durations and highlights warnings', () => {
        setLocale('ru');
        expect(report.formatLogLine('plain line')).toBe('  plain line');
        expect(report.formatLogLine('2026-01-01T10:11:12.000Z daemon started')).toMatch(/^ {2}\d{2}:\d{2}:\d{2} {2}daemon started$/);
        expect(report.formatLogLine('2026-01-01T10:11:12.000Z gh failed')).toMatch(/^ {2}\d{2}:\d{2}:\d{2} {2}gh failed$/);

        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
        expect(report.durationSince('2026-01-01T00:59:30Z')).toBe('меньше минуты');
        expect(report.durationSince('2026-01-01T00:55:00Z')).toBe('5 мин');
        expect(report.durationSince('2026-01-01T00:00:00Z')).toBe('1 ч');
        expect(report.durationSince('2025-12-30T01:00:00Z')).toBe('2 дн');
        vi.useRealTimers();
    });

    it('compacts long tool errors at a word boundary and tildifies paths', () => {
        const detail = report.compactDetail('Error: ' + 'word '.repeat(80));
        expect(detail.endsWith('…')).toBe(true);
        expect(detail).not.toMatch(/wor…$/);
        expect(report.tildify('/home/dev/app', '/home/dev')).toBe('~/app');
        expect(report.tildify('/var/lib/revdeck', '/home/dev')).toBe('/var/lib/revdeck');
    });
});
