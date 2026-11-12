import { setLocale } from '../src/core/locale.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewService } from '../src/daemon/service.js';
import { Store } from '../src/daemon/store.js';
import { parseUnifiedDiff } from '../src/core/diff.js';
import type { CreateThreadInput, Provider, ReviewListItem, UploadInput } from '../src/providers/provider.js';
import type { DiffFile, Note, ReviewInfo, ReviewRef, Thread } from '../src/core/types.js';

const PATCH = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;
diff --git a/src/util.ts b/src/util.ts
new file mode 100644
--- /dev/null
+++ b/src/util.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

class FakeProvider implements Provider {
    readonly platform = 'gitlab' as const;
    readonly capabilities = { reactions: true, resolve: true, nativeDrafts: true, attachments: true };
    readonly replies: { threadId: string; body: string }[] = [];
    readonly resolutions: { threadId: string; resolved: boolean }[] = [];
    readonly created: CreateThreadInput[] = [];
    readonly diffValue: DiffFile[] = parseUnifiedDiff(PATCH);
    readonly threadsValue: Thread[] = [
        {
            id: 'd1',
            path: 'src/app.ts',
            line: 2,
            side: 'new',
            resolvable: true,
            resolved: false,
            updatedAt: '2026-01-01T00:00:00Z',
            notes: [
                {
                    id: 'n1',
                    author: 'reviewer',
                    authorName: 'Reviewer',
                    createdAt: '2026-01-01T00:00:00Z',
                    body: 'Зачем здесь b?',
                    system: false,
                },
            ],
        },
    ];

    constructor(readonly ref: ReviewRef) {}

    async info(): Promise<ReviewInfo> {
        return {
            ref: this.ref,
            title: 'Add b',
            description: 'Description',
            author: 'author',
            authorName: 'Author',
            state: 'opened',
            draft: false,
            sourceBranch: 'feature',
            targetBranch: 'main',
            webUrl: 'https://gitlab.com/group/proj/-/merge_requests/7',
            commit: { base: 'a'.repeat(40), start: 'a'.repeat(40), head: 'b'.repeat(40) },
            updatedAt: '2026-01-01T00:00:00Z',
            stats: { files: 2, additions: 3, deletions: 0 },
        };
    }

    async diff(): Promise<DiffFile[]> {
        return this.diffValue;
    }

    async threads(): Promise<Thread[]> {
        return this.threadsValue;
    }

    async currentUser() {
        return { username: 'me', name: 'Me' };
    }

    async list(): Promise<ReviewListItem[]> {
        return [];
    }

    async findByBranch(): Promise<ReviewRef | null> {
        return null;
    }

    async reply(thread: Thread, body: string): Promise<Note> {
        this.replies.push({ threadId: thread.id, body });
        return { id: 'n2', author: 'me', authorName: '', createdAt: '2026-01-01T00:00:00Z', body, system: false };
    }

    async resolve(threadId: string, resolved: boolean): Promise<void> {
        this.resolutions.push({ threadId, resolved });
    }

    readonly reactionsValue: { noteId: string; name: string; mine: boolean }[] = [];

    async reactions(noteId: string) {
        return this.reactionsValue
            .filter((item) => item.noteId === noteId)
            .map((item) => ({ name: item.name, count: 1, users: ['me'], mine: item.mine }));
    }

    async react(noteId: string, emoji: string) {
        const index = this.reactionsValue.findIndex((item) => item.noteId === noteId && item.name === emoji);
        if (index >= 0) {
            this.reactionsValue.splice(index, 1);
            return { active: false };
        }
        this.reactionsValue.push({ noteId, name: emoji, mine: true });
        return { active: true };
    }

    readonly uploads: UploadInput[] = [];

    async upload(input: UploadInput) {
        this.uploads.push(input);
        const url = `https://gitlab.example.com/uploads/abc/${input.name}`;
        return { name: input.name, url, markdown: `![${input.name}](${url})` };
    }

    async createThread(input: CreateThreadInput) {
        this.created.push(input);
        return { discussionId: `d-${this.created.length}`, noteId: `n-${this.created.length}` };
    }
}

let root: string;
let service: ReviewService;
let provider: FakeProvider;

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'revdeck-test-'));
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'AGENTS.md'), '# Agents\n\nОбщие правила.\n');
    await writeFile(path.join(root, 'docs', 'Styleguide.md'), '# Style\n\n## Нейминг\n\nПравило нейминга.\n\n## Другое\n\nНет.\n');
    await writeFile(
        path.join(root, '.revdeck.yml'),
        `version: 1
provider: { type: gitlab }
rules:
  sources: [AGENTS.md]
  map:
    - match: "src/**"
      docs: [docs/Styleguide.md#Нейминг]
`,
    );
    const store = new Store(':memory:');
    service = new ReviewService({
        store,
        providerFactory: async (ref) => {
            if (!provider || provider.ref.number !== ref.number || provider.ref.project !== ref.project) provider = new FakeProvider(ref);
            return provider;
        },
        syncIntervalMs: 0,
    });
});

afterEach(() => {
    service.close();
});

async function open() {
    return service.openReview(root, { input: 'https://gitlab.com/group/proj/-/merge_requests/7' });
}

setLocale('ru');

describe('ReviewService', () => {
    it('opens a review and builds a view with snippets', async () => {
        const review = await open();
        expect(review.id).toBe('gitlab:gitlab.com/group/proj!7');
        expect(review.info.title).toBe('Add b');
        expect(review.diff).toHaveLength(2);
        expect(review.threads).toHaveLength(1);
        expect(review.errors).toEqual([]);
        const view = service.getView(review.id);
        expect(view.files).toHaveLength(2);
        expect(view.stats).toEqual({ files: 2, additions: 3, deletions: 0 });
        expect(view.threads[0]!.snippet?.some((line) => line.target)).toBe(true);
    });

    it('stores summary and validates findings against the diff', async () => {
        const review = await open();
        service.setSummary(review.id, { title: 'Add b', scope: 'main...feature', summary: 'Добавляет b.', changes: ['b'], focus: ['зачем b'] });
        expect(service.getReview(review.id).summary?.summary).toBe('Добавляет b.');

        expect(() => service.setFindings(review.id, [{ file: 'src/app.ts', line: 99, title: 'x', body: 'y' }])).toThrow(/не входит в diff/);
        const saved = service.setFindings(review.id, [
            { level: 'major', file: 'src/app.ts', line: 2, title: 'b не используется', body: 'b нигде не читается', comment: 'b не используется' },
        ]);
        expect(saved).toHaveLength(1);
        expect(saved[0]!.status).toBe('draft');
        expect(saved[0]!.id).toMatch(/^f-/);
    });

    it('keeps findings stable across revisions and marks stale ones', async () => {
        const review = await open();
        const first = service.setFindings(review.id, [
            { level: 'major', file: 'src/app.ts', line: 2, title: 'b не используется', body: 'old', comment: 'old' },
        ]);
        const second = service.setFindings(review.id, [
            { level: 'major', file: 'src/app.ts', line: 2, title: 'b не используется', body: 'new', comment: 'new' },
        ]);
        expect(second[0]!.id).toBe(first[0]!.id);
        expect(second[0]!.comment).toBe('new');

        // Замечание исчезло из нового набора: сервис помечает его stale, а не удаляет.
        expect(service.setFindings(review.id, [])[0]!.status).toBe('stale');
    });

    it('requires an approval bound to the exact plan and publishes idempotently', async () => {
        const review = await open();
        service.setDraft(review.id, 'd1', { body: 'b нужен для отладки' });
        const preview = service.previewPublish(review.id, 'reply', ['d1']);
        expect(preview.plan.items).toHaveLength(1);

        expect(() => service.approve(review.id, 'reply', ['d1'], 'bad-hash')).toThrow(/изменился/);
        const approval = service.approve(review.id, 'reply', ['d1'], preview.plan.hash);
        const result = await service.publish(review.id, approval.id);
        expect(result.results[0]!.ok).toBe(true);
        expect(provider.replies).toEqual([{ threadId: 'd1', body: 'b нужен для отладки' }]);

        // Повторное использование подтверждения запрещено.
        await expect(service.publish(review.id, approval.id)).rejects.toThrow(/использовано/);
        // Повторный preview видит, что текст уже опубликован.
        const again = service.previewPublish(review.id, 'reply', ['d1']);
        expect(again.plan.items).toHaveLength(0);
        expect(again.warnings[0]).toMatch(/уже опубликован/);
    });

    it('publishes a finding as a line comment and posts a general comment without line', async () => {
        const review = await open();
        service.setFindings(review.id, [
            { level: 'minor', file: 'src/app.ts', line: 2, title: 'a', body: 'a', comment: 'комментарий к строке' },
            { level: 'question', file: 'src/util.ts', line: null, title: 'b', body: 'b', comment: 'общий комментарий' },
        ]);
        const ids = service.getReview(review.id).findings.map((finding) => finding.id);
        const plan = service.previewPublish(review.id, 'finding', ids);
        expect(plan.plan.items).toHaveLength(2);
        expect(plan.plan.items[1]!.body).toContain('общий комментарий');
        expect(plan.plan.items[1]!.body).toContain('src/util.ts');
        const approval = service.approve(review.id, 'finding', ids, plan.plan.hash);
        const result = await service.publish(review.id, approval.id);
        expect(result.results.every((item) => item.ok)).toBe(true);
        expect(provider.created[0]).toMatchObject({ file: 'src/app.ts', line: 2, oldLine: null });
        expect(provider.created[1]).toMatchObject({ file: 'src/util.ts', line: null });
        expect(service.getReview(review.id).findings.every((finding) => finding.status === 'published')).toBe(true);
    });

    it('resolves threads only when the draft asks for a change', async () => {
        const review = await open();
        service.setDraft(review.id, 'd1', { body: 'ok', resolve: true });
        const preview = service.previewPublish(review.id, 'reply', ['d1']);
        const approval = service.approve(review.id, 'reply', ['d1'], preview.plan.hash);
        await service.publish(review.id, approval.id);
        expect(provider.resolutions).toEqual([{ threadId: 'd1', resolved: true }]);
    });

    it('toggles reactions on a platform note and returns the fresh list', async () => {
        const review = await open();
        const added = await service.react(review.id, 'n1', 'thumbsup');
        expect(added.active).toBe(true);
        expect(added.reactions).toEqual([{ name: 'thumbsup', count: 1, users: ['me'], mine: true }]);
        expect(await service.reactions(review.id, ['n1', 'missing'])).toEqual({
            n1: [{ name: 'thumbsup', count: 1, users: ['me'], mine: true }],
        });
        const removed = await service.react(review.id, 'n1', 'thumbsup');
        expect(removed.active).toBe(false);
        expect(removed.reactions).toEqual([]);
        await expect(service.react(review.id, 'n1', 'nope')).rejects.toThrow(/неизвестная реакция/);
    });

    it('uploads a validated attachment and returns an absolute link', async () => {
        const review = await open();
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
        const attachment = await service.uploadAttachment(review.id, {
            name: 'shot.png',
            contentType: 'image/png',
            data: png.toString('base64'),
        });
        expect(attachment.url).toBe('https://gitlab.example.com/uploads/abc/shot.png');
        expect(attachment.markdown).toBe('![shot.png](https://gitlab.example.com/uploads/abc/shot.png)');
        expect(provider.uploads[0]).toMatchObject({ name: 'shot.png', contentType: 'image/png' });

        await expect(
            service.uploadAttachment(review.id, { name: 'evil.svg', contentType: 'image/svg+xml', data: png.toString('base64') }),
        ).rejects.toThrow(/разрешены/);
        await expect(
            service.uploadAttachment(review.id, { name: 'fake.png', contentType: 'image/png', data: Buffer.from('not a png').toString('base64') }),
        ).rejects.toThrow(/не совпадает/);
    });

    it('builds effective rules for changed paths', async () => {
        const review = await open();
        const rules = await service.rules(review.id);
        expect(rules.configPath).toBe('.revdeck.yml');
        expect(rules.markdown).toContain('Правило нейминга');
        expect(rules.markdown).not.toContain('Нет.');
        expect(rules.checks).toEqual([]);
        expect(rules.language).toBe('en');
    });

    it('reports multiple reviews', async () => {
        await open();
        const items = service.listReviews();
        expect(items).toHaveLength(1);
        expect(items[0]!.project).toBe('group/proj');
    });
});
