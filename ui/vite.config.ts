import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root,
    base: '/',
    plugins: [svelte()],
    build: {
        outDir: path.resolve(root, '..', 'dist', 'ui'),
        emptyOutDir: true,
        target: 'es2022',
        assetsDir: 'assets',
    },
    server: {
        port: 5173,
        strictPort: true,
    },
});
