import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepoRoot, findConfigFile, packageRoot } from '../core/paths.js';
import { gitRemote } from '../core/git.js';
import { loadConfig } from '../core/config.js';
import { redactLine } from '../core/redact.js';
import { writers } from './format.js';

export interface InitOptions {
    force: boolean;
    adapters: string[];
    noService: boolean;
}

function mcpServer(): { command: string; args: string[] } {
    // npx работает и без глобальной установки; версия подтягивается при первом запуске.
    return { command: 'npx', args: ['-y', 'revdeck', 'mcp'] };
}

export async function runInit(rootInput: string, options: InitOptions): Promise<void> {
    const root = findRepoRoot(rootInput);
    writers.out(`проект: ${root}`);
    const remote = await gitRemote(root);
    const configFile = path.join(root, '.revdeck.yml');
    if (existsSync(configFile) && !options.force) {
        writers.out(`✔ конфиг уже есть: ${path.relative(root, configFile)}`);
    } else {
        let sources: string[] = [];
        try {
            sources = (await loadConfig(root)).config.rules.sources;
        } catch (error) {
            // Старый/битый конфиг не должен мешать перезаписи через --force.
            writers.err(`! существующий конфиг не читается: ${describeError(error)}`);
        }
        const lines = [
            '# Конфигурация revdeck. Схема: docs/configuration.md',
            'version: 1',
            'provider:',
            `  type: ${remote?.platform ?? 'auto'}`,
            ...(remote ? [`  host: ${remote.host}`, `  project: ${remote.project}`] : ['  # host: gitlab.example.com', '  # project: group/project']),
            'rules:',
            '  # Документы с правилами. Если пусто — ищутся AGENTS.md, CLAUDE.md, CONTRIBUTING.md, docs/*.',
            ...(sources.length ? ['  sources:', ...sources.map((item) => `    - ${item}`)] : ['  # Документы перечисляются здесь; пустой список включает автообнаружение.', '  sources: []']),
            '  # map:',
            '  #   - match: "src/**"',
            '  #     docs: ["docs/Architecture.md", "docs/Styleguide.md#Базовый стиль"]',
            'publish:',
            '  requireApproval: true',
            '  maxComments: 50',
            '',
        ];
        await writeFile(configFile, lines.join('\n'), { mode: 0o644 });
        writers.out(`✔ создан ${path.relative(root, configFile)}`);
    }

    await ensureGitignore(root);
    const adapters = options.adapters.length ? options.adapters : detectAdapters(root);
    const mcp = mcpServer();
    for (const adapter of adapters) {
        await installAdapter(root, adapter, mcp);
    }

    if (!options.noService) {
        writers.out('');
        writers.out('Демон запускается автоматически при первой команде.');
        writers.out('Автозапуск при входе в систему: revdeck daemon install');
    }
    writers.out('');
    writers.out('Дальше:');
    writers.out('  revdeck doctor');
    writers.out('  revdeck open <номер или ссылка>');
    writers.out('  revdeck ui');
}

interface AdapterSpec {
    /** Куда скопировать skills/revdeck. */
    skills?: string;
    /** Куда дописать MCP-сервер в JSON. */
    mcp?: string;
    files?: { path: string; content: string }[];
}

const COMMAND = `---
description: Открыть ревью MR/PR и разобрать замечания
---

Запусти revdeck: \`revdeck context <номер>\` (или MCP-инструмент \`revdeck_context\`), затем веди
ревью по skill revdeck. Черновики замечаний и ответов записывай инструментами; публикует человек.
`;

const SPECS: Record<string, AdapterSpec> = {
    agents: { skills: '.agents/skills/revdeck' },
    dsh: { skills: '.agents/skills/revdeck' },
    claude: {
        skills: '.claude/skills/revdeck',
        mcp: '.mcp.json',
        files: [{ path: '.claude/commands/revdeck.md', content: COMMAND }],
    },
    cursor: {
        mcp: '.cursor/mcp.json',
        files: [{ path: '.cursor/commands/revdeck.md', content: COMMAND }],
    },
    codex: { files: [{ path: '.codex/prompts/revdeck.md', content: COMMAND }] },
    gemini: {
        files: [
            {
                path: '.gemini/commands/revdeck.toml',
                content:
                    'description = "Открыть ревью MR/PR и разобрать замечания"\n' +
                    'prompt = """Запусти `revdeck context <номер>` (или MCP revdeck_context) и веди ревью по skill revdeck."""\n',
            },
        ],
    },
    opencode: { files: [{ path: '.opencode/command/revdeck.md', content: COMMAND }] },
    copilot: { files: [{ path: '.github/prompts/revdeck.prompt.md', content: COMMAND }] },
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

async function installAdapter(root: string, adapter: string, mcp: { command: string; args: string[] }): Promise<void> {
    const spec = SPECS[adapter];
    if (!spec) {
        writers.err(`! неизвестный адаптер: ${adapter} (доступны: ${Object.keys(SPECS).join(', ')})`);
        return;
    }
    if (spec.skills) {
        const skills = path.join(packageRoot(), 'skills', 'revdeck');
        if (!existsSync(skills)) {
            writers.err('! каталог skills/revdeck не найден: пакет собран не полностью');
        } else {
            const target = path.join(root, spec.skills);
            await mkdir(target, { recursive: true });
            for (const entry of await skillFiles(skills)) {
                await cp(path.join(skills, entry), path.join(target, entry), { force: true });
            }
            writers.out(`✔ скилл: ${path.relative(root, target)}`);
        }
    }
    if (spec.mcp) await mergeMcpJson(path.join(root, spec.mcp), root, mcp);
    for (const file of spec.files ?? []) {
        const target = path.join(root, file.path);
        if (existsSync(target)) {
            writers.out(`! ${path.relative(root, target)} уже есть: не перезаписываю`);
            continue;
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.content);
        writers.out(`✔ ${path.relative(root, target)}`);
    }
    if (adapter === 'dsh') {
        writers.out('  DSH: подключите MCP в профиле (Cordis YAML):');
        writers.out('    - id: mcp-revdeck');
        writers.out("      name: '@deepseek-ai/dsh-mcp-client'");
        writers.out('      config:');
        writers.out('        serverName: revdeck');
        writers.out('        transport: stdio');
        writers.out(`        command: ${mcp.command}`);
        writers.out(`        args: ${JSON.stringify(mcp.args)}`);
        writers.out('  Команда /revdeck в DSH появится из плагина-обёртки; MCP-инструменты доступны сразу.');
    }
}

async function skillFiles(dir: string): Promise<string[]> {
    const names = ['SKILL.md', 'Review.md', 'Feedback.md', 'Criteria.md', 'Rules.md', 'Sources.md'];
    return names.filter((name) => existsSync(path.join(dir, name)));
}

async function mergeMcpJson(file: string, root: string, mcp: { command: string; args: string[] }): Promise<void> {
    let data: Record<string, unknown> = {};
    if (existsSync(file)) {
        try {
            data = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        } catch {
            writers.err(`! ${path.relative(root, file)} повреждён: не трогаю`);
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
    writers.out('✔ .revdeck/ добавлен в .gitignore');
}

export async function installService(): Promise<string> {
    const root = packageRoot();
    const daemon = path.join(root, 'dist', 'daemon.js');
    if (!existsSync(daemon)) throw new Error('нет dist/daemon.js: сначала выполните npm run build');
    if (daemon.includes(`${path.sep}_npx${path.sep}`)) {
        writers.err('! пакет запущен через npx: путь к демону может исчезнуть при очистке кеша.');
        writers.err('  для автозапуска установите глобально: npm install -g revdeck');
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
        writers.out('  включить: systemctl --user daemon-reload && systemctl --user enable --now revdeck');
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
    throw new Error(`автозапуск не поддержан на ${process.platform}: запускайте revdeck daemon start`);
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
