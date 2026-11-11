import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { GitLabProvider } from '../src/providers/gitlab.js';
import { GitHubProvider } from '../src/providers/github.js';
import type { Runner } from '../src/core/exec.js';
import type { ReviewRef } from '../src/core/types.js';

const gitlabRef: ReviewRef = { platform: 'gitlab', host: 'gitlab.example.com', project: 'group/sub/proj', number: 7 };
const githubRef: ReviewRef = { platform: 'github', host: 'github.com', project: 'acme/repo', number: 7 };

interface Call {
    args: string[];
    payload: unknown;
}

function runner(handler: (call: Call) => unknown): { runner: Runner; calls: Call[] } {
    const calls: Call[] = [];
    const impl: Runner = async (_command, args) => {
        const inputIndex = args.indexOf('--input');
        const payload = inputIndex >= 0 ? (JSON.parse(await readFile(args[inputIndex + 1]!, 'utf8')) as unknown) : null;
        const call = { args, payload };
        calls.push(call);
        return { stdout: JSON.stringify(handler(call)), stderr: '', code: 0 };
    };
    return { runner: impl, calls };
}

const GL_MR = {
    iid: 7,
    title: 'Add b',
    description: 'desc',
    author: { username: 'author', name: 'Author' },
    state: 'opened',
    draft: false,
    source_branch: 'feature',
    target_branch: 'main',
    web_url: 'https://gitlab.example.com/group/sub/proj/-/merge_requests/7',
    updated_at: '2026-01-01T00:00:00Z',
    changes_count: '2',
    diff_refs: { base_sha: 'a'.repeat(40), start_sha: 'b'.repeat(40), head_sha: 'c'.repeat(40) },
};

const GL_DIFFS = [
    {
        old_path: 'src/app.ts',
        new_path: 'src/app.ts',
        new_file: false,
        deleted_file: false,
        renamed_file: false,
        diff: '@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n',
    },
    {
        old_path: 'src/new.ts',
        new_path: 'src/new.ts',
        new_file: true,
        deleted_file: false,
        renamed_file: false,
        diff: '@@ -0,0 +1,1 @@\n+export const x = 1;\n',
    },
];

const GL_THREADS = [
    {
        id: 'd1',
        notes: [
            {
                id: 11,
                body: 'Почему?',
                system: false,
                resolvable: true,
                resolved: false,
                created_at: '2026-01-01T00:00:00Z',
                author: { username: 'reviewer', name: 'Reviewer' },
                position: { new_path: 'src/app.ts', new_line: 2, old_line: null, position_type: 'text' },
            },
        ],
    },
    { id: 'system', notes: [{ id: 12, body: 'added 1 commit', system: true, created_at: '2026-01-01T00:00:00Z' }] },
];

describe('GitLabProvider', () => {
    it('maps MR, diff and threads', async () => {
        const { runner: impl } = runner((call) => {
            const endpoint = call.args.find((arg) => arg.startsWith('projects/') || arg === 'user') ?? '';
            if (endpoint.endsWith('/diffs?per_page=100&page=1')) return GL_DIFFS;
            if (endpoint.includes('/discussions')) return GL_THREADS;
            if (endpoint.includes('/notes/')) return [];
            if (endpoint === 'user') return { id: 1, username: 'me', name: 'Me' };
            if (endpoint.includes('/merge_requests/7')) return GL_MR;
            return [];
        });
        const provider = new GitLabProvider(gitlabRef, { root: '/tmp', runImpl: impl });
        const info = await provider.info();
        expect(info.title).toBe('Add b');
        expect(info.commit.head).toBe('c'.repeat(40));
        const diff = await provider.diff();
        expect(diff.map((file) => file.path)).toEqual(['src/app.ts', 'src/new.ts']);
        expect(diff[0]!.hunks[0]!.lines.map((line) => line.kind)).toEqual([' ', '-', '+']);
        const threads = await provider.threads();
        expect(threads).toHaveLength(1);
        expect(threads[0]).toMatchObject({ id: 'd1', path: 'src/app.ts', line: 2, side: 'new' });
        expect(await provider.currentUser()).toEqual({ username: 'me', name: 'Me' });
    });

    it('replies with a JSON body and resolves with put', async () => {
        const { runner: impl, calls } = runner((call) => {
            if (call.args.includes('--method') && call.args.includes('POST')) return { id: 99, body: 'hi', created_at: 'now', author: { username: 'me' } };
            return {};
        });
        const provider = new GitLabProvider(gitlabRef, { root: '/tmp', runImpl: impl });
        const note = await provider.reply({ id: 'd1' } as never, 'hi');
        expect(note.id).toBe('99');
        const replyCall = calls.find((call) => call.payload && typeof call.payload === 'object' && 'body' in (call.payload as object))!;
        expect((replyCall.payload as { body: string }).body).toBe('hi');

        await provider.resolve('d1', true);
        const resolveCall = calls.find((call) => call.args.includes('PUT'))!;
        expect(resolveCall.payload).toEqual({ resolved: true });
    });

    it('creates a positioned discussion and a general one without line', async () => {
        const { runner: impl, calls } = runner((call) => {
            if (call.args.includes('projects/group%2Fsub%2Fproj/merge_requests/7')) return GL_MR;
            return { id: 'd-new', notes: [{ id: 5 }] };
        });
        const provider = new GitLabProvider(gitlabRef, { root: '/tmp', runImpl: impl });
        await provider.createThread({ file: 'src/app.ts', line: 2, oldLine: null, body: 'note' });
        const post = calls.find((call) => call.payload && typeof call.payload === 'object' && 'position' in (call.payload as object))!;
        expect(post.payload).toMatchObject({
            body: 'note',
            position: {
                position_type: 'text',
                base_sha: 'a'.repeat(40),
                start_sha: 'b'.repeat(40),
                head_sha: 'c'.repeat(40),
                new_path: 'src/app.ts',
                new_line: 2,
            },
        });
        calls.length = 0;
        await provider.createThread({ file: 'src/app.ts', line: null, oldLine: null, body: 'general' });
        expect(calls.some((call) => call.payload && typeof call.payload === 'object' && 'position' in (call.payload as object))).toBe(false);
    });
});

const GH_PR = {
    number: 7,
    title: 'Add b',
    body: 'desc',
    user: { login: 'author' },
    state: 'open',
    draft: false,
    merged_at: null,
    html_url: 'https://github.com/acme/repo/pull/7',
    updated_at: '2026-01-01T00:00:00Z',
    changed_files: 1,
    additions: 1,
    deletions: 1,
    head: { ref: 'feature', sha: 'c'.repeat(40) },
    base: { ref: 'main', sha: 'a'.repeat(40) },
};

const GH_FILES = [
    {
        filename: 'src/app.ts',
        previous_filename: 'src/app.ts',
        status: 'modified',
        patch: '@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n',
    },
];

const GH_THREADS = {
    data: {
        repository: {
            pullRequest: {
                reviewThreads: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [
                        {
                            id: 'PRRT_1',
                            isResolved: false,
                            isOutdated: false,
                            path: 'src/app.ts',
                            line: 2,
                            originalLine: 2,
                            diffSide: 'RIGHT',
                            comments: {
                                nodes: [
                                    { databaseId: 501, id: 'PRRC_1', author: { login: 'reviewer' }, body: 'Почему?', createdAt: '2026-01-01T00:00:00Z' },
                                ],
                            },
                        },
                    ],
                },
            },
        },
    },
};

describe('GitHubProvider', () => {
    it('maps PR, files and review threads', async () => {
        const { runner: impl } = runner((call) => {
            if (call.args.includes('graphql')) return GH_THREADS;
            const endpoint = call.args.find((arg) => arg.startsWith('repos/') || arg === 'user') ?? '';
            if (endpoint.includes('/files')) return GH_FILES;
            if (endpoint === 'user') return { login: 'me', name: 'Me' };
            if (endpoint.includes('/pulls/7')) return GH_PR;
            return [];
        });
        const provider = new GitHubProvider(githubRef, { root: '/tmp', runImpl: impl });
        const info = await provider.info();
        expect(info.title).toBe('Add b');
        expect(info.sourceBranch).toBe('feature');
        const diff = await provider.diff();
        expect(diff[0]!.path).toBe('src/app.ts');
        const threads = await provider.threads();
        expect(threads[0]).toMatchObject({ id: 'PRRT_1', path: 'src/app.ts', line: 2, resolved: false });
        expect(threads[0]!.notes[0]).toMatchObject({ id: '501', author: 'reviewer' });
    });

    it('replies to the root review comment and resolves via graphql', async () => {
        const { runner: impl, calls } = runner((call) => {
            if (call.args.includes('graphql')) return { data: { resolveReviewThread: { thread: { isResolved: true } } } };
            return { id: 502, body: 'hi', user: { login: 'me' }, created_at: 'now' };
        });
        const provider = new GitHubProvider(githubRef, { root: '/tmp', runImpl: impl });
        const thread = {
            id: 'PRRT_1',
            path: 'src/app.ts',
            line: 2,
            side: 'new' as const,
            resolvable: true,
            resolved: false,
            updatedAt: '',
            notes: [{ id: '501', author: 'reviewer', authorName: '', createdAt: '', body: 'q', system: false }],
        };
        const note = await provider.reply(thread, 'hi');
        expect(note.id).toBe('502');
        const replyCall = calls.find((call) => call.payload && typeof call.payload === 'object' && 'body' in (call.payload as object))!;
        expect(replyCall.args.some((arg) => arg.includes('/comments/501/replies'))).toBe(true);

        await provider.resolve('PRRT_1', true);
        const mutation = calls.find((call) => call.args.includes('graphql') && call.args.some((arg) => arg.includes('resolveReviewThread')))!;
        expect(mutation).toBeTruthy();
    });

    it('creates a line comment with commit and side', async () => {
        const { runner: impl, calls } = runner((call) => {
            if (call.args.includes('repos/acme/repo/pulls/7')) return GH_PR;
            return { id: 600, body: 'note', user: { login: 'me' }, created_at: 'now' };
        });
        const provider = new GitHubProvider(githubRef, { root: '/tmp', runImpl: impl });
        await provider.createThread({ file: 'src/app.ts', line: 2, oldLine: null, body: 'note' });
        const post = calls.find((call) => call.payload && typeof call.payload === 'object' && 'commit_id' in (call.payload as object))!;
        expect(post.payload).toMatchObject({ commit_id: 'c'.repeat(40), path: 'src/app.ts', line: 2, side: 'RIGHT' });
    });
});
