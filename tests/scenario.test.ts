import { describe, expect, it } from 'vitest';
import { isOwnReview, isReviewScenario, scenarioLabel, suggestedScenario } from '../src/core/scenario.js';

const own = { info: { author: 'alice' }, user: { username: 'alice', name: 'Alice' } };
const foreign = { info: { author: 'bob' }, user: { username: 'alice', name: 'Alice' } };
const unknown = { info: { author: 'bob' }, user: null };

describe('review scenario', () => {
    it('detects the own MR', () => {
        expect(isOwnReview(own)).toBe(true);
        expect(isOwnReview(foreign)).toBe(false);
        expect(isOwnReview(unknown)).toBeNull();
    });

    it('suggests the scenario from the author', () => {
        expect(suggestedScenario(own)).toBe('feedback');
        expect(suggestedScenario(foreign)).toBe('review');
        expect(suggestedScenario(unknown)).toBeNull();
    });

    it('validates scenario values', () => {
        expect(isReviewScenario('review')).toBe(true);
        expect(isReviewScenario('feedback')).toBe(true);
        expect(isReviewScenario('auto')).toBe(false);
        expect(isReviewScenario(undefined)).toBe(false);
    });

    it('localizes the scenario label', () => {
        expect(scenarioLabel('review', 'ru')).toBe('ревью чужого MR');
        expect(scenarioLabel('feedback', 'ru')).toBe('замечания к своему MR');
        expect(scenarioLabel('feedback', 'en')).toBe('feedback on your own MR');
    });
});
