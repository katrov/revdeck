import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ReviewConfig } from '../core/config.js';
import type {
    Decision,
    DiffFile,
    Finding,
    LineNote,
    ReplyDraft,
    ReviewInfo,
    ReviewSummary,
    Thread,
} from '../core/types.js';
import { reviewId as makeReviewId } from '../core/refs.js';

export interface ReviewRow {
    id: string;
    platform: string;
    host: string;
    project: string;
    number: number;
    title: string;
    author: string;
    state: string;
    web_url: string;
    updated_at: string;
    synced_at: string;
    root: string;
}

export interface ReviewSnapshot {
    diff: DiffFile[];
    threads: Thread[];
    config: ReviewConfig;
    configPath: string | null;
    errors: string[];
    syncedAt: string;
}

export interface ReviewListItem {
    id: string;
    platform: string;
    host: string;
    project: string;
    number: number;
    title: string;
    author: string;
    state: string;
    webUrl: string;
    updatedAt: string;
    syncedAt: string;
    root: string;
}

export interface ApprovalRecord {
    id: string;
    reviewId: string;
    kind: string;
    hash: string;
    items: unknown[];
    expiresAt: string;
    usedAt: string | null;
    createdAt: string;
}

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
    const value = row[key];
    return value === null || value === undefined ? '' : String(value);
}

function json<T>(row: Row, key: string, fallback: T): T {
    const value = row[key];
    if (typeof value !== 'string' || !value) return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

export class Store {
    readonly db: DatabaseSync;

    constructor(file: string) {
        if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(file);
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA foreign_keys = ON');
        this.db.exec('PRAGMA busy_timeout = 5000');
        this.migrate();
    }

    close(): void {
        this.db.close();
    }

    private migrate(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS reviews (
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
            CREATE TABLE IF NOT EXISTS review_data (
                review_id TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
                diff_json TEXT NOT NULL,
                threads_json TEXT NOT NULL,
                config_json TEXT NOT NULL,
                config_path TEXT,
                errors_json TEXT NOT NULL,
                synced_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS summaries (
                review_id TEXT PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                scope TEXT NOT NULL,
                summary TEXT NOT NULL,
                changes_json TEXT NOT NULL,
                focus_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS findings (
                review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                level TEXT NOT NULL,
                file TEXT NOT NULL,
                line INTEGER,
                end_line INTEGER,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                comment TEXT NOT NULL,
                status TEXT NOT NULL,
                discussion_id TEXT,
                published_at TEXT,
                decision TEXT,
                note TEXT NOT NULL,
                publish_error TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (review_id, id)
            );
            CREATE TABLE IF NOT EXISTS drafts (
                review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                thread_id TEXT NOT NULL,
                body TEXT NOT NULL,
                resolve INTEGER NOT NULL,
                note_for_agent TEXT NOT NULL,
                agent_action TEXT NOT NULL,
                posted TEXT NOT NULL,
                replied INTEGER NOT NULL,
                resolved INTEGER NOT NULL,
                error TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (review_id, thread_id)
            );
            CREATE TABLE IF NOT EXISTS notes (
                review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                file TEXT NOT NULL,
                line INTEGER NOT NULL,
                side TEXT NOT NULL,
                text TEXT NOT NULL,
                to_agent INTEGER NOT NULL,
                agent_action TEXT NOT NULL,
                agent_reply TEXT NOT NULL,
                posted TEXT NOT NULL,
                discussion_id TEXT NOT NULL,
                note_id TEXT NOT NULL,
                error TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (review_id, id)
            );
            CREATE TABLE IF NOT EXISTS decisions (
                review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                finding_id TEXT NOT NULL,
                decision TEXT,
                note TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (review_id, finding_id)
            );
            CREATE TABLE IF NOT EXISTS approvals (
                id TEXT PRIMARY KEY,
                review_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                hash TEXT NOT NULL,
                items_json TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                review_id TEXT,
                action TEXT NOT NULL,
                detail TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS audit_review ON audit(review_id, at);
        `);
    }

    saveReview(info: ReviewInfo, root: string, syncedAt = new Date().toISOString()): string {
        const id = makeReviewId(info.ref);
        this.db
            .prepare(
                `INSERT INTO reviews (id, platform, host, project, number, title, author, state, web_url, updated_at, synced_at, root, info_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title, author = excluded.author, state = excluded.state,
                   web_url = excluded.web_url, updated_at = excluded.updated_at,
                   synced_at = excluded.synced_at, root = excluded.root, info_json = excluded.info_json`,
            )
            .run(
                id,
                info.ref.platform,
                info.ref.host,
                info.ref.project,
                info.ref.number,
                info.title,
                info.author,
                info.state,
                info.webUrl,
                info.updatedAt,
                syncedAt,
                root,
                JSON.stringify(info),
            );
        return id;
    }

    saveSnapshot(id: string, snapshot: ReviewSnapshot): void {
        this.db
            .prepare(
                `INSERT INTO review_data (review_id, diff_json, threads_json, config_json, config_path, errors_json, synced_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(review_id) DO UPDATE SET
                   diff_json = excluded.diff_json, threads_json = excluded.threads_json,
                   config_json = excluded.config_json, config_path = excluded.config_path,
                   errors_json = excluded.errors_json, synced_at = excluded.synced_at`,
            )
            .run(
                id,
                JSON.stringify(snapshot.diff),
                JSON.stringify(snapshot.threads),
                JSON.stringify(snapshot.config),
                snapshot.configPath,
                JSON.stringify(snapshot.errors),
                snapshot.syncedAt,
            );
        this.db.prepare('UPDATE reviews SET synced_at = ? WHERE id = ?').run(snapshot.syncedAt, id);
    }

    listReviews(): ReviewListItem[] {
        const rows = this.db.prepare('SELECT * FROM reviews ORDER BY synced_at DESC').all() as Row[];
        return rows.map((row) => ({
            id: text(row, 'id'),
            platform: text(row, 'platform'),
            host: text(row, 'host'),
            project: text(row, 'project'),
            number: Number(row.number),
            title: text(row, 'title'),
            author: text(row, 'author'),
            state: text(row, 'state'),
            webUrl: text(row, 'web_url'),
            updatedAt: text(row, 'updated_at'),
            syncedAt: text(row, 'synced_at'),
            root: text(row, 'root'),
        }));
    }

    getReview(id: string): { row: ReviewRow; snapshot: ReviewSnapshot } | null {
        const row = this.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Row | undefined;
        if (!row) return null;
        const data = this.db.prepare('SELECT * FROM review_data WHERE review_id = ?').get(id) as Row | undefined;
        if (!data) return null;
        return {
            row: {
                id: text(row, 'id'),
                platform: text(row, 'platform'),
                host: text(row, 'host'),
                project: text(row, 'project'),
                number: Number(row.number),
                title: text(row, 'title'),
                author: text(row, 'author'),
                state: text(row, 'state'),
                web_url: text(row, 'web_url'),
                updated_at: text(row, 'updated_at'),
                synced_at: text(row, 'synced_at'),
                root: text(row, 'root'),
            },
            snapshot: {
                diff: json<DiffFile[]>(data, 'diff_json', []),
                threads: json<Thread[]>(data, 'threads_json', []),
                config: json<ReviewConfig>(data, 'config_json', {} as ReviewConfig),
                configPath: data.config_path ? String(data.config_path) : null,
                errors: json<string[]>(data, 'errors_json', []),
                syncedAt: text(data, 'synced_at'),
            },
        };
    }

    info(id: string): ReviewInfo | null {
        const row = this.db.prepare('SELECT info_json FROM reviews WHERE id = ?').get(id) as Row | undefined;
        if (!row) return null;
        return json<ReviewInfo | null>(row, 'info_json', null);
    }

    removeReview(id: string): void {
        this.db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
    }

    // --- summary ---

    getSummary(id: string): ReviewSummary | null {
        const row = this.db.prepare('SELECT * FROM summaries WHERE review_id = ?').get(id) as Row | undefined;
        if (!row) return null;
        return {
            title: text(row, 'title'),
            scope: text(row, 'scope'),
            summary: text(row, 'summary'),
            changes: json<string[]>(row, 'changes_json', []),
            focus: json<string[]>(row, 'focus_json', []),
        };
    }

    setSummary(id: string, summary: ReviewSummary): void {
        this.db
            .prepare(
                `INSERT INTO summaries (review_id, title, scope, summary, changes_json, focus_json, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(review_id) DO UPDATE SET
                   title = excluded.title, scope = excluded.scope, summary = excluded.summary,
                   changes_json = excluded.changes_json, focus_json = excluded.focus_json, updated_at = excluded.updated_at`,
            )
            .run(id, summary.title, summary.scope, summary.summary, JSON.stringify(summary.changes), JSON.stringify(summary.focus), new Date().toISOString());
    }

    // --- findings ---

    listFindings(id: string): Finding[] {
        const rows = this.db.prepare('SELECT * FROM findings WHERE review_id = ? ORDER BY rowid').all(id) as Row[];
        return rows.map((row) => ({
            id: text(row, 'id'),
            fingerprint: text(row, 'fingerprint'),
            level: text(row, 'level') as Finding['level'],
            file: text(row, 'file'),
            line: row.line === null || row.line === undefined ? null : Number(row.line),
            endLine: row.end_line === null || row.end_line === undefined ? null : Number(row.end_line),
            title: text(row, 'title'),
            body: text(row, 'body'),
            comment: text(row, 'comment'),
            status: text(row, 'status') as Finding['status'],
            discussionId: row.discussion_id ? String(row.discussion_id) : null,
            publishedAt: row.published_at ? String(row.published_at) : null,
            decision: row.decision ? (String(row.decision) as Decision) : null,
            note: text(row, 'note'),
            publishError: text(row, 'publish_error'),
        }));
    }

    replaceFindings(id: string, findings: Finding[]): void {
        this.transaction(() => {
            this.db.prepare('DELETE FROM findings WHERE review_id = ?').run(id);
            const insert = this.db.prepare(
                `INSERT INTO findings (review_id, id, fingerprint, level, file, line, end_line, title, body, comment, status, discussion_id, published_at, decision, note, publish_error, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            const now = new Date().toISOString();
            for (const finding of findings) {
                insert.run(
                    id,
                    finding.id,
                    finding.fingerprint,
                    finding.level,
                    finding.file,
                    finding.line,
                    finding.endLine,
                    finding.title,
                    finding.body,
                    finding.comment,
                    finding.status,
                    finding.discussionId,
                    finding.publishedAt,
                    finding.decision,
                    finding.note,
                    finding.publishError,
                    now,
                );
            }
        });
    }

    updateFinding(id: string, finding: Finding): void {
        this.db
            .prepare(
                `UPDATE findings SET level = ?, file = ?, line = ?, end_line = ?, title = ?, body = ?, comment = ?,
                   status = ?, discussion_id = ?, published_at = ?, decision = ?, note = ?, publish_error = ?, updated_at = ?
                 WHERE review_id = ? AND id = ?`,
            )
            .run(
                finding.level,
                finding.file,
                finding.line,
                finding.endLine,
                finding.title,
                finding.body,
                finding.comment,
                finding.status,
                finding.discussionId,
                finding.publishedAt,
                finding.decision,
                finding.note,
                finding.publishError,
                new Date().toISOString(),
                id,
                finding.id,
            );
    }

    // --- drafts ---

    listDrafts(id: string): ReplyDraft[] {
        const rows = this.db.prepare('SELECT * FROM drafts WHERE review_id = ? ORDER BY rowid').all(id) as Row[];
        return rows.map((row) => ({
            threadId: text(row, 'thread_id'),
            body: text(row, 'body'),
            resolve: Number(row.resolve) === 1,
            noteForAgent: text(row, 'note_for_agent'),
            agentAction: text(row, 'agent_action') as ReplyDraft['agentAction'],
            posted: text(row, 'posted'),
            replied: Number(row.replied) === 1,
            resolved: Number(row.resolved) === 1,
            error: text(row, 'error'),
            updatedAt: text(row, 'updated_at'),
        }));
    }

    getDraft(id: string, threadId: string): ReplyDraft | null {
        return this.listDrafts(id).find((draft) => draft.threadId === threadId) ?? null;
    }

    upsertDraft(id: string, draft: ReplyDraft): void {
        this.db
            .prepare(
                `INSERT INTO drafts (review_id, thread_id, body, resolve, note_for_agent, agent_action, posted, replied, resolved, error, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(review_id, thread_id) DO UPDATE SET
                   body = excluded.body, resolve = excluded.resolve, note_for_agent = excluded.note_for_agent,
                   agent_action = excluded.agent_action, posted = excluded.posted, replied = excluded.replied,
                   resolved = excluded.resolved, error = excluded.error, updated_at = excluded.updated_at`,
            )
            .run(
                id,
                draft.threadId,
                draft.body,
                draft.resolve ? 1 : 0,
                draft.noteForAgent,
                draft.agentAction,
                draft.posted,
                draft.replied ? 1 : 0,
                draft.resolved ? 1 : 0,
                draft.error,
                draft.updatedAt,
            );
    }

    // --- notes ---

    listNotes(id: string): LineNote[] {
        const rows = this.db.prepare('SELECT * FROM notes WHERE review_id = ? ORDER BY created_at').all(id) as Row[];
        return rows.map((row) => ({
            id: text(row, 'id'),
            file: text(row, 'file'),
            line: Number(row.line),
            side: text(row, 'side') as LineNote['side'],
            text: text(row, 'text'),
            toAgent: Number(row.to_agent) === 1,
            agentAction: text(row, 'agent_action') as LineNote['agentAction'],
            agentReply: text(row, 'agent_reply'),
            posted: text(row, 'posted'),
            discussionId: text(row, 'discussion_id'),
            noteId: text(row, 'note_id'),
            error: text(row, 'error'),
            createdAt: text(row, 'created_at'),
            updatedAt: text(row, 'updated_at'),
        }));
    }

    upsertNote(id: string, note: LineNote): void {
        this.db
            .prepare(
                `INSERT INTO notes (review_id, id, file, line, side, text, to_agent, agent_action, agent_reply, posted, discussion_id, note_id, error, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(review_id, id) DO UPDATE SET
                   file = excluded.file, line = excluded.line, side = excluded.side, text = excluded.text,
                   to_agent = excluded.to_agent, agent_action = excluded.agent_action, agent_reply = excluded.agent_reply,
                   posted = excluded.posted, discussion_id = excluded.discussion_id, note_id = excluded.note_id,
                   error = excluded.error, updated_at = excluded.updated_at`,
            )
            .run(
                id,
                note.id,
                note.file,
                note.line,
                note.side,
                note.text,
                note.toAgent ? 1 : 0,
                note.agentAction,
                note.agentReply,
                note.posted,
                note.discussionId,
                note.noteId,
                note.error,
                note.createdAt,
                note.updatedAt,
            );
    }

    deleteNote(id: string, noteId: string): void {
        this.db.prepare('DELETE FROM notes WHERE review_id = ? AND id = ?').run(id, noteId);
    }

    // --- decisions ---

    listDecisions(id: string): Record<string, { decision: Decision | null; note: string }> {
        const rows = this.db.prepare('SELECT * FROM decisions WHERE review_id = ?').all(id) as Row[];
        const out: Record<string, { decision: Decision | null; note: string }> = {};
        for (const row of rows) {
            out[text(row, 'finding_id')] = {
                decision: row.decision ? (String(row.decision) as Decision) : null,
                note: text(row, 'note'),
            };
        }
        return out;
    }

    setDecisions(id: string, patch: Record<string, { decision: Decision | null; note: string }>): void {
        const now = new Date().toISOString();
        this.transaction(() => {
            const stmt = this.db.prepare(
                `INSERT INTO decisions (review_id, finding_id, decision, note, updated_at) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(review_id, finding_id) DO UPDATE SET decision = excluded.decision, note = excluded.note, updated_at = excluded.updated_at`,
            );
            for (const [findingId, value] of Object.entries(patch)) {
                stmt.run(id, findingId, value.decision, value.note, now);
            }
        });
    }

    // --- approvals ---

    createApproval(record: ApprovalRecord): void {
        this.db
            .prepare('INSERT INTO approvals (id, review_id, kind, hash, items_json, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(record.id, record.reviewId, record.kind, record.hash, JSON.stringify(record.items), record.expiresAt, record.usedAt, record.createdAt);
    }

    getApproval(id: string): ApprovalRecord | null {
        const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
        if (!row) return null;
        return {
            id: text(row, 'id'),
            reviewId: text(row, 'review_id'),
            kind: text(row, 'kind'),
            hash: text(row, 'hash'),
            items: json<unknown[]>(row, 'items_json', []),
            expiresAt: text(row, 'expires_at'),
            usedAt: row.used_at ? String(row.used_at) : null,
            createdAt: text(row, 'created_at'),
        };
    }

    markApprovalUsed(id: string): void {
        this.db.prepare('UPDATE approvals SET used_at = ? WHERE id = ?').run(new Date().toISOString(), id);
    }

    // --- audit ---

    audit(reviewId: string | null, action: string, detail: unknown): void {
        this.db
            .prepare('INSERT INTO audit (at, review_id, action, detail) VALUES (?, ?, ?, ?)')
            .run(new Date().toISOString(), reviewId, action, JSON.stringify(detail));
    }

    auditTail(limit = 100): { at: string; reviewId: string; action: string; detail: string }[] {
        const rows = this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit) as Row[];
        return rows.map((row) => ({
            at: text(row, 'at'),
            reviewId: text(row, 'review_id'),
            action: text(row, 'action'),
            detail: text(row, 'detail'),
        }));
    }

    transaction(fn: () => void): void {
        this.db.exec('BEGIN');
        try {
            fn();
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}
