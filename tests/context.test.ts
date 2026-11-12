import { describe, expect, it } from 'vitest';
import { renderContext, type RulesPayload } from '../src/context.js';
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
    roles: ['correctness', 'architecture'],
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
