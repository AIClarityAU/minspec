---
id: SPEC-466
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-074 (blast radius, invariant 3) lives here
aspects: [containment, blast-radius, machine-wide, invariant, silent-gate, inventory-test, tier-0]
relates_to: [DR-074, DR-073, DR-066, DR-086, SPEC-096, "#1150", "#1147", "#1149", "#1319", "#1049", "#1050"]
# Ownership declared in Specify (SPEC-038). All four files are NEW: the scanner's pure
# library and its CLI (witness B, FR-1 to FR-8), and the two tests that pin them - the
# scanner's own fixture test (FR-10) and the shipped-code reach inventory (witness A, FR-9).
implements: [scripts/lib/machine-scope.ts, scripts/check-machine-scope.ts, packages/minspec/tests/check-machine-scope.test.ts, packages/minspec/tests/machine-scope-inventory.test.ts]
---

# SPEC-466: A deterministic backstop for the containment invariant

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, settles the questions under [Decisions needed (Clarify)](#decisions-needed-clarify), and
> approves it through the normal spec-approval gate before any code changes. Every requirement
> below is written under each decision's recommended option, so approving the spec as it
> stands accepts those recommendations. The selections are agent-written; no human chose them.

**Date:** 2026-11-27
**Issue:** [#1150](https://github.com/AIClarityAU/minspec/issues/1150) - the containment
invariant is prose-only, so it is model-trusted and will drift.
**Design rests on:** [DR-074](../../../docs/decisions/DR-074.md) (MinSpec's blast radius is the
project it is installed in; constitution invariant 3), with
[DR-066](../../../docs/decisions/DR-066.md) (no silent gate; invariant 2) setting how the check
must fail. No new DR - see [Why no new DR](#why-no-new-dr).

## One-Sentence Scope

Add two independent, deterministic witnesses for constitution invariant 3: a CI-gating test
that proves the shipped extension has no code path that reaches a machine-wide surface, and a
read-only dev-time scanner that finds MinSpec-attributable rules on this machine's
machine-wide surfaces that lack the `.minspec/`-presence scope gate.

## Context - what is true today (read from `origin/main` 2be74b18, not inferred)

**The issue's open question has a split answer.** #1150 asks whether the check belongs in a
merge gate or in the extension's doctor command, because CI cannot read a home directory. The
invariant actually has two halves, and they are observable in different places:

1. **"MinSpec does not write a machine-wide surface"** (DR-074 decision 3). That is a property
   of the *shipped code*, and the code is in the repository, so CI can check it.
2. **"A MinSpec rule that lives on a machine-wide surface carries its own scope gate"** (DR-074
   decision 4). That is a property of *files in a home directory*, which no CI runner has. Only
   something running on the machine can check it.

**Half 1 is true today, by observation, but nothing holds it.**

- `grep -rnE "homedir|process\.env\.(HOME|USERPROFILE|XDG)" packages/*/src` returns nothing.
  Every write path in the extension is built from a workspace-folder root (for example
  `.claude/settings.json` is project-relative, `packages/minspec/src/lib/claude-settings.ts:37`;
  slash-command shims go to `<root>/.claude/commands`,
  `packages/minspec/src/lib/slash-commands.ts:389`).
- It has been false twice, and both times a human caught it, not a check. Approve Spec's
  "Always" choice and Backfill Epics both wrote `ConfigurationTarget.Global` - the user's
  machine-wide VS Code settings under `~/.config/**` - so every other MinSpec project on the
  machine inherited the value without opting in. The fixes are recorded in place:
  `packages/minspec/src/commands/approve.ts:139-143` (#1319) and
  `packages/minspec/src/commands/backfill-epics.ts:52`.
- One machine-wide store is still written: `context.globalState`, the extension's own
  VS Code Memento, for the once-per-machine Approve hint
  (`packages/minspec/src/commands/approve.ts:452-455`, key `minspec.approveRevokeHintShown`,
  passed in at `packages/minspec/src/extension.ts:500`). It is MinSpec's own storage, not a
  user config file, and it only changes a MinSpec message shown by a command that already
  refuses to run outside an opted-in folder (SPEC-096). It is a legitimate entry for an
  allowlist with a reason, not a violation - but today nothing would notice a second key that
  is not.

**Half 2 has no check at all.** The #1147 instance was a hand-written section of
`~/.claude/CLAUDE.md` headed *Agent GitHub Identity (minspec#995)*, carrying an unconditional
MUST that could only be satisfied in four repositories. Nothing detected it; a human noticed
in chat. DR-074 decision 4 records that the section was amended on the machine and also that
the amendment is unverifiable from this repository. Nothing would notice if it reverted, or if
the next hand-written MinSpec rule landed there without a gate.

**The canonical presence check DR-074 decision 2 said was missing now exists in the
extension.** `hasOptInMarker()` (`packages/minspec/src/lib/opt-in.ts:57-59`, SPEC-096) is the
one predicate. This spec does not need it at runtime: the scanner checks that a *rule's text*
tells its reader to look for `.minspec/`; it does not decide whether any repository is opted
in. DR-074's sentence "no single canonical check exists" is therefore stale for the extension;
this spec does not edit the accepted DR (see Out of Scope).

**Where scanner tests live.** Tests for `scripts/` modules sit in `packages/minspec/tests/`
(for example `check-primaries-clean.test.ts`), which is what CI runs with `npx vitest`.

## Functional Requirements

### Witness A - the shipped extension cannot reach a machine-wide surface (CI, gating)

- **FR-1 - Reach inventory test.** `packages/minspec/tests/machine-scope-inventory.test.ts`
  scans every `.ts` file under `packages/*/src` (tests excluded) and fails on any occurrence of
  a *reach token*:
  - `homedir` (covers `os.homedir()` and `require('os').homedir`);
  - `process.env.HOME`, `process.env.USERPROFILE`, `process.env.XDG_` (any suffix),
    `process.env['HOME']` and the same bracket forms;
  - `ConfigurationTarget.Global`, and a `getConfiguration(...).update(` call whose third
    argument is the literal `true` (the boolean form of the global target);
  - any reference to `globalState` or `globalStorageUri` / `globalStoragePath` (the
    reference, not only an `.update(` call: the one Memento write today happens through a
    parameter named `state` inside `packages/minspec/src/commands/approve.ts:455`, so the only textual handle on it
    is where `context.globalState` is handed over, `packages/minspec/src/extension.ts:500`);
  - a string literal that begins with `~/` or contains `/.gitconfig`, `/.bashrc`, `/.zshrc`,
    `/.profile`, `/.bash_profile`, `/.zprofile`;
  - a git argument list or command string containing `--global` or `--system`.
- **FR-2 - Allowlist with a reason, and no wildcards.** The test carries one in-file allowlist.
  Each entry names a file, the exact matched text, and a one-line reason that cites the
  decision or issue permitting it. An entry is matched by file and text, never by file alone,
  so a second reach in an allowlisted file still fails. The first entry is
  `context.globalState` at `packages/minspec/src/extension.ts:500`, which hands the Memento to
  Approve Spec for its once-per-machine hint (the key is defined in Approve Spec, see Context
  above), reason: MinSpec's
  own storage, affects only a MinSpec message from a command that refuses outside an opted-in
  folder (SPEC-096). Comments that mention a token (such as `approve.ts:139`) are not reaches;
  the matcher skips `//` and `/* */` comment text.
- **FR-3 - Stale allowlist fails too.** An allowlist entry that matches nothing fails the test
  with "allowlist entry no longer matches - remove it". An allowlist that only grows is how an
  exception outlives its reason.
- **FR-4 - Stated limit.** The test reads source text. It does not catch a path built by
  aliasing (`const o = os; o['home' + 'dir']()`) or a reach through a dependency. The test file
  says so in its header, in the same way `scripts/hooks/host-write-guard.py` states its own
  limit, so the control is not read as stronger than it is.

### Witness B - the machine-wide surface scanner (dev-time, on the machine)

- **FR-5 - Surface registry.** `scripts/lib/machine-scope.ts` exports one list of machine-wide
  surfaces, each with a kind. The list, all relative to `$HOME`:

  | Kind | Paths |
  |---|---|
  | `prose` (loaded into an agent's context in every project) | `.claude/CLAUDE.md`, `.claude/commands/**/*.md`, `.claude/agents/**/*.md`, `.claude/skills/**/*.md`, `.claude/output-styles/**/*.md` |
  | `config` (takes effect in every project, no prose form) | `.claude/settings.json`, `.claude/settings.local.json`, `.gitconfig`, `.config/git/config` |
  | `shell` (runs in every shell) | `.bashrc`, `.bash_profile`, `.profile`, `.zshrc`, `.zprofile`, `.config/fish/config.fish` |

  Deliberately **not** in the list, each with its reason recorded next to the list:
  `.claude/projects/**` (Claude Code loads a project's memory only in that project, so it is
  project-scoped, not machine-wide); `.claude/scripts/**` (executed only when something calls
  it, so the call site is what is checked, and the call sites are in the surfaces above). The
  `~/.config/**` tree is not scanned wholesale: only named loaders are (Clarify D3).
- **FR-6 - Attribution signals.** A line is MinSpec-attributable when it matches any of, and
  only, these signals, defined once in `scripts/lib/machine-scope.ts`:
  - a MinSpec managed-region marker: `<!-- minspec:` (any suffix);
  - an issue reference of the form `minspec#<digits>` (case-insensitive);
  - the token `gh-app-token.sh`;
  - an environment name matching `MINSPEC_[A-Z0-9_]+`;
  - a path containing `/minspec-` under `.claude/commands/` (a copied slash-command shim).

  The bare word "MinSpec" is not a signal (Clarify D4).
- **FR-7 - Regions.** For a `prose` file, a region is a Markdown heading's section: from the
  heading line to the line before the next heading of the same or higher level. Text before the
  first heading is one region. A managed-marker block (`<!-- minspec:X:start -->` to its
  `:end -->`) is a region of its own. A `commands`/`agents`/`skills`/`output-styles` file is one
  region (the whole file). A region is attributable when any line in it matches FR-6; the
  smallest enclosing region is the one judged, so one attributable subsection does not force a
  gate onto an unrelated parent section.
- **FR-8 - The scope gate, and the verdicts.**
  - A `prose` region passes when its **first non-blank line after the heading** (or the first
    non-blank line of the file, for a whole-file region; or the first line inside the start
    marker, for a marker block) is the canonical gate, byte-for-byte:

    ```
    > **Scope:** applies only when the current repository has `.minspec/` at its root. In any other repository, ignore this section entirely - it is not a blocker and not a rule to work around.
    ```

    The text is exported as one constant so the scanner, its fixture test, and the fix hint it
    prints cannot drift apart. A parent heading's gate covers its subsections.
  - A `config` or `shell` line that matches FR-6 is a finding unconditionally: those surfaces
    have no prose form a reader would honour, and DR-074 decision 3 puts them out of bounds for
    MinSpec outright.
  - Each finding prints `path:line`, the signal that matched, the region heading, and the exact
    fix: the gate line to insert (prose), or "remove - MinSpec does not write this surface
    (DR-074 decision 3)" (config, shell).
- **FR-9 - It fails visibly, and absence is reported, never folded into pass** (invariant 2).
  Exit `0`: every present surface was read and no finding. Exit `1`: one or more findings. Exit
  `2`: the check could not complete - `HOME` unset or not a directory, or any present surface
  unreadable - and each unreadable path is named. A surface that does not exist is not a
  finding; the summary line always prints the counts `checked N, present P, absent A,
  unreadable U, findings F`, so "nothing found" can be told apart from "nothing looked at"
  (P = 0 is printed as its own warning line, `no machine-wide surface present under $HOME`).
- **FR-10 - Read-only and offline.** The scanner never writes, never offers to fix, and makes no
  network call (invariant 1). It reads only the FR-5 paths. Its output quotes the matched line
  only, never a whole file, because these files can hold credentials.
- **FR-11 - Where it runs.** An npm script `check:machine-scope` runs
  `scripts/check-machine-scope.ts`. `scripts/hooks/session-start.sh` runs it and prints its
  output when it exits non-zero; it does not block the session and its exit status is not
  swallowed into a pass - the hook prints `machine-scope: N finding(s)` or
  `machine-scope: could not check (exit 2)` on its own line. It is **not** wired into
  `npm run validate` or any merge-gating CI job (Clarify D1): on a runner every surface is
  absent, so it would either always pass (a silent gate) or always fail.
- **FR-12 - Scanner fixture test.** `packages/minspec/tests/check-machine-scope.test.ts` runs
  the library against a temporary fake `$HOME` and covers, at least:
  1. the #1147 shape - `## Agent GitHub Identity (minspec#995)` followed by an unconditional
     MUST and a `gh-app-token.sh` reference, with no gate - is a finding at the heading's line;
  2. the same section with the canonical gate as its first line is clean;
  3. the gate placed on the third line, or reworded by one character, is a finding;
  4. an attributable subsection under a gated parent is clean; under an ungated parent with an
     unrelated sibling, only the attributable subsection is reported;
  5. `MINSPEC_APP_ORG=...` in `.bashrc` is a finding regardless of any comment near it;
  6. a section that says "MinSpec" with no FR-6 signal is clean (pins Clarify D4);
  7. `HOME` unset gives exit 2; an unreadable `.gitconfig` gives exit 2 naming it; an empty
     fake home gives exit 0 with `present 0` and the warning line;
  8. a `~/.claude/projects/<slug>/memory/*.md` file full of signals is not read.

  Not vacuous: each verdict branch is removed one at a time (a mutant per branch) and the test
  is shown to turn red, with a clean control run.

## Acceptance Criteria

- **AC-1.** On the current tree, `npx vitest run packages/minspec/tests/machine-scope-inventory.test.ts`
  passes with exactly one allowlist entry, and fails when `ConfigurationTarget.Global` is
  re-introduced in `packages/minspec/src/commands/approve.ts` (the #1319 regression, replayed) - shown red, then green.
- **AC-2.** Removing the code that the one allowlist entry covers makes the inventory test fail
  with the stale-entry message (FR-3).
- **AC-3.** The scanner run against a fake home that reproduces the #1147 section prints one
  finding with `path:line`, the `minspec#` signal, and the canonical gate text as the fix, and
  exits 1.
- **AC-4.** The scanner run with `HOME` pointing at a missing directory exits 2 and says why;
  it never exits 0 in that case.
- **AC-5.** Opening a session in this repository with one planted finding in a fake home
  shows the `machine-scope:` line in the session-start output; the session still starts.
- **AC-6.** A `grep` for network APIs (`fetch`, `http`, `https`, `net`, `child_process` running
  `gh` or `curl`) in `scripts/lib/machine-scope.ts` and `scripts/check-machine-scope.ts`
  returns nothing.
- **AC-7.** FR-12's eight cases pass, and each mutant listed under FR-12 turns the test red.

## Invariants (must not break)

- **Invariant 1 (offline).** Neither witness makes a network call.
- **Invariant 2 (no silent gate).** Witness A is a required CI check through vitest; witness B
  reports "could not check" as exit 2 and never as a pass, and the session-start hook prints a
  non-zero result rather than discarding it. The two witnesses are independent: A reads the
  repository, B reads the machine, and neither depends on the other's producer.
- **Invariant 3 (blast radius).** The scanner reads machine-wide files but never writes them,
  and it ships only as a dev-time script of this monorepo - it is not added to the extension,
  so no adopter's machine gains a home-directory reader (Clarify D1). The session-start hook
  that runs it is this repository's project hook, so it never fires in a repository that has
  not opted in.
- **SPEC-096.** The opt-in marker is still created only by Initialize; nothing here creates or
  reads `.minspec/` in any workspace.

## Decisions needed (Clarify)

Each question carries an agent-recorded selection of its recommended option. An agent copied
the (rec) option; no human chose it. Approving this spec ratifies the selections; change any
before approving to choose otherwise.

### D1 - Where does witness B (the home-directory scan) live?

- **(a) Dev-time script in this monorepo, run by the session-start hook and on demand (rec).**
  Costs: it protects only machines that run sessions in this repository, so an adopter's
  hand-copied MinSpec rule in their own `~/.claude` goes unchecked. That gap is narrow because
  witness A proves the extension itself never writes there; the remaining source is a human
  copying text, which is what happened in #1147, on this machine.
- **(b) A palette command in the extension ("MinSpec: Check Machine-Wide Scope").** Reaches
  adopters. Costs: the extension gains a reader of `~/.gitconfig` and shell profiles, which
  witness A then has to allowlist, and a tool that reads a user's dotfiles is a larger trust ask
  than the defect it catches.
- **(c) Both.** Costs: two copies of the scan to keep aligned, or a shared module moved into
  `@aiclarity/shared`, for a protection adopters have not asked for.
- **(d) Wire it into `npm run validate`.** As the issue sketches. Costs: in CI every surface is
  absent, so the step either always passes (a silent gate, invariant 2) or always fails.

**Recorded selection:** (a) - recommended option, copied by an agent, not chosen by a human.

### D2 - What form does the scope gate take?

- **(a) One fixed sentence, checked byte-for-byte, as the first line of the region (rec).** The
  text in FR-8. Costs: rigid - a reworded but equivalent gate is a finding, and the wording can
  only change by editing the constant and every gated file together.
- **(b) An HTML comment marker (`<!-- minspec:scope requires=.minspec/ -->`) plus free prose.**
  Costs: the check proves the marker, not that the reader was told anything; a marker with no
  sentence passes while the model sees only a comment it may not interpret.
- **(c) A regular expression over natural language ("only in ... `.minspec/` ...").** Costs: a
  pattern loose enough to accept honest variants also accepts a sentence that mentions
  `.minspec/` without gating anything.

**Recorded selection:** (a) - recommended option, copied by an agent, not chosen by a human.

### D3 - How much of `~/.config/**` is scanned?

- **(a) Named loaders only - `git/config` and `fish/config.fish` - with the list in one place
  (rec).** Costs: a new tool that loads config from `~/.config` is missed until someone adds it.
- **(b) The whole tree.** Costs: reads every application's settings, including credential
  stores, to find a token that MinSpec has never written there; slow and a privacy overreach.

**Recorded selection:** (a) - recommended option, copied by an agent, not chosen by a human.

### D4 - Does the bare word "MinSpec" make a region attributable?

- **(a) No - only the FR-6 tokens do (rec).** Costs: a hand-written rule such as "always do X"
  inside a section that only says "MinSpec" in prose, with no issue reference, marker, env name
  or token script, is not caught.
- **(b) Yes.** Costs: every note that merely names the product (a repo map, a memory index
  line) needs a gate or is a finding; the check becomes noise and gets ignored.

**Recorded selection:** (a) - recommended option, copied by an agent, not chosen by a human.

### D5 - What does a finding do at session start?

- **(a) Print on its own line, never block the session (rec).** Costs: a finding can be read
  past; nothing forces it to be fixed.
- **(b) Block the session until fixed.** Costs: the scanner reads the founder's personal files,
  which an agent in the container cannot edit (the container's `~/.claude` is read-only in
  places), so a block would wedge every session on a human edit - the #1147 failure in mirror
  image.

**Recorded selection:** (a) - recommended option, copied by an agent, not chosen by a human.

## Why no new DR

Every choice here is reversible in under a day: the scanner's surface list, signals and gate
text are constants in one module, and the inventory allowlist is one in-file table. The
decision that is hard to reverse - that machine-wide surfaces are out of bounds and a rule on
one carries its own gate - is DR-074, already accepted. This spec supplies its enforcement.

## Out of Scope

- **Fixing the files the scanner finds.** It reports; the founder edits his own home
  directory.
- **Scripts in this repository that patch `~/.claude/scripts/`** (`scripts/host-patches/**`).
  They patch the founder's own tooling (`cos.py`), carry no rule loaded into an agent's
  context, and are applied by hand on the host. Witness A covers the shipped extension only.
- **Other agents' global files** (`~/.codex/AGENTS.md`, Cursor's global rules). Adding one is a
  one-line change to the FR-5 list once a MinSpec rule is known to live there.
- **The org-admin widening policy** - #1149. When it ships, the gate sentence may need a
  second form for org-captured repositories; that is #1149's change to make.
- **Editing DR-074's stale "no canonical check exists" sentence.** SPEC-096 built the check;
  the accepted record keeps its historical wording.
- **Moving the `~/.claude/CLAUDE.md` identity section into project harness files** (DR-074's
  rejected alternative, "revisit if #1150's backstop makes the migration cheap"). This spec
  does not change the cost of that migration.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **One combined check.** Rejected: invariant 2 asks for an independent second witness, and
  the two halves are observable in different places (repository vs machine), so they are two
  checks by nature.
- **A runtime `fs` spy in the extension tests that fails on any write outside the workspace.**
  Rejected for witness A: it sees only the paths a test happens to exercise, while the text
  inventory sees every call site, which is the shape SPEC-096 used for the same reason.
- **Checking only that the #1147 section stays gated.** Rejected: that pins the instance, and
  the issue's point is the next hand-written rule.
- **Letting the scanner auto-insert the gate.** Rejected: it would make MinSpec a writer of
  `~/.claude/CLAUDE.md`, the exact act DR-074 decision 3 forbids.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `machine-scope-inventory.test.ts` (FR-1 to FR-3), shown red
  by replaying the #1319 `ConfigurationTarget.Global` write on a scratch branch, and
  `check-machine-scope.test.ts` (FR-12) red against an empty library.
- **Not vacuous:** the FR-12 mutants, and the FR-3 stale-entry case, each turn the suite red
  with a clean control run.
- **Typecheck:** both test files are run through `tsc`, since `tests/` sits outside every
  tsconfig include.

## Traceability

- **Issue:** [#1150](https://github.com/AIClarityAU/minspec/issues/1150).
- **Instance:** [#1147](https://github.com/AIClarityAU/minspec/issues/1147) (the ungated
  `~/.claude/CLAUDE.md` rule); earlier shipped-code instances #1319 (Approve "Always") and the
  Backfill Epics global write recorded at `packages/minspec/src/commands/backfill-epics.ts:52`.
- **Governing decisions:** [DR-074](../../../docs/decisions/DR-074.md) (decisions 3 and 4),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-073](../../../docs/decisions/DR-073.md) (the rejected global-hook alternative),
  [DR-086](../../../docs/decisions/DR-086.md) (acting on a recommendation, recording what was
  not taken).
- **Specs this touches:** [SPEC-096](../SPEC-096-opt-in-marker-single-creator/requirements.md)
  (the opt-in predicate and the inventory-test pattern this reuses).
- **Same family:** #1049 / #1050 (make checking cheap so guessing has no upside).
- **Follow-ups:** none filed from this spec; every deferred item above is either another
  issue's scope (#1149) or explicitly not planned.
