import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { portHintPath, readPortHint, writePortHint } from '../src/daemon/port.js';

let dir = '';

afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
});

describe('daemon port hint', () => {
    it('remembers the last port for the next start', async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'revdeck-port-'));
        const file = portHintPath(dir);
        expect(await readPortHint(file)).toBeNull();
        await writePortHint(47_123, file);
        expect(await readPortHint(file)).toBe(47_123);
        expect(await readFile(file, 'utf8')).toBe('47123\n');
    });

    it('ignores corrupt and out-of-range hints', async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'revdeck-port-'));
        const file = portHintPath(dir);
        await writeFile(file, 'nope');
        expect(await readPortHint(file)).toBeNull();
        await writeFile(file, '99999');
        expect(await readPortHint(file)).toBeNull();
        await writeFile(file, '0');
        expect(await readPortHint(file)).toBeNull();
        await writePortHint(0, file);
        expect(await readFile(file, 'utf8')).toBe('0');
    });
});
