---
id: SPEC-244
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a canonical project list that is trusted rather than computed makes a missing project read as "no such project"
aspects: [portfolio, workspace, coverage, reconciliation, silent-gate, blast-radius, offline, dev-tooling]
depends_on: []
relates_to: ["#2179", "#2173", SPEC-228]
implements: none
implements_reason: >-
  Specify phase only. Where the reconciler lives (this repo's scripts/, the founder's
  ~/.claude scripts, or the product) is Decision D1; ownership is declared at Plan.
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-244: The founder's project index is reconciled against the repositories that actually carry `.minspec/`, so a missing project is a visible discrepancy, not silence

> **This is a SPECIFICATION ONLY.** Written for issue #2179 (voip-sms-inbox absent from every
> canonical index). Nothing is built until a human reads it, resolves
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it.
> No decision record: every choice here is reversible in under a day (the global register's ADR filter).

## In plain terms

The founder's projects are listed in VS Code workspace files under `~/code/` and in prose
repo-mapping tables in `CLAUDE.md`. Sessions route from those lists. Nothing compares the
lists to the repositories that really exist, so a project left off a list is invisible and
nothing errors. This spec adds one read-only check: enumerate local checkouts that carry a
`.minspec/` marker, compare that set with the claimed list, and print every difference.

Sibling in shape to #2173 (a coverage claim trusted rather than computed) and to SPEC-228
(a parity witness whose file list is hand-maintained instead of enumerated).

## Root-cause diagnosis (measured 2026-10-27, live container)

- **Mechanism.** The project list is hand-maintained in three JSONC files
  (`~/code/mmo.code-workspace`, `~/code/forge.code-workspace`,
  `~/code/minspecpro.code-workspace`) and in prose tables (this repo's `CLAUDE.md`
  "Repo Mapping (Parking Lot)", and the global `~/.claude/CLAUDE.md` "Repo Mapping").
  None of these has a producer to compare against.
- **Missing gate.** No check enumerates the real repositories. A project absent from every
  list cannot be seen by any session, and absence looks exactly like "no such project".
- **The instance from the issue is already patched as data only.** `~/code/mmo.code-workspace`
  now lists `{ "name": "VoIP SMS Inbox", "path": "voip-sms-inbox" }`. `~/code` is not a git
  repository, so who added it and when cannot be read. Neither repo-mapping table names
  voip-sms-inbox. Per the RCDD rule, a data fix without the gate leaves the defect live:
- **The defect is still live for other projects.** 19 directories directly under `~/code/`
  carry `.minspec/`. The three workspace files together name 9 of them (MinSpecPro,
  mmo-contracts, LeadForge, ColdForge, PlotLead, HireLoop, scroogellm, sealbox,
  voip-sms-inbox). The other 10 are in no workspace file: AIClarity, FiverrGigmeister,
  MeetLoop, PERP, plotlead, Polymarket, SourceBridge, SpotifyMegaPlaylists, memory-fabric,
  veilix. **memory-fabric is a named portfolio project (paused, not parked) and is in no
  workspace file**, so the same failure is live for it today.
- **A second, quieter discrepancy.** `PlotLead` and `plotlead` both exist and both carry
  `.minspec/`; only `PlotLead` is listed. A case-only duplicate is a likely stale clone, and a
  reconciler keyed on a case-insensitive name would hide it. (Whether they are the same
  repository was not checked.)
- **Format trap.** `mmo.code-workspace` contains `/* … */` comments and a trailing comma. A
  strict `JSON.parse` fails on it. A reconciler that swallowed that failure would report zero
  workspace folders and flag every project, or report nothing; either is a silent gate.

## Functional requirements

**FR-1. Enumerate the actual set.** Scan the configured root (default `~/code`, one level
deep) and collect every directory whose root contains a `.minspec/` directory. Record the
path as found on disk (case preserved) and, where present, `remote.origin.url` read from the
local git config. No network call; a repository that exists only on the forge is out of
scope (see Limitations).

**FR-2. Read the claimed set.** Parse the canonical list chosen in D2. Workspace files are
JSONC: comments and trailing commas MUST parse. Relative `path` entries resolve against the
workspace file's directory; absolute ones are taken as-is.

**FR-3. Reconcile both directions.** Report:
- (a) **unlisted**: a `.minspec/` repository in no claimed list and not in the exclusion set (D3);
- (b) **dangling**: a claimed path that does not exist on disk;
- (c) **case-collision**: two enumerated paths that differ only by letter case;
- (d) **stale exclusion**: an exclusion-set entry whose path no longer exists or is now listed.

A claimed folder that exists but has no `.minspec/` is NOT a discrepancy (pre-MinSpec frozen
projects are listed on purpose).

**FR-4. Deliberate omission is recorded, not inferred.** A `.minspec/` repository is kept off
the workspace lists only by an explicit entry in an exclusion set, each entry carrying a
one-line reason (shape decided in D3). Absence alone is never treated as "parked".

**FR-5. Visible, never silent.** Output names every discrepancy with its category and path,
and a final count line. Exit status: 0 only when the count is 0; non-zero otherwise. Any
failure to read the scan root, read or parse a list file, or read the exclusion set is
reported by name with a distinct non-zero exit and is never rendered as "0 discrepancies".

**FR-6. Read-only.** The check writes nothing: not the workspace files, not any `CLAUDE.md`,
not any scanned repository. Fixing a discrepancy is a human (or separate session) act.

**FR-7. Surfaced where sessions start (subject to D4).** The discrepancy count and names
appear in the chosen surface without the founder having to run anything.

**FR-8. One-time data fix for this repo's table.** This repo's `CLAUDE.md` "Repo Mapping
(Parking Lot)" table gains a row for voip-sms-inbox
(`AIClarityAU/voip-sms-inbox`, private, `~/code/voip-sms-inbox`). The global
`~/.claude/CLAUDE.md` table is outside this repository and is a follow-up (see Follow-ups).

## Limitations (stated, not hidden)

- Only local checkouts are seen. Enumerating the forge org needs the network (invariant 1)
  and is out of scope; a priority repository never cloned locally stays invisible to this check.
- Prose repo-mapping tables are not parsed (D5). Their coverage is not computed by this spec.

## Invariants (must not break)

1. **Offline** - no network call (constitution invariant 1). `remote.origin.url` is read from
   local git config only; no fetch, no `ls-remote`, no forge API.
2. **No silent gate** (invariant 2) - parse or read failure fails visibly with a non-zero
   exit; no `|| true` on any line that produces the count.
3. **Blast radius** (invariant 3) - the check only reads. It reads workspace files and
   directories in repos that did not opt in, and changes nothing in any of them. If D1
   selects the product, it must stay inert in a repo without `.minspec/`.
4. Existing SessionStart hook output and exit behaviour are unchanged except for the added
   lines (if D4 selects the hook); a reconciler error must not block session start.

## Acceptance criteria

- AC-1: Fixture root with repos A, B, C carrying `.minspec/` and a workspace file listing A
  and B: output reports C as **unlisted**, count 1, exit non-zero.
- AC-2: Same fixture with C in the exclusion set (with reason): count 0, exit 0.
- AC-3: Workspace file with `/* */` and `//` comments and a trailing comma parses; its
  folders count as listed. (Regression for the `mmo.code-workspace` shape.)
- AC-4: Workspace file that is genuinely malformed: output names the file and the parse
  error, exit code is the distinct error code, and no "0 discrepancies" line is printed.
- AC-5: Workspace entry pointing at a missing directory is reported **dangling**.
- AC-6: Listed folder that exists without `.minspec/` is not reported.
- AC-7: Fixture with `Proj` and `proj` both carrying `.minspec/` reports **case-collision**.
- AC-8: Exclusion entry for a deleted path, or for a path also listed, is reported
  **stale exclusion**.
- AC-9: Absolute workspace path (e.g. `/home/x/.claude`) resolves as-is; relative path
  resolves against the workspace file's directory.
- AC-10: A test asserts no network primitive is reachable from the check (no fetch,
  `ls-remote`, or forge CLI call), and that no file mtime under the fixture root changes.
- AC-11: Scan root unreadable: named error, distinct non-zero exit.
- AC-12: Run against the live container root on the day of Implement, the output lists
  memory-fabric as unlisted unless it has been added or excluded by then (the live
  instance this spec exists for).

## Decisions needed (Clarify)

**D1. Where does the check live?**
- (a) A dev-time script in this repo's `scripts/` **(rec)**, beside `check-primaries-clean.sh`
  and `test-all.sh`, which already read sibling repositories read-only. Cost: a
  portfolio-wide check lives in one product's repository, so it only runs where a MinSpecPro
  session or hook runs.
- (b) The founder's `~/.claude/scripts/` beside the chief-of-staff roster. Cost: that tree is
  unversioned in the container, so the check has no tests and no review.
- (c) A MinSpec product command. Cost: widens the product surface with a feature about one
  person's directory layout, and scanning outside the open workspace strains invariant 3.

**D2. What is the canonical "claimed" list?**
- (a) The union of folders in every `*.code-workspace` directly under the scan root **(rec)**.
  Cost: a repository listed only in `forge.code-workspace` counts as covered even though the
  issue names `mmo.code-workspace` as canonical.
- (b) `mmo.code-workspace` only, as the issue states. Cost: today flags 8 repositories that
  are deliberately in the other two workspaces.
- (c) A new machine-readable portfolio registry with status per project (priority / paused /
  parked). Cost: one more hand-kept list; it fixes ordering visibility but adds a fourth source.

**D3. How is a deliberate omission recorded?**
- (a) An exclusion file next to the workspace files (e.g. `~/code/.minspec-unlisted`), one
  `path  reason` line each **(rec)**. Cost: lives outside any repository, so it is unversioned.
- (b) An exclusion list committed in this repository. Cost: names the founder's private
  project directories in a repository that is open-sourced (DR-075).
- (c) No exclusion: every unlisted repository is reported forever. Cost: 10 permanent lines,
  which teaches readers to skip the output.

**D4. Where is it surfaced?**
- (a) One summary line plus names in this repo's SessionStart hook output **(rec)**. Cost: a
  few lines of tokens per session start, and only in MinSpecPro sessions.
- (b) Standalone only (`scripts/<name>` run by hand). Cost: nobody runs it; the gap the issue
  describes recurs.
- (c) The drain loop's periodic report. Cost: visible only while a drain runs.

**D5. Are the prose repo-mapping tables reconciled too?**
- (a) No - reconcile workspace files only; add the voip-sms-inbox row as a one-time data fix
  (FR-8) **(rec)**. Cost: the tables can drift again unseen.
- (b) Yes - parse the markdown tables and require each priority project to have a row. Cost:
  a parser over prose, which breaks on any re-format, and needs D2(c) to know "priority".

## Follow-ups (tracked)

- Global `~/.claude/CLAUDE.md` "Repo Mapping" lists none of voip-sms-inbox, minspec or
  memory-fabric: outside this repository; to be filed by the session that implements FR-8.
  None filed yet from this Specify-only dispatch (no network permitted).
- `PlotLead` versus `plotlead` duplicate checkout: diagnosis is a separate item; the
  reconciler only reports it (FR-3c).
