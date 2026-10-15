---
id: SPEC-189
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-009  # Team Readiness - guardrails a shared repo must carry; this is the "activate the reviewer SPEC-033 scaffolds" step
aspects: [reviewer, github-app, secrets, consent, gh-cli, tier-0, init, no-silent-gate, blast-radius, credential-handling]
depends_on: [DR-050, DR-054, SPEC-033]  # DR-050 = the read-probe-autonomous / mutation-consent-gated rule this follows; DR-054 = the rule that the shared App key never ships to a customer repo; SPEC-033 = scaffolds the workflow this activates and owns the FR-4 checklist this turns into actions
relates_to: [SPEC-034, DR-052, DR-033, "#621", "#564", "#619", "#560", "#428", "#561", "#559", "#796"]
implements: none
implements_reason: Specify phase only (#621 dispatch). Owned files are declared in Plan once Clarify D-1 and D-2 settle the shape; no file is owned before then.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Reviewer activation offer on init (set the reviewer secrets and install the review App, with consent) — Requirements

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, answers the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement below is written
> under each decision's **recommended** option; choosing a different option changes only
> the requirements that decision names.

**Date:** 2026-10-16
**Triggered by:** [#621](https://github.com/AIClarityAU/minspec/issues/621) — Slice 3 of
[#564](https://github.com/AIClarityAU/minspec/issues/564) (ship the CI review stack to
adopters), deferred there because it needs GitHub admin rights and the human's own values.
**Rests on:** [DR-050](../../../docs/decisions/DR-050.md) (shelling the user's own `gh` on
consent; read-only probes autonomous, mutations consent-gated) ·
[DR-054](../../../docs/decisions/DR-054.md) (one shared `minspec-sdd` App; its private key
never goes into a customer repo) · [SPEC-033](../SPEC-033-repo-governance-provisioning/requirements.md)
FR-4 (the activation checklist this turns from text into actions).
**Relates:** [SPEC-034](../SPEC-034-oidc-review-broker/requirements.md) (the OIDC broker
that removes the two App secrets from the default path; `status: planning`, not built).

## One-sentence scope

After Init (and from SPEC-033's *Check Repo Governance* command), when the ai-review
workflow is scaffolded but the secrets it needs are missing, offer — non-modal, one
explicit click per write — to set each missing reviewer secret on **this repo** through
the user's own `gh`, and to open the review App's install page, without MinSpec ever
logging, storing or putting a secret value on a command line, and without ever reporting a
step as done that it did not confirm.

## Context — what the code does today (read from this branch, `origin/main`, not inferred)

### The reviewer needs three secrets, all of them, or it skips

- `.github/workflows/ai-review.yml:205-217` — the guard step reads
  `CLAUDE_CODE_OAUTH_TOKEN`, `MINSPEC_APP_ID` and `MINSPEC_APP_PRIVATE_KEY`; if **any** is
  empty it prints a `::notice` ("Skipping — this is NOT a failure") and every later step is
  skipped. `:219-227` then mints the App installation token from the two App secrets.
- `packages/minspec/src/lib/ruleset-advisor.ts:712-716` — `REVIEWER_SECRETS` is the single
  source of truth for those three names; `:741` `REVIEWER_OPTIONAL_SECRETS =
  ['ANTHROPIC_API_KEY']`.
- `ruleset-advisor.ts:768-790` — `probeReviewerConfigured` already reads the repo's
  Actions-secret **names** (`gh api repos/{o}/{r}/actions/secrets --jq '[.secrets[].name]'`)
  autonomously, authorised by DR-050's 2026-07-16 amendment (#796). It returns a
  **boolean** and folds every read failure into `false`.
- `packages/minspec/src/commands/init.ts:797` — the ruleset advisor uses that boolean to
  decide whether `ai-review` may become a **required** check (the #559 deadlock guard).

### Correction to the issue's premise

The issue says *"No App → ai-review falls back to `GITHUB_TOKEN` actor (weaker
provenance)."* **That is not what the shipped workflow does.** With either App secret
missing, the guard at `ai-review.yml:211-215` skips the whole review; there is no
`GITHUB_TOKEN` posting path (the workflow's own token is `contents: read`,
`ai-review.yml:184-185`). So "no App" means **no review at all**, not a weaker one. This
spec is written against the code, not the issue's sentence.

### Consequence of DR-054 for "install the minspec-sdd App"

The two App secrets are a **private key and its App id**. DR-054 rejects shipping the
shared `minspec-sdd` App's private key into any customer repo outright
(`DR-054.md:199-201`: "a shared, extractable secret → anyone forges `minspec-sdd[bot]`
`ai-review:pass` on every install"), and SPEC-034 FR-5 restates it. Until SPEC-034's broker
exists, installing `minspec-sdd` on an adopter's repo therefore achieves nothing: the
workflow still needs a private key the adopter must not have. Today the only people who
can complete activation are:

1. **the operator of `minspec-sdd`** (the founder, on his own repos), who holds its key;
2. **anyone with their own GitHub App** — SPEC-034 FR-10's "customer-own-app" override,
   which today is simply "put your own App's id and key in these two secrets".

That is why D-1 below is the load-bearing decision of this spec.

### What exists — do not rebuild

| Piece | Where | Reuse as |
|---|---|---|
| `gh` readiness probe | `ruleset-advisor.ts:185` `isGhReady` | gate for every gh path |
| Single sanctioned spawn point | `ruleset-advisor.ts:124` `defaultCommandRunner` (`execFile`, no shell) | the only way any write here is spawned |
| Secret-name probe | `ruleset-advisor.ts:768` `probeReviewerConfigured` | basis for FR-1 (needs a tri-state variant, FR-1) |
| Required-secret names | `ruleset-advisor.ts:712` `REVIEWER_SECRETS` | the list this offer walks — never a second copy |
| stdin-not-argv write precedent | `ruleset-advisor.ts:530-537` (ruleset JSON over `--input -`) | the pattern for FR-4 |
| Non-modal post-init offer, consent on the click | `init.ts` `offerRulesetAdvisory`, `offerGitHubPrExtensionAdvisory` (`init.ts:1106`) | UX shape for FR-2 |
| 403 / plan-limit classification | `ruleset-advisor.ts:569` `isPlanLimited`, `:589` `githubReason` | error surfacing in FR-8 |

The autolink advisor the issue names as a sibling (#561) is **not present** in
`packages/minspec/src` on this branch (searched `autolink`, case-insensitive: no match), so
it is not a reusable precedent here.

## Functional requirements

- **FR-1 — Tri-state readiness read (autonomous, read-only).** Determine, for the resolved
  repo, the state of each name in `REVIEWER_SECRETS` as **present**, **absent**, or
  **unknown** (read failed, 403, `gh` not ready, unparseable output). This is the same
  DR-050-authorised names-only read `probeReviewerConfigured` already makes; it runs with no
  prior toast. **Unknown is never collapsed into absent** for the purpose of this offer:
  "unknown" renders as "could not check" and the offer falls back to the advisory path
  (FR-7), so a permissions gap never produces an invitation to overwrite secrets that may
  already exist. (The existing boolean caller keeps its fail-safe `false`; this is an
  additional read shape, not a change to the #559 guard.)
- **FR-2 — When the offer appears.** Non-modal, never focus-stealing, and only when all
  hold: `.minspec/` exists at the repo root (constitution invariant 3); `ai-review.yml` is
  present in `.github/workflows/`; FR-1 reports at least one name **absent** and none
  **unknown**. Shown on the first-init path (alongside the existing advisories) and from
  SPEC-033 FR-2's *Check Repo Governance* command. Silent when all three are present —
  "nothing to offer" says nothing. Declining ("Not now") records nothing and makes no
  network call; it is offered again only on the next explicit governance check, never on
  every open.
- **FR-3 — One click per write, with the target named.** Each secret is its own step with
  its own confirm button. The toast/step text names the **exact** target as `owner/repo`
  and the **secret name** before the click. There is no "set all" button and no persisted
  "always allow" setting (DR-050 condition 2 and its *Costly to Refactor* bar on global
  toggles).
- **FR-4 — Value handling (the security core).**
  - **FR-4a — Never on argv.** No secret value is ever passed as a process argument (no
    `gh secret set --body <value>`): argv is readable by any local process through the
    process table. Values reach `gh` on **stdin** only, through `defaultCommandRunner`
    (`execFile`, no shell), exactly as the ruleset JSON does today.
  - **FR-4b — Never persisted.** No value is written to disk, workspace/user settings,
    `globalState`/`workspaceState`, VS Code `SecretStorage`, an output channel, a log, a
    telemetry event, a notification, or an error message. The value lives only in the
    local variable that is piped to the child process and is dropped when the call returns.
  - **FR-4c — Masked entry.** Token-type values (`CLAUDE_CODE_OAUTH_TOKEN`) are entered
    through a `showInputBox` with `password: true` and `ignoreFocusOut: true`. The App id is
    not secret but is entered the same way for one code path.
  - **FR-4d — The private key comes from a file the user picks.** `MINSPEC_APP_PRIVATE_KEY`
    is never typed or pasted: the user picks the `.pem` file via `showOpenDialog`; the
    file is read once and piped over stdin. Before sending, the content is checked for
    the raw PEM shape (`-----BEGIN ... PRIVATE KEY-----` … `-----END ... PRIVATE KEY-----`).
    A base64-wrapped or non-PEM file is refused with the reason, because
    `create-github-app-token` needs raw PEM (`ai-review.yml:136-137`, ACTIVATION step 2) and
    a wrong value would make the reviewer fail rather than skip.
  - **FR-4e — The App id is checked as an integer** (digits only) before it is sent.
- **FR-5 — Repo scope only, explicit target.** Every write passes `--repo owner/repo`
  explicitly, resolved the same way the ruleset advisor resolves it. Never `--org`, never
  `--env`, never `--user`, and never rely on `gh`'s default-repo resolution (a fork
  checkout with an `upstream` remote can resolve to someone else's repo). The blast radius
  is the one repo that carries `.minspec/` (constitution invariant 3).
- **FR-6 — No silent overwrite.** A name FR-1 reports **present** is shown as "already set
  (value cannot be read back)" and is not offered for writing. Replacing it is a separate,
  explicitly labelled *Replace* action, never the default button.
- **FR-7 — Zero-network fallback always available.** If `gh` is not ready, FR-1 says
  unknown, a write returns 403, or the user picks *Show steps*, the offer shows the manual
  steps as text (the `gh secret set NAME --repo owner/repo` commands with **no values**,
  the App install link, and `claude setup-token` for the OAuth token) and changes nothing.
  The copy-to-clipboard of those steps carries no value (DR-050 condition 3).
- **FR-8 — Outcome honesty.** A step is reported **set** only if `gh` exits 0 **and** a
  re-read of the secret names (FR-1) then reports that name **present**. Any other outcome
  is reported as what happened: "failed: <`githubReason` text>", "needs repo admin" (403),
  or "could not confirm". Name presence is all that can be confirmed: the summary says
  "present — value not verifiable" and never "configured" or "working"; only a real
  ai-review run proves the values (SPEC-033 INV-5, evidence discipline).
- **FR-9 — App install link.** A separate *Open App install page* step opens, via
  `vscode.env.openExternal` on the user's click only, the install page of the App the
  user is activating (see D-1 for which App). MinSpec does not claim to detect whether the
  App is installed on the repo: I believe the installation endpoints readable with a
  `gh` user token do not answer this for an arbitrary App (unverified — Plan must check
  the GitHub docs before relying on either answer). Until a probe is shown to work, the
  install step stays an **unchecked** item, never ticked.
- **FR-10 — No automatic chaining into required checks.** Setting the secrets changes
  `probeReviewerConfigured`'s answer, which in turn lets the ruleset advisor make
  `ai-review` a **required** check (`init.ts:797`). If the values are wrong, a required
  `ai-review` that always fails would block every merge — the #559 deadlock reached
  another way. So this offer never triggers the ruleset advisor itself, and its closing
  message says: run one PR to see a real ai-review verdict before making `ai-review`
  required (matches ACTIVATION step 3, `ai-review.yml:153-160`, "AFTER a verified run").
- **FR-11 — `REVIEWER_SECRETS` stays the single list.** The offer walks
  `REVIEWER_SECRETS` (and nothing else); it adds no second copy of the names. Once SPEC-034
  ships and the default path needs no App secrets, the offer for the two App secrets
  disappears with the list change, not with a separate edit (SPEC-033 FR-4 anti-drift
  note). `REVIEWER_OPTIONAL_SECRETS` (`ANTHROPIC_API_KEY`) is out of scope (see D-4).
- **FR-12 — Keyboard reachable.** Every step (confirm, Replace, Show steps, Not now) is
  reachable by keyboard; the governance command that hosts it shows its keybinding.

## Security requirements

- **SEC-1 — Spawn surface.** The only new process spawned is `gh`, through the existing
  `defaultCommandRunner` — `lib/ruleset-advisor.ts` is the file on the
  `invariants.test.ts:204` `child_process` allowlist, so no new file joins that allowlist —
  invoked with
  `execFile`, a fixed argument vector (`secret`, `set`, a name drawn from
  `REVIEWER_SECRETS`, `--repo`, the resolved slug) and the value on stdin. No shell, no
  string-built command line, no user-supplied text in argv other than the slug, which is
  checked against `^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$` before use.
- **SEC-2 — No network code in the extension.** No `http`/`https`/`fetch`/`net` import
  (DR-004 Tier-0 lint, DR-050 condition 1). The extension opens no socket; `gh` and the
  browser do.
- **SEC-3 — Never the shared key.** No MinSpec artifact (vsix, template, doc string,
  default value, test fixture) contains or points to a copy of the `minspec-sdd` private
  key. The offer never presents the shared App as something an adopter can supply a key
  for (DR-054). Test fixtures for FR-4d use a generated throwaway key **shape**, never a
  real one.
- **SEC-4 — Error text is value-free.** Errors surfaced from `gh` are passed through
  `githubReason` / a fixed message; stdout/stderr of a `secret set` call is never echoed
  raw, so a misbehaving `gh` build that echoed its input could not leak the value into a
  notification.
- **SEC-5 — The PEM file is read, not kept.** The file path is not stored; the file is not
  copied, moved or deleted; the content buffer is not retained after the call.

## Invariants the change must not break

- **Constitution 1 — offline core, network only with consent.** The secret-names read is
  the already-authorised read-only probe (DR-050 amendment, #796); every write and the
  browser open happen only on an explicit click; decline and absent-`gh` paths make zero
  network calls.
- **Constitution 2 — no silent gate.** A failed or unconfirmed write is never shown as
  done (FR-8); an unreadable state is "unknown", never "absent" or "present" (FR-1); the
  #559 required-check guard is not weakened and not auto-chained (FR-10).
- **Constitution 3 — blast radius.** Only the repo with `.minspec/` at its root is ever
  written, at repo scope only (FR-2, FR-5).
- **SPEC-033 INV-5 — headless honesty.** App install and value correctness stay unchecked
  unless confirmed.
- **DR-054 — the shared App key is never distributed** (SEC-3).

## Acceptance criteria

1. Fresh repo with `.minspec/` and `ai-review.yml`, `gh` authenticated as repo admin, no
   secrets: Init shows one non-modal offer naming `owner/repo` and the three missing
   names; no `gh secret set` runs until a click. [FR-2, FR-3]
2. Setting `CLAUDE_CODE_OAUTH_TOKEN` through the masked box: the spawned argv (captured by
   an injected `CommandRunner`) contains no value; the value arrives on stdin; afterwards
   the name is re-read as present and reported "present — value not verifiable". [FR-4a,
   FR-4c, FR-8]
3. Picking a base64-encoded PEM is refused with the raw-PEM reason and nothing is sent;
   picking a raw PEM sends it over stdin. [FR-4d]
4. A test sweeps every output channel line, notification string, settings write and
   `globalState`/`SecretStorage` call made during the flow and finds no fragment of the
   test values. [FR-4b, SEC-4]
5. With the secrets read returning 403: no offer to write, an advisory with the manual
   steps (no values) instead. [FR-1, FR-7]
6. With one name already present: it shows "already set", is not written, and *Replace* is
   a separate action. [FR-6]
7. `gh secret set` exits 0 but the re-read does not show the name: the step reports "could
   not confirm", not "set". [FR-8]
8. After all three are set, no ruleset create/update runs as part of this flow, and the
   closing message tells the user to verify one ai-review run first. [FR-10]
9. Every write's argv carries `--repo owner/repo` and none carries `--org`/`--env`/`--user`.
   [FR-5]
10. Repo without `.minspec/` at its root: no probe, no offer. [Constitution 3]

## Out of scope

- **Building SPEC-034's broker**, or changing `ai-review.yml`'s secret model.
- **Setting `AI_REVIEW_BOT_LOGINS`.** `ready-to-merge.yml:166` already defaults it to
  `minspec-sdd[bot]`; a customer-own-app user needs it set to their bot login, which is a
  follow-up only if D-1 lands on option (b) — see Follow-ups.
- **Making `ai-review` a required check** — the ruleset advisor's job, deliberately not
  chained (FR-10).
- **Running `claude setup-token`** for the user. It is listed as a manual step; MinSpec
  does not drive the Claude CLI's login (DR-052 genuine-CLI posture).
- **Org-level secrets** — a different blast radius; not offered.

## Decisions needed (Clarify)

- **D-1 — Which App does the offer serve, while SPEC-034 is unbuilt?**
  - **(a) Customer-own-app wording only (rec).** The offer asks for "your GitHub App's id
    and private key" and links GitHub's *create a GitHub App* docs plus the install page of
    the App whose id they entered. It never names `minspec-sdd` as installable for review
    until SPEC-034 ships, at which point the App-secret steps vanish (FR-11) and the
    install step becomes `minspec-sdd`. *Cost:* adopters get no one-click "install
    minspec-sdd" today, so the issue's literal ask is not delivered for them; the founder's
    own repos work the same way (he enters `minspec-sdd`'s id and key as "his own App").
  - **(b) Offer `minspec-sdd` install as the issue says.** *Cost:* for anyone but the
    founder it is a dead end — the App is installed, the review still skips — and it
    invites adopters to ask for the shared key, the exact thing DR-054 rejects.
  - **(c) Defer the whole spec until SPEC-034 ships**, leaving only the
    `CLAUDE_CODE_OAUTH_TOKEN` step. *Cost:* the reviewer cannot be activated from the
    editor at all until then, because it needs all three.
- **D-2 — Private-key transfer path.**
  - **(a) Extension reads the picked file and pipes it to `gh` over stdin (rec).** No
    shell, PEM shape checked before sending (FR-4d). *Cost:* the key passes through the
    extension host's memory for the length of one call — transient custody, against the
    letter of DR-054's "MinSpec holds no token".
  - **(b) Open an integrated terminal running `gh secret set NAME --repo … < <path>`.**
    The extension never touches the bytes. *Cost:* needs a shell, so the path must be
    shell-quoted correctly on every platform (an injection surface if it is not), the
    exit code is not visible to the extension so FR-8 relies on the re-read alone, and no
    raw-PEM check is possible.
  - **(c) Text only (advisory).** *Cost:* no one-click path for the hardest step, which is
    also the one people get wrong (base64 vs raw PEM).
- **D-3 — Tier: T3 or T4?** It writes credentials into a remote repo through the user's
  admin token. *Recommendation:* **T3 (rec)** — no new boundary (the gh write path and
  consent rule exist, DR-050), every write is single-repo, reversible (`gh secret delete`)
  and consent-gated. *Cost:* T3 skips the full T4 ceremony; the security review of the
  value-handling code (FR-4, SEC-1..5) must then be asked for explicitly on the implement
  PR rather than coming with the tier.
- **D-4 — Offer `ANTHROPIC_API_KEY` too?** It is in `REVIEWER_OPTIONAL_SECRETS`.
  *Recommendation:* **no (rec)** — keep the offer to what the reviewer cannot run without.
  *Cost:* a pay-as-you-go user sets it by hand.

## Follow-ups (tracked — DR-023)

- **SPEC-034** (OIDC broker) — when it ships, the two App-secret steps disappear through
  `REVIEWER_SECRETS` (FR-11) and the install step targets `minspec-sdd`. Tracked by
  SPEC-034 itself.
- **App-install probe** (FR-9) — Plan verifies against GitHub's docs whether any endpoint
  readable with the user's `gh` token answers "is App X installed on this repo"; no new
  issue until Plan finds one that works.
- **`AI_REVIEW_BOT_LOGINS` for customer-own-app** — needed only if D-1 = (a) or (b) with a
  non-`minspec-sdd` App; file the issue at Clarify time if D-1 lands there (not filed from
  this offline dispatch, which may not run `gh`).
- **#561 autolink advisor** — named in the issue as a sibling pattern; not on this branch.
  No dependency: this spec follows `offerRulesetAdvisory` instead.

No DR is minted: every choice here is reversible within a day and the consent rule it
applies is already decided by DR-050.
