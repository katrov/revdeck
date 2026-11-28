import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { logTail } from '../src/cli/log-tail.js';

let dir = '';

afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
});

async function write(lines: string[], name = 'daemon.log') {
    await writeFile(path.join(dir, name), lines.map((line) => `${line}\n`).join(''));
}

describe('daemon log tail', () => {
    it('takes the last N lines from the current file', async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'revdeck-tail-'));
        await write(['a', 'b', 'c', 'd']);
        expect(await logTail(path.join(dir, 'daemon.log'), 2)).toEqual({ lines: ['c', 'd'], rotated: null });
    });

    it('prepends daemon.log.1 when the current log is short', async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'revdeck-tail-'));
        await write(['old-1', 'old-2', 'old-3'], 'daemon.log.1');
        await write(['new-1', 'new-2']);
        const tail = await logTail(path.join(dir, 'daemon.log'), 4);
        expect(tail.lines).toEqual(['old-2', 'old-3', 'new-1', 'new-2']);
        expect(tail.rotated).toBe(path.join(dir, 'daemon.log.1'));
    });

    it('returns an empty tail when neither file exists', async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'revdeck-tail-'));
        expect(await logTail(path.join(dir, 'daemon.log'), 10)).toEqual({ lines: [], rotated: null });
    });
});
