import { describe, expect, it } from 'vitest';
import { contextPayload, renderContext, type RulesPayload } from '../src/context.js';
import type { ReviewView } from '../src/daemon/view.js';

const review = {
    id: 'gitlab:gitlab.example.com/group/proj!7',
    info: {
        ref: { platform: 'gitlab', host: 'gitlab.example.com', project: 'group/proj', number: 7 },
        title: 'Test review',
        description: '',
        author: 'author',
        authorName: 'Author',
        state: 'opened',
        draft: false,
        sourceBranch: 'feature',
        targetBranch: 'main',
        webUrl: 'https://gitlab.example.com/group/proj/-/merge_requests/7',
        commit: { base: '', start: '', head: '' },
        updatedAt: '',
        stats: { files: 2, additions: 1, deletions: 0 },
    },
    files: [
        { path: 'src/a.ts', oldPath: 'src/a.ts', status: 'modified', binary: false, additions: 1, deletions: 0 },
        { path: 'src/b.ts', oldPath: 'src/b.ts', status: 'modified', binary: false, additions: 0, deletions: 0 },
    ],
    threads: [],
    findings: [],
    drafts: [],
    notes: [],
    summary: null,
    decisions: {},
    user: null,
    syncedAt: '',
    errors: [],
    stats: { files: 2, additions: 1, deletions: 0 },
    stale: false,
} as unknown as ReviewView;

const rules: RulesPayload = {
    markdown: '## Project rules\n\nRule text.',
    configPath: null,
    warnings: [],
    checks: [],
    language: 'en',
    agents: 2,
    roles: [
        { id: 'correctness', title: 'Correctness', description: 'logic', criteria: ['6', '10'], instructions: '' },
        { id: 'architecture', title: 'Architecture', description: 'layers', criteria: ['3', '4'], instructions: '' },
    ],
};

describe('multi-agent context', () => {
    it('tells the lead to fan out', () => {
        const text = renderContext(review, rules);
        expect(text).toContain('Multi-agent review');
        expect(text).toContain('You are the lead agent');
        expect(text).toContain('shard i/N');
    });

    it('renders a role and only the assigned shard files', () => {
        const text = renderContext(review, rules, { role: 'correctness', shard: { index: 1, count: 2 } });
        expect(text).toContain('Role: Correctness');
        expect(text).toContain('Shard: 1/2');
        expect(text).toContain('src/a.ts');
        expect(text).not.toContain('src/b.ts');
        expect(text).toContain('Do not call revdeck_draft_findings');
        expect(text).toContain('§6, §10');
    });
});

describe('review scenario context', () => {
    it('puts the explicit review procedure at the top', () => {
        const text = renderContext(review, rules, { scenario: 'review' });
        expect(text).toContain("Scenario: reviewing someone else's MR");
        expect(text).toContain('Procedure: `Review.md`');
        expect(contextPayload(review, rules, 'review')).toMatchObject({
            scenario: 'review',
            suggestedScenario: null,
        });
    });

    it('puts the explicit feedback procedure at the top', () => {
        const text = renderContext(review, rules, { scenario: 'feedback' });
        expect(text).toContain('Scenario: feedback on your own MR');
        expect(text).toContain('Procedure: `Feedback.md`');
        expect(contextPayload(review, rules, 'feedback')).toMatchObject({
            scenario: 'feedback',
            suggestedScenario: null,
        });
    });

    it('keeps the target branch and merge state visible', () => {
        const withMerge = {
            ...review,
            info: {
                ...review.info,
                merge: {
                    state: 'conflict',
                    targetBranch: 'main',
                    detail: 'conflict · cannot_be_merged',
                    checkedAt: '2026-01-01T00:00:00Z',
                    baseSha: 'a'.repeat(40),
                    headSha: 'b'.repeat(40),
                },
            },
        } as ReviewView;
        const text = renderContext(withMerge, rules);
        expect(text).toContain('Branch and comparison base');
        expect(text).toContain('Merges into: `main`');
        expect(text).toContain('Merge status: conflict');
        expect(text).toContain('Conflict with target');
        expect(contextPayload(withMerge, rules)).toMatchObject({ merge: { state: 'conflict', targetBranch: 'main' } });
    });

    it('does not require merge status for a local diff without a target', () => {
        const local = { ...review, info: { ...review.info, targetBranch: '' } } as ReviewView;
        const text = renderContext(local, rules);
        expect(text).toContain('not applicable (local diff)');
        expect(text).not.toContain('No merge status was reported');
    });

    it('shows the review mode and risk reasons', () => {
        const risky = {
            ...review,
            risk: { level: 'high', mode: 'full', files: 2, changedLines: 2000, reasons: ['security-sensitive:src/auth.ts'] },
        } as unknown as ReviewView;
        const text = renderContext(risky, rules);
        expect(text).toContain('Review mode: full');
        expect(text).toContain('security-sensitive:src/auth.ts');
    });

    it('includes review-level questions and agent replies', () => {
        const withMessages = {
            ...review,
            agentMessages: [
                { id: 'm1', role: 'human', text: 'Explain the task', createdAt: '2026-01-01T00:00:00Z' },
                { id: 'm2', role: 'agent', text: 'It adds b', createdAt: '2026-01-01T00:01:00Z' },
            ],
        } as unknown as ReviewView;
        const text = renderContext(withMessages, rules);
        expect(text).toContain('Messages to the agent (2)');
        expect(text).toContain('Explain the task');
        expect(text).toContain('It adds b');
    });

    it('marks the current user own MR and suggests feedback', () => {
        const own = { ...review, user: { username: 'author', name: 'Author' } } as ReviewView;
        const text = renderContext(own, rules);
        expect(text).toContain('author · your MR');
        expect(contextPayload(own, rules)).toMatchObject({ scenario: null, suggestedScenario: 'feedback' });
    });

    it('suggests review for someone else MR', () => {
        const foreign = { ...review, user: { username: 'reviewer', name: 'Reviewer' } } as ReviewView;
        const text = renderContext(foreign, rules);
        expect(text).toContain("someone else's MR");
        expect(contextPayload(foreign, rules)).toMatchObject({ suggestedScenario: 'review' });
    });
});
