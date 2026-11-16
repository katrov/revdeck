import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { projectKey, parseProjectKey, projectTitle } from '../src/core/projects.js';
import { ReviewService } from '../src/daemon/service.js';
import { Store } from '../src/daemon/store.js';
import { assertReviewInScope, featureReviewId, resolveScope, reviewRefFromInput } from '../src/mcp/scope.js';
import { projectColor, projectKeyFromReviewId, projectLabel, sortProjects } from '../ui/src/lib/projects.js';
import type { ReviewInfo } from '../src/core/types.js';
import type { ProjectSummary } from '../ui/src/lib/types.js';

const cleanup: string[] = [];

afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function info(project: string, number: number, host = 'gitlab.com'): ReviewInfo {
    return {
        ref: { platform: 'gitlab', host, project, number },
        title: `MR ${number}`,
        description: '',
        author: 'author',
        authorName: 'Author',
        state: 'opened',
        draft: false,
        sourceBranch: 'feature',
        targetBranch: 'main',
        webUrl: `https://${host}/${project}/-/merge_requests/${number}`,
        commit: { base: 'a'.repeat(40), start: 'b'.repeat(40), head: 'c'.repeat(40) },
        updatedAt: '2026-01-01T00:00:00Z',
        stats: { files: 0, additions: 0, deletions: 0 },
    };
}

function summary(key: string, title: string, lastActivity: string): ProjectSummary {
    return {
        key,
        platform: 'gitlab',
        host: 'gitlab.com',
        project: title,
        title,
        roots: [],
        reviews: 0,
        createdAt: lastActivity,
        updatedAt: lastActivity,
        lastActivity,
    };
}

describe('project identity', () => {
    it('normalizes host and project path for comparison', () => {
        const key = projectKey({ platform: 'gitlab', host: 'GitLab.Example.com', project: 'Group/Sub/Proj' });
        expect(key).toBe('gitlab:gitlab.example.com/group/sub/proj');
        expect(parseProjectKey(key)).toEqual({ platform: 'gitlab', host: 'gitlab.example.com', project: 'group/sub/proj' });
    });

    it('uses the last path segment as the default title', () => {
        expect(projectTitle('group/sub/proj')).toBe('proj');
        expect(projectTitle('proj')).toBe('proj');
    });

    it('reads a project from review ids and URLs but not from bare numbers', () => {
        expect(reviewRefFromInput('gitlab:GitLab.com/Group/Proj!7')).toMatchObject({ platform: 'gitlab', project: 'Group/Proj', number: 7 });
        expect(reviewRefFromInput('https://gitlab.com/group/proj/-/merge_requests/7')).toMatchObject({ project: 'group/proj', number: 7 });
        expect(reviewRefFromInput('group/proj!7')).toMatchObject({ platform: 'gitlab', project: 'group/proj' });
        expect(reviewRefFromInput('42')).toBeNull();
    });

    it('resolves the scope from a repository config', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-scope-'));
        cleanup.push(dir);
        await writeFile(
            path.join(dir, '.revdeck.yml'),
            'version: 1\nprovider:\n  type: gitlab\n  host: gitlab.com\n  project: group/proj\n',
        );
        const scope = await resolveScope(dir);
        expect(scope).toMatchObject({
            root: dir,
            key: 'gitlab:gitlab.com/group/proj',
            platform: 'gitlab',
            host: 'gitlab.com',
            project: 'group/proj',
            title: 'proj',
        });
    });

    it('matches feature members by normalized project and number', () => {
        const scope = {
            root: '/repo',
            platform: 'gitlab' as const,
            host: 'gitlab.com',
            project: 'group/proj',
            key: 'gitlab:gitlab.com/group/proj',
            title: 'proj',
            feature: { id: 'ft-test', title: 'Test', reviewIds: ['gitlab:gitlab.com/group/proj!7'] },
        };
        expect(
            featureReviewId({ platform: 'gitlab', host: 'GitLab.com', project: 'Group/Proj', number: 7 }, scope),
        ).toBe('gitlab:gitlab.com/group/proj!7');
        expect(featureReviewId({ platform: 'gitlab', host: 'gitlab.com', project: 'group/proj', number: 8 }, scope)).toBeNull();
    });

    it('rejects reviews from another project', () => {
        const scope = {
            root: '/repo',
            platform: 'gitlab' as const,
            host: 'gitlab.com',
            project: 'group/proj',
            key: 'gitlab:gitlab.com/group/proj',
            title: 'proj',
        };
        expect(() => assertReviewInScope('gitlab:gitlab.com/group/proj!7', scope)).not.toThrow();
        expect(() => assertReviewInScope('group/proj!7', scope)).not.toThrow();
        expect(() => assertReviewInScope('https://gitlab.com/group/other/-/merge_requests/7', scope)).toThrow(/scoped|ограничена/);
    });
});

describe('project store', () => {
    it('lists projects, filters reviews and keeps empty projects', () => {
        const store = new Store(':memory:');
        try {
            store.saveReview(info('group/one', 1), '/work/one', '2026-01-01T00:00:00Z');
            store.saveReview(info('group/two', 2), '/work/two', '2026-01-02T00:00:00Z');
            store.saveReview(info('group/two', 3), '/work/two', '2026-01-03T00:00:00Z');

            const projects = store.listProjects();
            expect(projects.map((project) => project.key)).toEqual(['gitlab:gitlab.com/group/two', 'gitlab:gitlab.com/group/one']);
            expect(projects[0]!.reviews).toBe(2);
            expect(projects[0]!.roots).toEqual(['/work/two']);

            const two = 'gitlab:gitlab.com/group/two';
            expect(store.listReviews(two).map((review) => review.number)).toEqual([3, 2]);
            expect(store.listReviews('gitlab:gitlab.com/group/one')).toHaveLength(1);
            expect(store.listReviews()).toHaveLength(3);

            store.removeReview(store.listReviews(two)[0]!.id);
            expect(store.getProject(two)?.reviews).toBe(1);

            const empty = projectKey({ platform: 'gitlab', host: 'gitlab.com', project: 'group/empty' });
            store.registerProject({ platform: 'gitlab', host: 'gitlab.com', project: 'group/empty' }, '/work/empty', '2026-01-04T00:00:00Z');
            expect(store.getProject(empty)).toMatchObject({ reviews: 0, roots: ['/work/empty'] });
        } finally {
            store.close();
        }
    });

    it('backfills an old database without project_key', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-projects-'));
        cleanup.push(dir);
        const file = path.join(dir, 'revdeck.sqlite3');
        const legacy = new DatabaseSync(file);
        legacy.exec(`
            CREATE TABLE reviews (
                id TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                host TEXT NOT NULL,
                project TEXT NOT NULL,
                number INTEGER NOT NULL,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                state TEXT NOT NULL,
                web_url TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                synced_at TEXT NOT NULL,
                root TEXT NOT NULL,
                info_json TEXT NOT NULL
            );
        `);
        legacy
            .prepare('INSERT INTO reviews VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(
                'gitlab:gitlab.com/group/proj!7',
                'gitlab',
                'gitlab.com',
                'group/proj',
                7,
                'MR 7',
                'author',
                'opened',
                'https://gitlab.com/group/proj/-/merge_requests/7',
                '2026-01-02T00:00:00Z',
                '2026-01-02T00:00:00Z',
                '/work/proj',
                JSON.stringify(info('group/proj', 7)),
            );
        legacy.close();

        const store = new Store(file);
        try {
            expect(store.listProjects()).toMatchObject([
                { key: 'gitlab:gitlab.com/group/proj', title: 'proj', reviews: 1, roots: ['/work/proj'] },
            ]);
            expect(store.listReviews('gitlab:gitlab.com/group/proj')[0]!.projectKey).toBe('gitlab:gitlab.com/group/proj');
        } finally {
            store.close();
        }

        // Повторное открытие не должно дублировать проекты и root'ы.
        const reopened = new Store(file);
        try {
            expect(reopened.listProjects()).toHaveLength(1);
            expect(reopened.listProjects()[0]!.roots).toEqual(['/work/proj']);
        } finally {
            reopened.close();
        }
    });
});

describe('project service', () => {
    it('registers a project from a repository root', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-project-service-'));
        cleanup.push(dir);
        await writeFile(
            path.join(dir, '.revdeck.yml'),
            'version: 1\nprovider:\n  type: gitlab\n  host: gitlab.com\n  project: group/proj\n',
        );
        const store = new Store(':memory:');
        const service = new ReviewService({ store, syncIntervalMs: 0 });
        try {
            const project = await service.registerProject(dir);
            expect(project).toMatchObject({ key: 'gitlab:gitlab.com/group/proj', title: 'proj', roots: [dir], reviews: 0 });
            expect(service.listReviews('gitlab:gitlab.com/group/proj')).toEqual([]);
            expect(service.listProjects()).toHaveLength(1);
        } finally {
            service.close();
        }
    });
});

describe('project UI helpers', () => {
    it('derives a project key from a review id', () => {
        expect(projectKeyFromReviewId('github:github.com/acme/web!204')).toBe('github:github.com/acme/web');
        expect(projectKeyFromReviewId('gitlab:GitLab.com/Acme/Web!204')).toBe('gitlab:gitlab.com/acme/web');
    });

    it('sorts pinned projects first and then by recent activity', () => {
        const projects = [
            summary('a', 'alpha', '2026-01-01T00:00:00Z'),
            summary('b', 'beta', '2026-01-03T00:00:00Z'),
            summary('c', 'gamma', '2026-01-02T00:00:00Z'),
        ];
        expect(sortProjects(projects, ['a']).map((project) => project.key)).toEqual(['a', 'b', 'c']);
        expect(sortProjects(projects, []).map((project) => project.key)).toEqual(['b', 'c', 'a']);
    });

    it('disambiguates projects with the same short name', () => {
        const one = { ...summary('a', 'api', '2026-01-01T00:00:00Z'), project: 'group/one' };
        const two = { ...summary('b', 'api', '2026-01-02T00:00:00Z'), project: 'group/two' };
        expect(projectLabel(one, [one, two])).toBe('group/one');
        const unique = [summary('c', 'web', '2026-01-01T00:00:00Z'), summary('d', 'ios', '2026-01-02T00:00:00Z')];
        expect(projectLabel(unique[0]!, unique)).toBe('web');
        expect(projectColor('a')).toBe(projectColor('a'));
    });
});
