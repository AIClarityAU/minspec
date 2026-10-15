---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - a user-initiated, consented outbound hand-off
aspects: [feedback, consent, shared, commands, offline]
depends_on: [DR-014, DR-027, DR-050]
relates_to: ["#506", SPEC-056, SPEC-086]
---

# SPEC-137: Report Issue / Request Feature from inside the editor

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. Materializes
> [#506](https://github.com/AIClarityAU/minspec/issues/506). Rests on DR-014 (shared Tier-0
> package), DR-027 (ScroogeLLM private repo), DR-050 (consented shell-out precedent).

## In plain terms

Two palette commands, **Report Issue** and **Request Feature**, open a prefilled GitHub
"new issue" page in your browser. VS Code's own Report Issue entry also works from the
extension gear menu. Nothing is sent by MinSpec itself; you review and submit in the browser.

## Current state (checked on origin/main, 2026-10-16)

- `packages/minspec/package.json:14-20` already points `repository` and `bugs.url` at
  `AIClarityAU/minspec`. The issue's "fix stale bugs.url" task is **already done**; this
  spec adds a regression test, not a fix.
- `.github/ISSUE_TEMPLATE/` already holds `bug.yml`, `feature.yml`, `agent-task.yml`.
- `packages/shared/src/` has no issue-URL builder. `openExternal` is already used in
  `commit-on-approve.ts`, `init.ts`, `push-docs-lane.ts`.
- `specs/agent-execute/` has no extension code; ScroogeLLM lives in its own private repo.

## Scope

In: the shared URL builder, two MinSpec palette commands, a native-reporter command, template
alignment. Out: any automatic submission, any extension-side network call, creating
`AIClarityAU/scroogellm-feedback` (outward action, human-only), ScroogeLLM and agent-execute
wiring beyond the shared API they will consume.

## Functional requirements

- **FR-1** `buildIssueUrl(target, kind, diagnostics)` is a pure function in `packages/shared`
  (no `vscode`, no network, no fs). It returns an `https://github.com/<owner>/<repo>/issues/new`
  URL with `template`, `labels=inbox`, and `title` query params, all percent-encoded.
- **FR-2** `kind` is `bug | feature`; each maps to its template file name (`bug.yml`,
  `feature.yml`) and a title prefix (`[bug] `, `[feature] `).
- **FR-3** Diagnostics are a closed allowlist of fields: product name, extension version,
  VS Code version, OS platform, active spec id, active spec tier. No file contents, paths,
  usernames, settings values, or workspace names.
- **FR-4** The builder caps total URL length (default 6000 chars) and truncates the
  diagnostics body, never the host/path/template, so the URL never exceeds browser limits.
- **FR-5** The builder refuses (throws a typed error) a target that is not `https://github.com`
  owner/repo with `[A-Za-z0-9._-]` segments, so a bad config cannot redirect the hand-off.
- **FR-6** `MinSpec: Report Issue` and `MinSpec: Request Feature` are registered palette
  commands. Each shows the exact URL (or its diagnostics summary) in a non-modal confirmation
  before `vscode.env.openExternal`, and does nothing if dismissed (consent, invariant 1).
- **FR-7** `MinSpec: Report Issue (VS Code reporter)` runs
  `workbench.action.openIssueReporter` with `aiclarity.minspec`, giving the built-in reporter.
- **FR-8** The MinSpec target is `AIClarityAU/minspec`, read from one constant that a test
  asserts equals the `bugs.url` repo in `package.json`.
- **FR-9** Keyboard path: both commands are reachable by palette and carry a default
  two-key chord (binding chosen under Decision D3), with no conflict with an existing
  binding (test enumerates `contributes.keybindings`).
- **FR-10** No new runtime dependency; `vscode` is touched only in the command file.
- **FR-11** The Scrooge and agent-execute consumers pass their own `{owner, repo, product}`;
  the builder holds no per-product table.

## Acceptance criteria

- **AC-1** Unit tests: URL for each kind contains `labels=inbox`, the right template, an
  encoded title; special characters (`&`, `#`, newline, non-ASCII) round-trip.
- **AC-2** Property test: for any input, output length <= cap and host is `github.com`.
- **AC-3** Diagnostics test: injecting extra fields (path, token-shaped string) leaves the URL
  free of them.
- **AC-4** Invalid targets (`http://`, other host, `..` segment, empty) throw.
- **AC-5** Command test: dismissing the confirmation never calls `openExternal`; accepting
  calls it once with the built URL.
- **AC-6** Test: `package.json` `bugs.url` and `repository.url` match the FR-8 constant;
  the three commands appear in `contributes.commands`.
- **AC-7** Offline: with the network disabled both commands still build and present a URL.

## Invariants this must not break

- **Invariant 1 (offline/consent):** no network call by the extension; only a user-confirmed
  `openExternal`, same consent class as DR-050.
- **Invariant 2 (no silent gate):** not a gate; nothing here is required or merge-gating.
- **Invariant 3 (blast radius):** commands exist only in the MinSpec extension; no write to
  any repo, harness file, or machine config.
- **Tier-0 (DR-014):** the shared module imports nothing from `vscode`.

## Decisions needed (Clarify)

- **D1 - Scrooge intake.** Issue chose a new public `AIClarityAU/scroogellm-feedback`.
  Options: (a) that repo **(rec)** - cheapest, native reporter works; cost: a second public
  repo to triage and copy real bugs from by hand; (b) web form - no repo, but needs hosting
  and a network surface. Creating the repo is outward-facing: **human action, not this spec's
  build.** Until it exists, Scrooge wiring is blocked; MinSpec is not.
- **D2 - Diagnostics prefill.** Options: (a) allowlist in FR-3 **(rec)** - helpful, cost: the
  active spec id can leak a private project's spec naming to a public issue (mitigated by the
  FR-6 preview); (b) version/OS only - safer, less useful for triage.
- **D3 - Chord.** Options: (a) palette-only plus an unbound command users can bind **(rec)** -
  zero conflict risk, cost: weaker for the RSI preference the issue states; (b) default chord
  such as `ctrl+k ctrl+i` - fits RSI, cost: may collide with user bindings.
- **D4 - Scrooge code reuse.** Published `@aiclarity/shared` vs copying the ~60-line builder
  **(rec: copy until shared is published)**; cost: two copies can drift, so a pinned test
  vector (AC-1 fixtures) should be copied with it.
- **D5 - agent-execute.** Wiring is deferred to when its code lands (issue task 6). Confirm
  this is tracked under that spec, not here.

## Follow-ups (tracked)

- Create `AIClarityAU/scroogellm-feedback` and templates: **to be filed on approval** (human).
- Scrooge command wiring: in the private scroogellm repo, after D1.
- agent-execute wiring: with its first code (see D5).
