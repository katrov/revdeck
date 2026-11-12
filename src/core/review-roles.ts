import type { Locale } from './locale.js';

/** Набор ролей, на которые можно разложить ревью. */
export const REVIEW_ROLE_IDS = [
    'correctness',
    'architecture',
    'tests',
    'security',
    'performance',
    'compatibility',
    'docs',
    'concurrency',
    'ux',
    'general',
] as const;

export type ReviewRoleId = (typeof REVIEW_ROLE_IDS)[number];

export const DEFAULT_REVIEW_ROLES: ReviewRoleId[] = ['correctness', 'architecture', 'tests'];

export interface ReviewRole {
    /** Номера разделов Criteria.md, на которые опирается роль. */
    criteria: string[];
    focus: { ru: string; en: string };
}

export const REVIEW_ROLES: Record<ReviewRoleId, ReviewRole> = {
    correctness: {
        criteria: ['6', '10'],
        focus: {
            ru: 'логика, граничные случаи, ошибки, null/undefined, async и состояние',
            en: 'logic, edge cases, errors, null/undefined, async and state',
        },
    },
    architecture: {
        criteria: ['3', '4', '5', '7'],
        focus: {
            ru: 'слои и зависимости, ответственность, связность, прецеденты и ADR',
            en: 'layers and dependencies, responsibility, coupling, precedents and ADRs',
        },
    },
    tests: {
        criteria: ['8'],
        focus: {
            ru: 'покрытие, assertions, отсутствующие сценарии и нестабильные тесты',
            en: 'coverage, assertions, missing scenarios and flaky tests',
        },
    },
    security: {
        criteria: ['10'],
        focus: {
            ru: 'авторизация, валидация ввода, секреты, инъекции, shell и опасные права',
            en: 'authorization, input validation, secrets, injections, shell and dangerous permissions',
        },
    },
    performance: {
        criteria: ['10'],
        focus: {
            ru: 'сложность, N+1, лишние аллокации, кеширование и блокирующие операции',
            en: 'complexity, N+1, extra allocations, caching and blocking operations',
        },
    },
    compatibility: {
        criteria: ['6', '7'],
        focus: {
            ru: 'публичный API, обратная совместимость, миграции и изменения конфигов',
            en: 'public API, backward compatibility, migrations and config changes',
        },
    },
    docs: {
        criteria: ['9'],
        focus: {
            ru: 'документация, конфиги, CHANGELOG и согласованность AI-инструкций',
            en: 'documentation, configs, CHANGELOG and consistency of AI instructions',
        },
    },
    concurrency: {
        criteria: ['10'],
        focus: {
            ru: 'гонки, блокировки, идемпотентность, retries и отмена операций',
            en: 'races, locks, idempotency, retries and cancellation',
        },
    },
    ux: {
        criteria: ['9', '10'],
        focus: {
            ru: 'состояния UI, доступность, ошибки и поведение на узких экранах',
            en: 'UI states, accessibility, errors and narrow-screen behavior',
        },
    },
    general: {
        criteria: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
        focus: {
            ru: 'полное ревью по всем разделам Criteria.md',
            en: 'full review across all Criteria.md sections',
        },
    },
};

export function reviewRoleTitle(id: ReviewRoleId, language: Locale): string {
    const titles: Record<ReviewRoleId, { ru: string; en: string }> = {
        correctness: { ru: 'Корректность', en: 'Correctness' },
        architecture: { ru: 'Архитектура', en: 'Architecture' },
        tests: { ru: 'Тесты', en: 'Tests' },
        security: { ru: 'Безопасность', en: 'Security' },
        performance: { ru: 'Производительность', en: 'Performance' },
        compatibility: { ru: 'Совместимость', en: 'Compatibility' },
        docs: { ru: 'Документация', en: 'Documentation' },
        concurrency: { ru: 'Конкурентность', en: 'Concurrency' },
        ux: { ru: 'UX и доступность', en: 'UX and accessibility' },
        general: { ru: 'Общее ревью', en: 'General review' },
    };
    return titles[id][language];
}

export function reviewRoleFocus(id: ReviewRoleId, language: Locale): string {
    return REVIEW_ROLES[id].focus[language];
}

/** Роли для фактического числа агентов: короче — циклически повторяются. */
export function effectiveReviewRoles(agents: number, roles: ReviewRoleId[]): ReviewRoleId[] {
    const base = roles.length ? roles : DEFAULT_REVIEW_ROLES;
    return Array.from({ length: agents }, (_, index) => base[index % base.length]!);
}
