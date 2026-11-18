import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

describe('version', () => {
    it('matches package.json', async () => {
        const pkg = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
        expect(VERSION).toBe(pkg.version);
    });
});
