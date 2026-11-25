import { messageOf } from '../core/errors.js';
import { isNewerVersion, parseVersion } from '../core/update.js';
import { tr } from '../core/locale.js';
import { VERSION } from '../version.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;
const DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/revdeck/dist-tags';
const RELEASE_TAG_URL = 'https://github.com/katrov/revdeck/releases/tag/v';

export interface UpdateInfo {
    /** Проверка отключена через REVDECK_UPDATE_CHECK=0. */
    enabled: boolean;
    current: string;
    latest: string | null;
    updateAvailable: boolean;
    releaseUrl: string | null;
    checkedAt: string | null;
    /** Ошибка последней проверки; UI показывает её только в настройках. */
    error?: string;
}

interface UpdateCheckerOptions {
    currentVersion?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    ttlMs?: number;
    env?: NodeJS.ProcessEnv;
}

/**
 * Проверяет последнюю версию в npm dist-tags. Живёт в памяти демона:
 * одного запроса в сутки достаточно, а UI не ходит во внешнюю сеть напрямую
 * (CSP UI разрешает только same-origin).
 */
export class UpdateChecker {
    private readonly currentVersion: string;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => Date;
    private readonly ttlMs: number;
    private readonly enabled: boolean;
    private cache: { info: UpdateInfo; at: number } | null = null;
    private pending: Promise<UpdateInfo> | null = null;

    constructor(options: UpdateCheckerOptions = {}) {
        this.currentVersion = options.currentVersion ?? VERSION;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.now = options.now ?? (() => new Date());
        this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this.enabled = (options.env ?? process.env).REVDECK_UPDATE_CHECK !== '0';
    }

    private base(): UpdateInfo {
        return {
            enabled: this.enabled,
            current: this.currentVersion,
            latest: null,
            updateAvailable: false,
            releaseUrl: null,
            checkedAt: null,
        };
    }

    async check(force = false): Promise<UpdateInfo> {
        if (!this.enabled) return this.base();
        const now = this.now().getTime();
        if (!force && this.cache) {
            const ttl = this.cache.info.error ? ERROR_TTL_MS : this.ttlMs;
            if (now - this.cache.at < ttl) return this.cache.info;
        }
        if (this.pending) return this.pending;
        this.pending = this.fetchLatest()
            .then((latest) => this.success(latest))
            .catch((error) => this.failure(error))
            .finally(() => {
                this.pending = null;
            });
        return this.pending;
    }

    private async fetchLatest(): Promise<string> {
        const response = await this.fetchImpl(DIST_TAGS_URL, {
            headers: {
                accept: 'application/json',
                'user-agent': `revdeck/${this.currentVersion}`,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`npm registry: HTTP ${response.status}`);
        }
        const data = (await response.json()) as { latest?: unknown };
        const latest = typeof data.latest === 'string' ? data.latest.trim().replace(/^v/, '') : '';
        if (!parseVersion(latest)) {
            throw new Error(tr('npm registry: некорректная версия в dist-tags', 'npm registry: invalid version in dist-tags'));
        }
        return latest;
    }

    private success(latest: string): UpdateInfo {
        const updateAvailable = isNewerVersion(latest, this.currentVersion);
        const info: UpdateInfo = {
            enabled: true,
            current: this.currentVersion,
            latest,
            updateAvailable,
            releaseUrl: updateAvailable ? `${RELEASE_TAG_URL}${latest}` : null,
            checkedAt: this.now().toISOString(),
        };
        this.cache = { info, at: this.now().getTime() };
        return info;
    }

    private failure(error: unknown): UpdateInfo {
        const previous = this.cache?.info;
        const info: UpdateInfo = {
            ...this.base(),
            latest: previous?.latest ?? null,
            updateAvailable: previous?.updateAvailable ?? false,
            releaseUrl: previous?.releaseUrl ?? null,
            checkedAt: previous?.checkedAt ?? null,
            error: tr(`не удалось проверить обновления: ${messageOf(error)}`, `could not check for updates: ${messageOf(error)}`).slice(0, 400),
        };
        this.cache = { info, at: this.now().getTime() };
        return info;
    }
}
