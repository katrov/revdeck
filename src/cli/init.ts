import { existsSync } from 'node:fs';
import { appendFile, cp, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepoRoot, findConfigFile, packageRoot } from '../core/paths.js';
import { gitRemote } from '../core/git.js';
import { loadConfig } from '../core/config.js';
import { redactLine } from '../core/redact.js';
import { tr, type Locale } from '../core/locale.js';
import { writers } from './format.js';

export interface InitOptions {
    force: boolean;
    adapters: string[];
    noService: boolean;
    locale: Locale;
    outputLanguage: 'auto' | 'ru' | 'en';
}

interface McpConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

function mcpServer(locale: Locale): McpConfig {
    // npx работает и без глобальной установки; версия подтягивается при первом запуске.
    return { command: 'npx', args: ['-y', 'revdeck', 'mcp'], env: { REVDECK_LANG: locale } };
}

export async function runInit(rootInput: string, options: InitOptions): Promise<void> {
    const root = findRepoRoot(rootInput);
    writers.out(`${tr('проект', 'project')}: ${root}`);
    const remote = await gitRemote(root);
    const configFile = path.join(root, '.revdeck.yml');
    if (existsSync(configFile) && !options.force) {
        writers.out(`✔ ${tr('конфиг уже есть', 'config already exists')}: ${path.relative(root, configFile)}`);
    } else {
        let sources: string[] = [];
        try {
            sources = (await loadConfig(root)).config.rules.sources;
        } catch (error) {
            // Старый/битый конфиг не должен мешать перезаписи через --force.
            writers.err(`! ${tr('существующий конфиг не читается', 'existing config cannot be read')}: ${describeError(error)}`);
        }
        const lines = [
            tr('# Конфигурация revdeck. Схема: docs/configuration.md', '# revdeck configuration. Schema: docs/configuration.md'),
            'version: 1',
            'provider:',
            `  type: ${remote?.platform ?? 'auto'}`,
            ...(remote ? [`  host: ${remote.host}`, `  project: ${remote.project}`] : ['  # host: gitlab.example.com', '  # project: group/project']),
            'output:',
            tr('  # auto — язык описания MR/обсуждений, либо явно ru/en', '  # auto — MR/thread language, or explicit ru/en'),
            `  language: ${options.outputLanguage}`,
            'rules:',
            tr('  # Документы с правилами. Если пусто — ищутся AGENTS.md, CLAUDE.md, CONTRIBUTING.md, docs/*.', '  # Rule documents. When empty, AGENTS.md, CLAUDE.md, CONTRIBUTING.md and docs/* are discovered.'),
            ...(sources.length ? ['  sources:', ...sources.map((item) => `    - ${item}`)] : [tr('  # Документы перечисляются здесь; пустой список включает автообнаружение.', '  # List documents here; an empty list enables auto-discovery.'), '  sources: []']),
            '  # map:',
            '  #   - match: "src/**"',
            tr('  #     docs: ["docs/Architecture.md", "docs/Styleguide.md#Базовый стиль"]', '  #     docs: ["docs/Architecture.md", "docs/Styleguide.md#Base style"]'),
            'publish:',
            '  requireApproval: true',
            '  maxComments: 50',
            '',
        ];
        await writeFile(configFile, lines.join('\n'), { mode: 0o644 });
        writers.out(`✔ ${tr('создан', 'created')} ${path.relative(root, configFile)}`);
    }

    await ensureGitignore(root);
    const adapters = options.adapters.length ? options.adapters : detectAdapters(root);
    const mcp = mcpServer(options.locale);
    // Канонический скилл всегда живёт в .agents; .claude и другие харнессы ссылаются на него.
    const canonicalSkill = await installSkill(root, options.locale);
    for (const adapter of adapters) {
        await installAdapter(root, adapter, mcp, options.locale, canonicalSkill);
    }

    if (!options.noService) {
        writers.out('');
        writers.out(tr('Демон запускается автоматически при первой команде.', 'The daemon starts automatically on the first command.'));
        writers.out(tr('Автозапуск при входе в систему: revdeck daemon install', 'Auto-start on login: revdeck daemon install'));
    }
    writers.out('');
    writers.out(tr('Дальше:', 'Next:'));
    writers.out('  revdeck doctor');
    writers.out(`  revdeck open ${tr('<номер или ссылка>', '<number or URL>')}`);
    writers.out('  revdeck ui');
}

const CANONICAL_SKILL = '.agents/skills/revdeck';

interface AdapterSpec {
    /** Создать ссылку на канонический .agents/skills/revdeck (иначе — копия на Windows). */
    linkSkill?: boolean;
    /** Куда дописать MCP-сервер в JSON. */
    mcp?: string;
    files?: { path: string; content: string | ((locale: Locale) => string) }[];
}

function commandMd(locale: Locale): string {
    if (locale === 'ru') {
        return `---
description: Открыть ревью MR/PR и разобрать замечания
---

Запусти revdeck: \`revdeck context <номер>\` (или MCP-инструмент \`revdeck_context\`), затем веди
ревью по skill revdeck. Черновики замечаний и ответов записывай инструментами; публикует человек.
`;
    }
    return `---
description: Open a MR/PR review and work through the discussion
---

Run revdeck: \`revdeck context <number>\` (or the MCP tool \`revdeck_context\`), then follow the
revdeck skill. Write draft findings and replies with the tools; a human publishes them.
`;
}

function commandToml(locale: Locale): string {
    if (locale === 'ru') {
        return 'description = "Открыть ревью MR/PR и разобрать замечания"\n' +
            'prompt = """Запусти `revdeck context <номер>` (или MCP revdeck_context) и веди ревью по skill revdeck."""\n';
    }
    return 'description = "Open a MR/PR review and work through the discussion"\n' +
        'prompt = """Run `revdeck context <number>` (or MCP revdeck_context) and follow the revdeck skill."""\n';
}

const SPECS: Record<string, AdapterSpec> = {
    agents: {},
    dsh: {},
    claude: {
        linkSkill: true,
        mcp: '.mcp.json',
        files: [{ path: '.claude/commands/revdeck.md', content: commandMd }],
    },
    cursor: {
        mcp: '.cursor/mcp.json',
        files: [{ path: '.cursor/commands/revdeck.md', content: commandMd }],
    },
    codex: { files: [{ path: '.codex/prompts/revdeck.md', content: commandMd }] },
    gemini: { files: [{ path: '.gemini/commands/revdeck.toml', content: commandToml }] },
    opencode: { files: [{ path: '.opencode/command/revdeck.md', content: commandMd }] },
    copilot: { files: [{ path: '.github/prompts/revdeck.prompt.md', content: commandMd }] },
};

function detectAdapters(root: string): string[] {
    const adapters = new Set<string>(['agents']);
    if (existsSync(path.join(root, '.claude')) || existsSync(path.join(root, 'CLAUDE.md'))) adapters.add('claude');
    if (existsSync(path.join(root, '.cursor'))) adapters.add('cursor');
    if (existsSync(path.join(root, '.codex')) || existsSync(path.join(root, 'AGENTS.md'))) adapters.add('codex');
    if (existsSync(path.join(root, '.github'))) adapters.add('copilot');
    if (existsSync(path.join(root, '.dsh')) || existsSync(path.join(root, 'dsh.yml'))) adapters.add('dsh');
    if (existsSync(path.join(root, '.gemini')) || existsSync(path.join(root, 'GEMINI.md'))) adapters.add('gemini');
    if (existsSync(path.join(root, '.opencode'))) adapters.add('opencode');
    return [...adapters];
}

async function installAdapter(
    root: string,
    adapter: string,
    mcp: McpConfig,
    locale: Locale,
    canonicalSkill: string | null,
): Promise<void> {
    const spec = SPECS[adapter];
    if (!spec) {
        writers.err(`! ${tr('неизвестный адаптер', 'unknown adapter')}: ${adapter} (${Object.keys(SPECS).join(', ')})`);
        return;
    }
    if (spec.linkSkill && canonicalSkill) await linkSkill(root, canonicalSkill);
    if (spec.mcp) await mergeMcpJson(path.join(root, spec.mcp), root, mcp);
    for (const file of spec.files ?? []) {
        const target = path.join(root, file.path);
        if (existsSync(target)) {
            writers.out(`! ${path.relative(root, target)} ${tr('уже есть: не перезаписываю', 'already exists: not overwriting')}`);
            continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, typeof file.content === 'string' ? file.content : file.content(locale));
        writers.out(`✔ ${path.relative(root, target)}`);
    }
    if (adapter === 'dsh') {
        writers.out(`  ${tr('DSH: подключите MCP в профиле (Cordis YAML):', 'DSH: add the MCP server to your profile (Cordis YAML):')}`);
        writers.out('    - id: mcp-revdeck');
        writers.out("      name: '@deepseek-ai/dsh-mcp-client'");
        writers.out('      config:');
        writers.out('        serverName: revdeck');
        writers.out('        transport: stdio');
        writers.out(`        command: ${mcp.command}`);
        writers.out(`        args: ${JSON.stringify(mcp.args)}`);
        writers.out('        env:');
        writers.out(`          REVDECK_LANG: ${locale}`);
        writers.out(`  ${tr('Команда /revdeck в DSH появится из плагина-обёртки; MCP-инструменты доступны сразу.', 'A /revdeck command in DSH requires a host plugin; the MCP tools are available immediately.')}`);
    }
}

/** Канонический скилл: .agents/skills/revdeck, включая agents/openai.yaml. */
async function installSkill(root: string, locale: Locale): Promise<string | null> {
    const source = path.join(packageRoot(), 'skills', 'revdeck', locale);
    if (!existsSync(source)) {
        writers.err(`! ${tr('каталог skills/revdeck не найден: пакет собран не полностью', 'skills/revdeck not found: the package is incomplete')}`);
        return null;
    }
    const target = path.join(root, CANONICAL_SKILL);
    await copySkill(source, target);
    writers.out(`✔ ${tr('скилл', 'skill')}: ${CANONICAL_SKILL}`);
    return target;
}

async function copySkill(source: string, target: string): Promise<void> {
    await mkdir(target, { recursive: true });
    for (const entry of await skillFiles(source)) {
        const file = path.join(target, entry);
        await mkdir(path.dirname(file), { recursive: true });
        await cp(path.join(source, entry), file, { force: true });
    }
}

/**
 * .claude/skills/revdeck — ссылка на канонический скилл, а не копия процедур.
 * Старую копию, созданную предыдущим init, заменяем; чужие файлы не трогаем.
 */
async function linkSkill(root: string, canonicalSkill: string): Promise<void> {
    const target = path.join(root, '.claude', 'skills', 'revdeck');
    const relative = path.relative(path.dirname(target), canonicalSkill);
    await mkdir(path.dirname(target), { recursive: true });
    const existing = await lstat(target).catch(() => null);
    if (existing) {
        if (existing.isSymbolicLink()) {
            const current = await readlink(target).catch(() => '');
            if (current === relative) {
                writers.out(`✔ ${tr('скилл', 'skill')}: .claude/skills/revdeck -> ${CANONICAL_SKILL}`);
                return;
            }
            await rm(target, { force: true });
        } else if (existing.isDirectory() && (await isManagedSkillDir(target))) {
            await rm(target, { recursive: true, force: true });
        } else {
            writers.out(`! .claude/skills/revdeck ${tr('уже есть: не перезаписываю', 'already exists: not overwriting')}`);
            return;
        }
    }
    if (process.platform === 'win32') {
        // Символические ссылки на Windows требуют прав; копия сохраняет совместимость.
        await copySkill(canonicalSkill, target);
    } else {
        await symlink(relative, target, 'dir');
    }
    writers.out(`✔ ${tr('скилл', 'skill')}: .claude/skills/revdeck -> ${CANONICAL_SKILL}`);
}

async function isManagedSkillDir(dir: string): Promise<boolean> {
    const skill = path.join(dir, 'SKILL.md');
    if (!existsSync(skill)) return false;
    const text = await readFile(skill, 'utf8').catch(() => '');
    return /^name:\s*revdeck\s*$/m.test(text);
}

async function skillFiles(dir: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...(await skillFiles(dir, relative)));
        else if (entry.isFile()) files.push(relative);
    }
    return files.sort();
}

async function mergeMcpJson(file: string, root: string, mcp: McpConfig): Promise<void> {
    let data: Record<string, unknown> = {};
    if (existsSync(file)) {
        try {
            data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        } catch {
            writers.err(`! ${path.relative(root, file)} ${tr('повреждён: не трогаю', 'is broken: leaving it untouched')}`);
            return;
        }
    }
    const servers = (data.mcpServers ?? {}) as Record<string, unknown>;
    servers['revdeck'] = mcp;
    data.mcpServers = servers;
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
    writers.out(`✔ MCP: ${path.relative(root, file)}`);
}

async function ensureGitignore(root: string): Promise<void> {
    const file = path.join(root, '.gitignore');
    const current = existsSync(file) ? await readFile(file, 'utf8') : '';
    if (/(^|\n)\.revdeck\/?\s*$/m.test(current)) return;
    await appendFile(file, `${current && !current.endsWith('\n') ? '\n' : ''}.revdeck/\n`);
    writers.out(tr('✔ .revdeck/ добавлен в .gitignore', '✔ .revdeck/ added to .gitignore'));
}

export async function installService(): Promise<string> {
    const root = packageRoot();
    const daemon = path.join(root, 'dist', 'daemon.js');
    if (!existsSync(daemon)) throw new Error(tr('нет dist/daemon.js: сначала выполните npm run build', 'dist/daemon.js is missing: run npm run build first'));
    if (daemon.includes(`${path.sep}_npx${path.sep}`)) {
        writers.err(tr('! пакет запущен через npx: путь к демону может исчезнуть при очистке кеша.', '! running from an npx cache: the daemon path can be evicted.'));
        writers.err(tr('  для автозапуска установите глобально: npm install -g revdeck', '  install globally for auto-start: npm install -g revdeck'));
    }
    if (process.platform === 'linux') {
        const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config'), 'systemd', 'user');
        await mkdir(dir, { recursive: true });
        const unit = path.join(dir, 'revdeck.service');
        await writeFile(
            unit,
            [
                '[Unit]',
                'Description=revdeck daemon',
                'After=default.target',
                '',
                '[Service]',
                `ExecStart=${process.execPath} ${daemon}`,
                'Restart=on-failure',
                'RestartSec=2',
                '',
                '[Install]',
                'WantedBy=default.target',
                '',
            ].join('\n'),
        );
        writers.out(`✔ unit: ${unit}`);
        writers.out(tr('  включить: systemctl --user daemon-reload && systemctl --user enable --now revdeck', '  enable: systemctl --user daemon-reload && systemctl --user enable --now revdeck'));
        return unit;
    }
    if (process.platform === 'darwin') {
        const dir = path.join(process.env.HOME || '', 'Library', 'LaunchAgents');
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, 'io.revdeck.daemon.plist');
        await writeFile(
            file,
            `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>io.revdeck.daemon</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${daemon}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
</dict></plist>
`,
        );
        writers.out(`✔ plist: ${file}`);
        writers.out(`  включить: launchctl load -w ${file}`);
        return file;
    }
    throw new Error(tr(`автозапуск не поддержан на ${process.platform}: запускайте revdeck daemon start`, `auto-start is not supported on ${process.platform}: run revdeck daemon start`));
}

export async function tailLog(lines = 80): Promise<string> {
    const { logPath } = await import('../core/paths.js');
    try {
        const text = await readFile(logPath(), 'utf8');
        return text.split('\n').slice(-lines).join('\n');
    } catch {
        return '';
    }
}

export function describeError(error: unknown): string {
    return redactLine(error instanceof Error ? error.message : error);
}
