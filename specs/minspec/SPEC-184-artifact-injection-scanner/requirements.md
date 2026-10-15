---
id: SPEC-184
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - DR-048 (memory-poisoning defence by tier) and DR-030 (untrusted-data boundary) both live here
aspects: [security, prompt-injection, memory-poisoning, validator, diagnostics, unicode, tier-0, offline, no-silent-gate, blast-radius]
depends_on: [DR-048, DR-030, DR-004, DR-032]  # DR-048 decides this scanner exists, is Tier-0, static and advisory; DR-030 rejects sanitising as the primary defence; DR-004 the network tiers; DR-032 the egress gate this is the ingress twin of
relates_to: [SPEC-104, SPEC-133, SPEC-136, SPEC-016, DR-008, "#371", "#372", "#70"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Every file below is
# NEW and is needed under every answer to the decisions below: the artifact layer of the scan
# (Markdown awareness, framing and homoglyph rules, acknowledgements), its editor wiring, and
# their tests.
implements: [packages/shared/src/artifact-scan.ts, packages/shared/tests/artifact-scan.test.ts, packages/minspec/src/lib/injection-diagnostics.ts, packages/minspec/tests/injection-diagnostics.test.ts]
# Modified, not owned. `injection-scan.ts` is the pure detector SPEC-104 FR-1 declares and owns
# (in flight on branch agent/issue-70, not on main); this spec calls it and, under DQ-1's
# recommended option, may be the one that first creates it to SPEC-104's contract. The barrel
# export, the extension entry point and the command list in package.json gain one entry each.
affects: [packages/shared/src/injection-scan.ts, packages/shared/src/index.ts, packages/minspec/src/extension.ts, packages/minspec/package.json]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-184: Scan specs, decisions and agent memory files for injected instructions before an agent reads them

## In plain terms

Agents read this project's specs, decision records and memory files (`CLAUDE.md` and
friends) as trusted context. If someone plants an instruction in one of them, every later
agent turn obeys it. That is memory poisoning. This spec adds a check that runs offline,
inside MinSpec, over those files. It flags hidden characters, look-alike letters, fake
system or tool framing and "ignore your instructions" phrasing as warnings in the Problems
panel. It never edits a file and never blocks a commit, an approval or CI. A human reads the
warning and decides. Cost: this repo's own security writing quotes attack phrases, so some
warnings will be about text that is meant to be there. A human acknowledges each one once,
and the acknowledgement is tied to that exact text. Riskiest assumption: the false-positive
rate on real specs is low enough that people keep reading the warnings (not measured yet;
FR-12 measures it before ship).

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human reads
> it, answers or accepts the questions under
> [Decisions needed (Clarify)](#decisions-needed-clarify), and approves it through the normal
> spec-approval gate before any design or code. Every requirement below is written under
> each decision's **recommended** option. Picking a different option changes only the
> requirements that decision names.

Materializes **[#371](https://github.com/AIClarityAU/minspec/issues/371)**: *"feat: static
injection/memory-poisoning scanner - Tier-0 ingress validator for specs/DRs/memory"*. The
design rests on [DR-048](../../../docs/decisions/DR-048.md) Decision 2 ("MinSpec (Tier-0): a
*static* injection/poison **scanner validator** over local artifacts (specs, DRs, memory
files) - advisory, no network, no auto-edit") and on
[DR-030](../../../docs/decisions/DR-030.md)'s rejection of sanitising as a primary defence.

**Id note.** Ids `SPEC-097` to `SPEC-183` are already claimed by other branches (read from
local remote-tracking refs on 2026-10-15, base `5f792386`; no network check). Several ids in
that range are claimed more than once. That makes this `SPEC-184`. If it collides at review
time, renumber it.

## One-Sentence Scope

A pure, offline scan of the project's own agent-readable artifacts (specs, decision records,
the constitution and repo-local agent memory and instruction files) that reports injected
instructions, hidden or look-alike characters and forged prompt framing as advisory
diagnostics, with no edit, no block and no network.

## Context: what exists today (read at `5f792386`, not inferred)

- **Egress is gated, ingress is not.** DR-032 stops MinSpec emitting its own internal ids into
  user-facing output (`docs/decisions/DR-032.md`). Nothing scans what comes *in* to an agent
  from the project's artifacts. DR-048 Rationale 3 names this asymmetry.
- **The tool-grant surface is gated, the content is not.**
  `packages/minspec/tests/scripts-untrusted-tools.test.ts` stops a `claude -p` call that
  embeds untrusted issue text from also holding file or network tools. It says nothing about
  what the text contains.
- **No detector exists in shipped code.** A search of `packages/` and `scripts/` for
  zero-width, bidi, homoglyph and "prompt injection" terms finds only comments, base64 template
  payloads and the dispatcher's envelope prose. No function classifies text for injection.
  That is a search result over those terms, not proof of absence; Plan re-checks.
- **A sibling spec is in flight.** SPEC-104 (branch `agent/issue-70`, `status: specifying`,
  not on `main`) specifies a pure Tier-0 detector, `scanUntrusted()` in
  `packages/shared/src/injection-scan.ts`, with four rule classes: `envelope`, `invisible`,
  `override`, `exfil`. It is wired at the dispatch boundary, over issue bodies. It explicitly
  leaves artifacts to #371 (SPEC-104 table row G4).
- **An editor diagnostics pattern already exists.**
  `packages/minspec/src/lib/diagnostics.ts:202-250` registers one `DiagnosticCollection`,
  refreshes it on save, change and open, and reports at `DiagnosticSeverity.Warning`. This
  spec follows that pattern rather than inventing a new surface.
- **Validator severity is binary.** `ValidationViolation.severity` is `'error' | 'warning'`
  (`packages/minspec/src/lib/spec-validator.ts:36`), and an `error` makes `complete: false`.
  This scanner therefore does **not** feed `validateSpec`; see FR-9.

## Threat model

- **Asset:** the instructions an agent follows while working in this project.
- **Attacker:** anyone whose text reaches a scanned artifact without a careful human read: a
  contributor's PR, an agent that ingested a hostile issue or web page and wrote it into a
  spec or memory file, a pasted snippet, a dependency's vendored docs.
- **Vector:** text an agent reads as context but a human reviewing the diff or the rendered
  Markdown does not see, or does not read as an instruction. Examples: hidden characters,
  HTML comments (invisible in the preview), look-alike letters that dodge a reviewer's search,
  and text that imitates the harness's own system, tool-result or untrusted-data framing.
- **What this spec does not defend:** an agent that has already read poisoned text. Runtime
  defence (segregated memory, state-versus-guardrail checks, no-credential isolation) is
  SealBox / agent-execute work under DR-030 and DR-008 (DR-048 Decision 2, sealbox #1). This
  scanner lowers the chance poison sits unnoticed. It does not make an agent safe (INV-5).

## Functional Requirements

### Scope: which files

- **FR-1: the default scan set.** Every Markdown file under the configured `specsDir` and
  `decisionsDir` (`.minspec/config.json`; today `specs` and `docs/decisions`), plus
  `.minspec/constitution.md`, plus these repo-local agent memory and instruction files when
  present: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md` and `.github/copilot-instructions.md` at the
  repo root, and Markdown under `.claude/` and `.cursor/rules/`. Paths are resolved inside the
  workspace root. A symlink that resolves outside the workspace root is not followed, and is
  reported as one `scan.skipped-outside-root` information diagnostic so the skip is visible.
- **FR-2: no file outside the project by default (DQ-3).** Agent auto-memory that lives
  outside the repo (for example Claude Code's per-project memory directory under the user's
  home) is **not** scanned unless the user turns on an opt-in setting. That setting is
  machine- or application-scoped only. A workspace-committed setting must not be able to point
  the scanner at paths outside the workspace: a committed value outranks the user's own, so a
  cloned repo could otherwise make MinSpec read the user's home directory.

### The rules

- **FR-3: reuse the shared detector.** Rule classes `invisible` and `override` are SPEC-104's,
  called through `scanUntrusted()` and not restated. Rule ids, offsets and the
  `rulesetVersion` string come from that function. If SPEC-104 changes a shared rule, this
  scanner changes with it. SPEC-104's `envelope` class is reported too, under FR-5. Its
  `exfil` class is reported at Information severity only (DQ-2).
- **FR-4: `invisible`, made Markdown-safe.** On top of SPEC-104's set (Unicode tag characters
  U+E0000 to U+E007F; bidi embedding, override and isolate controls U+202A to U+202E and
  U+2066 to U+2069; zero-width and BOM characters U+200B to U+200D, U+2060 and U+FEFF except a
  leading BOM), the artifact layer:
  - does **not** flag U+200D (zero-width joiner) when it sits between two emoji code points,
    because that is how multi-person and skin-tone emoji are built, nor U+FE0F (variation
    selector-16), which this repo's own arrow marker for human action items (U+27A1 U+FE0F) uses;
  - **does** flag U+00AD (soft hyphen) and U+180E (Mongolian vowel separator) inside a word,
    and any C0 or C1 control character other than tab, line feed and carriage return.
- **FR-5: `framing` (new class, artifact layer).** Text that imitates a prompt's structure
  rather than its content: opening or closing tags of the dispatcher's untrusted-data envelope
  (SPEC-104 `envelope`), of harness framing elements (system reminders, function calls and
  function results), chat-template turn markers (for example `<|im_start|>` and a line that
  starts with `Human:` or `Assistant:` followed by a turn's content), and the pipeline control
  markers SPEC-104 FR-2 lists. Structural: ordinary prose seldom contains these.
- **FR-6: `homoglyph` (new class, artifact layer).** A single word that mixes Latin letters
  with Cyrillic or Greek letters (a mixed-script token in the sense of Unicode TR39). It is
  computed from Unicode script properties with no bundled confusables table (DQ-4). A word
  written wholly in one script is never flagged, so non-English prose is not.
- **FR-7: Markdown awareness, without a blind spot.** The scan reads the raw file bytes, not
  the rendered view. Text inside fenced code, inline code, block quotes and HTML comments
  **is scanned**, because a model reads all of it. Each finding records which of those it sits
  in. A heuristic (`override`) finding inside an HTML comment is raised to Warning, because a
  comment is invisible in the preview, so it is the place a planted instruction is least
  likely to be read by a human. Frontmatter is scanned like body text.

### Reporting

- **FR-8: severity.** Structural classes (`invisible`, `framing`, `homoglyph`, `envelope`) are
  `Warning`. Heuristic classes (`override`, `exfil`) are `Information`, except FR-7's
  HTML-comment case. Nothing is ever `Error` (DQ-1). Each diagnostic names its class, its rule
  id, the code point(s) as `U+XXXX` for invisible characters, and one sentence on why an agent
  might act on it. It never quotes more than the matched span.
- **FR-9: outside the validator's error path.** Findings go to their own
  `DiagnosticCollection` (source `minspec.injection`). They are not `ValidationViolation`s.
  They never set `complete: false`, never stop an approval, a commit, a phase move or a CI
  check, and are never written into any artifact.
- **FR-10: when it runs.** On open, change and save of an in-scope document, as
  `diagnostics.ts:202-250` does. Plus a palette command, **MinSpec: Scan Artifacts for
  Injected Instructions**, that sweeps the whole FR-1 set, including files nobody has open,
  and puts every finding in the Problems panel. It ends with one visible summary line: files
  scanned, files skipped and why, findings by class (DQ-5 covers an automatic sweep at
  activation).
- **FR-11: acknowledgement bound to the exact text.** A human can acknowledge a finding from
  its quick-fix. The acknowledgement is recorded in `.minspec/injection-acks.json` as the file
  path, the rule id and a SHA-256 of the matched span plus its surrounding line. An
  acknowledged finding is hidden. Any edit to that line, a move to another file or a new
  match of the same rule reopens it. There is no per-file, per-rule or global switch-off
  (see *Alternatives*). The command's summary line counts acknowledged findings separately, so
  a hidden finding is still counted.

### Measurement and failure

- **FR-12: measure before shipping.** Before release, a dev-time run of the FR-10 sweep over
  this repo reports findings per rule id. A human marks each as real or not, and the counts go
  into the Implement-phase PR. Any structural rule with more than 5 false positives on this
  corpus is fixed or moved to `Information` before ship. The red-team fixtures from #372
  (promptfoo, dev-time only per DR-048 Decision 1) feed recall tests once that harness exists.
  Until then, a hand-written fixture set in the unit tests is the floor.
- **FR-13: a broken scan is visible, never silent.** If the scanner throws, times out or
  returns a result that breaks the contract for a file, that file gets one
  `scan.failed` Warning naming the error, and the command's summary counts it. A failed scan
  is never shown as zero findings (constitution invariant 2). Unreadable files (permission,
  binary, over the size cap) are reported as skipped with the reason.
- **FR-14: bounded and pure.** `artifact-scan.ts` takes text in and returns findings. It does
  no I/O, no network, no clock and no randomness, and imports nothing from `vscode`, `http`,
  `https`, `net`, `node:fs` or `child_process`. Patterns are linear time: no nested
  quantifiers and no backreferences. Files over a size cap (Plan picks the number; 1 MB is
  the starting point) are skipped with a visible reason rather than scanned slowly.

## Acceptance Criteria

- **AC-1 (invisible):** a spec containing one U+E0041, or one U+202E, gets a Warning at the
  right line and column naming the code point. A file that only starts with a BOM gets none.
  A family emoji (U+1F468 U+200D U+1F469 U+200D U+1F467) and the arrow marker (U+27A1 U+FE0F) get none.
- **AC-2 (framing):** a DR whose body contains the closing tag of the untrusted-data envelope,
  or a line imitating a function-results block, gets a `framing` Warning, including when the
  tag is mixed case or has whitespace inside it.
- **AC-3 (homoglyph):** the word "paypal" with its second letter replaced by Cyrillic small a
  (U+0430) gets a Warning. A
  sentence written wholly in Russian or Greek gets none.
- **AC-4 (override, visible vs hidden):** "ignore all previous instructions" in body prose is
  `Information`. The same phrase inside an HTML comment is `Warning`.
- **AC-5 (scope):** a matching file under `packages/` or `node_modules/` gets no diagnostic.
  A matching `CLAUDE.md` at the root does. A symlinked `.claude/notes.md` that points outside
  the workspace is not read and produces the `scan.skipped-outside-root` notice.
- **AC-6 (opt-in boundary):** with the FR-2 setting set only in `.vscode/settings.json`, no
  file outside the workspace is read. Set at user (application) scope, the out-of-repo memory
  directory is scanned.
- **AC-7 (never blocks):** a spec with findings in every class approves, commits and passes
  `npm run validate` exactly as it would with none. `validateSpec` returns the same result
  with the scanner on and off.
- **AC-8 (never edits):** after a sweep and after an acknowledgement, every scanned file is
  byte-identical to before. Only `.minspec/injection-acks.json` changes.
- **AC-9 (acknowledgement binding):** an acknowledged finding stays hidden while its line is
  unchanged, comes back when one character on that line changes, and comes back if the same
  text appears in a different file.
- **AC-10 (fail visible):** a scanner forced to throw on one file gives that file a
  `scan.failed` Warning, the summary reports one failure, and other files are still scanned.
- **AC-11 (purity):** an import test like the existing Tier-0 import checks pins FR-14's
  forbidden imports for `artifact-scan.ts`.
- **AC-12 (total and linear):** a property test over random strings, including lone
  surrogates, an empty string and an input at the size cap, shows the scan never throws, and
  that time grows linearly when input *size* is varied, not only content.
- **AC-13 (no network):** a sweep with networking disabled finishes and reports the same
  findings.

## Invariants (must not break)

- **INV-1: offline core (constitution invariant 1).** No network call, no model call, no
  promptfoo at runtime. promptfoo stays a dev-time harness (DR-048 Decision 1).
- **INV-2: no silent gate (constitution invariant 2).** This is advisory, not a gate, but its
  own failure is still printed (FR-13). No `|| true`, no empty result standing in for a failed
  scan, and acknowledged findings stay counted.
- **INV-3: blast radius (constitution invariant 3).** It runs only in a workspace with
  `.minspec/` at the root. It reads nothing outside that workspace unless the user turns on
  FR-2 at user scope. It adds nothing to the scaffolded hooks, CI templates or managed
  `CLAUDE.md` regions an adopter receives (DQ-6).
- **INV-4: never edits content (DR-048 Rationale 4, DR-030).** No auto-fix, no stripping and
  no "remove invisible characters" quick-fix. The only quick-fix is the acknowledgement.
- **INV-5: honest claim.** No README, tooltip, log line or PR body may say this makes agents
  safe from injection or poisoning. It surfaces suspicious text. Pattern lists are bypassable
  (DR-030 Alternatives), and a clean scan means "none of these patterns", not "safe".
- **INV-6: existing gates unchanged.** `validateSpec`, the approval hash, DR-032's egress
  check, the reference diagnostics and `scripts-untrusted-tools.test.ts` behave exactly as
  before.

## Decisions needed (Clarify)

### DQ-1: Advisory only, or can a finding ever block?

- **A (rec): advisory only, everywhere.** As #371 and DR-048 Rationale 4 say. *Cost:* a
  planted instruction can still merge if the human ignores a Warning; the scanner only makes
  it visible.
- **B:** structural findings fail `npm run validate` and CI. *Cost:* contradicts DR-048's
  accepted "advisory, never auto-block", so it needs a superseding DR, and any spec that
  legitimately discusses a bidi attack becomes un-committable without an acknowledgement.

### DQ-2: Which rule classes ship in v1?

- **A (rec): `invisible`, `framing`, `homoglyph` at Warning; `override` at Information;
  SPEC-104's `exfil` at Information.** Matches #371's three bullets, plus reuse of SPEC-104's
  sets at no extra cost. *Cost:* `exfil` will fire on this repo's own security docs and shell
  snippets; at Information it is noise a reader can ignore, but it is noise.
- **B:** leave `exfil` out of the artifact scan. *Cost:* a spec that tells an agent to read a
  credential file or pipe a download to a shell gets no notice at all.

### DQ-3: Agent memory that lives outside the repo

#371 names "memory files". Claude Code's auto-memory (`MEMORY.md` and its entries) lives
under the user's home directory, not in the repo, and is the most direct memory-poisoning
target there is.

- **A (rec): off by default, user-scope opt-in setting (FR-2).** *Cost:* the highest-value
  target is unscanned for anyone who never finds the setting.
- **B:** scan it by default. *Cost:* MinSpec reads outside the project it was installed in,
  which stretches invariant 3, and the path is tool-specific and undocumented, so it can move
  without notice.
- **C:** never scan it; leave it to SealBox. *Cost:* the gap stays open until SealBox ships.

### DQ-4: How deep should look-alike detection go?

- **A (rec): mixed-script words only, from Unicode script properties, no data file.**
  *Cost:* misses a word spelled entirely in Cyrillic look-alikes (for example a word
  that looks like "papay" but is built only from U+0440, U+0430 and U+0443). It reads as Latin to a human but is one script, so
  nothing is mixed.
- **B:** bundle the Unicode TR39 confusables table and run its skeleton check against a list of
  sensitive words. *Cost:* a large data file to vendor and keep current, and a word list that
  someone has to choose.

### DQ-5: Sweep automatically at activation?

- **A (rec): no; on-open/save plus the palette command.** *Cost:* a poisoned file that came in
  through `git pull` or an agent's write, and that nobody opens, is not flagged until someone
  runs the command. That is the most likely route for poison to arrive.
- **B:** sweep the FR-1 set once at activation and on file-system change (a file watcher).
  *Cost:* extra work on every window open, and a Problems panel that fills with
  acknowledged-elsewhere noise on a first run in this repo.

### DQ-6: Ship to adopters, or this repo only first?

- **A (rec): ship in the extension, so every opted-in workspace gets it, with no change to
  scaffolded hooks or CI templates.** *Cost:* adopters see Warnings on their own
  security-writing on day one, before FR-12's precision numbers come from any corpus but
  ours.
- **B:** hide it behind an off-by-default setting for one release. *Cost:* nobody turns it on,
  so the measurement never comes in.

### DQ-7: Ordering with SPEC-104

Both specs need the same pure detector, and SPEC-104 owns its file.

- **A (rec): whichever spec is approved first builds `injection-scan.ts` to SPEC-104 FR-1's
  contract. Ownership stays with SPEC-104.** *Cost:* if this spec goes first, its Implement PR
  writes a file another spec owns, so the reviewer must check it against SPEC-104's FR-1 to
  FR-5, not just this spec.
- **B:** this spec waits for SPEC-104 to merge. *Cost:* #371 is blocked on a dispatch-boundary
  spec whose own decisions (author trust, hold versus advise) have nothing to do with it.

## Why no new DR

DR-048 already decides the irreversible part: a static, Tier-0, advisory scanner in MinSpec,
with runtime defence elsewhere and promptfoo dev-time only. Everything this spec adds (rule
classes, severities, the acknowledgement file, where the command lives) can be undone in under
a day. DQ-1 option B would need a superseding DR, because it reverses DR-048 Rationale 4.

## Out of Scope

- Runtime memory defence: segregated or time-limited memory, state-versus-guardrail checks
  (SealBox / agent-execute, DR-030, DR-008, sealbox #1).
- Scanning GitHub issue bodies at triage or dispatch (SPEC-104, #70).
- Any rewrite, strip or "clean up" of content (INV-4).
- Feeding findings into an agent prompt, for example warning the ai-review agent that a file
  was flagged. Possible later work; not filed, because it depends on DQ-1 and FR-12's numbers.
- The headless validator and tool server (SPEC-133, SPEC-136). FR-14 keeps the scan pure so
  either can call it later; wiring it there is their scope.
- Code and non-Markdown files.

## Alternatives considered and rejected

- **Sanitise on save** (strip invisible characters, defuse framing). Rejected by DR-030 as the
  primary defence and by DR-048 Rationale 4; it also hides the evidence a human needs.
- **Skip code fences, quotes and comments to cut false positives.** Rejected: a model reads
  them, so an attacker would simply put the payload there (FR-7).
- **Per-file or frontmatter opt-out** (for example an `injection_scan: off` key). Rejected:
  whoever plants the payload can plant the opt-out in the same edit. The hash-bound
  acknowledgement (FR-11) can't be forged that way without a human seeing the acknowledgement
  file change in the same diff.
- **Feed findings into `validateSpec`.** Rejected: its severity is error or warning, and every
  warning added there sits on the same list as approval-relevant checks (FR-9).
- **Use promptfoo at runtime to classify text.** Rejected by DR-048 Decision 1 (dev-time only,
  acquisition risk) and invariant 1 (it would mean a model call).

## Test plan (for the Plan phase to place)

- Unit: one fixture per rule id, a positive and a near-miss negative each (AC-1 to AC-4).
- Unit: Markdown-context tagging for fenced code, inline code, block quote, HTML comment and
  frontmatter (FR-7).
- Property: totality and linear time over varied input sizes (AC-12).
- Import purity (AC-11).
- Extension: scope resolution, symlink-out, user-scope versus workspace-scope opt-in
  (AC-5, AC-6), acknowledgement binding (AC-9), failure visibility (AC-10), byte-identity
  (AC-8).
- Non-interference: `validateSpec` and approval on a file that trips every rule (AC-7).
- Mutation check: remove one rule and confirm a test goes red, so the fixtures are not
  passing for an unrelated reason.

## Traceability

- Issue: #371. Sibling: #70 / SPEC-104 (dispatch boundary). Harness: #372 (promptfoo).
- Decisions: DR-048 (this scanner, by tier), DR-030 (untrusted data; no sanitising as
  primary), DR-008 (dispatch isolation), DR-032 (the egress twin), DR-004 (tiers).
- Runtime counterpart: sealbox #1.
