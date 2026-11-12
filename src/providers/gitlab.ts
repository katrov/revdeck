import { tmpdir } from 'node:os';
import { REACTIONS, type DiffFile, type Note, type Platform, type Reaction, type ReviewInfo, type ReviewRef, type Thread, type UploadedAttachment, type User } from '../core/types.js';
import { parseUnifiedDiff } from '../core/diff.js';
import { ProviderError } from '../core/errors.js';
import { redact } from '../core/redact.js';
import { run as realRun, type Runner } from '../core/exec.js';
import { parseJson, cliError, query, withTempJson } from './util.js';
import { tr } from '../core/locale.js';
import type { CreateThreadInput, CreatedThread, ListOptions, Provider, ProviderOptions, ReviewListItem, UploadInput } from './provider.js';

interface GlUser {
    id: number;
    username: string;
    name: string;
}

interface GlNote {
    id: number;
    body: string;
    system: boolean;
    resolvable?: boolean;
    resolved?: boolean;
    created_at: string;
    author?: GlUser;
    position?: {
        new_path?: string | null;
        old_path?: string | null;
        new_line?: number | null;
        old_line?: number | null;
        position_type?: string;
    } | null;
}

interface GlDiscussion {
    id: string;
    notes: GlNote[];
}

interface GlMergeRequest {
    iid: number;
    project_id?: number;
    title: string;
    description: string | null;
    author?: GlUser;
    state: string;
    draft?: boolean;
    work_in_progress?: boolean;
    source_branch: string;
    target_branch: string;
    web_url: string;
    sha?: string;
    updated_at: string;
    changes_count?: string | null;
    diff_refs?: { base_sha?: string; start_sha?: string; head_sha?: string } | null;
}

interface GlDiffFile {
    old_path: string;
    new_path: string;
    new_file: boolean;
    deleted_file: boolean;
    renamed_file: boolean;
    diff: string;
    too_large?: boolean;
    binary?: boolean;
}

const EMPTY_SHA = '0000000000000000000000000000000000000000';

export class GitLabProvider implements Provider {
    readonly platform: Platform = 'gitlab';
    readonly capabilities = { reactions: true, resolve: true, nativeDrafts: true, attachments: true };
    private readonly run: Runner;
    private me: User | null = null;
    private infoCache: ReviewInfo | null = null;

    constructor(
        readonly ref: ReviewRef,
        private readonly options: ProviderOptions,
    ) {
        this.run = options.runImpl ?? realRun;
    }

    private get projectRef(): string {
        return encodeURIComponent(this.ref.project);
    }

    private endpoint(suffix: string): string {
        return `projects/${this.projectRef}/merge_requests/${this.ref.number}${suffix}`;
    }

    private async call(args: string[]): Promise<string> {
        const inputIndex = args.indexOf('--input');
        const withHeaders = inputIndex >= 0 && !args.includes('-H')
            ? [...args.slice(0, inputIndex), '-H', 'Content-Type: application/json', ...args.slice(inputIndex)]
            : args;
        try {
            const { stdout } = await this.run('glab', ['api', '--hostname', this.ref.host, ...withHeaders], {
                // Вне рабочей копии: `.git/config`, который может менять агент, не участвует.
                cwd: tmpdir(),
                timeoutMs: 90_000,
                maxBuffer: 64 * 1024 * 1024,
            });
            return stdout;
        } catch (error) {
            cliError(error, 'gitlab', this.ref.host);
        }
    }

    private async json<T>(args: string[]): Promise<T> {
        return parseJson<T>(await this.call(args), `GitLab ${this.ref.project}!${this.ref.number}`);
    }

    private async paged<T>(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<T[]> {
        const items: T[] = [];
        for (let page = 1; page <= 50; page++) {
            const chunk = await this.json<T[]>([query(endpoint, { ...params, per_page: 100, page })]);
            if (!Array.isArray(chunk)) throw new ProviderError(tr('GitLab: ожидался массив в ответе на список', 'GitLab: expected an array in the list response'));
            items.push(...chunk);
            if (chunk.length < 100) break;
        }
        return items;
    }

    async info(): Promise<ReviewInfo> {
        if (this.infoCache) return this.infoCache;
        const mr = await this.json<GlMergeRequest>([this.endpoint('')]);
        const refs = mr.diff_refs ?? {};
        const base = refs.base_sha || mr.sha || EMPTY_SHA;
        const start = refs.start_sha || base;
        const head = refs.head_sha || mr.sha || EMPTY_SHA;
        const files = Number.parseInt(String(mr.changes_count ?? '0'), 10);
        const info: ReviewInfo = {
            ref: this.ref,
            title: String(mr.title ?? ''),
            description: String(mr.description ?? ''),
            author: mr.author?.username ?? '',
            authorName: mr.author?.name ?? '',
            state: String(mr.state ?? ''),
            draft: Boolean(mr.draft ?? mr.work_in_progress),
            sourceBranch: String(mr.source_branch ?? ''),
            targetBranch: String(mr.target_branch ?? ''),
            webUrl: String(mr.web_url ?? ''),
            ...(typeof mr.project_id === 'number' ? { projectId: mr.project_id } : {}),
            commit: { base, start, head },
            updatedAt: String(mr.updated_at ?? ''),
            stats: { files: Number.isFinite(files) ? files : 0, additions: 0, deletions: 0 },
        };
        this.infoCache = info;
        return info;
    }

    async diff(): Promise<DiffFile[]> {
        const items = await this.paged<GlDiffFile>(this.endpoint('/diffs'));
        const chunks: string[] = [];
        for (const file of items) {
            const oldPath = file.old_path;
            const newPath = file.new_path;
            let header = `diff --git a/${oldPath} b/${newPath}\n`;
            if (file.new_file) header += 'new file mode 100644\n';
            if (file.deleted_file) header += 'deleted file mode 100644\n';
            if (file.renamed_file) header += `rename from ${oldPath}\nrename to ${newPath}\n`;
            if (file.binary || file.too_large || !file.diff) {
                header += 'Binary files differ\n';
                chunks.push(header);
                continue;
            }
            header += `--- ${file.new_file ? '/dev/null' : `a/${oldPath}`}\n+++ ${file.deleted_file ? '/dev/null' : `b/${newPath}`}\n`;
            chunks.push(header + file.diff);
        }
        return parseUnifiedDiff(chunks.join('\n'));
    }

    async threads(): Promise<Thread[]> {
        const discussions = await this.paged<GlDiscussion>(this.endpoint('/discussions'));
        const threads: Thread[] = [];
        for (const discussion of discussions) {
            const notes = (discussion.notes ?? []).filter((note) => !note.system);
            if (!notes.length) continue;
            const placed = discussion.notes.find((note) => note.position) ?? discussion.notes[0];
            const position = placed?.position ?? null;
            const head = discussion.notes.find((note) => note.resolvable !== undefined) ?? discussion.notes[0];
            threads.push({
                id: String(discussion.id),
                path: position?.new_path ?? position?.old_path ?? null,
                line: position?.new_line ?? position?.old_line ?? null,
                side: position?.new_line ? 'new' : position?.old_line ? 'old' : null,
                resolvable: Boolean(head?.resolvable),
                resolved: Boolean(head?.resolved),
                notes: notes.map((note) => this.mapNote(note)),
                updatedAt: String(notes[notes.length - 1]?.created_at ?? ''),
            });
        }
        return threads;
    }

    private mapNote(note: GlNote): Note {
        return {
            id: String(note.id),
            author: note.author?.username ?? '?',
            authorName: note.author?.name ?? '',
            createdAt: String(note.created_at ?? ''),
            body: String(note.body ?? ''),
            system: Boolean(note.system),
        };
    }

    async currentUser(): Promise<User> {
        if (this.me) return this.me;
        const user = await this.json<GlUser>(['user']);
        this.me = { username: user.username, name: user.name };
        return this.me;
    }

    async list(options: ListOptions = {}): Promise<ReviewListItem[]> {
        const scope = options.scope ?? 'open';
        const limit = Math.min(options.limit ?? 50, 100);
        const params: Record<string, string | number | undefined> = {
            state: 'opened',
            order_by: 'updated_at',
            sort: 'desc',
            per_page: limit,
        };
        if (scope === 'mine') params.scope = 'created_by_me';
        if (scope === 'reviewing') {
            const me = await this.currentUser();
            params.scope = 'all';
            params.reviewer_username = me.username;
        }
        const items = await this.json<GlMergeRequest[]>([query(`projects/${this.projectRef}/merge_requests`, params)]);
        return (Array.isArray(items) ? items : []).map((mr) => ({
            ref: { ...this.ref, number: mr.iid },
            title: String(mr.title ?? ''),
            author: mr.author?.username ?? '',
            updatedAt: String(mr.updated_at ?? ''),
            state: String(mr.state ?? ''),
            draft: Boolean(mr.draft ?? mr.work_in_progress),
            webUrl: String(mr.web_url ?? ''),
        }));
    }

    async findByBranch(branch: string): Promise<ReviewRef | null> {
        const items = await this.json<GlMergeRequest[]>([query(`projects/${this.projectRef}/merge_requests`, { state: 'opened', source_branch: branch, per_page: 1 })]);
        const first = Array.isArray(items) ? items[0] : undefined;
        return first ? { ...this.ref, number: first.iid } : null;
    }

    async reply(thread: Thread, body: string): Promise<Note> {
        const endpoint = this.endpoint(`/discussions/${encodeURIComponent(thread.id)}/notes`);
        const note = await withTempJson({ body }, async (file) => this.json<GlNote>(['--method', 'POST', endpoint, '--input', file]));
        return this.mapNote(note);
    }

    async resolve(threadId: string, resolved: boolean): Promise<void> {
        await withTempJson({ resolved }, async (file) => {
            await this.call(['--method', 'PUT', this.endpoint(`/discussions/${encodeURIComponent(threadId)}`), '--input', file]);
        });
    }

    async reactions(noteId: string): Promise<Reaction[]> {
        const base = this.endpoint(`/notes/${encodeURIComponent(noteId)}/award_emoji`);
        const items = await this.paged<{ id: number; name: string; user?: GlUser }>(base);
        const me = await this.currentUser();
        const grouped = new Map<string, Reaction>();
        for (const item of items) {
            if (!(REACTIONS as readonly string[]).includes(item.name)) continue;
            const reaction = grouped.get(item.name) ?? { name: item.name, count: 0, users: [], mine: false };
            reaction.count += 1;
            const username = item.user?.username;
            if (username) {
                reaction.users.push(username);
                if (username === me.username) reaction.mine = true;
            }
            grouped.set(item.name, reaction);
        }
        return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
    }

    async react(noteId: string, emoji: string): Promise<{ active: boolean }> {
        const base = this.endpoint(`/notes/${encodeURIComponent(noteId)}/award_emoji`);
        const existing = await this.json<{ id: number; name: string; user?: GlUser }[]>([query(base, { per_page: 100 })]);
        const me = await this.currentUser();
        const mine = existing.find((item) => item.name === emoji && item.user?.username === me.username);
        if (mine) {
            await this.call(['--method', 'DELETE', `${base}/${mine.id}`]);
            return { active: false };
        }
        await withTempJson({ name: emoji }, async (file) => {
            await this.call(['--method', 'POST', base, '--input', file]);
        });
        return { active: true };
    }

    async upload(input: UploadInput): Promise<UploadedAttachment> {
        interface GlUpload {
            alt?: string;
            url?: string;
            full_path?: string;
        }
        const endpoint = `projects/${this.projectRef}/uploads`;
        // --form требует glab с поддержкой multipart (см. docs/integrations.md).
        const uploaded = await this.json<GlUpload>(['--method', 'POST', endpoint, '--form', `file=@${input.path}`]);
        const raw = uploaded.full_path || uploaded.url || '';
        if (!raw) throw new ProviderError(tr('GitLab не вернул ссылку на загруженный файл', 'GitLab did not return a link to the uploaded file'));
        const projectId = (await this.info().catch(() => null))?.projectId;
        const absolute = raw.startsWith('http://') || raw.startsWith('https://')
            ? raw
            : raw.startsWith('/uploads/') && projectId
              ? `https://${this.ref.host}/-/project/${projectId}${raw}`
              : `https://${this.ref.host}${raw.startsWith('/') ? '' : '/'}${raw}`;
        const label = input.name.replace(/[[\]\r\n]/g, ' ').trim() || 'attachment';
        const markdown = input.contentType.startsWith('image/') || input.contentType.startsWith('video/')
            ? `![${label}](${absolute})`
            : `[${label}](${absolute})`;
        return { name: input.name, url: absolute, markdown };
    }

    async createThread(input: CreateThreadInput): Promise<CreatedThread> {
        const info = await this.info();
        if (!info.commit.head || info.commit.head === EMPTY_SHA) {
            throw new ProviderError(tr('GitLab не вернул SHA ревизий: комментарий к строке невозможен', 'GitLab did not return revision SHAs: a line comment is not possible'));
        }
        const payload =
            input.line === null
                ? { body: input.body }
                : {
                      body: input.body,
                      position: {
                          position_type: 'text',
                          base_sha: info.commit.base,
                          start_sha: info.commit.start,
                          head_sha: info.commit.head,
                          new_path: input.file,
                          old_path: input.file,
                          new_line: input.line,
                          ...(input.oldLine !== null ? { old_line: input.oldLine } : {}),
                      },
                  };
        const created = await withTempJson(payload, async (file) =>
            this.json<GlDiscussion>(['--method', 'POST', this.endpoint('/discussions'), '--input', file]),
        );
        const note = created.notes?.[0];
        if (!note) throw new ProviderError(tr('GitLab не вернул созданное обсуждение', 'GitLab did not return the created discussion'));
        return { discussionId: String(created.id), noteId: String(note.id) };
    }
}

export function isAuthError(error: unknown): boolean {
    return /auth|401|403|unauthor|forbidden|not logged/i.test(redact(error));
}
