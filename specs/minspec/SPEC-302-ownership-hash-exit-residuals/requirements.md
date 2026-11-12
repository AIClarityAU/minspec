---
id: SPEC-302
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - same epic as SPEC-070, whose residual follow-ups these are
aspects: [ownership, spec-gate, parity, approval, migration, no-silent-gate, tier-0]
depends_on: [SPEC-070]  # owned-set.ts, ownedAtApproval and the migration's classify pass are all SPEC-070's, none built yet
relates_to: ["#3283", "#3265", "#1649", "#1668", "#1960", "#1669", "#630", "#2008", SPEC-070, SPEC-038, SPEC-081, DR-088, DR-096, DR-034, DR-023]
implements: none
implements_reason: >-
  Specify phase only. Which files this spec will own is decided at Plan, after SPEC-070 has
  created the files it would modify. Expected surface: SPEC-070's
  `packages/minspec/src/lib/owned-set.ts` and its parity test, the SPEC-070 migration
  script, `packages/minspec/src/lib/approval-store.ts`, and one new palette command. None of
  it is claimed yet.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-302: The three loose ends SPEC-070 leaves - engine parity, an exit for unrefreshable approvals, and the batched ownership acknowledgement

> **This is a SPECIFICATION ONLY.** Written for issue
> [#3283](https://github.com/AIClarityAU/minspec/issues/3283), the follow-ups that SPEC-070
> (ownership leaves the approval hash) records in its `design.md` section 9 under DR-023's
> forward rule. Nothing is built until this spec is approved, after
> [Decisions needed (Clarify)](#decisions-needed-clarify) are resolved.
>
> Design rests on **DR-088** (ownership leaves the hash; the grandfathered set takes a batched
> acknowledgement) and SPEC-070's accepted Open Questions OQ-6 and OQ-8. Nothing here changes
> the DR-034 hashing contract, so DR-096 is cited, not amended.

## In plain terms

SPEC-070 takes the list of files a spec owns out of the approval hash and replaces it with a
snapshot taken at approval time. It deliberately leaves three things unbuilt:

1. **The two copies of the owned-file reader disagree on some odd characters.** The gate is
   Python, the snapshot is TypeScript, and the two languages disagree about what counts as
   whitespace and where a line ends. SPEC-070 accepted two of these as harmless. Measuring for
   this spec found more than two, in both directions. This spec closes them, so the snapshot and
   the gate always read the same list.
2. **Three old approval records can never be refreshed.** No `MinSpec: Approve Spec` run can
   reach them, because the files they belong to stopped counting as approvable specs. SPEC-070's
   migration stops and names one if it ever needs attention. Nobody has said what the human does
   next. This spec defines that exit.
3. **The batched acknowledgement.** When the #1649 backfill adds ownership lists to about twenty
   approved specs, each one will register as "ownership changed since approval". This spec
   defines the one command that lets the human read each change and accept them all with a
   single save, without a select-all shortcut.

None of the three has a live user today. Item 2 matters first, because SPEC-070's seed run
(slice 6) is the step that can hit it.

## Measured state (base 5a0ec77a, 2026-11-12, read-only)

Every claim below was executed or read in this worktree. Claims I inferred rather than checked
say so in the same sentence.

**SPEC-070 is not built.** `packages/minspec/src/lib/owned-set.ts` does not exist (`ls`), and
no `.ts`/`.py` file under `packages/` or `scripts/` mentions `ownedAtApproval` (grep, 0 files).
SPEC-070's `requirements.md` reads `status: planning`. Everything this spec says about the
TypeScript twin is therefore about SPEC-070's *design* (`design.md` section 3, "Snapshot
normalisation"), not about code.

### Item 1 - the engine divergences are wider than SPEC-070 section 3 lists

SPEC-070's design names three divergences: Python `re.I` folding U+017F (closed there),
`str.strip()` vs `.trim()`, and `$` before a trailing newline (both "accepted, fail-closed").
Executed here:

- **Whitespace sets, full codepoint range.** Python 3 `str.isspace()` true and JS `.trim()`
  strips: equal except **Python-only U+001C, U+001D, U+001E, U+001F, U+0085** and **JS-only
  U+FEFF**. So the strip divergence runs in both directions, as SPEC-070 states.
- **The divergence reaches the tokenizer, not only the strip.** The gate tokenizes an inline
  list with `re.split(r'[,\s\[\]]+', inline)` (`scripts/hooks/spec-gate.py:150`) on a value
  captured by `fm_value`'s `(.+?)\s*$` under `re.M` (`:133`). Python's `\s` is the Unicode set
  above. The TypeScript inline capture SPEC-070 cites from #1976 is
  ``^${key}[ \t]*:[ \t]*(.*)$`` with the `m` flag. Run through both engines:

  | Frontmatter line (escape shown) | Python `fm_list` | JS capture + `\s` split |
  |---|---|---|
  | `implements: a/b.ts c/d.ts` | `a/b.ts`, `c/d.ts` | `a/b.ts` |
  | `implements: a/b.ts\rc/d.ts` | `a/b.ts`, `c/d.ts` | `a/b.ts` |
  | `implements: a/b.ts\x1cc/d.ts` | `a/b.ts`, `c/d.ts` | `a/b.ts\x1cc/d.ts` (one token) |
  | `implements: a/b.ts﻿c/d.ts` | `a/b.ts﻿c/d.ts` (one token) | `a/b.ts`, `c/d.ts` |

  The first two rows come from JS `.` and multiline `$` treating `\r`, U+2028 and U+2029 as
  line ends, which Python's `.` and `re.M` `$` do not (Python ends a line only at `\n`). SPEC-070's
  list has no entry for this class, which I am calling **line-terminator** below.
- **`$` before a trailing newline, in the extension regex.** Python `re.search(r'\.(?:ts)$',
  'a/b.ts\n')` matches; JS `/\.(?:ts)$/.test('a/b.ts\n')` does not. I believe this one cannot be
  reached from `consider()` (`spec-gate.py:361-374`), because its final `.strip()` (`:362`)
  removes any trailing `\n` before `_SRC_EXT_RE` (`:313-315`) runs. That is inferred from
  reading the strip chain, not executed against every quote and whitespace ordering. FR-3 makes
  the test prove it.

**What a divergence costs.** SPEC-070 calls the accepted ones fail-closed: any difference
between snapshot and current set reads as drift, and drift freezes. That holds for *release*,
and I found no path where a divergence releases a path the snapshot holds (inferred from the
set-inequality rule in SPEC-070 FR-6, not testable until it is built). It still costs two things
the "fail-closed" label hides:

- **Permanent false drift.** A spec whose ownership line carries one of these characters is
  drifted the moment it is approved. Re-approval does not help, because re-approval takes the
  snapshot with the same TypeScript code. The only way out is to edit the frontmatter until both
  engines agree.
- **The snapshot is not what the human read.** In the U+2028 row, the human reads two paths and
  signs, and the snapshot records one. The witness of what was signed disagrees with the text
  that was signed.

The corpus holds zero such tokens today (SPEC-070 design section 3 measured 466 structured
tokens, 6 non-ASCII, all U+2014 dashes with no `/`). These are latent, like #1668 and #1960.

### Item 2 - the three unrefreshable sidecars

| Sidecar keyed path | `tier` in record | Spec file carries `tier:`? | Approved by, at |
|---|---|---|---|
| `specs/minspec/design.md` | T2 | no | `github@harvest316.com`, 2026-06-01 |
| `specs/minspec/tasks.md` | (not read) | no | (not read) |
| `specs/agent-execute/SPEC-019-execution-substrate/design.md` | T4 | no | `github@harvest316.com`, 2026-07-01 |

- **Why unrefreshable.** `classifyApprovablePath` (`packages/minspec/src/lib/approvable.ts:36-42`)
  accepts only `DR-*.md`, `EPIC-*.md`, `requirements.md` and `spec.md` (`:24-26`), so
  `MinSpec: Approve Spec` cannot target a `design.md` or `tasks.md`. #630 narrowed it on purpose.
- **Who reads them today.** `validate-frontmatter.ts` Rule 10 (`:626-641`) warns about each
  one through `listOrphanedRecords` (`approval-store.ts:231`), and SPEC-070's migration will
  classify them. **The spec-gate never reads them**: it consults a record only for a
  `specs/**/*.md` file whose frontmatter carries `tier: T3|T4` and an `id:`
  (`spec-gate.py:533-546`), and none of the three files has a `tier:` line (read, frontmatter of
  each). So no freeze depends on these records. Their only content of value is the historical
  `approvedBy`/`approvedAt`.
- **The latent trap.** If someone adds `tier: T3` to one of those files, the gate starts reading a
  record that no command can refresh. That record then becomes an approval verdict the human cannot
  re-take. This is inferred from the gate's enumeration at `:533-553`. I have not traced how
  `select_verdict` (#958) ranks a stray-tier `design.md` against its sibling `requirements.md`.
- **What SPEC-070 does with them.** Founder decision of 2026-09-23 (SPEC-070 design OQ-6): do
  not retire them; seed SPEC-019's record; leave the two stale ones untouched; abort the
  migration and name the record if one ever classifies as a quarantine candidate. SPEC-070
  measured zero would-improve records, so the abort is not expected to fire.

### Item 3 - the batched acknowledgement

- **Population today: zero.** SPEC-070 FR-9.10 seeds every old-fresh record, so no approved
  record starts out drifted. The population is created by real declaration edits, mainly #1649's
  backfill of `implements:`/`affects:` onto approved specs.
- **The constraints are already set** (SPEC-070 design OQ-8): per-record rows the human reads,
  one write, a keyboard path on the list, no select-all.
- **A select-all may come for free.** I believe VS Code's multi-select QuickPick
  (`canPickMany: true`) shows a toggle-all checkbox in its header that the extension API cannot
  hide. This is unverified here (no network, no editor in this container). If it is true,
  `canPickMany` breaks the no-select-all constraint by default. FR-11 and Decision D4 handle it.

## Functional requirements

### Engine parity (item 1)

- **FR-1 - Inventory, by execution.** A test MUST compute every divergence between the Python
  gate's owned-set pipeline and SPEC-070's TypeScript `structuredOwnedSet` at each of these stages,
  by running both engines:
  - **FR-1.1** the inline-value capture (the line-terminator class: which codepoints end the
    captured value);
  - **FR-1.2** the inline token split class (`[,\s\[\]]`);
  - **FR-1.3** the block-item capture (`spec-gate.py:157-164`), including its trailing-comment
    strip;
  - **FR-1.4** the `strip -> " -> ' -> strip` chain (`:362`);
  - **FR-1.5** the source-extension match, including case folding and the end anchor (`:313-315`,
    `:373`).

  Python MUST be the reference, because Python is the engine that enforces the freeze. The test
  MUST derive each character class from the running `python3` (for example by executing
  `str.isspace` and `re` over the codepoint range), not from a list typed into the test. The
  reason: Python's Unicode tables move with interpreter versions, and a typed list would pass
  while the gate's real behaviour drifted.
- **FR-2 - Close, do not accept.** `structuredOwnedSet` MUST produce the gate's set exactly at
  every FR-1 stage, using explicit character classes equal to Python's, rather than JS `\s`,
  `.`, `.trim()` or multiline `$`. When FR-2 lands, the FR-1 inventory MUST be empty. This
  reverses SPEC-070 design section 3's "accepted, fail-closed" for strip and `$`, and extends
  the close to the line-terminator and split classes that section did not list. See Decision D1.
- **FR-3 - Unreachable is proven, not asserted.** For any FR-1 stage where a raw engine
  difference exists but is claimed unreachable through the pipeline (expected: the extension
  `$` before a trailing `\n`, masked by the final strip), the test MUST feed every
  divergent codepoint through the whole pipeline in each position (prefix, suffix, between
  quotes, between path segments) and show that both engines return the same set.
- **FR-4 - Python absent fails visibly.** If `python3` is not available, the FR-1 test MUST
  fail with a message that names the missing interpreter. It MUST NOT skip. It MUST be in a
  suite CI runs, not in `scripts/hooks/test_canonical.py`, which no CI job runs (#1669).
- **FR-5 - The gate is not edited for parity.** No FR in this group changes
  `scripts/hooks/spec-gate.py`. Closing a divergence by changing the Python side would change
  which files every adopter's gate freezes. That is a different decision, and it is out of scope.

### An exit for an unrefreshable approval record (item 2)

- **FR-6 - Scope is the orphan class, not three paths.** The exit covers every record that
  `listOrphanedRecords` returns, not a hardcoded list of three. A future narrowing of
  `classifyApprovablePath` strands records in the same way.
- **FR-7 - The abort names the exit.** When SPEC-070's migration aborts on an orphaned record
  (its task 6.2), the message MUST name the record and state the FR-8 exit as a step the human
  can run. "Escalate to a human" with no step does not meet this.
- **FR-8 - The exit.** The exit's form is Decision D2. Whichever form is chosen, it MUST:
  - **FR-8.1** keep `specHash`, `approvedAt`, `approvedBy` and `tier` byte-for-byte, the same
    protection SPEC-070 FR-9.4 gives a quarantined record;
  - **FR-8.2** run only when a human starts it explicitly, never as a migration side effect;
  - **FR-8.3** leave a committed, dated line that says what happened to the record and why;
  - **FR-8.4** take the record out of every reader that could treat it as a live approval:
    the spec-gate, `resolveStatus`, the migration's classify pass and Rule 10's warn.
- **FR-9 - Close the latent trap.** Validation MUST raise an error when a `specs/**/*.md` file
  that the spec-gate would gate (frontmatter `tier: T3|T4` plus `id:`) has its approval record
  keyed to a path `classifyApprovablePath` rejects. The error MUST name both the file and the
  record. Without this error, that file has a gate verdict no command can refresh.

### The batched ownership acknowledgement (item 3)

- **FR-10 - One palette command.** `MinSpec: Acknowledge Ownership Changes` lists every approved
  record whose SPEC-070 verdict is `ownership-drifted` or `ownership.witness.missing`. It lists
  nothing else. With an empty list, it says so and writes nothing.
- **FR-11 - One row per record, read before it is picked.** Each row MUST show the spec id, its
  title, and the change: paths added and paths removed compared with `ownedAtApproval`, or
  "no snapshot - the whole current set" for a missing witness. A **removed** path MUST be
  visually distinct from an added one, because a removal is the direction that releases a freeze.
  When a row lists more paths than fit, the full list MUST be reachable from that row before it is
  picked.
- **FR-12 - No select-all.** No single keystroke, click or control may select more than one row.
  Each row is picked by its own act. If the platform control provides a select-all toggle that
  cannot be removed, the command MUST NOT use that control (Decision D4).
- **FR-13 - Keyboard path.** The whole flow, from opening the list to confirming the write, MUST
  work without a mouse.
- **FR-14 - One write, all or nothing.** A single confirm writes every picked record. Before the
  first write, every target MUST be re-read and checked: still approved, verdict unchanged since
  the list was built, and current structured set equal to what its row showed. If any check
  fails, nothing is written and the command names the record that failed. Each file is written
  temp-file-and-rename. If a write fails part-way, the files already written MUST be restored, and
  the failure MUST be reported with the restored list.
- **FR-15 - What the write touches.** For each picked record, the write sets `ownedAtApproval` to
  the record's current structured set, which is SPEC-070's `structuredOwnedSet`, never the fuzzy
  `tasks.md` arm. It MUST NOT change `specHash`, `approvedAt`, `approvedBy`, `tier`,
  `baselineBlob`, `reviewStart` or any SPEC-070 migration field. Whether the write also records
  who acknowledged the change, and when, is Decision D3. If it does, SPEC-070 FR-4's six-site
  rule applies to the new fields.
- **FR-16 - Same identity rule as approval.** The acknowledgement inherits the identity and
  agent-refusal behaviour that `MinSpec: Approve Spec` has today. If that behaviour turns out to
  be weaker than this repo's no-borrowed-identity rule requires, Plan MUST record the gap as a
  filed issue. It MUST NOT build a second, different identity path just for this command.

## Acceptance criteria

- **AC-1 (FR-1, FR-2).** On the FR-2 build, the inventory test reports zero divergences at every
  FR-1 stage. **Red first:** run against a `structuredOwnedSet` that uses JS `.trim()`, JS `\s`
  and a multiline `$` capture, the same test lists at least U+001C through U+001F, U+0085,
  U+FEFF, `\r`, U+2028 and U+2029. Each must appear under the stage where it diverges.
- **AC-2 (FR-1, Python as source).** Mutation: replace the derived Python whitespace class with a
  typed list that omits U+0085. The test MUST go red. Typing the class into the test is the
  defect this AC exists to catch.
- **AC-3 (FR-2, the four measured rows).** The four frontmatter lines in "Measured state, item 1"
  are fixtures. For each, `structuredOwnedSet` equals the Python `declared_impl_files` structured
  set, compared as sets, with no order assertion (SPEC-070 design section 3, step 12).
- **AC-4 (FR-3).** The extension-`$` case has a fixture per position (path suffix `\n`, `\n`
  inside quotes, `\n` followed by a Python-only whitespace codepoint). Both engines return
  equal sets. Mutation control: remove the final `.strip()` from a copy of the Python pipeline
  used only in this test, and the suffix fixture MUST diverge.
- **AC-5 (FR-4).** With `python3` removed from `PATH`, the test fails (non-zero exit) and the
  output names `python3`. A skip, or a pass with zero assertions, fails this AC.
- **AC-6 (FR-5).** The FR-1 to FR-4 build changes no line of `scripts/hooks/spec-gate.py`
  (checked from the diff).
- **AC-7 (FR-6, FR-7).** Fixture: a sidecar keyed to `specs/x/orphan-fixture/design.md`, set up so
  the migration classifies it as a quarantine candidate. The migration exits non-zero, writes
  nothing, and its message contains the record path and the FR-8 exit step written so that it can
  be run as shown.
- **AC-8 (FR-8.1, FR-8.3, FR-8.4).** After the exit runs on that fixture: (a) the four
  provenance fields are byte-identical to the input; (b) a committed dated line names the record;
  (c) Rule 10 no longer warns about it; (d) the migration's classify pass and `resolveStatus` do
  not see it. **Control:** an orphaned record the exit was not run on still gets the Rule 10 warning.
- **AC-9 (FR-8.2).** No code path reachable from the migration script calls the exit. Checked by a
  test that runs the migration over a corpus of orphaned records, without the human-started exit,
  and asserts every sidecar is byte-unchanged.
- **AC-10 (FR-9).** Fixture: `specs/x/gated-orphan-fixture/design.md` with an `id:` and `tier: T3`,
  plus a sidecar keyed to that path. `npm run validate` exits non-zero and names both paths.
  **Control:** the same fixture without `tier:` gives the existing Rule 10 warning only, not an
  error.
- **AC-11 (FR-10, FR-11).** Fixture: three approved records. One is drifted by an addition, one
  by a removal, and one has no witness. A fourth record is approved and not drifted. The list
  shows exactly the first three. The removal row is marked distinct from the addition row, and the
  no-witness row says "no snapshot". With zero drifted records, the command writes no file.
- **AC-12 (FR-12).** On the list, `Ctrl/Cmd+A`, any header control, and any single action select
  at most one row. Tested at the command layer by driving whatever picker abstraction Plan
  chooses. If the chosen control has a select-all affordance, this AC fails.
- **AC-13 (FR-13).** The AC-11 flow completes driven only by key events.
- **AC-14 (FR-14).** (a) Change one picked spec's `implements:` between list and confirm: no
  file is written and that spec is named. (b) Make the second of three writes fail (read-only
  file): the first is restored byte-for-byte, the third is never written, and the report names all
  three.
- **AC-15 (FR-15).** After a successful acknowledgement, each written sidecar differs from its
  input only in `ownedAtApproval` (plus D3's fields, if chosen). Checked by a key-by-key diff.
  `specHash` is unchanged, and `facts approval <id>` still reports `APPROVED`.
- **AC-16 (FR-10 to FR-15, the gate).** After the acknowledgement, the spec-gate's drift check for
  each acknowledged spec returns no drift. A spec that was listed and not picked stays drifted.

## Invariants this must not break

- **Constitution 1 - offline.** Every requirement here is local file and process work. The
  inventory test runs a local `python3`, never a network call.
- **Constitution 2 - no silent gate.** FR-4 (Python absent fails), FR-14 (all-or-nothing, named
  failure) and FR-9 (an error, not a warning) are this invariant applied. No new check may
  catch an exception and report clean.
- **Constitution 3 - blast radius.** The acknowledgement command and the FR-9 rule ship to adopter
  repositories that opted in with `.minspec/`. Neither may touch a repository without `.minspec/`.
  FR-5 keeps the adopter gate's freeze set unchanged.
- **DR-034 hashing contract.** Nothing here changes `specHash` or what it covers. FR-15 forbids
  writing it.
- **SPEC-070 FR-9.4 provenance.** `approvedBy` and `approvedAt` are never rewritten (FR-8.1,
  FR-15).
- **SPEC-070's snapshot rule.** `ownedAtApproval` is only ever the structured set, never the fuzzy
  arm, and absence stays absence (SPEC-070 design section 3: never coerce absent to `[]`).

## Decisions needed (Clarify)

- **D1 - Engine divergences: close them all, or keep SPEC-070's acceptance?**
  - **(a) Close all (rec).** `structuredOwnedSet` copies Python's classes exactly, and the
    inventory must come out empty. Removes permanent false drift and makes the snapshot match
    what the human read. **Cost:** the TypeScript twin carries hand-built character classes tied
    to the Unicode tables of whichever `python3` the developer runs. A Python upgrade that moves
    `isspace` turns the test red until the class is updated.
  - (b) Keep strip and `$` accepted as SPEC-070 says, and add the line-terminator class to the
    accepted list. Cost: a spec with one of these characters is drifted from approval with no
    re-approval exit, and its snapshot disagrees with its text.
- **D2 - The exit for an unrefreshable record.**
  - **(a) Archive (rec).** Move the sidecar byte-identical into a retired directory under
    `.minspec/` that no reader walks, and append a dated line to a ledger in that directory.
    It keeps every sign-off the 2026-09-23 decision protected and gives the abort an exit.
    **Cost:** it reverses the wording of that decision ("do not retire") while keeping its
    reason. It also creates a new location that every present and future record reader must be
    proven to skip, which is what AC-8(d) tests, and a future reader can forget to skip it.
  - (b) Keep the abort as the end of the road and document a manual JSON edit. Cost: the human
    hand-edits an approval record, which is the step every other gate here exists to prevent.
  - (c) Widen Approve Spec to accept an orphaned record's path. Cost: it undoes #630's
    deliberate narrowing and makes `design.md`/`tasks.md` approvable again for everyone.
- **D3 - Does the acknowledgement record who did it?**
  - **(a) Yes (rec):** add `ownershipAckedAt` and `ownershipAckedBy` to the record, written by
    FR-15 and shown by `scripts/approval-provenance.py`'s field diff. Without them, a snapshot
    that changed after approval has no trace of who changed it. **Cost:** two more fields under
    SPEC-070 FR-4's six-site rule, and a schema change shipped to adopters. That change cannot be
    reversed in under a day, so Plan writes a DR or amends DR-088 for it.
  - (b) No: the git commit is the only record. Cost: the record and its history disagree about
    who signed which ownership, and the provenance block cannot show it.
- **D4 - How "no select-all" is built.**
  - **(a) A single-pick list in a loop (rec).** Each pick toggles one row and re-shows the list,
    with a final "Write N acknowledgements" item. It is all keyboard and has no select-all by
    construction. **Cost:** N+1 picker rounds for N records, about 21 for the #1649 backfill.
  - (b) A webview list with per-row checkboxes. Cost: a new webview surface, harder keyboard and
    accessibility testing, more code than the rest of this spec combined.
  - (c) A `canPickMany` QuickPick, if Plan shows its select-all toggle can be removed. Cost: rests
    on a platform behaviour I could not check here (see Measured state, item 3).
- **D5 - One spec or three?**
  - **(a) One (rec):** the three items share one origin (SPEC-070 section 9) and, after Clarify,
    one read. **Cost:** one approval covers three unrelated surfaces. A later edit to any one item
    stales the approval for all three, and Plan cannot ship item 2 ahead of SPEC-070 slice 6 without
    the other two being planned too.
  - (b) Split into three specs. Cost: three Clarify reads instead of one.

## Rejected alternatives (DR-086 section 4)

- **Fix the divergences on the Python side.** It would change which files every adopter's gate
  freezes, to fix a snapshot bug in the extension. Rejected by FR-5.
- **Delete the three sidecars.** This was SPEC-070's own original recommendation, and the founder
  declined it on 2026-09-23 because it destroys genuine sign-offs. D2(a) keeps the bytes.
- **A per-spec `MinSpec: Acknowledge Ownership` command only.** It is safer row by row, but
  SPEC-070 OQ-8 records that it will not get done for a twenty-spec backfill, so the backfill stays
  blocked.
- **Fold the acknowledgement into re-approval.** Re-approval already re-snapshots, but it re-reads
  and re-signs the whole spec. For a declaration-only change, that is the noise that trains people
  to sign without reading.

## Out of scope

- The validator's deliberate inline-comment asymmetry (`fmListField` strips `#` comments, the
  gate's `fm_value` does not). SPEC-070 task 3.1 records it in `owned-set.ts`.
- The TypeScript swallowed-gate lint arm (#2008).
- The canonicalizer twin divergences #1668 and #1960. They are the same class in a different
  function (the hasher, not the owned set). This spec's inventory method could be reused there,
  but it is not applied.
- #1649's backfill itself. This spec builds the affordance the backfill uses, not the backfill.

## Follow-ups (tracked)

- Item 2 must be decided (D2) before SPEC-070 slice 6, the seed run, executes. Tracked on
  #3283 and #3265.
- If D3(a) is chosen: a DR, or a DR-088 amendment, for the two new record fields. Plan files it.
  None is minted here, because no irreversible choice is made by this spec until Clarify picks one.
- The QuickPick select-all behaviour (Measured state, item 3) is checked at Plan. It is unverified
  here and decides D4.
- Otherwise none.
