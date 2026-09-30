---
id: SPEC-075
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a gate that validates a corpus the project does not have is a false signpost
aspects: [harness, managed-files, gate, no-silent-gate, config, tier-0, downstream]
relates_to: [DR-037, DR-066, DR-089, DR-090, DR-092, SPEC-043, SPEC-066, SPEC-068]
implements: [packages/minspec/tests/validate-py-corpus-config.test.ts, packages/minspec/tests/managed-region-edit-hold.test.ts]  # both NEW — the two T0s this spec owns (corpus half, refresh half)
affects: [packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/scaffold.ts, .minspec/hooks/validate.py, .minspec/config.json]  # template-registry.ts and scaffold.ts are claimed by no spec's implements:; SPEC-066, SPEC-063 and SPEC-068 list them under affects: only, and this spec follows that precedent (one owner per file)
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — Refresh never silently replaces an edited managed region, and the managed validator reads its corpora from config (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for #1698 (*harness refresh silently deletes a
> project's commit gate*), which triage classified
> `T3` · `role:architect` · `hold:specify` — so the spec is the gate, not the fix.

## One-Sentence Scope

*MinSpec: Refresh Harness Files* must never replace a managed region the project has
edited without holding the write and saying so, and `.minspec/hooks/validate.py` must
derive which document corpora it validates from `.minspec/config.json` instead of
hard-coding them — so a project's validation checks are neither silently deleted nor
forced to live inside bytes a refresh owns.

**Two halves, one incident.** The *refresh half* (FR-7 to FR-12) is the part that stops
the loss #1698 reported: a hand-edited `validate.py` was reverted to template with no
report. The *corpus half* (FR-1 to FR-6) removes the most common reason a project has to
edit that file at all. Neither half alone closes the issue: without the refresh half any
edit is still silently lost, and without the corpus half the only way to add a corpus is
an edit that the refresh half will then hold forever. See CQ-6 for splitting them.

## Context

### The refresh half: the overwrite, measured

`refreshManagedRegionTemplates` (`packages/minspec/src/lib/scaffold.ts:926`) handles every
managed-region template, `validate-py` included. When the markers are intact it splices the
running bundle's block in and writes whenever the bytes differ
(`scaffold.ts:963-968`). Its own docstring states the design: "No content baseline is
consulted — the markers ARE the boundary between MinSpec-owned and user-owned content"
(`scaffold.ts:917-920`). It returns warnings only for files it did **not** write (missing
markers); a region it **did** replace produces no notice of any kind. The
`ManagedRegionWarning.kind` union (`scaffold.ts:498-502`) has no member for "replaced".

So the #1698 sequence is the designed behaviour, not a malfunction: the project edited
inside the markers, the refresh saw bytes that differed from the template, wrote the
template, and returned an empty warning list. The two commits in the report (`97a14a7`,
`0703f9a`, both `-28 / +1`) are that write.

**What the neighbouring work does and does not cover.**

- **DR-089 (accepted)** made the *section-merge* path fail closed on missing authorship
  evidence (§2). The managed-region path never consults the manifest at all, so DR-089's
  rule does not reach it.
- **SPEC-068 / DR-092 (accepted DR, spec `planning`, not built — `harness-provenance.ts`
  does not exist)** holds a refresh whose bundle is **older** than the repo. Its FR-4 says
  `ahead` and `level` verdicts "write as today". #1698 is a `level` refresh (same bundle,
  hand-edited region), so SPEC-068 as specified leaves it exactly as it is today. This
  spec is the missing branch: *is the region on disk still what MinSpec last wrote?*
- **The command's own description** says the opposite of what happens to these files:
  `template-registry.ts:256` — "Re-merge harness templates, preserving your edits." True
  of the section-merge files, false of every managed region. #1698 names that sentence as
  why the project trusted the refresh.

**Why this is invariant 2.** `validate.py` is a commit gate. A tool that removes a check
from a commit gate and reports nothing is the "silently passes" case the constitution
forbids, and it has a second-order cost the issue names: every drift the removed check
would have caught is now also uncaught, so the tool disables the mechanism that would have
reported its own damage.

### The corpus half: hard-coded corpora, measured

`.minspec/hooks/validate.py` is a managed-region template
(`template-registry.ts`, `name: 'validate-py'`, `outputPath: ${MINSPEC_HOOKS_DIR}/validate.py`),
so its region is rewritten byte-for-byte on every refresh. It hard-codes its corpora:

```python
# .minspec/hooks/validate.py:92
targets = all_md(root, "specs") + all_md(root, os.path.join("docs", "domain"))
# :105
is_domain = norm.startswith("docs/domain/") and norm.endswith(".md")
```

`.minspec/config.json` **already declares those paths**, and the validator never reads it:

| config key | value in this repo | read by validate.py? |
|---|---|---|
| `specsDir` | `specs` | no |
| `decisionsDir` | `docs/decisions` | no |

Measured on both copies: `validate.py` contains **0** occurrences of `config.json`, **0** of
`import json`, and **0** of `specsDir`. The shipped template (`VALIDATE_PY` in
`template-registry.ts`) is identically config-blind — same three counts are zero there.

So the extension point does not need inventing. It needs **wiring to configuration the
project already has**, which is why this is a repair rather than a new feature surface.

### Why the corpus drift is invariant 2 too, not a preference

#1698 filed this as a silent-gate fault and that reading is correct for the corpus half as
well. The failure is not
"a project cannot customise the validator". It is:

1. Nothing ties the hard-coded corpus list to `.minspec/config.json`'s `specsDir`/
   `decisionsDir` — measured above as zero `config.json`/`import json`/`specsDir`
   occurrences in either copy. The two can drift from each other, silently, in either
   direction.
2. *Refresh Harness Files* rewrites the managed region from the template, overwriting
   whatever corpus list the live file currently carries with the template's — whichever one
   that happens to be.
3. **The hook still exits 0** whichever list wins. Nothing reports the difference, because a
   validator that never reads config has no way to notice it disagrees with config, and a
   validator that checks fewer files passes more often either way.

That is the shape invariant 2 names: a gate whose coverage can silently diverge from what the
project's own config declares. A red check is a working gate; a gate that quietly stops
looking — or never looked at the declared truth in the first place — is the defect.

### The drift this repo currently carries proves the point

The live file and its own template diverge on corpora today, measured at `ee8ea97c`
(`.minspec/hooks/validate.py:92` vs. `template-registry.ts:1753-1757`):

- live validates `specs` + `docs/domain`
- the template validates `specs` + `docs/decisions` + `docs/domain` — a strict superset,
  including the DR-frontmatter check (`DR_ID_RE`, `template-registry.ts:1681`) the live file
  lacks entirely

So today's drift runs one way: a refresh here would **add** `docs/decisions` coverage and
remove nothing, since `docs/domain` is already in both copies. That the direction happens to
be benign today is not a property of the mechanism, only of which copy was edited last — the
same config-blind, hand-edited, uncompared pair could just as easily drift the other way on a
future edit, and nothing would catch that either. That drift is waived (not fixed) by the
#1888 self-application gate, whose waiver for this path names this spec's design question as
the reason it is waived rather than reconciled.

### The originating check the corpus half does not cover

#1698's own report names the check that was actually deleted: a project-added rule in
`validate.py` asserting that a decision record's frontmatter `status:` **agrees with** the
`- **Status:**` line in its body — a comparison between two different parts of the same
document, not a property of one field. FR-4's shape (`corpus path → required frontmatter
key/pattern`, CQ-1 option `a`) can express "this frontmatter key must exist" or "must match
this pattern"; it cannot express "this frontmatter value must equal that other, differently-
located value" — there is no second location in the grammar to reference. Confirmed by re-
reading FR-4 and AC-1..AC-6 below: every corpus-half example and acceptance criterion is a
single-field presence/pattern check (`id: SPEC-NNN`, `id: DR-NNN`).

So the corpus half closes the corpus-list drift class of silent loss (the
`docs/decisions` vs. `docs/domain` example measured above) but does **not** give the project
that filed #1698 a config-level home for the specific check it lost. What changes for that
project is the refresh half: its hand-edited check is **held and reported** rather than
deleted (FR-7, FR-8), so the loss stops even though the check still lives in managed bytes
and still misses later template updates to that file while held. A sanctioned home for a
cross-field rule is CQ-4.

### Prior art this spec must reuse, not duplicate

- **`specsDir` / `decisionsDir` already exist** in `.minspec/config.json` and are consumed
  elsewhere in the extension. This spec must not introduce a second, parallel way to name the
  specs directory.
- **DR-090 (managed prose is judged from the consumer's vantage)** governs every comment this
  change writes into the template: the docstring currently asserts
  `docs/domain/*.md must have type: domain`, which is a fact about *this* repo, not about an
  adopter. Any corpus list that becomes configurable must stop being asserted as universal
  prose in the shipped file.
- **DR-037** owns the hook-scaffolding chain this validator sits in; the config read must not
  change the hook's detection or install contract.

### Why no new DR

The decision "extend by configuration, not by an unmanaged code region" is not novel here — it
is the existing posture of every managed template (bytes held identical by construction,
behaviour parameterised by `.minspec/config.json`). The corpus half applies that posture to one
file. If Clarify selects an unmanaged-code-region design instead (CQ-2 below), that **would**
need a DR, because a sanctioned edit point inside a managed file is a new and hard-to-reverse
public contract.

The refresh half applies two accepted decisions to a path they do not yet reach: DR-089 §2
("missing evidence fails closed") and DR-092's rule that a refresh must be able to show a write
is legitimate before making it. It needs no new DR **unless** CQ-5 chooses to store a per-region
digest in a file that ships into adopters' repos (option `h`): that adds a field to SPEC-068's
tracked `.minspec/harness-provenance.json`, and a tracked format is the kind of thing DR-089 §3
calls the part that cannot be undone. If `h` is chosen, Plan must amend DR-092 (or record a new
DR) before implementation — flagged here rather than minted now, because the choice is the
human's.

## Functional Requirements

### Corpus half

- **FR-1 (corpora come from config, with the current behaviour as the default).** `validate.py`
  MUST derive its validated corpora from `.minspec/config.json`. When the config is absent,
  unreadable, or declares nothing, it MUST validate exactly what it validates today, so an
  adopter who never opens the config sees no behaviour change. *Rationale: a gate that changes
  coverage on upgrade is the very fault this spec repairs; the default must be continuity.*

- **FR-2 (config parse failure fails CLOSED and visibly).** A malformed `.minspec/config.json`
  MUST cause a non-zero exit with a message naming the file and the parse error. It MUST NOT
  fall back to the default corpora silently. *Rationale: invariant 2 — the failure mode this
  spec exists to remove must not be reintroduced at the config-read step. A silent fallback
  would make a typo in the config look like a passing gate.*

- **FR-3 (Tier 0 — no new dependency, no network).** The config read MUST use only the Python
  standard library (`json`), and MUST NOT add a dependency, a subprocess, or any network call.
  *Rationale: this hook runs pre-commit on every developer machine; MinSpec's core works
  offline (invariant 1).*

- **FR-4 (declared corpora carry their own rule, not a hard-coded one).** Each configured
  corpus MUST carry the frontmatter requirement that applies to it, so a project can add a
  corpus without a code change teaching the validator what that corpus requires. The
  `specs` → `id: SPEC-NNN` and `docs/decisions` → `id: DR-NNN` rules MUST be expressible in
  the same form as any project-added rule, with no privileged built-in path.

- **FR-5 (the docstring stops asserting this repo's corpora).** The shipped file's header MUST
  describe the *mechanism* (corpora and their required frontmatter are read from
  `.minspec/config.json`) rather than listing `specs` and `docs/domain` as universal facts
  (DR-090). Any example MUST be marked as an example.

- **FR-6 (`--pre-commit` path unchanged in scope).** The staged-file path
  (`validate.py:89-90`) MUST apply the same configured rule set to staged files. A file is
  validated if and only if it falls under a configured corpus — so the two entry points can
  never disagree about what is in scope. *Rationale: a pre-commit gate that checks a different
  set than CI is two gates with one name.*

### Refresh half

These apply to **every** managed-region template in `MANAGED_REGION_TEMPLATES`, not only
`validate-py`: the mechanism that deleted the check is the same for all of them, and the
constitution's invariant 2 cares most about the ones that carry gates (hooks, CI workflows).

- **FR-7 (an edited region is detected).** Before replacing a managed region whose markers are
  intact, the refresh MUST establish whether the region's current body is what MinSpec last
  wrote there. A region whose body differs from MinSpec's last write is **edited**. Where the
  evidence of MinSpec's last write is absent or unreadable, the region MUST be treated as
  edited (DR-089 §2 — absence of evidence is not evidence of no edit). The source of that
  evidence is CQ-5. *Rationale: "the bytes differ from the template" cannot tell a template
  update from a project's edit; that conflation is the #1698 defect.*

- **FR-8 (an edited region is held, not written).** A region FR-7 finds edited MUST be left
  byte-identical on disk, and the refresh MUST emit a notice naming the file, stating that its
  managed region was edited and has been kept, and stating the standing consequence: while it
  is held, template updates to that file do not land. The notice MUST be informational — it
  must not route to the missing-markers "Re-scaffold (overwrite)" action (the #1697 F2 trap:
  `scaffold.ts:489-492`). *Rationale: holding without saying so is the same silent gate in the
  other direction — a file that quietly stops receiving fixes.*

- **FR-9 (every replacement is reported).** A region the refresh **does** replace MUST produce
  a notice naming the file and the size of the change (lines removed and added). A replacement
  that is byte-identical to the current region is not a replacement and produces no notice.
  *Rationale: the issue's second suggested fix; a replaced commit gate is something a human
  must be able to see from the command's output, not reconstruct from `git diff`.*

- **FR-10 (only a human overrides a hold, on a visible list).** The interactive command MAY
  offer to overwrite held regions, only after listing each held file and what would be dropped
  (the lines present in the edited region and absent from the template's). The auto-bootstrap
  refresh trigger MUST report the hold and write nothing, with no override reachable from it —
  the same rule SPEC-068 FR-6 sets for its own hold. *Rationale: a hold the background path can
  dismiss is not a hold.*

- **FR-11 (a hold does not silence itself).** When any region is held, the refresh MUST NOT
  record evidence that would make the held region read as "MinSpec's last write" on the next
  run — neither in whatever CQ-5 selects nor in `saveTemplateBaseline`
  (`scaffold.ts:1598`) for that entry. The next refresh must reach the same verdict until the
  region converges with the template or a human overrides it. Whether the notice itself
  repeats every refresh or fires once is CQ-7; the verdict never lapses either way. *Rationale: DR-092's fourth
  property — a refresh that re-stamps its own baseline erases the alarm it should have raised.*

- **FR-12 (the command says what it does).** The description of *MinSpec: Refresh Harness
  Files* (`template-registry.ts:256` and any other surface that carries the same sentence)
  MUST NOT claim to preserve edits for a class of file where it does not. After FR-7/FR-8 land
  the claim becomes true for managed regions in the "kept, not overwritten" sense, and the text
  MUST say that edited files are kept and reported rather than merged. *Rationale: the issue's
  fourth suggested fix; the old sentence is what led the reporting project to trust the
  command.*

- **FR-13 (creation and markers unchanged).** Re-scaffolding a missing managed file, the
  lossless marker auto-heal, and the missing-markers skip (`scaffold.ts:937-960`) keep their
  current behaviour. A freshly scaffolded region MUST record the evidence FR-7 reads, so a
  first refresh after init is not held.

- **FR-14 (Tier 0).** Detection, hold, and report make no network call and invoke no git
  command; the verdict is identical on an air-gapped machine (invariant 1).

## Acceptance Criteria

### Corpus half

- **AC-1.** With no `.minspec/config.json` present, the validator's exit code and reported
  errors are byte-identical to today's for a fixture corpus containing one valid and one
  invalid spec.
- **AC-2.** With a config declaring an additional corpus, a file in that corpus with missing
  required frontmatter causes a non-zero exit, and the message names the file.
- **AC-3.** With a config declaring a corpus the project does not have, the validator exits
  zero and does not error on the absent directory.
- **AC-4.** With a malformed config (truncated JSON), the validator exits non-zero and names
  the config file. It does NOT validate the default corpora and exit zero.
- **AC-5.** After *Refresh Harness Files* over a project whose config declares an extra
  corpus, that corpus is still validated — i.e. the #1698 scenario no longer loses coverage.
- **AC-6.** `--pre-commit` and the full-corpus run agree on scope for the same fixture: a
  staged file outside every configured corpus is skipped by both.

### Refresh half

- **AC-7 (the #1698 regression test — must fail against today's code).** Scaffold a project,
  add a check line inside `validate.py`'s managed region, run the refresh. The file is
  byte-identical afterwards, and the refresh's returned notices include one naming
  `.minspec/hooks/validate.py` as edited-and-kept. Against today's `scaffold.ts:963-968` this
  test fails on both assertions: the line is removed and no notice is returned.
- **AC-8 (control — an unedited region still updates, and says so).** Same fixture with no
  edit, but with the evidence of MinSpec's last write set to an older template body (a template
  update). The region is replaced with the current template, and a notice names the file with
  its removed/added line counts. Without this control AC-7 could pass by a refresh that never
  writes anything.
- **AC-9 (control — nothing to do, nothing said).** Unedited region, template unchanged: no
  write (file mtime and bytes unchanged) and no notice for that file.
- **AC-10 (absent evidence holds).** An intact-marker region with no recorded evidence of
  MinSpec's last write and a body that differs from the current template is held and reported,
  not written. (FR-7's fail-closed clause.)
- **AC-11 (the background path cannot override).** The auto-bootstrap refresh over the AC-7
  fixture writes nothing and offers no overwrite action.
- **AC-12 (a hold is stable).** Running the refresh twice over the AC-7 fixture leaves the file
  byte-identical both times and the second run still classifies the region as edited (FR-11).
- **AC-13 (every managed-region template, not just this one).** AC-7 is parameterised over
  every entry in `MANAGED_REGION_TEMPLATES` whose condition the fixture satisfies, so a
  template added later is covered without a new test.
- **AC-14 (the description is true).** The command description text no longer contains
  "preserving your edits" unqualified, and states that edited managed files are kept and
  reported.

## Invariants

- **INV-1 (no silent narrowing).** No code path may reduce the set of validated corpora
  without a non-zero exit or an explicit configured instruction. Coverage may shrink only
  because the project said so.
- **INV-2 (managed bytes stay identical).** The file remains fully managed. This spec does NOT
  introduce an unmanaged region inside it; the extension surface is the config file, which
  refresh does not own.
- **INV-3 (offline, Tier 0).** No dependency beyond the Python standard library.
- **INV-4 (one owner per file).** This spec owns only its two new tests; `template-registry.ts`
  and `scaffold.ts` stay `affects:`, consistent with SPEC-066, SPEC-063 and SPEC-068.
- **INV-5 (a refresh never removes project content without a human seeing it first).** No
  path — interactive, auto-bootstrap, or init — may replace an edited managed region without
  the FR-10 listing and an explicit human confirmation.
- **INV-6 (additive to the existing refresh gates).** The FR-7 check is in addition to
  DR-089's authorship rule and SPEC-068's direction gate. A write must pass all that apply;
  passing this one alone never licenses a write the others hold.
- **INV-7 (blast radius).** Nothing here changes behaviour in a repo without `.minspec/`
  (constitution invariant 3).

## Decisions needed (Clarify)

### CQ-1 (shape) — how the corpora are expressed in config

- **`a` — a `validatedCorpora` map of path → required frontmatter key/pattern (rec).**
  Reuses `specsDir`/`decisionsDir` as the defaults that seed it, and satisfies FR-4 with no
  privileged built-in path.
  **Cost:** it introduces a second place the specs directory can be named, so
  `specsDir: specs` plus a corpus entry for `specs` can disagree. The plan must define which
  wins and assert it in a test, or the config becomes its own drift surface — the exact class
  of fault this spec is repairing one level up.
- **`b` — reuse only the existing `specsDir`/`decisionsDir` keys, no new key.**
  Smallest change, zero new config surface.
  **Cost:** it cannot express a *third* corpus, so this repo's own `docs/domain` still has
  nowhere to live and #1698 stays open for the case that filed it.

### CQ-2 (shape, needs a DR if chosen) — an unmanaged region instead of config

- **`c` — a sanctioned unmanaged region inside `validate.py`** (e.g. a clearly marked
  project-rules block the refresh preserves).
  **Cost:** it makes an edit point inside a managed file a public contract that cannot be
  withdrawn without breaking adopters, and it reintroduces the merge problem managed regions
  exist to avoid. Recommended **against**; recorded because #1698's wording ("no sanctioned
  extension point") invites it — its first suggested fix is exactly this — and rejecting it
  deliberately is worth more than not considering it. The issue argues that without a project
  region, reporting alone "only converts silent loss into a recurring warning the author cannot
  act on". The refresh half answers that differently: an edited region is **kept** (FR-8), not
  lost and then warned about, so the author's check survives; what the author gives up is
  template updates to that one file while it is held, which is visible (FR-8, FR-11).
  **Cost of rejecting `c`:** a project whose check cannot be expressed as config (CQ-4) keeps it
  in held managed bytes, and must reconcile by hand each time the template for that file
  changes.

### CQ-3 (scope) — does this spec reconcile this repo's own drift

- **`d` — no, out of scope (rec).** This spec makes the corpora configurable; setting this
  repo's config to declare `docs/domain` and `docs/decisions` is a follow-up.
  **Cost:** the #1888 waiver for `validate.py` stays open after this spec lands, so the drift
  remains visible-but-unfixed and someone must remember to close it. Mitigated by the waiver
  self-retiring: it asserts the path still drifts, so it cannot be quietly forgotten.
- **`e` — yes, reconcile in the same change.** Closes the waiver too.
  **Cost:** it couples a template change to editing this repo's own hook, and the two have
  different review stakes — a wrong template ships to every adopter.

### CQ-4 (scope) — does this spec need to cover cross-field checks, or is that a follow-on

- **`f` — out of scope for this spec; file a follow-on (rec).** This spec closes the
  corpus-list drift class only. A cross-field predicate (frontmatter value vs. a body line, as
  in the #1698 incident itself) needs a small expression grammar that FR-4's
  `key → pattern` map cannot carry, and "Why no new DR" above already frames this spec as
  *applying* the existing managed/config posture, not inventing a rule language — expanding
  FR-4 to cross-field predicates mid-spec would contradict that framing.
  **Cost:** the literal incident that triggered #1698 remains unaddressed until the follow-on
  ships, and #1698 should stay open (or a new issue opened and linked) rather than closed by
  this spec alone — leaving that connection unfiled would be the prose-only-leak this repo's
  own conventions warn against (DR-023's forward rule: file the issue for any follow-up a spec
  surfaces). **This spec cannot file that issue itself** (Specify-phase, no network/`gh`
  access) — a human must file it, or confirm #1698 stays open past this spec's landing to
  track it, before this spec is treated as closing #1698's full scope.
- **`g` — extend FR-4 now to a small cross-field expression grammar.**
  **Cost:** turns `.minspec/config.json` into a mini rule language inside a T3 spec already
  justified as a repair, not a feature; harder to keep obviously Tier-0/offline-safe and
  reviewable; blocks this spec's (already-narrower, already-evidenced) corpus-drift fix on
  designing that grammar.

### CQ-5 (shape, may need a DR amendment) — where the evidence of "MinSpec's last write" lives

FR-7 needs to know what MinSpec last wrote into each region. Today nothing records it
(`scaffold.ts:917`). When the running bundle's template equals the one that last wrote the
region (SPEC-068's `level` verdict), the current template **is** that evidence and no record is
needed. When the template has changed since (`ahead`), it is not, and something must remember
the old body's digest.

- **`h` — a per-region digest in SPEC-068's tracked `.minspec/harness-provenance.json` (rec).**
  Travels with the repo, so a fresh clone, a worktree and CI reach the same verdict. Changes
  only when a template changes, which is when SPEC-068 already rewrites that file, so it adds
  no new merge-conflict surface beyond DR-092's.
  **Cost:** makes this spec depend on SPEC-068, which is `planning` and not built — the refresh
  half cannot ship before it. It also adds a field to a tracked format that ships into adopters'
  repos, which Plan must record by amending DR-092 (see "Why no new DR").
- **`i` — a per-region entry in the machine-local `.minspec/generated-hashes.json`**, the
  DR-089 manifest.
  **Cost:** that file is gitignored and absent on every fresh clone, worktree and CI checkout
  (DR-089 Context §1). With FR-7's fail-closed rule, every refresh on a fresh checkout would
  hold **every** managed region whose template changed — the exact recurring-warning fatigue
  DR-089 rejected. The only way to avoid that is to fail open on absence, which is the #1697
  defect.
- **`j` — no record; detect only at `level`, report-only at `ahead`.** Hold a region only when
  it differs from the unchanged template; when the template has changed, write and report
  (FR-9).
  **Cost:** an edit made before a template update is still overwritten by that update — the
  loss is now reported rather than silent, but it still happens, which falls short of the
  issue's third suggested fix ("detect divergence and refuse").

### CQ-6 (scope) — one spec or two

- **`k` — keep both halves in this spec (rec).** They share one incident, one file and one
  acceptance scenario (AC-5 and AC-7 are the same refresh, seen from each half), and splitting
  would put two `affects:` claims on `template-registry.ts` for one issue.
  **Cost:** the corpus half is independent of SPEC-068 and could ship now; under `h` it waits
  for the refresh half's dependency unless Plan sequences the corpus half first. Plan must
  state that order explicitly.
- **`l` — split the refresh half into its own spec**, leaving SPEC-075 as the corpus half only.
  **Cost:** a second spec id and a second human read for one issue, and the corpus half
  shipping alone repeats the #1698 loss for any edit the config cannot express (CQ-4) until the
  second spec lands.

### CQ-7 (UX) — does a standing hold notify on every refresh, or once

- **`n` — once per distinct held body, then silent until that body changes (rec).** Matches
  DR-089 §1's resolution of the same question for section-merge files ("the report falls silent
  after one refresh instead of nagging forever"). The hold itself stays observable through the
  drift signal (FR-11), so silence in the notice is not silence in the state.
  **Cost:** needs one more stored fact — the digest of the held body already announced — and a
  reader who dismissed the one notice unread learns of the hold only from the drift indicator.
- **`o` — every refresh.**
  **Cost:** a project that deliberately keeps an edited `validate.py` (the #1698 project, if
  CQ-4 is `f`) sees the same notice on every refresh indefinitely; notices that never change get
  dismissed unread, which is the no-silent-gate failure wearing different clothes (DR-089,
  alternatives rejected).

## Test

T0, refresh half (owned by this spec, **write first** — it is the #1698 regression test):
`packages/minspec/tests/managed-region-edit-hold.test.ts` — drives the real
`refreshHarnessFiles` over scaffolded fixture projects for AC-7 to AC-13. AC-7 must be shown
**red against the pre-fix code** before any implementation, and AC-8/AC-9 are its controls: a
refresh that never writes passes AC-7 and fails AC-8; a refresh that always writes fails AC-7.
Neither shape can make the suite green.

T0, corpus half (owned by this spec): `packages/minspec/tests/validate-py-corpus-config.test.ts` — drives
the real `VALIDATE_PY` template against fixture repos, one per acceptance criterion, asserting
exit codes and messages. It must include a **control** in which the configured corpus is
absent from the fixture, so the suite cannot pass by never finding any file to validate — the
vacuous-pass shape a coverage-shrinking gate produces by construction.
