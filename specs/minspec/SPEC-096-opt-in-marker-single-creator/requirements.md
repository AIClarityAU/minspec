---
id: SPEC-096
type: requirements
status: planning
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-074 (blast radius, the opt-in marker) lives here; this is an invariant-3 defect in shipped commands
aspects: [opt-in, blast-radius, filesystem, commands, tier-0, inventory-test, silent-gate]
relates_to: [DR-074, DR-078, DR-066, DR-086, SPEC-026, SPEC-086, "#2364", "#2355", "#2328", "#2356", "#2365", "#2461", "#2462", "#2464"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1 to FR-3; the
# shipped `/minspec-specify` guidance). Declaring after approval would edit the bytes the
# canonical hash covers and stale the sign-off. All four files are NEW and required under
# every DQ answer below: the module that holds the one guard (FR-1, FR-2) and the three tests
# that pin it (FR-9, FR-10, FR-11).
implements: [packages/minspec/src/lib/opt-in.ts, packages/minspec/tests/opt-in-guard.test.ts, packages/minspec/tests/opt-in-writer-inventory.test.ts, packages/minspec/tests/commands-opt-in-invariant.test.ts]
# Modified, not owned. approval.ts, adr-manager.ts and epic-manager.ts belong to SPEC-041,
# merge-refresh.ts and scaffold.ts to SPEC-043, commands/constitution.ts to SPEC-025 (their
# `implements:` lines); no spec lists the others under `implements:` (parsed across every file
# in specs/). A defect spec does not become the owner of the stores it corrects. Test fixtures
# that lean on a store creating `.minspec/` are not listed: which ones is a Plan-phase
# measurement (the fix for #2355 found five test files for one store). Under DQ-4 Option B up
# to eight entries (adr-manager.ts onward) leave this list.
affects: [packages/minspec/src/lib/session.ts, packages/minspec/src/lib/classifier.ts, packages/minspec/src/lib/parking-lot.ts, packages/minspec/src/lib/approval.ts, packages/minspec/src/lib/approval-store.ts, packages/minspec/src/lib/phase-advance-queue.ts, packages/minspec/src/lib/traceability.ts, packages/minspec/src/lib/bridge.ts, packages/minspec/src/lib/merge-refresh.ts, packages/minspec/src/lib/scaffold.ts, packages/minspec/src/lib/auto-bootstrap.ts, packages/minspec/src/lib/presence.ts, packages/minspec/src/lib/preferences.ts, packages/minspec/src/commands/constitution.ts, packages/minspec/src/commands/session.ts, packages/minspec/src/commands/park.ts, packages/minspec/src/commands/approve.ts, packages/minspec/src/commands/init.ts, packages/minspec/src/commands/classify.ts, packages/minspec/src/views/codelens-provider.ts, packages/minspec/src/extension.ts, packages/minspec/src/lib/adr-manager.ts, packages/minspec/src/lib/epic-manager.ts, packages/minspec/src/lib/spec-manager.ts, packages/minspec/src/lib/spec-layout.ts, packages/minspec/src/lib/claude-settings.ts, packages/minspec/src/lib/slash-commands.ts, packages/minspec/src/lib/context-injector.ts, packages/minspec/src/commands/example.ts]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-096: Only Initialize creates the .minspec/ opt-in marker

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#2364](https://github.com/AIClarityAU/minspec/issues/2364)** - *"ten more
writers mkdir -p .minspec/ with no opt-in check (reachability before opt-in not yet
traced)."* It blocks the planned Marketplace preview release: `.minspec/` at the root of a
folder is the opt-in marker (constitution invariant 3, `.minspec/constitution.md:9`;
[DR-074](../../../docs/decisions/DR-074.md) decision 2), so a writer that creates it in a
folder that never opted in breaks the invariant and manufactures the evidence every later
check trusts. The issue asked for the trace it had not done. This spec does that trace, and
specifies the fix for the property rather than for the ten rows.

**Id note.** The nine ids after `SPEC-086` are claimed: seven by open pull requests or
pushed branches, the eighth by `agent/issue-3` (commit `1fe023e2`, pushed, no pull request
yet) and the ninth by a spec being written in another worktree when this was checked (branch
`spec/2397-crlf-parsing`, not yet pushed). Checked across `origin/main`, every remote branch,
every open pull request and every local worktree on 2026-10-02, so this is `SPEC-096`. If the
id collides at review time, renumber.

**Tier note.** Triage estimated T3 from the issue's ten rows. The trace finds the change
crossing 29 existing source files, one new module and three new test files, which is past
the 15-file and 500-line marks the classifier uses for its top tier
(`packages/minspec/src/lib/git-analyzer.ts:34-39`, `:45-50`). The predicted tier is an
upward-only floor, so this is T4. DQ-4 Option B would take up to eight files off that count
and still leave it above the mark.

## One-Sentence Scope

Make `scaffold()`, reached from Initialize, the only code that can create `.minspec/` in a
workspace folder: every other directory the extension creates goes through one shared
operation that refuses to create it, the commands that reach a `.minspec/` write before
opt-in refuse before they ask or write anything, and tests fail when a directory-creating
call or a command is added outside that rule.

## Context - what the code does today (read from `origin/main` ff968418, not inferred)

**How the trace was done.** Every `file:line` below was read at that commit. "Measured"
means a throwaway probe drove the real command or library function against an empty temp
directory (the editor API mocked, `gh` reported unavailable) and listed the directory
afterwards. The probe is not part of this change; FR-10 specifies the permanent version.
"Read" means the path was followed in the code and not run. A file named without its path
is the one file of that name under `packages/minspec/src/` or `packages/minspec/tests/`;
three names used below exist twice there (`session.ts`, `constitution.ts`,
`tidy-primary.ts`) and are always written in full.

### The one guard that exists, and where it is used

- **The predicate.** `hasOptInMarker(rootDir)` is true when `rootDir` is not empty and
  `<rootDir>/.minspec` exists (`packages/minspec/src/lib/preferences.ts:159-161`).
  `isMinspecInitialized` delegates to it (`packages/minspec/src/lib/auto-bootstrap.ts:73-75`).
- **The refusal.** `savePreferences` throws `NotOptedInError` in a folder without the marker
  and contains no `mkdir` (`preferences.ts:168-177`, `:192-203`). That is the fix for #2355
  (closing the setup toast created the marker), merged as pull request #2366.
- **Its other uses.** The presence heartbeat (`packages/minspec/src/lib/presence.ts:560-562`,
  `:701`), the terminal variable (`packages/minspec/src/extension.ts:140-147`), the two
  persisting buttons on the classify toast
  (`packages/minspec/src/commands/classify.ts:130-139`), and the setup toast's steps and
  stores (`auto-bootstrap.ts:102`, `:155`, `:204`, `:345`, `:367`, `:601-728`).
- **Nothing else checks it.** A search of `packages/minspec/src` for `hasOptInMarker`,
  `isMinspecInitialized` and `NotOptedInError` finds no other use. No command besides
  Classify asks the question.
- **Nothing hides a command before opt-in.** `activationEvents` is empty
  (`packages/minspec/package.json:63`), none of the 45 contributed commands carries an
  `enablement`, and the Command Palette hides three and limits a fourth to Markdown editors
  (`package.json:315-332`). Commands resolve their folder with no marker check
  (`packages/minspec/src/lib/resolve-folder.ts:14-32`, `:49-60`).

### The ten writers the issue lists, traced

Each does a recursive `mkdirSync` of `.minspec/` or a directory under it. Measured for all
ten: called directly on an empty temp directory, each one creates `.minspec/`.

| # | Writer | Reachable before opt-in? | Path, and what stands in between |
|---|---|---|---|
| 1 | `saveSession`, `packages/minspec/src/lib/session.ts:66-73` | **Yes.** Measured | **MinSpec: Declare Session Scope** (`package.json:113`, registered `extension.ts:437`) resolves the folder (`packages/minspec/src/commands/session.ts:21`), asks three questions (`:43-62`) and saves (`:65`). Its other two callers are not reachable: presence is behind the predicate (`presence.ts:575-580`), and the drift warning's **Add to Scope** needs a session file to exist (`extension.ts:1008-1009`, `:1030-1031`, `:1056`) |
| 2 | `saveCalibration`, `classifier.ts:248-255` | **No** | Its only caller is `recordOverride` (`:286`), whose only caller is the classify toast's raise-tier button (`classify.ts:171-180`). That button is offered only when the predicate is true (`:130-131`, `:139`) |
| 3 | `appendToParkingLotFile`, `parking-lot.ts:190-217` | **Yes.** Measured with `gh` unavailable | **MinSpec: Park Topic** and **Park Topic (force)** (`extension.ts:438-439`) resolve the folder (`park.ts:42`), ask three questions (`:46-70`) and call `parkTopic` (`:105`), which falls back to the file when `gh` is unavailable, the folder has no GitHub remote, or the issue was not created (`parking-lot.ts:244-248`, `:259-263`, `:266-272`) |
| 4 | `writeGzipFallback`, `approval.ts:102-112` | **Yes**, in a folder that is not a git repository. Measured | **MinSpec: Approve Spec for Implementation** (`extension.ts:447-449`; also `Alt+A`, `package.json:274-278`, `approve-active.ts:49`, `:254`). `mintBaseline`, called at `approval.ts:579` before the record is written at `:590`, falls back to it when git cannot store or pin the blob (`:155-162`). What stands in between: a spec the catalog finds (`approve.ts:65-69`), the completeness check (`:244-266`), the advance check (`:274-297`) and an approver identity that is not an agent's (`:308-325`). **MinSpec: Generate Example Spec** supplies a spec that passes without `.minspec/` (`example.ts:26-41`) |
| 5 | `writeRecord`, `approval-store.ts:160-164` | **Yes**, same command. Measured in a git repository, where it is the first creator | `approval.ts:590`, from `approve.ts:346` |
| 6 | `enqueuePhaseAdvance`, `phase-advance-queue.ts:47-60` | **Not as the first creator** | Its only caller is `enqueuePhaseAdvanceSafely` (`approve.ts:172-182`), reached only from `:390`, `:393`, `:397` and `:400`, each after the record is written at `:346` in the same `try`. By then writer 4 or 5 has created the marker. Measured: with **Always** chosen, the queue file is written in the same run as the record |
| 7 | `saveTraceability`, `traceability.ts:82-87` | **Yes.** Measured | **MinSpec: Link Code to Spec Requirement** (`extension.ts:435-436`) needs an open editor (`codelens-provider.ts:443-447`) and one top-level `SPEC-*.md` in the specs directory (`:464-476`), then saves (`:549`). Generate Example Spec creates such a file |
| 8 | the conformance export, `bridge.ts:182-199` | **Yes** | **MinSpec: Export Traceability for ScroogeLLM** (`package.json:239`, `extension.ts:444`) checks only for an empty root (`extension.ts:847-851`) and calls it (`:854`). The library call was measured, the wrapper read. A second caller, the conformance watcher (`bridge.ts:231-237`), runs only with `minspec.conformance.enabled` on and ScroogeLLM installed (`:216-218`) |
| 9 | `saveHashes`, `merge-refresh.ts:1348-1359` | **Not as the first creator** | Its only caller is `recordVerifyAndSaveManifest` (`scaffold.ts:1441`), called at `:1545` and `:1729`, in both cases after `scaffold()` created the marker (`:1453`, `:1579`) |
| 10 | `saveTemplateBaseline`, `merge-refresh.ts:1396-1400` | **Not as the first creator** | Callers `scaffold.ts:1508` and `:1691`, same ordering |

So six of the ten are reachable before opt-in, through Declare Session Scope, the two Park
Topic commands, Approve Spec, Link Code and Export Traceability. The other four are not
defects today. The issue expected rows 9 and 10 to "stay able to create it"; the trace shows
they never need to, because `scaffold()` always runs first.

Rows 2 and 6 share one residual: the marker can be deleted while a toast is open, and the
click that follows recreates it (`classify.ts:143` awaits the toast between the check and
the write; `approve.ts:392` and `:399` do the same). That is a folder opting out, not one
that never opted in.

### What the issue's list missed

| Route | Reachable before opt-in? | Path |
|---|---|---|
| The constitution draft, `packages/minspec/src/commands/constitution.ts:109-115` | **Yes.** Measured | **MinSpec: Propose Constitution (draft)** (`package.json:88`, `extension.ts:388`) has no marker check (`packages/minspec/src/commands/constitution.ts:104`), reads a missing file as empty (`:110`) and writes after a recursive `mkdirSync` of `.minspec/` (`:112-113`) |
| `scaffold()` reached from Refresh, `scaffold.ts:385-387` | **Yes.** Measured: 59 files and directories in an empty folder, `.minspec/config.json`, hooks and workflows among them | **MinSpec: Refresh Harness Files** (`package.json:72`, `extension.ts:370-377`) calls `refreshHarnessFiles` with no marker check (`init.ts:1488-1494`), which begins by calling `scaffold()` (`scaffold.ts:1577-1579`). Refresh in a folder that was never initialized is a full Initialize under another name. The setup toast offers Refresh only in an initialized folder (`auto-bootstrap.ts:613-616`), so the palette is the route |
| A directory named by a setting, `example.ts:37`, `adr-manager.ts:520` | **Yes**, when `minspec.specsDir` or `minspec.decisionsDir` (`package.json:446-455`) points inside `.minspec/`. Measured for the first, read for the second | `resolveAndValidate` accepts any directory inside the root (`config.ts:201-208`), and with no `.minspec/config.json` the value comes from the setting (`example.ts:19-25`, `adr.ts:84-94`) |

The first of these is why the fix cannot be "the ten rows": the issue's own list, built by
reading, missed it.

### What a manufactured marker then lets through

Measured in a git repository with no `.minspec/`: Generate Example Spec, then Approve Spec,
then **Always** on the follow-up toast leaves `.minspec/approvals/`, `.minspec/queue/` and
`.minspec/preferences.json` behind, plus a git ref `refs/minspec/snapshots/*`
(`approval.ts:140-153`) and a spec whose `status:` was flipped before the record was written
(`approve.ts:345-346`). `savePreferences` passed its own guard, because by then the marker
existed. From that point, by the code (read, not measured), the presence heartbeat starts on
its next tick (`presence.ts:556-562`, `:592-596`) and the setup toast stops being offered
(`auto-bootstrap.ts:600-601`).

### The whole population of directory-creating calls

Counted on `origin/main` ff968418 across the 118 non-test source files of
`packages/minspec/src` and `packages/shared/src`: 33 calls (30 `mkdirSync`, 2 `mkdtempSync`,
1 `renameSync`) in 23 files. `packages/shared/src` has none.

| What the call creates | Calls | Where |
|---|---|---|
| `.minspec/` or a directory under it, with no marker check | 11 | The ten rows above (`merge-refresh.ts` holds two) and `packages/minspec/src/commands/constitution.ts:112` |
| `.minspec/` itself, as the opt-in | 1 | `scaffold.ts:387` |
| The parent of a template or managed file, some under `.minspec/` (`template-registry.ts:75-76`, `:1112`, `:2621-2637`) | 3 | `scaffold.ts:804`, `:1487`, `:1658`, each reached only after `scaffold()` has run |
| A directory under `.minspec/`, already behind the predicate | 2 | `auto-bootstrap.ts:204`, `:212` (recursive); `presence.ts:701`, `:706` (deliberately not recursive, `:703-705`) |
| The specs, decisions or epics directory, or one under it | 7 | `example.ts:37`; `adr-manager.ts:520`, `:1068`; `epic-manager.ts:519`, `:642`; `spec-manager.ts:361`; `spec-layout.ts:273` |
| A fixed tool directory | 4 | `claude-settings.ts:151`; `slash-commands.ts:383`, `:395`; `context-injector.ts:112` |
| A git worktree under the OS temp directory | 4 | `approval-recover.ts:173`, `:226`; `push-docs-lane.ts:273`, `:286` |
| A file rename inside `.minspec/sessions/` | 1 | `presence.ts:728` |

Checked and found not to be creators, because none of them creates a directory: the writes
that have no `mkdir` (`config.ts:238-249`, `preferences.ts:192-203`, `scaffold.ts:72-86`,
`packages/minspec/src/commands/constitution.ts:152-187`), the deletes
(`packages/minspec/src/lib/session.ts:78-83`, `approval-store.ts:167-176`), and the template
text Initialize writes into a project (`template-registry.ts`, `hook-templates.ts` and
`ci-review-templates.ts` contain no `mkdir` or `makedirs`). Spawned `git` adds worktrees only
under the OS temp directory (`approval-recover.ts:209-216`, `push-docs-lane.ts:273-278`) and
checks out only a path that still exists locally
(`packages/minspec/src/lib/tidy-primary.ts:395-398`, `:415`).

## Functional Requirements

"The marker" is `.minspec/` at the root of a workspace folder. "Opted in" means the predicate
`hasOptInMarker` is true for that folder. Neither definition changes.

- **FR-1 - One module holds the rule.** `packages/minspec/src/lib/opt-in.ts` MUST hold the
  predicate, the refusal error, the wording of the refusal (FR-8) and the directory
  operation of FR-2, and MUST import nothing but `fs` and `path` (`presence.ts` depends on
  the predicate living in a module with no other imports, `presence.ts:16-24`). There MUST
  remain exactly one definition of the predicate. `preferences.ts` and `auto-bootstrap.ts`
  MUST keep exporting the names they export today (`auto-bootstrap.ts:53-62`, `:73-75`), so
  no existing importer changes.

- **FR-2 - One operation creates directories, and it cannot create the marker.** The module
  MUST export one operation that brings a directory into existence, with these properties:
  - (a) it creates the directory and any missing parents, and an existing directory is not
    an error;
  - (b) it never creates a path component named `.minspec`: asked for a directory at or
    under a `.minspec/` that does not exist, it creates nothing and throws the refusal error;
  - (c) that holds under a race: if `.minspec/` is removed after the operation has seen it
    and before it creates the next level, the outcome is the refusal or a filesystem error,
    never a recreated `.minspec/` (the property `presence.ts:703-706` already has for one
    directory, and `savePreferences` has by containing no `mkdir`, `preferences.ts:188-190`);
  - (d) a path that is not absolute is refused, which is what an empty root produces
    (`preferences.ts:154-157`).

- **FR-3 - `scaffold()` is the only creator, and only Initialize reaches it without a
  marker.** The call in `scaffold()` (`scaffold.ts:385-387`) MUST be the only code that
  creates a directory named `.minspec` under a workspace folder. `refreshHarnessFiles` MUST
  refuse, writing nothing, in a folder with no marker, instead of creating one
  (`scaffold.ts:1577-1579`), and `initRefreshCommand` MUST check before calling it (DQ-1).
  With the marker present Refresh is unchanged. `initCommand` is unchanged: it is the
  opt-in (`init.ts:1229-1253`).

- **FR-4 - Every directory the extension creates in a workspace folder goes through that
  operation.** After this change a direct call to a directory-creating filesystem API
  (FR-9 lists them) MUST exist in `packages/minspec/src` only in: the module of FR-1; the
  one call in `scaffold()`; `approval-recover.ts` and `push-docs-lane.ts`, which fill a git
  worktree under the OS temp directory; and `presence.ts`, for its one file rename. Every
  other call in the population table MUST use the operation instead (DQ-4): the eleven
  unguarded writers, the two already behind the predicate, the three template and
  managed-file writes in `scaffold.ts`, the seven that create an artifact directory and the
  four that create a tool directory. For the last eleven this changes nothing they do today
  except in the settings case measured above.

- **FR-5 - A `.minspec/` store refuses instead of creating.** In a folder that has not opted
  in, each of the eleven writers in the first row of the population table MUST write
  nothing, and its caller MUST receive the refusal error rather than a silent skip. In a
  folder that has opted in, each MUST write the same file with the same bytes as today. One
  writer cannot raise: `writeGzipFallback` returns `false` on any error
  (`approval.ts:109-111`). So `approveSpec` MUST itself refuse before its first side effect,
  which is the git blob and ref `mintBaseline` writes (`:140-153`), in the place the approver
  check already occupies for the same reason (`:524-528`). Rows 2, 6, 9 and 10 are not
  reachable before opt-in, so no user-facing behaviour is specified for them: they stop
  holding their own `mkdir`, and that is all.

- **FR-6 - A command refuses before it asks or writes.** Each command below MUST check the
  predicate as soon as its target folder is known, before asking anything else and before
  its first write. Where the folder has not opted in it MUST show the refusal of FR-8 and do
  nothing else: no question, no file, no git object, no setting.
  - **MinSpec: Declare Session Scope**
  - **MinSpec: Link Code to Spec Requirement**
  - **MinSpec: Propose Constitution (draft)**
  - **MinSpec: Approve Spec for Implementation**, however it is reached (`Alt+A` and the
    Specs pane included). The check MUST precede the `status:` flip, the record and the
    commit (`approve.ts:345`, `:346`, `:356`), so a refusal leaves the spec file
    byte-identical.
  - **MinSpec: Refresh Harness Files** (FR-3)
  - **MinSpec: Export Traceability for ScroogeLLM**, for as long as it exists (DQ-6)

  Any other command that reaches the refusal only because a directory setting points inside
  `.minspec/` (measured for Generate Example Spec) needs no check of its own, but MUST show
  the same refusal.

- **FR-7 - Park Topic before opt-in.** With no marker, Park Topic MUST still be able to
  create a GitHub issue, since that path writes nothing in the folder
  (`parking-lot.ts:244-263`), and MUST NOT write `.minspec/parking-lot.md` (DQ-3).
  - When it can tell before asking that only the local file is left (`gh` unavailable, or no
    GitHub remote: `parking-lot.ts:244-248`), it MUST refuse before the first question,
    saying both that `gh` could not be used and that the folder has no `.minspec/` to hold a
    local parking lot.
  - When issue creation fails after the questions were answered (`:259-263`), it MUST say
    that the topic was not saved and why, and MUST open the typed topic in an untitled
    editor so the text is not lost (the pattern
    `packages/minspec/src/commands/constitution.ts:34-38` uses), writing nothing under the
    folder.
  - With the marker present Park Topic is unchanged.

- **FR-8 - A refusal is visible, true, and says what to do.**
  - The refusal message MUST name the folder, say that it has no `.minspec/` directory and
    that nothing was written there, and name the command to run by its palette title,
    **MinSpec: Initialize SDD Structure** (`package.json:68-69`). For an empty root it says
    that no folder is open, as today (`preferences.ts:171-172`). It MUST NOT mention a
    preference unless a preference was the write (today's text always does,
    `preferences.ts:172-173`). It carries no button (DQ-2).
  - No success message ("Saved", "Linked", "Approved", "Refreshed", "Exported", "Session
    started") may follow a refusal.
  - Every user-triggered path that can reach the refusal of a store in FR-5 MUST show it
    through MinSpec's own message: none may rely on the editor's handling of a rejected
    command, and none may discard it. The call sites with no handler today are
    `classify.ts:174-180`, `extension.ts:1048` and `:1056` (the two drift-warning actions),
    `codelens-provider.ts:549`, `packages/minspec/src/commands/session.ts:65` and
    `park.ts:81`.
  - The two ambient paths stay silent and write nothing: the conformance watcher
    (`bridge.ts:231-237`) and the presence heartbeat (`presence.ts:700-710`).

- **FR-9 - A pinning test for writers.**
  `packages/minspec/tests/opt-in-writer-inventory.test.ts` MUST:
  - scan every `.ts` file under `packages/minspec/src` (excluding `test/` and
    `__benchmarks__/`, as `packages/minspec/tests/invariants.test.ts:99-100` does) and under
    `packages/shared/src` for calls to an API that can bring a directory into existence:
    `mkdir`, `mkdtemp`, `cp`, `rename` and `symlink` in their sync, callback and promise
    forms, and any write through `vscode.workspace.fs` or a workspace edit (no source file
    uses either of the last two today);
  - hold one declared inventory (file, number of such calls, and why each is allowed)
    containing exactly the entries FR-4 permits, with the creator entry being one call in
    `scaffold.ts`;
  - assert both directions: a file with such a call that is not in the inventory fails, a
    file whose count differs fails, and an inventory entry with no matching call fails;
  - fail if it scanned no files;
  - fail against today's `origin/main`, where 21 of the 23 files hold a call the inventory
    does not allow.

  What it proves is that every directory-creating call was routed through the operation or
  looked at. It matches calls by name, so it cannot see one made through an alias, and it
  cannot see a directory created by a spawned process; the modules that can spawn are
  already enumerated by `CHILD_PROCESS_ALLOWLIST` (`invariants.test.ts:115-216`). It does not
  police plain file writes either: one cannot create a directory, though a file written at
  the path `.minspec` itself would satisfy the predicate, which tests existence only
  (`preferences.ts:160`). No code writes one, and FR-10's listing is what would show it.

- **FR-10 - A pinning test for commands.**
  `packages/minspec/tests/commands-opt-in-invariant.test.ts` MUST:
  - read `contributes.commands` from `packages/minspec/package.json` and require every
    command id to be classified in the test as one of: *opts in* (only `minspec.init`),
    *refuses* (FR-6), *partial* (the two Park commands, FR-7) or *writes nothing under the
    marker* (the rest). A contributed command with no class fails, and a class naming a
    command that is not contributed fails;
  - invoke each command through the handler `activate()` registers (the harness
    `packages/minspec/tests/extension.test.ts:129-131` and `:369-374` builds), with no
    argument, as the Command Palette does, with every prompt answered. `gh`, `claude` and any
    `git` command that contacts a remote are stubbed at the child-process boundary; local
    `git` runs for real;
  - do so in real temp folders that have no `.minspec/`: an empty one; a primed one holding
    a git repository with one commit, a spec that passes the completeness check, a decision
    record, an epic, a `CLAUDE.md` and an open source file; and the primed one again with
    `minspec.specsDir` and `minspec.decisionsDir` set to directories inside `.minspec/`;
  - assert on the full recursive listing (the helper at
    `packages/minspec/tests/bootstrap-opt-in-invariant.test.ts:46-55`): `.minspec` is absent
    after every command except `minspec.init`, and for a *refuses* command the listing and
    the spec file are unchanged, the refusal was shown and no success message was;
  - carry each measured route as a named case: Declare Session Scope; Park Topic with `gh`
    unavailable; Propose Constitution; Generate Example Spec then Link Code; Generate
    Example Spec then Approve, in a git repository and in a plain folder; Refresh Harness
    Files; and Generate Example Spec with `minspec.specsDir` set inside `.minspec/`;
  - carry the controls that stop a pass coming from a dead writer: `minspec.init` does
    create the marker, and each *refuses* command writes its file in a folder that has
    opted in;
  - fail against today's `origin/main`.

- **FR-11 - A contract test for the guard.** `packages/minspec/tests/opt-in-guard.test.ts`
  MUST pin FR-2 on real temp directories: creation below an existing marker, the refusal with
  nothing created when the marker is absent, the race of FR-2 (c) by removing the marker
  between the look and the create, the empty root, and that the module imports only `fs` and
  `path`.

- **FR-12 - The words follow the code.** Comments that describe the old behaviour MUST be
  corrected in the same change: `packages/minspec/src/lib/session.ts:63-64`,
  `classifier.ts:245-246`, `traceability.ts:79-80`, `approval-store.ts:159`,
  `phase-advance-queue.ts:42`, `presence.ts:574`, `scaffold.ts:1578` and `extension.ts:375`
  (which says Refresh can run on a folder that has not opted in). The listing's sentence
  about the Park Topic fallback (`packages/minspec/README.md:39` today) MUST say that the
  local file is used in an initialized project and that otherwise nothing is saved in the
  folder. `packages/minspec/CHANGELOG.md` MUST gain an entry naming the two changes a user
  can notice: Refresh Harness Files no longer sets up a folder that was never initialized,
  and the commands of FR-6 ask for Initialize first.

- **FR-13 - Nothing else changes.** No setting is added, nothing is stored outside the
  folder, no prompt is added at activation, and no command outside FR-6 and FR-7 behaves
  differently in a folder that has opted in or in one that has not, apart from the settings
  case in FR-6 and the messages FR-8 adds where a marker was removed while a prompt was open.

## Acceptance Criteria

- [ ] In an empty folder, each of Declare Session Scope, Propose Constitution, Refresh
      Harness Files and Export Traceability shows the refusal and leaves the folder empty.
      (FR-3, FR-6, FR-8)
- [ ] After Generate Example Spec in a folder with no `.minspec/`, Link Code to Spec
      Requirement and Approve Spec each show the refusal, create no `.minspec/`, ask
      nothing, and leave the example spec byte-identical; in a git repository no
      `refs/minspec/snapshots/*` ref exists afterwards. (FR-5, FR-6)
- [ ] Park Topic in a folder with no `.minspec/` and no usable `gh` asks nothing, writes
      nothing and shows the refusal; when issue creation fails after the questions, the
      typed topic is in an untitled editor and the folder is unchanged. (FR-7)
- [ ] Generate Example Spec with `minspec.specsDir` set to `.minspec/specs` in a folder with
      no `.minspec/` shows the refusal and creates nothing. (FR-2, FR-4, FR-6)
- [ ] Initialize in an empty folder creates `.minspec/`, and every command above then
      writes the same file it writes today. (FR-3, FR-5, FR-13)
- [ ] Removing `.minspec/` between the guard's look and its create leaves no `.minspec/`
      behind. (FR-2, FR-11)
- [ ] `opt-in-writer-inventory.test.ts` exists, passes, and is shown to fail on the
      pre-change tree; adding one `fs.mkdirSync` to any source file outside its inventory
      turns it red. (FR-4, FR-9)
- [ ] `commands-opt-in-invariant.test.ts` exists, passes, and is shown to fail on the
      pre-change tree; contributing a command without classifying it turns it red. (FR-10)
- [ ] `bootstrap-opt-in-invariant.test.ts` and `presence-opt-in-invariant.test.ts` pass with
      no edit made by this change. (FR-1, FR-4)
- [ ] No refusal is followed by a success message, and none of the six call sites named in
      FR-8 lets one go unreported. (FR-8)
- [ ] The eight comments, the README sentence and the changelog entry of FR-12 are in the
      same change. (FR-12)

## Invariants (must not break)

- **INV-1 - Offline core (constitution invariant 1, DR-004).** No network call, no new
  child process and no new entry in `CHILD_PROCESS_ALLOWLIST`. Park Topic may run `gh` no
  earlier than a user's own invocation of it, as today.
- **INV-2 - No silent gate (constitution invariant 2, DR-066).** A refusal is never
  rendered as success and never dropped on a user-triggered path. The pinning tests fail
  closed: a file they cannot read, or a scan that finds nothing to scan, is a failure.
- **INV-3 - Blast radius (constitution invariant 3, DR-074).** The change removes writes
  and adds none. Nothing is stored in editor storage or machine-wide config to stand in for
  a refused write.
- **INV-4 - The marker's definition does not move.** `.minspec/` at the workspace-folder
  root, one predicate. Whether a `.minspec/` holding only `preferences.json` counts is #2365
  (folders already marked by the #2355 bug) and is not touched here.
- **INV-5 - Opted-in projects are unaffected.** With the marker present every writer
  produces the bytes it produces today, in the same place.
- **INV-6 - No nagging (constitution principles 2 and 4).** A refusal appears only in answer
  to something the user just did. No toast is added at activation and none repeats.
- **INV-7 - Boundaries (constitution constraints 1 to 3).** `@aiclarity/shared` is
  untouched, the new module sits in `lib/` and imports neither `vscode` nor anything from
  `views/` or `commands/`, and activation does no new work.

## Clarify selections (recorded by an agent 2026-10-02; ratified only by approval of this spec)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

DQ-1 to DQ-6 each carry a **Recorded selection** line naming the option this document
recommends. An agent session wrote those lines on 2026-10-02, and no human chose them. This
repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which an agent
proceeds on a stated recommendation and leaves the options it did not take on record
(DR-086 §2 and §4), which is why the options stay below with their costs. Approving a T3 or
T4 spec is the second class on that section's stop list (`scripts/lib/autonomy.ts:68-70`),
so nothing here stands in for that approval: the lines propose, and approving this spec is
what ratifies them. An approval records a canonical hash that covers this body
(`packages/minspec/src/lib/approval.ts:4-8`) and reads as stale once the hash stops matching
(`resolveStatus`, `:483-490`), so an approval of this text covers these selections and
changing one afterwards voids it. When the lines were written no approval of this spec had
landed on `main` (`status: specifying`, `clarify: pending`). A question in this section with
no **Recorded selection** line is still open.

### DQ-1 - May Refresh Harness Files opt a folder in?

**Recorded selection: Option A,** no: Refresh refuses in a folder with no `.minspec/` and
points at Initialize.

- **Option A - no; Initialize is the one opt-in gesture (rec).** The README tells a user to
  read what Initialize produces "before you accept Initialize"
  (`packages/minspec/README.md:45`, `:53`), and describes Refresh as merging templates into
  files that already exist (`:231`). A second command that performs the same setup under a
  name that does not say so goes round that. *Cost:* anyone who used Refresh to set up a
  folder now gets a refusal and one more step, and the test fixtures that call
  `refreshHarnessFiles` on an empty directory have to create the marker first (16 test files
  reference that function).
- **Option B - yes; treat Refresh as a second opt-in.** *Cost:* two commands create the
  marker, the inventory's "exactly one way in" becomes two, and a command titled "Refresh"
  installs git hooks and workflows in a project that never ran Initialize.

### DQ-2 - What does a refused command do?

**Recorded selection: Option A,** it refuses before asking anything and shows one message
that names Initialize, with no button.

- **Option A - refuse first, one message, no button (rec).** FR-6 and FR-8. *Cost:* the
  user has to open the Command Palette and run Initialize themselves, and the commands stay
  visible in the palette in folders where they will be refused.
- **Option B - the same, plus an Initialize button on the message.** *Cost:* an error
  toast whose only button opts the folder in is easy to click through, which is the
  rubber-stamp shape constitution principle 2 warns about; the setup toast already offers
  that button at activation (`auto-bootstrap.ts:598-610`).
- **Option C - do not refuse; remember the value in editor storage until the folder opts
  in.** What #2355's fix did for toast answers. *Cost:* a session scope, a code link or an
  approval held in editor storage has no reader: the drift check, the heartbeat and the
  CodeLens read files under `.minspec/` (`extension.ts:1008`, `presence.ts:711`,
  `codelens-provider.ts:69`). It also needs a decision record, because DR-078 §3 names one
  store for what MinSpec itself writes.

### DQ-3 - Park Topic when GitHub cannot take the topic and the folder has not opted in

**Recorded selection: Option A,** refuse the local file, say so, and hand the typed text
back.

- **Option A - no local file; say it was not saved; put the text in an untitled editor
  (rec).** FR-7. The GitHub path stays available before opt-in. *Cost:* a user without `gh`
  cannot park anything in a folder they have not initialized, and the hand-back is one more
  thing to build and test.
- **Option B - keep a parking lot in editor storage before opt-in.** *Cost:* a second
  parking lot nobody can open, since the local one is a Markdown file the user reads.
- **Option C - refuse Park Topic entirely before opt-in.** *Cost:* removes a path that
  writes nothing into the folder and that the README lists as available on request
  (`README.md:33-35`).

### DQ-4 - How far does the one directory operation reach?

**Recorded selection: Option A,** every directory the extension creates inside a workspace
folder.

- **Option A - every in-folder directory creation (rec).** FR-4 and FR-9. The rule the test
  checks then has no judgement in it: direct calls exist in five named files and nowhere
  else. It also closes the settings route, which was measured. *Cost:* eight files change
  (eleven call sites, one line each) although six of them have no route into `.minspec/`
  today, which widens the diff and its overlap with open pull requests. The six write to a
  fixed place (`claude-settings.ts:36`, `slash-commands.ts:382`, `:394`,
  `tool-detector.ts:15-22`) or take their directory from config, with no caller passing a
  setting in (`epic.ts:91-93`, `spec-manager.ts:359-360`, and `spec-layout.ts:272-273`
  beneath it; searched for calls of `createEpic`, `writeEpicIndex` and `applyEpicReorder`).
- **Option B - only the writers whose destination is under `.minspec/`; list the rest in the
  inventory with their destination.** *Cost:* the inventory then carries eight more files
  whose only justification is a reviewed note about where the directory lands ("this one
  writes to the specs directory"), which the test cannot check, and the settings route needs
  a special case of its own.

### DQ-5 - Writes outside `.minspec/` before opt-in: in this spec or not?

**Recorded selection: Option A,** not in this spec. Both are tracked.

- **Option A - out of scope, filed (rec).** This spec is about the marker. Two neighbouring
  things were found while tracing and are filed:
  [#2461](https://github.com/AIClarityAU/minspec/issues/2461) (the decisions watcher rewrites
  `docs/decisions/INDEX.md` in any folder, with no command run) and
  [#2462](https://github.com/AIClarityAU/minspec/issues/2462) (which commands may write
  other files before opt-in). *Cost:* after this spec is built a folder that never opted in
  can still gain files MinSpec wrote. The first of those is ambient, so it bears on the
  preview release on its own and is not unblocked by this spec.
- **Option B - absorb both here.** *Cost:* the second is a product decision about a dozen
  commands, not a defect, and would hold a release-blocking fix behind it.

### DQ-6 - Sequencing against work already in flight

**Recorded selection: Option A,** build on whatever `main` holds when Plan starts.

Four things overlap. [SPEC-086](../SPEC-086-remove-scroogellm-upsell/requirements.md) is
approved and deletes `bridge.ts` and the export command, with no build pull request open.
Pull request #2265 (the ownership guard runs after the approval write) reorders `approve.ts`
and `approval.ts`. Pull request #2458 (the SPEC-085 build) rewrites the README section that
holds the Park Topic sentence. Pull request #2436 (cleanup of the store #2355's fix added)
edits `auto-bootstrap.ts` and `bootstrap-opt-in-invariant.test.ts`.

- **Option A - do not wait; the requirements name behaviour, not line positions (rec).** If
  `bridge.ts` is gone when this is built, row 8, its command and its inventory count do not
  exist; if it is still there it gets the same one-line treatment and SPEC-086 deletes it
  later. *Cost:* one file may be edited by this change and deleted by the next, and whichever
  of these lands later resolves conflicts in `approve.ts`, `auto-bootstrap.ts` and the README.
- **Option B - wait for all four to merge.** *Cost:* a fix that gates the preview release
  waits on unrelated work with no date.

## Why no new DR

The recommended options apply DR-074 as written: the marker is `.minspec/`, and this makes
the extension's own writes respect it. They add no store, no setting and no new kind of
consent, and every part is a revertable diff, so the reversibility filter (can it be undone
in under a day) is met. A decision record becomes necessary only if DQ-2 resolves to Option
C, because a store in editor storage for anything beyond toast answers widens DR-078 §3; the
spec must not proceed to Plan on that option without one.

## Out of Scope

- **Folders already marked by an earlier build.** #2365 (folders the #2355 bug marked stay
  opted in), held for a human decision. Nothing here treats such a folder differently.
- **The decisions watcher's write to `docs/decisions/INDEX.md`.**
  [#2461](https://github.com/AIClarityAU/minspec/issues/2461) (DQ-5).
- **Commands that write files outside `.minspec/` before opt-in.**
  [#2462](https://github.com/AIClarityAU/minspec/issues/2462) (DQ-5).
- **Where the marker is looked for.** It is read at the workspace-folder root, so a
  sub-folder of an opted-in repository reads as not opted in, and FR-8's message there points
  at an Initialize that would create a nested project.
  [#2464](https://github.com/AIClarityAU/minspec/issues/2464).
- **Hiding commands that will be refused.** A context key and `when` clauses could remove
  them from the palette and the Specs pane in a folder that has not opted in. A possible
  later refinement; it would not replace the refusal, because the palette is not the only
  route: `Alt+A` reaches Approve Spec without it (`package.json:274-278`).
- **Prose rules on machine-wide surfaces.** #1150 (the containment invariant is prose-only),
  which is about `~/.claude` and similar, not the extension's writes.
- **Initialize replacing an existing `core.hooksPath`.** #2406.
- **Removing the conformance export.** SPEC-086 (DQ-6).
- **What a spawned `git` does to the working tree.** FR-9 states this limit.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 section 4).

- **Fixing the ten rows one by one, as the issue suggests.** Rejected: the issue's list
  missed an eleventh writer and the Refresh route, both found only by tracing, and a list
  fixed by hand says nothing about the twelfth.
- **A check at the commands only.** Rejected: that is where #2355 started. The store kept
  its `mkdir`, and the next caller reintroduced the defect.
- **A check at the stores only.** Rejected: Approve flips the spec's `status:` and writes a
  git ref before any store is reached (`approve.ts:345-346`, `approval.ts:140-153`), so a
  store-level refusal would leave a spec that reads as approved with no approval, and three
  commands would ask their questions and then fail.
- **An `fs` spy in the test that fails on any `mkdir` of `.minspec`.** Rejected: it cannot
  tell the creator from an offender without reading call stacks, and the directory listing
  already measures the outcome.
- **Advertising "MinSpec writes nothing until you run Initialize" in the listing.** Rejected
  for now: it is false until #2461 and #2462 are settled, and a listing claim this spec
  cannot make true is the defect SPEC-085 exists to remove.
- **Claiming the stores under `implements:`.** Rejected: they have owners or are shared, and
  this spec changes one line in each. The guard module and its three tests are what it
  creates.

## Test plan (for the Plan phase to place)

- **T0, before implementation:** `opt-in-guard.test.ts` (FR-11),
  `opt-in-writer-inventory.test.ts` (FR-9) and `commands-opt-in-invariant.test.ts` (FR-10),
  the last two shown red on the current tree.
- **T3, inside the command test:** each measured route in FR-10 is a named regression case.
- **Not vacuous:** each refusal is removed one at a time (a mutant per store and per
  command check) and the suite is shown to turn red, with a clean control run, as the fix for
  #2355 did with twelve mutants.
- **Existing tests that change:** fixtures that let a store create `.minspec/` create it
  themselves. `bootstrap-opt-in-invariant.test.ts` and `presence-opt-in-invariant.test.ts`
  are not edited by this change.

## Traceability

- **Issue:** [#2364](https://github.com/AIClarityAU/minspec/issues/2364).
- **Earlier instances of the same shape:** #2328 (the presence heartbeat, fixed by pull
  request #2357), #2355 (the setup toast, fixed by pull request #2366, whose store-level
  refusal this generalises) and #2356 (the terminal variable, fixed by pull request #2430).
- **Follow-ups filed from this spec:**
  [#2461](https://github.com/AIClarityAU/minspec/issues/2461) (ambient index write),
  [#2462](https://github.com/AIClarityAU/minspec/issues/2462) (commands that write outside
  the marker), [#2464](https://github.com/AIClarityAU/minspec/issues/2464) (where the marker
  is looked for).
- **Adjacent, not absorbed:** #2365 (already-marked folders), #1150 (prose rules on
  machine-wide surfaces), #2406 (`core.hooksPath`), #2367 (cleanup of the pre-opt-in store).
- **Governing decisions:** [DR-074](../../../docs/decisions/DR-074.md) (blast radius and the
  marker), [DR-078](../../../docs/decisions/DR-078.md) (the one store MinSpec itself writes),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate),
  [DR-086](../../../docs/decisions/DR-086.md) (acting on a recommendation, and recording
  what was not taken).
- **Specs this touches:** [SPEC-026](../SPEC-026-session-presence/requirements.md) (presence,
  whose one `mkdir` moves to the shared operation),
  [SPEC-086](../SPEC-086-remove-scroogellm-upsell/requirements.md) (deletes one of the
  writers).
- **DR for this spec:** none, by design; see "Why no new DR" for the one condition that
  would require it.
