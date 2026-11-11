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
| Claude Code | `/revdeck` | `.claude/commands/revdeck.md`, `.claude/skills/revdeck/*`, `.mcp.json` |
| Cursor | `/revdeck` | `.cursor/commands/revdeck.md`, `.cursor/mcp.json` |
| Codex CLI | prompt `revdeck` | `.codex/prompts/revdeck.md`; MCP — в `~/.codex/config.toml` (вручную) |
| Gemini CLI | `/revdeck` | `.gemini/commands/revdeck.toml`; MCP — в настройках Gemini (вручную) |
| OpenCode | `/revdeck` | `.opencode/command/revdeck.md` |
| GitHub Copilot | prompt-файл | `.github/prompts/revdeck.prompt.md` |
| DSH | плагин (см. ниже) | `.agents/skills/revdeck/*` + YAML-сниппет в выводе |
| Универсальный | — | `.agents/skills/revdeck/*` + MCP |

`revdeck init --adapters dsh,claude` включает нужные явно. Повторный `init` не перезаписывает
существующие командные файлы и не затирает чужие ключи `.mcp.json`.

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

## Контейнер

Демон работает на хосте, агент — в контейнере. Варианты по убыванию удобства:

1. Смонтировать `$XDG_RUNTIME_DIR/revdeck` в контейнер тем же путём — сокет заработает как есть.
2. `REVDECK_URL=http://host.docker.internal:<port>` и `REVDECK_TOKEN=<token>` — HTTP-транспорт.
   Порт и токен печатает `revdeck daemon start` (или `daemon.json` в state-каталоге).
3. `revdeck export <N>` на хосте и `revdeck import <N>` в контейнере — файловый мост.

## Проверка

```bash
revdeck doctor
```

Показывает найденные бинарники, авторизацию `glab`/`gh`, состояние демона и установленный адаптер.
