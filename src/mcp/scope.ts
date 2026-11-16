import { loadConfig } from '../core/config.js';
import { findRepoRoot } from '../core/paths.js';
import { projectKey, projectTitle, type ProjectRef } from '../core/projects.js';
import { reviewId as makeReviewId } from '../core/refs.js';
import { parseReviewId, parseReviewUrl } from '../core/refs.js';
import { tr } from '../core/locale.js';
import type { ReviewRef } from '../core/types.js';
import { projectContext } from '../providers/provider.js';

export interface McpFeatureScope {
    id: string;
    title: string;
    reviewIds: string[];
}

export interface McpScope extends ProjectRef {
    root: string;
    key: string;
    title: string;
    /** Если задан REVDECK_FEATURE, сессия ограничена участниками фичи. */
    feature?: McpFeatureScope;
}

/** Проект MCP-сессии: определяется по рабочей копии, в которой запущен сервер. */
export async function resolveScope(rootInput: string): Promise<McpScope> {
    const root = findRepoRoot(rootInput);
    const loaded = await loadConfig(root);
    const context = await projectContext(root, loaded.config);
    return {
        root,
        ...context,
        key: projectKey(context),
        title: projectTitle(context.project),
    };
}

/**
 * Ссылка на ревью из аргумента инструмента. Число не содержит проекта и
 * разрешается демоном через root текущей сессии, поэтому здесь возвращается null.
 */
export function reviewRefFromInput(input: string): ReviewRef | null {
    const value = input.trim();
    if (!value || /^\d+$/.test(value)) return null;
    if (/^(gitlab|github):/.test(value)) {
        try {
            return parseReviewId(value);
        } catch {
            return null;
        }
    }
    if (value.includes('/') || /[#!]\d+$/.test(value)) {
        try {
            return parseReviewUrl(value);
        } catch {
            return null;
        }
    }
    return null;
}

export function featureReviewId(ref: ReviewRef, scope: McpScope): string | null {
    if (!scope.feature) return null;
    for (const id of scope.feature.reviewIds) {
        try {
            const member = parseReviewId(id);
            if (projectKey(member) === projectKey(ref) && member.number === ref.number) return id;
        } catch {
            // Некорректный id в фиче не должен ломать остальные проверки.
        }
    }
    return null;
}

export function assertReviewInScope(review: string, scope: McpScope): void {
    const ref = reviewRefFromInput(review);
    if (scope.feature) {
        if (!ref) {
            const error = new Error(
                tr(
                    'в сессии фичи укажите полный id или ссылку на ревью, а не номер',
                    'in a feature session pass a full review id or URL, not a number',
                ),
            ) as Error & { hint?: string };
            error.hint = tr(
                'Используйте id из revdeck_feature или revdeck_status.',
                'Use an id from revdeck_feature or revdeck_status.',
            );
            throw error;
        }
        const id = featureReviewId(ref, scope) ?? makeReviewId(ref);
        if (featureReviewId(ref, scope)) return;
        const error = new Error(
            tr(
                `ревью ${id} не входит в фичу ${scope.feature.id}`,
                `review ${id} is not a member of feature ${scope.feature.id}`,
            ),
        ) as Error & { hint?: string };
        error.hint = tr(
            'Фича ограничена только своими ревью. Добавьте ревью в фичу в UI или CLI.',
            'A feature session is limited to its reviews. Add the review in the UI or CLI.',
        );
        throw error;
    }
    if (!ref) return;
    if (projectKey(ref) === scope.key) return;
    const error = new Error(
        tr(
            `ревью ${ref.project}#${ref.number} относится к проекту ${projectKey(ref)}, а эта сессия ограничена проектом ${scope.key}`,
            `review ${ref.project}#${ref.number} belongs to project ${projectKey(ref)}, but this session is scoped to ${scope.key}`,
        ),
    ) as Error & { hint?: string };
    error.hint = tr(
        'Откройте отдельную сессию в репозитории этого проекта. Кросс-проектный доступ появится только через явную фичу.',
        'Open a separate session in that repository. Cross-project access will only be available through an explicit feature.',
    );
    throw error;
}
