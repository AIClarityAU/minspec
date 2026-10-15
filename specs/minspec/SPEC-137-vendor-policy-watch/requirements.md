---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - an LLM vendor's terms are an upstream dependency of how dispatch may use a credential
aspects: [infra, dev-time, vendor-terms, policy-watch, scheduling, no-silent-gate, untrusted-input, bot-identity, blast-radius]
depends_on: [DR-052]  # DR-052 names this watch as its follow-up and says what it must re-verify (the paused Agent SDK credit and the consumer-OAuth wording)
relates_to: [DR-016, DR-017, DR-084, "#431", "#74", "#407", "#1210", "#239", "#442"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Every file is
# NEW and needed under every answer to the questions below: the runner, the committed
# provider table, its README, and the test that pins the trust split and the verdict rules.
implements: [scripts/policy-watch/run-policy-watch.sh, scripts/policy-watch/check-policies.mjs, scripts/policy-watch/post-verdicts.mjs, scripts/policy-watch/providers.json, scripts/policy-watch/README.md, packages/minspec/tests/policy-watch.test.ts]
# Modified, not owned. The session-start hook gains one block beside the tooling radar's
# (OQ-2 recommended answer); `.gitignore` gains the local state directory (OQ-1 recommended
# answer).
affects: [scripts/hooks/session-start.sh, .gitignore]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Vendor policy watch - a weekly, deterministic "changed / unchanged since <date>" check of each integrated LLM vendor's terms, with no new cron

## In plain terms

When Anthropic changed its consumer-OAuth terms and paused the separate Agent SDK credit,
we only learnt of it by chance. That change rewrote how dispatch may use a subscription
([DR-052](../../../docs/decisions/DR-052.md), via #74 and #407). This spec adds a weekly
check for each LLM vendor we use. It downloads the vendor's legal and pricing pages,
reduces each to plain text, and hashes it. Then it posts one of four answers on that
vendor's tracking issue: **changed**, **unchanged**, **first look** or **could not read**.
The answer comes from the hash, never from a model. A page that changes also gets a
follow-up issue. That issue lists the decisions which rest on the vendor's terms and the
claims a human should re-check. The check runs from session start, like the weekly
tooling radar (#1210), so there is no new cron.

Cost: one more background job on session start, and a person still has to read the legal
diff when something changes. Left out: deciding *whether* a change matters (a human
does), and updating the minspec.dev compliance page (OQ-5). Riskiest assumption: the
vendor pages reduce to stable text. Some may render client-side, and some may carry
per-request noise. The text floor (FR-9) catches the first case and fails it visibly.
The second is unmeasured and gets measured in Plan.

> **SPECIFICATION ONLY.** The session that wrote this built nothing. A human reads it and
> approves it through the normal spec-approval gate before any design or code. The
> questions under **[Decisions needed (Clarify)](#decisions-needed-clarify)** each carry
> a recommended answer and its cost. None is answered yet.

**Where this came from.** Issue #431, "recurring weekly-ish ToS/policy watch for each
integrated LLM (due-date-on-issue, agent-driven, no new cron)". Its three scope items:

1. a tracking issue per provider with a `due` field;
2. an agent step that fetches and diffs the vendor legal and pricing pages, posts a
   "changed / unchanged since <date>" verdict and moves `due` on by a week;
3. a stored snapshot of the last-seen terms hash, so that "changed" is deterministic.

DR-052's *Follow-ups (tracked)* names #431 as the place that re-checks the June-15 pause
of the Agent SDK credit and the consumer-OAuth wording on every sweep (DR-052 decision 7).

## One-Sentence Scope

Add a dev-time script under `scripts/policy-watch/`, triggered from this repo's
session-start hook when a provider is due. With no model in the loop, it fetches the
fixed set of vendor pages in a committed table, hashes their normalised text, and posts a
deterministic verdict to each provider's tracking issue as `minspec-sdd[bot]`. It moves
that provider's due date on, and files a follow-up issue when a page changed. None of it
ships in the extension or in any adopter template.

## Context - what exists today (read from this worktree's base, 5f792386, not inferred)

- **The tooling radar is the precedent.** `scripts/tooling-radar/run-radar.sh` runs
  weekly and is split into stages by trust. Stage 1 is `claude -p` with web tools only.
  Stage 2, `file-findings.mjs`, has no model and holds the App credential. It picks repo
  and labels from a fixed table, calls `gh` with an argv array and passes the body on
  stdin (`scripts/tooling-radar/README.md`, "Why two stages").
- **"Due", without a cron, already exists.** `run-radar.sh --due` answers "should a scan
  start now?" (interval 7 days, retry 6 hours after a failure). `--status` answers "is it
  healthy?" and fails when the last success is older than 10 days.
  `scripts/hooks/session-start.sh:116-155` calls both. It runs only in the primary checkout
  (not linked worktrees), claims a `mkdir` lock so sessions that start together launch
  one scan, and prints a visible line when the radar is unhealthy. Every run writes
  `.radar/health.json`, which is gitignored (`.gitignore:135-136`).
- **The bot identity is minted per run.** `file-findings.mjs:187-195` mints an App
  installation token through `RADAR_TOKEN_CMD` (default `~/.claude/scripts/gh-app-token.sh`)
  and stops with an error when it cannot. It never falls back to the ambient `gh` login.
- **Integrated vendors.** Anthropic is the only LLM vendor whose credential this repo's
  machinery uses today: `claude` CLI dispatch, ai-review, the radar's scan stage. I
  believe this from reading DR-052 and the scripts above; I did not run an exhaustive
  grep of every package. Z.ai (ZCode) is on the way through SPEC-136 but is not
  integrated yet.

## Terms

| Term | Meaning here |
|---|---|
| **Provider** | One LLM vendor row in `providers.json`: id, display name, tracking issue, pages, related DRs, watched claims. |
| **Page** | One HTTPS URL in a provider row. Only URLs written in the committed table are fetched (FR-4). |
| **Normalised text** | The page body after the fixed reduction in FR-7. This is what gets hashed. |
| **Snapshot** | The normalised text and its SHA-256 for one page, as last seen. |
| **Verdict** | One of `changed`, `unchanged`, `baseline` (no earlier snapshot, so this run is the first look), `unreachable`. One per page, rolled up to one per provider (FR-12). |
| **Due** | The UTC time when a provider's next check should run. |
| **Tracking issue** | One open GitHub issue per provider, named in the table, where verdicts are posted. |

## Functional Requirements

### A. Where it lives and who it can touch

- **FR-1 Dev-time only.** All code lives under `scripts/policy-watch/`, plus one block in
  `scripts/hooks/session-start.sh`. Nothing goes into `packages/*/src`, the `.vsix`, the
  generated CI templates or the scaffold templates. Adopters never receive it
  (constitution invariant 3).
- **FR-2 This repo only.** The hook block runs only in a checkout whose root contains
  `.minspec/` and the `scripts/policy-watch/` directory, and only in the primary checkout,
  not in linked worktrees (the same `--git-dir` against `--git-common-dir` test as the
  radar).
- **FR-3 Network use is opted into by being in the table.** The watch fetches only the
  URLs in `providers.json` and talks only to the GitHub API. Adding a URL to the table
  is a reviewed commit, and that commit is the consent. No other host is contacted.

### B. The provider table

- **FR-4 Fixed URLs, from the committed table only.** Each `pages[]` entry is an absolute
  `https://` URL. URLs never come from an issue body, a comment, a fetched page or a
  model. A redirect is followed only to a host listed in that provider's `allowedHosts`.
  A redirect anywhere else gives the page the verdict `unreachable` (reason:
  `redirect-off-allowlist`), and the target is not fetched.
- **FR-5 Row shape.** Each provider row holds: `id` (lowercase slug), `name`,
  `trackingIssue` (an issue number in `AIClarityAU/minspec`), `pages[]` (`url`, `label`),
  `allowedHosts[]`, `relatedDecisions[]` (for example `DR-016`, `DR-017`, `DR-052`) and
  `watchedClaims[]` (short sentences a human re-checks on a change, for example "Agent SDK
  credit is still paused - DR-052 decision 7"). The table is checked against a schema
  when it loads. A bad table stops the run with an error before anything is fetched.
- **FR-6 Starting rows.** At first the table holds Anthropic only. Which pages it lists
  is OQ-4. Each URL is confirmed in Plan by one manual fetch; this spec does not claim
  any URL resolves.

### C. Fetch, reduce, hash - no model

- **FR-7 Deterministic reduction.** One `GET` per page, with a fixed User-Agent that
  names the project and a timeout. The body is reduced by fixed rules, applied in a fixed
  order:
  - drop `<script>`, `<style>`, `<noscript>`, `<svg>` and HTML comments;
  - drop all tags and decode entities;
  - apply Unicode NFC;
  - collapse runs of whitespace to one space, and lines to single newlines;
  - trim the result.

  Plan may add per-page `stripPatterns` (fixed regexes in the table) if measurement shows
  per-request noise. Those patterns are committed, never learnt. The same bytes always
  give the same normalised text.
- **FR-8 No model in the verdict path.** Nothing between the fetch and the verdict calls
  a model or a tool that summarises, such as `WebFetch`. The verdict is a pure function
  of (earlier SHA-256, new SHA-256, fetch outcome). This is what makes "changed"
  deterministic, which the issue asks for. A test pins it (AC-2).
- **FR-9 Text floor.** If the normalised text is shorter than a floor (default 2,000
  characters, settable per page), the verdict is `unreachable` (reason:
  `below-text-floor`) and the text is **not** stored as a snapshot. A page rendered by
  JavaScript, a bot-check page or a consent wall would otherwise be hashed as a stable
  shell, and would report `unchanged` for ever.
- **FR-10 Failures are verdicts, never silence.** Each of these makes the page's verdict
  `unreachable`, with the reason kept: a network error, a timeout, a non-2xx status after
  allowed redirects, an off-allowlist redirect, or text below the floor. An unreachable
  page never yields `unchanged`, and never replaces the stored snapshot.

### D. Verdicts and state

- **FR-11 Per-page verdict.**
  - No snapshot stored: `baseline`.
  - Stored hash equals the new hash: `unchanged`.
  - Stored hash differs: `changed`.
  - Fetch failed under FR-10: `unreachable`.

  On `baseline` and `changed` the new snapshot replaces the old one. The old one is kept
  as `previous`, so a diff can be rendered.
- **FR-12 Per-provider roll-up.** The provider takes the worst page verdict, in the order
  `changed` > `unreachable` > `baseline` > `unchanged`. The posted comment always lists
  every page with its own verdict, so a roll-up never hides an unreadable page behind a
  changed one.
- **FR-13 Due arithmetic.**
  - After a run whose roll-up is `changed`, `unchanged` or `baseline`, due = run time + 7
    days.
  - After `unreachable`, due = run time + 6 hours (retry), and the run is counted as
    failed for `--status`.
  - Both intervals can be set through the environment, like the radar's.
- **FR-14 State home.** Snapshots, the due time per provider, and the record of which
  follow-up was filed for which hash all live where OQ-1 decides. Under the recommended
  answer that is a gitignored `.policy-watch/` directory, plus a `due:` line mirrored
  into the tracking issue body (FR-17). A missing or unreadable state store means
  `baseline` for every page. It never means `unchanged`.
- **FR-15 `--due`, `--status`, `--dry-run`.** These mean exactly what they mean for the
  radar.
  - `--due` exits 0 when any provider is due.
  - `--status` exits non-zero when the last run failed, when any provider has stayed
    `unreachable` for more than 3 days past its weekly due, or when the last success is
    older than 10 days. It prints the reason on its last line.
  - `--dry-run` fetches and computes verdicts, writes nothing, posts nothing, and prints
    what it would post.

  Every run writes a health record with a temp-file-then-rename, as the radar does.

### E. Posting - no model, bot identity, fixed targets

- **FR-16 Two stages, split by trust.** `check-policies.mjs` fetches and judges. It holds
  no credential and writes only local state and a verdict JSON. `post-verdicts.mjs`
  reads that JSON and holds the App token. It takes the repo and the issue number from
  the committed table, never from the verdict file. It calls `gh` with an argv array and
  passes bodies on stdin. Fetched text reaches an issue only inside a fenced diff block,
  clamped to a fixed length and stripped of control characters.
- **FR-17 Tracking-issue comment and due mirror.** Each run posts one comment per
  provider that ran. The comment's first line is the verdict, worded as `**<verdict>**
  since <last-seen UTC date>`. It then holds a table of pages with their verdicts,
  reasons and short hashes, and, when the verdict is `changed`, a clamped unified diff of
  the normalised text for each changed page. The run then rewrites only the text
  between `<!-- policy-watch:due -->` and `<!-- /policy-watch:due -->` in the issue body,
  to `due: YYYY-MM-DD`. Nothing else in the body is touched. The mirror is for display
  only and is never read back to make a decision (see OQ-1).
- **FR-18 Follow-up on change.** When a provider's roll-up is `changed`, the run files
  one issue in `AIClarityAU/minspec` labelled `inbox`. The issue links the tracking
  comment and lists the provider's `relatedDecisions` and its `watchedClaims` as an
  unchecked checklist. The title and labels are templates, not model output. A follow-up
  is filed at most once per (provider, new hash set). The record of what was filed lives
  in the state store, so a retry never files twice.
- **FR-19 Identity guard.** The posting stage mints an App installation token, as the
  radar does, and asserts that it is non-empty and passes a cheap identity probe before
  the first write. If either check fails, the stage stops with an error and posts
  nothing. It never falls back to the ambient `gh` login, which would post as the human.

### F. Trigger and concurrency

- **FR-20 Session-start trigger.** Under OQ-2's recommended answer, the hook block runs
  `run-policy-watch.sh --status` and prints one visible line when that fails. It then
  runs `--due`, claims `.policy-watch/.lock` with `mkdir`, and runs the watch in the
  background, appending to `.policy-watch/run.log`. The block must not make session
  start fail. It must also not hide a failed watch, which `--status` reports on the next
  start. The lock is released when the run exits.
- **FR-21 One run at a time.** A run that cannot claim the lock exits 0 without fetching.
  A lock older than 2 hours is treated as stale. The next run reports it on its health
  line, and then reclaims it.

## Acceptance Criteria

- **AC-1** Fixture HTML in, normalised text out: the same bytes give byte-identical text
  and hash across two runs, and a change only in `<script>`, attributes or whitespace
  gives the same hash.
- **AC-2** A test asserts that `check-policies.mjs` imports no model client and spawns no
  `claude` process, and that the verdict function is pure: the same inputs give the same
  verdict, with no I/O.
- **AC-3** A missing or deleted state store gives `baseline` for every page, never
  `unchanged`.
- **AC-4** Each failure under FR-10 (network error, timeout, 403, redirect off the
  allowlist, text below the floor) gives `unreachable` with the matching reason, leaves
  the stored snapshot untouched and sets due to +6 hours. A JavaScript shell page below
  the floor is never stored as a baseline.
- **AC-5** Roll-up: one page `changed` and one `unreachable` gives a provider verdict of
  `changed`, and the comment body lists both pages with their own verdicts.
- **AC-6** Changing a URL in the verdict JSON, or a repo or issue field in it, has no
  effect on where `post-verdicts.mjs` posts. Targets come only from the table.
- **AC-7** With an empty token, or a token that fails the identity probe,
  `post-verdicts.mjs` exits non-zero and invokes `gh` zero times. Tested with a stubbed
  `gh` that records its calls.
- **AC-8** A second run on the same changed hash files no second follow-up issue.
- **AC-9** The due mirror rewrite changes only the marked block. Body text outside the
  markers is byte-identical before and after.
- **AC-10** `--status` exits non-zero, with a reason line, when health says failed, when
  the last success is older than 10 days, and when a provider has been `unreachable` for
  more than 3 days past due.
- **AC-11** A grep test asserts that no file under `packages/*/src`, and no scaffold or
  CI template, references `policy-watch`. This pins FR-1, invariant 3.
- **AC-12** `--dry-run` writes no state file and makes zero `gh` calls.

## Invariants (must not break)

- **Constitution 1 (offline core).** The extension gains no network call. This is a
  dev-time script in this repo, and its only network use is the committed URL table and
  the GitHub API (FR-1, FR-3).
- **Constitution 2 (no silent gate).** A watch that stopped running must not look like a
  quiet month. Failures become `unreachable` verdicts and a failing `--status` line at
  session start, never a swallowed error. No `|| true` sits on any line that writes a
  verdict or health record. A missing baseline is never read as `unchanged`.
- **Constitution 3 (blast radius).** Nothing ships to adopters (FR-1, AC-11).
- **Global DR-345 (mmo-platform register; untrusted input).** No model that reads
  fetched pages holds filesystem, shell or credential access. Under the recommended
  answer no model reads them at all (OQ-3).
- **Bot attribution.** Every write is by `minspec-sdd[bot]`, never by the founder's
  identity (FR-19).

## Decisions needed (Clarify)

### OQ-1 - Where does the authoritative due date and last-seen hash live?

- **A (rec)** A gitignored local `.policy-watch/` holds the snapshots, the due times and
  the follow-up record. The tracking issue carries a `due:` line mirrored from it, for
  display only. This is the radar's proven shape. It needs no network to know what is
  due, and it keeps full snapshot text, so a real diff can be shown. **Cost:** the state
  is per host. A wiped container loses the baseline, so the next run says `baseline` and
  a change made in that gap is reported as a first look, not as `changed`.
- **B** The tracking issue is authoritative. The run reads `due:` from the issue body and
  the last hash from the latest bot-written comment's marker. This survives a host wipe.
  **Cost:** every check needs the network and a token before it knows whether anything
  is due. An issue body is editable by anyone with write access, so `due:` becomes input
  to trust. No full prior text is kept, so a `changed` comment can show hashes but no
  diff.
- **C** A GitHub Projects (v2) Date field. It is native and can be queried. **Cost:** it
  needs the App to hold the Projects permission (a ruleset and App-scope change), and it
  has all the network costs of B.

### OQ-2 - What triggers the run?

- **A (rec)** The session-start hook, using `--due`, beside the radar (FR-20). There is
  no new cron, which matches the issue. **Cost:** if no session starts in this repo for
  more than a week, no check runs. The gap is visible on the next start through
  `--status`, but not before.
- **B** The sibling recurring auto-process loop the issue names (the SealBox /
  comment-watcher agent). **Cost:** that loop is not in this repo and has no issue number
  here, so the watch would depend on an unbuilt or out-of-repo component. It could be
  adopted later by calling `run-policy-watch.sh`, which needs no redesign.
- **C** Also install a systemd user timer, as `scripts/tooling-radar/install.sh` does.
  **Cost:** this is the new cron the issue asked to avoid, and it can only be installed
  from a host shell, not from the dev container.

### OQ-3 - Should a model summarise a change?

- **A (rec)** No. The comment carries the clamped deterministic diff and the watched-claims
  checklist, and a human reads the legal text. **Cost:** a long legal diff is slow to
  read, and a reformatted page shows as a large diff.
- **B** Add a third stage: a model with **no tools at all**, given the diff as text, which
  writes a plain-language summary marked as model-written. The verdict stays
  hash-derived. **Cost:** model spend on every change, and a summary that can be wrong
  about legal meaning while reading as authoritative.

### OQ-4 - Which Anthropic pages go in the first table?

- **A (rec)** These five:
  - consumer terms;
  - commercial terms;
  - usage policy;
  - the Claude Code legal and compliance page (the one DR-052's consumer-OAuth reading
    came from);
  - the plans and pricing page (it carries the Agent SDK credit wording).

  These are the pages DR-052's decision rests on. **Cost:** pricing pages change often
  for marketing reasons, so expect `changed` verdicts that do not matter.
- **B** Legal pages only, without pricing. **Cost:** the Agent SDK credit pause, which
  DR-052 decision 7 explicitly asks us to re-check, may only show up on pricing or help
  pages and would be missed.

Z.ai (ZCode) gets a row when SPEC-136's plugin work integrates it, not now.

### OQ-5 - Does a run also update the minspec.dev compliance page (DR-052 follow-up wording)?

- **A (rec)** No, not from this script. The follow-up issue (FR-18) carries a checklist
  line, "re-check the minspec.dev compliance page". **Cost:** the page can lag a vendor
  change until someone works the follow-up.
- **B** Have the watch open a pull request on the site repo. **Cost:** this is
  cross-repo write scope and a new credential path, which is a separate feature
  (CLAUDE.md triage rule 2) and would need its own issue.

## Decision records

None is minted. Every choice here can be undone in under a day: a script directory, a
JSON table and one hook block. OQ-1 B or C would move state onto GitHub, and that can
also be reversed by deleting the markers and the field. The design rests on DR-052
(why the watch exists, and what it re-checks) and on the radar pattern from #1210. If
the founder picks OQ-3 B, it should cite global DR-345 rather than mint a local DR.

## Out of Scope

- Judging whether a change is material, or editing DR-052 and its siblings. A human does
  that from the follow-up issue.
- Vendors other than Anthropic, until they are integrated (OQ-4).
- Watching scroogellm's own provider list. That belongs to `AIClarityAU/scroogellm`,
  which has its own register.
- Any change to the extension, its settings or its status bar.

## What this costs

Each week, about five HTTPS GETs per provider and one or two GitHub API writes, plus one
background job at session start when the watch is due. There is no model spend under
OQ-3 A. Upkeep: when a vendor moves a page, the run reports `unreachable` and someone
edits a URL in the table.

## Alternatives considered and rejected

- **Hash `WebFetch` output, as the issue suggested.** Rejected: `WebFetch` returns a
  model's summary of the page, which differs between runs. Hashing it would report
  `changed` on noise and defeat the issue's own third scope item (FR-8).
- **Reuse the tooling radar's scan stage.** Rejected: that stage is a model reading the
  open web and choosing what to report. This watch needs a fixed URL set and a verdict
  that can be reproduced. The two share only the patterns for posting and health.
- **A GitHub Actions scheduled workflow.** Rejected for now: it is a new cron, the issue
  rules that out, and it would need a workflow change, which is machinery-reviewed.

## Test plan (for the Plan phase to place)

All of AC-1 to AC-12 go in `packages/minspec/tests/policy-watch.test.ts`, beside
`tooling-radar.test.ts`, using fixture HTML, a stub HTTP server on loopback and a
stubbed `gh` that records argv and stdin. No test touches the real network. Before Plan
is settled, one manual `--dry-run` against the real OQ-4 pages records two things: the
normalised length of each page (to set the FR-9 floor) and whether two fetches a minute
apart hash the same (to decide whether FR-7 needs `stripPatterns`).

## Traceability

- Issue: #431. Precedents: #74 and #407, the terms change that produced DR-052.
- Decision this re-checks: [DR-052](../../../docs/decisions/DR-052.md) decision 7 and
  *Follow-ups*; related [DR-016](../../../docs/decisions/DR-016.md) and
  [DR-017](../../../docs/decisions/DR-017.md).
- Pattern reused: the weekly tooling radar, #1210 (`scripts/tooling-radar/`), and the
  session-start trigger pattern from #239.
