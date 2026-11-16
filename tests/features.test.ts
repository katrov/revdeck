import { describe, expect, it } from 'vitest';
import { setLocale } from '../src/core/locale.js';
import { Store } from '../src/daemon/store.js';
import { parseUnifiedDiff } from '../src/core/diff.js';
import type { ReviewInfo } from '../src/core/types.js';

setLocale('ru');

const PATCH = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;

function info(project: string, number: number): ReviewInfo {
    return {
        ref: { platform: 'gitlab', host: 'gitlab.com', project, number },
        title: `MR ${number}`,
        description: '',
        author: 'author',
        authorName: 'Author',
        state: 'opened',
        draft: false,
        sourceBranch: 'feature',
        targetBranch: 'main',
        webUrl: `https://gitlab.com/${project}/-/merge_requests/${number}`,
        commit: { base: 'a'.repeat(40), start: 'b'.repeat(40), head: 'c'.repeat(40) },
        updatedAt: '2026-01-01T00:00:00Z',
        stats: { files: 1, additions: 1, deletions: 0 },
    };
}

function seed(store: Store, project: string, number: number): string {
    const id = store.saveReview(info(project, number), `/work/${project}`, '2026-01-01T00:00:00Z');
    store.saveSnapshot(id, {
        diff: parseUnifiedDiff(PATCH),
        threads: [],
        reactions: [],
        user: null,
        config: {} as never,
        configPath: null,
        errors: [],
        syncedAt: '2026-01-01T00:00:00Z',
    });
    return id;
}

describe('feature store', () => {
    it('creates a feature with several reviews, roles and projects', () => {
        const store = new Store(':memory:');
        try {
            const api = seed(store, 'acme/api', 1);
            const web = seed(store, 'acme/web', 2);
            const ios = seed(store, 'acme/ios', 3);
            const id = store.createFeature({
                title: 'Checkout v2',
                brief: 'Goal: checkout',
                contract: 'openapi: 3.1.0',
                reviews: [
                    { review: api, role: 'api' },
                    { review: web, role: 'ui' },
                    { review: ios, role: 'mobile' },
                ],
            });
            const feature = store.getFeature(id)!;
            expect(feature).toMatchObject({
                title: 'Checkout v2',
                brief: 'Goal: checkout',
                contract: 'openapi: 3.1.0',
                reviews: 3,
                status: 'open',
            });
            expect(feature.projects.map((project) => project.key).sort()).toEqual([
                'gitlab:gitlab.com/acme/api',
                'gitlab:gitlab.com/acme/ios',
                'gitlab:gitlab.com/acme/web',
            ]);
            expect(feature.members.map((member) => member.role)).toEqual(['api', 'ui', 'mobile']);
            expect(store.featuresForReview(web).map((item) => item.id)).toEqual([id]);

            store.addFeatureReviews(id, [{ review: api, role: 'backend' }]);
            expect(store.getFeature(id)!.members.find((member) => member.review.id === api)?.role).toBe('backend');
            expect(store.getFeature(id)!.reviews).toBe(3);

            store.reorderFeature(id, [ios, api, web]);
            expect(store.getFeature(id)!.members.map((member) => member.review.id)).toEqual([ios, api, web]);
            expect(() => store.reorderFeature(id, [ios, ios, web])).toThrow(/порядок/);
            store.addFeatureReviews(id, [{ review: api, role: '' }]);
            expect(store.getFeature(id)!.members.find((member) => member.review.id === api)?.role).toBe('');

            store.removeFeatureReview(id, api);
            expect(store.getFeature(id)!.reviews).toBe(2);
            expect(store.getFeature(id)!.projects.map((project) => project.key)).not.toContain('gitlab:gitlab.com/acme/api');

            store.updateFeature(id, { status: 'archived' });
            expect(store.listFeatures()).toHaveLength(0);
            expect(store.listFeatures(undefined, true)).toHaveLength(1);
            expect(store.listFeatures('gitlab:gitlab.com/acme/web')).toHaveLength(0);
            store.updateFeature(id, { status: 'open' });
            expect(store.listFeatures('gitlab:gitlab.com/acme/web')).toHaveLength(1);

            const noteId = store.addFeatureNote(id, { kind: 'finding', level: 'major', title: 'Contract mismatch', body: 'Web sends no key.' });
            expect(store.getFeature(id)!.notes).toMatchObject([
                { id: noteId, kind: 'finding', level: 'major', title: 'Contract mismatch', author: 'human' },
            ]);
            store.updateFeatureNote(id, noteId, { body: 'Updated' });
            expect(store.getFeature(id)!.notes[0]!.body).toBe('Updated');
            store.deleteFeatureNote(id, noteId);
            expect(store.getFeature(id)!.notes).toEqual([]);
        } finally {
            store.close();
        }
    });

    it('deduplicates reviewers and rejects unknown reviews', () => {
        const store = new Store(':memory:');
        try {
            const id = store.createFeature({ title: 'One', reviews: [{ review: seed(store, 'acme/api', 1) }] });
            expect(() => store.addFeatureReviews(id, [{ review: 'gitlab:gitlab.com/acme/api!999' }])).toThrow(/не найдено/);
            expect(store.getFeature(id)!.reviews).toBe(1);
        } finally {
            store.close();
        }
    });
});
