#!/usr/bin/env node
// Локальный UI для публикации ответов на замечания MR (skill mr-review). Запускать на ХОСТЕ:
//
//   sh devtools/mr-comments.sh <N>      # выгрузить треды в .mr-review/
//   node devtools/mr-ui/server.mjs <N>  # открыть UI, отредактировать черновики, опубликовать
//
// Запускать напрямую, а не через npm: `npm run` выполняет pre/post-скрипты и настройки .npmrc, которые
// агент может менять.
//
// Канал связи с агентом - файл .mr-review/mr-<N>-replies.json: агент пишет туда черновики, UI
// дописывает правки пользователя, заметки для агента и статус публикации. Формат файла описан
// в .agents/skills/mr-review/Feedback.md (канон), здесь он не дублируется.
// Токен glab остаётся на хосте: сервер слушает только 127.0.0.1 и зовёт `glab api` без shell.
// Для записи токену нужен scope `api` (для выгрузки хватает `read_api`).
// Проект GitLab по умолчанию определяет glab по git remote рабочей копии (а .git доступен агенту), поэтому
// сервер печатает и показывает в UI проект и заголовок MR; MR_PROJECT=group/project (переменная хоста,
// вне репозитория) закрепляет проект явно; тогда обязателен и GITLAB_HOST (хост GitLab), иначе glab берёт хост
// из того же remote, и закрепление теряет смысл.
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dir = path.join(root, '.mr-review');
const mr = process.argv[2];
const MAX_BODY = 1024 * 1024;
// Шрифт мессенджера (Roboto) берётся из ui-kit: читается один раз при старте (см. ниже) и отдаётся из памяти.
const fontsDir = path.join(root, 'ui-kit/assets/fonts');
const FONT_FILES = [
    ...['regular', '500', '700'].map((w) => `roboto-v32-cyrillic_latin-${w}.woff2`),
    'roboto-mono-v23-cyrillic_latin-regular.woff2',
];

if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) fail('запускай на хосте, а не в контейнере: токен glab в песочницу не передаётся');
if (!/^\d+$/.test(mr ?? '')) fail('использование: node devtools/mr-ui/server.mjs <номер MR>');
if (process.env.MR_PROJECT) {
    if (!/^[\w.-]+(\/[\w.-]+)+$/.test(process.env.MR_PROJECT)) fail('MR_PROJECT: ожидается group/project');
    if (process.env.MR_PROJECT === 'group/project') fail('MR_PROJECT=group/project - это пример из документации: укажите путь вашего проекта (из адреса MR: <хост>/<путь проекта>/-/merge_requests/N)');
    if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(process.env.GITLAB_HOST ?? '')) {
        fail('при MR_PROJECT нужен и GITLAB_HOST (имя хоста GitLab без схемы): иначе хост берётся из git remote рабочей копии');
    }
}
const projectRef = process.env.MR_PROJECT ? encodeURIComponent(process.env.MR_PROJECT) : ':id';
// При закреплённом проекте хост передаётся glab явно, а не берётся из git remote рабочей копии.
const hostArgs = process.env.MR_PROJECT ? ['--hostname', process.env.GITLAB_HOST] : [];

const discussionsFile = path.join(dir, `mr-${mr}-discussions.json`);
const repliesFile = path.join(dir, `mr-${mr}-replies.json`);
const summaryFile = path.join(dir, `mr-${mr}-summary.json`);
const findingsFile = path.join(dir, `mr-${mr}-findings.json`);
const diffFile = path.join(dir, `mr-${mr}.diff`);
const decisionsFile = path.join(dir, `mr-${mr}-decisions.json`);
const publishedFile = path.join(dir, `mr-${mr}-published.json`);
const notesFile = path.join(dir, `mr-${mr}-notes.json`);
const token = randomBytes(24).toString('hex');

function fail(message) {
    console.error(`mr-ui: ${message}`);
    process.exit(1);
}

// Каталог .mr-review доступен агенту на запись: не ходим по символическим ссылкам ни при чтении, ни при записи.
try {
    if ((await lstat(dir)).isSymbolicLink()) fail('.mr-review - символическая ссылка, запуск отменён');
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dir);
}
const dirReal = await realpath(dir);
// Каталог могли заменить ссылкой уже после старта: перед каждой операцией сверяем, что это тот же каталог.
async function assertDir() {
    if ((await realpath(dir)) !== dirReal) throw new Error('.mr-review заменён (ссылка?), перезапустите сервер');
}
// Страница читается один раз при старте: правка файла на диске не меняет уже запущенный сервер.
const html = await readFile(path.join(here, 'index.html'), 'utf8');

// Шрифты читаются один раз, без следования по ссылкам (каталог ui-kit агент менять может), и отдаются из памяти:
// маршрут /fonts/ работает без токена и не должен читать диск по запросу.
const fonts = new Map();
try {
    if ((await realpath(fontsDir)) !== path.join(await realpath(root), 'ui-kit/assets/fonts')) throw new Error('каталог шрифтов - ссылка');
    for (const name of FONT_FILES) {
        try {
            const handle = await open(path.join(fontsDir, name), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
            try {
                if (!(await handle.stat()).isFile()) throw new Error('не обычный файл');
                fonts.set(name, await handle.readFile());
            } finally {
                await handle.close();
            }
        } catch (error) {
            console.warn(`mr-ui: шрифт ${name} не загружен (${error.code ?? error.message})`);
        }
    }
} catch (error) {
    console.warn(`mr-ui: шрифты не загружены (${error.message}), UI будет с системным шрифтом`);
}

const glab = (args) =>
    new Promise((resolve, reject) => {
        // С закреплённым проектом glab не нужен git remote, поэтому запускается вне рабочей копии: .git/config (хуки,
        // core.fsmonitor), который агент может менять, не читается. Без MR_PROJECT нужен remote, и cwd - репозиторий.
        execFile('glab', args, { cwd: process.env.MR_PROJECT ? tmpdir() : root, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) reject(new Error((stderr || error.message).trim()));
            else resolve(stdout);
        });
    });

// Строка из чужого источника (GitLab, stderr glab) печатается в терминал: без управляющих символов и маркеров
// направления текста, иначе escape-последовательности перепишут строку сверки проекта.
const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '?').slice(0, 200);
// Токены GitLab (glpat-, gloas-, glrt-, ...), заголовки авторизации и длинные hex-строки не должны попасть ни в файл, ни в UI.
const redact = (value) =>
    String(value ?? '')
        .replace(/\bgl[a-z]{2,6}-[\w-]{10,}/g, '***')
        .replace(/(?:PRIVATE-TOKEN|Authorization)\s*[:=]\s*\S+(?:\s+\S+)?/gi, '***')
        .replace(/\b[0-9a-f]{40,}\b/gi, '***')
        .slice(0, 500);

// Проект и заголовок MR для сверки глазами: подмена remote в .git не должна пройти незамеченной.
async function describeMr() {
    try {
        const project = JSON.parse(await glab(['api', ...hostArgs, `projects/${projectRef}`])).path_with_namespace;
        const title = JSON.parse(await glab(['api', ...hostArgs, `projects/${projectRef}/merge_requests/${mr}`])).title;
        return { project: clean(project), title: clean(title) };
    } catch (error) {
        return { project: '', title: '', error: clean(redact(error.message)) };
    }
}

async function readText(file) {
    if (file.startsWith(dir + path.sep)) await assertDir();
    if (!(await lstat(file)).isFile()) throw new Error('не обычный файл (ссылка?)');
    return readFile(file, 'utf8');
}

async function readJson(file, fallback) {
    try {
        return JSON.parse(await readText(file));
    } catch (error) {
        if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
        throw new Error(`${path.basename(file)}: ${error.message}`);
    }
}

// Запись через временный файл и rename: читатель не увидит обрезанный JSON, rename не идёт по ссылке.
async function writeAtomic(file, data) {
    await assertDir();
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
        const handle = await open(tmp, 'wx', 0o644);
        try {
            await handle.writeFile(data);
        } finally {
            await handle.close();
        }
        await rename(tmp, file);
    } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
    }
}

// Переписка читается из GitLab при каждом запросе: ответы, опубликованные из UI, и ответы других людей видны сразу.
// Если GitLab недоступен, берётся выгрузка discussions.json (она не обновляется после публикации), причина - в threadsError.
let threadsError = '';
// Номера комментариев последней выгрузки: проверка note_id при реакции не требует повторного запроса в GitLab.
let knownNotes = new Set();
async function fetchDiscussions() {
    const all = [];
    for (let page = 1; page <= 20; page++) {
        const chunk = JSON.parse(await glab(['api', ...hostArgs, `projects/${projectRef}/merge_requests/${mr}/discussions?per_page=100&page=${page}`]));
        if (!Array.isArray(chunk)) throw new Error('ответ GitLab: ожидался массив');
        all.push(...chunk);
        if (chunk.length < 100) break;
        if (page === 20) throw new Error('больше 2000 тредов: список обрезан, используйте выгрузку mr-comments.sh');
    }
    return all;
}

async function loadThreads() {
    let raw;
    try {
        raw = await fetchDiscussions();
        threadsError = '';
    } catch (error) {
        threadsError = clean(redact(error.message));
        raw = await readJson(discussionsFile, []);
    }
    const threads = raw
        .map((d) => {
            const notes = (d.notes ?? []).filter((n) => !n.system);
            const first = d.notes?.[0] ?? {};
            return {
                id: String(d.id),
                resolvable: Boolean(first.resolvable),
                resolved: Boolean(first.resolved),
                path: first.position?.new_path ?? first.position?.old_path ?? null,
                line: first.position?.new_line ?? first.position?.old_line ?? null,
                notes: notes.map((n) => ({ id: Number(n.id) || 0, author: n.author?.username ?? '?', name: String(n.author?.name ?? ''), at: String(n.created_at ?? ''), body: String(n.body ?? '') })),
            };
        })
        .filter((t) => t.notes.length > 0);
    knownNotes = new Set(threads.flatMap((t) => t.notes.map((n) => n.id)));
    return threads;
}

// Реакции (award emoji) на комментарии треда. Запись идёт от имени вашего glab, как и публикация ответов:
// набор эмодзи фиксирован, а note_id должен принадлежать обсуждениям этого MR (проверка по свежей выгрузке из GitLab).
const REACTIONS = ['thumbsup', 'thumbsdown', 'smile', 'tada', 'confused', 'heart', 'rocket', 'eyes'];
let me = '';
async function currentUser() {
    if (!me) me = clean(JSON.parse(await glab(['api', ...hostArgs, 'user'])).username);
    return me;
}
const awardsBase = (noteId) => `projects/${projectRef}/merge_requests/${mr}/notes/${noteId}/award_emoji`;
const fetchAwards = async (noteId) => {
    const list = JSON.parse(await glab(['api', ...hostArgs, `${awardsBase(noteId)}?per_page=100`]));
    return Array.isArray(list) ? list : [];
};
const noteAwards = async (noteId, user) => summarizeAwards(await fetchAwards(noteId), user);
function summarizeAwards(list, user) {
    const byName = new Map();
    for (const a of list) {
        const name = String(a?.name ?? '');
        if (!REACTIONS.includes(name)) continue;
        const entry = byName.get(name) ?? { name, users: [], mine: false };
        const username = clean(a.user?.username ?? '');
        entry.users.push(username);
        if (username === user) entry.mine = true;
        byName.set(name, entry);
    }
    return REACTIONS.filter((n) => byName.has(n)).map((n) => byName.get(n));
}

async function loadAwards() {
    const user = await currentUser();
    const ids = (await loadThreads()).flatMap((t) => t.notes.map((n) => n.id)).filter(Boolean);
    const awards = {};
    let failed = 0;
    let next = 0;
    // Не больше 5 запросов одновременно: у MR с большой перепиской их десятки.
    await Promise.all(Array.from({ length: Math.min(5, ids.length) }, async () => {
        while (next < ids.length) {
            const id = ids[next++];
            try {
                awards[id] = await noteAwards(id, user);
            } catch {
                failed++;
            }
        }
    }));
    return { awards, user, failed };
}

async function toggleReaction(body) {
    const noteId = Number(body.note_id);
    const emoji = String(body.emoji ?? '');
    if (!Number.isInteger(noteId) || noteId <= 0 || !REACTIONS.includes(emoji)) throw Object.assign(new Error('недопустимая реакция'), { status: 400 });
    // Номер сверяется с последней выгрузкой; повторный запрос в GitLab нужен только для нового комментария.
    if (!knownNotes.has(noteId)) await loadThreads();
    if (!knownNotes.has(noteId)) throw Object.assign(new Error('комментарий не из этого MR'), { status: 404 });
    const user = await currentUser();
    const raw = await fetchAwards(noteId);
    const mine = raw.find((a) => a?.name === emoji && a.user?.username === user);
    if (mine) await glab(['api', ...hostArgs, '-X', 'DELETE', `${awardsBase(noteId)}/${Number(mine.id)}`]);
    else await glab(['api', ...hostArgs, '-X', 'POST', awardsBase(noteId), '-f', `name=${emoji}`]);
    // Итог собирается из уже полученного списка: лишний запрос на повторное чтение не нужен.
    const after = mine ? raw.filter((a) => a !== mine) : [...raw, { name: emoji, user: { username: user } }];
    return { note_id: noteId, awards: summarizeAwards(after, user) };
}

// Выжимка MR, которую агент пишет в начале ревью (формат - в .agents/skills/mr-review/Review.md). Показывается в UI сверху.
async function loadSummary() {
    const data = await readJson(summaryFile, null);
    if (!data) return null;
    const strings = (value) => (Array.isArray(value) ? value.map(String).filter(Boolean) : []);
    return {
        title: String(data.title ?? ''),
        summary: String(data.summary ?? ''),
        scope: String(data.scope ?? ''),
        changes: strings(data.changes),
        focus: strings(data.focus),
    };
}

// Замечания ревьюера (сценарий «ревью чужого MR»), которые агент пишет в mr-<N>-findings.json (формат - в
// .agents/skills/mr-review/Review.md). Решения пользователя UI пишет
// отдельно в mr-<N>-decisions.json ({"decisions": {"<id>": {"decision", "note"}}}): агент его только читает.
const LEVELS = ['блокер', 'важно', 'придирка', 'вопрос'];
const DECISIONS = ['accept', 'reject', 'discuss'];
// Строки diff по файлам: для каждой строки нового файла (и удалённых рядом с ней) - { n, o, t: '+' | '-' | ' ', text };
// n - номер в новом файле, o - в старом (нужен для привязки комментария к неизменённой строке).
// Файл читается только как текст: код MR с диска не берётся, показывается именно то, что в diff.
async function loadDiffLines() {
    let text;
    try {
        text = await readText(diffFile);
    } catch (error) {
        if (error.code === 'ENOENT') return new Map();
        throw new Error(`${path.basename(diffFile)}: ${error.message}`);
    }
    const files = new Map();
    let lines = null;
    let n = 0;
    let o = 0;
    // Заголовки файлов (`--- `/`+++ `) распознаются только до первого хунка: внутри хунка такая строка - это
    // удалённая `-- x` или добавленная `++ x`. Остаток хунка отсчитывается по счётчикам из `@@`.
    let oldLeft = 0;
    let newLeft = 0;
    let inHeader = false;
    for (const row of text.split('\n')) {
        const inHunk = oldLeft > 0 || newLeft > 0;
        if (!inHunk && row.startsWith('diff --git ')) {
            inHeader = true;
            lines = null;
        } else if (!inHunk && inHeader && row.startsWith('+++ ')) {
            lines = [];
            files.set(row.slice(4).replace(/^b\//, '').replace(/\t.*$/, ''), lines);
        } else if (!inHunk && inHeader && row.startsWith('--- ')) {
            lines = null;
        } else if (lines && row.startsWith('@@')) {
            inHeader = false;
            oldLeft = Number(/-\d+(?:,(\d+))?/.exec(row)?.[1] ?? 1);
            newLeft = Number(/\+\d+(?:,(\d+))?/.exec(row)?.[1] ?? 1);
            n = Number(/\+(\d+)/.exec(row)?.[1] ?? 0);
            o = Number(/-(\d+)/.exec(row)?.[1] ?? 0);
            lines.push({ n: null, o: null, t: '@', text: row });
        } else if (lines && inHunk && row[0] === '+') {
            newLeft--;
            lines.push({ n: n++, o: null, t: '+', text: row.slice(1) });
        } else if (lines && inHunk && row[0] === ' ') {
            oldLeft--;
            newLeft--;
            lines.push({ n: n++, o: o++, t: ' ', text: row.slice(1) });
        } else if (lines && inHunk && row[0] === '-') {
            oldLeft--;
            lines.push({ n: null, o: o++, t: '-', text: row.slice(1) });
        }
    }
    return files;
}

const SNIPPET_RADIUS = 6;
const DIFF_LINE_LIMIT = 2000;
function snippetOf(files, file, line) {
    const lines = files.get(file);
    const target = Number(line);
    if (!lines || !target) return null;
    const index = lines.findIndex((l) => l.n === target);
    if (index < 0) return null;
    return lines
        .slice(Math.max(0, index - SNIPPET_RADIUS), index + SNIPPET_RADIUS + 1)
        .filter((l) => l.t !== '@')
        .map((l) => ({ n: l.n, t: l.t, text: l.text.slice(0, 300), on: l.n === target }));
}

async function loadFindings() {
    const data = await readJson(findingsFile, null);
    if (!data) return [];
    const files = await loadDiffLines();
    return (Array.isArray(data.findings) ? data.findings : [])
        .filter((f) => typeof f?.id === 'string' && f.id !== '')
        .map((f) => ({
            id: f.id,
            level: LEVELS.includes(f.level) ? f.level : 'вопрос',
            file: String(f.file ?? ''),
            line: f.line == null ? '' : String(f.line),
            snippet: snippetOf(files, String(f.file ?? ''), f.line),
            title: String(f.title ?? ''),
            body: String(f.body ?? ''),
            comment: String(f.comment ?? ''),
        }));
}

async function loadDecisions() {
    const data = await readJson(decisionsFile, {});
    const decisions = {};
    for (const [id, d] of Object.entries(data?.decisions ?? {})) {
        decisions[id] = { decision: DECISIONS.includes(d?.decision) ? d.decision : '', note: String(d?.note ?? '') };
    }
    return decisions;
}

const updateDecisions = (patch) =>
    locked(async () => {
        const decisions = await loadDecisions();
        for (const [id, d] of Object.entries(patch.decisions ?? {})) {
            if (!d || typeof d !== 'object') continue;
            decisions[id] = { decision: DECISIONS.includes(d.decision) ? d.decision : '', note: String(d.note ?? '') };
        }
        await writeAtomic(decisionsFile, `${JSON.stringify({ decisions }, null, 2)}\n`);
        return {};
    });

// Подсказка по `@`: сначала участники обсуждений MR (чаще писавшие - выше), затем постоянный список
// из people.json (только логины), без повторов.
async function loadPeople() {
    const people = new Map();
    for (const d of await readJson(discussionsFile, [])) {
        for (const n of d.notes ?? []) {
            const username = n.author?.username;
            if (!username) continue;
            const person = people.get(username) ?? { username, name: String(n.author.name ?? ''), count: 0 };
            person.count++;
            people.set(username, person);
        }
    }
    const result = [...people.values()].sort((x, y) => y.count - x.count).map(({ username, name }) => ({ username, name }));
    for (const username of await readJson(path.join(here, 'people.json'), [])) {
        if (typeof username === 'string' && !people.has(username)) result.push({ username, name: '' });
    }
    return result;
}

// Файл черновиков (формат - в Feedback.md): UI владеет полями reply/resolve/note_for_agent/agent_action,
// сервер - replied/resolved/error/status, handoff ставит кнопка «Передать агенту». Версия файла (sha1 текста)
// защищает от затирания: запись или публикация по устаревшей версии отклоняется с 409.
const ACTIONS = ['fix', 'reply', 'revise', 'skip'];
const EMPTY_DRAFT = { reply: '', resolve: false, note_for_agent: '', agent_action: '', posted: '', replied: false, resolved: false, error: '' };
// Что нельзя публиковать из черновика, который мог написать не пользователь. Строка вида `/approve` или `/merge`
// в комментарии GitLab исполняется как быстрая команда от имени пользователя (регистр не важен, после имени
// допустим любой пробельный или невидимый символ, перед ним тоже), HTML-комментарий, управляющие, bidi- и
// невидимые символы прячут текст от пользователя в окне подтверждения.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0]/;
const QUICK_ACTION = /^[\s\p{Z}\p{Cf}]*\/[a-z_]+(?=[\s\p{Z}\p{Cf}]|$)/imu;
// Массовое упоминание (@all уведомляет всех участников проекта) и картинки: внешний URL в картинке уходит
// просматривающим и может нести данные, прочитанные агентом.
const MASS_MENTION = /(^|[^\w@./-])@(all|here|everyone)(?![\w-])/i;
const IMAGE = /!\[[^\]]*\]\s*\(|!\[[^\]]*\]\s*\[|<img[\s>\/]/i;
function unsafeReply(reply) {
    if (CONTROL_CHARS.test(reply)) return 'в ответе есть управляющие символы';
    if (reply.includes('<!--')) return 'в ответе есть HTML-комментарий';
    if (MASS_MENTION.test(reply)) return 'ответ упоминает @all: укажите конкретных людей';
    if (IMAGE.test(reply)) return 'в ответе есть картинка (внешний URL): замените ссылкой';
    if (QUICK_ACTION.test(reply)) return 'ответ содержит строку-команду GitLab (/approve, /merge ...): перефразируйте';
    return '';
}
const HEX_ID = /^[0-9a-f]+$/;

const conflict = () => Object.assign(new Error('replies.json изменён вне UI (агентом?): обновите страницу'), { status: 409 });
// Опубликованным считается ответ, текст которого (без пробелов по краям) совпадает с тем, что ушёл в GitLab.
const sameText = (a, b) => a.trim() !== '' && a.trim() === b.trim();
const versionOf = (text) => createHash('sha1').update(text).digest('hex');
const statusOf = (d) => (d.error ? 'error' : d.resolved ? 'resolved' : d.replied ? 'published' : 'draft');

async function loadDraftFile() {
    let text = null;
    try {
        text = await readText(repliesFile);
    } catch (error) {
        if (error.code !== 'ENOENT') throw new Error(`${path.basename(repliesFile)}: ${error.message}`);
    }
    let data = {};
    if (text !== null && text.trim() !== '') {
        try {
            data = JSON.parse(text);
        } catch (error) {
            throw new Error(`${path.basename(repliesFile)} повреждён: ${error.message}`);
        }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path.basename(repliesFile)}: ожидался объект`);
    if (data.replies !== undefined && !Array.isArray(data.replies)) throw new Error(`${path.basename(repliesFile)}: replies должен быть массивом`);
    const drafts = {};
    for (const r of data.replies ?? []) {
        if (typeof r?.discussion_id !== 'string') continue;
        // «Опубликовано» выводится из posted (текст, который реально ушёл в GitLab): вернули прежний текст -
        // повторно не публикуется, изменили - публикуется как новый ответ. Старый формат хранил только status.
        const reply = String(r.reply ?? '');
        const posted =
            typeof r.posted === 'string'
                ? r.posted
                : typeof r.replied === 'boolean'
                  ? r.replied ? reply : ''
                  : r.status === 'published' || r.status === 'resolved' ? reply : '';
        drafts[r.discussion_id] = {
            reply,
            resolve: Boolean(r.resolve),
            note_for_agent: String(r.note_for_agent ?? ''),
            agent_action: ACTIONS.includes(r.agent_action) ? r.agent_action : '',
            posted,
            replied: sameText(reply, posted),
            resolved: r.resolved === true || r.status === 'resolved',
            error: String(r.error ?? ''),
        };
    }
    const handoff = typeof data.handoff?.at === 'string' ? { at: data.handoff.at } : null;
    return { general_note: String(data.general_note ?? ''), handoff, drafts, version: text === null ? '' : versionOf(text) };
}

async function saveDraftFile({ general_note, handoff, drafts }) {
    const replies = Object.entries(drafts).map(([discussion_id, d]) => ({ discussion_id, ...d, status: statusOf(d) }));
    const text = `${JSON.stringify({ general_note, handoff, replies }, null, 2)}\n`;
    await writeAtomic(repliesFile, text);
    return versionOf(text);
}

// Чтение-изменение-запись под очередью.
let lock = Promise.resolve();
const locked = (task) => {
    const run = lock.then(task);
    lock = run.catch(() => {});
    return run;
};

const updateDrafts = (patch) =>
    locked(async () => {
        const file = await loadDraftFile();
        if (patch.version !== file.version) throw conflict();
        if (patch.general_note !== undefined) file.general_note = String(patch.general_note);
        if (patch.handoff === true) file.handoff = { at: new Date().toISOString() };
        for (const [id, d] of Object.entries(patch.drafts ?? {})) {
            if (!HEX_ID.test(id) || !d || typeof d !== 'object') continue;
            const prev = file.drafts[id] ?? EMPTY_DRAFT;
            const next = {
                ...prev,
                reply: String(d.reply ?? ''),
                resolve: Boolean(d.resolve),
                note_for_agent: String(d.note_for_agent ?? ''),
                agent_action: ACTIONS.includes(d.agent_action) ? d.agent_action : '',
            };
            // Новый текст ответа - это новый ответ; изменение одного лишь флага «закрыть» опубликованное не сбрасывает.
            next.replied = sameText(next.reply, next.posted);
            if (next.reply !== prev.reply || next.resolve !== prev.resolve) next.error = '';
            file.drafts[id] = next;
        }
        return { version: await saveDraftFile(file) };
    });

// Публикует треды по тексту из файла, но только если он совпадает с тем, что пользователь видел в подтверждении
// (expected_reply/expected_resolve): правка агента между подтверждением и публикацией отправлена не будет.
// Каждый тред обрабатывается по свежему содержимому файла, поэтому правки агента во время пакета не затираются.
// Статус пишется после каждого треда; если запись не удалась, остальные треды не отправляются, иначе после
// перезапуска они ушли бы повторно.
const publish = (body) =>
    locked(async () => {
        const start = await loadDraftFile();
        if (body.version !== start.version) throw conflict();
        const threads = new Map((await loadThreads()).map((t) => [t.id, t]));
        const results = [];
        let version = start.version;
        let warning = '';
        for (const item of Array.isArray(body.items) ? body.items : []) {
            const id = String(item?.discussion_id);
            const result = { discussion_id: id, replied: false, resolved: false, current: null, stale: false, error: null };
            results.push(result);
            if (warning) {
                result.error = 'не отправлено: статус публикации не записывается';
                continue;
            }
            let file;
            try {
                file = await loadDraftFile();
            } catch (error) {
                warning = `файл черновиков недоступен: ${redact(error.message)}`;
                result.error = 'не отправлено: файл черновиков недоступен';
                continue;
            }
            const draft = file.drafts[id];
            const thread = threads.get(id);
            if (!HEX_ID.test(id) || !thread || !draft) {
                result.error = 'неизвестный тред или нет черновика';
                continue;
            }
            if (typeof item.expected_reply !== 'string' || item.expected_reply !== draft.reply || Boolean(item.expected_resolve) !== draft.resolve) {
                result.error = 'текст или флаг закрытия изменились после подтверждения: проверьте карточку и повторите';
                result.stale = true;
                result.current = { replied: draft.replied, posted: draft.posted, resolved: draft.resolved };
                continue;
            }
            const base = `projects/${projectRef}/merge_requests/${mr}/discussions/${id}`;
            try {
                const reply = draft.reply.trim();
                if (reply && !draft.replied) {
                    const problem = unsafeReply(draft.reply);
                    if (problem) throw new Error(problem);
                    await glab(['api', ...hostArgs, '-X', 'POST', `${base}/notes`, '-f', `body=${reply}`]);
                    draft.posted = draft.reply;
                    draft.replied = true;
                    result.replied = true;
                }
                if (draft.resolve && !draft.resolved && thread.resolvable && !thread.resolved) {
                    await glab(['api', ...hostArgs, '-X', 'PUT', base, '-F', 'resolved=true']);
                    draft.resolved = true;
                    result.resolved = true;
                }
                draft.error = '';
            } catch (error) {
                draft.error = redact(error.message);
            }
            result.error = draft.error || null;
            // Вызовы glab долгие, и за это время агент мог изменить файл: статус накладывается на свежее содержимое,
            // а не записывается из прочитанного до вызовов (иначе правки агента были бы затёрты).
            // Ответ уже мог уйти в GitLab: сбой записи статуса не должен скрывать результат от UI.
            try {
                const fresh = await loadDraftFile();
                const target = fresh.drafts[id] ?? draft;
                Object.assign(target, { posted: draft.posted, resolved: draft.resolved, error: draft.error });
                target.replied = sameText(target.reply, target.posted);
                fresh.drafts[id] = target;
                result.current = { replied: target.replied, posted: target.posted, resolved: target.resolved };
                version = await saveDraftFile(fresh);
            } catch (error) {
                result.current = { replied: draft.replied, posted: draft.posted, resolved: draft.resolved };
                warning = `публикация остановлена, статус не записан: ${redact(error.message)}`;
            }
        }
        return { results, version: warning ? null : version, ...(warning ? { warning } : {}) };
    });

// Публикация замечаний ревью (findings.json) новыми обсуждениями MR: с file:line - тредом к строке diff, без строки -
// общим обсуждением с путём файла в начале текста. Уходит текст, который пользователь видел в подтверждении
// (его можно править в карточке); путь и строку сервер берёт из findings.json, а не из запроса. Статус пишется в
// mr-<N>-published.json после каждого замечания: уже опубликованное повторно не отправляется.
const FINDING_LIMIT = 4000;
const SHA = /^[0-9a-f]{40}$/;
async function loadPublished() {
    const data = await readJson(publishedFile, {});
    const published = {};
    for (const [id, p] of Object.entries(data ?? {})) {
        if (p && typeof p === 'object') published[id] = { discussion_id: String(p.discussion_id ?? ''), posted: String(p.posted ?? ''), at: String(p.at ?? '') };
    }
    return published;
}

// Тело запроса передаётся файлом (--input): вложенный объект position через -f/-F glab надёжно не собирает.
// Каталог во временной папке с правами 0600 удаляется сразу после вызова.
async function createDiscussion(payload) {
    const tmp = await mkdtemp(path.join(tmpdir(), 'mr-ui-'));
    try {
        const file = path.join(tmp, 'body.json');
        await writeFile(file, JSON.stringify(payload), { mode: 0o600 });
        return await glab(['api', ...hostArgs, '-X', 'POST', `projects/${projectRef}/merge_requests/${mr}/discussions`, '-H', 'Content-Type: application/json', '--input', file]);
    } finally {
        await rm(tmp, { recursive: true, force: true });
    }
}

async function loadDiffRefs() {
    const refs = JSON.parse(await glab(['api', ...hostArgs, `projects/${projectRef}/merge_requests/${mr}`])).diff_refs;
    if (![refs?.base_sha, refs?.start_sha, refs?.head_sha].every((s) => SHA.test(s ?? ''))) throw new Error('GitLab не вернул diff_refs MR');
    return { base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha };
}

const publishFindings = (body) =>
    locked(async () => {
        const findings = new Map((await loadFindings()).map((f) => [f.id, f]));
        const diff = await loadDiffLines();
        const published = await loadPublished();
        const results = [];
        let refs = null;
        let warning = '';
        for (const item of Array.isArray(body.items) ? body.items : []) {
            const id = String(item?.id);
            const result = { id, published: false, discussion_id: '', posted: '', error: null };
            results.push(result);
            if (warning) {
                result.error = 'не отправлено: статус публикации не записывается';
                continue;
            }
            const finding = findings.get(id);
            const text = typeof item?.comment === 'string' ? item.comment.trim() : '';
            if (!finding) {
                result.error = 'неизвестное замечание';
                continue;
            }
            if (String(item?.expected_file ?? '') !== finding.file || String(item?.expected_line ?? '') !== finding.line) {
                result.error = 'файл или строка замечания изменились после подтверждения: обновите страницу и повторите';
                continue;
            }
            if (published[id]) {
                Object.assign(result, { published: true, discussion_id: published[id].discussion_id, posted: published[id].posted, error: 'уже опубликовано' });
                continue;
            }
            if (!text || text.length > FINDING_LIMIT) {
                result.error = `текст пуст или длиннее ${FINDING_LIMIT} символов`;
                continue;
            }
            try {
                const payload = { body: finding.file && !finding.line ? `\`${finding.file}\`: ${text}` : text };
                const problem = unsafeReply(payload.body);
                if (problem) throw new Error(problem);
                if (finding.file && finding.line) {
                    const row = diff.get(finding.file)?.find((l) => l.n === Number(finding.line));
                    if (!row) throw new Error(`строка ${finding.file}:${finding.line} не входит в diff: к ней нельзя привязать тред`);
                    refs ??= await loadDiffRefs();
                    payload.position = {
                        position_type: 'text',
                        ...refs,
                        new_path: finding.file,
                        old_path: finding.file,
                        new_line: row.n,
                        ...(row.t === ' ' ? { old_line: row.o } : {}),
                    };
                }
                const out = await createDiscussion(payload);
                let discussionId = '';
                try {
                    discussionId = String(JSON.parse(out).id ?? '');
                } catch {}
                published[id] = { discussion_id: discussionId, posted: text, at: new Date().toISOString() };
                Object.assign(result, { published: true, discussion_id: discussionId, posted: text });
            } catch (error) {
                result.error = redact(error.message);
                continue;
            }
            // Тред уже создан: если статус не записался, остальные замечания не отправляются, иначе после
            // перезапуска они ушли бы повторно.
            try {
                await writeAtomic(publishedFile, `${JSON.stringify(published, null, 2)}\n`);
            } catch (error) {
                warning = `публикация остановлена, статус не записан: ${redact(error.message)}`;
            }
        }
        return { results, ...(warning ? { warning } : {}) };
    });

// Комментарии пользователя к строкам diff (mr-<N>-notes.json, формат - в .agents/skills/mr-review/Feedback.md).
// Пишутся из UI к строке нового файла из mr-<N>.diff; адресуются агенту (to_agent, agent_action) и/или публикуются
// новым тредом MR. Поля по владельцам: UI - file/line/text/to_agent/agent_action, сервер - posted/discussion_id/
// error/at, агент - только agent_reply. Текст опубликованного комментария не меняется и не удаляется.
const NOTE_ACTIONS = ['fix', 'reply'];
const NOTE_ID = /^u[0-9a-z]{1,16}$/;
async function loadNotes() {
    const data = await readJson(notesFile, { notes: [] });
    const notes = [];
    for (const n of Array.isArray(data?.notes) ? data.notes : []) {
        if (typeof n?.id !== 'string' || !NOTE_ID.test(n.id)) continue;
        notes.push({
            id: n.id,
            file: String(n.file ?? ''),
            line: Number(n.line) || null,
            text: String(n.text ?? ''),
            to_agent: Boolean(n.to_agent),
            agent_action: NOTE_ACTIONS.includes(n.agent_action) ? n.agent_action : '',
            agent_reply: String(n.agent_reply ?? ''),
            posted: String(n.posted ?? ''),
            discussion_id: String(n.discussion_id ?? ''),
            note_id: String(n.note_id ?? ''),
            error: String(n.error ?? ''),
            at: String(n.at ?? ''),
        });
    }
    return notes;
}
const saveNotes = (notes) => writeAtomic(notesFile, `${JSON.stringify({ notes }, null, 2)}\n`);

// Чтение-изменение-запись по id: поля агента (agent_reply) и сервера сохраняются, UI меняет только свои.
// Новый текст после ответа агента сбрасывает agent_reply: агент перечитает комментарий заново.
const updateNotes = (patch) =>
    locked(async () => {
        const byId = new Map((await loadNotes()).map((n) => [n.id, n]));
        const diff = await loadDiffLines();
        for (const [id, n] of Object.entries(patch.notes ?? {})) {
            if (!NOTE_ID.test(id) || !n || typeof n !== 'object') continue;
            const prev = byId.get(id);
            const to_agent = Boolean(n.to_agent);
            const agent_action = NOTE_ACTIONS.includes(n.agent_action) ? n.agent_action : '';
            if (prev?.posted) {
                Object.assign(prev, { to_agent, agent_action });
                continue;
            }
            const file = String(n.file ?? prev?.file ?? '');
            const line = Number(n.line ?? prev?.line) || null;
            if (!line || !diff.get(file)?.some((l) => l.n === line)) continue;
            const text = String(n.text ?? '');
            byId.set(id, {
                ...(prev ?? { agent_reply: '', posted: '', discussion_id: '', error: '', at: new Date().toISOString() }),
                id, file, line, text, to_agent, agent_action,
                agent_reply: prev && text !== prev.text ? '' : (prev?.agent_reply ?? ''),
            });
        }
        for (const id of Array.isArray(patch.delete) ? patch.delete : []) {
            const n = byId.get(String(id));
            if (n && !n.posted) byId.delete(n.id);
        }
        const notes = [...byId.values()];
        await saveNotes(notes);
        return { notes };
    });

// Публикация комментария к строке новым тредом MR: уходит текст из файла, и только если он совпадает с тем,
// что пользователь видел в подтверждении (expected_text). Статус пишется в файл после каждого комментария.
const publishNotes = (body) =>
    locked(async () => {
        const notes = await loadNotes();
        const byId = new Map(notes.map((n) => [n.id, n]));
        const diff = await loadDiffLines();
        const results = [];
        let refs = null;
        let warning = '';
        for (const item of Array.isArray(body.items) ? body.items : []) {
            const id = String(item?.id);
            const note = byId.get(id);
            const result = { id, published: false, discussion_id: '', posted: '', error: null };
            results.push(result);
            if (warning) {
                result.error = 'не отправлено: статус публикации не записывается';
                continue;
            }
            if (!note) {
                result.error = 'неизвестный комментарий';
                continue;
            }
            if (note.posted) {
                Object.assign(result, { published: true, discussion_id: note.discussion_id, posted: note.posted, error: 'уже опубликовано' });
                continue;
            }
            const text = note.text.trim();
            if (typeof item?.expected_text !== 'string' || item.expected_text.trim() !== text) {
                result.error = 'текст изменился после подтверждения: проверьте комментарий и повторите';
                continue;
            }
            if (!text || text.length > FINDING_LIMIT) {
                result.error = `текст пуст или длиннее ${FINDING_LIMIT} символов`;
                continue;
            }
            try {
                const problem = unsafeReply(text);
                if (problem) throw new Error(problem);
                const row = diff.get(note.file)?.find((l) => l.n === note.line);
                if (!row) throw new Error(`строка ${note.file}:${note.line} не входит в diff: к ней нельзя привязать тред`);
                refs ??= await loadDiffRefs();
                const out = await createDiscussion({
                    body: text,
                    position: { position_type: 'text', ...refs, new_path: note.file, old_path: note.file, new_line: row.n, ...(row.t === ' ' ? { old_line: row.o } : {}) },
                });
                let discussionId = '';
                let noteId = '';
                try {
                    const created = JSON.parse(out);
                    discussionId = String(created.id ?? '');
                    noteId = String(created.notes?.[0]?.id ?? '');
                } catch {}
                Object.assign(note, { posted: text, discussion_id: discussionId, note_id: noteId, error: '', at: new Date().toISOString() });
                Object.assign(result, { published: true, discussion_id: discussionId, posted: text });
            } catch (error) {
                note.error = redact(error.message);
                result.error = note.error;
            }
            try {
                await saveNotes(notes);
            } catch (error) {
                if (result.published) warning = `публикация остановлена, статус не записан: ${redact(error.message)}`;
            }
        }
        return { results, ...(warning ? { warning } : {}) };
    });

// Правка и удаление опубликованного комментария к строке: GitLab разрешает это только автору заметки, поэтому
// чужой тред через эти вызовы не изменить. Номер заметки берётся из ответа на создание треда, для старых записей -
// из самого треда. Правка уходит только с текстом, который пользователь видел в подтверждении (expected_posted -
// прежний текст, text - новый).
const DISCUSSION_ID = /^[0-9a-f]{6,64}$/;
const NOTE_NUM = /^\d{1,12}$/;
async function resolveNoteId(note) {
    if (NOTE_NUM.test(note.note_id)) return note.note_id;
    if (!DISCUSSION_ID.test(note.discussion_id)) throw new Error('у комментария нет номера треда GitLab');
    const discussion = JSON.parse(await glab(['api', ...hostArgs, `projects/${projectRef}/merge_requests/${mr}/discussions/${note.discussion_id}`]));
    const id = String(discussion?.notes?.[0]?.id ?? '');
    if (!NOTE_NUM.test(id)) throw new Error('GitLab не вернул номер заметки треда');
    return id;
}
const noteUrl = (noteId) => `projects/${projectRef}/merge_requests/${mr}/notes/${noteId}`;

const editNote = (body) =>
    locked(async () => {
        const notes = await loadNotes();
        const note = notes.find((n) => n.id === String(body.id));
        if (!note || !note.posted) throw Object.assign(new Error('комментарий не опубликован'), { status: 404 });
        if (typeof body.expected_posted !== 'string' || body.expected_posted !== note.posted) throw Object.assign(new Error('опубликованный текст изменился: обновите страницу и повторите'), { status: 409 });
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > FINDING_LIMIT) throw Object.assign(new Error(`текст пуст или длиннее ${FINDING_LIMIT} символов`), { status: 400 });
        const problem = unsafeReply(text);
        if (problem) throw Object.assign(new Error(problem), { status: 400 });
        try {
            const noteId = await resolveNoteId(note);
            await glab(['api', ...hostArgs, '-X', 'PUT', noteUrl(noteId), '-f', `body=${text}`]);
            Object.assign(note, { note_id: noteId, posted: text, text, error: '', at: new Date().toISOString() });
        } catch (error) {
            note.error = redact(error.message);
        }
        await saveNotes(notes);
        return { note };
    });

const deleteNote = (body) =>
    locked(async () => {
        const notes = await loadNotes();
        const note = notes.find((n) => n.id === String(body.id));
        if (!note || !note.posted) throw Object.assign(new Error('комментарий не опубликован'), { status: 404 });
        try {
            const noteId = await resolveNoteId(note);
            await glab(['api', ...hostArgs, '-X', 'DELETE', noteUrl(noteId)]);
        } catch (error) {
            note.error = redact(error.message);
            await saveNotes(notes);
            return { deleted: false, note };
        }
        await saveNotes(notes.filter((n) => n !== note));
        return { deleted: true };
    });

// Правка и удаление своих заметок в тредах MR (ответов из UI и любых других от имени владельца glab). Заметка
// должна принадлежать треду этого MR и текущему пользователю; правка уходит только с текстом, который
// пользователь видел в подтверждении (expected_body - прежний текст). Если заметка была ответом из UI, её статус
// в replies.json (поля сервера posted/replied) обновляется, чтобы карточка не показывала удалённый ответ.
async function ownNote(body) {
    const discussionId = String(body.discussion_id ?? '');
    const noteId = String(body.note_id ?? '');
    if (!HEX_ID.test(discussionId) || !NOTE_NUM.test(noteId)) throw Object.assign(new Error('неизвестный тред или заметка'), { status: 400 });
    const thread = (await loadThreads()).find((t) => t.id === discussionId);
    const note = thread?.notes.find((n) => String(n.id) === noteId);
    if (!note) throw Object.assign(new Error('заметка не найдена в тредах этого MR'), { status: 404 });
    if (note.author !== (await currentUser())) throw Object.assign(new Error('это не ваша заметка: GitLab разрешает менять только свои'), { status: 403 });
    return { thread, note, noteId };
}

async function syncDraftAfterNoteChange(discussionId, oldBody, newBody) {
    const file = await loadDraftFile();
    const draft = file.drafts[discussionId];
    if (!draft || !sameText(draft.posted, oldBody)) return null;
    draft.posted = newBody;
    draft.reply = newBody;
    draft.replied = sameText(draft.reply, draft.posted);
    draft.error = '';
    return saveDraftFile(file);
}

const editThreadNote = (body) =>
    locked(async () => {
        const { note, noteId } = await ownNote(body);
        if (typeof body.expected_body !== 'string' || body.expected_body.trim() !== note.body.trim()) throw Object.assign(new Error('текст заметки изменился: обновите страницу и повторите'), { status: 409 });
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > FINDING_LIMIT) throw Object.assign(new Error(`текст пуст или длиннее ${FINDING_LIMIT} символов`), { status: 400 });
        const problem = unsafeReply(text);
        if (problem) throw Object.assign(new Error(problem), { status: 400 });
        await glab(['api', ...hostArgs, '-X', 'PUT', noteUrl(noteId), '-f', `body=${text}`]);
        const version = await syncDraftAfterNoteChange(String(body.discussion_id), note.body, text);
        return { edited: true, version };
    });

const deleteThreadNote = (body) =>
    locked(async () => {
        const { note, noteId } = await ownNote(body);
        await glab(['api', ...hostArgs, '-X', 'DELETE', noteUrl(noteId)]);
        const version = await syncDraftAfterNoteChange(String(body.discussion_id), note.body, '');
        return { deleted: true, version };
    });

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) {
                reject(new Error('слишком большой запрос'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('ожидался объект');
                resolve(body);
            } catch {
                reject(new Error('некорректный JSON'));
            }
        });
        req.on('error', reject);
    });
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        // Страница держит токен запуска и публикует от имени пользователя: внешние ресурсы и соединения не нужны.
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
    // Защита от DNS rebinding и чужих страниц: только свой хост и токен запуска.
    const port = server.address().port;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) {
        return send(res, 403, { error: 'host' });
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
        if (req.method === 'GET' && url.pathname === '/') {
            return send(res, 200, html, 'text/html; charset=utf-8');
        }
        const font = url.pathname.startsWith('/fonts/') ? url.pathname.slice('/fonts/'.length) : null;
        if (req.method === 'GET' && fonts.has(font)) {
            res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400', 'x-content-type-options': 'nosniff' });
            return res.end(fonts.get(font));
        }
        if (req.headers['x-mr-token'] !== token) return send(res, 401, { error: 'нет токена запуска' });
        if (req.method === 'GET' && url.pathname === '/api/state') {
            // Битый файл не ломает UI целиком: показываем что можно, а запись блокируем (version: null).
            const warnings = [];
            const safe = async (task, fallback) => {
                try {
                    return await task();
                } catch (error) {
                    warnings.push(error.message);
                    return fallback;
                }
            };
            const drafts = await safe(loadDraftFile, { general_note: '', handoff: null, drafts: {}, version: null });
            return send(res, 200, {
                mr,
                info,
                threads: await safe(loadThreads, []),
                threadsError,
                people: await safe(loadPeople, []),
                summary: await safe(loadSummary, null),
                findings: await safe(loadFindings, []),
                diffFiles: await safe(async () => [...(await loadDiffLines()).keys()], []),
                decisions: await safe(loadDecisions, {}),
                published: await safe(loadPublished, {}),
                notes: await safe(loadNotes, []),
                user: await safe(currentUser, ''),
                ...drafts,
                warning: warnings.join('; '),
            });
        }
        if (req.method === 'GET' && url.pathname === '/api/awards') {
            return send(res, 200, await loadAwards());
        }
        if (req.method === 'POST' && url.pathname === '/api/react') {
            return send(res, 200, await toggleReaction(await readBody(req)));
        }
        if (req.method === 'GET' && url.pathname === '/api/threads') {
            return send(res, 200, { threads: await loadThreads(), threadsError });
        }
        if (req.method === 'POST' && url.pathname === '/api/drafts') {
            return send(res, 200, await updateDrafts(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/decisions') {
            return send(res, 200, await updateDecisions(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/publish') {
            return send(res, 200, await publish(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/publish-findings') {
            return send(res, 200, await publishFindings(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/notes') {
            return send(res, 200, await updateNotes(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/publish-notes') {
            return send(res, 200, await publishNotes(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/edit-thread-note') {
            return send(res, 200, await editThreadNote(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/delete-thread-note') {
            return send(res, 200, await deleteThreadNote(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/edit-note') {
            return send(res, 200, await editNote(await readBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/api/delete-note') {
            return send(res, 200, await deleteNote(await readBody(req)));
        }
        // Полный diff одного файла из mr-<N>.diff для просмотра изменений в UI: строки отдаются по запросу, а не
        // в /api/state, чтобы большой MR не грузился целиком при открытии страницы. Путь должен быть из diff.
        if (req.method === 'GET' && url.pathname === '/api/diff') {
            const file = url.searchParams.get('file') ?? '';
            const lines = (await loadDiffLines()).get(file);
            if (!lines) return send(res, 404, { error: 'файла нет в diff' });
            return send(res, 200, { file, lines: lines.map((l) => ({ n: l.n, o: l.o, t: l.t, text: l.text.slice(0, DIFF_LINE_LIMIT) })) });
        }
        send(res, 404, { error: 'не найдено' });
    } catch (error) {
        send(res, error.status ?? 500, { error: error.message });
    }
});

const info = await describeMr();
if (process.env.MR_PROJECT) {
    if (!info.project) {
        fail(`MR_PROJECT задан, но проект проверить не удалось: запуск отменён\n  запрос: glab api --hostname ${process.env.GITLAB_HOST} projects/${projectRef}\n  ответ glab: ${info.error || 'нет'}\n  проверьте MR_PROJECT и GITLAB_HOST (имя хоста без схемы, как в \`glab auth status\`) и доступ токена к проекту`);
    }
    if (info.project.toLowerCase() !== process.env.MR_PROJECT.toLowerCase()) {
        fail(`MR_PROJECT=${process.env.MR_PROJECT}, но glab открыл проект ${info.project}`);
    }
}

server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
    console.log(`Проект GitLab: ${info.project || 'не удалось определить'}${process.env.MR_PROJECT ? ` (MR_PROJECT, хост ${process.env.GITLAB_HOST})` : ' (по git remote, сверьте)'}`);
if (!process.env.MR_PROJECT) console.warn('ВНИМАНИЕ: MR_PROJECT не задан - проект и хост берутся из .git/config рабочей копии, который агент мог изменить. Закрепите: MR_PROJECT=<group/project> GITLAB_HOST=<хост> (см. .devcontainer/README.md).');
    console.log(`MR ${mr}${info.title ? ` «${info.title}»` : ''}: http://127.0.0.1:${server.address().port}/?t=${token}`);
    console.log('Ctrl+C - остановить. Публикация идёт от имени вашего glab.');
});
