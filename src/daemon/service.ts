import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { redact } from '../core/redact.js';
import { messageOf } from '../core/errors.js';
import { findRepoRoot, findConfigFile } from '../core/paths.js';
import { loadConfig } from '../core/config.js';
import { buildEffectiveRules, renderRules } from '../core/rules.js';
import { DEFAULT_REVIEW_ROLES, type ReviewRoleId } from '../core/review-roles.js';
import { diffStats, changedPaths, findNewLine, linePosition, snippetAround } from '../core/diff.js';
import { sanitizeBody, normalizeMediaLinks } from '../core/sanitize.js';
import { attachmentSpec, decodeAttachment, matchesSignature } from '../core/attachments.js';
import { mergeFindings, validateFinding, applyDecisions, fingerprintOf, levelOrder } from '../core/findings.js';
import { canonicalJson } from '../core/canonical.js';
import { resolveOutputLanguage, tr } from '../core/locale.js';
import type { Locale } from '../core/locale.js';
import { reviewId as makeReviewId } from '../core/refs.js';
import { REACTIONS } from '../core/types.js';
import type { ReviewConfig } from '../core/config.js';
import type {
    Approval,
    Decision,
    DiffFile,
    Finding,
    Level,
    LineNote,
    Platform,
    PublishItem,
    PublishKind,
    PublishPlan,
    PublishResult,
    PublishResultItem,
    CheckResult,
    Reaction,
    ReplyDraft,
    Review,
    ReviewInfo,
    ReviewRef,
    ReviewSummary,
    Side,
    Thread,
    UploadedAttachment,
} from '../core/types.js';
import type { Provider } from '../providers/provider.js';
import { createProvider, projectContext, resolveReviewRef } from '../providers/provider.js';
import { run as realRun, type Runner } from '../core/exec.js';
import type { ReviewSnapshot, Store } from './store.js';
import { toReviewView, type ReviewView } from './view.js';

export interface ServiceOptions {
    store: Store;
    /** Для тестов: подмена провайдера и запуска команд. */
    providerFactory?: (ref: ReviewRef, root: string) => Promise<Provider>;
    runImpl?: Runner;
    now?: () => Date;
    syncIntervalMs?: number;
    refreshTtlMs?: number;
}

export interface OpenOptions {
    input?: string;
    platform?: Platform;
    project?: string;
    host?: string;
    branch?: string;
}

export interface PublishPreview {
    plan: PublishPlan;
    warnings: string[];
}

export interface CommandCheck {
    id: string;
    name: string;
    argv: string[];
    consent: boolean;
    matched: boolean;
}

const EMPTY_DRAFT = (threadId: string): ReplyDraft => ({
    threadId,
    body: '',
    resolve: false,
    noteForAgent: '',
    agentAction: '',
    posted: '',
    replied: false,
    resolved: false,
    error: '',
    updatedAt: new Date(0).toISOString(),
});

const APPROVAL_TTL_MS = 10 * 60 * 1000;

const LEVEL_MARKERS: Record<Level, string> = {
    blocker: '🟥 **blocker**',
    major: '🟧 **major**',
    minor: '🟨 **minor**',
    question: '🟦 **question**',
};

/** Уровень должен быть виден в самой публикуемой платформе, а не только в UI. */
function markedFindingBody(finding: Finding, body: string): string {
    const marker = LEVEL_MARKERS[finding.level];
    if (body.trimStart().startsWith(marker)) return body;
    return finding.file && finding.line === null ? `${marker} \`${finding.file}\`\n\n${body}` : `${marker}\n\n${body}`;
}

/**
 * Оркестратор: единая точка между провайдерами, хранилищем и интерфейсами.
 *
 * Инварианты:
 * - ничего не публикуется без approval, привязанного к хешу точного набора
 *   изменений, который видел человек;
 * - повторная публикация идемпотентна: уже отправленный текст/замечание
 *   пропускаются;
 * - ошибка одной единицы публикации не отменяет остальные.
 */
export class ReviewService {
    readonly events = new EventEmitter();
    private readonly store: Store;
    private readonly providerFactory: (ref: ReviewRef, root: string) => Promise<Provider>;
    private readonly runImpl: Runner;
    private readonly now: () => Date;
    private readonly refreshTtlMs: number;
    private readonly syncIntervalMs: number;
    private timer: NodeJS.Timeout | null = null;
    private syncing = false;

    constructor(options: ServiceOptions) {
        this.store = options.store;
        this.runImpl = options.runImpl ?? realRun;
        this.now = options.now ?? (() => new Date());
        this.refreshTtlMs = options.refreshTtlMs ?? 60_000;
        this.syncIntervalMs = options.syncIntervalMs ?? 120_000;
        this.providerFactory = options.providerFactory ?? (async (ref: ReviewRef, root: string) => createProvider(ref, { root }));
        this.events.setMaxListeners(50);
    }

    close(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.store.close();
    }

    // ---------------------------------------------------------------- reviews

    async openReview(rootInput: string, options: OpenOptions = {}): Promise<Review> {
        const root = findRepoRoot(rootInput);
        const loaded = await loadConfig(root);
        const ref = await resolveReviewRef({
            root,
            config: loaded.config,
            ...(options.input ? { input: options.input } : {}),
            ...(options.platform ? { platform: options.platform } : {}),
            ...(options.project ? { project: options.project } : {}),
            ...(options.host ? { host: options.host } : {}),
            ...(options.branch ? { branch: options.branch } : {}),
        });
        const id = makeReviewId(ref);
        const provider = await this.providerFactory(ref, root);
        await this.refresh(id, root, provider, loaded);
        this.store.audit(id, 'review.open', { ref, root });
        return this.getReview(id);
    }

    async refreshReview(id: string): Promise<Review> {
        const meta = this.store.getReview(id);
        if (!meta) throw new Error(tr(`ревью ${id} не найдено: сначала откройте его`, `review ${id} not found: open it first`));
        const loaded = await loadConfig(meta.row.root).catch((error) => ({
            config: meta.snapshot.config,
            path: meta.snapshot.configPath,
            warnings: [tr(`конфиг недоступен: ${redact(messageOf(error))}`, `config unavailable: ${redact(messageOf(error))}`)],
        }));
        const provider = await this.providerFactory(
            { platform: meta.row.platform as Platform, host: meta.row.host, project: meta.row.project, number: meta.row.number },
            meta.row.root,
        );
        await this.refresh(id, meta.row.root, provider, loaded);
        return this.getReview(id);
    }

    private async providerFor(id: string): Promise<Provider> {
        const stored = this.store.getReview(id);
        if (!stored) throw new Error(tr(`ревью ${id} не найдено`, `review ${id} not found`));
        return this.providerFactory(
            { platform: stored.row.platform as Platform, host: stored.row.host, project: stored.row.project, number: stored.row.number },
            stored.row.root,
        );
    }

    private async refresh(
        id: string,
        root: string,
        provider: Provider,
        loaded: { config: ReviewConfig; path: string | null; warnings: string[] },
    ): Promise<void> {
        const errors: string[] = [...loaded.warnings];
        const previous = this.store.getReview(id)?.snapshot;
        let info: ReviewInfo;
        try {
            info = await provider.info();
        } catch (error) {
            throw new Error(tr(`не удалось прочитать ревью: ${redact(messageOf(error))}`, `could not read the review: ${redact(messageOf(error))}`));
        }
        const syncedAt = this.now().toISOString();
        // Частичная деградация: если не удалось получить diff или треды, показываем кеш и причину.
        let diff: DiffFile[] = previous?.diff ?? [];
        try {
            diff = await provider.diff();
        } catch (error) {
            errors.push(`diff: ${redact(messageOf(error))}`);
        }
        let threads: Thread[] = previous?.threads ?? [];
        try {
            threads = await provider.threads();
        } catch (error) {
            errors.push(`${tr('треды', 'threads')}: ${redact(messageOf(error))}`);
        }
        let reactions = previous?.reactions ?? [];
        try {
            reactions = await provider.reviewReactions();
        } catch (error) {
            errors.push(`${tr('реакции', 'reactions')}: ${redact(messageOf(error))}`);
        }
        let user = previous?.user ?? null;
        try {
            user = await provider.currentUser();
        } catch (error) {
            errors.push(`${tr('текущий пользователь', 'current user')}: ${redact(messageOf(error))}`);
        }
        info.stats = diffStats(diff);
        this.store.saveReview(info, root, syncedAt);
        this.store.saveSnapshot(id, {
            diff,
            threads,
            reactions,
            user,
            config: loaded.config,
            configPath: loaded.path,
            errors,
            syncedAt,
        });
        if (diff.length) this.markStaleFindings(id, diff);
        this.emit(id);
    }

    private markStaleFindings(id: string, diff: DiffFile[]): void {
        const findings = this.store.listFindings(id);
        if (!findings.length) return;
        let changed = false;
        for (const finding of findings) {
            if (finding.status === 'published' || finding.status === 'stale') continue;
            if (finding.line === null) continue;
            if (!findNewLine(diff, finding.file, finding.line)) {
                this.store.updateFinding(id, { ...finding, status: 'stale' });
                changed = true;
            }
        }
        if (changed) this.emit(id);
    }

    getReview(id: string): Review {
        const stored = this.store.getReview(id);
        if (!stored) throw new Error(tr(`ревью ${id} не найдено`, `review ${id} not found`));
        const { row, snapshot } = stored;
        const info = this.store.info(id) ?? fallbackInfo(row);
        const draftMap = new Map(this.store.listDrafts(id).map((draft) => [draft.threadId, draft]));
        const threads = snapshot.threads;
        const drafts: ReplyDraft[] = threads.map((thread) => {
            const saved = draftMap.get(thread.id) ?? EMPTY_DRAFT(thread.id);
            // desired != last known state — пользователь переключил «закрыть» и это ещё не опубликовано.
            const desired = saved.resolve !== saved.resolved ? saved.resolve : thread.resolved;
            return {
                ...saved,
                resolved: thread.resolved,
                resolve: desired,
                replied: saved.posted.trim() !== '' && saved.body.trim() === saved.posted.trim(),
            };
        });
        // Черновики для тредов, которых уже нет, сохраняем: они видны как устаревшие.
        for (const [threadId, draft] of draftMap) {
            if (!threads.some((thread) => thread.id === threadId)) drafts.push(draft);
        }
        const findings = applyDecisions(this.store.listFindings(id), this.store.listDecisions(id)).sort(
            (a, b) => levelOrder(a.level) - levelOrder(b.level) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0),
        );
        return {
            id,
            info,
            diff: snapshot.diff,
            threads,
            reactions: snapshot.reactions,
            summary: this.store.getSummary(id),
            findings,
            drafts,
            notes: this.store.listNotes(id),
            decisions: this.store.listDecisions(id),
            user: snapshot.user,
            syncedAt: snapshot.syncedAt,
            errors: snapshot.errors,
        };
    }

    getView(id: string): ReviewView {
        return toReviewView(this.getReview(id), this.now().getTime());
    }

    listReviews(): ReturnType<Store['listReviews']> {
        return this.store.listReviews();
    }

    removeReview(id: string): void {
        this.requireReview(id);
        this.store.removeReview(id);
        this.events.emit('review', { reviewId: id, at: this.now().toISOString() });
    }

    async listRemote(
        rootInput: string,
        scope: 'open' | 'mine' | 'reviewing',
        limit = 50,
    ): Promise<{ items: Awaited<ReturnType<Provider['list']>>; platform: Platform; project: string }> {
        const root = findRepoRoot(rootInput);
        const loaded = await loadConfig(root);
        const context = await projectContext(root, loaded.config);
        const provider = await this.providerFactory({ ...context, number: 0 }, root);
        return { items: await provider.list({ scope, limit }), platform: context.platform, project: context.project };
    }

    isStale(id: string): boolean {
        const stored = this.store.getReview(id);
        if (!stored) return true;
        return this.now().getTime() - new Date(stored.snapshot.syncedAt).getTime() > this.refreshTtlMs;
    }

    async refreshIfStale(id: string): Promise<ReviewView> {
        if (this.isStale(id)) {
            try {
                await this.refreshReview(id);
            } catch {
                // Ошибка фонового обновления не должна ломать чтение кеша.
            }
        }
        return this.getView(id);
    }

    diffFile(id: string, file: string): { path: string; status: string; binary: boolean; hunks: unknown[] } | null {
        const stored = this.store.getReview(id);
        if (!stored) return null;
        const found = stored.snapshot.diff.find((item) => item.path === file);
        if (!found) return null;
        return { path: found.path, status: found.status, binary: found.binary, hunks: found.hunks };
    }

    // ---------------------------------------------------------------- summary

    setSummary(id: string, input: unknown): ReviewSummary {
        this.requireReview(id);
        const value = (input ?? {}) as Record<string, unknown>;
        const list = (item: unknown, limit: number): string[] =>
            (Array.isArray(item) ? item : [])
                .map((entry) => String(entry ?? '').trim())
                .filter(Boolean)
                .slice(0, limit)
                .map((entry) => entry.slice(0, 4000));
        const summary: ReviewSummary = {
            title: String(value.title ?? '').slice(0, 1000),
            scope: String(value.scope ?? '').slice(0, 2000),
            summary: String(value.summary ?? '').slice(0, 20_000),
            changes: list(value.changes, 100),
            focus: list(value.focus, 100),
        };
        this.store.setSummary(id, summary);
        this.emit(id);
        return summary;
    }

    // ---------------------------------------------------------------- findings

    setFindings(id: string, raw: unknown): Finding[] {
        const review = this.getReview(id);
        if (!Array.isArray(raw)) throw new Error(tr('findings: ожидался массив', 'findings: expected an array'));
        const existing = this.store.listFindings(id);
        const knownIds = new Set(existing.map((finding) => finding.id));
        const knownPrints = new Set(existing.map((finding) => finding.fingerprint));
        const drafts: Parameters<typeof mergeFindings>[1] = [];
        const errors: string[] = [];
        for (const [index, item] of raw.entries()) {
            const { value, error } = validateFinding(item);
            if (!value) {
                errors.push(`#${index + 1}: ${error}`);
                continue;
            }
            const known = (value.id ? knownIds.has(value.id) : false) || knownPrints.has(fingerprintOf(value));
            // Новое замечание обязано ссылаться на строку diff. Известное (например, стало stale
            // после новых коммитов) сохраняем, иначе UI не смог бы пересохранить свой же набор.
            if (!known) {
                const file = review.diff.find((entry) => entry.path === value.file);
                if (!file) {
                    errors.push(tr(`#${index + 1}: файла ${value.file} нет в diff`, `#${index + 1}: file ${value.file} is not in the diff`));
                    continue;
                }
                if (value.line !== null && !findNewLine(review.diff, value.file, value.line)) {
                    errors.push(tr(`#${index + 1}: строка ${value.file}:${value.line} не входит в diff`, `#${index + 1}: line ${value.file}:${value.line} is not in the diff`));
                    continue;
                }
            }
            drafts.push(value);
        }
        if (errors.length) throw new Error(tr(`замечания отклонены:\n${errors.join('\n')}`, `findings rejected:\n${errors.join('\n')}`));
        const merged = mergeFindings(this.store.listFindings(id), drafts, { now: this.now().toISOString() });
        this.store.replaceFindings(id, merged);
        this.emit(id);
        return merged;
    }

    setDecisions(id: string, raw: unknown): Record<string, { decision: Decision | null; note: string }> {
        this.requireReview(id);
        const patch: Record<string, { decision: Decision | null; note: string }> = {};
        const input = (raw ?? {}) as Record<string, unknown>;
        for (const [findingId, value] of Object.entries(input)) {
            const item = (value ?? {}) as Record<string, unknown>;
            const decision = item.decision;
            patch[findingId] = {
                decision: decision === 'accept' || decision === 'reject' || decision === 'discuss' ? decision : null,
                note: String(item.note ?? '').slice(0, 4000),
            };
        }
        this.store.setDecisions(id, patch);
        this.emit(id);
        return this.store.listDecisions(id);
    }

    // ---------------------------------------------------------------- drafts

    setDraft(
        id: string,
        threadId: string,
        patch: { body?: string; resolve?: boolean; noteForAgent?: string; agentAction?: string },
    ): ReplyDraft {
        const review = this.getReview(id);
        const thread = review.threads.find((item) => item.id === threadId);
        if (!thread) throw new Error(tr(`треда ${threadId} нет в этом ревью`, `thread ${threadId} is not in this review`));
        const previous = this.store.getDraft(id, threadId) ?? EMPTY_DRAFT(threadId);
        const body = patch.body !== undefined ? String(patch.body).slice(0, 64 * 1024) : previous.body;
        const resolve = patch.resolve !== undefined ? Boolean(patch.resolve) : previous.resolve;
        const next: ReplyDraft = {
            ...previous,
            body,
            resolve,
            noteForAgent: patch.noteForAgent !== undefined ? String(patch.noteForAgent).slice(0, 8000) : previous.noteForAgent,
            agentAction: ['fix', 'reply', 'revise', 'skip'].includes(String(patch.agentAction))
                ? (patch.agentAction as ReplyDraft['agentAction'])
                : previous.agentAction,
            resolved: thread.resolved,
            updatedAt: this.now().toISOString(),
        };
        next.replied = next.posted.trim() !== '' && next.body.trim() === next.posted.trim();
        if (body !== previous.body || resolve !== previous.resolve) next.error = '';
        this.store.upsertDraft(id, next);
        this.emit(id);
        return next;
    }

    // ---------------------------------------------------------------- reactions

    /** Реакции для набора комментариев; отсутствующие id пропускаются. */
    async reactions(id: string, noteIds: string[]): Promise<Record<string, Reaction[]>> {
        const review = this.getReview(id);
        const known = new Set(review.threads.flatMap((thread) => thread.notes.map((note) => note.id)));
        const requested = [...new Set(noteIds.filter((noteId) => known.has(noteId)))].slice(0, 500);
        if (!requested.length) return {};
        const provider = await this.providerFor(id);
        const result: Record<string, Reaction[]> = {};
        for (const noteId of requested) {
            try {
                result[noteId] = await provider.reactions(noteId);
            } catch {
                // Одна недоступная реакция не должна ломать остальные комментарии.
                result[noteId] = [];
            }
        }
        return result;
    }

    async reactToReview(id: string, emoji: string): Promise<{ active: boolean; reactions: Reaction[] }> {
        if (!(REACTIONS as readonly string[]).includes(emoji)) {
            throw new Error(tr(`неизвестная реакция ${emoji}: ${REACTIONS.join(', ')}`, `unknown reaction ${emoji}: ${REACTIONS.join(', ')}`));
        }
        const provider = await this.providerFor(id);
        const previous = this.store.getReview(id)?.snapshot.reactions ?? [];
        const result = await provider.reactToReview(emoji);
        let reactions = previous;
        try {
            reactions = await provider.reviewReactions();
        } catch {
            // Переключение уже произошло; оставляем прошлый список.
        }
        this.store.audit(id, 'reaction.review', { emoji, active: result.active });
        const stored = this.store.getReview(id);
        if (stored) this.store.saveSnapshot(id, { ...stored.snapshot, reactions });
        this.emit(id);
        return { active: result.active, reactions };
    }

    async react(id: string, noteId: string, emoji: string): Promise<{ active: boolean; reactions: Reaction[] }> {
        if (!(REACTIONS as readonly string[]).includes(emoji)) {
            throw new Error(tr(`неизвестная реакция ${emoji}: ${REACTIONS.join(', ')}`, `unknown reaction ${emoji}: ${REACTIONS.join(', ')}`));
        }
        const review = this.getReview(id);
        const note = review.threads.flatMap((thread) => thread.notes).find((item) => item.id === noteId);
        if (!note) throw new Error(tr(`комментария ${noteId} нет в этом ревью`, `comment ${noteId} is not in this review`));
        const provider = await this.providerFor(id);
        const result = await provider.react(noteId, emoji);
        let reactions: Reaction[] = [];
        try {
            reactions = await provider.reactions(noteId);
        } catch {
            // Переключение уже произошло; список реакций необязателен.
        }
        this.store.audit(id, 'reaction.toggle', { noteId, emoji, active: result.active });
        return { active: result.active, reactions };
    }

    async uploadAttachment(id: string, input: { name: string; contentType: string; data: string }): Promise<UploadedAttachment> {
        const stored = this.store.getReview(id);
        if (!stored) throw new Error(tr(`ревью ${id} не найдено`, `review ${id} not found`));
        const spec = attachmentSpec(String(input.name ?? ''), String(input.contentType ?? ''));
        if (!spec) {
            throw new Error(
                tr(
                    'вложение: разрешены PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, OGV и MOV',
                    'attachment: PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, OGV and MOV are allowed',
                ),
            );
        }
        const provider = await this.providerFor(id);
        if (!provider.capabilities.attachments) {
            throw new Error(
                tr(
                    'платформа не поддерживает загрузку вложений из revdeck: вставьте абсолютную ссылку вручную',
                    'the platform does not support attachments from revdeck: paste an absolute URL manually',
                ),
            );
        }
        const buffer = decodeAttachment(input.data);
        if (!matchesSignature(buffer, spec.contentType)) {
            throw new Error(tr('вложение: содержимое не совпадает с расширением', 'attachment: content does not match the extension'));
        }
        const dir = await mkdtemp(path.join(tmpdir(), 'revdeck-attachment-'));
        const file = path.join(dir, spec.name);
        try {
            await writeFile(file, buffer, { mode: 0o600, flag: 'wx' });
            const uploaded = await provider.upload({ path: file, name: spec.name, contentType: spec.contentType });
            this.store.audit(id, 'attachment.upload', { name: spec.name, contentType: spec.contentType, bytes: buffer.length, url: uploaded.url });
            return uploaded;
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }

    // ---------------------------------------------------------------- comments

    private noteInReview(id: string, noteId: string) {
        const review = this.getReview(id);
        const thread = review.threads.find((item) => item.notes.some((note) => note.id === noteId));
        const note = thread?.notes.find((item) => item.id === noteId);
        return { review, thread: thread ?? null, note: note ?? null };
    }

    async updateComment(id: string, noteId: string, body: string): Promise<void> {
        const { review, note } = this.noteInReview(id, noteId);
        if (!note) throw new Error(tr(`комментария ${noteId} нет в этом ревью`, `comment ${noteId} is not in this review`));
        if (!review.user || note.author !== review.user.username) {
            throw new Error(tr('можно редактировать только свой комментарий', 'only your own comment can be edited'));
        }
        const check = sanitizeBody(body, review.info.ref.platform, { host: review.info.ref.host });
        if (!check.ok) throw new Error(check.reason);
        const provider = await this.providerFor(id);
        await provider.updateNote(noteId, check.text);
        const stored = this.store.getReview(id);
        if (stored) {
            const threads = stored.snapshot.threads.map((thread) => ({
                ...thread,
                notes: thread.notes.map((item) => (item.id === noteId ? { ...item, body: check.text } : item)),
            }));
            this.store.saveSnapshot(id, { ...stored.snapshot, threads });
        }
        this.store.audit(id, 'comment.update', { noteId });
        this.emit(id);
    }

    async deleteComment(id: string, noteId: string): Promise<void> {
        const { review, note } = this.noteInReview(id, noteId);
        if (!note) throw new Error(tr(`комментария ${noteId} нет в этом ревью`, `comment ${noteId} is not in this review`));
        if (!review.user || note.author !== review.user.username) {
            throw new Error(tr('можно удалить только свой комментарий', 'only your own comment can be deleted'));
        }
        const provider = await this.providerFor(id);
        await provider.deleteNote(noteId);
        const stored = this.store.getReview(id);
        if (stored) {
            const threads = stored.snapshot.threads
                .map((thread) => ({ ...thread, notes: thread.notes.filter((item) => item.id !== noteId) }))
                .filter((thread) => thread.notes.length > 0);
            this.store.saveSnapshot(id, { ...stored.snapshot, threads });
        }
        this.store.audit(id, 'comment.delete', { noteId });
        this.emit(id);
    }

    // ---------------------------------------------------------------- notes

    addNote(id: string, input: { file: string; line: number; side?: Side; text: string; toAgent?: boolean }): LineNote {
        const review = this.getReview(id);
        if (!findNewLine(review.diff, input.file, input.line)) {
            throw new Error(tr(`строка ${input.file}:${input.line} не входит в diff`, `line ${input.file}:${input.line} is not in the diff`));
        }
        const timestamp = this.now().toISOString();
        const note: LineNote = {
            id: `u-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
            file: input.file,
            line: input.line,
            side: input.side ?? 'new',
            text: String(input.text ?? '').slice(0, 16_000),
            toAgent: input.toAgent ?? true,
            agentAction: '',
            agentReply: '',
            posted: '',
            discussionId: '',
            noteId: '',
            error: '',
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.store.upsertNote(id, note);
        this.emit(id);
        return note;
    }

    updateNote(
        id: string,
        noteId: string,
        patch: { text?: string; toAgent?: boolean; agentAction?: string; agentReply?: string; posted?: string; discussionId?: string; noteId?: string; error?: string },
    ): LineNote {
        const existing = this.store.listNotes(id).find((note) => note.id === noteId);
        if (!existing) throw new Error(tr(`комментария ${noteId} нет`, `comment ${noteId} not found`));
        const next: LineNote = {
            ...existing,
            text: patch.text !== undefined ? String(patch.text).slice(0, 16_000) : existing.text,
            toAgent: patch.toAgent !== undefined ? Boolean(patch.toAgent) : existing.toAgent,
            agentAction: ['fix', 'reply', ''].includes(String(patch.agentAction)) ? (patch.agentAction as LineNote['agentAction']) : existing.agentAction,
            agentReply: patch.agentReply !== undefined ? String(patch.agentReply).slice(0, 8000) : existing.agentReply,
            posted: patch.posted !== undefined ? String(patch.posted) : existing.posted,
            discussionId: patch.discussionId ?? existing.discussionId,
            noteId: patch.noteId ?? existing.noteId,
            error: patch.error ?? existing.error,
            updatedAt: this.now().toISOString(),
        };
        // Новый текст сбрасывает ответ агента: комментарий должен быть обработан заново.
        if (patch.text !== undefined && patch.text !== existing.text) next.agentReply = patch.agentReply ?? '';
        this.store.upsertNote(id, next);
        this.emit(id);
        return next;
    }

    deleteNote(id: string, noteId: string): void {
        const existing = this.store.listNotes(id).find((note) => note.id === noteId);
        if (!existing) return;
        if (existing.posted) throw new Error(tr('комментарий уже опубликован: удалять его нужно в платформе', 'the comment is already published: delete it in the platform'));
        this.store.deleteNote(id, noteId);
        this.emit(id);
    }

    // ---------------------------------------------------------------- publish

    previewPublish(id: string, kind: PublishKind, ids: string[]): PublishPreview {
        const review = this.getReview(id);
        const items: PublishItem[] = [];
        const warnings: string[] = [];
        const max = this.configOf(id)?.publish?.maxComments ?? 50;
        for (const itemId of ids) {
            if (items.length >= max) {
                warnings.push(tr(`достигнут лимит ${max} комментариев за раз`, `limit of ${max} comments per batch reached`));
                break;
            }
            if (kind === 'reply') {
                const thread = review.threads.find((item) => item.id === itemId);
                const draft = review.drafts.find((item) => item.threadId === itemId);
                if (!thread || !draft) {
                    warnings.push(tr(`тред ${itemId} не найден`, `thread ${itemId} not found`));
                    continue;
                }
                const rawBody = draft.body.trim();
                const body = normalizeMediaLinks(rawBody, review.info.ref.platform, review.info.ref.host, review.info.projectId);
                const posted = normalizeMediaLinks(draft.posted.trim(), review.info.ref.platform, review.info.ref.host, review.info.projectId);
                const alreadyPosted = rawBody !== '' && posted === body;
                const resolveChanged = draft.resolve !== thread.resolved;
                if (!body && !resolveChanged) {
                    warnings.push(tr(`тред ${thread.id.substring(0, 8)}: нечего публиковать`, `thread ${thread.id.substring(0, 8)}: nothing to publish`));
                    continue;
                }
                if (body && alreadyPosted && !resolveChanged) {
                    warnings.push(tr(`тред ${thread.id.substring(0, 8)}: ответ уже опубликован`, `thread ${thread.id.substring(0, 8)}: reply already published`));
                    continue;
                }
                if (body) {
                    const check = sanitizeBody(body, review.info.ref.platform, { host: review.info.ref.host });
                    if (!check.ok) {
                        warnings.push(tr(`тред ${thread.id.substring(0, 8)}: ${check.reason}`, `thread ${thread.id.substring(0, 8)}: ${check.reason}`));
                        continue;
                    }
                }
                items.push({ kind, id: thread.id, body, resolve: draft.resolve });
                continue;
            }
            if (kind === 'finding') {
                const finding = review.findings.find((item) => item.id === itemId);
                if (!finding) {
                    warnings.push(tr(`замечание ${itemId} не найдено`, `finding ${itemId} not found`));
                    continue;
                }
                if (finding.status === 'published') {
                    warnings.push(tr(`замечание ${finding.id} уже опубликовано`, `finding ${finding.id} is already published`));
                    continue;
                }
                const rawBody = normalizeMediaLinks(finding.comment.trim(), review.info.ref.platform, review.info.ref.host, review.info.projectId);
                const body = markedFindingBody(finding, rawBody);
                const check = sanitizeBody(body, review.info.ref.platform, { host: review.info.ref.host });
                if (!check.ok) {
                    warnings.push(tr(`замечание ${finding.id}: ${check.reason}`, `finding ${finding.id}: ${check.reason}`));
                    continue;
                }
                items.push({
                    kind,
                    id: finding.id,
                    body,
                    file: finding.file,
                    line: finding.line,
                    ...(finding.line === null ? {} : { side: 'new' as const }),
                });
                continue;
            }
            const note = review.notes.find((item) => item.id === itemId);
            if (!note) {
                warnings.push(tr(`комментарий ${itemId} не найден`, `comment ${itemId} not found`));
                continue;
            }
            if (note.posted) {
                warnings.push(tr(`комментарий ${note.id} уже опубликован`, `comment ${note.id} is already published`));
                continue;
            }
            const body = normalizeMediaLinks(note.text, review.info.ref.platform, review.info.ref.host, review.info.projectId);
            const check = sanitizeBody(body, review.info.ref.platform, { host: review.info.ref.host });
            if (!check.ok) {
                warnings.push(tr(`комментарий ${note.id}: ${check.reason}`, `comment ${note.id}: ${check.reason}`));
                continue;
            }
            items.push({ kind, id: note.id, body, file: note.file, line: note.line, side: note.side });
        }
        return { plan: this.makePlan(id, kind, items), warnings };
    }

    private makePlan(id: string, kind: PublishKind, items: PublishItem[]): PublishPlan {
        const hash = canonicalHash(id, kind, items);
        return { reviewId: id, kind, items, hash, createdAt: this.now().toISOString() };
    }

    approve(id: string, kind: PublishKind, ids: string[], expectedHash: string): Approval {
        const preview = this.previewPublish(id, kind, ids);
        if (preview.plan.hash !== expectedHash) {
            throw new Error(tr('набор изменений изменился после подтверждения: обновите страницу и подтвердите заново', 'the plan changed after confirmation: refresh and confirm again'));
        }
        if (!preview.plan.items.length) throw new Error(tr('нечего публиковать: в выбранных элементах нет изменений', 'nothing to publish: the selected items have no changes'));
        const approval: Approval = {
            id: randomBytes(16).toString('hex'),
            reviewId: id,
            hash: preview.plan.hash,
            kind,
            expiresAt: new Date(this.now().getTime() + APPROVAL_TTL_MS).toISOString(),
            usedAt: null,
            createdAt: this.now().toISOString(),
        };
        this.store.createApproval({
            id: approval.id,
            reviewId: id,
            kind,
            hash: approval.hash,
            items: preview.plan.items,
            expiresAt: approval.expiresAt,
            usedAt: null,
            createdAt: approval.createdAt,
        });
        this.store.audit(id, 'publish.approve', { approvalId: approval.id, kind, count: preview.plan.items.length });
        return approval;
    }

    async publish(id: string, approvalId: string): Promise<PublishResult> {
        const approval = this.store.getApproval(approvalId);
        if (!approval) throw new Error(tr('подтверждение не найдено', 'approval not found'));
        if (approval.reviewId !== id) throw new Error(tr('подтверждение выдано для другого ревью', 'the approval belongs to another review'));
        if (approval.usedAt) throw new Error(tr('подтверждение уже использовано', 'the approval has already been used'));
        if (new Date(approval.expiresAt).getTime() < this.now().getTime()) throw new Error(tr('подтверждение истекло', 'the approval has expired'));
        this.store.markApprovalUsed(approvalId);

        const stored = this.store.getReview(id);
        if (!stored) throw new Error(tr(`ревью ${id} не найдено`, `review ${id} not found`));
        const provider = await this.providerFactory(
            { platform: stored.row.platform as Platform, host: stored.row.host, project: stored.row.project, number: stored.row.number },
            stored.row.root,
        );
        const review = this.getReview(id);
        const platform = review.info.ref.platform;
        const results: PublishResultItem[] = [];
        const startedAt = this.now().toISOString();

        for (const item of approval.items as PublishItem[]) {
            const result: PublishResultItem = { kind: item.kind, id: item.id, ok: false };
            results.push(result);
            try {
                if (item.kind === 'reply') {
                    const thread = review.threads.find((entry) => entry.id === item.id);
                    const draft = this.store.getDraft(id, item.id) ?? EMPTY_DRAFT(item.id);
                    if (!thread) throw new Error(tr('тред больше не существует', 'the thread no longer exists'));
                    const body = String(item.body ?? '').trim();
                    if (body && draft.posted.trim() !== body) {
                        const check = sanitizeBody(body, platform, { host: review.info.ref.host });
                        if (!check.ok) throw new Error(check.reason);
                        await provider.reply(thread, body);
                        draft.posted = body;
                        draft.replied = true;
                        result.ok = true;
                    }
                    if (typeof item.resolve === 'boolean' && item.resolve !== thread.resolved) {
                        await provider.resolve(thread.id, item.resolve);
                        draft.resolved = item.resolve;
                        thread.resolved = item.resolve;
                        result.ok = true;
                    }
                    draft.error = '';
                    draft.updatedAt = this.now().toISOString();
                    this.store.upsertDraft(id, draft);
                    this.saveThreads(id, review.threads);
                    result.discussionId = thread.id;
                    continue;
                }
                if (item.kind === 'finding') {
                    const finding = review.findings.find((entry) => entry.id === item.id);
                    if (!finding) throw new Error(tr('замечание не найдено', 'finding not found'));
                    if (finding.status === 'published') {
                        result.ok = true;
                        result.skipped = true;
                        result.discussionId = finding.discussionId ?? undefined;
                        continue;
                    }
                    const body = String(item.body ?? '').trim();
                    const position = finding.line !== null ? linePosition(review.diff, finding.file, finding.line) : null;
                    if (finding.line !== null && !position) throw new Error(tr(`строка ${finding.file}:${finding.line} не входит в diff`, `line ${finding.file}:${finding.line} is not in the diff`));
                    const created = await provider.createThread({
                        file: finding.file,
                        line: finding.line,
                        oldLine: position?.oldLine ?? null,
                        body,
                    });
                    finding.status = 'published';
                    finding.discussionId = created.discussionId;
                    finding.publishedAt = this.now().toISOString();
                    this.store.updateFinding(id, finding);
                    result.ok = true;
                    result.discussionId = created.discussionId;
                    result.noteId = created.noteId;
                    continue;
                }
                const note = review.notes.find((entry) => entry.id === item.id);
                if (!note) throw new Error(tr('комментарий не найден', 'comment not found'));
                if (note.posted) {
                    result.ok = true;
                    result.skipped = true;
                    continue;
                }
                const position = linePosition(review.diff, note.file, note.line);
                if (!position) throw new Error(tr(`строка ${note.file}:${note.line} не входит в diff`, `line ${note.file}:${note.line} is not in the diff`));
                const created = await provider.createThread({
                    file: note.file,
                    line: note.line,
                    oldLine: position.oldLine,
                    body: String(item.body ?? '').trim(),
                });
                note.posted = String(item.body ?? '').trim();
                note.discussionId = created.discussionId;
                note.noteId = created.noteId;
                note.updatedAt = this.now().toISOString();
                this.store.upsertNote(id, note);
                result.ok = true;
                result.discussionId = created.discussionId;
                result.noteId = created.noteId;
            } catch (error) {
                result.error = redact(messageOf(error));
                this.recordPublishError(id, item, result.error);
            }
        }

        const finishedAt = this.now().toISOString();
        this.store.audit(id, 'publish.commit', {
            approvalId,
            kind: approval.kind,
            ok: results.filter((item) => item.ok).length,
            failed: results.filter((item) => !item.ok).length,
        });
        this.emit(id);
        // Свежие треды и статусы подтянутся следующим обновлением; UI уже видит posted.
        return { reviewId: id, results, startedAt, finishedAt };
    }

    private recordPublishError(id: string, item: PublishItem, error: string): void {
        if (item.kind === 'reply') {
            const draft = this.store.getDraft(id, item.id);
            if (draft) this.store.upsertDraft(id, { ...draft, error, updatedAt: this.now().toISOString() });
            return;
        }
        if (item.kind === 'finding') {
            const finding = this.store.listFindings(id).find((entry) => entry.id === item.id);
            if (finding) this.store.updateFinding(id, { ...finding, publishError: error });
            return;
        }
        const note = this.store.listNotes(id).find((entry) => entry.id === item.id);
        if (note) this.store.upsertNote(id, { ...note, error, updatedAt: this.now().toISOString() });
    }

    private saveThreads(id: string, threads: Thread[]): void {
        const stored = this.store.getReview(id);
        if (!stored) return;
        this.store.saveSnapshot(id, { ...stored.snapshot, threads });
    }

    // ---------------------------------------------------------------- rules & checks

    async rules(id: string): Promise<{
        markdown: string;
        configPath: string | null;
        warnings: string[];
        checks: CommandCheck[];
        language: Locale;
        maxBytes: number;
        agents: number;
        roles: ReviewRoleId[];
    }> {
        const stored = this.store.getReview(id);
        if (!stored) throw new Error(tr(`ревью ${id} не найдено`, `review ${id} not found`));
        const info = this.store.info(id);
        const texts = [
            info?.title ?? '',
            info?.description ?? '',
            ...stored.snapshot.threads.flatMap((thread) => thread.notes.map((note) => note.body)),
        ];
        let config = stored.snapshot.config;
        let configPath = stored.snapshot.configPath;
        if (!config?.rules) {
            // Снимок мог быть сделан старой версией без output/rules — перечитываем конфиг.
            const loaded = await loadConfig(stored.row.root);
            config = loaded.config;
            configPath = loaded.path;
        }
        const language = resolveOutputLanguage(config.output?.language ?? 'auto', texts);
        const effective = await buildEffectiveRules({
            root: stored.row.root,
            config,
            configPath,
            files: changedPaths(stored.snapshot.diff),
            language,
        });
        const maxBytes = config.rules.maxTotalBytes ?? 0;
        return {
            markdown: renderRules(effective, { language, maxBytes }),
            configPath: effective.configPath,
            warnings: effective.warnings,
            checks: effective.checks,
            language,
            maxBytes,
            agents: config.review?.agents ?? 3,
            roles: (config.review?.roles ?? DEFAULT_REVIEW_ROLES) as ReviewRoleId[],
        };
    }

    async runChecks(id: string, options: { allowRun: boolean; ids?: string[] }): Promise<CheckResult[]> {
        const stored = this.store.getReview(id);
        if (!stored) throw new Error(tr(`ревью ${id} не найдено`, `review ${id} not found`));
        const { checks } = await this.rules(id);
        const matched = checks.filter((check) => check.matched && (!options.ids?.length || options.ids.includes(check.id)));
        const results: CheckResult[] = [];
        for (const check of matched) {
            if (!options.allowRun) {
                results.push({
                    id: check.id,
                    name: check.name,
                    argv: check.argv,
                    status: 'skipped',
                    output: tr('запуск не подтверждён: используйте revdeck checks --run --yes', 'run not confirmed: use revdeck checks --run --yes'),
                    durationMs: 0,
                });
                continue;
            }
            const started = Date.now();
            try {
                const { stdout, stderr, code } = await this.runImpl(check.argv[0]!, check.argv.slice(1), {
                    cwd: stored.row.root,
                    timeoutMs: stored.snapshot.config.checks?.find((item) => item.id === check.id)?.timeoutMs ?? 300_000,
                    maxBuffer: 16 * 1024 * 1024,
                });
                results.push({
                    id: check.id,
                    name: check.name,
                    argv: check.argv,
                    status: code === 0 ? 'passed' : 'failed',
                    output: redact(`${stdout}\n${stderr}`.trim()).slice(0, 20_000),
                    durationMs: Date.now() - started,
                });
            } catch (error) {
                results.push({
                    id: check.id,
                    name: check.name,
                    argv: check.argv,
                    status: 'error',
                    output: redact(messageOf(error)).slice(0, 20_000),
                    durationMs: Date.now() - started,
                });
            }
        }
        this.store.audit(id, 'checks.run', { count: results.length });
        return results;
    }

    // ---------------------------------------------------------------- sync

    startSync(): void {
        if (this.timer || this.syncIntervalMs <= 0) return;
        this.timer = setInterval(() => {
            void this.syncAll();
        }, this.syncIntervalMs);
        this.timer.unref?.();
    }

    async syncAll(): Promise<void> {
        if (this.syncing) return;
        this.syncing = true;
        try {
            const reviews = this.store.listReviews();
            for (let index = 0; index < reviews.length; index += 2) {
                const chunk = reviews.slice(index, index + 2);
                await Promise.allSettled(
                    chunk.map(async (item) => {
                        const age = this.now().getTime() - new Date(item.syncedAt).getTime();
                        if (age < this.syncIntervalMs / 2) return;
                        try {
                            await this.refreshReview(item.id);
                        } catch {
                            // Фоновое обновление не должно останавливать остальные ревью.
                        }
                    }),
                );
            }
        } finally {
            this.syncing = false;
        }
    }

    // ---------------------------------------------------------------- helpers

    private emit(id: string): void {
        this.events.emit('review', { reviewId: id, at: this.now().toISOString() });
    }

    private requireReview(id: string): void {
        if (!this.store.getReview(id)) throw new Error(`ревью ${id} не найдено`);
    }

    changedFiles(id: string): string[] {
        const stored = this.store.getReview(id);
        return stored ? changedPaths(stored.snapshot.diff) : [];
    }

    diffFor(id: string): DiffFile[] {
        return this.store.getReview(id)?.snapshot.diff ?? [];
    }

    threadSnippet(id: string, file: string, line: number | null): ReturnType<typeof snippetAround> {
        if (line === null) return null;
        return snippetAround(this.diffFor(id), file, line, 4);
    }

    configOf(id: string): ReviewConfig | null {
        return this.store.getReview(id)?.snapshot.config ?? null;
    }

    rootOf(id: string): string | null {
        return this.store.getReview(id)?.row.root ?? null;
    }
}

export function canonicalHash(reviewId: string, kind: PublishKind, items: PublishItem[]): string {
    return createHash('sha256').update(canonicalJson({ reviewId, kind, items })).digest('hex');
}

function fallbackInfo(row: {
    platform: string;
    host: string;
    project: string;
    number: number;
    title: string;
    author: string;
    state: string;
    web_url: string;
    updated_at: string;
}): ReviewInfo {
    return {
        ref: { platform: row.platform as Platform, host: row.host, project: row.project, number: row.number },
        title: row.title,
        description: '',
        author: row.author,
        authorName: '',
        state: row.state,
        draft: false,
        sourceBranch: '',
        targetBranch: '',
        webUrl: row.web_url,
        commit: { base: '', start: '', head: '' },
        updatedAt: row.updated_at,
        stats: { files: 0, additions: 0, deletions: 0 },
    };
}
