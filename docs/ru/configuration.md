# Конфигурация

[English](../configuration.md) | Русский

Файл `.revdeck.yml` (или `.revdeck.yaml`) в корне репозитория. Схема проверяется через zod;
неизвестное поле — ошибка с путём.

```yaml
version: 1
provider:
  type: auto            # auto | gitlab | github
  host: gitlab.example.com
  project: group/project
  base: develop
output:
  language: auto        # auto | ru | en — язык замечаний и ответов
rules:
  sources: [AGENTS.md]
  map:
    - match: ["src/**", "lib/**"]
      docs: ["docs/Architecture.md", "docs/Styleguide.md#Базовый стиль"]
      note: "прикладной код"
  ignore: ["**/generated/**"]
checks:
  - id: lint
    name: ESLint
    argv: [npm, run, lint]
    when: ["src/**"]
    consent: true
    timeoutMs: 300000
publish:
  requireApproval: true
  maxComments: 50
```

## provider

| Поле | По умолчанию | Смысл |
|---|---|---|
| `type` | `auto` | `auto` — по git remote; иначе явная платформа |
| `host` | из remote | хост без схемы |
| `project` | из remote | GitLab `group/project`, GitHub `owner/repo` |
| `base` | `develop`/`main` | база для локального diff |

Явные аргументы CLI (`--platform`, `--project`, `--host`) важнее конфига, конфиг важнее git remote.
Так подмена `.git/config` не перенаправит ревью на чужой проект.

## output

- `language: auto` — замечания и ответы пишутся на языке описания MR и обсуждений; если текста нет,
  используется английский. `ru`/`en` фиксируют язык явно.
- Язык правил и документов от этого не зависит: агент читает их как есть и цитирует в оригинале.
- Это язык **результата ревью**, а не интерфейса CLI/UI. Интерфейс переключается `--lang ru|en`,
  `REVDECK_LANG` или переключателем в UI.
- `revdeck init --lang en` выбирает английский skill и пишет `REVDECK_LANG` в MCP-конфиг.

## rules

- `sources` — документы по умолчанию, если ни одна строка `map` не подошла. Пусто — автообнаружение
  (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/Architecture.md`,
  `docs/STYLEGUIDE.md`, `docs/Styleguide.md`, `docs/CONTRIBUTING.md`).
- `map` — список правил: `match` (glob или массив glob) и `docs` (массив селекторов). Несколько
  совпавших строк объединяются.
- `ignore` — glob-исключения: файл не попадает в анализ правил.

### Селекторы документов

| Селектор | Что берётся |
|---|---|
| `docs/Architecture.md` | весь документ |
| `docs/Styleguide.md#Базовый стиль` | секция заголовка (уровень и ниже, до заголовка того же уровня) |
| `docs/File.md#L10-L25` | диапазон строк |
| `docs/File.md#10-25` | то же |

Заголовок нормализуется: регистр, пробелы и пунктуация не важны, `#Слои и зависимости` и
`#layers` — разные секции, а `#Слои-и-зависимости` и `#Слои и зависимости` — одна. Если секция не
найдена, revdeck пишет предупреждение и не подставляет весь документ.

### Glob

`*` — в пределах одного сегмента, `**` — любая глубина, `?` — один символ, `{a,b}` — альтернатива.
Примеры: `src/**/*.ts`, `docs/{guides,adr}/**`, `**/*.test.ts`.

## checks

Проверки — argv-массивы, без shell-строк. Это важно: конфиг лежит в репозитории, и строка shell
позволила бы исполнить произвольный код при ревью.

| Поле | Смысл |
|---|---|
| `id` | стабильный идентификатор |
| `name` | отображаемое имя |
| `argv` | команда и аргументы; первым идёт исполняемый файл |
| `when` | glob-пути: запускать, только если diff их затронул; пусто — всегда |
| `consent` | требует явного подтверждения (по умолчанию `true`) |
| `timeoutMs` | таймаут (по умолчанию 300 000) |

Запуск: `revdeck checks <N> --run --yes`. MCP-инструмент только показывает план.

## publish

- `requireApproval` — оставлен для совместимости; approval требуется всегда, когда публикует не
  интерактивный процесс.
- `maxComments` — максимум комментариев за один план (1–200).

## Переменные окружения

| Переменная | Смысл |
|---|---|
| `REVDECK_STATE_DIR` | каталог состояния (по умолчанию `~/.local/state/revdeck`) |
| `REVDECK_RUNTIME_DIR` | каталог сокета (по умолчанию `$XDG_RUNTIME_DIR/revdeck`) |
| `REVDECK_URL` + `REVDECK_TOKEN` | подключение к демону по HTTP (контейнер/проброс порта) |
| `REVDECK_DEV_CONTAINER=1` | не запускать локальный демон, а подсказать про демон хоста |
| `REVDECK_UI_HOST` | хост для `revdeck ui` из контейнера (например, `host.docker.internal`) |
| `REVDECK_ROOT` | корень проекта для MCP-сервера |
| `REVDECK_LANG` | язык CLI/MCP/демона: `ru` или `en` (по умолчанию системная локаль) |

## Валидация

`revdeck config --json` показывает эффективный конфиг, найденный путь и предупреждения.
`revdeck rules --explain src/app.ts` показывает, какие документы и секции выбраны для файла.
