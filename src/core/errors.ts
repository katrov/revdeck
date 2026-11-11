export class MrReviewError extends Error {
    readonly code: string;
    readonly hint: string | undefined;

    constructor(message: string, code = 'REVDECK_ERROR', hint?: string) {
        super(message);
        this.name = 'MrReviewError';
        this.code = code;
        this.hint = hint;
    }
}

export class ConfigError extends MrReviewError {
    constructor(message: string, hint?: string) {
        super(message, 'CONFIG', hint);
        this.name = 'ConfigError';
    }
}

export class ProviderError extends MrReviewError {
    constructor(message: string, hint?: string) {
        super(message, 'PROVIDER', hint);
        this.name = 'ProviderError';
    }
}

export class AuthError extends MrReviewError {
    constructor(message: string, hint?: string) {
        super(message, 'AUTH', hint);
        this.name = 'AuthError';
    }
}

export class NotFoundError extends MrReviewError {
    constructor(message: string) {
        super(message, 'NOT_FOUND');
        this.name = 'NotFoundError';
    }
}

export class ApprovalError extends MrReviewError {
    constructor(message: string) {
        super(message, 'APPROVAL');
        this.name = 'ApprovalError';
    }
}

export class PublishError extends MrReviewError {
    constructor(message: string, hint?: string) {
        super(message, 'PUBLISH', hint);
        this.name = 'PublishError';
    }
}

/** Приводит любое значение к сообщению, не раскрывая секретов (редакция — снаружи). */
export function messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
