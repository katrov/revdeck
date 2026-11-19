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
