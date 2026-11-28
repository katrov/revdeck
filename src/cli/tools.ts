import { createInterface } from 'node:readline/promises';
import { isDevContainer } from '../client.js';
import { resolveExecutable, run } from '../core/exec.js';
import { tr } from '../core/locale.js';
import { fail, printJson, writers } from './format.js';
import { colors, warningLine } from './report.js';

/** CLI платформ, которые revdeck вызывает сам. git проверяется для диагностики. */
export type ToolName = 'git' | 'glab' | 'gh';
type InstallTool = Exclude<ToolName, 'git'>;
type ManagerName = 'brew' | 'pacman' | 'winget';


export interface ToolPlan {
    tool: InstallTool;
    url: string;
    /** Менеджер, который нашёлся на хосте; null — установим вручную по ссылке. */
    manager: ManagerName | null;
    /** Команда для человека; для brew/winget её же запускает revdeck после --yes. */
    command: string | null;
    automatic: boolean;
    /** Почему нельзя запустить автоматически (например, нужен sudo). */
    manualReason?: string;
}

interface ToolStatus {
    name: ToolName;
    path: string | null;
    version: string | null;
    plan?: ToolPlan;
}

const TOOL_URL: Record<InstallTool, string> = {
    glab: 'https://docs.gitlab.com/cli/installation/',
    gh: 'https://cli.github.com/',
};

const TOOL_LABEL: Record<ToolName, string> = {
    git: 'git',
    glab: 'glab (GitLab CLI)',
    gh: 'gh (GitHub CLI)',
};

const VERSION_ARGS: Record<ToolName, string[]> = {
    git: ['--version'],
    glab: ['--version'],
    gh: ['--version'],
};

function parseTools(value: string | undefined): { tools: InstallTool[]; label: string } {
    if (!value || value === 'all') return { tools: ['glab', 'gh'], label: 'glab и gh' };
    if (value === 'glab' || value === 'gh') return { tools: [value], label: value };
    fail(
        tr(`неизвестный инструмент: ${value}`, `unknown tool: ${value}`),
        tr('допустимо: glab, gh или all', 'allowed: glab, gh or all'),
    );
}


async function toolVersion(bin: ToolName): Promise<string | null> {
    try {
        const result = await run(bin, VERSION_ARGS[bin], { timeoutMs: 5000 });
        const line = `${result.stdout}\n${result.stderr}`.split('\n').map((item) => item.trim()).find(Boolean);
        return line ? line.slice(0, 120) : null;
    } catch {
        return null;
    }
}

async function toolState(bin: ToolName): Promise<ToolStatus> {
    const path = await resolveExecutable(bin);
    if (!path) return { name: bin, path: null, version: null };
    return { name: bin, path, version: await toolVersion(bin) };
}

/** Пакетный менеджер и точная команда для отсутствующего CLI. */
export function installPlan(tool: InstallTool, managers: Partial<Record<ManagerName, string>>): ToolPlan {
    const url = TOOL_URL[tool];
    if (managers.brew) {
        return { tool, url, manager: 'brew', command: `brew install ${tool}`, automatic: true };
    }
    if (managers.pacman) {
        const pkg = tool === 'glab' ? 'glab' : 'github-cli';
        return {
            tool,
            url,
            manager: 'pacman',
            command: `sudo pacman -S ${pkg}`,
            automatic: false,
            manualReason: tr('нужен sudo: выполните команду вручную', 'requires sudo: run the command manually'),
        };
    }
    if (tool === 'gh' && managers.winget) {
        return {
            tool,
            url,
            manager: 'winget',
            command: 'winget install --id GitHub.cli --accept-package-agreements --accept-source-agreements',
            automatic: true,
        };
    }
    return { tool, url, manager: null, command: null, automatic: false };
}

async function detectManagers(): Promise<Partial<Record<ManagerName, string>>> {
    const managers: Partial<Record<ManagerName, string>> = {};
    for (const name of ['brew', 'pacman', 'winget'] as const) {
        const found = await resolveExecutable(name);
        if (found) managers[name] = found;
    }
    return managers;
}

function planFor(tool: InstallTool, managers: Partial<Record<ManagerName, string>>): ToolPlan {
    return installPlan(tool, managers);
}

function planLines(plan: ToolPlan): string[] {
    const lines = [
        `    ${colors.bold(TOOL_LABEL[plan.tool])} ${colors.dim(tr('не установлен', 'not installed'))}`,
        `      ${colors.dim(tr('инструкция:', 'guide:'))} ${plan.url}`,
    ];
    if (plan.command) {
        lines.push(`      ${colors.dim(tr('команда:', 'command:'))} ${colors.cyan(plan.command)}`);
    }
    if (plan.manualReason) lines.push(`      ${colors.yellow('!')} ${plan.manualReason}`);
    return lines;
}

async function confirmTool(plan: ToolPlan): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question(tr(`Установить ${plan.tool} через ${plan.manager}? [y/N] `, `Install ${plan.tool} with ${plan.manager}? [y/N] `))).trim().toLowerCase();
        return ['y', 'yes', 'д', 'да'].includes(answer);
    } finally {
        rl.close();
    }
}

function managerCommand(plan: ToolPlan): { command: string; args: string[] } | null {
    if (plan.manager === 'brew') return { command: 'brew', args: ['install', plan.tool] };
    if (plan.manager === 'winget') {
        return {
            command: 'winget',
            args: ['install', '--id', 'GitHub.cli', '--accept-package-agreements', '--accept-source-agreements'],
        };
    }
    return null;
}

async function installOne(plan: ToolPlan, yes: boolean): Promise<{ ok: boolean; executed: boolean; error?: string }> {
    const invocation = managerCommand(plan);
    if (!invocation) return { ok: false, executed: false };
    if (!yes && !(await confirmTool(plan))) {
        return { ok: false, executed: false, error: tr('установка отменена', 'installation cancelled') };
    }
    try {
        const result = await run(invocation.command, invocation.args, { timeoutMs: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 });
        const detail = `${result.stdout}\n${result.stderr}`.trim();
        if (detail) writers.err(colors.dim(detail.split('\n').slice(-3).join('\n')));
        return { ok: true, executed: true };
    } catch (error) {
        return { ok: false, executed: true, error: error instanceof Error ? error.message : String(error) };
    }
}

async function toolsStatus(json: boolean): Promise<void> {
    const managers = await detectManagers();
    const statuses: ToolStatus[] = [];
    for (const name of ['git', 'glab', 'gh'] as const) {
        const status = await toolState(name);
        if (!status.path && name !== 'git') status.plan = planFor(name, managers);
        statuses.push(status);
    }
    if (json) {
        printJson({
            tools: statuses.map((status) => ({
                name: status.name,
                found: Boolean(status.path),
                path: status.path,
                version: status.version,
                ...(status.plan ? { install: status.plan } : {}),
            })),
            managers: Object.keys(managers),
        });
        return;
    }
    writers.out('');
    for (const status of statuses) {
        const mark = status.path ? colors.green('✔') : colors.red('✖');
        const detail = status.path ? (status.version ?? tr('установлен', 'installed')) : tr('не найден', 'not found');
        writers.out(`  ${mark} ${colors.bold(status.name.padEnd(5))} ${detail}`);
        if (!status.path && status.plan) for (const line of planLines(status.plan)) writers.out(line);
        if (!status.path && status.name === 'git') {
            writers.out(`    ${colors.yellow('!')} ${tr('git обязателен: установите его системным пакетным менеджером', 'git is required: install it with the system package manager')}`);
        }
    }
    writers.out('');
    const available = Object.keys(managers);
    writers.out(
        `  ${colors.dim(tr('пакетные менеджеры:', 'package managers:'))} ${
            available.length ? colors.cyan(available.join(', ')) : tr('не найдены', 'none found')
        }`,
    );
    writers.out('');
}

async function toolsInstall(toolArg: string | undefined, values: Record<string, string | boolean | undefined>): Promise<void> {
    const dryRun = values['dry-run'] === true;
    const json = values.json === true;
    const yes = values.yes === true;
    if (json && !dryRun && !yes) {
        fail(tr('с --json нужен --dry-run или --yes', 'with --json pass --dry-run or --yes'));
    }
    const requested = parseTools(toolArg);
    const managers = await detectManagers();
    const plans: ToolPlan[] = [];
    for (const tool of requested.tools) {
        if (await resolveExecutable(tool)) {
            continue;
        }
        plans.push(planFor(tool, managers));
    }
    if (!plans.length) {
        if (json) printJson({ plans: [], installed: requested.tools });
        else writers.out(`  ${colors.green('✔')} ${tr(`${requested.label} уже установлен${requested.tools.length > 1 ? 'ы' : ''}`, `${requested.label} already installed`)}`);
        return;
    }
    if (json && dryRun) {
        printJson({ plans });
        return;
    }
    if (dryRun) {
        writers.out('');
        writers.out(`  ${colors.bold(tr('План установки', 'Install plan'))} ${colors.dim(tr('· ничего не будет запущено', '· nothing will be executed'))}`);
        writers.out('');
        for (const plan of plans) for (const line of planLines(plan)) writers.out(line);
        const automatic = plans.filter((plan) => plan.automatic);
        writers.out('');
        if (automatic.length) {
            writers.out(
                `  ${colors.dim(tr('Выполнить:', 'Run:'))} ${colors.cyan(`revdeck tools install ${automatic.map((plan) => plan.tool).join(' ')} --yes`)}`,
            );
        } else {
            writers.out(`  ${colors.dim(tr('Автоматическая установка недоступна: выполните команду выше.', 'Automatic installation is unavailable: run the command above.'))}`);
        }
        writers.out('');
        return;
    }
    let failed = false;
    const results: { tool: string; executed: boolean; ok: boolean; error?: string }[] = [];
    for (const plan of plans) {
        if (!plan.automatic) {
            failed = true;
            writers.out('');
            const lines = planLines(plan);
            for (const line of lines) writers.out(line);
            if (!plan.command) writers.out(`  ${tr('Установите по инструкции:', 'Install using the guide:')} ${plan.url}`);
            results.push({ tool: plan.tool, executed: false, ok: false });
            continue;
        }
        if (!json) writers.out(`\n  ${tr('Устанавливаю', 'Installing')} ${plan.tool} ${tr('через', 'with')} ${plan.manager}…`);
        const result = await installOne(plan, yes);
        results.push({ tool: plan.tool, executed: result.executed, ok: result.ok, ...(result.error ? { error: result.error } : {}) });
        if (!result.ok) {
            failed = true;
            if (!json) writers.err(warningLine(result.error ?? tr(`не удалось установить ${plan.tool}`, `could not install ${plan.tool}`)));
            continue;
        }
        const path = await resolveExecutable(plan.tool);
        if (!json) {
            if (path) writers.out(`  ${colors.green('✔')} ${plan.tool} ${tr('установлен', 'installed')}: ${path}`);
            else {
                writers.out(`  ${warningLine(tr(`${plan.tool} установлен, но не виден в PATH демона: задайте REVDECK_${plan.tool.toUpperCase()} или перезапустите демон`, `${plan.tool} is installed but not visible in the daemon PATH: set REVDECK_${plan.tool.toUpperCase()} or restart the daemon`))}`);
                failed = true;
            }
        }
    }
    if (json) {
        printJson({ plans, results });
    } else if (!failed) {
        writers.out(`\n  ${colors.dim(tr('Перезапустите демон:', 'Restart the daemon:'))} ${colors.cyan('revdeck daemon restart')}\n`);
    }
    if (failed) process.exitCode = 1;
}

/** `revdeck tools [status|install [glab|gh|all]] [--dry-run] [--yes] [--json]`. */
export async function tools(positionals: string[], values: Record<string, string | boolean | undefined>): Promise<void> {
    if (isDevContainer()) {
        fail(
            tr('CLI платформ и пакетные менеджеры проверяются и ставятся на хосте, а не в контейнере', 'platform CLIs and package managers are checked and installed on the host, not in the container'),
            tr('выполните revdeck tools на хосте', 'run revdeck tools on the host'),
        );
    }
    const action = positionals[0] ?? 'status';
    if (action === 'status') {
        await toolsStatus(values.json === true);
        return;
    }
    if (action === 'install') {
        await toolsInstall(positionals[1], values);
        return;
    }
    fail(tr(`неизвестное действие: ${action}`, `unknown action: ${action}`), tr('допустимо: status, install', 'allowed: status, install'));
}
