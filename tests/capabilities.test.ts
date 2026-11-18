import { describe, expect, it } from 'vitest';
import { AGENT_POLICY, HUMAN_POLICY } from '../src/daemon/capabilities.js';
import { dispatch } from '../src/daemon/rpc.js';
import type { ReviewService } from '../src/daemon/service.js';

const service = {} as ReviewService;

describe('RPC capabilities', () => {
    it('denies publish/checks/admin to the agent bridge', async () => {
        for (const method of [
            'publish.approve',
            'publish.commit',
            'checks.run',
            'decisions.put',
            'comments.update',
            'comments.delete',
            'reactions.toggle',
            'attachments.upload',
            'reviews.remove',
            'projects.register',
            'projects.update',
            'projects.remove',
            'features.create',
            'features.update',
            'features.addReviews',
            'features.delete',
        ]) {
            await expect(dispatch(service, method, {}, AGENT_POLICY)).rejects.toMatchObject({ code: 'CAPABILITY' });
        }
    });

    it('keeps read/draft methods for the agent', () => {
        for (const method of ['rules.get', 'reviews.get', 'drafts.put', 'findings.put', 'publish.preview', 'features.context']) {
            expect(AGENT_POLICY.allows(method)).toBe(true);
        }
        for (const method of ['checks.run', 'publish.approve', 'publish.commit', 'features.create']) {
            expect(HUMAN_POLICY.allows(method)).toBe(true);
        }
    });

    it('forces feature-note author to agent on the bridge', async () => {
        let author: string | undefined;
        const fake = {
            addFeatureNote: (_id: string, input: { author?: string }) => {
                author = input.author;
                return { id: 'fn-1' };
            },
        } as unknown as ReviewService;
        await dispatch(fake, 'features.addNote', { feature: 'ft-1', title: 't', body: 'b', author: 'human' }, AGENT_POLICY);
        expect(author).toBe('agent');
    });

    it('strips server-only publication fields from notes.update on the bridge', async () => {
        let patch: Record<string, unknown> | undefined;
        const fake = {
            updateNote: (_review: string, _noteId: string, value: Record<string, unknown>) => {
                patch = value;
                return { id: 'n-1' };
            },
        } as unknown as ReviewService;
        await dispatch(
            fake,
            'notes.update',
            { review: 'r', noteId: 'n-1', patch: { text: 'ok', posted: 'x', discussionId: 'd', noteId: 'z', error: 'e' } },
            AGENT_POLICY,
        );
        expect(patch).toEqual({ text: 'ok' });
    });

    it('lets the agent change only its own feature notes', async () => {
        const fake = {
            getFeature: () => ({ notes: [{ id: 'fn-human', author: 'human' }, { id: 'fn-agent', author: 'agent' }] }),
            updateFeatureNote: () => ({ id: 'fn-agent' }),
            deleteFeatureNote: () => undefined,
        } as unknown as ReviewService;
        await expect(
            dispatch(fake, 'features.updateNote', { feature: 'ft-1', note: 'fn-human', body: 'x' }, AGENT_POLICY),
        ).rejects.toMatchObject({ code: 'CAPABILITY' });
        await expect(dispatch(fake, 'features.deleteNote', { feature: 'ft-1', note: 'fn-human' }, AGENT_POLICY)).rejects.toMatchObject({
            code: 'CAPABILITY',
        });
        await expect(
            dispatch(fake, 'features.updateNote', { feature: 'ft-1', note: 'fn-agent', body: 'x' }, AGENT_POLICY),
        ).resolves.toMatchObject({ note: { id: 'fn-agent' } });
    });
});
