---
id: SPEC-416
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - which text may start an agent is a trust boundary of the dev-time pipeline
aspects: [security, provenance, dispatch, triage, prompt-injection, no-silent-gate]
goal: G-2  # Prevent tech debt
relates_to: [DR-105, DR-118, DR-072, DR-076, DR-086, DR-066, DR-123, "#2692", "#2686", "#1203", "#2589", "#1084", "#983"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3).
# NEW files: the shared relay predicate (FR-5), scripts/park-issue.sh (FR-2) and their tests. Files MODIFIED are under
# `affects:`. Every change is under scripts/ or packages/minspec/tests/, so machinery
# review applies to the build.
implements: [scripts/lib/relay-marker.sh, scripts/park-issue.sh, packages/minspec/tests/relay-marker.test.ts, packages/minspec/tests/park-issue.test.ts]
affects: [scripts/tooling-radar/file-findings.mjs, scripts/triage-decide.sh, scripts/triage-inbox.sh, scripts/dispatch-ready-check.sh, scripts/approve-issue.sh, scripts/lib/dispatch-author-gate.sh, CLAUDE.md, packages/minspec/tests/triage-decide.test.ts, packages/minspec/tests/tooling-radar.test.ts]
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-416: Relayed text carries a marker, and triage holds it out of dispatch until a person has read it

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks the recorded selections under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the
> normal spec-approval gate before any code changes. Every requirement is written under
> each decision's recommended option; choosing another option changes only the
> requirements that decision names.

Materializes **[#2692](https://github.com/AIClarityAU/minspec/issues/2692)** (relayed text
filed under the pipeline's own identity), a follow-up of #2686 (the dispatch author gate,
DR-105 "Residual risk"). The issue's "Routed decision (2026-11-25)" chose the shape: a
**relay marker**, held by `scripts/triage-decide.sh`, plus a fail-closed hold on unmarked
radar-shaped issues. The rejected alternative (a second App identity for relayed text) is
recorded under [Decision record](#decision-record).

**Date:** 2026-11-25, read from `main` at `ed6e1ebb`. This dispatch made no network call;
every count and line below is from that checkout.

## One-Sentence Scope

Every writer under `scripts/` that files, as the pipeline's App, an issue whose text the
pipeline did not compose adds a fixed relay marker; one shared, offline predicate
recognises that marker (and, failing closed, any radar-shaped issue that lacks it); and
both the triage gate and the dispatch gate refuse to let such an issue reach an agent until
a human approval names it.

## Context - what exists today (read, not inferred)

### The gap

`scripts/lib/dispatch-author-gate.sh` lets an issue reach triage only when every account
that wrote its text is on a three-entry list (`_dispatch_trusted_identities`, lines 173-178:
the App `Bot:299695933` and the founder's two accounts `User:4125483` and `User:318474157`). Its own comment block "What trusting the App
leaves open" (lines 75-114) lists every path that makes the App write and says which carry
text a stranger can shape. The gate sees the account, not where the words came from, so
"on the list" means *filed by* the pipeline, not *written by* it.

| Writer (from the gate's own list) | Files as | Labels | Stranger-shaped text? | In scope here |
|---|---|---|---|---|
| `scripts/tooling-radar/file-findings.mjs` | App | `idea,inbox` (`LABELS`, line 68) | YES - stage 1 is a model reading the open web | **Yes** (FR-1) |
| Interactive sessions parking tangents and follow-ups | App token (operator config, outside this repo) | `inbox` | YES - quotes what the session was reading | **Yes** (FR-2, FR-3; see DQ-3) |
| `scripts/roles/architect.md` sub-issues | whatever credential the agent can reach | varies | YES | No - DQ-4 |
| `.github/workflows/ai-review.yml` verdict comments | App | n/a (comments) | YES | No - #2589 (same family, review side) |
| `.github/workflows/main-red-watch.yml` | App | `main-red,bug` | NO | No |
| `scripts/direct-push-audit.ts` | caller's | `bug,security` | NO | No |
| `.github/workflows/supply-chain-daily.yml` | `github-actions[bot]` (not listed) | - | already refused | No |

### What the radar already writes

`planFinding` (`file-findings.mjs:136-191`) appends a filer-composed footer after the
model text: a `Source:` line, the sentence "Filed automatically by the weekly tooling radar
(`scripts/tooling-radar/`).", and the dedupe line `radar-key: <key>` (`markerFor`, line
75). None of those is read by triage or dispatch today.

### Where a hold can be decided

- `scripts/triage-decide.sh` is **pure** (no network, no filesystem): verdict block on
  stdin, caller-supplied inputs as flags (`--label`, `--named-spec-status=`), and it emits
  `<label> <role> <hold>`. It never sees the issue body today.
- `scripts/triage-inbox.sh:99` already holds the issue's title and body (`ISSUE_JSON`), and
  composes `"# " + title + "\n\n" + body` (line 131) - the same string
  `dispatch-ready-check.sh` hashes as `bodyHash`.
- `scripts/dispatch-ready-check.sh` reads that same composed body from a `<body-file>` at
  dispatch time to recompute `bodyHash`, and decides which holds a human approval may lift
  (`APPROVABLE_HOLDS="tier specify"`, line 197; `--may-approve`, lines 522-560).
- `scripts/approve-issue.sh` is the human's interactive exit from a hold (#1084); approving
  `tier` or `specify` releases a full build.

## Functional Requirements

### The marker

- **FR-1 - The radar marks what it files.** `planFinding` appends, as a filer-composed
  line after the model's text and outside every model-supplied field, the relay marker
  `<!-- minspec-relayed: tooling-radar -->` followed by a visible line
  `Relayed text: written from untrusted web pages; held from dispatch until a person approves it.`
  The marker is a constant in the filer, never derived from finding fields.
- **FR-2 - One way for a session to park an issue, and it marks.** A new
  `scripts/park-issue.sh <title> <body-file> [--source <word>]` files an `inbox` issue as
  the App through `lib/gh-bot.sh` and appends the marker
  `<!-- minspec-relayed: <source> -->` (default source `session`). `<source>` is restricted
  to `[a-z0-9-]{1,32}`; anything else is refused, not cleaned. It takes the body from a
  file, never from argv, so quoted text cannot become a flag.
- **FR-3 - The repository's instruction points at FR-2.** `CLAUDE.md` Triage Rule 1
  ("Topic drift -> GitHub issue") names `scripts/park-issue.sh` as the way to file. This
  is prose and therefore model-trusted; FR-6's second shape and DQ-3 state what it does not
  cover.
- **FR-4 - The marker grammar is matched broadly.** A marker is any occurrence, anywhere
  in the composed text (`"# " + title + "\n\n" + body`), of `minspec-relayed`
  compared case-insensitively. Broad matching is safe in one direction only: text that
  contains the marker by accident or by forgery is *held*, never released, so a stranger
  who writes the marker gains nothing.

### One predicate

- **FR-5 - A single shared, offline predicate.** `scripts/lib/relay-marker.sh` defines
  `relay_classify <composed-text-file>`, printing exactly one of `relayed`, `radar-unmarked`,
  `composed`, and exiting non-zero (printing nothing) when the file is missing, unreadable or
  empty. It makes no network call, reads no environment variable, and has no switch that
  turns it off (same rule as `dispatch-author-gate.sh` "No switch, no override").
- **FR-6 - Fail closed on a writer that forgot.** `relay_classify` prints `radar-unmarked`
  when no marker is present but the text has a radar shape: any case-insensitive occurrence
  of `radar-key:` or of `weekly tooling radar`. A radar change that drops the marker
  therefore still holds, and the test in AC-4 pins it.
- **FR-7 - Order.** `relayed` wins over `radar-unmarked`, which wins over `composed`.
  `composed` is printed only when neither shape matched on a successfully read, non-empty
  text.

### The triage gate holds it

- **FR-8 - `triage-decide.sh` takes the classification as an input.** A new flag
  `--relay=<relayed|radar-unmarked|composed>` carries `relay_classify`'s answer in. The gate
  stays pure. **A missing flag, an empty value, or any other value is treated as
  `relayed`** - the fail-closed reading, unlike `--label` where absence is already the
  restrictive route. Every caller is updated in the same change (FR-10), so the
  restrictive default refuses only callers that were missed.
- **FR-9 - A new hold, `relayed`, checked second.** Immediately after the `human` rule
  (which stays absolute and first) and before every other rule including `needs-info`,
  `built-spec` and the DR-118 `pipeline-blocker` exception: if the relay input is not
  `composed`, emit `needs-review <role> relayed`. The model's tier and role still populate
  the record (the triage model still runs, so the human reading it gets a size and a role).
  `--fields` adds `relay=<relayed|radar-unmarked|composed>` and
  `underlying_hold=<hold>`, where `underlying_hold` is the hold the gate would have emitted
  with `--relay=composed` (DQ-2).
- **FR-10 - `triage-inbox.sh` computes and passes it.** After the author gate passes and
  before the decide call, it writes the composed text it already built to a private temp
  file, runs `relay_classify`, and passes `--relay=<answer>`. If `relay_classify` fails, it
  passes nothing (FR-8 reads that as `relayed`) and prints a line naming the issue and the
  failure; no `|| true` guards the classification itself. `shadow-triage.sh` and any other
  caller of `triage-decide.sh` found by `grep -rn triage-decide.sh scripts` at build time are
  updated the same way.

### The dispatch gate holds it too (second witness)

- **FR-11 - Dispatch re-checks independently.** `dispatch-ready-check.sh` runs
  `relay_classify` on the `<body-file>` it already reads for `bodyHash`. If the answer is not
  `composed`, it refuses with a new reason `relayed` unless the issue carries a valid human
  approval record whose `supersedes:` is `relayed` and whose `bodyHash` matches. This holds
  even when the triage record says `hold: none` - so a verdict minted by an old triage, by a
  caller that skipped FR-10, or by a hand-written record does not dispatch relayed text
  (constitution invariant 2: no required check hinges on a single producer).
- **FR-12 - Unreadable is a refusal.** A `relay_classify` failure at dispatch time refuses
  with reason `relay-unreadable`, never a pass.

### A person releases it

- **FR-13 - `relayed` is approvable.** `APPROVABLE_HOLDS` gains `relayed`.
  `--may-approve relayed <human_only>` answers `approvable` only when `human_only` is `no`
  (the existing first check is unchanged). `approve-issue.sh` lists `relayed` among the
  holds it releases, with the line "a person has read relayed text; the release goes to the
  outcome the gate would have given unmarked".
- **FR-14 - The release is no wider than the unmarked outcome.** An approval that
  supersedes `relayed` releases to the triage record's `underlying_hold`: `none` -> full
  build, `specify` -> Specify phase only, `tier` -> stays held as `tier` (a second, separate
  approval lifts it), and `human` / `info` / `unknown` / `built-spec` -> not approvable,
  with the existing refusal text. A relayed T3 therefore keeps the DR-076 spec-first route
  after release.
- **FR-15 - Editing the body is a re-triage, not a release.** The approval is bound to
  `bodyHash` like every other approval record; deleting the marker by editing the issue
  changes the hash, so the issue goes back through triage, where FR-6 still holds a
  radar-shaped body.

### Documentation of the boundary

- **FR-16 - The gate's comment stops calling this unbuilt.** The "What trusting the App
  leaves open" block in `dispatch-author-gate.sh` (lines 109-114) is rewritten to say which
  rows the marker covers (radar, parked issues filed through FR-2), which it does not
  (sessions that bypass FR-2, architect sub-issues, review comments), and to name SPEC-416.

## Acceptance Criteria

- **AC-1** `relay_classify` on a fixture containing `<!-- minspec-relayed: tooling-radar -->`
  prints `relayed`; with the marker uppercased, split across the title, or in the title only,
  it still prints `relayed`.
- **AC-2** On a body with `radar-key: foo` and no marker it prints `radar-unmarked`; on one
  with "Filed automatically by the weekly tooling radar" and no `radar-key:` it prints
  `radar-unmarked`.
- **AC-3** On an ordinary founder-written body it prints `composed`; on a missing file, an
  empty file and an unreadable file it exits non-zero and prints nothing.
- **AC-4** `planFinding` output contains the FR-1 marker, and the existing
  `tooling-radar.test.ts` suite still passes; a test that strips the marker line from a real
  `planFinding` body shows `relay_classify` returning `radar-unmarked` (the "writer forgot"
  case the routed decision requires).
- **AC-5** `triage-decide.sh` with a T1 `agent-ready`, `human_only: no` verdict:
  `--relay=composed` -> `agent-ready <role> none`; `--relay=relayed` ->
  `needs-review <role> relayed`; `--relay=radar-unmarked` -> `needs-review <role> relayed`;
  no `--relay` flag -> `needs-review <role> relayed`; `--relay=garbage` -> same.
- **AC-6** Precedence: `human_only: yes` plus `--relay=relayed` -> hold `human`;
  `pipeline-blocker` label plus `--relay=relayed` on a T3 -> hold `relayed`, and `--fields`
  carries no `exception=` line; `needs-info` plus `--relay=relayed` -> hold `relayed` with
  `underlying_hold=info`.
- **AC-7** `--fields` for every AC-5 row carries `relay=` and `underlying_hold=`; the five
  fields `shadow-triage.sh` compares are unchanged in name and position.
- **AC-8** `dispatch-ready-check.sh` refuses, with reason `relayed`, a body that classifies
  `relayed` even when its triage record says `decision: agent-ready`, `hold: none`; and
  refuses with `relay-unreadable` when the body file is absent.
- **AC-9** With a valid human approval superseding `relayed` and `underlying_hold: specify`,
  dispatch answers `ready-specify`, not `ready`; with `underlying_hold: none` it answers
  `ready`; with `underlying_hold: info` the approval is refused as `bad-supersedes`.
- **AC-10** `park-issue.sh` refuses `--source 'a b'` and `--source` longer than 32 characters,
  and, against a stubbed `gh`, sends a body that ends with the marker and receives it on stdin
  or a file, never in argv.
- **AC-11** `dispatch-author-gate.test.ts` still passes; no trusted identity is added or
  removed.

## Invariants

- **INV-1 (constitution 1, offline).** `relay_classify` and both gates' new checks make no
  network call. Only `park-issue.sh` and the radar filer write to GitHub, as they or the
  sessions already do.
- **INV-2 (constitution 2, no silent gate).** Every unreadable, missing or unrecognised relay
  input is a hold or a refusal that names itself; two independent readers (FR-9, FR-11) must
  both pass. No `|| true` on the classification.
- **INV-3 (constitution 3, blast radius).** Everything is dev-time pipeline code under
  `scripts/` for this repository; nothing ships in the extension or touches an adopter repo.
- **INV-4 (DR-105).** The author list is unchanged. The marker narrows what the list lets
  through; it never admits an author the list refuses.
- **INV-5 (DR-072 section 3).** `human`, `info` and `unknown` stay unapprovable; FR-14 never
  lets a `relayed` release reach them.
- **INV-6 (DR-076).** A relayed T3/T4 is never released to a full build by the relay approval
  alone.
- **INV-7 (one direction).** No input - marker, flag or label - can turn a held issue into a
  dispatchable one except a human approval record bound to the body hash.

## Decisions needed (Clarify)

### DQ-1 - Is a marked issue triaged by the model at all?

- **Option A - triage runs; the gate overrides the outcome (rec).** The human who reads the
  held issue sees a tier and role, and FR-14's release has an `underlying_hold` to go to.
  *Cost:* one model triage call per relayed issue whose verdict cannot dispatch on its own
  (at the radar's cap of 3 per week plus parked issues, a few no-tool calls a week).
- **Option B - skip the model when `relay_classify` is not `composed`.** Saves those calls.
  *Cost:* the record has no tier, so FR-14 cannot release to the unmarked outcome; an approval
  would need a second triage after release, or would have to release to a fixed outcome.

**Recorded selection: the recommended option,** Option A. Agent pick of the recommended
option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded
2026-11-25; sign-off ratifies it.

### DQ-2 - What does approving a `relayed` hold release to?

- **Option A - the outcome the gate would have given unmarked (`underlying_hold`) (rec).**
  A relayed T3 still goes spec-first; a relayed T1 builds. *Cost:* the verdict record grammar
  (owned by `dispatch-ready-check.sh --render-record`) gains one field, and dispatch gains a
  branch that reads it; an old record without the field must be treated as not approvable
  for `relayed`.
- **Option B - a full build, like approving `tier`.** No grammar change. *Cost:* a relayed
  T3/T4 skips the DR-076 spec read on one keystroke, which is the one human read DR-076 funds.
- **Option C - Specify phase only, always.** No grammar change, and never wider than spec.
  *Cost:* a relayed T1 one-liner gets a spec dispatch it does not need.

**Recorded selection: the recommended option,** Option A. Agent pick of the recommended
option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded
2026-11-25; sign-off ratifies it.

### DQ-3 - Parked tangents: how much does the marker cover?

The routed decision names "parked tangents" as a marked writer, but they are filed by
interactive sessions with whatever command the session picks, using an App token configured
outside this repository. A shape check cannot recognise them the way FR-6 recognises the
radar: their bodies are free prose.

- **Option A - a marking helper (FR-2) plus the CLAUDE.md pointer (FR-3); the residue is
  named, not closed (rec).** Cheap, offline, and covers every session that follows the
  repository's instruction. *Cost:* a session that files with bare `gh issue create` under
  the App token is unmarked and unheld - the same exposure as today for that path, now
  written down in the gate's comment (FR-16).
- **Option B - also hold every App-authored `inbox` issue that is not radar-shaped and has
  no marker, unless a filer-only "composed" marker is present.** Closes the bypass. *Cost:*
  inverts the default for all pipeline-filed work, so every follow-up filed without a
  composed marker waits for a human - more founder reads (tenet 1), and the composed marker
  itself is forgeable by any text the App relays, so it re-opens the hole it closes unless it
  is bound to something a relayed string cannot contain.
- **Option C - a second App identity for parked issues.** Rejected by the routed decision:
  creating and rotating a second App is a founder act for the same effect.

**Recorded selection: the recommended option,** Option A. Agent pick of the recommended
option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded
2026-11-25; sign-off ratifies it.

### DQ-4 - Architect sub-issues

`scripts/roles/architect.md` tells a dispatched architect to file sub-issues, and the gate's
comment marks that row YES. This spec does not cover it.

- **Option A - out of scope here; track it with the same family as #2589 (rec).** Keeps this
  spec to the two writers the routed decision named. *Cost:* the row stays open until a
  follow-up is filed and built.
- **Option B - make architect sub-issues go through `park-issue.sh` with `--source architect`
  in this spec.** *Cost:* widens scope into role prompts (agent-trusted prose, not a gate),
  and every architect sub-issue would then need a human release before it dispatches.

**Recorded selection: the recommended option,** Option A. Agent pick of the recommended
option, no human chose it; founder decision, queue item clarsel (2026-11-17), DR-123, recorded
2026-11-25; sign-off ratifies it. The follow-up is listed under
[Follow-ups (tracked)](#follow-ups-tracked).

## Out of Scope

- **Review verdict comments** relayed into fix agents (`ai-review.yml`) - #2589.
- **Changing the author list** in `dispatch-author-gate.sh` (DR-105).
- **Sanitising relayed text.** The marker decides who may act on the text; it does not try to
  make the text safe.
- **Already-filed radar issues.** They are radar-shaped, so FR-6 holds them on their next
  triage with no back-fill; issues that already carry a verdict record are held at dispatch
  by FR-11.

## Costly to Refactor

1. **The marker string `minspec-relayed`.** Once filed issues carry it, renaming it means
   matching both forms forever (closed issues keep the old text). The broad match (FR-4)
   keeps any future variant that still contains the word working.
2. **The `relayed` hold token and the `underlying_hold` record field** (DQ-2 Option A). Both
   enter the verdict-record grammar read by `dispatch-ready-check.sh`; old records must keep
   parsing.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| A writer forgets the marker. | FR-6 holds radar-shaped text unmarked; FR-11 re-checks at dispatch; DQ-3 names the session bypass. |
| A stranger forges the marker. | It only holds (FR-4, INV-7). |
| A stranger's text is crafted to look composed (no radar words) inside a parked issue filed without FR-2. | Not closed - DQ-3 residue, stated in FR-16's comment. |
| Volume: every radar issue now waits for a human. | Radar caps at 3 per run (`RADAR_MAX_ISSUES`); `approve-issue.sh` is one interactive command per issue. This is the read the issue asks for. |
| `triage-decide.sh`'s fail-closed default refuses a caller nobody updated. | Intended: a missed caller holds visibly (hold `relayed`) instead of passing. FR-10's grep at build time lists the callers. |
| Two readers drift. | Both call the one `relay_classify` (FR-5); neither re-implements the match. |

## Decision record

None new. The shape (marker, not a second identity) was chosen in the issue's routed decision
of 2026-11-25 under standing autonomy (DR-086 act); the rejected alternative and its cost - a
second App or token to create and rotate, a founder act, for the same effect - are recorded
in that issue and restated here and in DQ-3 Option C. Every requirement is undoable in under a
day except the marker string (Costly to Refactor item 1), which this spec's approval fixes.
`docs/decisions/INDEX.md` holds DR-105 (the author gate this narrows); this spec rests on it and
does not change it.

## Follow-ups (tracked)

- Architect sub-issues carry relayed text (DQ-4): backlog: 2026-11-25 architect-filed
  sub-issues relay agent-read text under the App identity and are not marked (SPEC-416 DQ-4);
  same family as #2589. To be added to `docs/backlog.md` at Implement (this dispatch may edit
  `specs/**` only).
- DR-105 "Residual risk" names this gap as unbuilt; once SPEC-416 ships, the founder may
  amend that paragraph to cite SPEC-416 (accepted DRs are the founder's to amend). Folded into
  FR-16 for the code comment; the DR text is listed here so it is not lost.

## Traceability

- Issue: [#2692](https://github.com/AIClarityAU/minspec/issues/2692).
- Parent: #2686 (dispatch author gate), DR-105 Residual risk, #1203.
- Sibling: #2589 (review verdict trusted by an identity every session can obtain).
- Decisions rested on: DR-105 (author gate), DR-072 (approvable holds), DR-076 (spec-first
  for T3/T4), DR-118 (pipeline-blocker exception), DR-066 (no silent gate), DR-086 (act
  autonomy), DR-123 (who closes Clarify on a T3 spec).
