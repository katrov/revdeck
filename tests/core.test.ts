import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig, reviewConfigSchema } from '../src/core/config.js';
import { fingerprintOf, mergeFindings, validateFinding } from '../src/core/findings.js';
import { normalizeMediaLinks, sanitizeBody } from '../src/core/sanitize.js';
import { attachmentSpec, matchesSignature } from '../src/core/attachments.js';
import { canonicalJson } from '../src/core/canonical.js';
import { globToRegExp, classifyFile } from '../src/core/glob.js';
import { parseRemote } from '../src/core/git.js';
import { parseReviewUrl, webUrl } from '../src/core/refs.js';
import { normalizeHeading, extractExcerpt } from '../src/core/rules.js';
import type { Finding } from '../src/core/types.js';

describe('config', () => {
    it('applies defaults', () => {
        const config = parseConfig('version: 1\n');
        expect(config.provider.type).toBe('auto');
        expect(config.output.language).toBe('auto');
        expect(config.publish.requireApproval).toBe(true);
        expect(config.publish.maxComments).toBe(50);
        expect(config.rules.map).toEqual([]);
        expect(config.rules.maxDocumentBytes).toBe(0);
        expect(config.rules.maxTotalBytes).toBe(0);
        expect(config.review.agents).toBe(3);
        expect(config.review.roles).toEqual(['correctness', 'architecture', 'tests']);
    });

    it('parses a map and checks', () => {
        const config = parseConfig(`
version: 1
provider: { type: gitlab, project: group/proj }
rules:
  sources: [AGENTS.md]
  map:
    - match: ["src/**", "lib/**"]
      docs: [docs/Architecture.md#Layers]
checks:
  - id: lint
    argv: [npm, run, lint]
    when: ["src/**"]
`);
        expect(config.rules.map[0]!.docs).toEqual(['docs/Architecture.md#Layers']);
        expect(config.checks[0]!.consent).toBe(true);
    });

    it('accepts a custom multi-agent plan and rejects unknown roles', () => {
        const config = parseConfig('version: 1\nreview:\n  agents: 2\n  roles: [security, performance]\n');
        expect(config.review.agents).toBe(2);
        expect(config.review.roles).toEqual(['security', 'performance']);
        expect(() => parseConfig('version: 1\nreview:\n  roles: [nope]\n')).toThrow(/review/);
    });

    it('accepts custom review roles and rejects unknown references', () => {
        const config = parseConfig(`
version: 1
review:
  agents: 2
  roles: [correctness, accessibility]
  customRoles:
    accessibility:
      title: Accessibility
      description: Keyboard, ARIA and contrast.
      criteria: ["9", "10"]
      focus: a11y
`);
        expect(config.review.customRoles.accessibility!.title).toBe('Accessibility');
        expect(config.review.roles).toEqual(['correctness', 'accessibility']);
        expect(() => parseConfig('version: 1\nreview:\n  roles: [missing]\n')).toThrow(/unknown role/);
        expect(() => parseConfig('version: 1\nreview:\n  customRoles:\n    tests:\n      title: X\n      description: Y\n')).toThrow(/built in/);
    });

    it('merges .revdeck.local.yml and keeps base read-only enforced', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'revdeck-config-'));
        try {
            await writeFile(path.join(root, '.revdeck.yml'), 'version: 1\nreview:\n  agents: 2\n  roles: [correctness, architecture]\n  readOnly: true\nrules:\n  sources: [AGENTS.md]\n');
            await writeFile(path.join(root, '.revdeck.local.yml'), 'review:\n  agents: 4\n  roles: [security]\n  readOnly: false\n');
            const loaded = await loadConfig(root);
            expect(loaded.config.review.agents).toBe(4);
            expect(loaded.config.review.roles).toEqual(['security']);
            expect(loaded.config.review.readOnly).toBe(true);
            expect(loaded.config.rules.sources).toEqual(['AGENTS.md']);
            expect(loaded.path).toBe(path.join(root, '.revdeck.yml'));
            expect(loaded.localPath).toBe(path.join(root, '.revdeck.local.yml'));
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('rejects unknown levels and bad shapes', () => {
        expect(() => parseConfig('checks:\n  - id: x\n    argv: []\n')).toThrow(/checks/);
        expect(() => reviewConfigSchema.parse({ provider: { type: 'bitbucket' } })).toThrow();
    });
});

describe('sanitize', () => {
    it('accepts normal review text', () => {
        expect(sanitizeBody('Здесь гонка: `this.ready` ещё false.\n\nСм. src/a.ts:10.', 'gitlab').ok).toBe(true);
    });

    it('blocks platform quick actions on gitlab only', () => {
        expect(sanitizeBody('/approve\nplease', 'gitlab').ok).toBe(false);
        expect(sanitizeBody('/approve\nplease', 'github').ok).toBe(true);
        expect(sanitizeBody('  /merge', 'gitlab').ok).toBe(false);
    });

    it('blocks hidden content and mass mentions', () => {
        expect(sanitizeBody('hi\u202eтам', 'gitlab').ok).toBe(false);
        expect(sanitizeBody('<!-- hidden -->', 'gitlab').ok).toBe(false);
        expect(sanitizeBody('@all посмотрите', 'github').ok).toBe(false);
        expect(sanitizeBody('<img src=x>', 'github').ok).toBe(false);
    });

    it('allows images only from the platform host and GitLab uploads', () => {
        expect(sanitizeBody('![x](https://evil/x.png)', 'github', { host: 'github.com' }).ok).toBe(false);
        expect(sanitizeBody('![x](https://github.com/user-attachments/x.png)', 'github', { host: 'github.com' }).ok).toBe(true);
        expect(sanitizeBody('![x](https://gitlab.example.com/uploads/abc/x.png)', 'gitlab', { host: 'gitlab.example.com' }).ok).toBe(true);
        expect(sanitizeBody('![x](/uploads/abc/x.png)', 'gitlab', { host: 'gitlab.example.com' }).ok).toBe(true);
        expect(sanitizeBody('![x](https://evil/x.png)', 'gitlab', { host: 'gitlab.example.com' }).ok).toBe(false);
        expect(sanitizeBody('![x](https://gitlab.example.com/uploads/abc/x.png)', 'gitlab').ok).toBe(false);
    });

    it('leaves relative GitLab upload links to GitLab and repairs host-only absolute links', () => {
        expect(normalizeMediaLinks('![x](/uploads/abc/x.png)', 'gitlab', 'gitlab.example.com', 36)).toBe('![x](/uploads/abc/x.png)');
        expect(normalizeMediaLinks('![x](https://gitlab.example.com/uploads/abc/x.png)', 'gitlab', 'gitlab.example.com', 36)).toBe(
            '![x](https://gitlab.example.com/-/project/36/uploads/abc/x.png)',
        );
        expect(normalizeMediaLinks('![x](https://gitlab.example.com/-/project/35/uploads/abc/x.png)', 'gitlab', 'gitlab.example.com', 36)).toBe(
            '![x](https://gitlab.example.com/-/project/36/uploads/abc/x.png)',
        );
        expect(normalizeMediaLinks('![x](/uploads/abc/x.png)', 'github', 'github.com')).toBe('![x](/uploads/abc/x.png)');
    });
});

describe('findings', () => {
    const previous: Finding[] = [
        {
            id: 'f-1',
            fingerprint: fingerprintOf({ file: 'a.ts', level: 'major', title: 'Гонка' }),
            level: 'major',
            file: 'a.ts',
            line: 10,
            endLine: null,
            title: 'Гонка',
            body: 'old body',
            comment: 'published text',
            status: 'published',
            discussionId: 'd1',
            publishedAt: '2026-01-01T00:00:00Z',
            decision: 'accept',
            note: '',
            publishError: '',
        },
    ];

    it('keeps published findings intact and marks disappeared ones stale', () => {
        const merged = mergeFindings(previous, []);
        expect(merged[0]!.status).toBe('published');
        expect(merged[0]!.comment).toBe('published text');

        const other = mergeFindings(
            [{ ...previous[0]!, status: 'draft', discussionId: null, publishedAt: null }],
            [],
        );
        expect(other[0]!.status).toBe('stale');
    });

    it('matches by fingerprint when the line moved', () => {
        const merged = mergeFindings(previous, [
            { level: 'major', file: 'a.ts', line: 42, title: 'Гонка', body: 'new body', comment: 'new comment' },
        ]);
        expect(merged).toHaveLength(1);
        expect(merged[0]!.id).toBe('f-1');
        expect(merged[0]!.line).toBe(42);
        expect(merged[0]!.comment).toBe('published text');
        expect(merged[0]!.decision).toBe('accept');
    });

    it('validates drafts', () => {
        expect(validateFinding({ file: 'a', title: 't', body: 'b' }).value?.level).toBe('question');
        expect(validateFinding({ file: '', title: 't', body: 'b' }).error).toMatch(/file/);
        expect(validateFinding({ file: 'a', title: 't', body: 'b', level: 'high' }).error).toMatch(/level/);
        expect(validateFinding({ file: 'a', title: 't', body: 'b', line: 0 }).error).toMatch(/line/);
    });
});

describe('helpers', () => {
    it('canonical json sorts keys', () => {
        expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    });

    it('globs and classifies', () => {
        expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true);
        expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
        expect(globToRegExp('docs/{a,b}/*.md').test('docs/b/x.md')).toBe(true);
        expect(classifyFile('src/app.test.ts')).toBe('test');
        expect(classifyFile('docs/Architecture.md')).toBe('docs');
        expect(classifyFile('package-lock.json')).toBe('config');
    });

    it('parses remotes and urls', () => {
        expect(parseRemote('git@gitlab.example.com:group/sub/proj.git')).toMatchObject({
            host: 'gitlab.example.com',
            project: 'group/sub/proj',
            platform: 'gitlab',
        });
        expect(parseRemote('git@github.com:acme/repo.git')).toMatchObject({ host: 'github.com', project: 'acme/repo', platform: 'github' });
        expect(parseRemote('ssh://git@git.example.com:2222/team/repo.git')).toMatchObject({ host: 'git.example.com', project: 'team/repo', platform: null });
        expect(parseRemote('https://github.com/acme/repo.git')?.platform).toBe('github');
        expect(parseRemote('https://gitlab.com/acme/repo.git')?.platform).toBe('gitlab');
        expect(parseReviewUrl('https://gitlab.com/g/s/p/-/merge_requests/42')).toMatchObject({ platform: 'gitlab', number: 42 });
        expect(parseReviewUrl('https://github.com/o/r/pull/7')).toMatchObject({ platform: 'github', project: 'o/r', number: 7 });
        expect(parseReviewUrl('o/r#7')).toMatchObject({ platform: 'github', number: 7 });
        expect(webUrl({ platform: 'github', host: 'github.com', project: 'o/r', number: 7 })).toBe('https://github.com/o/r/pull/7');
    });

    it('extracts headings and line ranges', () => {
        const md = '# Top\n\ntext\n\n## Layers\n\nrule one\n\n### Sub\n\nmore\n\n## Other\n\ntail\n';
        expect(normalizeHeading('## Слои и зависимости')).toBe('слои-и-зависимости');
        const warnings: string[] = [];
        expect(extractExcerpt(md, ['layers'], 'd.md', warnings)).toBe('## Layers\n\nrule one\n\n### Sub\n\nmore');
        expect(extractExcerpt(md, ['L1-L3'], 'd.md', warnings)).toBe('# Top\n\ntext');
        expect(extractExcerpt(md, ['nope'], 'd.md', warnings)).toBe('');
        expect(warnings[0]).toMatch(/не найдена/);
    });
});

describe('attachments', () => {
    it('accepts only known raster images and videos', () => {
        expect(attachmentSpec('shot.png', 'image/png')).toMatchObject({ name: 'shot.png', kind: 'image' });
        expect(attachmentSpec('clip.mp4', 'video/mp4')).toMatchObject({ name: 'clip.mp4', kind: 'video' });
        expect(attachmentSpec('../../evil.png')).toBeNull();
        expect(attachmentSpec('icon.svg', 'image/svg+xml')).toBeNull();
        expect(attachmentSpec('shot.png', 'image/jpeg')).toBeNull();
        expect(attachmentSpec('script.js', 'text/javascript')).toBeNull();
    });

    it('checks file signatures', () => {
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(matchesSignature(png, 'image/png')).toBe(true);
        expect(matchesSignature(Buffer.from('not a png'), 'image/png')).toBe(false);
        expect(matchesSignature(Buffer.from('OggS'), 'video/ogg')).toBe(true);
    });
});
