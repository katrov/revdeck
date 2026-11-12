import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveExecutable, run } from '../src/core/exec.js';

const original = process.env.REVDECK_GLAB;

afterEach(() => {
    if (original === undefined) delete process.env.REVDECK_GLAB;
    else process.env.REVDECK_GLAB = original;
});

describe('executable resolution', () => {
    it('resolves glab outside the daemon PATH via REVDECK_GLAB', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-exec-'));
        const file = path.join(dir, 'glab');
        await writeFile(file, '#!/bin/sh\necho fake-glab\n');
        await chmod(file, 0o755);
        process.env.REVDECK_GLAB = file;
        expect(await resolveExecutable('glab')).toBe(file);
        const result = await run('glab', []);
        expect(result.stdout.trim()).toBe('fake-glab');
    });

    it('does not cache a missing binary forever', async () => {
        const name = 'revdeck-definitely-missing-binary';
        expect(await resolveExecutable(name)).toBeNull();
        expect(await resolveExecutable(name)).toBeNull();
    });
});
