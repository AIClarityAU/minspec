---
id: SPEC-080
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a comment that tells a reader to look in the wrong place is the same defect class this epic exists to close
relates_to: [SPEC-022, DR-012, DR-034, "#1510", "#1491"]  # SPEC-022/DR-034 own the sidecar model the pointer must name; DR-012 is the amended decision the old comment still contradicts; #1510 already fixed the generator (forward-only) and is the sibling that owns comment-hashing itself
phases:
  specify: in-progress
---

# Eleven specs' hash-lock comment still points at the approvals store #1510 replaced

Materializes **#1520**, filed from independent review on PR #1491 where an ai-review voter and
the reviewing session both read the same wrong comment and both concluded a genuinely-approved
spec (SPEC-038) was unapproved.

## One-Sentence Scope

Correct the eleven spec files whose hash-lock comment still names the gitignored, superseded
`.minspec/approvals.json` map, and add a corpus check so a comment naming that path can never
reach `main` again — without silently re-baselining any spec's approval hash as a side effect of
the fix itself.

## Context

### The defect is already half-fixed, forward-only

`#1510` landed in `9ad12c8c` (`packages/minspec/src/lib/approval-store.ts:49-56`,
`hashLockReminder()`). Every **newly created** spec now gets a comment that correctly names the
sidecar path (`.minspec/approvals/<path>.json`) instead of the legacy map. The function's own
docstring (`approval-store.ts:47-48`) states why the fix could not simply overwrite existing
files: `hashLockReminder` is called only from `createSpec`, never from `serializeFrontmatter`,
because the frontmatter serializer runs on every save — if it emitted the corrected comment on
every write, the corrected bytes would change the hash of every already-approved spec on its next
routine edit, which is the exact failure this whole area exists to prevent (`canonical.ts`
strips only `status` and `phases`; a full comment line is hashed content).

That leaves the eleven pre-existing files named in #1520 carrying the old, wrong text:

    # 🔒 Once approved, hash-locked: approved bytes recorded in
    #    .minspec/approvals.json[SPEC-NNN].specHash. ANY edit voids approval...

against a store that is gitignored (`.gitignore:115`), was never tracked (`git log --all` on the
path is empty), and stopped receiving writes at `SPEC-022` — the spec that replaced it.

### Why it misled two independent readers, not one

`.minspec/approvals.json` is not merely absent — the false signpost is worse than a missing file,
because on a machine that has been used for a while the file **exists**, parses as valid JSON, and
simply has no key for the spec being checked. `approve-command.test.ts`-style tooling reads the
correct sidecar and reports `approvedBy`/`specHash` correctly; a *human or agent* following the
comment's literal instructions instead opens the named file, sees no matching key, and concludes
"unapproved" — which is wrong in the maximally confident-looking way: no error, no missing file,
just an absent key in a file that is otherwise legible. On PR #1491 this happened twice
independently (an ai-review voter, then the session verifying that finding), which is the
signature the issue names: a false signpost, not a careless read.

### Verified: current corpus state (not the issue's estimate — recomputed here)

The issue's body says "most are approved." Recomputed against this checkout, per-file, by
checking for a sidecar at `.minspec/approvals/<path>.json`:

| File | frontmatter `status:` | sidecar present |
|---|---|---|
| `specs/agent-execute/SPEC-016-reality-check/requirements.md` | implementing | yes |
| `specs/agent-execute/SPEC-019-execution-substrate/requirements.md` | implementing | yes |
| `specs/minspec/SPEC-013-risk-section-policy/requirements.md` | implementing | yes |
| `specs/minspec/SPEC-034-oidc-review-broker/requirements.md` | planning | yes |
| `specs/minspec/SPEC-035-approvable-ref-lozenges/requirements.md` | planning | yes |
| `specs/minspec/SPEC-038-spec-code-ownership/requirements.md` | done | yes |
| `specs/minspec/SPEC-040-import-boundaries/requirements.md` | done | yes |
| `specs/minspec/SPEC-041-cross-artifact-staleness/requirements.md` | implementing | yes |
| `specs/minspec/SPEC-043-harness-refresh-manifest-consistency/requirements.md` | implementing | yes |
| `specs/minspec/SPEC-044-coordinated-self-completing-sessions/requirements.md` | implementing | yes |
| `specs/minspec/SPEC-044-coordinated-self-completing-sessions/design.md` | implementing | **no** |

Ten of eleven carry a sidecar — i.e. **every `requirements.md`/`spec.md` in the list is currently
approved**, zero exceptions. The one file with no sidecar, `SPEC-044/design.md`, is not an
approvable at all: `classifyApprovablePath` (`packages/minspec/src/lib/approvable.ts:26`) only
recognizes `requirements.md` and `spec.md` as approvable file names, so a `design.md` was never
eligible for a sidecar in the first place and correcting its comment stales nothing — there is no
approval to void. This changes the shape of the decision below: "fix the unapproved ones now" does
not partition the eleven into a large free group and a small costly group — it identifies exactly
one (already-worthless-comment, zero-cost) file, and ten files where any textual correction is a
re-approval event.

### The mechanism, and the gate that is missing (RCDD sibling rule)

The bad state — eleven wrong comments — is a symptom. The mechanism is: `hashLockReminder` is
call-site-scoped to `createSpec` by design (so it cannot safely retrofit existing files), and
**nothing else in the corpus checks what an existing comment says**. `validate-frontmatter.ts`
(Rule 11/11b) checks that a body *status* line agrees with frontmatter `status:`; no rule inspects
prose lines for a stale path reference. That is the asymmetry this spec's Context section names in
the issue: the validator checks that references which are *present* resolve, but a hardcoded path
inside a `#`-comment is not a reference it inspects at all. A pure text fix without a
corresponding gate would leave the corpus exactly as exposed to the next hand-written or
hand-edited hash-lock comment (dev writing a twelfth spec by copy-pasting an old one, or a
stray edit reintroducing the string) — so FR-3 below is the gate half, not an afterthought.

### Why this is not a duplicate of #1510

#1510 is "comments are hashed" as a general property and its generator-side fix (already landed).
This spec is the **retrofit** — what happens to text `hashLockReminder` cannot touch because it
already exists in approved files — plus the missing **enforcement** that stops it recurring. The
issue explicitly frames the two as wanting "one decision" on the re-approval-cost question; that
decision is recorded below rather than assumed.

## Functional Requirements

- **FR-1 (fix the one that costs nothing).** `specs/minspec/SPEC-044-coordinated-self-completing-sessions/design.md`'s
  hash-lock comment MUST be corrected (or removed — see DQ-2) in this change, unconditionally.
  It is not an approvable file (`classifyApprovablePath` returns no kind for `design.md`), so no
  approval can be staled by editing it. *Rationale: this is the zero-cost, zero-risk slice of the
  eleven and gates on nothing in DQ-1.*

- **FR-2 (the ten approved files follow the DQ-1 decision, not a guess).** The ten `requirements.md`
  files listed in the Context table MUST be corrected according to whichever option DQ-1 resolves
  to — either in this same change (accepting ten re-approval events) or in a tracked follow-up
  that batches them with #1510's own retrofit work. This spec MUST NOT silently pick one for the
  human; DQ-1 is where that choice is recorded.

- **FR-3 (the missing gate: no new wrong pointer can land).** A corpus check MUST fail the build
  (or `npm run validate`) when a spec file contains a line matching the hash-lock marker (`🔒`)
  together with the literal legacy path `.minspec/approvals.json` on the same line. This is a
  narrow, high-precision pattern — it targets exactly the tool-recognizable hash-lock comment
  shape, not every historical mention of the legacy filename (SPEC-022's design doc, SPEC-070's
  "do not read the gitignored legacy store" note, and DR-012/DR-031/DR-034 all reference the old
  path *without* the `🔒` marker, describing it historically rather than pointing a reader at it,
  and MUST continue to pass). *Rationale: this is the asymmetry fix from the Context section —
  the validator gains the one check that was missing, at the exact place a stale pointer would
  reappear.*

- **FR-4 (correction text is the single source, not hand-typed).** Wherever a comment is
  corrected under FR-1/FR-2, the replacement text MUST be produced by calling
  `hashLockReminder(specRelPath)` (`approval-store.ts:49`) for that file's own path, not by
  hand-retyping similar-looking text. *Rationale: the corpus already has, per #1510's own
  docstring, "27 specs, at least three different wordings, no generator and no template" — a
  retrofit that hand-writes a fourth wording repeats the exact mechanism defect this spec exists
  to close.*

- **FR-5 (advisory only for the dead local artifact).** The adjacent cleanup the issue names —
  `.minspec/approvals.json` and its `.bak-*` siblings being live, misleading, gitignored local
  files on contributor machines — MUST NOT be addressed by a repo commit (there is nothing
  tracked to change: `.gitignore:115-116` already excludes both patterns, confirmed present).
  A one-time, non-blocking advisory (e.g. surfaced by an existing doctor/validate pass, out of
  this spec's required scope — see Decisions needed) MAY warn a user whose checkout still has a
  non-empty `.minspec/approvals.json` that it is superseded and safe to delete. This requirement
  is deliberately soft: it is prose cleanup on someone else's machine, not a corpus defect.

## Acceptance Criteria

- **AC-1 (FR-1).** `SPEC-044/design.md`'s comment no longer contains the string
  `.minspec/approvals.json`, and `npm run validate` passes on it.
- **AC-2 (FR-2, whichever branch DQ-1 resolves to).** Either: (a) all ten `requirements.md` files
  carry a corrected comment and a re-minted sidecar with a matching `specHash`, with a stated
  re-approval log covering all ten; or (b) a tracked follow-up issue exists, filed against this
  repo, naming all ten paths and blocked on / batched with #1510's retrofit half, and this spec's
  own PR touches none of the ten.
- **AC-3 (FR-3, the gate).** A corpus check run against a fixture spec file containing a hash-lock
  line naming `.minspec/approvals.json` fails; the same check run against SPEC-022's design.md
  (a legitimate historical mention, no `🔒` marker on that line) and SPEC-070's "do not read"
  line (also no `🔒` marker) both pass.
- **AC-4 (FR-4).** A test asserts that the corrected text in any file touched by FR-1/FR-2 is
  byte-identical to `hashLockReminder(<that file's own repo-relative path>)`'s output — not merely
  "similar" or "also mentions the sidecar path."
- **AC-5 (no accidental staleness).** No file OTHER than the ones explicitly authorized by
  FR-1/FR-2's resolution has its bytes changed by this work, and in particular no `status:` or
  `phases:` field is touched (those are lifecycle mirrors, not part of this fix).

## Invariants

- **INV-1 (constitution #2 — no silent gate).** The FR-3 check MUST fail visibly (non-zero exit,
  named file and line) when it finds a violation — never a warning that can be scrolled past,
  and never dependent on a single optional tool the way `gitleaks` is allowed to be for secrets;
  this check has no reason to be optional since it is pure text matching over already-checked-out
  files (Tier-0, no new dependency).
- **INV-2 (approval hash integrity).** No spec's `specHash` changes as a side effect of running
  the FR-3 gate itself — the gate only reads and reports; only the explicit FR-1/FR-2 edits change
  hashed bytes, and only for the files each of those requirements names.
- **INV-3 (single source of comment text, from #1510).** After this spec, every hash-lock comment
  in the corpus — new or retrofitted — is byte-identical to some call to `hashLockReminder`. No
  hand-authored variant is introduced or left uncorrected within this spec's own scope (FR-1, and
  FR-2 if DQ-1 resolves to fixing now).
- **INV-4 (constitution #3 — blast radius).** The FR-3 gate is a `specs/`-scoped corpus check
  that runs inside this repo's own `npm run validate`; it ships no behavior into any repo that
  did not opt in, consistent with how the existing frontmatter validator already operates.

## Decisions needed (Clarify)

### DQ-1 (the load-bearing one) — fix the ten approved files now, or batch them behind #1510

- **Option A — fix all ten now, eat ten re-approval keystrokes (rec).** Every file in the Context
  table gets the corrected comment and a freshly re-approved sidecar in this change. *Cost:* ten
  manual re-approvals for a change that is, in every one of the ten cases, a pure comment
  correction with no requirements-text change — each re-approval re-baselines a hash for a
  non-substantive edit, which is the same "approval keystroke devaluation" cost the issue names
  for its own "fix all 11" option. Recommended anyway because the corpus-consistency argument for
  *not* fixing them cuts the other way once the true count is known (see below): the "wait for
  #1510 to land 'comments stop being hashed'" framing assumed a large free group existed among the
  eleven, and this spec's recount found there isn't one — nine, ten of eleven approved files pay
  the same re-approval cost whenever they are eventually fixed, on any timeline, because #1510's
  own scope note says the retrofit "stays open on #1510" only in the sense of *being tracked*
  there, not of being any cheaper there.
- **Option B — defer all ten to a follow-up tracked against #1510, ship only FR-1 (SPEC-044) and
  FR-3 (the gate) here.** *Cost:* the ten most-consulted, load-bearing, already-approved specs —
  exactly the population that misled two readers on #1491 — keep the wrong pointer for however
  long #1510's own follow-up takes to schedule. The gate (FR-3) stops the count from growing but
  does not shrink it.
- **Option C — stop hashing full comment lines (fold into #1510 itself), then correct all eleven
  for free.** *Cost:* this is #1510's own remaining scope, not this spec's — re-litigating
  `canonical.ts`'s strip list is an architecture change to what "approval" hashes over, with its
  own re-approval-semantics question, and belongs in whatever spec #1510 resolves to, not smuggled
  in here as a prerequisite.

Recommendation: **Option A**. It is a one-time, bounded cost (ten keystrokes) which the FR-3 gate
guarantees is the *last* time text drift forces a mass re-approval — under Option B, whatever
triggers the eventual fix pays the identical ten keystrokes later, only later.

### DQ-2 (SPEC-044/design.md specifically) — correct the comment, or delete it

- **Option A — correct it via FR-4's `hashLockReminder`, even though `design.md` is not
  approvable (rec).** Keeps one visual convention across every spec file regardless of kind, and
  the corrected text is truthful even if unenforced for this file (a reader who edits a `design.md`
  is not voiding anything, and the comment no longer claims otherwise). *Cost:* the comment is
  then present-but-inert on `design.md` files generally, which could itself read as confusing
  ("why is this here if nothing hashes it") absent a one-line note.
- **Option B — delete the comment from non-approvable file kinds entirely.** Removes a comment
  that was never true in the strict sense (design.md was never hash-locked). *Cost:* requires
  teaching `createSpec`/tooling to know which kinds get the comment at all, a small scope increase
  over FR-1's "just fix this one file" framing, and the issue's own "delete rather than correct"
  option (rejected there for requirements.md, for losing the in-file warning) applies with less
  force to design.md since there was never anything to warn about.

Recommendation: **Option A** (minimal, consistent with FR-1 as scoped).

### DQ-3 (advisory scope) — does FR-5's doctor-style warning belong in this spec's implementation, or a separate one

Not blocking: FR-5 is written soft precisely so this spec's Plan phase can decide whether the
one-time local-artifact advisory rides along with the FR-3 gate work or gets its own, smaller
spec. Either answer satisfies this spec; recorded here only so Plan does not have to re-derive
that it is optional.

## Out of scope

- Re-litigating what `canonical.ts` strips from the hash (DQ-1 Option C / #1510's remaining scope).
- Any change to `.minspec/approvals.json` itself or its `.bak-*` siblings on disk — they are
  gitignored, per-machine, and not a repo artifact this spec's diff can touch.
- The twelve-plus other specs that mention `.minspec/approvals.json` in historical/documentary
  prose (SPEC-022, SPEC-070, DR-012, DR-031, DR-034 and similar) — those are accurate statements
  about a past migration, not pointers instructing a reader where to look *now*, and FR-3's
  `🔒`-anchored pattern is deliberately built not to flag them (see AC-3).
