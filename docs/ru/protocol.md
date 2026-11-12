# Протокол

[English](../protocol.md) | Русский

## Транспорты

1. **Unix-сокет** (основной): `$XDG_RUNTIME_DIR/revdeck/daemon.sock`, каталог 0700, сокет 0600.
   Строки JSON, по одному запросу/ответу на строку.
2. **Сокет моста для devcontainer**: `~/.local/state/revdeck/devcontainer/run/daemon.sock`, тот же
   протокол по стабильному домашнему пути. Демон обслуживает его дополнительно к основному сокету и
   кладёт копию `daemon.json` в `~/.local/state/revdeck/devcontainer/state/`.
3. **HTTP**: `POST /api/rpc` на loopback с cookie-сессией. Нужен для контейнеров, куда сокет не
   проброшен (`REVDECK_URL` + `REVDECK_TOKEN`).
4. **UI HTTP**: `/api/*` и SSE `/api/events` для браузера.

## Сообщения

Запрос:

```json
{"id": 1, "method": "reviews.get", "params": {"review": "gitlab:gitlab.com/group/project!42"}}
```

Ответ:

```json
{"id": 1, "result": {"review": {"id": "...", "info": {}, "threads": []}}}
```

Ошибка:

```json
{"id": 1, "error": {"message": "...", "code": "APPROVAL", "hint": "..."}}
```

`id` — число. Соединение считается недоверенным до первого успешного запроса: авторизация — права
файла сокета.

## Методы

| Метод | Параметры | Результат |
|---|---|---|
| `ping` | — | версия, протокол, pid |
| `reviews.list` | — | сохранённые ревью |
| `reviews.remoteList` | `root`, `scope`, `limit` | открытые ревью с платформы |
| `reviews.open` | `root`, `input`/`platform`/`project`/`host`/`branch` | снимок ревью |
| `reviews.refresh` | `review` | обновлённый снимок |
| `reviews.get` | `review`, `refresh?` | снимок (без полного diff) |
| `diff.get` | `review`, `file` | hunks файла |
| `drafts.put` | `review`, `threadId`, `patch` | черновик |
| `findings.put` | `review`, `findings[]` | замечания после merge |
| `findings.list` | `review` | замечания |
| `summary.put` | `review`, `summary` | выжимка |
| `decisions.put` | `review`, `decisions` | решения человека |
| `notes.add` | `review`, `file`, `line`, `text`, `toAgent` | комментарий к строке |
| `notes.update` | `review`, `noteId`, `patch` | обновлённый комментарий |
| `reactions.list` | `review`, `noteIds[]` | реакции, сгруппированные по id комментария |
| `reactions.toggle` | `review`, `noteId`, `emoji` | `active` и актуальный список реакций |
| `attachments.upload` | `review`, `name`, `contentType`, `data` (base64) | `name`, абсолютный `url`, `markdown` |
| `notes.delete` | `review`, `noteId` | `{ok}` |
| `publish.preview` | `review`, `kind`, `ids[]` | план + предупреждения |
| `publish.approve` | `review`, `kind`, `ids[]`, `hash` | `approvalId`, `expiresAt` |
| `publish.commit` | `review`, `approvalId` | результаты по пунктам |
| `rules.get` | `review` | markdown правил, проверки, предупреждения |
| `checks.run` | `review`, `allowRun`, `ids[]` | результаты проверок |
| `audit.tail` | `limit` | последние действия |

## Approval

1. `publish.preview` строит `items` — точные тела, пути, строки, флаги резолва — и
   `hash = sha256(canonicalJson({reviewId, kind, items}))`.
2. Человек видит план. `publish.approve` пересчитывает план по тем же `ids`; если хеш не совпал,
   возвращает ошибку. Иначе создаёт одноразовый `approval_id` с TTL 10 минут.
3. `publish.commit` проверяет, что approval не использован и не истёк, помечает его использованным и
   выполняет только `items`. Уже отправленные пункты пропускаются.

Агент не может вызвать `publish.approve`: MCP-инструмент его не предоставляет. Человек подтверждает
в UI или CLI с `--yes`.

## HTTP API (UI)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/` | SPA; `?t=<token>` ставит cookie и редиректит |
| GET | `/assets/*` | статика сборки |
| GET | `/api/health` | живость |
| GET | `/api/reviews` | список ревью |
| GET | `/api/state?review=` | снимок для UI |
| GET | `/api/diff?review=&file=` | hunks файла |
| GET | `/api/rules?review=` | правила |
| GET | `/api/events` | SSE: `review` |
| POST | `/api/reviews/open`, `/api/reviews/refresh` | открыть/обновить |
| POST | `/api/drafts`, `/api/findings`, `/api/summary`, `/api/decisions` | черновики |
| POST | `/api/notes` | `action: add/update/delete` |
| GET | `/api/reactions?review=&notes=` | реакции для id комментариев |
| POST | `/api/reactions` | переключить реакцию |
| POST | `/api/attachments` | загрузить картинку/видео и вернуть абсолютную ссылку |
| POST | `/api/publish/preview`, `/approve`, `/commit` | публикация |
| POST | `/api/checks` | проверки |
| POST | `/api/rpc` | RPC-прокси для HTTP-транспорта |

## Версионирование

`PROTOCOL_VERSION` в `src/version.ts` сверяется при рукопожатии; клиент и демон одной версии пакета.
Несовпадение методов возвращает `METHOD` с подсказкой обновить revdeck.
