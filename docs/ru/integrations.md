# Интеграция с харнессами

[English](../integrations.md) | Русский

У revdeck два переносимых слоя и один адаптерный:

- **MCP** (stdio) — инструменты `revdeck_*` работают в любом клиенте с MCP.
- **CLI** — те же возможности без MCP: `revdeck open/context/findings/reply/publish`.
- **`/`-команда** — у каждого харнесса своя; `revdeck init` создаёт нужный файл.

Полноценная интеграция = MCP + skill (процедуры) + команда (точка входа). Без MCP остаются CLI и
skill: агент вызывает команды через shell.

## Матрица

| Харнесс | `/`-команда | Что пишет `init` |
|---|---|---|
| Claude Code | `/revdeck` | `.claude/commands/revdeck.md`, `.claude/skills/revdeck` → `../../.agents/skills/revdeck`, `.mcp.json` |
| Cursor | `/revdeck` | `.cursor/commands/revdeck.md`, `.cursor/mcp.json` |
| Codex CLI | prompt `revdeck` | `.codex/prompts/revdeck.md`; MCP — в `~/.codex/config.toml` (вручную) |
| Gemini CLI | `/revdeck` | `.gemini/commands/revdeck.toml`; MCP — в настройках Gemini (вручную) |
| OpenCode | `/revdeck` | `.opencode/command/revdeck.md` |
| GitHub Copilot | prompt-файл | `.github/prompts/revdeck.prompt.md` |
| DSH | плагин (см. ниже) | `.agents/skills/revdeck/*` (включая `agents/openai.yaml`) + YAML-сниппет в выводе |
| Универсальный | — | `.agents/skills/revdeck/*` (включая `agents/openai.yaml`) + MCP |

`revdeck init --adapters dsh,claude` включает нужные явно. Повторный `init` не перезаписывает
существующие командные файлы и не затирает чужие ключи `.mcp.json`.

Скилл хранится в одном каноническом месте: `.agents/skills/revdeck` (включая `agents/openai.yaml`
для OpenAI-харнессов). Харнессы со своим каталогом скиллов получают ссылку на него:
`.claude/skills/revdeck` — симлинк на `../../.agents/skills/revdeck`; на Windows и ФС без симлинков
используется копия. Старые копии, созданные предыдущим `init`, заменяются, если в них остался
`name: revdeck`.

Вложения комментариев загружает демон на хосте. GitLab использует project uploads и возвращает
абсолютный URL; у GitHub публичного API загрузки нет, поэтому редактор просит вставить ссылку.

## MCP

```json
{
  "mcpServers": {
    "revdeck": {
      "command": "npx",
      "args": ["-y", "revdeck", "mcp"],
      "env": { "REVDECK_LANG": "en" }
    }
  }
}
```

`init` пишет `npx -y revdeck mcp` в MCP-конфиг. Публикация через MCP
требует `approval_id`: его выдаёт человек в UI или CLI с `--yes`, агент получить не может.

## DSH

MCP-клиент DSH подключается в профиле Cordis:

```yaml
- id: mcp-revdeck
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: revdeck
    transport: stdio
    command: npx
    args: ['-y', 'revdeck', 'mcp']
    env:
      REVDECK_LANG: en
```

Инструменты появятся как `mcp__revdeck__*`. MCP prompt templates DSH не поддерживает, поэтому
`/revdeck` требует host-команды (`ctx.commands.register`) или client action — это отдельный
плагин-обёртка. До него используйте skill + MCP-инструменты: `/`-слэш не обязателен для работы.

## Контейнер и devcontainer

Демон, `glab` и `gh` остаются на хосте; контейнеру нужен только CLI или MCP-сервер revdeck.
Настройки devcontainer генерируются из корня репозитория:

```bash
revdeck devcontainer          # показать mounts и окружение
revdeck devcontainer --write  # добавить их в .devcontainer/devcontainer.json
```

`--write` монтирует стабильный мост `~/.local/state/revdeck/devcontainer/run` (сокет) и
`~/.local/state/revdeck/devcontainer/state` (только чтение, `daemon.json`) и выставляет:

```json
{
  "REVDECK_RUNTIME_DIR": "/run/revdeck",
  "REVDECK_STATE_DIR": "/var/lib/revdeck",
  "REVDECK_DEV_CONTAINER": "1",
  "REVDECK_UI_HOST": "host.docker.internal"
}
```

В `devcontainer.json` источники mounts записываются через
`${localEnv:HOME}${localEnv:USERPROFILE}`, а не абсолютным домашним путём, поэтому общий файл
репозитория подходит всем разработчикам. Чужие mounts, переменные окружения, `runArgs`, комментарии
и ключи сохраняются; revdeck управляет только двумя своими mounts и ключами `REVDECK_*`.

Демон создаёт сокет моста при старте. На хосте выполните `revdeck daemon restart`, затем пересоберите
контейнер. В контейнере revdeck никогда не запускает свой демон: если сокет недоступен, команда
падает с ошибкой `DEVCONTAINER` и подсказкой. `revdeck doctor` не ищет `glab`/`gh` в контейнере.

Пользователь контейнера должен иметь доступ к сокету хоста (обычно совпадает UID; сокет 0600). Чтобы
открыть UI из контейнера, запустите демон на хосте с `revdeck daemon start --host 0.0.0.0` и
используйте `host.docker.internal`; иначе открывайте UI на хосте.

Запасные варианты:

1. `REVDECK_URL=http://host.docker.internal:<port>` и `REVDECK_TOKEN=<token>` — HTTP-транспорт,
   демон на хосте запущен с `--host 0.0.0.0`.
2. `revdeck export <N>` на хосте и `revdeck import <N>` в контейнере — файловый мост.

## Проверка

```bash
revdeck doctor
```

Показывает найденные бинарники, авторизацию `glab`/`gh`, состояние демона и установленный адаптер. В
devcontainer проверяет демон хоста, а не ищет `glab`/`gh` внутри.
