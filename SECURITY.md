# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

Pre-1.0 releases get fixes on the latest minor line.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability reporting:

<https://github.com/katrov/revdeck/security/advisories/new>

Include:

- affected version (`revdeck --version`) and Node.js version;
- platform (GitLab/GitHub) and, if relevant, the provider configuration;
- steps to reproduce, expected and actual behavior;
- whether a token, a published comment, or repository content is involved;
- logs with secrets removed (`revdeck daemon logs`).

You will get an acknowledgement within a few days. Please give us time to ship a fix before public
disclosure.

## Scope

In scope:

- token handling and redaction, daemon/socket permissions, UI authentication (launch token, cookie,
  `Host`/`Origin`, CSP);
- the approval and idempotency model for publishing;
- prompt injection in review text that leads to unintended actions;
- path traversal, symlink handling, unsafe `exec`, malicious repository config;
- supply-chain issues in the published package.

Out of scope:

- an attacker who already controls the user's OS account or can read `$HOME` — isolate the agent;
- vulnerabilities in `glab`, `gh`, GitLab or GitHub themselves;
- denial of service by a local user against their own daemon.

The design assumptions and residual risks are documented in [docs/threat-model.md](docs/threat-model.md).
