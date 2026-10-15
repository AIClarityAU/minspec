---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - what may leave the machine, and one new runtime dependency
aspects: [errors, diagnostics, logging, qr, windows, consent, tier-0, offline, redaction, no-silent-gate, blast-radius]
depends_on: [DR-004, DR-050, DR-071, DR-074]  # DR-004 the Tier 0 boundary this stays inside; DR-050 per-action consent and its ban on MinSpec-initiated telemetry; DR-071 condition 4 (standing consent never covers background traffic); DR-074 the blast-radius rule
relates_to: [DR-066, DR-086, DR-100, SPEC-060, SPEC-085, "#2581", "#2718", "#2577", "#2405", "#2585", "#659"]
# Ownership declared in Specify, before approval mints a hash (SPEC-038). Every file below
# is NEW and is needed under the recommended answer to every question in Clarify: the
# error log and its redaction, the issue-link builder, the diagnostics panel, and the four
# tests that pin capture, redaction, the panel's no-network rule and the wiring.
implements: [packages/minspec/src/lib/error-log.ts, packages/minspec/src/lib/error-redact.ts, packages/minspec/src/lib/issue-link.ts, packages/minspec/src/views/diagnostics-panel.ts, packages/minspec/tests/error-log.test.ts, packages/minspec/tests/error-redact.test.ts, packages/minspec/tests/diagnostics-panel.test.ts, packages/minspec/tests/error-capture-wiring.test.ts]
# Modified, not owned. extension.ts gains the wrapper at its 44 registrations and the new
# command; package.json the command, its keybinding and one dependency; the README its
# diagnostics section. The next 18 files call showErrorMessage today and change only to
# route that call through the error log (FR-3). The last four hold console.error/warn
# failure reports that FR-4 routes through the log (commit-on-approve.ts holds 19 of 28).
affects: [packages/minspec/src/extension.ts, packages/minspec/package.json, packages/minspec/README.md, packages/minspec/src/commands/adr.ts, packages/minspec/src/commands/approve-active.ts, packages/minspec/src/commands/approve.ts, packages/minspec/src/commands/backfill-epics.ts, packages/minspec/src/commands/backlog.ts, packages/minspec/src/commands/classify.ts, packages/minspec/src/commands/constitution.ts, packages/minspec/src/commands/epic.ts, packages/minspec/src/commands/example.ts, packages/minspec/src/commands/init.ts, packages/minspec/src/commands/migrate.ts, packages/minspec/src/commands/park.ts, packages/minspec/src/commands/session.ts, packages/minspec/src/commands/validate.ts, packages/minspec/src/lib/resolve-folder.ts, packages/minspec/src/views/codelens-provider.ts, packages/minspec/src/views/epic-dnd-controller.ts, packages/minspec/src/views/spec-panel.ts, packages/minspec/src/commands/commit-on-approve.ts, packages/minspec/src/commands/push-docs-lane.ts, packages/minspec/src/lib/ownership-advance-guard.ts, packages/minspec/src/lib/ownership-ratchet.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: MinSpec keeps its own errors, and a phone can carry them off a locked-down machine as an exact, ready-to-file report

> **SPECIFICATION ONLY.** Nothing is built by the session that wrote this. A human reads
> it, checks its Clarify questions, and approves it through the normal spec-approval gate
> before any code changes. Each question carries an agent-recorded selection under
> [Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-15-ratified-only-by-approval-of-this-spec);
> the requirements are written under those selections, so approving the spec as it stands
> accepts them. Choosing a different option changes only the requirements that question
> names.

## In plain terms

You want MinSpec on the work PC to send its errors back to you. That PC installs only
published extensions, and nothing can be copied, pasted or attached off it. Today
MinSpec keeps no errors at all: each one is a toast that is gone once dismissed.

This spec builds three things in order:

1. **MinSpec records every error it hits** - the message, where it came from, the stack
   and the time - with your home folder, project paths and anything shaped like a
   credential removed first.
2. **A Show Diagnostics page** lists those errors with the version, build and platform,
   in large text.
3. **Each error gets a QR code.** Point your phone at the screen and it opens a GitHub
   "new issue" form, already filled in, on your phone, where you are signed in. You read
   it and press Submit, or you don't. Longer stack traces get extra codes that carry the
   rest as plain text.

The work PC sends nothing. Your phone is the only thing that touches the network, and
only when you scan a code and press Submit. That keeps the published listing's promise
("no telemetry ... nothing is sent to the people who make it",
`packages/minspec/README.md:31`) true, and needs no new decision record.

What it does **not** do is have the extension send errors to us by itself. That would be
MinSpec's first network connection of its own, it would break the promise above, and it
needs a decision record first. DQ-1 puts that choice to you, and the decision record is
filed separately as [#2718](https://github.com/AIClarityAU/minspec/issues/2718) so it does not wait on this spec.

## One-Sentence Scope

Record every error from a MinSpec command, an error toast, a reported catch or activation,
redacted, in memory and in a MinSpec log channel, and
show them on a Show Diagnostics page that renders each one as text and as QR codes, the
first of which opens a pre-filled GitHub issue on the phone that scans it, with no network
action by the extension.

## Context - what the code does today (read from `origin/main` `31b4c826`, not inferred)

### Errors are shown and then lost

- **No error is recorded anywhere.** `showErrorMessage` is called on 58 lines in 19 files
  under `packages/minspec/src`, listed in `affects:` above (count from
  `grep -rn showErrorMessage packages/minspec/src`). The toast is the only record. Most
  calls pass a fixed string. A few pass `err.message`: `packages/minspec/src/extension.ts:1025`,
  `packages/minspec/src/commands/classify.ts:24`, `packages/minspec/src/commands/approve.ts:266-267`. None pass `err.stack`.
- **There is no logger.** The only output channel is created per click in
  `packages/minspec/src/commands/classify.ts:173` (`'MinSpec Classification'`, not a `LogOutputChannel`).
  No source file uses `context.logUri`, `context.globalStorageUri` or
  `context.storageUri`.
- **28 `console.error` / `console.warn` calls** go to the extension host's developer
  console, which a user does not see. 19 of them are in `packages/minspec/src/commands/commit-on-approve.ts`,
  for example the catch blocks at `:441-443`, `:495-497` and `:1015-1016`. Those catches log
  `err.message` only.
- **A command that throws is not recorded by MinSpec.** All 44 commands are registered
  directly in one `context.subscriptions.push(...)` block in `activate()`
  (`packages/minspec/src/extension.ts:370` onward; `registerCommand(` occurs 44 times in that file and in no
  other source file, and `package.json` contributes 44 commands). No handler is wrapped. A
  rejected handler reaches VS Code, which shows its own generic failure notification and
  writes the trace to the extension host log. I believe that is VS Code's behaviour; it is
  unverified here and Plan confirms it.
- **Activation has no guard.** `activate()` (`packages/minspec/src/extension.ts:65`) is synchronous and
  runs everything inline. If it throws part-way, the commands registered after the throw
  never exist.
- **No process-wide handler exists** (`process.on(` occurs nowhere in `packages/minspec/src/`). This is
  correct and FR-6 keeps it so.

### What can already be stated about a build

- **The build is identifiable at runtime.** `buildSha()` and `buildLabel()`
  (`packages/minspec/src/lib/build-provenance.ts:35`, `:67`) return the commit the build was cut from, or
  `dev`, using `__MINSPEC_BUILD_SHA__` (`:32`), which `scripts/build-extension.sh`
  injects at bundle time, with a `-dirty` suffix for an uncommitted tree. The version is
  `package.json` `version` (`0.1.27`). There is no build time.
- **Stack frames in a shipped build point into minified code.** `scripts/build-extension.sh`
  passes `--minify` and no `--sourcemap` flag (`:50-57`), and
  `packages/minspec/.vscodeignore:15` excludes `out/*.js.map` from the package. A frame
  from the work PC therefore reads like `extension.js:2:184233` with mangled names, and
  nothing today maps it back to source. FR-13 covers this.
- **The issue destination is declared.** `package.json:18-20` sets `bugs.url` to
  `https://github.com/AIClarityAU/minspec/issues`.

### The network rules this has to live inside

- **Constitution invariant 1:** no network calls without explicit user consent.
- **DR-004** puts telemetry in Tier 2 ("opt-in only, never default-on") and makes the Tier
  0 boundary mechanical. `packages/minspec/tests/invariants.test.ts` enforces it: no
  `fetch`, `http(s)` or similar in `packages/minspec/src/`, and a spawn allowlist (`SPAWN_ALLOWLIST`, from
  `:134`) for any module that starts a process.
- **DR-050** forbids "MinSpec-initiated exfiltration / telemetry" outright (`:70-78`).
- **DR-071** condition 4: standing consent never authorises background traffic, and its
  plain-language section says it "does not authorise telemetry".
- **The published listing** says the extension "opens no network connection of its own.
  It has no telemetry ... and nothing is sent to the people who make it"
  (`packages/minspec/README.md:31`, repeated at `:354` and `:376`). I believe 0.1.27 was
  published with that text under DR-100; that is unverified here, since DR-100 approves
  the publish and records no published version.

So an extension that sends its errors to us is a reversal of a published promise, not a
feature toggle. A QR code the user scans with their own phone is not: the extension
draws pixels, and the phone's browser makes the only request, after the user reads the
text and presses Submit.

### Why a phone, and why QR

The constraint, from the founder on 2026-10-04 (#2581): "i can't copy/paste any error
messages off the work PC". Photographing the screen works, but a photograph of a stack
trace is retyped or read by OCR, and both corrupt exactly the characters that matter
(`l`/`1`/`I`, `0`/`O`, path separators, line numbers). A QR code carries the bytes
exactly. Encoding a GitHub new-issue link in it means the report is filed from the phone
in one scan and one tap, with nothing retyped.

## Functional Requirements

### Capture

- **FR-1 - One error log.** `packages/minspec/src/lib/error-log.ts` MUST hold the extension's error records:
  each record has the time (ISO 8601, UTC), the source (a command id, `activation`, or
  the name of the reporting module), the message, the stack when one exists, and an
  occurrence count. It MUST keep the most recent 50 distinct records in memory (DQ-3). A
  record with the same source, message and stack as an existing one increments that
  record's count and time rather than adding a new one, so a loop cannot flush the log.
  A non-`Error` value (a thrown string, `undefined`, an object) MUST still be recorded,
  with its `String()` form as the message and no stack.

- **FR-2 - Every command is captured.** Each of the 44 command registrations MUST go
  through one wrapper in `error-log.ts` that records a thrown or rejected error with the
  command id as its source and then rethrows it unchanged, so VS Code's own handling and
  every existing caller's behaviour are untouched. For a synchronous handler it records
  and rethrows synchronously and returns the handler's own return value. For a handler
  that returns a thenable it returns a promise that resolves or rejects with the identical
  value or reason. The wrapper MUST NOT show a toast of its own (VS Code already shows
  one). A command run through `executeCommand` from another wrapped command (for example
  `packages/minspec/src/extension.ts:672`, `packages/minspec/src/commands/approve-active.ts:254`)
  produces one record per wrapped layer it passes through; the de-duplication in FR-1
  does not merge them because their sources differ. That is intended: the outer record
  shows which command led to the inner one. Errors raised in watcher, tree-provider and
  CodeLens callbacks are not captured by this wrapper; they are captured only where they
  reach an error toast (FR-3) or a reported catch (FR-4).

- **FR-3 - Every error the user is shown is captured.** Every `showErrorMessage` call in
  `packages/minspec/src/` MUST go through one helper in `error-log.ts` that records the message (and the
  error, when the call site has one, so the stack is kept) and then shows the same toast.
  The helper MUST add one action button, **Diagnostics**, which opens the Show Diagnostics
  page (FR-8), **only** to non-modal calls that pass no items of their own. Modal calls
  (for example `packages/minspec/src/commands/approve.ts:288-290`, `:319`, `:353`) and calls
  that pass items or read the returned choice MUST record the error but show exactly the
  dialog they show today, so the set of values a caller can receive never changes. The
  added button is an extra button on a toast that already appears, not a new prompt
  (constitution principle 4). Refusals raised as `NotOptedInError` (shown at
  `packages/minspec/src/extension.ts:1025` and `packages/minspec/src/commands/classify.ts:24`)
  are expected outcomes, not faults, and are not recorded. Warnings
  (`showWarningMessage`) are not recorded (DQ-2).

- **FR-4 - Silent catches that drop a real failure are captured.** The `console.error` and
  `console.warn` calls in `packages/minspec/src/` that report a caught failure MUST also record it through
  the error log, keeping their console output. Plan lists them from the 28 found today and
  states, for each it leaves out, why it is not a failure.

- **FR-5 - Activation failures are captured, and the page survives them.** The error log
  and the Show Diagnostics command MUST be set up as the first statements of `activate()`,
  before anything that can throw. The rest of `activate()` MUST run inside a guard that
  records a thrown error with source `activation` and then rethrows it, so VS Code still
  reports the failed activation and the Diagnostics page can still show why. The guard is
  synchronous, so it does not see a promise `activate()` starts and does not await (for
  example `packages/minspec/src/extension.ts:92`); each such promise that can reject MUST
  carry its own `.catch` that records with source `activation` (Plan lists them).
  Whether commands registered before a throw stay callable afterwards is VS Code's
  behaviour; I believe they do, it is unverified here, and Plan verifies it with a test
  in the extension host before relying on it.

- **FR-6 - No process-wide hook.** MinSpec MUST NOT install `process.on('uncaughtException')`,
  `process.on('unhandledRejection')` or any other process-wide handler. The extension
  host is shared by every installed extension, so a process-wide handler would capture
  other extensions' errors and their data, and would change their crash behaviour. That
  is outside MinSpec's blast radius (constitution invariant 3).

### Redaction

- **FR-7 - Redact before storing.** `packages/minspec/src/lib/error-redact.ts` MUST be applied to every
  message and stack before it is stored, so no unredacted text is held anywhere,
  including the log channel. Input MUST first be cut to a fixed maximum length (a
  constant set in Plan), and every pattern MUST run in linear time, so redacting a huge
  message cannot stall the extension host (INV-2). Rules apply in this order, and each
  has its own case in `error-redact.test.ts`:
  - each open workspace folder's absolute path with `<workspace>` (or `<workspace:N>`
    for the Nth folder of a multi-root workspace), so employer repository paths do not
    reach a public issue. This runs **before** the home rule: workspace folders usually
    sit under the home folder, and the reverse order would leave `~/work/<repo>` behind;
  - the user's home directory with `~`, in every form it reaches a message: either path
    separator; either case of drive letter (`fsPath` yields `c:\`); the 8.3 short form
    (`C:\Users\JOHNSM~1`); URI-encoded (`file:///c%3A/Users/name`); UNC and
    `\\wsl$\` forms; and `/mnt/c/Users/<name>` when `vscode.env.remoteName` is `wsl`;
  - the bare account name from `os.userInfo().username`, wherever it still appears, with
    `<user>`;
  - email addresses with `<email>`;
  - credential-shaped strings with `[redacted]`: GitHub tokens (`ghp_`, `gho_`, `ghs_`,
    `ghu_`, `ghr_`, `github_pat_`), `sk-` and `sk-ant-` keys, AWS access key ids
    (`AKIA...`), GitLab `glpat-` tokens, Slack `xoxb-`/`xoxp-`/`xoxa-` tokens, JWTs
    (`eyJ...` three-part), `Bearer`, `Basic` and `token` authorization values (this covers
    Azure DevOps personal access tokens), and the user-info part of any URL
    (`https://user:secret@host`).

  Redaction never changes a stack frame's `line:column`, which FR-13 depends on.
  Redaction is best effort. It does **not** remove remote URLs such as
  `github.com/<employer>/<repo>`, branch names, spec ids or spec titles. The user reading
  the text before Submit is the real control, and the panel says so and names those
  kinds of text (FR-9).

### The Diagnostics page

- **FR-8 - Show Diagnostics command.** A new command, **MinSpec: Show Diagnostics**
  (`minspec.showDiagnostics`), MUST open a webview panel listing:
  - a header with the MinSpec version, `buildLabel()`, the VS Code version, the platform
    and architecture, and the remote name (`vscode.env.remoteName`, or `local`);
  - every recorded error, newest first, each with its time, source, count, message and
    stack, in a monospace font large enough to read in a phone photograph;
  - a **Clear** button that empties the in-memory log immediately, with no confirmation.
    The log channel keeps the text, so nothing is lost that a confirmation would protect.

  When there are no errors it MUST say so in words, never show an empty panel. The
  command MUST have a keybinding, chosen in Plan from free chords, and its title tooltip
  MUST show that keybinding. The page MUST open from the palette even when activation
  failed after FR-5's first statements.

- **FR-9 - QR codes that file the issue from the phone.** For each record the page MUST
  render:
  1. **An issue code** (not numbered). A QR code whose content is a GitHub new-issue URL
     built from `bugs.url` (`<bugs.url>/new?title=...&body=...`). The title is the source
     and the message, cut to 120 UTF-8 bytes at a character boundary before encoding. The
     body holds the header facts, the source, the time, the count, the message, and as
     many whole stack frames as fit, followed by `continued in parts 1 to M` when
     anything was cut. If the header and message alone exceed the budget, the message is
     cut at a UTF-8 boundary and marked `[cut - see parts 1 to M]`. The URL MUST be built
     by `packages/minspec/src/lib/issue-link.ts`, a pure function with no I/O.
  2. **Continuation codes** (parts 1 to M), only when something was cut. Each is one
     header line, `MinSpec diagnostics <record time> part k/M`, then a payload of plain
     text. Joining the payloads of parts 1 to M in order reproduces the whole redacted
     record byte for byte.

  The byte budget applies to the **final percent-encoded URL** for the issue code and to
  the header plus payload for a continuation code, measured in bytes. `encodeURIComponent`
  inflates newlines, spaces, `\`, `:` and non-ASCII text, so a budget counted in raw
  characters would overflow. Measured on 2026-10-15 with `lean-qr` 2.7.4 for a realistic
  record (a 479-byte URL with no stack frames, then +3 frames per row): error-correction
  level M needs QR version 17 for the header and message alone, 23 with 3 frames, 29 with
  6, and 34 with 10; level L needs 15, 20, 25 and 30. So the issue code carries the
  header, the message and a handful of frames, and the continuation codes carry the
  rest. The budget is one constant, set in Plan by measuring which version a mid-range
  phone reads reliably off a laptop screen at arm's length; Plan records the
  measurement. The number of continuation codes is capped at a second constant. Past
  the cap the page says, in words, how many bytes were left out and that the full text
  is in the `MinSpec` log channel. If encoding a code fails, its place shows
  `QR code could not be drawn: <reason>` in text and the rest of the page still renders;
  a failure never leaves a blank where a code should be (constitution invariant 2).

  The page MUST state, next to the codes, that scanning opens a **public** GitHub issue
  form, that home and workspace paths and credential-like strings have been removed but
  remote URLs, branch names and spec titles have not, that the text should be read before
  submitting, and that nothing is sent unless Submit is pressed on the phone. Plan MUST
  check by hand that the GitHub mobile app, when installed, does not intercept the link
  and drop its `body=` (unverified).

- **FR-10 - The page makes no network request.** The webview MUST set a Content Security
  Policy of `default-src 'none'` and `localResourceRoots: []`, with style and script
  allowed only by nonce. QR codes MUST be generated in the extension and inlined as
  `<svg>`, so no `img-src` is needed. All record text MUST be HTML-escaped before it is
  placed in the page, so an error message cannot inject markup that changes what the
  user believes will be filed. The page MUST load nothing from the network, render no
  clickable external link, and call no `openExternal` (DQ-4). The nonce-only style rule
  is new for this repo: the existing spec panel allows `style-src 'unsafe-inline'`
  (`packages/minspec/src/views/spec-panel-html.ts:151`), and Plan notes the difference
  rather than copying it. In VS Code for the web or Codespaces, VS Code itself serves
  every webview frame from its own CDN host, as it already does for the spec panel; that
  is VS Code's request, not MinSpec's, and the README section says so.

- **FR-11 - A log channel.** Each recorded error MUST also be written to one
  `LogOutputChannel` named `MinSpec` (`createOutputChannel('MinSpec', { log: true })`),
  created once at activation, so a developer machine with a clipboard can still read and
  copy the full text. VS Code persists the channel to its own session log folder;
  MinSpec opens no file (DQ-3).

- **FR-13 - A frame from a shipped build can be mapped back to source.** The record MUST
  keep every frame's file, `line:column` and name exactly as thrown (FR-7 never touches
  them). A developer holding a record MUST be able to turn its frames into source
  locations from the record's `buildLabel()` alone. Plan chooses how (DQ-6) and MUST
  prove the chosen way on one real frame from a packaged build. A build whose label
  ends `-dirty` cannot be reproduced from its commit, so the page MUST mark records from
  such a build as `frames not mappable (dirty build)` rather than imply otherwise.

### Honest documentation

- **FR-12 - The README says what this does.** The README MUST gain a short section,
  "When something goes wrong", stating: errors are kept in memory for this window
  session and in the MinSpec log channel; Show Diagnostics shows them, with its
  keybinding; the QR codes open a pre-filled public issue on whatever device scans them;
  and the extension sends nothing itself. The existing sentences at `README.md:31`,
  `:354` and `:376` MUST stay true and MUST NOT need editing. If Plan finds that one of
  them would become false, the spec is wrong and goes back to Specify.

## Acceptance Criteria

- [ ] A command that throws is listed on the Diagnostics page with its command id, message
      and stack, and VS Code still shows its own failure notification. (FR-1, FR-2)
- [ ] An error toast from any of the 19 files is listed on the Diagnostics page and has a
      Diagnostics button that opens it. (FR-3, FR-8)
- [ ] An error forced in `activate()` after the first statements is listed with source
      `activation`, and Show Diagnostics opens from the palette afterwards. (FR-5)
- [ ] The same error thrown 500 times occupies one record with count 500. (FR-1)
- [ ] A recorded message containing the home path, a workspace path, a `ghp_` token and a
      `https://user:pw@host` URL shows `~`, `<workspace>`, `[redacted]` and no
      user-info, on Linux and with a Windows-shaped home path. (FR-7)
- [ ] For a record with a long stack, scanning the first code on a phone opens a filled
      GitHub new-issue form for AIClarityAU/minspec, and the continuation codes,
      pasted in order, reproduce the whole redacted record byte for byte. (FR-9)
- [ ] The webview's HTML carries `default-src 'none'`, no `http:` or `https:` source, and
      no clickable external link. (FR-10)
- [ ] `invariants.test.ts` passes with no new entry in its spawn or network allowlists.
      (INV-1)
- [ ] No `process.on(` exists in `packages/minspec/src`. (FR-6)
- [ ] The README has the new section; its existing network sentences are unchanged.
      (FR-12)
- [ ] Each catch site Plan keeps under FR-4 records through the error log, and
      `error-capture-wiring.test.ts` lists them. (FR-4)
- [ ] A modal error dialog with its own buttons looks and returns exactly as before, and
      its error is still recorded. (FR-3, INV-2)
- [ ] With no records the page says so in words; the command's tooltip shows its
      keybinding; Clear empties the page at once. (FR-8)
- [ ] A recorded error appears in the `MinSpec` log channel. (FR-11)
- [ ] An HTML-shaped error message renders as text, not markup. (FR-10)
- [ ] A record longer than the continuation cap shows the bytes-left-out line; a forced
      encoder failure shows the could-not-be-drawn text. (FR-9)
- [ ] One frame from a packaged, non-dirty build is mapped to its source file and line by
      the FR-13 procedure. (FR-13)

## Invariants (must not break)

- **INV-1 - No network action by the extension (constitution invariant 1, DR-004, DR-050).**
  No socket, no `http`/`https`/`fetch` import, no new entry in `SPAWN_ALLOWLIST` or any
  network allowlist in `invariants.test.ts`, and no `openExternal` from the Diagnostics
  page under the recommended DQ-4.
- **INV-2 - Recording never changes behaviour (constitution invariant 2).** Every capture
  point records and then does exactly what it did before: rethrows the same error, shows
  the same toast, returns the same value. A failure inside the error log itself MUST NOT
  mask the original error: if recording throws, the original error still propagates.
- **INV-3 - Blast radius (constitution invariant 3, DR-074).** No process-wide handler
  (FR-6). Under the recommended DQ-3 MinSpec opens no file at all; the only thing written
  to disk is VS Code's own persistence of the log channel. No setting written.
- **INV-4 - No nagging (constitution principles 2 and 4).** No new toast, modal or status
  bar item appears because an error was recorded. The only additions are one button on
  toasts that already appear, and a page the user opens.
- **INV-5 - Activation stays cheap (constitution constraint 3).** Setting up the log costs
  one channel creation and one array; no file read, no process, no timer.

## Clarify selections (recorded by an agent 2026-10-15; ratified only by approval of this spec)

Each decision carries a recommendation and its cost. The requirements above assume the
recommended option in every case.

DQ-1 to DQ-6 each carry a **Recorded selection** line naming the option this document
recommends. An agent session wrote those lines on 2026-10-15, and no human chose them.
This repository runs with `"autonomy": "act"`, under which an agent proceeds on a stated
recommendation and leaves the options it did not take on record (DR-086 §2 and §4).
Approving a T3 spec is on that section's stop list, so nothing here stands in for that
approval: the lines propose, and approving this spec ratifies them. A question with no
**Recorded selection** line is still open.

### DQ-1 - Does the first build send errors itself?

**Recorded selection: Option A.**

- **Option A - no; the phone carries them (rec).** This spec as written: local capture,
  the Diagnostics page, QR codes. No decision record needed, and the published listing
  stays true. *Cost:* it is not literally what was asked ("an option to send all errors
  back to the dev"). Every report needs a human with a phone at the screen, and nothing
  arrives from a machine nobody is looking at.
- **Option B - add an opt-in send from the extension.** An off-by-default setting, a
  consent screen showing the exact payload, and an endpoint we run. *Cost:* MinSpec's
  first network connection of its own. It needs a decision record overriding DR-050's
  telemetry ban and DR-071 condition 4, a rewrite of the published listing's privacy
  text and the privacy policy, an endpoint to build, secure and pay for, and a
  corporate proxy may block it on exactly the machine it is for. It is tracked as
  [#2718](https://github.com/AIClarityAU/minspec/issues/2718), so choosing A now does not close it.
- **Option C - pre-filled issue opened in the work PC's browser.** *Cost:* needs GitHub
  reachable and signed in on the work PC, which is not known to be true; the phone path
  works whether or not it is.

### DQ-2 - Which messages are recorded?

**Recorded selection: Option A.**

- **Option A - errors only: thrown errors, error toasts, and caught failures (rec).**
  *Cost:* a problem MinSpec reports as a warning (some refusals, the build-skew notice at
  `packages/minspec/src/extension.ts:788`) is not on the page.
- **Option B - errors and warnings.** *Cost:* most of MinSpec's ~40 warning lines are
  expected refusals ("not opted in", "nothing to approve"). They would fill the 50
  records with noise and bury the real faults.

### DQ-3 - Do records survive a window reload?

**Recorded selection: Option A.**

The dividing line is a file MinSpec opens itself against a file VS Code manages. Both
options put text on disk somewhere under the user's profile: VS Code persists a
`LogOutputChannel` to its own session log folder (on Linux under `~/.config/Code/logs/`;
VS Code's behaviour, unverified here). Neither is "machine-wide config" in constitution
invariant 3's sense, because both are VS Code-managed, per-extension storage that
changes no other tool's behaviour.

- **Option A - memory and the log channel only (rec).** MinSpec opens no file. *Cost:*
  reloading the window empties the Diagnostics page. The text is still in VS Code's log
  folder for that session, but on the work PC that folder cannot be carried off, so a
  fault must be scanned before reloading.
- **Option B - also a JSON-lines file in `context.globalStorageUri`.** *Cost:* a file
  MinSpec opens, rotates and sizes itself, with its own cap, its own corruption handling
  and its own clear rule, and redacted error text that outlives the session it came from.

### DQ-4 - May the page open the issue in this machine's browser too?

**Recorded selection: Option A.**

- **Option A - no; QR only (rec).** The page makes no network request and opens nothing.
  *Cost:* on a machine with a browser and a clipboard, filing takes a phone scan or a
  copy from the log channel instead of one click.
- **Option B - add an "Open as GitHub issue" button that calls `openExternal`.** The
  request would be the browser's, after the user's click, so it fits DR-050's per-action
  consent. *Cost:* the README network inventory gains an entry and its pinning test
  (`packages/minspec/tests/readme-network-claims.test.ts`) a row, and FR-12's "the extension sends
  nothing" needs qualifying.

### DQ-5 - How are QR codes produced?

**Recorded selection: Option A.**

- **Option A - one small, zero-dependency npm encoder, pinned to an exact version and
  bundled (rec).** Candidates read on 2026-10-15 with `npm view`: `lean-qr` 2.7.4 (MIT,
  no dependencies, 69 KB unpacked), `uqr` 0.1.3 (MIT, no dependencies, 79 KB, SVG
  output), `qrcode-generator` 2.0.4 (MIT, no dependencies, 556 KB). `qrcode` 1.5.4 is
  ruled out: it pulls in `pngjs`, `yargs` and `dijkstrajs`. Plan picks one, reads its
  source and records why. *Cost:* a fourth runtime dependency, the first added since
  `simple-git`, with the supply-chain exposure #659 describes. It is bundled by esbuild,
  so nothing is fetched at runtime. `invariants.test.ts` scans `packages/minspec/src/`
  only (`:290-306`), so a network call inside the dependency would pass INV-1 unseen;
  Plan MUST add a test that scans the chosen dependency's shipped source, or the built
  bundle, for the same `NETWORK_PATTERNS`.
- **Option B - write an encoder in the repository (byte mode, one error-correction level,
  versions 1 to 40, about 400 to 600 lines).** *Cost:* an encoder bug makes codes that
  will not scan, or scan as wrong text, and the tests need a reference decoder to prove
  otherwise.

### DQ-6 - How is a minified frame mapped back to source?

**Recorded selection: Option A.**

- **Option A - rebuild the map from the commit (rec).** A developer-side step checks out
  the record's build commit, runs the same build with `--sourcemap` added, and maps the
  frames. Plan MUST prove that adding `--sourcemap` changes nothing in `out/extension.js`
  except the trailing map comment, so the map matches the shipped bundle. *Cost:* the
  rebuild must use the same esbuild version and lockfile as the original build, so a
  dependency bump between the build and the mapping silently breaks it unless the step
  compares the rebuilt bundle with the shipped one (Plan adds that comparison; a mismatch
  is reported, never mapped).
- **Option B - keep the `.map` of every published build** as a release artifact.
  *Cost:* a new retained artifact per release, touching the release path that #2591
  (release workflow) is still settling.
- **Option C - ship unminified.** *Cost:* a larger package, and every shipped build
  changes for a debugging convenience.

## Why no new DR

Under the recommended options the extension adds no network action, opens no file of its
own (VS Code persists the log channel), and adds one bundled dependency. The change can be
undone in under a day, so the reversibility filter does not require a decision record. A
record becomes necessary if DQ-1 resolves to Option B; the spec must not go to Plan on
that option without one.

## Out of Scope

- **Sending errors from the extension** (DQ-1 Option B). Tracked as
  [#2718](https://github.com/AIClarityAU/minspec/issues/2718).
- **Errors from other extensions, VS Code itself, or the `gh`/`git`/`claude` tools' own
  output** beyond what MinSpec reports as its own error.
- **Errors in watcher, tree-provider and CodeLens callbacks** that never reach an error
  toast or a reported catch (FR-2). A later spec can widen capture once this one shows
  what the common faults are.
- **Rewording existing error messages** to say more (#2577 does this for the AI pass).
- **A Windows CI job** (#2405) and confirming the Windows fixes (#2585).
- **Usage analytics or any count of how often features are used.** This records failures
  only.

## Alternatives considered and rejected

Recorded because this spec was written without a live conversation (DR-086 §4).

- **Rely on VS Code's built-in Report Issue command.** Rejected as the main path: it
  files from the work PC's browser (DQ-1 Option C's cost), and it carries only what
  MinSpec would already have to collect.
- **Large on-screen text for phone OCR, without QR.** Kept as part of FR-8, rejected as
  the only path: OCR corrupts the exact characters a stack trace depends on.
- **Write a log file into the project's `.minspec/` folder.** Rejected: it lands in the
  user's repository, where it can be committed and pushed, which is a worse leak than the
  one this avoids.
- **A process-wide `uncaughtException` handler** to catch everything. Rejected under FR-6:
  it captures other extensions' errors.

## Test plan (for the Plan phase to place)

- **T0, before implementation:**
  - `error-capture-wiring.test.ts`: every `registerCommand(` in `packages/minspec/src/` goes through the
    wrapper; no `showErrorMessage` outside `error-log.ts`; no `process.on(` in `packages/minspec/src/`.
    Shown red on current code.
  - `error-redact.test.ts`: each redaction rule, including Windows paths and multi-root.
  - `diagnostics-panel.test.ts`: the CSP string, no external link, no `openExternal`.
    HTML escaping of record text.
  - A network-pattern scan of the chosen QR dependency's shipped source (DQ-5).
  - The modal-dialog case: a modal `showErrorMessage` with its own items is recorded and
    its buttons and return value are unchanged (FR-3, INV-2).
- **T1:** `error-log.test.ts` for the record shape, the 50-record cap, de-duplication,
  non-`Error` values, rethrow-unchanged, and the INV-2 rule that a failing logger never
  masks the original error. `issue-link.ts` round-trip: continuation parts reassemble the
  record exactly, and the issue URL never exceeds the budget.
- **T2:** an activation failure shows on the page (FR-5); the Diagnostics toast button
  opens it (FR-3).
- **Manual, recorded in Plan:** the phone-scan measurement that sets the byte budget
  (FR-9); the GitHub mobile app check (FR-9); one frame from a packaged build mapped
  through the FR-13 procedure.

## Traceability

- **Issue:** [#2581](https://github.com/AIClarityAU/minspec/issues/2581) (error details
  off the work PC).
- **Adjacent, not absorbed:** [#2577](https://github.com/AIClarityAU/minspec/issues/2577)
  (AI-pass failures say only "exited with code 1"),
  [#2405](https://github.com/AIClarityAU/minspec/issues/2405) (no Windows CI),
  [#2585](https://github.com/AIClarityAU/minspec/issues/2585) (Windows check record),
  [#659](https://github.com/AIClarityAU/minspec/issues/659) (dependency screening).
- **Governing decisions:** [DR-004](../../../docs/decisions/DR-004.md) (tiered network
  consent), [DR-050](../../../docs/decisions/DR-050.md) (per-action consent; no
  MinSpec-initiated telemetry), [DR-071](../../../docs/decisions/DR-071.md) (standing
  consent, condition 4), [DR-074](../../../docs/decisions/DR-074.md) (blast radius),
  [DR-100](../../../docs/decisions/DR-100.md) (the preview release this serves).
- **DR for this spec:** none, by design; see "Why no new DR".
