---
id: SPEC-263
type: requirements
status: planning
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a refresh that replaces a commit gate and says nothing is a false signpost
aspects: [harness, managed-files, refresh, gate, no-silent-gate, tier-0, downstream]
depends_on: []
relates_to: ["#2615", "#1698", "#2303", "#2391", "#1697", DR-037, DR-066, DR-089, DR-092, SPEC-043, SPEC-068, SPEC-075]
implements: [packages/minspec/tests/managed-region-edit-hold.test.ts]  # NEW - the T0 this spec owns (the #1698 regression test and its two controls)
affects: [packages/minspec/src/lib/scaffold.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/merge-refresh.ts, packages/minspec/src/commands/init.ts]  # scaffold.ts is OWNED by SPEC-043 (harness refresh manifest consistency, specs/minspec/SPEC-043-harness-refresh-manifest-consistency/requirements.md:12); this spec only affects it. One owner per file.
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-263: Refresh never silently replaces an edited managed region - it holds the edit and says so, and reports every region it does replace

> **This is a SPECIFICATION ONLY.** No code, template, or test is created by this document.
> It is the Specify-phase artifact for #2615 (the refresh half of #1698, *harness refresh
> silently deletes a project's commit gate*), triaged `T3` (full spec cycle) ·
> `role:architect`. Nothing is built until a human reads it, answers
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.

## In plain terms

*MinSpec: Refresh Harness Files* rewrites the MinSpec-owned part (the "managed region") of
files like `.minspec/hooks/validate.py`, the CI workflow and the git hooks. Today, if a
project edited inside that region, the refresh overwrites the edit and reports nothing.
That is how #1698's project lost a commit-gate check. This spec makes the refresh tell a
template update apart from a project edit, keep the edit (and say so), and report every
region it does replace, with a line count.

**What you are approving**, and what it costs:

- An edited region is **kept**, so a held file stops receiving template updates until a
  human resolves it. That is the price of never deleting a project's lines unseen.
- Every replaced region is **reported**, so a refresh that today says nothing will list
  each managed file it rewrote.
- Three questions are yours (D1 to D3 below). Each carries a recommendation and its cost.

This spec is split out of SPEC-075 (the managed validator reads its corpora from config) on
purpose: SPEC-075's approval is bound to its text, and writing this half into it a second
time would stale that approval (#2615, "Caution"). SPEC-075's text is not touched here.

## Measured state (read at `e2aeff77`)

The issue was written at `901fea36`; every citation below was re-read at `e2aeff77`.

| Claim | Evidence |
|---|---|
| The refresh splices the current template into an intact-marker region and writes whenever the bytes differ | `refreshManagedRegionTemplates`, `packages/minspec/src/lib/scaffold.ts:1207`; the write is `:1273-1278` |
| Its design says no baseline is consulted | docstring, `scaffold.ts:1194-1197` |
| It returns notices only for files it left untouched or whose index mode it fixed | `scaffold.ts:1199-1201`, `:1209-1216`, `:1269`; a replaced region pushes nothing |
| No notice kind means "replaced" or "held" | `ManagedRegionWarning.kind`, `scaffold.ts:667-672` - **five** members now (`exec-bit-recorded` was added after the issue counted four), none of them either |
| The command promises to preserve edits | `packages/minspec/src/lib/template-registry.ts:264`: "Re-merge harness templates, preserving your edits." True of section-merged Markdown, false of a managed region |
| A per-region digest of MinSpec's block already exists, machine-local | `computeTemplateBaseline` records `hashSection(renderManagedBlock(tpl))` for every managed-region output path (`template-registry.ts:882-884`) into `.minspec/template-baseline.json`, which is gitignored (`scaffold.ts:301`) |
| That digest is re-stamped unconditionally, before the region pass runs | `saveTemplateBaseline(rootDir, computeTemplateBaseline())` at `scaffold.ts:1965`; the region pass is `:1973` |
| An unrecognised notice kind is routed to an overwrite action | the surfacing layer offers `Re-scaffold (overwrite)` (`packages/minspec/src/commands/init.ts:1359`) for the default `missing-markers` branch (`:1436`, `:1474`) - the #1697 F2 trap |
| The background prompt runs the same command | the auto-bootstrap `refresh` prompt invokes `minspec.initRefresh` (`packages/minspec/src/lib/auto-bootstrap.ts:644-658`) |
| SPEC-068's provenance record does not exist | `packages/minspec/src/lib/harness-provenance.ts` is absent; SPEC-068 is `status: planning` (`specs/minspec/SPEC-068-harness-refresh-direction-gate/requirements.md:4`) |

Because today's refresh always writes the current block, the digest in
`template-baseline.json` today equals what MinSpec last wrote into each region on that
machine. That stops being true the moment a refresh holds a region, because `:1965`
re-stamps it anyway. This is why FR-5 exists, and why D1's option `b` costs no migration.

## Root cause (mechanism)

1. **Mechanism.** The refresh decides to write by comparing the region on disk with the
   *current* template (`scaffold.ts:1276`). That comparison cannot tell "the template moved"
   from "the project edited", so it treats both as "bring current". The #1698 project's
   added check was the second case and was written over (`97a14a7`, `0703f9a`, both
   `-28 / +1`, per #1698).
2. **Missing gate.** Nothing compares the region with what MinSpec *last wrote* there, and
   no notice is emitted for a replacement, so neither the command nor the human sees the
   loss. DR-089 (manifest records authorship, accepted) closed the same hole for
   section-merged files and does not reach this path; SPEC-068 (direction gate, `planning`)
   holds only a refresh whose bundle is *older*, and lets a `level` refresh - #1698's case -
   "write as today" (SPEC-068 FR-4).
3. **The false signpost.** The command description (`template-registry.ts:264`) told the
   project its edits would be preserved.

## Functional requirements

These apply to **every** entry in `MANAGED_REGION_TEMPLATES` whose condition holds, not only
`validate-py`: the mechanism is shared, and the templates that carry gates (hooks, CI
workflows) are the ones invariant 2 cares about most.

- **FR-1 (an edited region is detected).** Before replacing an intact-marker region whose
  body differs from the current template's block, the refresh MUST establish whether the body
  is what MinSpec last wrote there (the "last-write record", stored where D1 decides). A body
  that differs from the last-write record is **edited**. A missing, unreadable, or
  unrecognised record for that region MUST be treated as edited (DR-089 §2: absence of
  evidence is not evidence of no edit). The comparison MUST be insensitive to the line-ending
  rewrite the refresh itself performs (SPEC-095 FR-5(c), `scaffold.ts:1253-1256`), so a
  CRLF checkout of an unedited file is not read as edited.

- **FR-2 (an edited region is held).** A region FR-1 finds edited MUST be left byte-identical
  on disk. The refresh MUST return a notice of a new kind (working name `held-edited`) naming
  the file, saying its managed region was edited and has been kept, and saying the standing
  consequence: while held, template updates to that file do not land. The notice MUST be
  surfaced informationally and MUST NOT route to the `missing-markers` "Re-scaffold
  (overwrite)" action (`init.ts:1359`, the #1697 F2 trap).

- **FR-3 (every replacement is reported).** A region the refresh does replace MUST produce a
  notice of a new kind (working name `replaced`) naming the file and the size of the change
  (lines removed, lines added). A region whose bytes are unchanged by the refresh produces no
  notice. When several regions are replaced in one refresh, Plan MAY aggregate them into one
  notice listing each file and its counts, following #1697 F3 (`scaffold.ts:625-634`).

- **FR-4 (only a human overrides a hold, on a visible list).** The interactive command MAY
  offer to overwrite held regions, only after listing each held file and the lines that would
  be dropped (present in the edited region, absent from the template's block). The override
  MUST be a separate explicit confirmation, never a default, and never taken by the single
  "Refresh" click on the auto-bootstrap prompt (`auto-bootstrap.ts:651-653`): from that path
  the refresh reports the hold and writes nothing to held regions. This mirrors SPEC-068 FR-6.

- **FR-5 (a hold does not silence itself).** For a held region the refresh MUST NOT record
  anything that would make the held body read as MinSpec's last write on the next run: not in
  the last-write record, and not in `.minspec/template-baseline.json` for that output path
  (today re-stamped unconditionally at `scaffold.ts:1965`). The next refresh MUST reach the
  same verdict until the region equals the template's block or a human overrides. Whether the
  *notice* repeats is D2; the *verdict* never lapses. (DR-092 §5 states the same rule for its
  own hold.)

- **FR-6 (a write records the write).** Every path that writes a managed region - initial
  scaffold, re-scaffold of a deleted file (`scaffold.ts:1226-1230`), the lossless marker
  auto-heal (`:1262-1266`), a refresh replacement, and an accepted override - MUST leave the
  last-write record equal to the block it wrote, so the first refresh after any of them is not
  held.

- **FR-7 (the command says what it does).** The description at `template-registry.ts:264`,
  and every other surface carrying the same sentence, MUST NOT claim that edits are merged or
  preserved for managed regions. It MUST say that edited managed files are kept and reported,
  and that every replaced file is listed.

- **FR-8 (unchanged paths stay unchanged).** The missing-markers skip-and-warn
  (`scaffold.ts:1267-1270`), the executable-bit self-heal (`:1232-1247`), and the tool-gated
  skip (`:1222`) keep their current behaviour.

- **FR-9 (Tier 0).** Detection, hold, report and override make no network call and invoke no
  git command beyond those the refresh already makes; the verdict is the same on an
  air-gapped machine (invariant 1).

## Acceptance criteria

- **AC-1 (the #1698 regression test - must fail against today's code).** Scaffold a project,
  add one check line inside `validate.py`'s managed region, run the refresh. The file is
  byte-identical afterwards, and the returned notices include a `held-edited` notice naming
  `.minspec/hooks/validate.py`. Against `scaffold.ts:1273-1278` at `e2aeff77` it fails both
  assertions: the line is removed and no notice is returned.
- **AC-2 (control - an unedited region still updates, and says so).** Same fixture, no edit,
  with the last-write record and the region body set to an older template block (a template
  update). The region is replaced with the current block, and a `replaced` notice names the
  file with its removed/added counts. A refresh that never writes passes AC-1 and fails this.
- **AC-3 (control - nothing to do, nothing said).** Unedited region, template unchanged: file
  bytes and mtime unchanged, no notice for that file. A refresh that always reports fails this.
- **AC-4 (absent record holds).** Intact-marker region, no last-write record, body differs from
  the current block: held and reported, not written (FR-1 fail-closed clause).
- **AC-5 (the background prompt cannot override).** The refresh run from the auto-bootstrap
  prompt over the AC-1 fixture leaves the file byte-identical and offers no overwrite action.
- **AC-6 (a hold is stable).** Two refreshes over the AC-1 fixture: the file is byte-identical
  both times, the second run still classifies the region as edited, and the
  `template-baseline.json` entry for that path is not the current block's digest (FR-5).
- **AC-7 (a write records the write).** After init, after re-scaffold of a deleted managed file,
  after a marker auto-heal, and after an accepted override, the next refresh classifies the
  region as unedited (FR-6).
- **AC-8 (every template, not just one).** AC-1 to AC-3 are parameterised over every entry in
  `MANAGED_REGION_TEMPLATES` whose condition the fixture satisfies, so a template added later is
  covered with no new test.
- **AC-9 (line endings).** An unedited region checked out with CRLF endings, on a path not
  LF-pinned, is classified unedited (FR-1).
- **AC-10 (no overwrite routing).** Neither new notice kind is surfaced with the
  `Re-scaffold (overwrite)` action (FR-2).
- **AC-11 (the description is true).** The command description no longer contains
  "preserving your edits" unqualified, and states that edited managed files are kept and
  reported (FR-7).

## Invariants this change must not break

- **INV-1 (no unseen removal).** No path - interactive refresh, auto-bootstrap prompt, init -
  replaces an edited managed region without the FR-4 listing and an explicit human
  confirmation.
- **INV-2 (additive to existing gates).** This check is in addition to DR-089's authorship rule
  (section-merged files) and SPEC-068's direction gate once built. A write must pass every gate
  that applies; passing this one never licenses a write another holds.
- **INV-3 (no silent gate - constitution invariant 2).** A hold is always reported, and its
  verdict persists until resolved (FR-5). A missing or unreadable record fails closed, visibly.
- **INV-4 (blast radius - constitution invariant 3).** Nothing here changes behaviour in a
  repository without `.minspec/`; `refreshHarnessFiles` already refuses there
  (`assertOptedIn`, `scaffold.ts:1824`).
- **INV-5 (offline - constitution invariant 1).** FR-9.
- **INV-6 (one owner per file).** This spec owns only its new test. `scaffold.ts` stays SPEC-043's;
  `template-registry.ts`, `merge-refresh.ts` and `init.ts` are `affects:` only.

## Out of scope

- **The corpus half of #1698** - SPEC-075 (validator reads corpora from config). Not edited here.
- **Cross-field checks expressed in config** (SPEC-075 CQ-4, recorded out of scope there).
- **Section-merged Markdown files** - DR-089 already holds an edit there.
- **Direction (older bundle over newer repo)** - SPEC-068.

## Decisions needed (Clarify)

All 3 decisions are answered, not ratified: an agent session selected, for each, the option this
document already recommended. No human chose them, and no delegation covers authoring Clarify
answers (DLG-001, DR-108, covers spec approval and engineering-DR acceptance only). This spec is
unapproved, so these answers bind nothing until a human or a covered delegation approves it.

- **D1 - Recorded selection: Option `b`,** the existing per-region entry in machine-local
  `.minspec/template-baseline.json`; held entries are no longer re-stamped (FR-5).
- **D2 - Recorded selection: Option `d`,** one aggregated notice listing all held files on every
  refresh a human runs.
- **D3 - Recorded selection: Option `f`,** this spec stops the loss; a sanctioned home for a project
  rule config cannot express stays separate work, tracked by #1698 (harness refresh deletes a
  project's commit gate, no sanctioned extension point), which this spec does not close.

Agent recommendations below are proposals; no human has chosen any of them. Approving this
spec with a recommendation in place accepts it.

### D1 (shape, possibly irreversible) - where the last-write record lives

*Draft CQ-5 of #2303.* FR-1 needs, per region, the digest of what MinSpec last wrote.

- **`a` - a per-region digest in SPEC-068's tracked `.minspec/harness-provenance.json`.**
  Travels with the repository, so a fresh clone, a worktree and CI reach the same verdict.
  **Cost:** this spec cannot ship before SPEC-068, which is `planning` with no code
  (`harness-provenance.ts` absent). It adds a field to a tracked format that reaches adopters'
  repositories and cannot be withdrawn once shipped, so Plan must amend DR-092 (harness
  provenance, accepted) first. It also changes the tracked file whenever any region is written,
  weakening DR-092 §3's argument that the file moves "only when the template corpus changes".
- **`b` - the existing per-region entry in machine-local `.minspec/template-baseline.json`
  (rec).** It already stores `hashSection(renderManagedBlock(tpl))` per region
  (`template-registry.ts:882-884`); today that equals MinSpec's last write on that machine, so
  existing installs migrate for free. The change is to stop re-stamping held entries (FR-5).
  Gitignored, so reversible within a day and needs no DR; no dependency on SPEC-068; a later
  move to `a` stays open.
  **Cost:** the file is absent on a fresh clone, a new worktree and CI. On such a checkout,
  any region whose body differs from the current template is held (FR-1 fail-closed) until a
  human overrides once, even when the difference is only a template update. It also couples the
  last-write record to the drift prompt (`hasHarnessDrift`, `auto-bootstrap.ts:105`), so a held
  region keeps that prompt eligible (see D2).
- **`c` - no record: hold only when the template is unchanged since the last refresh; when it
  has changed, write and report (FR-3).**
  **Cost:** an edit made before a template update is still overwritten by that update -
  reported now, but lost. Falls short of #1698's third suggested fix ("detect and refuse").

### D2 (UX) - does a standing hold notify on every refresh, or once

*Draft CQ-7 of #2303.*

- **`d` - on every refresh a human runs, as one aggregated notice listing all held files
  (rec).** A refresh runs only when someone asks for it (the command, or a click on the
  prompt), so the notice answers their action rather than nagging; it needs no stored
  "already announced" fact.
  **Cost:** departs from the precedent DR-089 §1 and #1697 set for section-merged files
  ("falls silent after one refresh"), and a project that deliberately keeps an edit sees the
  same notice on every refresh until D3 gives it a home.
- **`e` - once per distinct held body, then silent until that body changes.** Matches DR-089 §1.
  **Cost:** one more stored fact per region (the announced body's digest), and a reader who
  dismissed the one notice learns of the hold only from the drift prompt - which they may also
  have dismissed (its signature suppression, `auto-bootstrap.ts:655-658`).

### D3 (scope) - does a project rule that config cannot express get a sanctioned home here

*Draft CQ-4 of #2303; #1698's first suggested fix.* The check #1698 lost compares a decision
record's frontmatter `status:` with its body's `- **Status:**` line; SPEC-075's
`validatedCorpora` map cannot express a comparison between two places (SPEC-075 CQ-4). This
spec keeps such a check alive by holding it; it does not give it a home outside managed bytes.

- **`f` - no; this spec stops the loss, and a home is a separate follow-up (rec).**
  Keeps this spec to the refresh mechanism (triage rule 2: no silent scope expansion).
  **Cost:** #1698's project keeps its check inside held bytes, so `validate.py` receives no
  template updates there - gate fixes included - until it gives the check up. #1698 cannot be
  fully closed by this spec; the follow-up must be filed when this decision is taken (Specify
  dispatch cannot file it).
- **`g` - yes; add a project-owned companion file (for example `.minspec/hooks/validate.local.py`)
  that the managed `validate.py` runs when present, outside any managed region.**
  **Cost:** a new public contract adopters will build on and that cannot be withdrawn, so it
  needs a decision record (it cannot be undone in under a day); it widens this spec into SPEC-075's file and
  template; and SPEC-075 CQ-2 rejected the in-file variant of the same idea.
- **`h` - yes; an unmanaged block inside `validate.py`.** **Cost:** SPEC-075 CQ-2 already
  recorded this as rejected; choosing it here reverses that and needs a DR.

## Follow-ups (tracked)

- D3 `f` → a follow-up issue for a sanctioned home for project rules config cannot express;
  to be filed when D3 is answered (this dispatch has no network access).
- #1698 stays open until this spec and SPEC-075 are both built (and D3's follow-up if `f`).
- #2391 (stale config-blind measurement) - not repeated here; this spec makes no claim about
  `validate.py` reading config.

## Test

T0 (owned by this spec, written first): `packages/minspec/tests/managed-region-edit-hold.test.ts`
drives the real `refreshHarnessFiles` over scaffolded fixture projects for AC-1 to AC-10. AC-1
must be shown red against the pre-fix code before any implementation. AC-2 and AC-3 are its
controls: a refresh that never writes passes AC-1 and fails AC-2; a refresh that always writes
or always reports fails AC-1 or AC-3. Neither shape can make the suite green.
