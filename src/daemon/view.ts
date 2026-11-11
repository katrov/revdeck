import { diffStats, snippetAround, type SnippetLine } from '../core/diff.js';
import type { DiffFile, Finding, Review, ReviewSummary, Thread } from '../core/types.js';

export interface ReviewFileSummary {
    path: string;
    oldPath: string;
    status: DiffFile['status'];
    binary: boolean;
    additions: number;
    deletions: number;
}

export interface ReviewThreadView extends Thread {
    snippet: SnippetLine[] | null;
}

export interface ReviewFindingView extends Finding {
    snippet: SnippetLine[] | null;
}

/** Ответ API/UI: без полного diff (он запрашивается по файлу), со сниппетами. */
export interface ReviewView extends Omit<Review, 'diff' | 'threads' | 'findings'> {
    files: ReviewFileSummary[];
    threads: ReviewThreadView[];
    findings: ReviewFindingView[];
    stale: boolean;
    stats: { files: number; additions: number; deletions: number };
}

export const STALE_AFTER_MS = 90_000;

export function fileSummaries(diff: DiffFile[]): ReviewFileSummary[] {
    return diff.map((file) => {
        let additions = 0;
        let deletions = 0;
        for (const hunk of file.hunks) {
            for (const line of hunk.lines) {
                if (line.kind === '+') additions++;
                else if (line.kind === '-') deletions++;
            }
        }
        return { path: file.path, oldPath: file.oldPath, status: file.status, binary: file.binary, additions, deletions };
    });
}

export function toReviewView(review: Review, now = Date.now()): ReviewView {
    const { diff, threads, findings, ...rest } = review;
    return {
        ...rest,
        threads: threads.map((thread) => ({
            ...thread,
            snippet: thread.path && thread.line ? snippetAround(diff, thread.path, thread.line, 4) : null,
        })),
        findings: findings.map((finding) => ({
            ...finding,
            snippet: finding.file && finding.line ? snippetAround(diff, finding.file, finding.line, 4) : null,
        })),
        files: fileSummaries(diff),
        stats: diffStats(diff),
        stale: now - new Date(review.syncedAt).getTime() > STALE_AFTER_MS,
    };
}

export function summaryOf(review: Review): ReviewSummary | null {
    return review.summary;
}
