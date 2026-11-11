import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDaemon, type DaemonClient } from '../client.js';
import type { ReviewView } from '../daemon/view.js';
import type { ReviewSummary } from '../core/types.js';
import { writers } from './format.js';
import { tr } from '../core/locale.js';

async function reviewFor(client: DaemonClient, root: string, arg: string | undefined): Promise<ReviewView> {
    if (arg && /^(gitlab|github):/.test(arg)) {
        const { review } = await client.request<{ review: ReviewView }>('reviews.get', { review: arg });
        return review;
    }
    if (arg) {
        const { review } = await client.request<{ review: ReviewView }>('reviews.open', { root, input: arg });
        return review;
    }
    const { reviews } = await client.request<{ reviews: { id: string }[] }>('reviews.list');
    if (reviews.length === 1) {
        const { review } = await client.request<{ review: ReviewView }>('reviews.get', { review: reviews[0]!.id });
        return review;
    }
    throw new Error(tr('укажите номер ревью', 'pass a review number'));
}

async function serializeDiff(client: DaemonClient, review: ReviewView): Promise<string> {
    const chunks: string[] = [];
    for (const file of review.files) {
        let header = `diff --git a/${file.oldPath} b/${file.path}\n`;
        if (file.status === 'added') header += 'new file mode 100644\n--- /dev/null\n+++ b/' + file.path + '\n';
        else if (file.status === 'deleted') header += 'deleted file mode 100644\n--- a/' + file.oldPath + '\n+++ /dev/null\n';
        else if (file.status === 'renamed') header += `rename from ${file.oldPath}\nrename to ${file.path}\n--- a/${file.oldPath}\n+++ b/${file.path}\n`;
        else header += `--- a/${file.oldPath}\n+++ b/${file.path}\n`;
        if (file.binary) {
            chunks.push(`${header}Binary files differ\n`);
            continue;
        }
        const { file: diff } = await client.request<{ file: { hunks: { header: string; lines: { kind: string; text: string }[] }[] } | null }>('diff.get', {
            review: review.id,
            file: file.path,
        });
        let body = '';
        for (const hunk of diff?.hunks ?? []) {
            body += `${hunk.header}\n`;
            for (const line of hunk.lines) body += `${line.kind}${line.text}\n`;
        }
        chunks.push(header + body);
    }
    return chunks.join('');
}

export async function exportReview(root: string, arg: string | undefined, dir: string): Promise<void> {
    const { client } = await ensureDaemon();
    try {
        const review = await reviewFor(client, root, arg);
        const target = path.resolve(root, dir);
        await mkdir(target, { recursive: true });
        const base = `mr-${review.info.ref.number}`;
        const files: string[] = [];
        const write = async (name: string, data: unknown): Promise<void> => {
            const file = path.join(target, name);
            await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o644 });
            files.push(name);
        };
        if (review.summary) await write(`${base}-summary.json`, review.summary);
        await write(`${base}-findings.json`, {
            findings: review.findings.map((finding) => ({
                id: finding.id,
                level: finding.level,
                file: finding.file,
                line: finding.line,
                title: finding.title,
                body: finding.body,
                comment: finding.comment,
            })),
        });
        await write(`${base}-replies.json`, {
            general_note: '',
            handoff: null,
            replies: review.drafts
                .filter((draft) => draft.body || draft.resolve)
                .map((draft) => ({
                    discussion_id: draft.threadId,
                    reply: draft.body,
                    resolve: draft.resolve,
                    ...(draft.posted ? { posted: draft.posted } : {}),
                    resolved: draft.resolved,
                    status: draft.error ? 'error' : draft.resolved ? 'resolved' : draft.replied ? 'published' : 'draft',
                    ...(draft.error ? { error: draft.error } : {}),
                })),
        });
        await write(`${base}-notes.json`, {
            notes: review.notes.map((note) => ({
                id: note.id,
                file: note.file,
                line: note.line,
                text: note.text,
                to_agent: note.toAgent,
                agent_action: note.agentAction,
                agent_reply: note.agentReply,
                posted: note.posted,
                discussion_id: note.discussionId,
                note_id: note.noteId,
                error: note.error,
                at: note.createdAt,
            })),
        });
        // Совместимость со старым UI: нормализованные треды в форме discussions.json.
        await write(`${base}-discussions.json`, review.threads.map((thread) => ({
            id: thread.id,
            notes: thread.notes.map((note) => ({
                id: Number(note.id) || note.id,
                body: note.body,
                system: note.system,
                resolvable: thread.resolvable,
                resolved: thread.resolved,
                created_at: note.createdAt,
                author: { username: note.author, name: note.authorName },
                ...(thread.path ? { position: { new_path: thread.path, new_line: thread.line, old_path: thread.path, old_line: null } } : {}),
            })),
        })));
        const published: Record<string, unknown> = {};
        for (const finding of review.findings) {
            if (finding.status === 'published') {
                published[finding.id] = { discussion_id: finding.discussionId ?? '', posted: finding.comment, at: finding.publishedAt ?? '' };
            }
        }
        await write(`${base}-published.json`, published);
        await writeFile(path.join(target, `${base}.diff`), await serializeDiff(client, review), { mode: 0o644 });
        files.push(`${base}.diff`);
        writers.out(`${tr('экспортировано в', 'exported to')} ${path.relative(root, target)}: ${files.join(', ')}`);
    } finally {
        client.close();
    }
}

export async function importReview(root: string, arg: string | undefined, dir: string): Promise<void> {
    const { client } = await ensureDaemon();
    try {
        const review = await reviewFor(client, root, arg);
        const target = path.resolve(root, dir);
        const base = `mr-${review.info.ref.number}`;
        const read = async <T>(name: string): Promise<T | null> => {
            try {
                return JSON.parse(await readFile(path.join(target, name), 'utf8')) as T;
            } catch {
                return null;
            }
        };
        const summary = await read<ReviewSummary>(`${base}-summary.json`);
        if (summary) {
            await client.request('summary.put', { review: review.id, summary });
            writers.out(`✔ ${tr('выжимка', 'summary')}`);
        }
        const findings = await read<{ findings?: unknown[] } | unknown[]>(`${base}-findings.json`);
        if (findings) {
            const list = Array.isArray(findings) ? findings : (findings.findings ?? []);
            await client.request('findings.put', { review: review.id, findings: list });
            writers.out(`✔ ${tr('замечания', 'findings')}: ${list.length}`);
        }
        const replies = await read<{ replies?: { discussion_id: string; reply: string; resolve?: boolean }[] }>(`${base}-replies.json`);
        if (replies?.replies) {
            for (const reply of replies.replies) {
                await client.request('drafts.put', {
                    review: review.id,
                    threadId: reply.discussion_id,
                    patch: { body: reply.reply, resolve: Boolean(reply.resolve) },
                });
            }
            writers.out(`✔ ${tr('черновики ответов', 'reply drafts')}: ${replies.replies.length}`);
        }
        const notes = await read<{ notes?: { file: string; line: number; text: string; to_agent?: boolean; agent_reply?: string }[] }>(`${base}-notes.json`);
        if (notes?.notes) {
            for (const note of notes.notes) {
                const added = await client.request<{ note: { id: string } }>('notes.add', {
                    review: review.id,
                    file: note.file,
                    line: note.line,
                    text: note.text,
                    toAgent: note.to_agent !== false,
                });
                if (note.agent_reply) {
                    await client.request('notes.update', { review: review.id, noteId: added.note.id, patch: { agentReply: note.agent_reply } });
                }
            }
            writers.out(`✔ ${tr('комментарии к строкам', 'line comments')}: ${notes.notes.length}`);
        }
    } finally {
        client.close();
    }
}
