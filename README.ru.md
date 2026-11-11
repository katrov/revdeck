# revdeck

[English](README.md) | Русский

Локальный код-ревью для GitLab и GitHub, сделанный вокруг агента: агент читает контекст и пишет
черновики, человек подтверждает и публикует. Работает как MCP-сервер, CLI и веб-интерфейс; токены
платформ остаются на хосте.

```
агент (MCP/CLI) ──unix socket──▶ revdeck daemon ──glab/gh──▶ GitLab / GitHub
                                    │
                              SQLite + Svelte UI ◀── человек
```

![Интерфейс revdeck](docs/screenshot.png)

## Зачем

- **Правила вместо догадок.** Для каждого изменённого пути revdeck выбирает документы репозитория и
  конкретные секции (`AGENTS.md`, архитектура, гайды, ADR). Агент получает детерминированный контекст,
  а не «отревьюй PR по best practices».
- **Публикация только человеком.** Агент пишет черновики ответов и замечаний. В UI видно ровно то, что
  уйдёт в платформу; публикация выполняется по подтверждению, привязанному к хешу плана, и повторно
  не отправляет уже отправленное.
- **Токены не уезжают агенту.** Демон вызывает `glab`/`gh` на хосте и вычищает токены из окружения
  дочерних процессов. Агент в песочнице получает только RPC и не видит ни токена, ни конфигурации
  платформы.
- **GitLab и GitHub.** Одна модель: MR/PR, треды, diff, резолв, реакции, комментарии к строкам.
- **Несколько ревью.** Демон хранит открытые ревью в SQLite; UI — очередь с поиском и горячими
  клавишами.

## Установка

```bash
npm install -g revdeck
# или разово:
npx revdeck@latest init
```

Требования: Node.js ≥ 22.13, `git`, для GitLab — `glab` с выполненным `glab auth login`, для
GitHub — `gh` с `gh auth login`. Токены revdeck не читает и не хранит.

В проекте:

```bash
cd /path/to/repo
revdeck init          # .revdeck.yml, skill в .agents/.claude, MCP-конфиг
revdeck doctor        # проверка окружения и адаптеров
revdeck open 42       # открыть MR/PR по номеру
revdeck ui            # ссылка на локальный интерфейс
```

`revdeck init` не перезаписывает существующий конфиг без `--force` и не трогает чужие ключи в
`.mcp.json`. Автозапуск демона при входе в систему — `revdeck daemon install`: создаёт systemd user unit
(Linux) или launchd plist (macOS) и печатает команду включения.

## Команды

| Команда | Что делает |
|---|---|
| `revdeck init` | конфиг, адаптеры, MCP |
| `revdeck doctor` | окружение, `glab`/`gh`, демон, адаптеры |
| `revdeck list [--remote]` | локальные или открытые на платформе ревью |
| `revdeck open <N│URL>` | загрузить ревью |
| `revdeck context <N>` | контекст для агента: правила, файлы, треды, замечания |
| `revdeck diff <N> [--file]` | файлы и hunks |
| `revdeck threads <N>` | обсуждения |
| `revdeck findings <N> set --file f.json` | записать замечания |
| `revdeck reply <N> --thread <id> --body …` | черновик ответа |
| `revdeck publish <N> [--yes]` | план или публикация после подтверждения |
| `revdeck notes <N> …` | комментарии человека к строкам |
| `revdeck rules [--explain <path>]` | эффективные правила |
| `revdeck checks <N> [--run --yes]` | проверки проекта |
| `revdeck export/import <N>` | обмен с файловым форматом |
| `revdeck ui [N]` | локальный интерфейс |
| `revdeck daemon <start│stop│status│logs│install>` | управление демоном |
| `revdeck mcp` | MCP-сервер (stdio) |

Общие флаги: `--json`, `--root`, `--review`, `--platform`, `--project`, `--host`.

## MCP

```json
{
  "mcpServers": {
    "revdeck": { "command": "npx", "args": ["-y", "revdeck", "mcp"] }
  }
}
```

Инструменты: `revdeck_status`, `revdeck_list`, `revdeck_open`, `revdeck_context`,
`revdeck_threads`, `revdeck_diff`, `revdeck_rules`, `revdeck_draft_reply`,
`revdeck_draft_findings`, `revdeck_set_summary`, `revdeck_notes`, `revdeck_publish_preview`,
`revdeck_publish`. Публикация требует `approval_id`, который агент получить не может: его выдаёт
человек в UI или CLI с `--yes`.

Промпты `review-mr` и `close-feedback` доступны в клиентах, поддерживающих MCP prompts. В харнессах
без MCP используйте CLI — возможности те же. Матрица адаптеров и `/`-команд: [docs/integrations.md](docs/integrations.md).

## Правила проекта

`.revdeck.yml` в корне репозитория:

```yaml
version: 1
provider:
  type: gitlab          # auto | gitlab | github
  host: gitlab.example.com
  project: group/project
  base: develop
rules:
  sources: [AGENTS.md, CONTRIBUTING.md]
  map:
    - match: "src/**"
      docs: [docs/Architecture.md, docs/Styleguide.md#Базовый стиль]
    - match: "src/state/**"
      docs: [docs/StateManagement.md]
    - match: "docs/**"
      docs: [AGENTS.md#Размещение-технических-знаний]
  ignore: ["**/generated/**"]
checks:
  - id: lint
    argv: [npm, run, lint]
    when: ["src/**"]
publish:
  requireApproval: true
  maxComments: 50
```

Селектор документа: `docs/File.md`, `docs/File.md#Заголовок` или `docs/File.md#L10-L25`. Без конфига
revdeck ищет `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` и `docs/*` и предупреждает, если правил не
нашлось. Полная схема — [docs/configuration.md](docs/configuration.md).

## Безопасность

- Демон слушает только loopback и unix-сокет (0600), UI — с одноразовым токеном запуска, cookie
  `HttpOnly`/`SameSite=Strict`, проверкой `Host`/`Origin` и CSP.
- `glab`/`gh` вызываются без shell, с `cwd` вне рабочей копии и вычищенным окружением; секреты
  редактируются в логах и ошибках.
- Комментарии проверяются на быстрые команды GitLab, HTML, скрытые/bidi-символы, `@all` и внешние
  картинки.
- Текст MR — недоверенные данные; агентские инструкции это оговаривают.

Подробно: [docs/threat-model.md](docs/threat-model.md). Гарантия формулируется так: токен не
пересекает границу песочницы и не отдаётся по RPC. Если у процесса есть чтение домашнего каталога
пользователя, он может прочитать конфигурацию `glab`/`gh` — для этого и нужна изоляция агента.

## Архитектура

| Путь | Что внутри |
|---|---|
| `src/core` | модели, парсер diff, правила, findings, санитайзер, безопасный exec |
| `src/providers` | GitLab и GitHub через `glab`/`gh`, нормализация в общую модель |
| `src/daemon` | SQLite, сервис, RPC по сокету, HTTP/SSE, одобрения |
| `src/cli` | команды, `init`, `doctor`, экспорт/импорт |
| `src/mcp` | MCP-сервер (stdio) |
| `ui` | Svelte 5 + Vite |
| `skills/revdeck` | процедуры ревью (SKILL, Review, Feedback, Criteria, Rules, Sources) |

Подробно: [docs/architecture.md](docs/architecture.md), [docs/protocol.md](docs/protocol.md),
[ADR-0001](docs/adr/0001-daemon-first.md).

## Разработка

```bash
npm install
npm run typecheck     # tsc + svelte-check
npm test              # vitest
npm run build         # dist/cli.js, dist/daemon.js, dist/mcp.js, dist/ui
```

Демон в разработке: `npm run dev:daemon`, UI: `npm run dev:ui` (сборка UI отдаётся демоном из
`dist/ui`). Тесты провайдеров работают на записанных ответах CLI и не требуют сети.

## Ограничения текущей версии

- Публикация идёт обычными комментариями; native drafts (GitLab draft notes, GitHub pending review)
  ещё не используются, хотя провайдеры к этому готовы.
- Проверки проекта агент только планирует; запуск — `revdeck checks --run --yes`.
- UI не открывает новое ревью по номеру: это делает CLI, ревью появляется в списке.
- Резолв тредов есть в карточке треда; реакции реализованы в провайдерах, но пока не выведены в UI.
- Поддержаны Linux и macOS для автозапуска; Windows — запуск вручную.

## Лицензия

MIT.
