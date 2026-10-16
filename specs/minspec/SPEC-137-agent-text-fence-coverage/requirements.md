---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - what a trusted identity publishes must not carry markers an untrusted input planted
aspects: [dispatch, provenance, prompt-injection, fence, egress, sentinels, no-silent-gate, security]
depends_on: [DR-072]  # §5a: provenance of the container is not provenance of the contents
relates_to: [SPEC-067, DR-091, DR-033, "#1243", "#1260", "#1113", "#1127", "#1135", "#1275", "#1105", "#358", "#479"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Both files are
# NEW and needed under every answer to the questions below: the one list of marker
# grammars, and the conformance test that runs every fence and every egress witness
# against it.
implements:
  - scripts/lib/control-markers.txt
  - packages/minspec/tests/agent-text-fence-conformance.test.ts
# Modified, not owned. The bash fence and its call sites, the remediation sanitiser,
# the JS defang in the AI-review guard, and the egress scanner.
affects:
  - scripts/dispatch-ready-check.sh
  - scripts/dispatch-issue.sh
  - scripts/triage-inbox.sh
  - scripts/review-pr.sh
  - scripts/remediate-pr.sh
  - scripts/egress-scan.sh
  - scripts/lib/agent-egress.sh
  - .github/scripts/ai-review-guard.js
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Every place a trusted identity republishes agent-written text fences it against one shared list of control markers, and a second check proves the fence ran

## In plain terms

Our bots post text that AI agents wrote. Those agents read issue bodies that anyone on
the internet can write. So a bot comment can carry a control marker that a stranger
planted, and the scripts that read those markers trust it because the bot posted it.

One posting point already defangs those markers (#1260). Three others do not, and the
code holds three separate copies of the defang logic, each covering a different set of
markers. This spec asks for one list of markers, one defang applied at every posting
point, and a second, independent check that refuses to post if a live marker survives.

Cost: a few more lines at each posting point, and new marker grammars must be added to
the list (a test enforces this). Left out: making the *readers* check who wrote a
comment, which is tracked as #1135, #1275 and #1105.

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, settles the questions under **[Decisions needed (Clarify)](#decisions-needed-clarify)**,
> and approves it through the normal spec-approval gate before any code changes. Every
> requirement below is written under each question's recommended answer.

Materializes **[#1243](https://github.com/AIClarityAU/minspec/issues/1243)** (a trusted
bot comment republishes agent-authored text verbatim). Rests on
**[DR-072](../../../docs/decisions/DR-072.md) §5a** ("provenance of the container is not
provenance of the contents") and is the general form of **[DR-091](../../../docs/decisions/DR-091.md) §6**,
which added one grammar to the fence and stated the rule this spec makes a gate.

**Spec-id note.** `SPEC-137` is the highest id on disk plus one at the time of writing.
An open pull request may already hold it, and a network-less session cannot see open
pull requests. `scripts/lib/spec-id-collision.ts` holds the collision logic. A reviewer
should renumber if it reports a collision.

## Where this stands today (observed, 2026-10-16, branch base = `origin/main`)

Every claim in this section was read from the code at the cited line. Line numbers will
drift; the function names will not.

### What already shipped

Fix direction (1) of #1243, "fence the echo", shipped in **#1260** for one posting point:

- `fence_agent_text` in `scripts/dispatch-ready-check.sh` (~line 386) breaks the
  `MINSPEC_VERDICT`, `REVIEW_VERDICT` and `REVIEW_UNAVAILABLE` `_BEGIN`/`_END` sentinels
  and every `<!-- minspec-* -->` HTML marker, including multi-line and payload-bearing
  ones. It is exposed as `--fence-agent-text`.
- `scripts/dispatch-issue.sh` (~line 2291) pipes the assembled issue comment body (the
  agent summary plus the review-signals block) through it before `gh issue comment`. If
  the fence fails or returns empty text, it posts a placeholder instead of unfenced text.
- The same `$BODY` is reused as the pull-request body in `run_reviewer_stage`, which runs
  after the fence, so the PR body is fenced too.

### What did not ship

1. **Three other posting points republish agent text without the fence:**

   | Posting point | Agent text it carries | Posted as | Fenced? |
   |---|---|---|---|
   | `scripts/triage-inbox.sh` (~line 263) | `RATIONALE`, one line taken from the triage agent's output, and that agent's prompt embeds the untrusted issue body | issue comment, in the **same comment** as the `<!-- minspec-verdict-record -->` / `MINSPEC_VERDICT_BEGIN` record that gates dispatch | No |
   | `scripts/dispatch-issue.sh` `run_reviewer_stage` (~line 1323) | the reviewer's and security reviewer's raw `REVIEW_VERDICT_BEGIN … END` block, copied out of agent stdout with `sed -n` | pull-request review | Only by `egress-scan.sh`, which looks for secrets, not markers |
   | `scripts/review-pr.sh` (~line 247) | `VERDICT_BLOCK`, the reviewer's raw verdict block | pull-request comment | No |

   Because rationale is cut to one line, I believe it cannot carry a complete
   multi-line verdict record (unverified: I did not test every reader's line handling).
   It can carry a one-line `<!-- minspec-* -->` marker, inside a comment whose author
   every reader trusts.

2. **There are three fence implementations, and each covers different markers:**

   | Implementation | Covers | Misses |
   |---|---|---|
   | `fence_agent_text` (bash, `dispatch-ready-check.sh`) | 3 sentinel families, all `<!-- minspec-* -->` | `TRIAGE_VERDICT_*`; any future family such as SPEC-067's `MINSPEC_DISPUTE_*` until someone edits the regex |
   | `sanitize_comment_body` (bash, `remediate-pr.sh` ~line 285) | every `<!--` and `-->` | all `*_BEGIN`/`*_END` sentinels |
   | defang (JS, `.github/scripts/ai-review-guard.js` ~line 100) | `REVIEW_VERDICT_*`, `REVIEW_UNAVAILABLE*` | `MINSPEC_VERDICT_*`, `<!-- minspec-* -->` |

   The rule that keeps them in step is one line of prose in the bash fence's header:
   "If a new marker grammar is added anywhere, it belongs in the regex above." Nothing
   enforces it. Under the constitution's *enforce, don't trust the model*, that is a gap.

3. **Fix direction (2), "scan on the way out", did not ship.** `scripts/egress-scan.sh`
   matches secrets and exfiltration markers only. So the fence is the only check between
   agent text and a trusted post. If the fence regresses, nothing else notices. That is
   the single-producer shape that constitution invariant 2 rules out for a required check.

### Marker grammars found in the code (the input to FR-1)

Sentinel pairs: `MINSPEC_VERDICT`, `REVIEW_VERDICT`, `REVIEW_UNAVAILABLE`,
`TRIAGE_VERDICT`. These were also found but are not comment-borne control markers, so the
registry must classify them rather than assume: `RECORD_*`, `BLOCK_*`,
`INDEX_MARKER_END`, `AGENTS_SLASH_SECTION_END`.

HTML markers: `minspec-verdict-record`, `minspec-verdict-hold`, `minspec-claim` (carries a
payload), `minspec-shipped`, `minspec-auto-remediation`, `minspec-remediate-crash`,
`minspec-remediate-capped`, `minspec-shepherd-handoff`.

## Functional requirements

### FR-1: One list of control-marker grammars

A single data file, `scripts/lib/control-markers.txt`, lists every marker grammar that a
comment reader in this repo treats as a signal: the sentinel pair names and the HTML
marker prefix (`minspec-`). Every fence implementation (FR-3) reads its marker set from
this file, or is generated from it. No fence carries its own hard-coded list.

Each entry records whether it is a sentinel pair or an HTML-comment prefix, plus one
line naming a reader that parses it, so a reviewer can see why it is listed.

### FR-2: A new grammar cannot be added without being listed

A test scans `scripts/`, `.github/` and `packages/*/src` for marker definitions: any
`[A-Z_]+_BEGIN` token and any `<!-- minspec-` literal. It fails if a found grammar is
neither in `control-markers.txt` nor on an explicit, commented exclusion list inside that
file. An exclusion needs a reason, such as "LLM prompt block, never read back from a
comment".

This replaces the prose rule in the bash fence's header with a gate. It covers the case
DR-091 §6 names: a new grammar that is not added to the fence becomes a way to plant
markers.

### FR-3: Every posting point that publishes agent-derived text under a trusted identity fences it

"Agent-derived" means any text whose content came, in whole or in part, from an LLM
agent's output or files. All of the following MUST pass that text through the shared
fence before posting:

1. `dispatch-issue.sh`, the issue comment and PR body. Already done; MUST stay done.
2. `triage-inbox.sh`, `RATIONALE`. Fence it **before** it is put into the comment, so
   the parent's own `<!-- minspec-verdict-record -->` and `MINSPEC_VERDICT_BEGIN`
   record, appended after it, are not broken.
3. `dispatch-issue.sh` `run_reviewer_stage`, the reviewer and security verdict blocks.
4. `review-pr.sh`, `VERDICT_BLOCK`.
5. `remediate-pr.sh`, `post_marked_comment`. Its `sanitize_comment_body` is replaced by,
   or made a superset of, the shared fence, so that sentinels are broken as well as HTML
   comments.

The general rule: **fence the agent's text, then add the parent's own markers.** Never
fence a body that already contains first-party markers, and never post agent text and
then rely on the reader to tell the two apart.

Where a posting point publishes the agent's own sentinel block (points 3 and 4), the
parent MUST NOT post the agent's raw sentinel lines as if they were first-party. It
re-renders the block from the fields the deterministic decider already parsed, and fences
the free-text fields inside it. `ai-review-guard.js` already does this (~line 146–162),
and points 3 and 4 follow it. See Clarify **Q2** for the alternative.

### FR-4: One fence behaviour across languages

The bash fence and the JS defang in `ai-review-guard.js` MUST produce outputs with no
live marker for the same input corpus (FR-6). The output bytes need not be identical,
but each must break every listed grammar. The properties the bash fence already holds
MUST hold in both:

- matching ends at the closing `-->`, never at the first `>`, so a payload containing
  `>` is still covered;
- a marker whose payload runs across a newline is broken at its opener, so the fence
  holds whether the reader matches line by line or across lines (DOTALL);
- the fenced text stays readable: markers are broken, not deleted, and the output says
  it was fenced.

### FR-5: An independent egress witness refuses to post a surviving live marker

`agent_egress_scan` (and the review-body egress scan in `run_reviewer_stage`) gains a
**control-marker check that runs on the text exactly as it will be posted, after the
fence**. If any grammar listed in `control-markers.txt` survives as a live marker in
agent-derived text, the post is refused and handled the way an egress hit is today: the
issue is quarantined, or the output is withheld with a visible notice. It fails closed.

The check runs **after** the fence because then it never fires on a legitimate summary
that merely *discusses* markers (this repo's agents often do). Fenced text is no longer
a marker. A hit therefore means the fence did not run, or ran and missed something. That
is the second, independent witness invariant 2 requires. See Clarify **Q1**.

The check needs to know which markers in the final body are the parent's own (for
example the record `triage-inbox.sh` appends). Two ways to do this: scan the
agent-derived part before the parent adds its markers, or have the parent declare the
exact first-party markers it appended so the check can subtract them. The Plan phase
picks one. Both satisfy this FR.

### FR-6: A shared conformance corpus pins all of the above

`packages/minspec/tests/agent-text-fence-conformance.test.ts` holds one corpus of
hostile inputs and runs **every** fence implementation and the FR-5 witness over it. The
corpus contains at least: each listed sentinel as a whole token, decorated (`**…**`,
trailing word) and split across lines; each `<!-- minspec-* -->` marker, including a
payload containing `>` and a payload running across a newline; a forged complete verdict
record; and a benign summary that discusses markers in prose. Assertions:

- no implementation's output contains a live marker for any listed grammar;
- the FR-5 witness passes fenced output and blocks unfenced output, so the test proves
  the witness can fail as well as pass;
- adding a grammar to `control-markers.txt` without updating a fence makes this test
  red. This is checked by a mutation test, so the corpus is not a pass that proves
  nothing.

### FR-7: Failure keeps the payload safe, never empties it

Each posting point that FR-3 adds keeps the behaviour #1260 established: if the fence
errors or returns empty, post a fixed placeholder that says the text was withheld and
why. Never post the unfenced text, and never post an empty body.

## Acceptance criteria

- **AC-1.** With a triage agent stubbed to emit `rationale: ok <!-- minspec-shipped -->`,
  the comment `triage-inbox.sh` would post contains no live `<!-- minspec-shipped`, and
  its own verdict record is still found by `dispatch-ready-check.sh`.
- **AC-2.** With a reviewer stubbed to emit a verdict block whose findings text contains
  `MINSPEC_VERDICT_BEGIN` and `<!-- minspec-claim:{"x":"a>b"} -->`, neither the
  `run_reviewer_stage` review body nor the `review-pr.sh` comment contains a live marker,
  and `review-decide.sh` still reaches the same verdict it reaches today.
- **AC-3.** `remediate-pr.sh` posting a body containing `REVIEW_VERDICT_BEGIN` produces
  no live sentinel. The runaway-guard marker it appends is still counted by
  `count_markers_json`.
- **AC-4.** Adding `FOO_VERDICT_BEGIN` to any script under `scripts/` without listing it
  turns the FR-2 test red.
- **AC-5.** If the fence call at any FR-3 posting point is replaced with `cat` (a fence
  that did not run), the FR-5 witness blocks the post, and the test for that point goes
  red.
- **AC-6.** A summary that only discusses markers in prose, after fencing, passes the
  FR-5 witness. No false quarantine.
- **AC-7.** The FR-6 corpus runs in CI under `npx vitest`, not just `npm test`.

## Invariants this change must not break

- **Constitution 1 (offline core).** All of this is dev-time `scripts/` and CI code. Nothing
  enters the shipped extension, and nothing adds a network call.
- **Constitution 2 (no silent gate).** The fence and the FR-5 witness both fail closed and
  visibly. No `|| true` on their results. The new FR-5 check is the second witness and
  does not share code with the fence: it reads the list, but not the fence's regex.
- **Constitution 3 (blast radius).** Changes are limited to this repo's dispatch pipeline.
  Nothing here ships in the extension or adopter templates.
- **First-party markers keep working.** Every marker the parent itself writes is still
  read by its reader: the verdict record, the verdict hold, the claim and shipped lease
  markers, the remediation counters, the shepherd handoff.
- **No reader change.** This spec changes writers only. Reader-side author filtering stays
  with #1135, #1275 and #1105.

## Non-goals

- **Fix direction (3), "stop echoing verbatim".** Rejected. Fencing removes the hazard
  while keeping the full summary a human reads on the issue. A link or a cut-down
  excerpt loses that for no extra safety once FR-3 and FR-5 hold.
- **Reader hardening:** filtering `REVIEW_VERDICT_BEGIN` readers by author (#1135),
  author-binding the lease claim reader (#1275), author-binding the record (#1105).
- **Fencing human-authored comments.** Human text comes in through readers that already
  filter by author. This spec is about text a *trusted* identity republishes.

## Decisions needed (Clarify)

**Q1. What the egress control-marker check (FR-5) does on a hit.**

- `a` **(rec)** Scan the text **after the fence** and fail closed: quarantine or withhold,
  as an egress secret hit does today. A hit can only mean the fence did not run or
  missed something, so it is never a false positive on legitimate prose. *Cost:* if
  a parent-appended first-party marker is not correctly declared (FR-5's last
  paragraph), that bug quarantines every dispatch until fixed. It is loud, but it stops
  the pipeline.
- `b` Scan the raw agent text **before the fence** and fail closed. This is the issue's
  literal wording. *Cost:* any summary that discusses a marker gets quarantined. This
  repo's agents write about verdict records routinely, so it would hold a real share of
  dispatches for a human.
- `c` Scan after the fence and **warn only**. *Cost:* it is not a gate. A regressed fence
  would be logged and posted anyway, which is the invariant-2 shape this spec exists to
  remove.

**Q2. How a posting point publishes the agent's own verdict block (FR-3 points 3–4).**

- `a` **(rec)** Re-render the block from the decider's parsed fields, as
  `ai-review-guard.js` already does, and fence the free-text fields. *Cost:* more code
  at two sites, and the posted block may differ in formatting from what the reviewer
  wrote, so a human sees the parent's rendering rather than the raw output.
- `b` Post the raw block with the sentinels fenced too, so it is plain text, not a
  machine-readable block. *Cost:* any reader that today parses `REVIEW_VERDICT_BEGIN`
  out of these posted bodies stops finding it. I did not prove there is no such reader.
  `ai-review-guard.js` parses PR content, and the overlap was not traced.

**Q3. Where the marker list lives (FR-1).**

- `a` **(rec)** A plain data file, `scripts/lib/control-markers.txt`, read by bash at
  run time and by the JS guard and tests at load time. *Cost:* the CI guard (`.github/`)
  then reads a file under `scripts/`, which ties a workflow file to a script path.
- `b` A TypeScript module in `@aiclarity/shared`. *Cost:* the bash scripts would have to
  run node to get the list, adding a runtime dependency to a pure-bash path that today
  has none.

## Traceability

- Issue: #1243. Prior partial fix: #1260 (fence at the dispatch summary). Verdict-grammar
  instance: #1113 / #1127.
- Rationale: DR-072 §5a; DR-091 §6 (new grammars must be fenced).
- Neighbouring spec: SPEC-067 FR-9 adds `MINSPEC_DISPUTE_*` to the bash fence. Under this
  spec, that becomes one line in `control-markers.txt`.
- Reader-side follow-ups (out of scope, already tracked): #1135, #1275, #1105.
