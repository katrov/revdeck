import { existsSync } from 'node:fs';
import path from 'node:path';
import { assertConfigPath } from './config.js';
import { ConfigError } from './errors.js';
import { gitTrackState } from './git-files.js';
import { tr } from './locale.js';

export type DocumentKind = 'rules' | 'profile';

const DOC_EXTENSION = /\.(md|mdx|rst|txt|adoc)$/i;
const PROFILE_EXTENSION = /\.(md|mdx|rst|txt|adoc|ya?ml|json)$/i;

/**
 * Локальные секреты и служебные файлы, которые нельзя читать как правила или
 * профиль приложения, даже если конфиг репозитория ссылается на них.
 */
const SECRET_PATH =
    /(^|\/)(\.env(\..*)?|\.npmrc|\.git(\/.*)?|\.revdeck\.local\.(ya?ml)|id_(rsa|ed25519|ecdsa)(\.pub)?|.*\.(pem|key|p12|pfx|jks|keystore|tfvars|tfstate))$/i;

/**
 * Проверяет, что документ правил/профиля можно читать:
 * безопасное расширение, не секретный путь, и в git-репозитории — tracked.
 * Каталоги без `.git` (например, тесты) не имеют MR-ветки и допускаются.
 */
export async function assertSafeDocument(root: string, relative: string, kind: DocumentKind = 'rules'): Promise<string> {
    const clean = relative.split('#')[0]!;
    const resolved = assertConfigPath(root, clean);
    if (SECRET_PATH.test(clean)) {
        throw new ConfigError(tr(`${relative}: секретный файл нельзя читать как документ`, `${relative}: secret files cannot be read as documents`));
    }
    if (!(kind === 'profile' ? PROFILE_EXTENSION : DOC_EXTENSION).test(clean)) {
        throw new ConfigError(tr(`${relative}: недопустимый тип документа`, `${relative}: unsupported document type`));
    }
    if (existsSync(path.join(root, '.git'))) {
        const state = await gitTrackState(root, clean);
        if (state !== 'tracked') {
            throw new ConfigError(
                tr(
                    `${relative}: документ не отслеживается git (или git недоступен)`,
                    `${relative}: document is not tracked by git (or git is unavailable)`,
                ),
            );
        }
    }
    return resolved;
}
