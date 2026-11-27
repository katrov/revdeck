export interface CommandEntry {
    id: string;
    usage: string;
    ru: string;
    en: string;
    example?: string;
}

export interface CommandGroup {
    id: string;
    ru: string;
    en: string;
    commands: CommandEntry[];
}

export const COMMAND_GROUPS: CommandGroup[] = [
    {
        id: 'setup',
        ru: 'Установка и демон',
        en: 'Setup and daemon',
        commands: [
            {
                id: 'init',
                usage: 'revdeck init [--force] [--provider gitlab|github|auto] [--adapters a,b]',
                ru: 'Создаёт .revdeck.yml, ставит скилл, MCP-конфиг и адаптеры харнессов. Провайдер по умолчанию — GitLab, если git remote не распознан.',
                en: 'Creates .revdeck.yml, installs the skill, MCP config and harness adapters. GitLab is the default provider when the git remote is not recognized.',
                example: 'revdeck init --provider gitlab',
            },
            {
                id: 'doctor',
                usage: 'revdeck doctor',
                ru: 'Проверяет Node.js, доступность glab/gh, авторизацию, демон и установленные адаптеры.',
                en: 'Checks Node.js, glab/gh availability, authentication, the daemon and installed adapters.',
            },
            {
                id: 'daemon',
                usage: 'revdeck daemon <start|stop|restart|status|logs|install|uninstall>',
                ru: 'Управляет локальным демоном. install создаёт systemd user unit на Linux или launchd plist на macOS.',
                en: 'Manages the local daemon. install creates a systemd user unit on Linux or a launchd plist on macOS.',
            },
            {
                id: 'ui',
                usage: 'revdeck ui [N]',
                ru: 'Открывает локальный веб-интерфейс, при необходимости сразу с ревью N.',
                en: 'Opens the local web UI, optionally focused on review N.',
            },
            {
                id: 'eject',
                usage: 'revdeck eject [--yes] [--keep-config]',
                ru: 'Удаляет из проекта конфиг, скиллы, файлы команд и MCP-запись revdeck. Без --yes только показывает план.',
                en: 'Removes the revdeck config, skills, command files and MCP entry from the project. Without --yes it only prints the plan.',
            },
            {
                id: 'devcontainer',
                usage: 'revdeck devcontainer [--write]',
                ru: 'Подключает devcontainer к демону и state-каталогу хоста.',
                en: 'Connects a devcontainer to the host daemon and state directory.',
            },
        ],
    },
    {
        id: 'projects',
        ru: 'Проекты и ревью',
        en: 'Projects and reviews',
        commands: [
            {
                id: 'projects',
                usage: 'revdeck projects',
                ru: 'Показывает реестр проектов, число ревью и корни рабочих копий. В UI здесь же можно добавить, переименовать и удалить проект.',
                en: 'Lists the project registry, review counts and working-copy roots. The UI can also add, rename and delete projects here.',
            },
            {
                id: 'projects-add',
                usage: 'revdeck projects add <path>',
                ru: 'Регистрирует проект по рабочей копии до открытия первого ревью. Проект определяется по git remote и .revdeck.yml.',
                en: 'Registers a project from a working copy before its first review. The project is resolved from the git remote and .revdeck.yml.',
                example: 'revdeck projects add ~/work/api',
            },
            {
                id: 'list',
                usage: 'revdeck list [--all] [--remote] [--project <key>]',
                ru: 'Показывает ревью текущего проекта; --all — всех проектов, --remote — запрашивает список с платформы.',
                en: 'Lists reviews of the current project; --all covers every project, --remote asks the platform.',
            },
            {
                id: 'review',
                usage: 'revdeck review <N|URL>',
                ru: 'Ревью чужого MR: открывает ревью и отдаёт контекст с процедурой Review.md. Флаги как у context.',
                en: "Reviews someone else's MR: opens the review and returns context with the Review.md procedure. Same flags as context.",
                example: 'revdeck review 42',
            },
            {
                id: 'feedback',
                usage: 'revdeck feedback <N|URL>',
                ru: 'Замечания к своему MR: открывает ревью и отдаёт контекст с процедурой Feedback.md. Флаги как у context.',
                en: 'Works through findings on your own MR: opens the review and returns context with the Feedback.md procedure. Same flags as context.',
                example: 'revdeck feedback 42',
            },
            {
                id: 'open',
                usage: 'revdeck open <N|URL> [<N|URL> ...] [--branch <name>]',
                ru: 'Загружает одно или несколько ревью без сценария. Если автор известен, подсказывает review или feedback. --platform/--project/--host задают контекст явно.',
                en: 'Loads one or more reviews without a scenario. When the author is known, suggests review or feedback. --platform/--project/--host set the context explicitly.',
                example: 'revdeck open https://gitlab.com/group/project/-/merge_requests/42',
            },
            {
                id: 'status',
                usage: 'revdeck status [N]',
                ru: 'Показывает состояние ревью, ветки, автора и статистику изменений.',
                en: 'Shows the review state, branches, author and change stats.',
            },
        ],
    },
    {
        id: 'review',
        ru: 'Контекст и разбор ревью',
        en: 'Review context and analysis',
        commands: [
            {
                id: 'context',
                usage: 'revdeck context <N> [--scenario review|feedback] [--role <role>] [--shard i/N]',
                ru: 'Собирает контекст для агента: правила проекта, diff, треды, замечания и черновики. Сценарий, роль и шард делят работу между агентами.',
                en: 'Builds agent context: project rules, diff, threads, findings and drafts. Scenario, role and shard split the work between agents.',
                example: 'revdeck context 42 --role correctness',
            },
            {
                id: 'threads',
                usage: 'revdeck threads <N>',
                ru: 'Показывает обсуждения ревью и их состояние.',
                en: 'Lists review discussions and their state.',
            },
            {
                id: 'diff',
                usage: 'revdeck diff <N> [--file <path>]',
                ru: 'Показывает файлы и hunks diff, при необходимости только выбранный файл.',
                en: 'Shows diff files and hunks, optionally for one file.',
            },
            {
                id: 'rules',
                usage: 'revdeck rules [<N>] [--explain <path>]',
                ru: 'Показывает эффективные правила проекта и объясняет, какие документы выбраны для пути.',
                en: 'Shows the effective project rules and explains which documents were selected for a path.',
            },
            {
                id: 'checks',
                usage: 'revdeck checks <N> [--run --yes] [--ids a,b]',
                ru: 'Планирует проверки проекта из .revdeck.yml. Запускает их только с --run --yes.',
                en: 'Plans project checks from .revdeck.yml. Runs them only with --run --yes.',
            },
            {
                id: 'stats',
                usage: 'revdeck stats <N>',
                ru: 'Аналитика ревью: решения по замечаниям, acceptance rate, треды и черновики.',
                en: 'Review analytics: finding decisions, acceptance rate, threads and drafts.',
            },
            {
                id: 'scan',
                usage: 'revdeck scan <N>',
                ru: 'Сканирует diff на секреты, если включён review.secrets. Превью маскируются.',
                en: 'Scans the diff for secrets when review.secrets is enabled. Previews are masked.',
            },
            {
                id: 'versions',
                usage: 'revdeck versions <N>',
                ru: 'История версий ревью по commit SHA, если включён review.history.',
                en: 'Review version history by commit SHA when review.history is enabled.',
            },
        ],
    },
    {
        id: 'drafting',
        ru: 'Черновики и публикация',
        en: 'Drafts and publishing',
        commands: [
            {
                id: 'findings',
                usage: 'revdeck findings <N> [list|set --file <json>|decide --id <id> --decision accept|reject|discuss]',
                ru: 'Читает, записывает и размечает замечания. set заменяет набор, decide фиксирует решение человека.',
                en: 'Reads, writes and triages findings. set replaces the set; decide records the human decision.',
            },
            {
                id: 'summary',
                usage: 'revdeck summary <N> [--file <json>]',
                ru: 'Показывает или сохраняет выжимку ревью: scope, summary, changes и focus.',
                en: 'Shows or stores the review summary: scope, summary, changes and focus.',
            },
            {
                id: 'reply',
                usage: 'revdeck reply <N> --thread <id> (--body <text> | --body-file <file> | -) [--resolve]',
                ru: 'Пишет черновик ответа в тред. --resolve добавляет намерение закрыть тред; публикует человек.',
                en: 'Drafts a reply in a thread. --resolve marks the intent to close it; a human publishes it.',
            },
            {
                id: 'notes',
                usage: 'revdeck notes <N> <list|add|update|delete|reply>',
                ru: 'Комментарии человека к строкам diff. add создаёт заметку, reply отвечает агенту.',
                en: 'Human comments on diff lines. add creates a note; reply answers the agent.',
            },
            {
                id: 'messages',
                usage: 'revdeck messages <N> [list|ask|reply] [--text <text>]',
                ru: 'Вопросы агенту по всему ревью и ответы агента. Сообщения не публикуются в платформу и попадают в контекст.',
                en: 'Review-level questions to the agent and its replies. Messages are not published and are included in the agent context.',
                example: 'revdeck messages 42 ask --text "Подробнее про задачу"',
            },
            {
                id: 'metrics',
                usage: 'revdeck metrics [project] [--from <ISO>] [--to <ISO>]',
                ru: 'Метрики качества: acceptance, publish, rule-grounded, coverage, время до первого замечания. Агрегаты, без рейтинга людей.',
                en: 'Quality metrics: acceptance, publish, rule-grounded, coverage, time to first finding. Aggregates, no people ranking.',
                example: 'revdeck metrics gitlab:gitlab.com/group/proj --from 2026-01-01',
            },
            {
                id: 'react',
                usage: 'revdeck react <N> --note <id> --emoji <name>',
                ru: 'Ставит или снимает реакцию на комментарий платформы.',
                en: 'Adds or removes a reaction on a platform comment.',
            },
            {
                id: 'attach',
                usage: 'revdeck attach <N> --file <path>',
                ru: 'Загружает картинку или видео в платформу и печатает markdown-ссылку.',
                en: 'Uploads an image or video to the platform and prints its markdown link.',
            },
            {
                id: 'publish',
                usage: 'revdeck publish <N> [--kind reply|finding|note] [--ids a,b] [--yes]',
                ru: 'Показывает точный план публикации, а с --yes публикует после подтверждения. Без --yes ничего не отправляется.',
                en: 'Shows the exact publish plan; with --yes publishes after confirmation. Without --yes nothing is sent.',
            },
        ],
    },
    {
        id: 'features',
        ru: 'Фичи',
        en: 'Features',
        commands: [
            {
                id: 'feature',
                usage: 'revdeck feature list|create|get|add|remove|reorder|notes|note|note-delete|context|update|archive|delete',
                ru: 'Кросс-проектные фичи: бриф, контракт Markdown/OpenAPI, роли ревью и заметки. Фича не публикуется целиком.',
                en: 'Cross-project features: brief, Markdown/OpenAPI contract, review roles and notes. A feature is never published as a whole.',
                example: 'revdeck feature create "Checkout v2" --brief brief.md gitlab:gitlab.com/acme/api!1',
            },
            {
                id: 'feature-context',
                usage: 'revdeck feature context <id>',
                ru: 'Собирает контекст фичи: бриф, контракт, профили, заметки и секции по каждому ревью.',
                en: 'Builds feature context: brief, contract, profiles, notes and one section per review.',
            },
        ],
    },
    {
        id: 'data',
        ru: 'Данные и диагностика',
        en: 'Data and diagnostics',
        commands: [
            {
                id: 'config',
                usage: 'revdeck config [--json]',
                ru: 'Показывает эффективный конфиг проекта с учётом .revdeck.local.yml.',
                en: 'Shows the effective project config, including .revdeck.local.yml.',
            },
            {
                id: 'export',
                usage: 'revdeck export <N> [--dir .revdeck]',
                ru: 'Выгружает ревью в старый файловый формат.',
                en: 'Exports a review to the legacy file format.',
            },
            {
                id: 'import',
                usage: 'revdeck import <N> [--dir .revdeck]',
                ru: 'Импортирует ревью из старого файлового формата.',
                en: 'Imports a review from the legacy file format.',
            },
            {
                id: 'mcp',
                usage: 'revdeck mcp',
                ru: 'Запускает MCP-сервер over stdio. Инструменты доступны агенту, токены остаются у демона.',
                en: 'Starts the MCP server over stdio. Tools are available to the agent; tokens stay with the daemon.',
            },
        ],
    },
];

export const GLOBAL_FLAGS: { flag: string; ru: string; en: string }[] = [
    { flag: '--json', ru: 'машинный вывод', en: 'machine-readable output' },
    { flag: '--root <path>', ru: 'рабочая копия репозитория', en: 'repository working-copy root' },
    { flag: '--review <id>', ru: 'id ревью', en: 'review id' },
    { flag: '--lang ru|en', ru: 'язык CLI', en: 'CLI language' },
    { flag: '--help', ru: 'справка', en: 'help' },
];

export const SHORTCUTS: { keys: string; ru: string; en: string }[] = [
    { keys: '1–6', ru: 'вкладки ревью', en: 'review tabs' },
    { keys: 'o', ru: 'открыть ревью', en: 'open a review' },
    { keys: 'r', ru: 'обновить ревью', en: 'refresh the review' },
    { keys: 's', ru: 'скрыть/показать сайдбар', en: 'hide/show the sidebar' },
    { keys: 'p', ru: 'проекты или публикация', en: 'projects or publish' },
    { keys: '?', ru: 'палитра команд', en: 'command palette' },
    { keys: '⌘K / Ctrl+K', ru: 'палитра команд', en: 'command palette' },
    { keys: 'h', ru: 'справка по командам', en: 'command reference' },
    { keys: '[ / ]', ru: 'предыдущий/следующий файл (Diff)', en: 'previous/next file (Diff)' },
    { keys: 'f', ru: 'фильтр файлов (Diff)', en: 'file filter (Diff)' },
    { keys: 't', ru: 'скрыть/показать дерево файлов (Diff)', en: 'hide/show the file tree (Diff)' },
    { keys: 'e', ru: 'раскрыть/свернуть скрытые строки (Diff)', en: 'expand/collapse hidden lines (Diff)' },
    { keys: 'v', ru: 'отметить файл просмотренным (Diff)', en: 'mark the file viewed (Diff)' },
    { keys: 'n / N', ru: 'следующее/предыдущее обсуждение (Diff)', en: 'next/previous discussion (Diff)' },
    { keys: 'Esc', ru: 'закрыть диалог или отменить комментарий', en: 'close a dialog or cancel a comment' },
];
