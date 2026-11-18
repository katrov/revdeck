# Протокол

[English](../protocol.md) | Русский

## Транспорты

1. **Unix-сокет** (основной): `$XDG_RUNTIME_DIR/revdeck/daemon.sock`, каталог 0700, сокет 0600.
   Строки JSON, по одному запросу/ответу на строку.
2. **Сокет моста для devcontainer**: `~/.local/state/revdeck/devcontainer/run/daemon.sock`, тот же
   протокол по стабильному домашнему пути. Демон обслуживает его дополнительно к основному сокету и
   пишет info-файл в `~/.local/state/revdeck/devcontainer/state/daemon.json`. Мост **агентский**:
   разрешены только `read`/`draft`; в info-файле лежит `agentToken` для ограниченного `/api/rpc`,
   токена UI там нет.
3. **HTTP**: `POST /api/rpc` на loopback с cookie-сессией. Токен UI остаётся на хосте и в контейнер
   не монтируется. Для контейнера без проброса сокета задайте `REVDECK_URL` + `REVDECK_TOKEN` из
   пользовательского окружения; токен агентский.
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

`id` — число. Основной сокет авторизуется правами файла (0600). Мост devcontainer авторизуется
капабилити транспорта: агенту доступны read/draft, а human-only методы возвращают
`{"error":{"code":"CAPABILITY"}}`, даже если сокет доступен.

## Методы

| Метод | Параметры | Результат |
|---|---|---|
| `ping` | — | версия, протокол, pid |
| `projects.list` | — | зарегистрированные проекты с числом ревью и root'ами |
| `projects.register` | `root` | проект, определённый по рабочей копии |
| `projects.update` | `project`, `title?`, `roots?` | переименовать проект или заменить root'ы |
| `projects.remove` | `project` | удалить проект и локальные ревью (платформа не затрагивается) |
| `reviews.list` | `project?` / `root?` | сохранённые ревью, опционально в скоупе проекта |
| `features.list` | `project?`, `includeArchived?` | сводки фич |
| `features.get` | `feature` | фича с упорядоченными участниками и ролями |
| `features.create` | `title`, `brief?`, `contract?`, `reviews?` | создать фичу (человек) |
| `features.update` | `feature`, `title?`, `brief?`, `contract?`, `status?` | редактировать/архивировать фичу |
| `features.addReviews` | `feature`, `reviews[{review, role?}]` | добавить/обновить участников |
| `features.removeReview` | `feature`, `review` | убрать участника |
| `features.reorder` | `feature`, `reviews[]` | задать порядок |
| `features.delete` | `feature` | удалить фичу (не ревью) |
| `features.addNote` | `feature`, `kind?`, `level?`, `title`, `body`, `author?` | непубликуемая заметка/находка фичи |
| `features.updateNote` | `feature`, `note`, `kind?`, `level?`, `title?`, `body?` | обновить заметку |
| `features.deleteNote` | `feature`, `note` | удалить заметку |
| `features.forReview` | `review` | фичи, содержащие ревью |
| `features.context` | `feature`, `maxBytes?` | общий контекст: бриф + ревью |
| `reviews.remoteList` | `root`, `scope`, `limit` | открытые ревью с платформы |
| `reviews.open` | `root`, `input`/`platform`/`project`/`host`/`branch` | снимок ревью |
| `reviews.refresh` | `review` | обновлённый снимок |
| `reviews.remove` | `review` | удалить ревью из локального списка (не с платформы) |
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
| `reactions.reviewToggle` | `review`, `emoji` | реакции на самом MR/PR |
| `comments.update` | `review`, `noteId`, `body` | редактировать свой комментарий платформы |
| `comments.delete` | `review`, `noteId` | удалить свой комментарий платформы |
| `attachments.upload` | `review`, `name`, `contentType`, `data` (base64) | `name`, абсолютный `url`, `markdown` |
| `notes.delete` | `review`, `noteId` | `{ok}` |
| `publish.preview` | `review`, `kind`, `ids[]` | план + предупреждения |
| `publish.approve` | `review`, `kind`, `ids[]`, `hash` | `approvalId`, `expiresAt` |
| `publish.commit` | `review`, `approvalId` | результаты по пунктам |
| `rules.get` | `review` | markdown правил, проверки, предупреждения |
| `checks.run` | `review`, `allowRun`, `ids[]` | результаты проверок (human-only) |

## Капабилити

- **human** — основной сокет (0600), UI-сессия на хосте, CLI на хосте. Все методы.
- **agent** — мост devcontainer и ограниченный HTTP-токен. Только read/draft:
  `reviews.*` (чтение/open/refresh), `diff.get`, `rules.get`, `features.list/get/context/forReview`,
  `features.addNote/updateNote/deleteNote` (автор принудительно `agent`; только свои заметки),
  `drafts.put`, `findings.put/list`, `summary.put`, `notes.*` (серверные поля публикации
  игнорируются), `publish.preview`, `projects.list`, `versions.*`, `analytics.get`, `secrets.get`.

Human-only методы возвращают `CAPABILITY` на мосту: `publish.approve`, `publish.commit`,
`checks.run`, `decisions.put`, `comments.update/delete`, `reactions.*`, `attachments.upload`,
`reviews.remove`, `projects.register/update/remove` и администрирование фич
(`features.create/update/delete/addReviews/removeReview/reorder`).

## Скоуп проекта

Проект — это репозиторий с ключом `platform:host/project`. `projects.list` возвращает реестр
(`key`, отображаемые поля, `roots`, число ревью, последнюю активность). `reviews.list` с `project`
или `root` возвращает только ревью этого проекта; без них — всё (для человека и отладки).

Этот фильтр — удобство API, а не security boundary: демон обслуживает одного локального
пользователя. Изоляцию для агента обеспечивает MCP-сервер: он определяет проект по рабочей копии
при старте, передаёт `project` во всех списках и отклоняет id/URL чужого ревью. MCP-инструменты не
принимают `root` и override проекта.

## Скоуп фичи

Фича — созданный человеком набор ревью (`features`, `feature_reviews`) с названием, брифом,
отдельным контрактом Markdown/OpenAPI, профилями приложений из `context.sources` и непубликуемыми
заметками/находками. `features.context` возвращает Markdown с брифом, разобранным контрактом (или
сырым Markdown), профилями, заметками, матрицей обзора и секцией на каждое ревью-член с его
собственными правилами. Только чтение.

У MCP-сервера два скоупа:

- **Project session** (по умолчанию): показывает ревью одного проекта и фичи, куда он входит; чужой
  id/URL ревью отклоняется. `revdeck_feature` читает общий контекст фичи, но инструменты записи
  работают только в текущем проекте.
- **Feature session** (`REVDECK_FEATURE=<id>`): текущий репозиторий должен быть участником. Скоуп
  ограничен участниками; черновики можно писать в любого. Публикация остаётся по каждому ревью и
  требует обычного подтверждения человеком. Заметки фичи можно писать только в feature-сессии;
  через MCP можно менять только заметки, созданные агентом.

Демон не проверяет MCP-скоуп: это локальный сервис одного пользователя. Граница изоляции — MCP-сервер.
Членство в фиче — единственная явная кросс-проектная дверь.

## Approval

1. `publish.preview` строит `items` — точные тела, пути, строки, флаги резолва — и
   `hash = sha256(canonicalJson({reviewId, kind, items}))`.
2. Человек видит план. `publish.approve` пересчитывает план по тем же `ids`; если хеш не совпал,
   возвращает ошибку. Иначе создаёт одноразовый `approval_id` с TTL 10 минут.
3. `publish.commit` проверяет, что approval не использован и не истёк, помечает его использованным и
   выполняет только `items`. Уже отправленные пункты пропускаются.

Агент не может вызвать `publish.approve`: MCP-инструмент его не предоставляет, а мост отвечает
`CAPABILITY`. Человек подтверждает в UI или в CLI на хосте (`--yes`); CLI на хосте использует
основной human-сокет.

## HTTP API (UI)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/` | SPA; `?t=<token>` ставит cookie и редиректит |
| GET | `/assets/*` | статика сборки |
| GET | `/api/health` | живость |
| GET | `/api/projects` | зарегистрированные проекты |
| GET | `/api/reviews?project=` | список ревью, опционально в скоупе |
| POST | `/api/projects/register`, `/update`, `/remove` | зарегистрировать, изменить или удалить проект |
| GET | `/api/state?review=` | снимок для UI |
| GET | `/api/diff?review=&file=` | hunks файла |
| GET | `/api/rules?review=` | правила |
| GET | `/api/events` | SSE: `review`, `feature`, `project` |
| POST | `/api/reviews/open`, `/api/reviews/refresh` | открыть/обновить |
| POST | `/api/drafts`, `/api/findings`, `/api/summary`, `/api/decisions` | черновики |
| POST | `/api/notes` | `action: add/update/delete` |
| GET | `/api/reactions?review=&notes=` | реакции для id комментариев |
| POST | `/api/reactions` | переключить реакцию |
| GET | `/api/review-reactions?review=` | реакции на MR/PR |
| POST | `/api/review-reactions` | переключить реакцию на MR/PR |
| POST | `/api/comments` | `action: update/delete` для своих комментариев платформы |
| POST | `/api/attachments` | загрузить картинку/видео и вернуть абсолютную ссылку |
| POST | `/api/publish/preview`, `/approve`, `/commit` | публикация |
| POST | `/api/checks` | проверки |
| POST | `/api/rpc` | RPC-прокси для HTTP-транспорта |

## Версионирование

`PROTOCOL_VERSION` в `src/version.ts` передаётся в `ping` и в info моста; клиент и демон должны быть
одной версии пакета. Версия 2 — agent-scoped мост.
Несовпадение методов возвращает `METHOD` с подсказкой обновить revdeck.
