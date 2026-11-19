import type { Locale } from './locale.js';

/**
 * Сценарий работы с ревью. Это свойство вызова, а не самого MR: один и тот же
 * MR можно ревьюить или разбирать замечания к нему.
 */
export const REVIEW_SCENARIOS = ['review', 'feedback'] as const;

export type ReviewScenario = (typeof REVIEW_SCENARIOS)[number];

/** Минимум, который нужен, чтобы понять, чей это MR. */
export interface ScenarioReview {
    info: { author: string };
    user: { username: string } | null;
}

export function isReviewScenario(value: unknown): value is ReviewScenario {
    return typeof value === 'string' && (REVIEW_SCENARIOS as readonly string[]).includes(value);
}

/**
 * true — автор MR и текущий пользователь платформы совпали, false — разные,
 * null — текущий пользователь неизвестен (например, glab/gh не авторизован).
 */
export function isOwnReview(review: ScenarioReview): boolean | null {
    const username = review.user?.username;
    if (!username) return null;
    return username === review.info.author;
}

/** Сценарий по автору MR; null, если текущего пользователя определить нельзя. */
export function suggestedScenario(review: ScenarioReview): ReviewScenario | null {
    const own = isOwnReview(review);
    return own === null ? null : own ? 'feedback' : 'review';
}

export function scenarioLabel(scenario: ReviewScenario, language: Locale): string {
    if (scenario === 'feedback') {
        return language === 'ru' ? 'замечания к своему MR' : 'feedback on your own MR';
    }
    return language === 'ru' ? 'ревью чужого MR' : "reviewing someone else's MR";
}
