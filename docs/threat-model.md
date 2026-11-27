# Threat model

[English](threat-model.md) | [Русский](ru/threat-model.md)

## Assets

1. GitLab/GitHub tokens (in the `glab`/`gh` configuration on the host; a token pasted in the UI is
   passed to the CLI and is not kept by revdeck).
2. The code and diff of the repository under review, including private repositories.
3. Threads and comments, including personal data.
4. The right to publish on the user's behalf.
5. The UI launch token and the browser session token.
6. The local SQLite database with the text of comments and drafts.

## Trust boundaries

1. **Agent (sandbox/container) ↔ daemon on the host.** The agent is untrusted: its output can be
   subverted by MR content.
2. **Browser ↔ daemon.** The browser is trusted, but a foreign page can reach loopback.
3. **Repository ↔ daemon.** The MR author controls the repository's config and documents; they must
   not be executed.
4. **Daemon ↔ `glab`/`gh`.** The CLI is trusted, but its environment and working copy can be tampered
   with.

## Threats and mitigations

| Threat | Mitigation | Residual risk |
|---|---|---|
| The agent extracts a platform token | The token is never read: `glab`/`gh` take it from their own configuration. The agent gets only RPC with read/draft capabilities; tokens are scrubbed from child process env and redacted in logs/errors | A process that can read the user's `$HOME` can read the CLI config. That is why agent isolation is required |
| Spoofing the project/host via `.git/config` | Explicit `host`/`project` in the config and arguments take precedence over the remote; `glab`/`gh` are invoked with a `cwd` outside the working copy | If the project is not pinned, the remote is used — the UI shows the project for verification |
| Prompt injection from comments/diff | Instructions in the text are marked as data; the agent does not publish on its own; publishing requires human approval; the sanitizer blocks hidden characters and quick actions | The model can still propose harmful text — a human sees it in the plan |
| Accidental publication of the wrong text | A plan with the exact bodies and a hash; `approve` verifies the hash; `commit` executes only the plan items; a repeat send is skipped | A human may approve without looking — the UI shows the full text |
| Cross-site requests to loopback (DNS rebinding, CSRF) | Only `127.0.0.1`/`localhost` in `Host`; an `Origin` check for POST; `HttpOnly`, `SameSite=Strict` cookies; a launch token; CSP | A local process of another user with access to the socket is out of scope (permissions 0600/0700) |
| A malicious page submits a credential through `auth.login` | The token is accepted only in the authenticated UI session (`Host`/`Origin` checks, launch cookie, CSP); `auth.login` is human-only; the UI disables the form when it is not served from `127.0.0.1` | A page that can act as the browser session has the same authority as the human |
| An entered token leaks into logs, argv or RPC | The token goes to `glab`/`gh` on stdin, never as an argument (no `ps` exposure); it is never written to SQLite, never returned by `auth.status`, and CLI errors are redacted before they reach the UI | The token lives in the CLI config, which any process of the user can read |
| The agent rewrites platform credentials | `auth.*` is not in the agent method set: the bridge and an agent-scoped HTTP token get `CAPABILITY` | An agent with shell access to `$HOME` can run `gh auth login` itself — the same residual risk as before |
| Symlink/TOCTOU in the working directory | State is stored in a private directory, writes are atomic; rules/profiles are read only from git-tracked safe documents; the opened fd's realpath is checked inside the root on Linux (`/proc/self/fd`); macOS/Windows use a path + inode comparison | macOS/Windows keep a narrow path/inode race; it does not grant publish rights |
| Local secrets via rules/profiles | `rules.sources`/`context.sources` must be git-tracked, have a safe extension and are denied for `.env*`, `.git/**`, `.npmrc`, `.revdeck.local.*` and key files; a tracked `.revdeck.local.yml` is ignored | A tracked document can still contain secrets committed to the repository — that is the MR content, not the reviewer's local file |
| A malicious `.revdeck.yml` executes code | The bridge denies `checks.run` (`CAPABILITY`); checks are run by a human in the UI or the host CLI, which shows the full argv; the CLI refuses `--run` inside a devcontainer | A human may still run a malicious command from someone else's MR in the UI/host CLI — read the argv; host checks are not sandboxed yet |
| Leakage through logs/errors | Redaction of tokens, ANSI and control characters; length limits; logs in a private directory | Comment text may contain secrets — do not publish it |
| Supply chain | Minimal dependencies, lockfile, esbuild/Vite build, provenance on npm publish | The same as for any npm package |
| Update check leaks local context or usage | Only `registry.npmjs.org` is contacted, at most once per day; no repository, project or review data, only `revdeck/<version>` as the User-Agent; `REVDECK_UPDATE_CHECK=0` disables it | The registry sees the host IP and the revdeck version |
| Approval theft | An approval is 16 random bytes, TTL 10 minutes, single-use, bound to review+hash, stored only in SQLite on the host; `publish.approve`/`commit` are human-only on the bridge | The host CLI/UI token is still local authority; a process that can mount the host state or use the primary socket has it |

## Project isolation

Projects separate review contexts, not security domains. One daemon and one SQLite stay on the host.
The MCP server resolves one project from its working copy, filters `reviews.list`, and rejects a
review id/URL from another project; the agent gets no `root` or project override. The UI and CLI
filters are convenience, not authorization.

Residual risk: an agent with shell access to the user's home can read the daemon's database or call
the primary RPC socket directly, just as it could read other repositories. The devcontainer bridge is
agent-scoped (no publish/checks/admin), but read/draft methods still see the local database. For hard
isolation, run a separate daemon with its own `REVDECK_STATE_DIR` under a separate user/container; that
is outside this model and breaks cross-project review.

## Features

A feature is an explicit human-created bridge between projects. Project sessions may read a feature's
combined context, but cannot write outside their project. A feature session (`REVDECK_FEATURE`) is
started explicitly and may write drafts to any member; publishing still requires per-review human
approval. Feature membership is visible to the agent, so the human should treat adding a review as
disclosing it to the feature sessions.

Feature notes/findings are not published; the agent can write them only in a feature session. MCP may
update or delete only agent-authored notes; human notes are read-only to MCP. Contract, profile and
note text is data, not instructions, and is rendered as quoted context.

The feature context reads only the declared `context.sources` profile files from member working
copies, inside the member root; symlinked paths that escape the root are rejected. It does not read
arbitrary source trees. A process with access to the user's home can still read the database; this is
context isolation, not a security boundary.

## Out of scope

- Protection from an administrator/user who already has access to host processes.
- Hiding the code under review from the platform: it is already there.
- Multi-user authorization and roles.
- Protection from a malicious `glab`/`gh`: the CLI is trusted, just like the npm package.

## Model checks

- Comments go through `sanitizeBody`: control and bidi characters, HTML, GitLab quick actions,
  `@all`/`@here`/`@everyone`, external images. Images are allowed only from the platform host
  (or GitLab project `/uploads/`); attachments are restricted to raster images and videos and are
  checked by extension, MIME and file signature.
- Publishing is impossible without an `approval_id`; the MCP publish tool does not create one.
- `revdeck doctor` shows which permissions and adapters are active.
