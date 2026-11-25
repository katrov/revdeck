import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion } from '../src/core/update.js';
import { UpdateChecker } from '../src/daemon/update.js';

function response(latest: string): Response {
    return new Response(JSON.stringify({ latest }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

describe('version comparison', () => {
    it('parses stable and prerelease versions', () => {
        expect(parseVersion('v1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, prerelease: [] });
        expect(parseVersion('1.2.3-beta.1')).toMatchObject({ prerelease: ['beta', '1'] });
        expect(parseVersion('not-a-version')).toBeNull();
    });

    it('compares versions in semver order', () => {
        expect(compareVersions('0.13.0', '0.12.9')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
        expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
        expect(isNewerVersion('0.14.0', '0.13.0')).toBe(true);
        expect(isNewerVersion('0.13.0', '0.13.0')).toBe(false);
        expect(isNewerVersion('broken', '0.13.0')).toBe(false);
    });
});

describe('UpdateChecker', () => {
    it('finds a newer npm version and caches it', async () => {
        let calls = 0;
        const checker = new UpdateChecker({
            currentVersion: '0.13.0',
            now: () => new Date('2026-05-01T00:00:00Z'),
            fetchImpl: async () => {
                calls += 1;
                return response('0.14.0');
            },
        });
        const info = await checker.check();
        expect(info).toMatchObject({
            enabled: true,
            current: '0.13.0',
            latest: '0.14.0',
            updateAvailable: true,
            releaseUrl: 'https://github.com/katrov/revdeck/releases/tag/v0.14.0',
        });
        expect(await checker.check()).toBe(info);
        expect(calls).toBe(1);
        await checker.check(true);
        expect(calls).toBe(2);
    });

    it('refreshes the cache after the ttl and reports no update for the same version', async () => {
        let calls = 0;
        let now = new Date('2026-05-01T00:00:00Z');
        const checker = new UpdateChecker({
            currentVersion: '0.13.0',
            now: () => now,
            fetchImpl: async () => {
                calls += 1;
                return response('0.13.0');
            },
        });
        const first = await checker.check();
        expect(first.updateAvailable).toBe(false);
        expect(first.releaseUrl).toBeNull();
        now = new Date('2026-05-02T01:00:00Z');
        await checker.check();
        expect(calls).toBe(2);
    });

    it('keeps a stale result when the registry fails and retries after a short backoff', async () => {
        let calls = 0;
        let now = new Date('2026-05-01T00:00:00Z');
        let fail = false;
        const checker = new UpdateChecker({
            currentVersion: '0.13.0',
            now: () => now,
            fetchImpl: async () => {
                calls += 1;
                if (fail) throw new Error('offline');
                return response('0.14.0');
            },
        });
        await checker.check();
        fail = true;
        now = new Date('2026-05-01T00:06:00Z');
        const failed = await checker.check(true);
        expect(failed.updateAvailable).toBe(true);
        expect(failed.latest).toBe('0.14.0');
        expect(failed.error).toContain('offline');
        await checker.check();
        expect(calls).toBe(2);
        now = new Date('2026-05-01T00:12:00Z');
        await checker.check();
        expect(calls).toBe(3);
    });

    it('can be disabled without touching the network', async () => {
        let calls = 0;
        const checker = new UpdateChecker({
            currentVersion: '0.13.0',
            env: { REVDECK_UPDATE_CHECK: '0' },
            fetchImpl: async () => {
                calls += 1;
                return response('0.14.0');
            },
        });
        const info = await checker.check();
        expect(info).toMatchObject({ enabled: false, current: '0.13.0', latest: null, updateAvailable: false });
        expect(calls).toBe(0);
    });
});
