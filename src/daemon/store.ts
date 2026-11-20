import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ReviewConfig } from '../core/config.js';
import type {
    Decision,
    AgentMessage,
    DiffFile,
    ReviewEvent,
    Finding,
    Reaction,
    LineNote,
    ReplyDraft,
    ReviewInfo,
    ReviewSummary,
    Thread,
    User,
} from '../core/types.js';
import { randomBytes } from 'node:crypto';
import { reviewId as makeReviewId } from '../core/refs.js';
import { projectKey, projectTitle, type ProjectRef } from '../core/projects.js';
import { tr } from '../core/locale.js';

export interface ReviewRow {
    id: string;
    platform: string;
    host: string;
    project: string;
    project_key: string;
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
    reactions: Reaction[];
    user: User | null;
    config: ReviewConfig;
    configPath: string | null;
    errors: string[];
    syncedAt: string;
}

export interface ReviewVersion {
    id: number;
    headSha: string;
    baseSha: string;
    diffHash: string;
    createdAt: string;
    files: number;
    findings: number;
    additions: number;
    deletions: number;
}

export interface ReviewVersionData extends ReviewVersion {
    data: unknown;
}

export interface ReviewListItem {
    id: string;
    platform: string;
    host: string;
    project: string;
    projectKey: string;
    number: number;
    title: string;
    author: string;
    state: string;
    webUrl: string;
    updatedAt: string;
    syncedAt: string;
    root: string;
}

export interface ProjectSummary {
    key: string;
    platform: string;
    host: string;
    project: string;
    title: string;
    roots: string[];
    reviews: number;
    createdAt: string;
    updatedAt: string;
    lastActivity: string;
}

export interface FeatureSummary {
    id: string;
    title: string;
    brief: string;
    contract: string;
    status: 'open' | 'archived';
    createdAt: string;
    updatedAt: string;
    reviews: number;
    projects: { key: string; platform: string; host: string; project: string; title: string }[];
}

export interface FeatureMember {
    review: ReviewListItem;
    role: string;
    sortOrder: number;
    addedAt: string;
}

export interface FeatureNote {
    id: string;
    featureId: string;
    kind: 'note' | 'finding';
    level: string;
    title: string;
    body: string;
    author: 'human' | 'agent';
    createdAt: string;
    updatedAt: string;
}

export interface FeatureDetail extends FeatureSummary {
    members: FeatureMember[];
    notes: FeatureNote[];
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

function reviewItem(row: Row): ReviewListItem {
    return {
        id: text(row, 'id'),
        platform: text(row, 'platform'),
        host: text(row, 'host'),
        project: text(row, 'project'),
        projectKey: text(row, 'project_key'),
        number: Number(row.number),
        title: text(row, 'title'),
        author: text(row, 'author'),
        state: text(row, 'state'),
        webUrl: text(row, 'web_url'),
        updatedAt: text(row, 'updated_at'),
        syncedAt: text(row, 'synced_at'),
        root: text(row, 'root'),
    };
}

export class Store {
    readonly db: DatabaseSync;
    /**
     * Последний разобранный снимок. UI и фоновый sync многократно читают одно
     * ревью; повторный JSON.parse большого diff занимает сотни миллисекунд.
     * Один снимок — компромисс между скоростью и памятью.
     */
    private snapshotCache: { id: string; syncedAt: string; snapshot: ReviewSnapshot } | null = null;

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
                project_key TEXT NOT NULL DEFAULT '',
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
                reactions_json TEXT NOT NULL DEFAULT '[]',
                user_json TEXT NOT NULL DEFAULT 'null',
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
                coverage_json TEXT NOT NULL DEFAULT '[]',
                unknowns_json TEXT NOT NULL DEFAULT '[]',
                duplicates_json TEXT NOT NULL DEFAULT '[]',
                rule_candidates_json TEXT NOT NULL DEFAULT '[]',
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
                agent_note TEXT NOT NULL DEFAULT '',
                rule_ref TEXT NOT NULL DEFAULT '',
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
            CREATE TABLE IF NOT EXISTS agent_messages (
                review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL,
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
            CREATE TABLE IF NOT EXISTS review_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                at TEXT NOT NULL,
                review_id TEXT,
                actor TEXT NOT NULL,
                type TEXT NOT NULL,
                finding_id TEXT,
                thread_id TEXT,
                rule_ref TEXT,
                commit_sha TEXT,
                payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS review_events_review ON review_events(review_id, at);
            CREATE INDEX IF NOT EXISTS review_events_type ON review_events(type, at);
            CREATE TABLE IF NOT EXISTS projects (
                key TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                host TEXT NOT NULL,
                project TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS project_roots (
                project_key TEXT NOT NULL REFERENCES projects(key) ON DELETE CASCADE,
                root TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY (project_key, root)
            );
            CREATE TABLE IF NOT EXISTS features (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                brief TEXT NOT NULL DEFAULT '',
                contract TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS feature_reviews (
                feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
                review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                role TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                added_at TEXT NOT NULL,
                PRIMARY KEY (feature_id, review_id)
            );
            CREATE INDEX IF NOT EXISTS feature_reviews_review ON feature_reviews(review_id);
            CREATE TABLE IF NOT EXISTS feature_notes (
                id TEXT PRIMARY KEY,
                feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
                kind TEXT NOT NULL DEFAULT 'note',
                level TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                author TEXT NOT NULL DEFAULT 'human',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS feature_notes_feature ON feature_notes(feature_id, created_at);
            CREATE TABLE IF NOT EXISTS review_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                head_sha TEXT NOT NULL DEFAULT '',
                base_sha TEXT NOT NULL DEFAULT '',
                diff_hash TEXT NOT NULL,
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS review_versions_review ON review_versions(review_id, created_at);
        `);
        // Мягкая миграция старых баз: CREATE TABLE IF NOT EXISTS не добавляет новые колонки.
        const findingColumns = this.db.prepare('PRAGMA table_info(findings)').all() as Row[];
        if (!findingColumns.some((column) => text(column, 'name') === 'agent_note')) {
            this.db.exec("ALTER TABLE findings ADD COLUMN agent_note TEXT NOT NULL DEFAULT ''");
        }
        if (!findingColumns.some((column) => text(column, 'name') === 'rule_ref')) {
            this.db.exec("ALTER TABLE findings ADD COLUMN rule_ref TEXT NOT NULL DEFAULT ''");
        }
        const dataColumns = this.db.prepare('PRAGMA table_info(review_data)').all() as Row[];
        if (!dataColumns.some((column) => text(column, 'name') === 'reactions_json')) {
            this.db.exec("ALTER TABLE review_data ADD COLUMN reactions_json TEXT NOT NULL DEFAULT '[]'");
        }
        if (!dataColumns.some((column) => text(column, 'name') === 'user_json')) {
            this.db.exec("ALTER TABLE review_data ADD COLUMN user_json TEXT NOT NULL DEFAULT 'null'");
        }
        const summaryColumns = this.db.prepare('PRAGMA table_info(summaries)').all() as Row[];
        if (!summaryColumns.some((column) => text(column, 'name') === 'coverage_json')) {
            this.db.exec("ALTER TABLE summaries ADD COLUMN coverage_json TEXT NOT NULL DEFAULT '[]'");
        }
        if (!summaryColumns.some((column) => text(column, 'name') === 'unknowns_json')) {
            this.db.exec("ALTER TABLE summaries ADD COLUMN unknowns_json TEXT NOT NULL DEFAULT '[]'");
        }
        if (!summaryColumns.some((column) => text(column, 'name') === 'duplicates_json')) {
            this.db.exec("ALTER TABLE summaries ADD COLUMN duplicates_json TEXT NOT NULL DEFAULT '[]'");
        }
        if (!summaryColumns.some((column) => text(column, 'name') === 'rule_candidates_json')) {
            this.db.exec("ALTER TABLE summaries ADD COLUMN rule_candidates_json TEXT NOT NULL DEFAULT '[]'");
        }
        const reviewColumns = this.db.prepare('PRAGMA table_info(reviews)').all() as Row[];
        if (!reviewColumns.some((column) => text(column, 'name') === 'project_key')) {
            this.db.exec("ALTER TABLE reviews ADD COLUMN project_key TEXT NOT NULL DEFAULT ''");
        }
        const featureColumns = this.db.prepare('PRAGMA table_info(features)').all() as Row[];
        if (!featureColumns.some((column) => text(column, 'name') === 'contract')) {
            this.db.exec("ALTER TABLE features ADD COLUMN contract TEXT NOT NULL DEFAULT ''");
        }
        this.db.exec('CREATE INDEX IF NOT EXISTS reviews_project ON reviews(project_key, updated_at DESC, number DESC)');
        // Заполняем project_key и реестр проектов для баз, созданных до разделения.
        this.transaction(() => {
            const missing = this.db
                .prepare("SELECT id, platform, host, project FROM reviews WHERE project_key = ''")
                .all() as Row[];
            const updateKey = this.db.prepare('UPDATE reviews SET project_key = ? WHERE id = ?');
            for (const row of missing) {
                updateKey.run(
                    projectKey({
                        platform: text(row, 'platform') as ProjectRef['platform'],
                        host: text(row, 'host'),
                        project: text(row, 'project'),
                    }),
                    text(row, 'id'),
                );
            }
            const groups = this.db
                .prepare(
                    `SELECT project_key, platform, host, project,
                            MIN(synced_at) AS first_seen, MAX(synced_at) AS last_seen, MAX(updated_at) AS last_updated
                     FROM reviews GROUP BY project_key`,
                )
                .all() as Row[];
            const insertProject = this.db.prepare(
                `INSERT INTO projects (key, platform, host, project, title, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at`,
            );
            for (const row of groups) {
                const project = text(row, 'project');
                insertProject.run(
                    text(row, 'project_key'),
                    text(row, 'platform'),
                    text(row, 'host'),
                    project,
                    projectTitle(project),
                    text(row, 'first_seen') || text(row, 'last_updated'),
                    text(row, 'last_updated') || text(row, 'last_seen'),
                );
            }
            const roots = this.db
                .prepare(
                    `SELECT project_key, root, MAX(synced_at) AS last_seen
                     FROM reviews GROUP BY project_key, root`,
                )
                .all() as Row[];
            const insertRoot = this.db.prepare(
                `INSERT INTO project_roots (project_key, root, last_seen_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(project_key, root) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
            );
            for (const row of roots) insertRoot.run(text(row, 'project_key'), text(row, 'root'), text(row, 'last_seen'));
        });
    }

    saveReview(info: ReviewInfo, root: string, syncedAt = new Date().toISOString()): string {
        const id = makeReviewId(info.ref);
        this.registerProject(info.ref, root, syncedAt);
        this.db
            .prepare(
                `INSERT INTO reviews (id, platform, host, project, project_key, number, title, author, state, web_url, updated_at, synced_at, root, info_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title, author = excluded.author, state = excluded.state,
                   web_url = excluded.web_url, updated_at = excluded.updated_at,
                   synced_at = excluded.synced_at, root = excluded.root, project_key = excluded.project_key,
                   info_json = excluded.info_json`,
            )
            .run(
                id,
                info.ref.platform,
                info.ref.host,
                info.ref.project,
                projectKey(info.ref),
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

    /** Регистрирует проект и его рабочую копию; вызывается при открытии ревью. */
    registerProject(ref: ProjectRef, root: string, seenAt = new Date().toISOString()): string {
        const key = projectKey(ref);
        this.db
            .prepare(
                `INSERT INTO projects (key, platform, host, project, title, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET updated_at = excluded.updated_at`,
            )
            .run(key, ref.platform, ref.host, ref.project, projectTitle(ref.project), seenAt, seenAt);
        this.db
            .prepare(
                `INSERT INTO project_roots (project_key, root, last_seen_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(project_key, root) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
            )
            .run(key, root, seenAt);
        return key;
    }

    listProjects(): ProjectSummary[] {
        const rows = this.db
            .prepare(
                `SELECT p.*,
                        (SELECT COUNT(*) FROM reviews r WHERE r.project_key = p.key) AS reviews,
                        (SELECT MAX(r.synced_at) FROM reviews r WHERE r.project_key = p.key) AS last_activity
                 FROM projects p
                 ORDER BY COALESCE(last_activity, p.updated_at) DESC, p.key ASC`,
            )
            .all() as Row[];
        const roots = this.db.prepare('SELECT project_key, root FROM project_roots ORDER BY last_seen_at DESC, root ASC').all() as Row[];
        const rootsByProject = new Map<string, string[]>();
        for (const row of roots) {
            const key = text(row, 'project_key');
            const list = rootsByProject.get(key) ?? [];
            list.push(text(row, 'root'));
            rootsByProject.set(key, list);
        }
        return rows.map((row) => {
            const key = text(row, 'key');
            return {
                key,
                platform: text(row, 'platform'),
                host: text(row, 'host'),
                project: text(row, 'project'),
                title: text(row, 'title') || projectTitle(text(row, 'project')),
                roots: rootsByProject.get(key) ?? [],
                reviews: Number(row.reviews ?? 0),
                createdAt: text(row, 'created_at'),
                updatedAt: text(row, 'updated_at'),
                lastActivity: text(row, 'last_activity') || text(row, 'updated_at'),
            };
        });
    }

    getProject(key: string): ProjectSummary | null {
        return this.listProjects().find((project) => project.key === key) ?? null;
    }

    /** Переименование проекта и явное управление root'ами рабочих копий. */
    updateProject(
        key: string,
        patch: { title?: string; roots?: string[] },
        now = new Date().toISOString(),
    ): ProjectSummary | null {
        const current = this.getProject(key);
        if (!current) return null;
        const title = (patch.title ?? current.title).trim();
        if (!title) throw new Error(tr('название проекта не может быть пустым', 'project title cannot be empty'));
        const roots = patch.roots === undefined ? null : [...new Set(patch.roots.map((root) => root.trim()).filter(Boolean))];
        this.transaction(() => {
            this.db.prepare('UPDATE projects SET title = ?, updated_at = ? WHERE key = ?').run(title.slice(0, 120), now, key);
            if (roots !== null) {
                this.db.prepare('DELETE FROM project_roots WHERE project_key = ?').run(key);
                const insert = this.db.prepare('INSERT INTO project_roots (project_key, root, last_seen_at) VALUES (?, ?, ?)');
                for (const root of roots) insert.run(key, root, now);
            }
        });
        return this.getProject(key);
    }

    /** Удаляет проект вместе с его локальными ревью; платформа не затрагивается. */
    removeProject(key: string): number {
        const countRow = this.db.prepare('SELECT COUNT(*) AS count FROM reviews WHERE project_key = ?').get(key) as Row | undefined;
        const reviews = Number(countRow?.count ?? 0);
        this.transaction(() => {
            this.db.prepare('DELETE FROM approvals WHERE review_id IN (SELECT id FROM reviews WHERE project_key = ?)').run(key);
            this.db.prepare('DELETE FROM review_events WHERE review_id IN (SELECT id FROM reviews WHERE project_key = ?)').run(key);
            this.db.prepare('DELETE FROM reviews WHERE project_key = ?').run(key);
            this.db.prepare('DELETE FROM projects WHERE key = ?').run(key);
        });
        return reviews;
    }

    // ---------------------------------------------------------------- features

    private featureMembers(id: string): FeatureMember[] {
        const rows = this.db
            .prepare(
                `SELECT fr.role, fr.sort_order, fr.added_at, r.*
                 FROM feature_reviews fr
                 JOIN reviews r ON r.id = fr.review_id
                 WHERE fr.feature_id = ?
                 ORDER BY fr.sort_order ASC, fr.added_at ASC, r.number ASC`,
            )
            .all(id) as Row[];
        return rows.map((row) => ({
            review: reviewItem(row),
            role: text(row, 'role'),
            sortOrder: Number(row.sort_order),
            addedAt: text(row, 'added_at'),
        }));
    }

    private featureSummary(row: Row, members: FeatureMember[]): FeatureSummary {
        const projects = new Map<string, FeatureSummary['projects'][number]>();
        for (const member of members) {
            const project = member.review;
            if (!projects.has(project.projectKey)) {
                projects.set(project.projectKey, {
                    key: project.projectKey,
                    platform: project.platform,
                    host: project.host,
                    project: project.project,
                    title: projectTitle(project.project),
                });
            }
        }
        return {
            id: text(row, 'id'),
            title: text(row, 'title'),
            brief: text(row, 'brief'),
            contract: text(row, 'contract'),
            status: text(row, 'status') === 'archived' ? 'archived' : 'open',
            createdAt: text(row, 'created_at'),
            updatedAt: text(row, 'updated_at'),
            reviews: members.length,
            projects: [...projects.values()],
        };
    }

    listFeatures(project?: string, includeArchived = false): FeatureSummary[] {
        const clauses = [includeArchived ? '1 = 1' : "f.status = 'open'"];
        const args: string[] = [];
        if (project) {
            clauses.push('EXISTS (SELECT 1 FROM feature_reviews fr JOIN reviews r ON r.id = fr.review_id WHERE fr.feature_id = f.id AND r.project_key = ?)');
            args.push(project);
        }
        const rows = this.db
            .prepare(`SELECT f.* FROM features f WHERE ${clauses.join(' AND ')} ORDER BY f.updated_at DESC, f.title ASC`)
            .all(...args) as Row[];
        return rows.map((row) => this.featureSummary(row, this.featureMembers(text(row, 'id'))));
    }

    featureNotes(featureId: string): FeatureNote[] {
        const rows = this.db
            .prepare('SELECT * FROM feature_notes WHERE feature_id = ? ORDER BY created_at ASC, rowid ASC')
            .all(featureId) as Row[];
        return rows.map((row) => ({
            id: text(row, 'id'),
            featureId: text(row, 'feature_id'),
            kind: text(row, 'kind') === 'finding' ? 'finding' : 'note',
            level: text(row, 'level'),
            title: text(row, 'title'),
            body: text(row, 'body'),
            author: text(row, 'author') === 'agent' ? 'agent' : 'human',
            createdAt: text(row, 'created_at'),
            updatedAt: text(row, 'updated_at'),
        }));
    }

    getFeature(id: string): FeatureDetail | null {
        const row = this.db.prepare('SELECT * FROM features WHERE id = ?').get(id) as Row | undefined;
        if (!row) return null;
        const members = this.featureMembers(id);
        return { ...this.featureSummary(row, members), members, notes: this.featureNotes(id) };
    }

    addFeatureNote(
        featureId: string,
        input: { kind?: 'note' | 'finding'; level?: string; title: string; body: string; author?: 'human' | 'agent' },
        now = new Date().toISOString(),
    ): string {
        if (!this.getFeature(featureId)) throw new Error(tr(`фича ${featureId} не найдена`, `feature ${featureId} not found`));
        const title = input.title.trim();
        if (!title) throw new Error(tr('заголовок заметки не может быть пустым', 'note title cannot be empty'));
        let id = `fn-${randomBytes(4).toString('hex')}`;
        while (this.db.prepare('SELECT 1 FROM feature_notes WHERE id = ?').get(id)) id = `fn-${randomBytes(4).toString('hex')}`;
        this.db
            .prepare(
                `INSERT INTO feature_notes (id, feature_id, kind, level, title, body, author, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(id, featureId, input.kind === 'finding' ? 'finding' : 'note', input.level ?? '', title, input.body, input.author ?? 'human', now, now);
        this.touchFeature(featureId, now);
        return id;
    }

    updateFeatureNote(
        featureId: string,
        noteId: string,
        patch: { kind?: 'note' | 'finding'; level?: string; title?: string; body?: string },
        now = new Date().toISOString(),
    ): void {
        const row = this.db.prepare('SELECT * FROM feature_notes WHERE id = ? AND feature_id = ?').get(noteId, featureId) as Row | undefined;
        if (!row) throw new Error(tr(`заметка ${noteId} не найдена`, `note ${noteId} not found`));
        const title = patch.title !== undefined ? patch.title.trim() : text(row, 'title');
        if (!title) throw new Error(tr('заголовок заметки не может быть пустым', 'note title cannot be empty'));
        this.db
            .prepare('UPDATE feature_notes SET kind = ?, level = ?, title = ?, body = ?, updated_at = ? WHERE id = ? AND feature_id = ?')
            .run(
                patch.kind ?? (text(row, 'kind') as 'note' | 'finding'),
                patch.level ?? text(row, 'level'),
                title,
                patch.body ?? text(row, 'body'),
                now,
                noteId,
                featureId,
            );
        this.touchFeature(featureId, now);
    }

    deleteFeatureNote(featureId: string, noteId: string, now = new Date().toISOString()): void {
        this.db.prepare('DELETE FROM feature_notes WHERE id = ? AND feature_id = ?').run(noteId, featureId);
        this.touchFeature(featureId, now);
    }

    featuresForReview(reviewId: string): FeatureSummary[] {
        const rows = this.db
            .prepare(
                `SELECT f.* FROM features f
                 JOIN feature_reviews fr ON fr.feature_id = f.id
                 WHERE fr.review_id = ?
                 ORDER BY f.updated_at DESC, f.title ASC`,
            )
            .all(reviewId) as Row[];
        return rows.map((row) => this.featureSummary(row, this.featureMembers(text(row, 'id'))));
    }

    private touchFeature(id: string, now: string): void {
        this.db.prepare('UPDATE features SET updated_at = ? WHERE id = ?').run(now, id);
    }

    createFeature(input: { title: string; brief?: string; contract?: string; reviews?: { review: string; role?: string }[] }, now = new Date().toISOString()): string {
        const title = input.title.trim();
        if (!title) throw new Error(tr('название фичи не может быть пустым', 'feature title cannot be empty'));
        const reviews = input.reviews ?? [];
        let id = `ft-${randomBytes(4).toString('hex')}`;
        while (this.db.prepare('SELECT 1 FROM features WHERE id = ?').get(id)) id = `ft-${randomBytes(4).toString('hex')}`;
        this.transaction(() => {
            this.db
                .prepare('INSERT INTO features (id, title, brief, contract, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(id, title, input.brief ?? '', input.contract ?? '', 'open', now, now);
            this.insertFeatureReviews(id, reviews, now);
            this.touchFeature(id, now);
        });
        return id;
    }

    private insertFeatureReviews(featureId: string, reviews: { review: string; role?: string }[], now: string): void {
        let order = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM feature_reviews WHERE feature_id = ?').get(featureId) as Row;
        let next = Number(order.max_order ?? -1) + 1;
        const existingRole = this.db.prepare('SELECT role FROM feature_reviews WHERE feature_id = ? AND review_id = ?');
        const insert = this.db.prepare(
            `INSERT INTO feature_reviews (feature_id, review_id, role, sort_order, added_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(feature_id, review_id) DO UPDATE SET role = excluded.role`,
        );
        for (const item of reviews) {
            if (!this.getReview(item.review)) throw new Error(tr(`ревью ${item.review} не найдено`, `review ${item.review} not found`));
            const previous = existingRole.get(featureId, item.review) as Row | undefined;
            const role = item.role !== undefined ? item.role : previous ? text(previous, 'role') : '';
            insert.run(featureId, item.review, role, next++, now);
        }
    }

    addFeatureReviews(featureId: string, reviews: { review: string; role?: string }[], now = new Date().toISOString()): void {
        if (!this.getFeature(featureId)) throw new Error(tr(`фича ${featureId} не найдена`, `feature ${featureId} not found`));
        this.transaction(() => {
            this.insertFeatureReviews(featureId, reviews, now);
            this.touchFeature(featureId, now);
        });
    }

    removeFeatureReview(featureId: string, reviewId: string, now = new Date().toISOString()): void {
        if (!this.getFeature(featureId)) throw new Error(tr(`фича ${featureId} не найдена`, `feature ${featureId} not found`));
        this.db.prepare('DELETE FROM feature_reviews WHERE feature_id = ? AND review_id = ?').run(featureId, reviewId);
        this.touchFeature(featureId, now);
    }

    reorderFeature(featureId: string, reviewIds: string[], now = new Date().toISOString()): void {
        const feature = this.getFeature(featureId);
        if (!feature) throw new Error(tr(`фича ${featureId} не найдена`, `feature ${featureId} not found`));
        const current = new Set(feature.members.map((member) => member.review.id));
        if (reviewIds.length !== current.size || new Set(reviewIds).size !== current.size || reviewIds.some((id) => !current.has(id))) {
            throw new Error(tr('порядок должен содержать все ревью фичи', 'the order must contain every review of the feature'));
        }
        this.transaction(() => {
            const update = this.db.prepare('UPDATE feature_reviews SET sort_order = ? WHERE feature_id = ? AND review_id = ?');
            reviewIds.forEach((reviewId, index) => update.run(index, featureId, reviewId));
            this.touchFeature(featureId, now);
        });
    }

    updateFeature(
        featureId: string,
        patch: { title?: string; brief?: string; contract?: string; status?: 'open' | 'archived' },
        now = new Date().toISOString(),
    ): void {
        if (!this.getFeature(featureId)) throw new Error(tr(`фича ${featureId} не найдена`, `feature ${featureId} not found`));
        const current = this.db.prepare('SELECT * FROM features WHERE id = ?').get(featureId) as Row;
        const title = patch.title !== undefined ? patch.title.trim() : text(current, 'title');
        if (!title) throw new Error(tr('название фичи не может быть пустым', 'feature title cannot be empty'));
        const status = patch.status ?? (text(current, 'status') as 'open' | 'archived');
        if (status !== 'open' && status !== 'archived') throw new Error(tr('некорректный статус фичи', 'invalid feature status'));
        this.db
            .prepare('UPDATE features SET title = ?, brief = ?, contract = ?, status = ?, updated_at = ? WHERE id = ?')
            .run(title, patch.brief ?? text(current, 'brief'), patch.contract ?? text(current, 'contract'), status, now, featureId);
    }

    deleteFeature(featureId: string): void {
        this.db.prepare('DELETE FROM features WHERE id = ?').run(featureId);
    }

    saveSnapshot(id: string, snapshot: ReviewSnapshot): void {
        this.db
            .prepare(
                `INSERT INTO review_data (review_id, diff_json, threads_json, reactions_json, user_json, config_json, config_path, errors_json, synced_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(review_id) DO UPDATE SET
                   diff_json = excluded.diff_json, threads_json = excluded.threads_json,
                   reactions_json = excluded.reactions_json, user_json = excluded.user_json, config_json = excluded.config_json, config_path = excluded.config_path,
                   errors_json = excluded.errors_json, synced_at = excluded.synced_at`,
            )
            .run(
                id,
                JSON.stringify(snapshot.diff),
                JSON.stringify(snapshot.threads),
                JSON.stringify(snapshot.reactions ?? []),
                JSON.stringify(snapshot.user ?? null),
                JSON.stringify(snapshot.config),
                snapshot.configPath,
                JSON.stringify(snapshot.errors),
                snapshot.syncedAt,
            );
        this.db.prepare('UPDATE reviews SET synced_at = ? WHERE id = ?').run(snapshot.syncedAt, id);
        this.snapshotCache = null;
    }

    listReviews(project?: string): ReviewListItem[] {
        const rows = project
            ? (this.db.prepare('SELECT * FROM reviews WHERE project_key = ? ORDER BY updated_at DESC, number DESC').all(project) as Row[])
            : (this.db.prepare('SELECT * FROM reviews ORDER BY updated_at DESC, number DESC').all() as Row[]);
        return rows.map(reviewItem);
    }

    getReview(id: string): { row: ReviewRow; snapshot: ReviewSnapshot } | null {
        const row = this.db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Row | undefined;
        if (!row) return null;
        const meta = this.db.prepare('SELECT synced_at FROM review_data WHERE review_id = ?').get(id) as Row | undefined;
        if (!meta) return null;
        const syncedAt = text(meta, 'synced_at');
        let snapshot: ReviewSnapshot;
        if (this.snapshotCache?.id === id && this.snapshotCache.syncedAt === syncedAt) {
            snapshot = this.snapshotCache.snapshot;
        } else {
            // Большой diff_json читаем из SQLite только при промахе кеша.
            const data = this.db.prepare('SELECT * FROM review_data WHERE review_id = ?').get(id) as Row | undefined;
            if (!data) return null;
            snapshot = {
                diff: json<DiffFile[]>(data, 'diff_json', []),
                threads: json<Thread[]>(data, 'threads_json', []),
                reactions: json<Reaction[]>(data, 'reactions_json', []),
                user: json<User | null>(data, 'user_json', null),
                config: json<ReviewConfig>(data, 'config_json', {} as ReviewConfig),
                configPath: data.config_path ? String(data.config_path) : null,
                errors: json<string[]>(data, 'errors_json', []),
                syncedAt,
            };
            this.snapshotCache = { id, syncedAt, snapshot };
        }
        return {
            row: {
                id: text(row, 'id'),
                platform: text(row, 'platform'),
                host: text(row, 'host'),
                project: text(row, 'project'),
                project_key: text(row, 'project_key'),
                number: Number(row.number),
                title: text(row, 'title'),
                author: text(row, 'author'),
                state: text(row, 'state'),
                web_url: text(row, 'web_url'),
                updated_at: text(row, 'updated_at'),
                synced_at: text(row, 'synced_at'),
                root: text(row, 'root'),
            },
            snapshot,
        };
    }

    info(id: string): ReviewInfo | null {
        const row = this.db.prepare('SELECT info_json FROM reviews WHERE id = ?').get(id) as Row | undefined;
        if (!row) return null;
        return json<ReviewInfo | null>(row, 'info_json', null);
    }

    addVersion(
        id: string,
        version: { headSha: string; baseSha: string; diffHash: string; data: unknown },
        keep = 20,
        now = new Date().toISOString(),
    ): void {
        const last = this.db.prepare('SELECT head_sha, diff_hash FROM review_versions WHERE review_id = ? ORDER BY id DESC LIMIT 1').get(id) as Row | undefined;
        if (last && String(last.head_sha ?? '') === version.headSha && String(last.diff_hash ?? '') === version.diffHash) return;
        this.db
            .prepare('INSERT INTO review_versions (review_id, head_sha, base_sha, diff_hash, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, version.headSha, version.baseSha, version.diffHash, JSON.stringify(version.data), now);
        this.db
            .prepare('DELETE FROM review_versions WHERE review_id = ? AND id NOT IN (SELECT id FROM review_versions WHERE review_id = ? ORDER BY id DESC LIMIT ?)')
            .run(id, id, Math.max(1, keep));
    }

    listVersions(id: string): ReviewVersion[] {
        const rows = this.db.prepare('SELECT * FROM review_versions WHERE review_id = ? ORDER BY id DESC').all(id) as Row[];
        return rows.map((row) => {
            const data = json<Record<string, unknown>>(row, 'data_json', {});
            const stats = (data.stats as { additions?: number; deletions?: number } | undefined) ?? {};
            const files = Array.isArray(data.files) ? data.files.length : 0;
            const findings = Array.isArray(data.findings) ? data.findings.length : 0;
            return {
                id: Number(row.id),
                headSha: text(row, 'head_sha'),
                baseSha: text(row, 'base_sha'),
                diffHash: text(row, 'diff_hash'),
                createdAt: text(row, 'created_at'),
                files,
                findings,
                additions: Number(stats.additions ?? 0),
                deletions: Number(stats.deletions ?? 0),
            };
        });
    }

    getVersion(id: string, versionId: number): ReviewVersionData | null {
        const row = this.db.prepare('SELECT * FROM review_versions WHERE review_id = ? AND id = ?').get(id, versionId) as Row | undefined;
        if (!row) return null;
        const data = json<Record<string, unknown>>(row, 'data_json', {});
        const stats = (data.stats as { additions?: number; deletions?: number } | undefined) ?? {};
        return {
            id: Number(row.id),
            headSha: text(row, 'head_sha'),
            baseSha: text(row, 'base_sha'),
            diffHash: text(row, 'diff_hash'),
            createdAt: text(row, 'created_at'),
            files: Array.isArray(data.files) ? data.files.length : 0,
            findings: Array.isArray(data.findings) ? data.findings.length : 0,
            additions: Number(stats.additions ?? 0),
            deletions: Number(stats.deletions ?? 0),
            data,
        };
    }

    removeReview(id: string): void {
        this.db.prepare('DELETE FROM review_events WHERE review_id = ?').run(id);
        this.db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
        if (this.snapshotCache?.id === id) this.snapshotCache = null;
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
            coverage: json<string[]>(row, 'coverage_json', []),
            unknowns: json<string[]>(row, 'unknowns_json', []),
            duplicates: json<string[]>(row, 'duplicates_json', []),
            ruleCandidates: json<string[]>(row, 'rule_candidates_json', []),
        };
    }

    setSummary(id: string, summary: ReviewSummary): void {
        this.db
            .prepare(
                `INSERT INTO summaries (review_id, title, scope, summary, changes_json, focus_json, coverage_json, unknowns_json, duplicates_json, rule_candidates_json, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(review_id) DO UPDATE SET
                   title = excluded.title, scope = excluded.scope, summary = excluded.summary,
                   changes_json = excluded.changes_json, focus_json = excluded.focus_json,
                   coverage_json = excluded.coverage_json, unknowns_json = excluded.unknowns_json,
                   duplicates_json = excluded.duplicates_json, rule_candidates_json = excluded.rule_candidates_json,
                   updated_at = excluded.updated_at`,
            )
            .run(
                id,
                summary.title,
                summary.scope,
                summary.summary,
                JSON.stringify(summary.changes),
                JSON.stringify(summary.focus),
                JSON.stringify(summary.coverage ?? []),
                JSON.stringify(summary.unknowns ?? []),
                JSON.stringify(summary.duplicates ?? []),
                JSON.stringify(summary.ruleCandidates ?? []),
                new Date().toISOString(),
            );
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
            agentNote: text(row, 'agent_note'),
            ...(text(row, 'rule_ref') ? { rule: text(row, 'rule_ref') } : {}),
            publishError: text(row, 'publish_error'),
        }));
    }

    replaceFindings(id: string, findings: Finding[]): void {
        this.transaction(() => {
            this.db.prepare('DELETE FROM findings WHERE review_id = ?').run(id);
            const insert = this.db.prepare(
                `INSERT INTO findings (review_id, id, fingerprint, level, file, line, end_line, title, body, comment, status, discussion_id, published_at, decision, note, agent_note, rule_ref, publish_error, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    finding.agentNote ?? '',
                    finding.rule ?? '',
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
                   status = ?, discussion_id = ?, published_at = ?, decision = ?, note = ?, agent_note = ?, rule_ref = ?, publish_error = ?, updated_at = ?
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
                finding.agentNote ?? '',
                finding.rule ?? '',
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

    // --- agent messages ---

    listAgentMessages(id: string): AgentMessage[] {
        const rows = this.db.prepare('SELECT * FROM agent_messages WHERE review_id = ? ORDER BY created_at, rowid').all(id) as Row[];
        return rows.map((row) => ({
            id: text(row, 'id'),
            role: text(row, 'role') === 'agent' ? 'agent' : 'human',
            text: text(row, 'text'),
            createdAt: text(row, 'created_at'),
        }));
    }

    addAgentMessage(id: string, message: AgentMessage): void {
        this.db
            .prepare('INSERT INTO agent_messages (review_id, id, role, text, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, message.id, message.role, message.text, message.createdAt);
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

    // --- review events (quality metrics) ---

    recordEvent(input: Omit<ReviewEvent, 'id'>): void {
        this.db
            .prepare(
                `INSERT INTO review_events (at, review_id, actor, type, finding_id, thread_id, rule_ref, commit_sha, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                input.at,
                input.reviewId,
                input.actor,
                input.type,
                input.findingId ?? null,
                input.threadId ?? null,
                input.ruleRef ?? null,
                input.commitSha ?? null,
                JSON.stringify(input.payload ?? null),
            );
    }

    listEvents(reviewId: string, from?: string, to?: string, limit = 5000): ReviewEvent[] {
        const clauses = ['review_id = ?'];
        const params: (string | number)[] = [reviewId];
        if (from) {
            clauses.push('at >= ?');
            params.push(from);
        }
        if (to) {
            clauses.push('at <= ?');
            params.push(to);
        }
        params.push(limit);
        const rows = this.db
            .prepare(`SELECT * FROM review_events WHERE ${clauses.join(' AND ')} ORDER BY id ASC LIMIT ?`)
            .all(...params) as Row[];
        return rows.map((row) => ({
            id: Number(row.id),
            at: text(row, 'at'),
            reviewId: row.review_id ? String(row.review_id) : null,
            actor: text(row, 'actor') as ReviewEvent['actor'],
            type: text(row, 'type'),
            ...(row.finding_id ? { findingId: String(row.finding_id) } : {}),
            ...(row.thread_id ? { threadId: String(row.thread_id) } : {}),
            ...(row.rule_ref ? { ruleRef: String(row.rule_ref) } : {}),
            ...(row.commit_sha ? { commitSha: String(row.commit_sha) } : {}),
            payload: json<unknown>(row, 'payload_json', null),
        }));
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
