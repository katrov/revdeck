# Threat model

[English](threat-model.md) | [Русский](ru/threat-model.md)

## Assets

1. GitLab/GitHub tokens (in the `glab`/`gh` configuration on the host).
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
| The agent extracts a platform token | The token is never read: `glab`/`gh` take it from their own configuration. The agent gets only RPC; tokens are scrubbed from child process env and redacted in logs/errors | A process that can read the user's `$HOME` can read the CLI config. That is why agent isolation is required |
| Spoofing the project/host via `.git/config` | Explicit `host`/`project` in the config and arguments take precedence over the remote; `glab`/`gh` are invoked with a `cwd` outside the working copy | If the project is not pinned, the remote is used — the UI shows the project for verification |
| Prompt injection from comments/diff | Instructions in the text are marked as data; the agent does not publish on its own; publishing requires human approval; the sanitizer blocks hidden characters and quick actions | The model can still propose harmful text — a human sees it in the plan |
| Accidental publication of the wrong text | A plan with the exact bodies and a hash; `approve` verifies the hash; `commit` executes only the plan items; a repeat send is skipped | A human may approve without looking — the UI shows the full text |
| Cross-site requests to loopback (DNS rebinding, CSRF) | Only `127.0.0.1`/`localhost` in `Host`; an `Origin` check for POST; `HttpOnly`, `SameSite=Strict` cookies; a one-time token in the launch link; CSP | A local process of another user with access to the socket is out of scope (permissions 0600/0700) |
| Symlink/TOCTOU in the working directory | State is stored in a private directory, writes are atomic; repository files are read only inside the root, without following symlinks in its own paths | A race on repository files is possible but does not grant publish rights |
| A malicious `.revdeck.yml` executes code | `checks.argv` is an array without a shell; execution only with `--run --yes`; MCP cannot run checks | A user may approve running a malicious command from someone else's MR — read the plan |
| Leakage through logs/errors | Redaction of tokens, ANSI and control characters; length limits; logs in a private directory | Comment text may contain secrets — do not publish it |
| Supply chain | Minimal dependencies, lockfile, esbuild/Vite build, provenance on npm publish | The same as for any npm package |
| Approval theft | An approval is 16 random bytes, TTL 10 minutes, single-use, bound to review+hash, stored only in SQLite on the host | Socket access = RPC access; protected by file permissions |

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
