---
id: SPEC-097
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-007  # Agent Execute — the dev-time Claude-dispatch tooling in scripts/ is exactly where DR-015 keeps agent-side GitHub writes; MinSpec's own packages/minspec stays Tier 0
aspects: [agent-dispatch, parking-lot, gh-cli, tier-1, dev-time-tooling, dedup, cli-boundary]
relates_to: [DR-004, DR-015, DR-074, DR-066, SPEC-096, "#12"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038 FR-1/FR-2). Declaring
# after approval would edit the bytes the canonical hash covers and stale the sign-off. The
# wrapper script and its test are NEW and required under the recommended DQ-1 option; the
# other two DQ-1 options point `implements:` at packages/minspec instead (see DQ-1).
implements: [scripts/park-topic.ts, scripts/park-topic.test.ts]
# Modified, not owned. packages/minspec/src/lib/parking-lot.ts and
# packages/minspec/src/commands/park.ts have no `implements:` owner today (grepped across
# specs/*/SPEC-*/requirements.md); this spec reads their exports but claims neither file.
affects: [CLAUDE.md, scripts/roles/triage.md]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-097: A dev-time shim lets Claude park a topic through the same path the user's command uses

> **SPECIFICATION ONLY.** Nothing is built by the dispatch that produced this. A human
> reads it, checks its Clarify questions, and approves it through the normal spec-approval
> gate before any code changes. Each question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-02-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under each decision's recommended option, so approving
> the spec as it stands accepts those recommendations and leaves no question open. Choosing
> a different option changes only the requirements that decision names.

Materializes **[#12](https://github.com/AIClarityAU/minspec/issues/12)** — *"chat-side
auto-park trigger (Claude → gh issue)."* The issue asks for a `minspec park --json` CLI a
Claude session can call so that an agent-filed park issue gets the same title/body/label
shape, session-scope auto-fill and dedup check the user's own **MinSpec: Park Topic** command
already gets, instead of today's ad hoc `gh issue create` Bash call.

## One-Sentence Scope

Give Claude sessions one callable entry point that reuses `createParkingLotEntry` and
`parkTopic` (`packages/minspec/src/lib/parking-lot.ts`) — including the dedup gate, the
local-file fallback and session-scope auto-fill the VS Code command already has — without
adding a `minspec` shell command or a CLI surface to the shipped `aiclarity.minspec`
extension.

## Context — what exists today (read from `origin/main` 722e7b57f870, not inferred)

### The library code has no `vscode` dependency

`createParkingLotEntry`, `parkTopic`, `findExistingIssue`, `fileEntryExists`,
`appendToParkingLotFile` and `commentOnIssue` (all `packages/minspec/src/lib/parking-lot.ts`)
import only `fs`, `path`, `child_process` and the sibling `./github` module — no `vscode`
import anywhere in the file. **Measured:** `grep -n "^import" packages/minspec/src/lib/parking-lot.ts`
shows four import lines, none naming `vscode`. The VS Code-only parts live one layer up, in
`packages/minspec/src/commands/park.ts`: the three `showInputBox` prompts, the dedup-hit
`showQuickPick`, and `loadSession`/`resolveTargetFolder`, which both read plain files under
the resolved workspace folder and also carry no `vscode` API calls beyond folder resolution
(`park.ts:1-10`, `:42`, `:62`). So the library the command calls is already runnable from a
plain Node process; what is missing is a non-interactive caller.

### What Claude does today, per this repo's own instructions

`CLAUDE.md`'s Session Scope Protocol, Triage Rule 1, reads: *"Topic drift → GitHub issue, do
not act. File on the relevant repo with `inbox` label, report URL, continue original scope."*
No code path is named — the instruction is prose read by the model, carried out as a direct
`gh issue create` Bash invocation (the parking-lot-shaped issue body and labels composed ad
hoc per session). That direct path:

- never calls `normalizeTitle`/`findExistingIssue`, so it carries none of the dedup gate
  issue #24 added (`parking-lot.ts:28-35`, `:54-85`) — two sessions parking the same drift
  independently can each file a separate issue with no indication either checked;
- never calls `loadSession`, so the issue body has no session-scope line unless the model
  composes one by hand, inconsistently across sessions;
- has no fallback when `gh` is unavailable or the repo has no matching remote — the file
  path `appendToParkingLotFile` gives the VS Code command does not exist for a Bash-only
  caller unless the model also writes that file by hand.

### The constraint the issue's own proposal runs into

`CLAUDE.md:110-111`: *"MinSpec is a **VS Code extension, not a CLI.** Every command runs from
the Command Palette … — never write, suggest, or attempt a `minspec` shell command."* The
issue's literal proposal — `minspec park --json '{...}'` — is exactly that shell command.
[DR-004](../../../docs/decisions/DR-004.md) draws the same line architecturally: the parking
lot's `gh` delegation is Tier 1 ("Local Tool Delegation"), and DR-004 names DR-360 (parent
register, `~/code/mmo-platform/docs/decisions.md` — not a record in this repo's own register,
cited here only because DR-004 already cites it) as the decision that put it there.
[DR-015](../../../docs/decisions/DR-015.md) goes further for anything agent-dispatch-shaped
specifically: *"agent dispatch ships as a separate third Tier-1 'Execute' extension … never
embedded in either [MinSpec or ScroogeLLM] … `scripts/` remains the dev-time path for
building this monorepo."* [SPEC-074](../SPEC-074-dispatch-quota-classification/requirements.md)
is a live example of that pattern: a Claude-dispatch-facing change living in `scripts/`,
epic'd to EPIC-007, that touches no file under `packages/minspec`.

So a literal `minspec park --json` — a `bin` entry and argument parser shipped inside
`packages/minspec` — would reopen both lines at once: the CLI-surface ban and the
Tier-0/Tier-1 packaging split DR-015 drew specifically to keep agent-side GitHub writes out
of the extension users install. This spec does not take that path; DQ-1 below specifies the
alternative that gets the same reuse without it.

### The open question the issue itself raises, left open here

The issue asks: *"Is Claude reliably auto-parking today? Need session-log audit."* No session
log has been read for this spec — that would be a plausible-inference-vs-observation claim
this document is not in a position to make (Evidence Discipline, CLAUDE.md). Whether today's
ad hoc `gh issue create` path is actually missing drift, versus merely missing the dedup/
scope-fill polish the issue names, is unmeasured. This spec does not depend on the answer —
the dedup gap and the missing session-scope line are true by reading the code regardless of
how often parking happens — but the audit stays open as a separate, trackable item (Out of
Scope).

## Functional Requirements

- **FR-1 — One non-interactive entry point, outside the shipped extension.** A script at
  `scripts/park-topic.ts` (DQ-1) MUST accept the fields the issue's JSON shape names — `title`
  (required), `body` (default `""`), `labels` (default `["idea", "inbox"]`) — plus `source`
  for telemetry (FR-5), and MUST call `createParkingLotEntry` then `parkTopic` from
  `packages/minspec/src/lib/parking-lot.ts` with no wrapping, re-implementation, or
  duplication of their dedup, fallback, or GitHub-call logic.
- **FR-2 — Session-scope auto-fill, same source as the command.** The script MUST resolve
  the target folder the same way `packages/minspec/src/lib/resolve-folder.ts` does for a
  single-root workspace (a plain `cwd`-based equivalent — the script runs outside VS Code and
  has no multi-root workspace concept) and MUST call `loadSession` on it, passing the same
  `"${scope} (${project}, ${type})"` / `"No active session"` string `park.ts:72-75` builds
  into the entry's `sessionScope`, so an issue filed by the script and one filed by the
  command are shaped identically.
- **FR-3 — The dedup gate applies.** A call whose normalized title (`normalizeTitle`) matches
  an existing open issue or local heading MUST return the existing URL/path with
  `deduped: true` on stdout, exactly as `parkTopic` already does for the VS Code command —
  the script MUST NOT bypass or duplicate that check.
- **FR-4 — Structured, parseable result.** On success the script MUST print one JSON object
  to stdout: `{"method": "github"|"file", "url"?: string, "filePath"?: string, "deduped"?:
  boolean}` — the shape `ParkResult` already has — and exit 0. On failure to park by either
  method it MUST print a JSON error object to stderr (`{"error": string}`) and exit non-zero;
  it MUST NOT print a success shape when nothing was created (constitution invariant 2, no
  silent gate).
- **FR-5 — `source` is recorded, not just accepted.** When invoked with `source:
  "claude-auto-park"` (or any value), the script MUST append it as a trailer line in the
  issue body / file entry it creates (e.g. `_Filed via: claude-auto-park_`), giving the
  "telemetry on parking frequency" the issue asks for as a grep-able field rather than a new
  store — no counter, log file, or metrics endpoint is added (DQ-3).
- **FR-6 — `gh` unavailable is not an error the script invents.** Exactly as `parkTopic`
  does today, when `gh` cannot create the issue the script falls through to
  `appendToParkingLotFile` and reports `method: "file"` — the script adds no new failure mode
  beyond what the library already has.
- **FR-7 — CLAUDE.md names the one sanctioned path.** `CLAUDE.md`'s Triage Rule 1 MUST be
  updated to name `scripts/park-topic.ts` as the way a session files a drift issue, replacing
  the current unqualified "File on the relevant repo" prose, so a session reads one
  instruction instead of inventing a `gh issue create` call each time.
- **FR-8 — No new CLI surface on the shipped extension.** This change MUST NOT add a `bin`
  field, an argument parser, or any new entry point to `packages/minspec/package.json`, and
  MUST NOT add or alter any text in `CLAUDE.md`'s "Commands and locations" section (the
  CLI ban it states stays true).

## Acceptance Criteria

- [ ] Running `scripts/park-topic.ts` with a title that normalizes to match an existing open
      issue in a test repo returns `deduped: true` and files nothing new. (FR-3)
- [ ] Running it in a folder with an active session file returns an issue body containing that
      session's scope string, matching what `parkCommand` would have produced for the same
      session file. (FR-2)
- [ ] Running it with `gh` stubbed unavailable appends to `.minspec/parking-lot.md` and reports
      `method: "file"` on stdout, with no network call attempted. (FR-6)
- [ ] Running it with `source: "claude-auto-park"` produces an issue body / file entry
      containing that value. (FR-5)
- [ ] A run that fails to park by both methods exits non-zero and prints `{"error": ...}` on
      stderr, never a success shape. (FR-4)
- [ ] `packages/minspec/package.json` is byte-identical apart from any version bump; no `bin`
      field exists after this change. (FR-8)
- [ ] `CLAUDE.md`'s Triage Rule 1 names `scripts/park-topic.ts`. (FR-7)

## Invariants (must not break)

- **INV-1 — Offline core (constitution invariant 1, DR-004).** No code in
  `packages/minspec` or `packages/shared` gains a network import. The script's only network
  effect is the same `gh` CLI delegation `parkTopic` already performs, at the same point
  (after the script is explicitly invoked) — never at VS Code activation, never silently.
- **INV-2 — No silent gate (constitution invariant 2).** FR-4 and FR-6: a failure to park is
  never reported as success, and the script does not retry a failure into silence.
- **INV-3 — Blast radius (constitution invariant 3).** The script runs only when explicitly
  invoked in a repository already running the dev-time dispatch tooling; it creates no new
  file outside what `parkTopic` already writes (`.minspec/parking-lot.md`, only when `gh`
  is unavailable, only in a folder that already has `.minspec/` — unaffected by this spec).
- **INV-4 — The CLI ban stands (CLAUDE.md:110-111, DR-015).** FR-8. `aiclarity.minspec`
  gains no shell command; this capability lives in `scripts/`, the dev-time path DR-015 names.
- **INV-5 — One definition of the parking behaviour.** `parkTopic` and
  `createParkingLotEntry` are not forked or re-implemented; the script is a thin caller.

## Clarify selections (recorded by an agent 2026-10-02; ratified only by approval of this spec)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case. This repository runs with `"autonomy": "act"`
(`.minspec/config.json:58`), under which an agent proceeds on a stated recommendation and
leaves the options it did not take on record (DR-086 §2, §4); approving this T3 spec is what
ratifies the selections below, not this document's existence.

### DQ-1 — Where does the callable entry point live?

**Recorded selection: Option A,** a `scripts/` dev-time script, no change to
`packages/minspec`'s shipped surface.

- **Option A — `scripts/park-topic.ts`, calling the existing library functions (rec).**
  Matches DR-015's "`scripts/` remains the dev-time path" and SPEC-074's precedent of an
  EPIC-007 change living entirely outside `packages/minspec`. *Cost:* the script imports
  from `packages/minspec/src/lib/parking-lot.ts` across a package boundary `scripts/` does
  not normally cross — the import path and its build/test wiring are a Plan-phase question
  this spec does not resolve, and a future change to `parking-lot.ts`'s exports can break the
  script with no test inside `packages/minspec` to catch it (FR coverage for that lands in
  `scripts/park-topic.test.ts`, not the package's own suite).
- **Option B — a `bin: { minspec: ... }` entry on `packages/minspec` (the issue's literal
  ask).** *Cost:* directly contradicts `CLAUDE.md:110-111` and reopens DR-015's packaging
  split; would require its own DR superseding both, is a new installed-binary security
  surface (arbitrary JSON parsed and acted on by code that ships to every user, not just
  Claude sessions), and was the option "Why no new DR" below explains this spec avoids.
- **Option C — no new code; standardize the existing direct `gh issue create` call with a
  documented title/body/label template in `CLAUDE.md` only.** *Cost:* gets none of the dedup
  gate or session-scope auto-fill — the two concrete defects Context traces in the current
  path — because prose cannot call `normalizeTitle` or `loadSession`; leaves the duplicate-
  issue risk the issue itself raised unresolved.

### DQ-2 — Does the script need its own workspace-folder resolution, or take a path argument?

**Recorded selection: Option A,** default to `process.cwd()`, with an optional
`--root <path>` override.

- **Option A — `cwd` default, `--root` override (rec).** Matches how a dispatched session
  already runs: one worktree, one directory, Bash's cwd already there. *Cost:* a session
  whose cwd has drifted from the intended repo folder (worktree cwd leaks are a known failure
  mode this repo's own memory notes name) parks against the wrong folder unless it passes
  `--root` explicitly.
- **Option B — require `--root` always, no default.** *Cost:* one more argument on every
  call for no benefit in the common case, where cwd is already correct.

### DQ-3 — How is "telemetry on parking frequency" satisfied?

**Recorded selection: Option A,** a trailer line naming `source`, no new store.

- **Option A — trailer line in the issue/file body (rec).** FR-5. Grep-able after the fact
  (`gh issue list --search "Filed via: claude-auto-park"` or a grep of
  `.minspec/parking-lot.md`), adds no file and no schema. *Cost:* answering "how often" means
  running that search by hand; there is no dashboard or count maintained anywhere.
- **Option B — a new counter file under `.minspec/`.** *Cost:* a second store to keep
  consistent with the issue/file records it is counting, and DR-078 §3 already names one
  store for what MinSpec itself writes — a counter is a second, needing its own
  justification this issue does not make.

## Why no new DR

The recommended options (DQ-1 Option A, DQ-2 Option A, DQ-3 Option A) apply DR-004 and DR-015
exactly as written — Tier 1 GitHub delegation stays in `scripts/`, nothing embeds in the
shipped extension, no new store is added — so nothing here reverses a decision those records
already made; the reversibility filter (can it be undone in under a day) is met by a script
addition with no package surface change. A DR becomes necessary only if DQ-1 resolves to
Option B, because shipping a `bin` entry inside `packages/minspec` directly contradicts
`CLAUDE.md:110-111` and DR-015's packaging split, and this spec must not proceed to Plan on
that option without one superseding both.

## Out of Scope

- **Auto-detection of drift by Claude.** Named out of scope by the issue itself; covered by
  the Session Scope Protocol's Triage Rules already in `CLAUDE.md`, unchanged here.
- **Cross-repo routing.** Also named out of scope by the issue; "Explicit project → no ask"
  behaviour is unchanged.
- **The session-log audit** the issue asks for ("Is Claude reliably auto-parking today?").
  Unmeasured, and this spec's requirements do not depend on its answer (Context). Filing it
  as its own tracked item, separate from this build, is a Plan-phase or follow-up decision —
  no issue number is minted by this spec for it, since a spec is not the place to create
  the audit's tracking issue sight-unseen (Evidence Discipline: "create before knowing
  members" is a named failure mode in this repo).
- **The "codeword in chat" alternative** (`/park <topic>` or `#park <topic>` in an editor
  selection, bound to a hotkey running `minspec.park`). This is a human-typed-in-the-editor
  convenience, not something a headless Claude session (no editor selection, often no VS Code
  window at all) can use, so it does not address the issue's stated problem (no standard
  format when *Claude* parks) and is a separate, smaller feature if wanted later.
- **Changing `parkTopic`, `createParkingLotEntry`, or any dedup/fallback logic.** This spec
  adds a caller; INV-5 keeps the library's behaviour exactly as it is.
- **The VS Code `MinSpec: Park Topic` command's own UX.** Unchanged; FR-2's string format is
  copied from it, not altered.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4).

- **Building the issue's literal `minspec park --json` CLI inside `packages/minspec`.**
  Rejected: contradicts `CLAUDE.md:110-111` and DR-015 without a DR superseding either (DQ-1
  Option B's cost).
- **Leaving the direct `gh issue create` Bash pattern as-is and only documenting a template in
  prose.** Rejected: cannot call the dedup gate or session-scope auto-fill — the two concrete
  gaps Context traces — because they are code, not text (DQ-1 Option C).
- **A new telemetry store for parking frequency.** Rejected: a second store duplicating what
  the issue/file record already contains, with no spec making the case for parallel storage
  (DQ-3 Option B's cost).

## Test plan (for the Plan phase to place)

- **Contract tests on the script** (`scripts/park-topic.test.ts`): FR-1 through FR-6, using
  the same `gh`-stubbed-unavailable pattern `packages/minspec/tests` already uses for
  `parkTopic`, so no test in this suite makes a real network call.
- **A regression case for FR-7**: `CLAUDE.md` contains the string `scripts/park-topic.ts`
  within the Triage Rule 1 line.
- **A regression case for FR-8 / INV-4**: `packages/minspec/package.json` has no `bin` key,
  and `CLAUDE.md`'s "Commands and locations" section is byte-identical to this spec's base
  commit.
- **Not vacuous:** each assertion is checked against a mutant that removes the dedup call,
  the session-scope call, and the `source` trailer, one at a time, and shown to turn red.

## Traceability

- **Issue:** [#12](https://github.com/AIClarityAU/minspec/issues/12).
- **Governing decisions:** [DR-004](../../../docs/decisions/DR-004.md) (tiered network
  consent — the parking lot's `gh` delegation is Tier 1), [DR-015](../../../docs/decisions/DR-015.md)
  (agent-dispatch tooling ships in `scripts/`, never embedded in the extension),
  [DR-074](../../../docs/decisions/DR-074.md) (blast radius / opt-in marker — INV-3),
  [DR-066](../../../docs/decisions/DR-066.md) (no silent gate — INV-2).
- **Specs this touches:** none claims `parking-lot.ts` or `park.ts` under `implements:`
  today (checked by grep across `specs/*/SPEC-*/requirements.md`); this spec adds no claim
  on either, only reads their exports.
- **Adjacent:** [SPEC-074](../SPEC-074-dispatch-quota-classification/requirements.md), the
  nearest precedent for an EPIC-007 change living entirely in `scripts/`.
- **Cited, not local:** "DR-360" in the issue body is the parent register's decision
  (`~/code/mmo-platform/docs/decisions.md`, ~DR-360 as of 2026-09), not a record in this
  repo's own `docs/decisions/` — it is cited here only because `DR-004`'s own text already
  names it for the parking lot's `gh` delegation; this repo's register does not otherwise
  define it (CLAUDE.md's Decision Register section: this project's register is sequential
  and local, not shared with the parent).
- **Id note.** Checked locally on 2026-10-02 against `origin/main` (722e7b57f870, the base
  this spec was written from) and every local branch and worktree reachable from this
  checkout: no `SPEC-097` exists yet. This dispatch has no network access, so open pull
  requests on the forge could not be checked (unlike SPEC-096's note, which could). If
  `SPEC-097` collides at review time, renumber per the collision gate
  (`scripts/check-dr-id-collision.ts`'s spec-side equivalent) and update this file's
  frontmatter and self-references.
