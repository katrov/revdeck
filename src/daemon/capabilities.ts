/**
 * Права RPC-клиента. Граница проводится по транспорту, а не по MCP-инструментам:
 * мостовой сокет devcontainer получает только агентские методы, основной сокет и
 * UI-сессия — человеческие.
 */
export type Capability = 'read' | 'draft' | 'publish' | 'checks' | 'admin';

export interface RpcPolicy {
    readonly name: 'human' | 'agent';
    readonly capabilities: ReadonlySet<Capability>;
    allows(method: string): boolean;
}

/**
 * Методы, которые агенту разрешены. Публикация, проверки, решения, правка
 * чужих комментариев, реакции, вложения и администрирование фич/проектов —
 * только человек.
 */
const AGENT_METHODS = new Set([
    'ping',
    'projects.list',
    'reviews.list',
    'reviews.get',
    'reviews.open',
    'reviews.refresh',
    'reviews.remoteList',
    'versions.list',
    'versions.get',
    'secrets.get',
    'analytics.get',
    'diff.get',
    'rules.get',
    'features.list',
    'features.get',
    'features.context',
    'features.forReview',
    'features.addNote',
    'features.updateNote',
    'features.deleteNote',
    'drafts.put',
    'findings.put',
    'findings.list',
    'summary.put',
    'notes.add',
    'notes.update',
    'notes.delete',
    'publish.preview',
]);

export const AGENT_POLICY: RpcPolicy = {
    name: 'agent',
    capabilities: new Set<Capability>(['read', 'draft']),
    allows: (method) => AGENT_METHODS.has(method),
};

export const HUMAN_POLICY: RpcPolicy = {
    name: 'human',
    capabilities: new Set<Capability>(['read', 'draft', 'publish', 'checks', 'admin']),
    allows: () => true,
};

/** Методы, которые меняют платформу или выполняют код на хосте. */
export const HUMAN_ONLY_METHODS: ReadonlySet<string> = new Set([
    'publish.approve',
    'publish.commit',
    'checks.run',
    'decisions.put',
    'comments.update',
    'comments.delete',
    'reactions.toggle',
    'reactions.reviewToggle',
    'attachments.upload',
    'reviews.remove',
    'projects.register',
    'projects.update',
    'projects.remove',
    'features.create',
    'features.update',
    'features.addReviews',
    'features.removeReview',
    'features.reorder',
    'features.delete',
]);
