import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startHttpServer, type HttpHandle } from '../src/daemon/http.js';
import type { ReviewService } from '../src/daemon/service.js';

let dir = '';
let handle: HttpHandle | null = null;

afterEach(async () => {
    await handle?.close();
    handle = null;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
});

async function start(host?: string) {
    dir = await mkdtemp(path.join(tmpdir(), 'revdeck-http-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>app</title>');
    handle = await startHttpServer({
        service: {} as unknown as ReviewService,
        token: 'human-token',
        uiDir: dir,
        version: '9.9.9',
        ...(host ? { host } : {}),
    });
    return handle;
}

describe('launch page', () => {
    it('explains a missing launch link and keeps the command copyable', async () => {
        const server = await start();
        const response = await fetch(`${server.url}/`, { headers: { 'accept-language': 'en' } });
        const body = await response.text();
        expect(response.status).toBe(401);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(response.headers.get('content-security-policy')).toContain("script-src 'nonce-");
        expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
        expect(body).toContain('A launch link is required');
        expect(body).toContain('revdeck daemon start &amp;&amp; revdeck ui --open');
        expect(body).toContain('revdeck 9.9.9');
        expect(body).not.toContain('human-token');
    });

    it('uses the bound host in the URL and accepts it in the Host header', async () => {
        const server = await start('127.0.0.2');
        expect(server.url).toContain('127.0.0.2');
        const response = await fetch(`${server.url}/`, { headers: { 'accept-language': 'en' } });
        expect(response.status).toBe(401);
    });

    it('distinguishes a stale cookie from the first visit', async () => {
        const server = await start();
        const response = await fetch(`${server.url}/`, {
            headers: { 'accept-language': 'en', cookie: 'revdeck_session=stale' },
        });
        const body = await response.text();
        expect(response.status).toBe(401);
        expect(body).toContain('The daemon session expired');
    });

    it('redirects a valid launch link to a cookie session and serves the UI', async () => {
        const server = await start();
        const redirect = await fetch(`${server.url}/?t=human-token&review=x`, { redirect: 'manual' });
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('location')).toBe('/?review=x');
        expect(redirect.headers.get('set-cookie')).toContain('revdeck_session=human-token');
        expect(redirect.headers.get('set-cookie')).toContain('HttpOnly');
        const page = await fetch(`${server.url}/`, { headers: { cookie: 'revdeck_session=human-token' } });
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('<title>app</title>');
    });
});
