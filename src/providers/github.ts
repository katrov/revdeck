import { tmpdir } from 'node:os';
import type { DiffFile, Note, Platform, Reaction, ReviewInfo, ReviewRef, Thread, User } from '../core/types.js';
import { parseUnifiedDiff } from '../core/diff.js';
import { ProviderError } from '../core/errors.js';
import { run as realRun, type Runner } from '../core/exec.js';
import { parseJson, cliError, query, withTempJson } from './util.js';
import { tr } from '../core/locale.js';
import type { CreateThreadInput, CreatedThread, ListOptions, Provider, ProviderOptions, ReviewListItem } from './provider.js';

interface GhUser {
    login: string;
    name?: string | null;
}

interface GhPull {
    number: number;
    title: string;
    body: string | null;
    user: GhUser | null;
    state: string;
    draft?: boolean;
    merged_at?: string | null;
    html_url: string;
    updated_at: string;
    changed_files?: number;
    additions?: number;
    deletions?: number;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
}

interface GhFile {
    filename: string;
    previous_filename?: string;
    status: string;
    additions?: number;
    deletions?: number;
    patch?: string;
}

interface GhComment {
    id: number;
    body: string;
    user: GhUser | null;
    created_at: string;
}

interface GqlComment {
    databaseId: number | null;
    id: string;
    author: { login: string } | null;
    body: string;
    createdAt: string;
}

interface GqlThread {
    id: string;
    isResolved: boolean;
    isOutdated: boolean;
    path: string | null;
    line: number | null;
    originalLine: number | null;
    diffSide: 'LEFT' | 'RIGHT' | null;
    comments: { nodes: GqlComment[] };
}

interface GqlThreads {
    repository: {
        pullRequest: {
            reviewThreads: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: GqlThread[];
            };
        } | null;
    } | null;
}

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine diffSide
          comments(first: 100) {
            nodes { databaseId id author { login } body createdAt }
          }
        }
      }
    }
  }
}`;

const REACTIONS: Record<string, string> = {
    thumbsup: '+1',
    thumbsdown: '-1',
    smile: 'laugh',
    tada: 'hooray',
    confused: 'confused',
    heart: 'heart',
    rocket: 'rocket',
    eyes: 'eyes',
};

const CONTENT_TO_NAME: Record<string, string> = Object.fromEntries(Object.entries(REACTIONS).map(([name, content]) => [content, name]));

export class GitHubProvider implements Provider {
    readonly platform: Platform = 'github';
    readonly capabilities = { reactions: true, resolve: true, nativeDrafts: false };
    private readonly run: Runner;
    private readonly owner: string;
    private readonly name: string;
    private me: User | null = null;
    private infoCache: ReviewInfo | null = null;

    constructor(
        readonly ref: ReviewRef,
        private readonly options: ProviderOptions,
    ) {
        this.run = options.runImpl ?? realRun;
        const [owner, name, ...rest] = ref.project.split('/');
        if (!owner || !name || rest.length) {
            throw new ProviderError(tr(`GitHub: проект должен быть owner/repo, получено ${ref.project}`, `GitHub: project must be owner/repo, got ${ref.project}`));
        }
        this.owner = owner;
        this.name = name;
    }

    private get repo(): string {
        return `${this.owner}/${this.name}`;
    }

    private get pullBase(): string {
        return `repos/${this.repo}/pulls/${this.ref.number}`;
    }

    private async call(args: string[]): Promise<string> {
        const inputIndex = args.indexOf('--input');
        const withHeaders = inputIndex >= 0 && !args.includes('-H')
            ? [...args.slice(0, inputIndex), '-H', 'Content-Type: application/json', ...args.slice(inputIndex)]
            : args;
        try {
            const { stdout } = await this.run('gh', ['api', ...withHeaders], {
                cwd: tmpdir(),
                env: { GH_HOST: this.ref.host },
                timeoutMs: 90_000,
                maxBuffer: 64 * 1024 * 1024,
            });
            return stdout;
        } catch (error) {
            cliError(error, 'github', this.ref.host);
        }
    }

    private async json<T>(args: string[]): Promise<T> {
        return parseJson<T>(await this.call(args), `GitHub ${this.ref.project}#${this.ref.number}`);
    }

    private async paged<T>(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
        const items: T[] = [];
        for (let page = 1; page <= 50; page++) {
            const chunk = await this.json<T[]>([query(endpoint, { ...params, per_page: 100, page })]);
            if (!Array.isArray(chunk)) throw new ProviderError(tr('GitHub: ожидался массив в ответе на список', 'GitHub: expected an array in the list response'));
            items.push(...chunk);
            if (chunk.length < 100) break;
        }
        return items;
    }

    private async graphql<T>(queryText: string, variables: Record<string, string | number | null | undefined>): Promise<T> {
        const args = ['graphql', '-f', `query=${queryText}`];
        for (const [key, value] of Object.entries(variables)) {
            if (value === null || value === undefined) continue;
            args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
        }
        const data = await this.json<{ data?: T; errors?: { message: string }[] }>(args);
        if (data.errors?.length) throw new ProviderError(`GitHub GraphQL: ${data.errors.map((item) => item.message).join('; ')}`);
        if (!data.data) throw new ProviderError(tr('GitHub GraphQL: пустой ответ', 'GitHub GraphQL: empty response'));
        return data.data;
    }

    async info(): Promise<ReviewInfo> {
        if (this.infoCache) return this.infoCache;
        const pr = await this.json<GhPull>([this.pullBase]);
        const state = pr.merged_at ? 'merged' : String(pr.state ?? '');
        const info: ReviewInfo = {
            ref: this.ref,
            title: String(pr.title ?? ''),
            description: String(pr.body ?? ''),
            author: pr.user?.login ?? '',
            authorName: pr.user?.name ?? '',
            state,
            draft: Boolean(pr.draft),
            sourceBranch: String(pr.head?.ref ?? ''),
            targetBranch: String(pr.base?.ref ?? ''),
            webUrl: String(pr.html_url ?? ''),
            commit: { base: String(pr.base?.sha ?? ''), start: String(pr.base?.sha ?? ''), head: String(pr.head?.sha ?? '') },
            updatedAt: String(pr.updated_at ?? ''),
            stats: {
                files: Number(pr.changed_files ?? 0),
                additions: Number(pr.additions ?? 0),
                deletions: Number(pr.deletions ?? 0),
            },
        };
        this.infoCache = info;
        return info;
    }

    async diff(): Promise<DiffFile[]> {
        const files = await this.paged<GhFile>(`${this.pullBase}/files`);
        const chunks: string[] = [];
        for (const file of files) {
            const oldPath = file.previous_filename ?? file.filename;
            const newPath = file.filename;
            let header = `diff --git a/${oldPath} b/${newPath}\n`;
            if (file.status === 'added') header += 'new file mode 100644\n--- /dev/null\n+++ b/';
            else if (file.status === 'removed') header += 'deleted file mode 100644\n--- a/';
            else if (file.status === 'renamed') header += `rename from ${oldPath}\nrename to ${newPath}\n--- a/${oldPath}\n+++ b/`;
            else header += `--- a/${oldPath}\n+++ b/`;
            header += file.status === 'removed' ? '/dev/null\n' : `${newPath}\n`;
            if (!file.patch) {
                chunks.push(`${header}Binary files differ\n`);
                continue;
            }
            chunks.push(header + file.patch);
        }
        return parseUnifiedDiff(chunks.join('\n'));
    }

    async threads(): Promise<Thread[]> {
        const nodes: GqlThread[] = [];
        let after: string | null = null;
        for (let page = 0; page < 10; page++) {
            const data: GqlThreads = await this.graphql<GqlThreads>(THREADS_QUERY, {
                owner: this.owner,
                name: this.name,
                number: this.ref.number,
                after,
            });
            const connection = data.repository?.pullRequest?.reviewThreads;
            if (!connection) throw new ProviderError(tr('GitHub: треды ревью не найдены (нет доступа?)', 'GitHub: review threads not found (no access?)'));
            nodes.push(...connection.nodes);
            if (!connection.pageInfo.hasNextPage) break;
            after = connection.pageInfo.endCursor;
        }
        return nodes
            .filter((node) => node.comments.nodes.length > 0)
            .map((node) => {
                const notes = node.comments.nodes.map((comment) => this.mapGqlNote(comment));
                return {
                    id: node.id,
                    path: node.path,
                    line: node.line ?? node.originalLine,
                    side: node.diffSide === 'LEFT' ? ('old' as const) : ('new' as const),
                    resolvable: true,
                    resolved: node.isResolved,
                    notes,
                    updatedAt: notes[notes.length - 1]?.createdAt ?? '',
                };
            });
    }

    private mapGqlNote(comment: GqlComment): Note {
        return {
            id: String(comment.databaseId ?? comment.id),
            author: comment.author?.login ?? '?',
            authorName: '',
            createdAt: String(comment.createdAt ?? ''),
            body: String(comment.body ?? ''),
            system: false,
        };
    }

    async currentUser(): Promise<User> {
        if (this.me) return this.me;
        const user = await this.json<GhUser>(['user']);
        this.me = { username: user.login, name: user.name ?? '' };
        return this.me;
    }

    async list(options: ListOptions = {}): Promise<ReviewListItem[]> {
        const limit = Math.min(options.limit ?? 50, 100);
        if (options.scope === 'reviewing') {
            const search = await this.json<{ items: { number: number; title: string; user: GhUser | null; updated_at: string; html_url: string; state: string; draft?: boolean }[] }>([
                query('search/issues', { q: `repo:${this.repo} is:pr is:open review-requested:@me`, per_page: limit }),
            ]);
            return (search.items ?? []).map((item) => ({
                ref: { ...this.ref, number: item.number },
                title: item.title,
                author: item.user?.login ?? '',
                updatedAt: item.updated_at,
                state: item.state,
                draft: Boolean(item.draft),
                webUrl: item.html_url,
            }));
        }
        const pulls = await this.paged<GhPull>(`repos/${this.repo}/pulls`, { state: 'open', sort: 'updated', direction: 'desc' });
        const me = options.scope === 'mine' ? (await this.currentUser()).username : null;
        return pulls
            .filter((pull) => !me || pull.user?.login === me)
            .slice(0, limit)
            .map((pull) => ({
                ref: { ...this.ref, number: pull.number },
                title: pull.title,
                author: pull.user?.login ?? '',
                updatedAt: pull.updated_at,
                state: pull.state,
                draft: Boolean(pull.draft),
                webUrl: pull.html_url,
            }));
    }

    async findByBranch(branch: string): Promise<ReviewRef | null> {
        const pulls = await this.json<GhPull[]>([query(`repos/${this.repo}/pulls`, { state: 'open', head: `${this.owner}:${branch}`, per_page: 1 })]);
        const first = Array.isArray(pulls) ? pulls[0] : undefined;
        return first ? { ...this.ref, number: first.number } : null;
    }

    async reply(thread: Thread, body: string): Promise<Note> {
        const root = thread.notes[0]?.id;
        if (!root) throw new ProviderError(tr('в треде нет комментария, на который можно ответить', 'the thread has no comment to reply to'));
        const comment = await withTempJson({ body }, async (file) =>
            this.json<GhComment>(['--method', 'POST', `${this.pullBase}/comments/${root}/replies`, '--input', file]),
        );
        return {
            id: String(comment.id),
            author: comment.user?.login ?? '?',
            authorName: '',
            createdAt: comment.created_at,
            body: comment.body,
            system: false,
        };
    }

    async resolve(threadId: string, resolved: boolean): Promise<void> {
        const mutation = resolved
            ? 'mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }'
            : 'mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }';
        await this.graphql<unknown>(mutation, { id: threadId });
    }

    async reactions(noteId: string): Promise<Reaction[]> {
        const base = `repos/${this.repo}/pulls/comments/${encodeURIComponent(noteId)}/reactions`;
        const items = await this.paged<{ id: number; content: string; user: GhUser | null }>(base);
        const me = await this.currentUser();
        const grouped = new Map<string, Reaction>();
        for (const item of items) {
            const name = CONTENT_TO_NAME[item.content];
            if (!name) continue;
            const reaction = grouped.get(name) ?? { name, count: 0, users: [], mine: false };
            reaction.count += 1;
            const login = item.user?.login;
            if (login) {
                reaction.users.push(login);
                if (login === me.username) reaction.mine = true;
            }
            grouped.set(name, reaction);
        }
        return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
    }

    async react(noteId: string, emoji: string): Promise<{ active: boolean }> {
        const content = REACTIONS[emoji];
        if (!content) throw new ProviderError(tr(`GitHub не поддерживает реакцию ${emoji}`, `GitHub does not support reaction ${emoji}`));
        const base = `repos/${this.repo}/pulls/comments/${noteId}/reactions`;
        const existing = await this.json<{ id: number; content: string; user: GhUser | null }[]>([query(base, { per_page: 100 })]);
        const me = await this.currentUser();
        const mine = existing.find((item) => item.content === content && item.user?.login === me.username);
        if (mine) {
            await this.call(['--method', 'DELETE', `${base}/${mine.id}`]);
            return { active: false };
        }
        await withTempJson({ content }, async (file) => {
            await this.call(['--method', 'POST', base, '--input', file]);
        });
        return { active: true };
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        if (input.line === null) {
            const comment = await withTempJson({ body: input.body }, async (file) =>
                this.json<GhComment>(['--method', 'POST', `repos/${this.repo}/issues/${this.ref.number}/comments`, '--input', file]),
            );
            return { discussionId: `issue-${comment.id}`, noteId: String(comment.id) };
        }
        const info = await this.info();
        if (!info.commit.head) throw new ProviderError(tr('GitHub не вернул head SHA: комментарий к строке невозможен', 'GitHub did not return the head SHA: a line comment is not possible'));
        const payload = {
            body: input.body,
            commit_id: info.commit.head,
            path: input.file,
            line: input.line,
            side: 'RIGHT',
        };
        const comment = await withTempJson(payload, async (file) =>
            this.json<GhComment>(['--method', 'POST', `${this.pullBase}/comments`, '--input', file]),
        );
        return { discussionId: `gh-${comment.id}`, noteId: String(comment.id) };
    }
}
