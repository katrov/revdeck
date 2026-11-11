import { createHash } from 'node:crypto';
import { LEVELS, type Level, type Platform, type ReviewRef } from './types.js';

/** Стабильный идентификатор ревью: платформа, хост, проект и номер. */
export function reviewId(ref: ReviewRef): string {
    return `${ref.platform}:${ref.host}/${ref.project}!${ref.number}`;
}

export function parseReviewId(id: string): ReviewRef {
    const match = /^(gitlab|github):([^/]+)\/(.+)!(\d+)$/.exec(id);
    if (!match) throw new Error(`invalid review id: ${id}`);
    return {
        platform: match[1] as Platform,
        host: match[2]!,
        project: match[3]!,
        number: Number(match[4]),
    };
}

/** Каноническая ссылка на ревью. */
export function webUrl(ref: ReviewRef): string {
    const scheme = ref.host.startsWith('localhost') || ref.host.startsWith('127.') ? 'http' : 'https';
    const base = `${scheme}://${ref.host}/${ref.project}`;
    return ref.platform === 'gitlab' ? `${base}/-/merge_requests/${ref.number}` : `${base}/pull/${ref.number}`;
}

const GITLAB_URL = /^(?:https?:\/\/)?([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)(?:[/?#].*)?$/;
const GITHUB_URL = /^(?:https?:\/\/)?([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/**
 * Разбирает ссылку на MR/PR. Понимает полные URL, URL без схемы и `owner/repo#42`
 * (для GitHub) / `group/project!42` (для GitLab).
 */
export function parseReviewUrl(input: string): ReviewRef {
    const value = input.trim();
    const gitlab = GITLAB_URL.exec(value);
    if (gitlab) {
        return { platform: 'gitlab', host: gitlab[1]!, project: gitlab[2]!, number: Number(gitlab[3]) };
    }
    const github = GITHUB_URL.exec(value);
    if (github) {
        return { platform: 'github', host: github[1]!, project: github[2]!, number: Number(github[3]) };
    }
    const short = /^(.+?)([#!])(\d+)$/.exec(value);
    if (short) {
        return {
            platform: short[2] === '!' ? 'gitlab' : 'github',
            host: short[2] === '!' ? 'gitlab.com' : 'github.com',
            project: short[1]!,
            number: Number(short[3]),
        };
    }
    throw new Error(
        'could not parse the MR/PR reference: expected https://<host>/<project>/-/merge_requests/<N> ' +
            'or https://<host>/<owner>/<repo>/pull/<N>, or project!N / owner/repo#N',
    );
}

export function isLevel(value: unknown): value is Level {
    return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

export function normalizeLevel(value: unknown): Level {
    return isLevel(value) ? value : 'question';
}

/** Идентификатор замечания: производный от fingerprint, но короче и читаемый. */
export function findingId(fingerprint: string, taken: ReadonlySet<string> = new Set()): string {
    for (let length = 8; length <= fingerprint.length; length += 2) {
        const candidate = `f-${fingerprint.slice(0, length)}`;
        if (!taken.has(candidate)) return candidate;
    }
    return `f-${fingerprint}`;
}
