#!/usr/bin/env node
import { build } from 'esbuild';
import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entries = [
    ['cli', 'src/cli/main.ts'],
    ['daemon', 'src/daemon/main.ts'],
    ['mcp', 'src/mcp/main.ts'],
];

await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });

for (const [name, entry] of entries) {
    const result = await build({
        entryPoints: [path.join(root, entry)],
        outfile: path.join(root, 'dist', `${name}.js`),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        packages: 'external',
        sourcemap: true,
        legalComments: 'none',
        logLevel: 'info',
        define: { 'process.env.REVDECK_BUILD': JSON.stringify('esbuild') },
    });
    if (result.errors.length) process.exit(1);
    await chmod(path.join(root, 'dist', `${name}.js`), 0o755);
}
console.log('dist: cli.js, daemon.js, mcp.js');
