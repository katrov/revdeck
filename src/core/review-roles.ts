import type { Locale } from './locale.js';

/** Встроенные роли; id используется в `.revdeck.yml`. */
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
    'data',
    'api',
    'dependencies',
    'observability',
    'build',
    'privacy',
    'general',
] as const;

export type BuiltinReviewRoleId = (typeof REVIEW_ROLE_IDS)[number];

export const DEFAULT_REVIEW_ROLES: string[] = ['correctness', 'architecture', 'tests'];

export interface ReviewRole {
    /** Номера разделов Criteria.md, на которые опирается роль. */
    criteria: string[];
    title: { ru: string; en: string };
    focus: { ru: string; en: string };
}

export interface ResolvedReviewRole {
    id: string;
    title: string;
    description: string;
    criteria: string[];
    instructions: string;
}

export const REVIEW_ROLES: Record<BuiltinReviewRoleId, ReviewRole> = {
    correctness: {
        criteria: ['6', '10'],
        title: { ru: 'Корректность', en: 'Correctness' },
        focus: { ru: 'логика, граничные случаи, ошибки, null/undefined, async и состояние', en: 'logic, edge cases, errors, null/undefined, async and state' },
    },
    architecture: {
        criteria: ['3', '4', '5', '7'],
        title: { ru: 'Архитектура', en: 'Architecture' },
        focus: { ru: 'слои и зависимости, ответственность, связность, прецеденты и ADR', en: 'layers and dependencies, responsibility, coupling, precedents and ADRs' },
    },
    tests: {
        criteria: ['8'],
        title: { ru: 'Тесты', en: 'Tests' },
        focus: { ru: 'покрытие, assertions, отсутствующие сценарии и нестабильные тесты', en: 'coverage, assertions, missing scenarios and flaky tests' },
    },
    security: {
        criteria: ['10'],
        title: { ru: 'Безопасность', en: 'Security' },
        focus: { ru: 'авторизация, валидация ввода, секреты, инъекции, shell и опасные права', en: 'authorization, input validation, secrets, injections, shell and dangerous permissions' },
    },
    performance: {
        criteria: ['10'],
        title: { ru: 'Производительность', en: 'Performance' },
        focus: { ru: 'сложность, N+1, лишние аллокации, кеширование и блокирующие операции', en: 'complexity, N+1, extra allocations, caching and blocking operations' },
    },
    compatibility: {
        criteria: ['6', '7'],
        title: { ru: 'Совместимость', en: 'Compatibility' },
        focus: { ru: 'публичный API, обратная совместимость, миграции и изменения конфигов', en: 'public API, backward compatibility, migrations and config changes' },
    },
    docs: {
        criteria: ['9'],
        title: { ru: 'Документация', en: 'Documentation' },
        focus: { ru: 'документация, конфиги, CHANGELOG и согласованность AI-инструкций', en: 'documentation, configs, CHANGELOG and consistency of AI instructions' },
    },
    concurrency: {
        criteria: ['10'],
        title: { ru: 'Конкурентность', en: 'Concurrency' },
        focus: { ru: 'гонки, блокировки, идемпотентность, retries и отмена операций', en: 'races, locks, idempotency, retries and cancellation' },
    },
    ux: {
        criteria: ['9', '10'],
        title: { ru: 'UX и доступность', en: 'UX and accessibility' },
        focus: { ru: 'состояния UI, доступность, ошибки и поведение на узких экранах', en: 'UI states, accessibility, errors and narrow-screen behavior' },
    },
    data: {
        criteria: ['3', '10'],
        title: { ru: 'Данные и миграции', en: 'Data and migrations' },
        focus: { ru: 'схемы, миграции, хранение, обратная совместимость данных', en: 'schemas, migrations, storage and data backward compatibility' },
    },
    api: {
        criteria: ['6', '7'],
        title: { ru: 'Публичный API', en: 'Public API' },
        focus: { ru: 'контракты, версионирование API, обработка ошибок и совместимость клиентов', en: 'contracts, API versioning, error handling and client compatibility' },
    },
    dependencies: {
        criteria: ['3', '10'],
        title: { ru: 'Зависимости', en: 'Dependencies' },
        focus: { ru: 'версии, лицензии, supply chain и лишние зависимости', en: 'versions, licenses, supply chain and unnecessary dependencies' },
    },
    observability: {
        criteria: ['9', '10'],
        title: { ru: 'Наблюдаемость', en: 'Observability' },
        focus: { ru: 'логи, метрики, трейсы, ошибки и отсутствие диагностики', en: 'logs, metrics, traces, errors and missing diagnostics' },
    },
    build: {
        criteria: ['8', '9'],
        title: { ru: 'Сборка и CI', en: 'Build and CI' },
        focus: { ru: 'CI, сборка, упаковка, кеши и воспроизводимость', en: 'CI, builds, packaging, caches and reproducibility' },
    },
    privacy: {
        criteria: ['9', '10'],
        title: { ru: 'Приватность', en: 'Privacy' },
        focus: { ru: 'PII, хранение персональных данных, логи и утечки', en: 'PII, personal data storage, logs and leaks' },
    },
    general: {
        criteria: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
        title: { ru: 'Общее ревью', en: 'General review' },
        focus: { ru: 'полное ревью по всем разделам Criteria.md', en: 'full review across all Criteria.md sections' },
    },
};

/** Роли для фактического числа агентов: короткий список циклически повторяется. */
export function effectiveRoleIds(agents: number, roles: string[]): string[] {
    const base = roles.length ? roles : DEFAULT_REVIEW_ROLES;
    return Array.from({ length: agents }, (_, index) => base[index % base.length]!);
}

export function resolveReviewRole(
    id: string,
    language: Locale,
    custom: Record<string, { title: string; description: string; criteria: string[]; focus?: string; instructions?: string }> = {},
): ResolvedReviewRole | null {
    if (id in REVIEW_ROLES) {
        const role = REVIEW_ROLES[id as BuiltinReviewRoleId];
        return {
            id,
            title: role.title[language],
            description: role.focus[language],
            criteria: role.criteria,
            instructions: '',
        };
    }
    const role = custom[id];
    if (!role) return null;
    return {
        id,
        title: role.title,
        description: role.description,
        criteria: role.criteria,
        instructions: role.instructions ?? '',
    };
}

export function roleCriteriaText(role: ResolvedReviewRole): string {
    return role.criteria.length ? `§${role.criteria.join(', §')}` : '';
}
