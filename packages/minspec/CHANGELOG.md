# Changelog

All notable changes to the MinSpec extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.27] - 2026-10-04

The preview release for the VS Code Marketplace, and the first version built for publishing since 0.1.16. Versions 0.1.17 to 0.1.26, below, were local builds, so an update from 0.1.16 brings everything from 0.1.17 on. This section lists what changed after 0.1.26.

Numbers in parentheses, here and below, are pull requests or issues at github.com/AIClarityAU/minspec.

**A `.minspec/` folder you never asked for.** A `.minspec/` folder that holds only `preferences.json`, in a project you never initialised, is left over from an old bug: declining or closing the setup toast used to create it. MinSpec reads any `.minspec/` folder as "this project is initialised", so delete that folder. The setup toast can then appear once more, and declining or closing it no longer creates anything in the project (#2355, #2365).

### Added

- **MinSpec: Tidy Checkout (discard redundant copies)** - lists changed files whose content is byte-identical to the remote's default branch, and discards them once you confirm. A file that differs is never touched (#1712, #1721, #1727).
- **`minspec.approvalPr`** (`auto` or `manual`) - after an approval is pushed to a side branch, MinSpec can open the pull request for you through your own `gh` (#1224, #1672). It creates the `docs-lane` label the first time one is needed (#2259).
- An approval that the protected-branch guard refused is recovered, not left stranded (#1255).
- The running build shows which commit it was built from, and warns when it is older than the checkout it is running against (#1477, #1568, #1763).
- Initialize now also writes `.minspec/labels.md`, an issue-label vocabulary with a copy-and-paste script. MinSpec never creates those labels itself (#1251).
- Initialize now also writes a secret-scan workflow (`.github/workflows/secret-scan.yml`), the CI counterpart of the optional local gitleaks check (#1950).
- The Next Task signpost names pending implementation work, not only pending reviews (#1467).
- The generated `CLAUDE.md` gains five methodology sections, a convention for marking and repeating actions that wait on a human, and a rule that a decision put to a human carries a recommendation and its cost (#1562, #1235, #1341, #1299).
- New decision records get an "In plain terms" section (#1766).
- A new project starts with the spec-ownership rule enforced when none of its specs would fail it, and as a warning otherwise (#2264).

### Changed

- **The listing is marked as a preview** (`"preview": true` in the manifest).
- **The Backlog pane contacts GitHub only when you ask.** It loads nothing until you run **MinSpec: Refresh Backlog (contacts GitHub through your gh CLI)** from the Command Palette, the pane's title bar or its "Backlog not loaded" row. It no longer fetches when it is drawn, when the window regains focus or when the pane becomes visible, and a loaded list shows when it was loaded (#2329).
- **The README's account of the network was wrong and has been replaced.** It said that three commands run your local `gh` CLI and that nothing else contacts a network, and the 0.1.6 and 0.1.9 entries below, left as written, repeat the three-command count. In fact the Backlog pane fetched without being asked, and other features run `gh`, `git` and `claude` too. The README section "What MinSpec Does on Your Network" now lists every case (#2329, #2457).
- **Licence: everything is MIT.** The bundled `@aiclarity/shared` package moved from MPL-2.0 to MIT, so the extension no longer ships a second licence (#1435).
- MinSpec stopped writing machine-wide configuration (#1405).
- Files MinSpec declares machine-local are removed from the git index when they were already tracked, not only added to `.gitignore`, and MinSpec says so when it does it (#1146).
- `minspec.ruleset.requiredChecks` now defaults to empty. It used to default to `lint` and `test`, and a required check that nothing reports blocks every pull request (#1671).
- The getting-started walkthrough explains the way of working (why ceremony follows scope, what you are asked to verify, the next-task signpost) where it used to tour the buttons (#156).
- Setting descriptions no longer cite internal decision-record and issue numbers (#2408).
- A new project's `.minspec/config.json` has an `autonomy` key, set to `ask`. MinSpec checks the value when it reads the file and does nothing else with it (#1795).
- Correction to the 0.1.7 entry below: publishing never ran the supply-chain scan, only packaging did. The scan was attached to a script name (`prepublish`) that the publishing tool does not run. That script is removed, and the documented release steps now package first and publish the packaged file (#2411).

### Removed

- **The ScroogeLLM install prompt is gone**, and so are the two settings and the command that existed for it: `minspec.scroogellmNudge.enabled`, `minspec.conformance.enabled`, and **MinSpec: Export Traceability for ScroogeLLM**, which wrote `.minspec/traceability-export.json`. ScroogeLLM is not published, so the prompt recommended an extension nobody could install. MinSpec also no longer looks in your home directory and at your installed extensions for other AI tools, which it did only to word that prompt. If either setting is in your `settings.json` it now does nothing and can be deleted (#2205).

### Fixed

- **A checkout with Windows line endings (CRLF) now works like any other.** Accept Decision no longer puts a second frontmatter block in front of a decision record, Refresh Harness Files no longer appends every section of `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, the constitution and the labels file a second time, and Approve Spec no longer fails with "No frontmatter block". The decision and epic lists, the Next Task signpost and the status checks read a CRLF file the same as its LF copy. A file MinSpec edits keeps its own line endings, so git sees only the lines that changed; files MinSpec creates are written LF, and a hook or script under MinSpec's LF pin that a CRLF checkout broke runs again after one Refresh (#2397).
- **The presence heartbeat no longer creates `.minspec/` in a folder that never opted in.** It used to create `.minspec/sessions/` in any folder you opened (#2357).
- **Only Initialize creates `.minspec/`.** Refresh Harness Files no longer sets up a folder that was never initialized; it says so and points you at **MinSpec: Initialize SDD Structure**. Declare Session Scope, Link Code to Spec Requirement, Propose Constitution (draft) and Approve Spec for Implementation used to create `.minspec/` as a side effect in such a folder; they now ask for Initialize first, and write nothing. Park Topic can still create a GitHub issue there, but no longer writes a local parking lot: if the issue cannot be created it says the topic was not saved and hands your text back in an untitled editor (#2364).
- Declining or closing a setup toast no longer creates `.minspec/preferences.json` in a project that was never initialised. The answer is kept in VS Code's own per-workspace storage (#2355).
- The `MINSPEC_SESSION_ID` terminal variable is set only in an initialised project. It used to be added to the terminals of every window (#2356).
- The decision index (`docs/decisions/INDEX.md`) is no longer rewritten in a project that was never initialised when a file in the decisions folder changes (#2461).
- Choosing "Always" on the AI-backfill, push or phase-advance prompt now warns when the choice could not be saved, as in a project that was never initialised. It used to look saved, and the question came back (#2506).
- **Windows:** the hooks, scripts and workflows Initialize writes are pinned to LF line endings by a `.gitattributes` block, which Initialize and Refresh Harness Files add. With `core.autocrlf` set to `true`, a later checkout used to turn the hooks into CRLF files that no shell could run, and every commit failed (#2398).
- **Windows:** the pre-commit hook no longer takes a Python that is on the PATH for a Python that runs. It starts `python3`, `python` and `py -3` in turn and falls back to its shell checks when none starts, so the Microsoft Store placeholder `python3.exe` no longer blocks a commit (#2400).
- **Windows:** Accept Decision no longer takes a decision record that is already committed for a new one. An uncommitted edit to it could be committed first, under a `chore(adr): add ...` message, ahead of the acceptance (#2402).
- **Windows:** Tidy Checkout's check for another window on the same checkout compares folders by their real path, so two spellings of one folder (drive-letter case, short names) no longer read as two folders (#2403).
- The four Windows fixes above and the CRLF fix were tested on Linux, by imitating Windows. MinSpec's automated tests do not run on Windows.
- A failed GitHub fetch is reported as a failure, with the reason. The Backlog pane, Score Issue (WSJF) and Quick Triage Inbox Issue used to report no issues when `gh` was missing, signed out, offline or rate limited, and a failure that only mentioned "auth" was reported as not signed in (#2247, #2459).
- An open issue labelled `done` is listed in the Backlog pane, under "Done, still open". It used to be left out of the pane (#2460).
- The Next Task signpost no longer asks you to approve a spec that is already `done` and that no approve command will act on (#2370).
- Frontmatter keys MinSpec does not model (`implements:`, `depends_on:` and the like) survive when it rewrites a spec. Ticking a task in the spec panel and Migrate Spec Layout used to drop them (#2324).
- Refresh Harness Files no longer deletes content you wrote yourself, and no longer renames the project after the folder it happens to run in (#1755, #1536).
- One Refresh Harness Files is enough to carry a new draft entry of the constitution into `.cursorrules`. It used to take a second Refresh (#2520).
- Approving a spec is refused when the spec cannot satisfy the status the approval would give it, and finished or superseded specs are no longer offered for approval (#1364, #2117).
- "Always" on the classify prompt is honoured. It used to be written to a store the prompt never read (#2096).
- A frontmatter key written as a block list (for example `implements:` followed by `- path` lines) is read in full; only its first item used to be read. Status writes touch only the top-level `status:` key (#1976, #2282).
- A status line whose own prose negates a status word is left alone, where it used to be rewritten to say the opposite (#1836, #2287).
- The AI-assisted epic backfill is no longer cut off part-way, and no longer creates empty epics (#1572, #1580).
- MinSpec no longer assumes the git remote is called `origin` (#1553).
- A failed phase-advance request shows a warning where it used to fail silently (#1761).
- A commit refused in the middle of a merge now says why (#1443).
- The Next Task signpost no longer shows raw `tasks.md` markup (#1770).
- The generated harness passes the checks it generates, and the secret check prints the finding it tells you to review (#1539, #1551).
- A second toast repeating the approval message is gone (#1701).

## [0.1.26] - 2026-07-31

Versions 0.1.17 to 0.1.26 were built and installed locally and were never published. The VS Code Marketplace held nothing newer than 0.1.16 while they were built.

### Added

- Initialize writes a Claude Code session-title hook under `.claude/hooks/` and registers it in the project's `.claude/settings.json` (#1107).

### Changed

- The scaffolded AI review panel runs concurrently, and names an absent reviewer and the reason (#1086, #1102).

### Fixed

- The "commit harness files" offer no longer warns about a commit that was never going to happen, and its check for pending changes ignores your personal git configuration (#1123, #1128).

## [0.1.25] - 2026-07-31

### Added

- **The scaffolded pre-commit hook refuses a commit made directly on the default branch** when the project has a remote, because such a commit usually cannot be pushed. Allow it once with `MINSPEC_ALLOW_MAIN=1`, or for good with `git config minspec.allowCommitOnDefaultBranch true` (#1041, #1057).
- The approval-provenance script used by the scaffolded AI review is shipped to projects (#1098).

### Fixed

- The harness-commit offer resolves where the commit will go before it writes anything, so it stops stranding work on the default branch (#1054, #1089).
- Outward-facing documents (README, listing text, site copy) no longer qualify for the low-risk automatic pass in the scaffolded review (#1088).

## [0.1.24] - 2026-07-29

### Added

- **`minspec.pushOnApprove`** (`never`, `prompt`, `always`; default `prompt`) and **`minspec.protectedBranches`**. After an approval is committed MinSpec offers to push it, and on a protected branch pushes it to a new branch at the same commit, so a sign-off is not stranded on one machine (#1023).

### Changed

- The scaffolded AI review states which reviewers actually ran (#990).

## [0.1.23] - 2026-07-27

### Added

- A `planning` status, with its own lane in the Specs pane, for a spec that is approved but not yet being implemented (#900).
- Initialize writes the docs-lane workflow (`.github/workflows/docs-lane.yml`), which merges documentation-only pull requests that carry the `docs-lane` label once checks pass (#977).

### Fixed

- The decision-record status check no longer skips status lines written with emphasis (#987).

## [0.1.22] - 2026-07-26

### Changed

- **Go to Next Review Task** moved from `Ctrl+K Ctrl+N` to `Alt+N`, and the status bar tooltip shows the shortcut (#935).

### Fixed

- The scaffolded validation check fails when it cannot validate. It used to pass without running (#933).
- Refresh Harness Files keeps a consistent record of what it generated (#939).

## [0.1.21] - 2026-07-25

### Changed

- The generated `.gitignore` entries include `.claude/worktrees/` (#892).

## [0.1.20] - 2026-07-25

The largest step in this list: seven weeks of work, built and installed locally.

### Added

- **`Alt+A` approves or accepts whatever is open** - a spec, a decision or an epic - through one command, *MinSpec: Approve/Accept Active*, including from a Markdown preview (#308, #378).
- **Approvals are recorded in the repository.** Each approval is a file under `.minspec/approvals/` naming who approved what, bound to a hash of the approved text, so an edit after approval shows as stale. *MinSpec: Show Changes Since Approval* opens the difference (#451).
- **`minspec.commitOnApprove`** (default on) commits the approved document and its record together in one commit (#576).
- **`minspec.approverEmail`** names the human recorded as approver. An approval is refused when the identity belongs to an agent or bot.
- **Next Task signpost** - a status bar item and the command *MinSpec: Go to Next Review Task* name the one thing waiting on you (#288).
- **Git hooks and CI that work outside the editor.** Initialize writes `.minspec/hooks/` (pre-commit and commit-msg), points the repository's `core.hooksPath` at it, and writes a validation workflow, so the same checks run from a terminal, another editor or an AI agent (#319, #311).
- **AI review workflows.** Initialize writes `ai-review.yml`, `ready-to-merge.yml` and `ai-review-retry.yml`, with their scripts and reviewer prompts. The review itself is skipped, with a notice, until you add the secrets `ai-review.yml` names (#564).
- **Constitution commands** - *Propose Constitution (draft)*, *Show Constitution Generation Prompt* and *Compact Constitution* (#324, #629).
- **Slash commands** for AI tools are generated with a `minspec-` prefix (`/minspec-specify`, `/minspec-plan`, ...), `/minspec-constitution` and `/minspec-checklist` were added, and Refresh keeps them up to date (#534, #685, #321).
- **MinSpec: Push docs via lane** (`Ctrl+K Ctrl+P`) gathers documentation changes, asks, and opens a pull request for them (#797, #800).
- **MinSpec: Commit Harness Refresh** re-offers the commit of generated files when the first offer was missed (#790).
- After Initialize: an offer to commit the generated files (#287), a prompt for the project's minimum test coverage (#553, `minspec.coverage.minimumPercentage`), and an offer to create a branch ruleset that requires the generated checks (#365, #392, `minspec.ruleset.requiredChecks`).
- **`minspec.advancePhaseOnApprove`**, **`minspec.autoBackfillUseAi`** and **`minspec.manualCreate.enabled`**.
- *View Design* and *View Tasks* in the Specs pane's context menu (#472), drag-and-drop ordering of epics (#309), and remembered expand and collapse state (#739).
- Every spec gets a `tasks.md`, with an offer to create missing ones (#335).
- A rework chart (the "trust dashboard") in the spec panel (#354).

### Changed

- **The tier is a floor, not a difficulty score.** The classifier measures how far a change reaches, and its tier only ever raises ceremony. The percentage "confidence" was removed from the toast and the spec panel, and the three `minspec.thresholds.*` settings were removed (#333, #483).
- Initialize no longer creates an empty `DESIGN.md`; a pristine one left by an earlier version is offered for removal (#311, #317).
- All of MinSpec's machine-local state is added to `.gitignore` (#223).
- Tree clicks open the document in preview and focus the editor (#752).
- Multi-root workspaces: commands act on the folder you mean, and the tree views cover every workspace folder (#484, #572).
- `minspec.autoClassifyOnCommit` takes effect without a window reload.

### Fixed

- Specs with Windows (CRLF) or old Mac (CR) line endings are read correctly. They used to be dropped (#153).
- Two `keybindings` arrays in the manifest silently dropped shortcuts (#387).
- Refresh Harness Files stopped overwriting populated constitution sections, heals files whose markers were stripped, and no longer duplicates the slash-command section in `AGENTS.md` (#706, #617, #628, #518).
- The body `Status:` line is kept in step with the frontmatter when a status is written (#667).

## [0.1.19] - 2026-06-05

### Added

- **Status lanes in the Specs pane** - Specifying, Implementing, Done and Archived (#105).
- **MinSpec: Park Topic (force)**, and a choice when a matching issue already exists: open it, comment on it, or create a new one anyway (#136, #24).
- New decision records carry a "Costly to Refactor" section.
- Validator checks: a spec with no epic, unknown `status` or `tier` values, gaps and duplicates in decision record numbers, stub epic documents, and cross-file coverage for specs split across files (#137, #115, #41, #85, #111).
- The status bar completion figure accounts for the phases a tier skips (#38).

### Changed

- The approval marker in the Specs pane is a lock, not a tick: approved does not mean done (#101).
- Approve and Revoke default to the spec that is open, and skip specs already approved.
- Initialize and Classify are visible in the Command Palette again, and act on the right folder in a multi-root workspace (#123).
- Generated guidance refers to Command Palette commands. It used to refer to a `minspec` command-line tool that does not exist (#126).
- Approving a spec sets its status to `implementing`.

### Fixed

- The Specs pane shows real approval state (#100); Accept Decision and Set Decision Status work from the Command Palette, and from a Markdown preview (#110).
- *Go to Spec Requirement* finds specs in subfolders (#150).
- Context injected into AI tool files carries the spec's real frontmatter (#149).
- Refresh preserves sections that share a heading (#153).
- Initialize reports a failed write. It used to leave a partial `.minspec/` without a word (#153).

## [0.1.18] - 2026-05-31

### Fixed

- Done specs no longer show an Approve action, the approve tick matches the Decisions pane, and the epic toggle was dropped from the Backlog toolbar.

## [0.1.17] - 2026-05-31

### Added

- **Spec approval.** *MinSpec: Approve Spec for Implementation*, *Revoke Spec Approval* and *Check Spec Completeness*. A spec is checked for completeness before it can be approved.
- **Epics.** *Create Epic*, *Accept Epic*, *Regenerate Epic INDEX*, and group-by-epic toggles in the explorer panes.
- **MinSpec: Backfill Epics (AI-assisted)** proposes epics for existing specs. The AI pass runs your local `claude` command, only when you agree.
- **`minspec.specsLayout`** (`flat` or `spec-kit`) and *MinSpec: Migrate Spec Layout* to convert between one file per spec and one folder per spec (#21).
- Spec Kit style slash commands are registered for AI tools (#20).
- Initialize adds MinSpec's machine-local files to `.gitignore` (#1).
- Creating a decision record checks for an existing one with a similar title first.

### Changed

- The spec tree is titled "MinSpec: Specs".
- Generated harness files are updated inside marked regions, so Refresh changes only the parts MinSpec owns.

### Fixed

- The decision INDEX regenerates when a decision file changes.
- Specs in product or feature subfolders are listed.

## [0.1.16] - 2026-05-29

The newest version the VS Code Marketplace held when the listing was unpublished.

### Changed

- "Bug Session Protocol" was renamed RCDD (Root-Cause-Driven Debugging) in the listing and the generated templates.

## [0.1.15] - 2026-05-29

### Fixed

- The methodology diagram is readable on both light and dark backgrounds.

## [0.1.14] - 2026-05-29

### Changed

- The listing shows the methodology diagram as a static image and links to minspec.dev.

## [0.1.13] - 2026-05-29

- Published the 0.1.12 changes. No other change.

## [0.1.12] - 2026-05-29

### Added

- **Accept Decision** and **Set Decision Status** in the Decisions pane.
- Autocomplete for frontmatter values in Markdown files.

## [0.1.11] - 2026-05-28

### Changed

- **README badges restructured.** Tests, Coverage, "No AI Required", and "Internet not required" remain at the top (high-signal). License, VS Code version, TypeScript version, and CI status moved to the marketplace sidebar (`package.json` `badges` array) — same info, less visual noise above the fold.
- Renamed badge "Offline Core" → "Internet: not required" for plain-English clarity.
- First mention of "specification-driven development" in the README now links to [Spec Kit](https://github.com/github/spec-kit) — the upstream SDD methodology / file format MinSpec stays compatible with.
- Phase Lifecycle diagram regenerated with thicker connectors (4px solid for the T3/T4 path, 3px dashed for T1/T2 skip arrows) and bold phase labels for readability at marketplace render scale.

### Fixed

- **"MinSpec: Decisions" section title flicker:** Hovering the explorer pane no longer expands the title bar to "MinSpec: Create Architecture D…". The `minspec.createAdr` command now declares `shortTitle: "New ADR"` plus a `$(add)` icon, so VS Code renders it as an icon-only action button instead of stretching the full title.

## [0.1.10] - 2026-05-28

### Changed

- **Phase Lifecycle diagram** replaced inline Mermaid block with a pre-rendered PNG (`phase-lifecycle.png`). VS Code Marketplace doesn't render Mermaid; pre-render keeps the listing visually consistent. Source `.mmd` retained alongside the PNG so it can be regenerated.

## [0.1.9] - 2026-05-28

### Added

- **Status Bar screenshot** in README — visible example of the active-spec tier/phase/progress strip.

### Changed

- Merged "Harness Generator" and "AI Tool Integration" sections in the README into a single "What Initialization Produces — Files & AI Tool Integration" table that lists every file MinSpec creates or maintains (CLAUDE.md, AGENTS.md, .cursorrules, .clinerules, CONVENTIONS.md, .windsurfrules, DESIGN.md, .minspec/constitution.md, config.json, session.json, preferences.json, calibration.json, traceability.json, parking-lot.md, specs/, docs/decisions/) and which AI tool (if any) auto-loads each.
- **Listings aligned:** minspec.dev site language updated to match the accurate "extension binary makes zero network calls; three opt-in commands shell to local `gh` CLI" claim that already lives in the marketplace README. Meta description on the site updated from "no backend" to "offline core" for consistency with the README badge.
- Re-publish that also covers the 0.1.8 release content (0.1.8 had been published under a prior package — see the 0.1.8 entry below for the underlying feature set).

## [0.1.8] - 2026-05-28

### Added

- **Auto-bootstrap (detect + offer):** On activation, MinSpec detects missing `.minspec/`, harness template drift, or unclassified git changes and surfaces one toast at a time offering the appropriate setup action. Replaces the previous manual Ctrl-Shift-P workflow for first-time setup. Master toggle: `minspec.autoBootstrap.enabled` (default true). Per-prompt "Don't ask again" persisted to `.minspec/preferences.json`. See [DR-006](https://github.com/AIClarityAU/minspec/blob/main/docs/decisions/DR-006.md).
- **Auto-classify on commit** (opt-in): `minspec.autoClassifyOnCommit` setting (default false) installs a watcher on `.git/HEAD` and `.git/refs/heads/*` that auto-runs classification after each commit.
- **Real classify command:** `MinSpec: Classify Task Complexity` is no longer a Phase-2 stub — it analyses the current git diff via the existing classifier engine and reports tier, confidence, and suggested phases with an Override option.
- **Aider integration:** Aider (`CONVENTIONS.md`) added to tool detection and active-spec context injection alongside Claude / Cursor / Cline / Windsurf.
- **Detailed Decision Register INDEX:** New command `MinSpec: Regenerate Decision Register INDEX` (also a button in the **MinSpec: Decisions** sidebar) rewrites `docs/decisions/INDEX.md` with a heading per DR — clickable title linking to the DR file, status/date meta line, and a 40–80 word summary auto-extracted from each DR's Context section. Generation is fully offline (no AI dependency, Tier 0). Output is wrapped in `<!-- minspec:dr-index:start/end -->` markers so subsequent regenerations preserve any user-authored notes outside the auto block (invariant 6).

### Changed

- `MinSpec: Initialize SDD Structure`, `MinSpec: Refresh Harness Files`, and `MinSpec: Classify Task Complexity` are hidden from the Command Palette (`when: "false"`) — they remain programmatically callable but are now invoked via auto-bootstrap toasts.
- Marketplace screenshots recropped to remove distracting git toasts and tighten framing; `spec-panel.png` split into `spec-panel-stepper.png` and `spec-panel-tasks.png`.
- README rewritten: merged Harness Generator into Initialize section, added 5-phase Mermaid lifecycle diagram, clarified that MinSpec's session scope is distinct from chat-session scope, and replaced the manual-command Quick Start with the new toast-driven flow.

## [0.1.7] - 2026-05-28

### Changed

- Packaging and publishing now run a supply-chain scan of the dependency tree first. Build tooling only; the extension's behaviour did not change.

## [0.1.6] - 2026-05-28

### Changed

- The README's "zero network calls" statement was corrected: the extension itself opens no connection, but three commands run your local `gh` CLI.

## [0.1.5] - 2026-05-27

### Changed

- Marketplace listing republished to refresh CDN cache for icon and gallery images.

## [0.1.4] - 2026-05-27

### Fixed

- README images now use absolute URLs so they render correctly on the Marketplace listing page (relative paths only resolve inside the repo).

## [0.1.3] - 2026-05-27

### Fixed

- Path traversal validation hardened across spec/decision/parking-lot file operations.
- Webview Content Security Policy tightened to block inline scripts and remote sources.
- `.gitignore` and HTTP-style response headers cleaned up for the marketplace publish.

## [0.1.2] - 2026-05-27

### Fixed

- Marketplace metadata (publisher, repository, categories) corrected; lint errors that were blocking CI badges resolved.

## [0.1.1] - 2026-05-26

### Added

- Branded MinSpec icon (256×256) and 1280×280 gallery banner for the marketplace listing.
- Automated screenshot capture via VS Code extension-host e2e tests.
- Dynamic test and coverage badges generated from GitHub Actions.
- Privacy section in README with link to the AIClarity privacy policy.
- `.vscodeignore` for clean marketplace packaging.

### Fixed

- Operator precedence bug, `globalState` misuse, duplicated logic, status bar refresh issue.
- ScroogeLLM bridge: nudge surface, conformance contract, traceability export (Phase 10).

## [0.1.0] - 2026-05-26

### Added

- **Complexity classifier**: Multi-signal heuristic engine that analyzes git diffs (file count, line count, new exports, schema changes, dependency additions) and classifies changes into four tiers (T1 Trivial, T2 Standard, T3 Complex, T4 Architectural).
- **AST analyzer**: Regex-based heuristic analysis of JS/TS exports, classes, and schema files (Prisma, SQL, Zod) with a tree-sitter-ready interface for future upgrades. Graceful fallback when parsers are unavailable.
- **Classifier calibration**: Stores user tier overrides in `.minspec/calibration.json` and adjusts signal weights after sufficient override history.
- **Spec lifecycle manager**: State machine guiding specs through phases (specify, clarify, plan, tasks, implement, done/archived) with forward, skip, and back transitions.
- **Adaptive phase selection**: Automatically selects which SDD phases to execute based on the classified complexity tier. T1 skips clarify and plan; T4 requires full ceremony.
- **Spec CRUD operations**: Create, list, update, archive, and delete spec files with auto-generated IDs and tier-based phase sections.
- **Spec file format**: YAML frontmatter + markdown body, compatible with Spec Kit. Extended with optional `tier`, `status`, and `phases` frontmatter fields.
- **Config system**: Project-level configuration via `.minspec/config.json` with VS Code Settings UI integration for tier thresholds and directory paths.
- **Sidebar tree view**: Explorer panel showing all specs grouped by status (active, done, archived) with tier badge icons (T1-T4). Click to open; context menu for reclassification and phase transitions.
- **Active spec panel**: Webview stepper displaying the current spec's phase progress with status indicators (done, active, skipped, pending) and an interactive task checklist.
- **Status bar**: Displays active spec tier, current phase, and task progress. Click to open the active spec panel. Auto-updates on spec changes via file watcher.
- **Harness generator**: `minspec init` command generates CLAUDE.md, AGENTS.md, .cursorrules, DESIGN.md, and constitution.md from bundled Handlebars templates.
- **Merge-on-refresh**: `minspec init --refresh` merges template updates with user edits using section-level hashing. User-modified sections are preserved; unmodified sections are regenerated; new template sections are appended.
- **Constitution**: Project invariants and principles template linked to the classifier for tier threshold influence.
- **AI tool context injection**: Detects installed AI coding tools (Claude Code, Cursor, Cline, Aider, Windsurf, Copilot) and injects/removes active spec context into their configuration files.
- **Session discipline**: Scope declaration prompt, session state persistence in `.minspec/session.json`, file save monitoring for drift detection, and drift warning UI (park / add to scope / dismiss).
- **Parking lot**: Out-of-scope topics are filed as GitHub Issues via `gh` CLI with auto-labels and session context. Falls back to `.minspec/parking-lot.md` when `gh` is unavailable.
- **Eighteen commands**: init, refresh harness, classify, show status, refresh tree, declare scope, park topic, inject context, remove context, show spec panel, generate example spec, create ADR, score issue (WSJF), quick triage inbox issue, refresh backlog, go to spec, go to code, link code to spec.
- **Six configuration settings**: `specsDir`, `decisionsDir`, `thresholds.t1Max`, `thresholds.t2Max`, `thresholds.t3Max`, `codelens.enabled`.
