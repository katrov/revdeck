import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../src/core/locale.js';
import { parseJsonc } from '../src/core/jsonc.js';
import {
    CONTAINER_RUNTIME_DIR,
    CONTAINER_STATE_DIR,
    devcontainerPatch,
    mergeDevcontainerConfig,
    runDevcontainer,
} from '../src/cli/devcontainer.js';
import { runEject } from '../src/cli/eject.js';
import { connectSocket, ensureDaemon, isDevContainer, uiBaseUrl } from '../src/client.js';
import { devcontainerInfoPath, devcontainerSocketPath } from '../src/core/paths.js';
import { startDevcontainerBridge } from '../src/daemon/bridge.js';
import { ReviewService } from '../src/daemon/service.js';
import { Store } from '../src/daemon/store.js';

let root: string;
const original = {
    runtime: process.env.REVDECK_RUNTIME_DIR,
    state: process.env.REVDECK_STATE_DIR,
    container: process.env.REVDECK_DEV_CONTAINER,
    uiHost: process.env.REVDECK_UI_HOST,
    url: process.env.REVDECK_URL,
    bridge: process.env.REVDECK_DEVCONTAINER_DIR,
};

beforeEach(async () => {
    setLocale('ru');
    root = await mkdtemp(path.join(tmpdir(), 'revdeck-devcontainer-'));
    await mkdir(path.join(root, '.git'), { recursive: true });
    process.env.REVDECK_RUNTIME_DIR = path.join(root, 'runtime', 'revdeck');
    process.env.REVDECK_STATE_DIR = path.join(root, 'state', 'revdeck');
    process.env.REVDECK_DEVCONTAINER_DIR = path.join(root, 'bridge', 'revdeck');
    delete process.env.REVDECK_DEV_CONTAINER;
    delete process.env.REVDECK_UI_HOST;
    delete process.env.REVDECK_URL;
});

afterEach(() => {
    if (original.runtime === undefined) delete process.env.REVDECK_RUNTIME_DIR;
    else process.env.REVDECK_RUNTIME_DIR = original.runtime;
    if (original.state === undefined) delete process.env.REVDECK_STATE_DIR;
    else process.env.REVDECK_STATE_DIR = original.state;
    if (original.container === undefined) delete process.env.REVDECK_DEV_CONTAINER;
    else process.env.REVDECK_DEV_CONTAINER = original.container;
    if (original.uiHost === undefined) delete process.env.REVDECK_UI_HOST;
    else process.env.REVDECK_UI_HOST = original.uiHost;
    if (original.url === undefined) delete process.env.REVDECK_URL;
    else process.env.REVDECK_URL = original.url;
    if (original.bridge === undefined) delete process.env.REVDECK_DEVCONTAINER_DIR;
    else process.env.REVDECK_DEVCONTAINER_DIR = original.bridge;
});

describe('devcontainer', () => {
    it('mounts the host socket and state into the container', () => {
        const patch = devcontainerPatch();
        expect(patch.mounts).toEqual([
            {
                type: 'bind',
                source: '${localEnv:HOME}${localEnv:USERPROFILE}/.local/state/revdeck/devcontainer/run',
                target: CONTAINER_RUNTIME_DIR,
            },
            {
                type: 'bind',
                source: '${localEnv:HOME}${localEnv:USERPROFILE}/.local/state/revdeck/devcontainer/state',
                target: CONTAINER_STATE_DIR,
                readonly: true,
            },
        ]);
        expect(patch.containerEnv).toMatchObject({
            REVDECK_RUNTIME_DIR: CONTAINER_RUNTIME_DIR,
            REVDECK_STATE_DIR: CONTAINER_STATE_DIR,
            REVDECK_DEV_CONTAINER: '1',
        });
    });

    it('merges into an existing config without dropping foreign keys or mounts', () => {
        const merged = mergeDevcontainerConfig(
            {
                image: 'custom',
                mounts: [
                    { type: 'bind', source: '/old', target: CONTAINER_RUNTIME_DIR },
                    { type: 'bind', source: '/keep', target: '/keep' },
                ],
                containerEnv: { KEEP: '1', REVDECK_DEV_CONTAINER: '0' },
                runArgs: ['--init'],
            },
            devcontainerPatch(),
        );
        expect(merged.image).toBe('custom');
        expect(merged.mounts).toHaveLength(3);
        expect(merged.mounts).toContainEqual({ type: 'bind', source: '/keep', target: '/keep' });
        expect(merged.mounts).toContainEqual({
            type: 'bind',
            source: '${localEnv:HOME}${localEnv:USERPROFILE}/.local/state/revdeck/devcontainer/run',
            target: CONTAINER_RUNTIME_DIR,
        });
        expect(merged.containerEnv).toMatchObject({ KEEP: '1', REVDECK_DEV_CONTAINER: '1' });
        expect(merged.runArgs).toContain('--init');
        expect(merged.runArgs).toContain('--add-host=host.docker.internal:host-gateway');
    });

    it('writes a devcontainer.json and removes only its own parts on eject', async () => {
        await mkdir(path.join(root, '.devcontainer'), { recursive: true });
        await writeFile(
            path.join(root, '.devcontainer', 'devcontainer.json'),
            `{
  // user setting
  "image": "custom",
  "containerEnv": { "KEEP": "1" },
}
`,
        );

        await runDevcontainer(root, { write: true });
        const file = path.join(root, '.devcontainer', 'devcontainer.json');
        expect(existsSync(file)).toBe(true);
        const text = await readFile(file, 'utf8');
        expect(text).toContain('// user setting');
        expect(text).not.toContain(root);
        if (process.env.HOME) expect(text).not.toContain(process.env.HOME);
        let data = parseJsonc(text) as { image: string; containerEnv: Record<string, string>; mounts: unknown[] };
        expect(data.image).toBe('custom');
        expect(data.containerEnv).toMatchObject({ KEEP: '1', REVDECK_DEV_CONTAINER: '1' });
        expect(data.mounts).toHaveLength(2);

        await runEject(root, { yes: true });
        const after = await readFile(file, 'utf8');
        expect(after).toContain('// user setting');
        data = parseJsonc(after) as typeof data;
        expect(data.image).toBe('custom');
        expect(data.containerEnv).toEqual({ KEEP: '1' });
        expect(data.mounts).toEqual([]);
    });

    it('starts a second RPC socket in the stable bridge directory', async () => {
        const service = new ReviewService({ store: new Store(':memory:'), syncIntervalMs: 0 });
        const bridge = await startDevcontainerBridge(service, {
            pid: process.pid,
            port: 0,
            token: 'test-token',
            url: 'http://127.0.0.1:0',
            startedAt: new Date().toISOString(),
            version: 'test',
            protocol: 1,
        });
        expect(existsSync(devcontainerSocketPath())).toBe(true);
        expect(existsSync(devcontainerInfoPath())).toBe(true);
        const client = await connectSocket(devcontainerSocketPath());
        await expect(client.request('reviews.list')).resolves.toEqual({ reviews: [] });
        client.close();
        await bridge.close();
        service.close();
        expect(existsSync(devcontainerInfoPath())).toBe(false);
    });

    it('refuses to start a local daemon inside a devcontainer', async () => {
        process.env.REVDECK_DEV_CONTAINER = '1';
        expect(isDevContainer()).toBe(true);
        await expect(ensureDaemon()).rejects.toMatchObject({ code: 'DEVCONTAINER' });
    });

    it('uses the host UI address in a devcontainer', () => {
        process.env.REVDECK_DEV_CONTAINER = '1';
        process.env.REVDECK_UI_HOST = 'host.docker.internal';
        expect(uiBaseUrl({ url: 'http://127.0.0.1:7777', port: 7777 })).toBe('http://host.docker.internal:7777');
    });
});
