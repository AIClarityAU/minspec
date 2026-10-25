---
id: SPEC-203
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a summon that says only "you are needed" is a signpost that points nowhere
aspects: [hitl, summon, needs-human-review, machinery-review-required, ai-review, pr-body, reply-channel, no-silent-gate, untrusted-input, signpost]
depends_on: [DR-063, DR-066, DR-086]  # DR-063 the positive "your turn" label this must not collide with; DR-066 no silent gate; DR-086 the enumerated stop list and "(rec) + cost"
relates_to: [DR-033, DR-072, DR-085, SPEC-031, SPEC-044, SPEC-065, SPEC-069, SPEC-078, "#1292", "#983", "#2228", "#2056", "#1614"]
# NEW file this spec creates and therefore OWNS (SPEC-038): one renderer for every summon body
# and its test. Declared now, before any approval mints a hash. The body-shape check's home is
# decided by Clarify question D-2, so it is not declared here yet.
implements: [scripts/render-summon.mjs, scripts/render-summon.test.mjs]
# Modified, not owned: every site that summons a human today (inventory in "Evidence" below).
affects: [.github/workflows/ai-review.yml, .github/workflows/ai-review-retry.yml, .github/scripts/ai-review-guard.js, scripts/dispatch-issue.sh, scripts/remediate-pr.sh, scripts/drain-inbox.sh, scripts/roles/dev.md, scripts/roles/architect.md]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-203: Decision-shaped human summons - every call for a human says what is wrong, what to look for, what is being asked, and what the agent recommends

## In plain terms

Today, when the pipeline needs you, it puts a `needs-human-review` label on a pull request
or issue and, at most, adds a one-line note. It tells you *that* you are needed, never
*what* you are deciding or *what to look for*, so a review turns into reading the title and
clicking. This spec makes every one of those calls carry four things in a fixed order: a
plain-language summary, a short list of specific risks to check (including the AI panel's
minor findings, which today vanish at merge), the question if there is one, and the
agent's recommended answer. It also requires every agent-written pull request to open
with an "In plain terms" section, checked by a machine rather than requested in a prompt,
and it makes sure every question you are asked names a way to answer it that the pipeline
actually reads.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads it
> and approves it through the normal spec-approval gate before any design or code. The
> questions under [Decisions needed (Clarify)](#decisions-needed-clarify) are the reason
> for that read.

**Where this came from.** Issue #1292, quoting the founder (2026-08-06 session, verbatim):

> it seems to me that requesting human review is too vague. if there's a decision to be
> made, then state the problem/context, ask the question, and make a recommendation. but a
> general "pls review" without even a list of problems to look for is a bit pointless. PRs
> also need that "In plain terms" section at the top.

No decision record covers this yet; see [Decision record](#decision-record) for why none is
minted by this spec.

## Evidence - what is true today (read 2026-10-16, line anchors re-resolved 2026-10-21 against base `41605a61`)

The issue was written on 2026-08-06; the facts below were re-read on 2026-10-16 rather than
taken from it.

### E-1. Where a human is summoned, and what accompanies the summons

Every site below applies `needs-human-review` (or posts the `machinery-review-required`
check). "Problem only" means the text says what happened but asks no question, lists no
risks and makes no recommendation.

| # | Site | Trigger | Text that goes with it |
|---|---|---|---|
| S-1 | `.github/workflows/ai-review.yml:1259-1262` (`TITLE="Machinery PR — human review required"`) | PR touches `.github/` or `scripts/` (machinery) | Check-run title "Machinery PR — human review required" + one-paragraph summary. Problem only. |
| S-2 | `.github/workflows/ai-review.yml:1548-1562` (the `SUMMON_HUMAN` step) via `shouldSummonHumanReview` (`.github/scripts/ai-review-guard.js:1944`) | Machinery PR, or `changes` with no remediation available | No text of its own; the verdict comment (body assembled in `ai-review.yml`, posted by `gh pr comment … --body-file` at `:1330`). Problem only. |
| S-3 | `.github/workflows/ai-review.yml` backstop step, `gh pr comment` at `:1584` | ai-review workflow errored (fail-closed backstop) | "AI review — `ai-review:changes` (fail-closed)… See the workflow run". Problem only. |
| S-4 | `.github/workflows/ai-review-retry.yml:95-106` | Blocked PR with `evidence: NONE` | Label only. |
| S-5 | `scripts/remediate-pr.sh:647-657` ("Merge conflict — not auto-resolving") | Merge conflict | Label only. |
| S-6 | `scripts/remediate-pr.sh:740-748` (`CAPPED_MARKER` comment) | Remediation attempt or crash cap reached | "Auto-remediation capped — a human needs to take it from here". Problem only. |
| S-7 | `scripts/remediate-pr.sh:907-918` (`grep '^ESCALATE:'` branch) | Remediation agent `ESCALATE:` | The agent's one-line reason. Problem only. |
| S-8 | `scripts/remediate-pr.sh:938-941` ("QUARANTINED" comment) | Egress guard hit (also `agent-quarantined`) | "QUARANTINED" + worktree path. Problem only. |
| S-9 | `scripts/dispatch-issue.sh:737-745` (`surface_verdict_hold`) | No fresh triage verdict behind `agent-ready` | Problem + two numbered options with commands. No recommendation. |
| S-10 | `scripts/dispatch-issue.sh:1459-1463` ("Closing-issue link not confirmed") | `Closes #N` link not confirmed (#2228) | Problem + suggested fix. No question form. |
| S-11 | `scripts/dispatch-issue.sh:1486`, `:1489`, `:1500`, `:1527` | Native auto-merge withheld | Label only; the reason (`hold_why`, `:1512-1518`) goes to the log, not to the PR. |
| S-12 | `scripts/dispatch-issue.sh:1608-1621` (`quarantine_publish`) | Egress guard hit on an issue | "egress guard blocked publish — see worktree…". Problem only. |
| S-13 | `scripts/dispatch-issue.sh:1649-1657` (`hold_specify_scope`) | Specify-only dispatch left its allowlist | Problem + two command options. No recommendation. |
| S-14 | `scripts/dispatch-issue.sh:1688-1696` (`shepherd_hand_off`) | Creator-shepherd gave up | "Creator-shepherd handed off… stopped because …". Problem only. |
| S-15 | `scripts/dispatch-issue.sh:2086-2090` ("exceeded the absolute claim lifetime") | Build lifetime exceeded | Label only. |
| S-16 | `scripts/dispatch-issue.sh:2131-2147` (`agent-escalated,needs-human-review`) | Agent escalated after the stronger-model retry | Label only. |
| S-17 | `scripts/dispatch-issue.sh:2596-2597` ("Agent CRASHED") | Agent crashed | Label only. |
| S-18 | `scripts/drain-inbox.sh:1103-1105` ("NO merged PR exists") | Issue `agent-done` but no merged PR | Label only. |

Every label write above is `… 2>/dev/null || true`. The label is not itself the merge gate
(`ready-to-merge` is; DR-063), so a lost label is a lost *signal*, not an open gate - but a
lost summons body is exactly the "you are needed, for nothing in particular" failure this
spec removes.

### E-2. "In plain terms" on pull requests is neither requested nor checked

- No `.github/pull_request_template.md` exists.
- An agent-dispatched PR body is the agent's `.agent-summary.md` plus parent-appended
  trailers (`scripts/dispatch-issue.sh:2167-2191`, `:2335`), passed whole to
  `gh pr create` (`:1438`). Nothing inspects its structure.
- The assembled body is fenced as agent-authored text before it is republished
  (`scripts/dispatch-issue.sh:2359-2364`, #1243), because the agent's prompt carried an
  untrusted issue body.
- "In plain terms" exists for decision records as a template heading only
  (`packages/minspec/src/lib/adr-manager.ts:569`), with no validator behind it.

### E-3. Nothing reads a comment as an answer

- No workflow under `.github/workflows/` triggers on `issue_comment` or
  `pull_request_review_comment` (grep of every `on:` block, 2026-10-16).
- Machine-read human gestures today are: the `agent-ready` label on an issue
  (`approve-on-label.yml` → `scripts/approve-on-label.sh`, which verifies the actor against
  GitHub's own timeline, `:85-101`, requires write permission, `:173`, and refuses
  quarantined issues, `:196`), the PR label events read by `ready-to-merge.yml` and
  `docs-lane.yml`, the local `scripts/approve-issue.sh`, and the merge itself.
- Comments are read only at dispatch or remediation time, through the account-type author
  filter from #983 (`scripts/lib/dispatch-author-gate.sh:406`, `:467`).

### E-4. Panel findings below "blocking" die with the PR

- Each voter returns `{severity, location, problem}` with free-text severity
  (`.github/scripts/ai-review-guard.js:89-91`), rendered at `:156`.
- Only `verdict` and the blocking count decide the label (`scripts/review-decide.sh:23`,
  `:212`). Nothing files, copies or carries non-blocking findings anywhere after merge;
  the only later reader is the remediation agent, before merge (`scripts/remediate-pr.sh:813-828`).

## One-Sentence Scope

Every place the pipeline summons a human through `needs-human-review` or
`machinery-review-required` renders its message through one deterministic renderer that
always emits a four-part, decision-shaped body naming a machine-read answer gesture, and
every agent-authored pull request is mechanically checked for an opening "In plain terms"
section.

## Out of scope

- **Triage's own holds** (`needs-review`, `needs-info` from `scripts/triage-inbox.sh:156-160`, `:288-291`).
  They already carry a rationale and a verdict record; bringing them under the renderer is
  a natural second slice, not this one (see D-4).
- **Carrying non-blocking findings past merge for PRs that never summon a human** - the
  wider LOW-findings leak. This spec surfaces findings *into a summons*; a PR that merges
  without one keeps today's behaviour (see D-3).
- **Shipping any of this to adopters.** All of it is this repository's own pipeline (see
  D-5 and INV-3).
- **Changing what triggers a summons.** Which events need a human is unchanged; only what
  the summons says, and how it is answered, changes.
- **The chief-of-staff funnel and its reply keys** (SPEC-044 FR-4b, #2056). A summons may be
  read by the funnel and relayed; this spec does not change the funnel.

## Functional Requirements

### FR-1 - One renderer for every summons body

A single deterministic program (`scripts/render-summon.mjs`, offline, no model call) builds
every summons body. It takes a structured record (FR-2) and emits markdown. Every site in
E-1 (S-1 to S-18) calls it instead of composing its own text. A site that today adds a
label with no text MUST also post the rendered body (as a PR/issue comment, or as the
check-run summary for S-1), so that no `needs-human-review` label is applied without a
rendered body next to it.

### FR-2 - The summons record

The renderer's input is a closed record. Field names are fixed at Plan; the content is:

| Field | Required | Source |
|---|---|---|
| `kind` | yes | A closed enumeration, one value per row of E-1 (for example `machinery`, `remediation-capped`, `quarantined`, `automerge-withheld`). An unknown kind is an error (FR-8). |
| `plainTerms` | yes | 2-4 sentences, no jargon, stating what is held and what changes for the product or pipeline if the human says yes. Written by the **parent** script from facts it holds, never copied from agent output. |
| `risks` | yes, may be empty only per FR-4 | A list of specific things to look for (FR-3). |
| `question` | when a decision is asked | One question, with a closed list of options. |
| `recommendation` | when `question` is set | The recommended option, one line of why, and one clause naming its main cost (DR-086 "(rec) + cost"). |
| `answer` | yes | The concrete gesture(s) that answer this summons and are machine-read (FR-5). |
| `evidence` | yes | Links to the run, log, or check that produced the summons. |

### FR-3 - "What could go wrong" is seeded from evidence, not written fresh

The `risks` list is built from two deterministic sources, in this order:

1. **The ai-review panel's findings for the PR's current head**, every severity, including
   non-blocking ones (E-4). Each is shown with its severity, location and problem, and is
   **fenced as model-authored text** (the same treatment as E-2's fence, #1243): the
   findings came from a model reading an untrusted diff, so they are labelled as such and
   never rendered as first-party instructions.
2. **Path-derived risk hints**: a small, versioned table mapping changed-path patterns to a
   one-line "check this" hint (for example: a change under the withhold classifier → "check
   the pattern against the mandate comment above it"). The table lives in the repository,
   is read by the renderer, and has a test proving every entry's pattern matches at least
   one real path.

A finding whose head SHA is not the PR's current head is not shown (a stale finding is a
false signpost); the renderer says how many were dropped and why.

### FR-4 - An empty risk list must say why

If both sources in FR-3 yield nothing, the body says so in one line with the reason
("no panel findings on this head; no path hints matched"). The renderer never omits the
section silently.

### FR-5 - Every summons names an answer the pipeline actually reads

The `answer` field is mandatory and names one or more gestures from the set that is
machine-read *at the time the summons is posted* (today: the labels and scripts listed in
E-3, plus whatever D-1 adds). A summons that asks a question with no machine-read answer is
a renderer error (FR-8), not a body with a hole in it. For summonses where no decision is
being asked (for example S-17, the agent crashed), `question` is absent and `answer` names
the action that clears the hold.

### FR-6 - Agent-authored PR bodies open with "In plain terms"

1. The dev and architect role prompts (`scripts/roles/dev.md`, `scripts/roles/architect.md`)
   tell the agent to open `.agent-summary.md` with a `## In plain terms` section of 2-4
   sentences.
2. That request is backed by a deterministic check (location chosen in D-2) that, for every
   PR authored by the pipeline's bot identity, confirms the body's first heading is
   `## In plain terms` and that the section has between one and six non-empty sentences
   of prose. A PR that fails is held visibly, with a rendered summons (FR-1) whose `answer`
   is "edit the PR body".
3. Human-authored PRs are not checked. Authorship is decided by account type and id, the
   same way as the #983 author filter, never by login text.

### FR-7 - The summons appears where the human reads it

The rendered body is posted as: the check-run summary for S-1; a PR comment for PR summonses;
an issue comment for issue summonses. Each carries a stable hidden marker per `kind` so a
re-run edits the existing comment instead of stacking duplicates.

### FR-8 - The renderer fails closed and visibly

If the record is incomplete (missing `plainTerms`, `answer`, or a `question` without a
`recommendation`) or names an unknown `kind`, the renderer exits non-zero and the calling
site still applies the label and posts a short fixed fallback that says the summons body
could not be built and links the run log. The human is never left with a bare label and no
statement that something is missing (constitution invariant 2). The fallback text is
itself a constant in the renderer, covered by a test.

### FR-9 - No site composes summons text by hand

A static test enumerates every line in `scripts/` and `.github/` that adds the
`needs-human-review` label or posts `machinery-review-required`, and fails if any such site
is not paired with a call to the renderer. The test counts sites with the same pattern the
gate uses, and fails if it finds zero (a matcher that matches nothing reports clean).

### FR-10 - The reply channel is documented in one place

The set of machine-read answer gestures (FR-5) is listed once, in a single document that
the renderer links from every summons, so a human can see in one read every way an answer
gets back into the pipeline.

## Invariants (must not break)

- **INV-1 Offline core (constitution invariant 1).** Nothing here touches the VS Code
  extension. The renderer makes no network call; posting is done by the existing callers
  with the network access they already have.
- **INV-2 No silent gate (constitution invariant 2, DR-066).** The new body-shape check is a
  merge-relevant check and so must fail closed and visibly; it must not depend on a single
  producer that one token gap disables (DR-066's second-witness rule). A summons that
  cannot be rendered says so (FR-8).
- **INV-3 Blast radius (constitution invariant 3).** Nothing in this spec is added to the
  templates MinSpec ships (`packages/minspec/src/lib/template-registry.ts`) or changes any
  repository other than this one.
- **INV-4 Untrusted text stays fenced.** Agent summaries and panel findings are
  model-authored and their prompts carried untrusted issue or diff content. They are shown
  fenced and labelled, never rendered as first-party text, and never parsed as commands.
- **INV-5 DR-063 is unchanged.** `awaiting-approval` remains the one positive "your turn"
  signal and keeps its single owner; this spec changes what accompanies
  `needs-human-review`, not when `awaiting-approval` is set.
- **INV-6 No borrowed approval.** No new gesture lets an agent or bot answer its own summons.
  Any gesture added under D-1 verifies the human actor exactly as strictly as
  `approve-on-label.sh` does (timeline event, permission, quarantine refusal).
- **INV-7 Single funnel unchanged.** A summons never asks the founder to merge a PR in this
  repository (CLAUDE.md "Merge asks in THIS repo"); the `answer` field never offers a merge
  as a gesture.

## Acceptance Criteria

- **AC-1** For each of S-1 to S-18, a test drives the site's trigger and asserts the posted
  body has, in order: an "In plain terms" section, a "What could go wrong" section, the
  question and options when a decision is asked, the recommendation with its cost when a
  question is present, and the answer gesture(s).
- **AC-2** The FR-9 static test fails when a new `--add-label needs-human-review` line is added
  without a renderer call, and fails when its matcher finds zero sites.
- **AC-3** A machinery PR whose panel produced one non-blocking finding shows that finding,
  fenced, in the `machinery-review-required` summary; the same finding recorded against an
  older head SHA is not shown and is counted as dropped.
- **AC-4** A bot-authored PR whose body does not open with `## In plain terms` is held, and
  the hold carries a rendered summons; the same body on a human-authored PR is not checked.
- **AC-5** A renderer input missing `answer` (or carrying a `question` without a
  `recommendation`) exits non-zero, and the calling site posts the FR-8 fallback, not
  nothing.
- **AC-6** Every gesture named in any summons appears in the FR-10 document, and every
  gesture in that document has a test showing the pipeline reads it.
- **AC-7** Mutation check: deleting the `risks` section, the `answer` field or the fence from
  the renderer turns at least one test red.

## Decisions needed (Clarify)

### D-1 - How does a founder's answer get back into the pipeline?

The issue offers two shapes. Both satisfy FR-5.

- **(a) Labels and scripts only; the summons names the gesture. (rec)** Every summons
  names the existing label or script that answers it ("apply `agent-ready` to proceed",
  "run `scripts/approve-issue.sh N`"). No new trust surface: every gesture already has
  actor verification. **Cost:** an answer that is not one of the offered options (a
  prose "do X instead") still has no machine-read path; it waits for the next dispatch to
  read the comment.
- **(b) Comment commands.** A reply key line (for example `/minspec answer b`) in a comment,
  read by a new `issue_comment`-triggered workflow that verifies the author (#983 pattern,
  plus the timeline and permission checks from `approve-on-label.sh`) and converts the key
  into the same label or record gesture. Free-text answers become possible. **Cost:** a new
  workflow that parses untrusted, public comment text on a public repository and acts on
  it; it is the first comment-triggered writer here, so it needs its own decision record
  and a security review, and it is machinery (human merge only).

Recommendation: (a) now, because it delivers the acceptance criterion ("a documented,
machine-read path back") with no new attack surface; (b) as a later spec if the founder
finds himself answering in prose often.

### D-2 - Where is "In plain terms" enforced?

- **(a) Inside `ready-to-merge`, for bot-authored PRs. (rec)** `ready-to-merge` is already a
  required check, so the rule gates merge without a ruleset change. **Cost:** a missing
  section blocks an otherwise green PR until the body is edited, and `ready-to-merge` grows
  one more reason to be red that its summary must explain clearly.
- **(b) A new separate check.** Clearer to read. **Cost:** to gate merge it must be added to
  the ruleset's required checks, which is a human-only ruleset edit (and a full-ruleset
  PUT replaces every rule, so it is easy to get wrong); until then it is advisory, which the
  issue rules out ("enforced, not requested").
- **(c) Only in the dispatcher before `gh pr create`.** Cheapest. **Cost:** PRs opened any
  other way (`push-docs.sh`, remediation, sessions) are unchecked, and there is no second
  witness (INV-2).

### D-3 - Which panel findings reach the summons, and do unsummoned PRs keep losing them?

- **(a) Every severity, but only into a summons; the wider leak is a separate issue. (rec)**
  Matches the issue's acceptance line. **Cost:** a PR that merges with no summons still drops
  its minor findings, so the leak is narrowed, not closed.
- **(b) Also file non-blocking findings as issues at merge.** Closes the leak. **Cost:** a new
  writer that turns model output into issues, with dedup and noise problems of its own; a
  different feature with a different blast radius.

### D-4 - Does the renderer also cover triage's `needs-review` / `needs-info`?

- **(a) No, second slice. (rec)** They already carry a rationale. **Cost:** two summons
  shapes coexist for a while.
- **(b) Yes, now.** One shape everywhere. **Cost:** touches the triage path, which has its own
  verdict-record contract (DR-091), and roughly doubles the test surface.

### D-5 - Ship the convention to adopters?

- **(a) No, this repository only. (rec)** The summons sites are this repository's own
  pipeline scripts, and invariant 3 forbids changing behaviour where nobody opted in.
  **Cost:** adopters who run agents get no "In plain terms" convention from MinSpec.
- **(b) Add an "In plain terms" PR-body line to the shipped agent instructions.** **Cost:** a
  shipped prose rule with no gate behind it in the adopter's repository, the "trust the
  model" shape the constitution warns against.

## Decision record

None is minted by this spec. Every choice under the recommended answers is reversible in
under a day (a renderer, a test, one more condition in an existing check), so none meets
the "cannot be undone in under a day" bar for a decision record.
If D-1 is answered (b), the decision to accept public comment text as a pipeline gesture
is a trust-boundary choice and gets its own decision record at Plan, before any code.

## Alternatives considered and rejected

- **Let each site keep composing its own text, with a style rule in the role prompts.**
  Rejected: the issue's complaint is exactly what eighteen hand-written sites produced; a
  prose rule the model must remember drifts (constitution, "enforce, don't trust the model").
- **Have a model write the summons.** Rejected: the summons is a gate signal and must be
  deterministic and offline-renderable; a model-written body could also be steered by the
  untrusted content it summarises.
- **Copy the agent's own "In plain terms" into the summons.** Rejected for `plainTerms`:
  that text is model-authored from an untrusted prompt (INV-4). The parent writes
  `plainTerms` from facts it holds; the agent's section stays in the PR body, fenced.

## Risks & Mitigations

| Risk | Likelihood · impact | Mitigation |
|---|---|---|
| Summons bodies grow long and get skimmed, recreating rubber-stamping | Med · High | `plainTerms` capped at four sentences; risks list shows path hints first-class and caps panel findings with a count of the rest. |
| A prompt-injected finding reads as an instruction to the human | Low · High | INV-4 fence and label on every model-authored line (FR-3). |
| The body-shape check reddens many in-flight PRs at once | Med · Med | Roll out the check after the role-prompt change has been live long enough for new PRs to carry the section; Plan sets the order. |
| Path-hint table rots as paths move | Med · Low | FR-3 test: every hint pattern must match at least one real path. |

## Follow-ups (tracked)

None filed by this dispatch (it may not call the network). The candidates are recorded as
Clarify questions D-1(b), D-3(b) and D-4(b); whichever the founder defers becomes an issue
at Clarify.
