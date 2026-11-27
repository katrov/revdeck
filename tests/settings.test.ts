import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUMAN_POLICY } from '../src/daemon/capabilities.js';
import { dispatch } from '../src/daemon/rpc.js';
import { ReviewService } from '../src/daemon/service.js';
import { Store } from '../src/daemon/store.js';

function open(file = ':memory:'): { service: ReviewService; store: Store } {
    const store = new Store(file);
    return { service: new ReviewService({ store }), store };
}

describe('UI settings', () => {
    it('survives a daemon restart, unlike localStorage', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-settings-'));
        const file = path.join(dir, 'revdeck.sqlite3');
        const first = open(file);
        await dispatch(first.service, 'settings.put', { patch: { theme: 'dark', featuresHidden: true } }, HUMAN_POLICY);
        first.store.close();

        const second = open(file);
        const result = (await dispatch(second.service, 'settings.get', {}, HUMAN_POLICY)) as { settings: Record<string, unknown> };
        expect(result.settings).toEqual({ theme: 'dark', featuresHidden: true });
        second.store.close();
    });

    it('merges one key at a time instead of replacing the rest', async () => {
        const { service } = open();
        await dispatch(service, 'settings.put', { patch: { theme: 'dark' } }, HUMAN_POLICY);
        await dispatch(service, 'settings.put', { patch: { locale: 'en' } }, HUMAN_POLICY);
        expect(service.uiSettings()).toEqual({ theme: 'dark', locale: 'en' });
    });

    it('refuses an invalid key, a non-object patch and an oversized value', () => {
        const { service } = open();
        expect(() => service.updateUiSettings({ 'bad key': 1 })).toThrow();
        expect(() => service.updateUiSettings(['theme'])).toThrow();
        expect(() => service.updateUiSettings(null)).toThrow();
        expect(() => service.updateUiSettings({ theme: 'x'.repeat(5000) })).toThrow();
        expect(service.uiSettings()).toEqual({});
    });
});
