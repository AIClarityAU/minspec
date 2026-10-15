---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-003  # SDD Core Methodology - keeps the review step of the SDD loop inside the editor
aspects: [pull-request, link-routing, vscode-extension, harness, egress, tier-0, offline]
relates_to: [SPEC-018, SPEC-021, DR-004, DR-032, "#541", "#533", "#531"]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137: Open PR links in the IDE when the GitHub PR extension is present

Issue: [#541](https://github.com/AIClarityAU/minspec/issues/541). Split out of SPEC-018
(its FR-14 / FR-OQ5 / FR-15a); PR-link routing is orthogonal to the approvable editor.
Rationale for the egress rule: DR-032.

**Scope sentence.** Every place MinSpec opens a pull-request link goes through one helper
that opens it inside VS Code when `GitHub.vscode-pull-request-github` is installed and in the
browser otherwise; the install offer already exists and only needs a new home.

**Not in scope (Triage rule 3, detection is not integration).** Re-implementing PR review,
comment threads, checkout or sync. Link routing only.

## What exists today (verified against `origin/main`)

- Detection pattern and the extension id: `GITHUB_PR_EXTENSION_ID` at
  `packages/minspec/src/commands/init.ts:1035`; `vscode.extensions.getExtension(id)` at `init.ts:1115`.
- **The install offer is already built**: `offerGitHubPrExtensionAdvisory`
  (`init.ts` ~1100-1150) shows a declinable toast (Install / Not now / Learn more), consent is
  the click, silent when installed or not a git repo. So issue item 4 is mostly done; what is
  left is moving it into the #533 checklist (FR-6).
- PR links opened externally today: `commit-on-approve.ts:621` (`OPEN_PR_ACTION`) and
  `push-docs-lane.ts:455` (`result.prUrl`). `park.ts:256` opens an **issue** URL, not a PR,
  and is out of scope. No source file contains a literal `/pull/` string; PR URLs arrive at runtime.
- I found no webview or signpost code that renders a `/pull/` link (grep of `packages/*/src`
  for `pull/` and `prUrl`). The issue says webviews and the signpost surface such links; that is
  unverified here and is Decision D3.

## Functional requirements

- **FR-1 (one helper).** A single `openPullRequest(prUrl)` MUST be the only way MinSpec opens a
  PR URL. Both sites above MUST call it, and a test MUST fail if a new
  `openExternal` on a `/pull/<n>` URL appears outside it.
- **FR-2 (recognise a PR URL).** The helper routes only URLs matching
  `https://github.com/<owner>/<repo>/pull/<n>` (host `github.com`). Anything else goes straight
  to `openExternal` unchanged.
- **FR-3 (detect).** Extension present means `vscode.extensions.getExtension(GITHUB_PR_EXTENSION_ID) !== undefined`,
  evaluated at click time, not cached at activation.
- **FR-4 (route in-IDE).** When present, open the PR through the extension's own entry point
  (mechanism: Decision D1). Detection plus URI/command execution only; no network import
  (invariant 1, DR-004 Tier 0).
- **FR-5 (never a dead action).** If the in-IDE open throws, rejects, or the command is
  unknown, fall back to `openExternal(prUrl)`. Absent extension also uses `openExternal`.
  The fallback MUST NOT be silent about a *systematic* failure: log it once to the MinSpec
  output channel (invariant 2 spirit; the user still gets the PR, but the failure is visible).
- **FR-6 (install offer).** Keep the existing offer's behaviour (declinable, consent is the
  click, no network call before the click). When #533's checklist page exists the offer MUST
  appear there as an item and the standalone toast MUST be removed; until then the toast stays.
- **FR-7 (harness rewrite, gated).** Only if Decision D2 is answered "yes": links to `/pull/`
  inside generated CLAUDE.md / harness text are rewritten to the in-IDE form when the
  extension is detected at generation time. Default if D2 is "no": no change to generated text.

## Invariants

- **INV-1 Egress (SPEC-021 / DR-032).** Nothing this feature emits into generated user-facing
  text (FR-7) or into a toast contains a MinSpec-internal `SPEC-`/`DR-`/`EPIC-` reference.
- **INV-2 Tier 0.** No network import in `packages/minspec`; only detection, `executeCommand`,
  `openExternal`.
- **INV-3 Blast radius (constitution invariant 3).** Behaviour changes only inside a repo opted
  in via `.minspec/`; a user without the extension sees today's behaviour byte for byte.
- **INV-4 No dead action.** A click on a PR link always ends in a PR opening somewhere.

## Acceptance criteria

- **AC-1 (FR-1).** Test: both call sites invoke `openPullRequest`; a source-scan test fails if
  `openExternal` receives a PR URL elsewhere (mutation: revert one site, test goes red).
- **AC-2 (FR-2).** Non-PR and non-`github.com` URLs reach `openExternal` untouched.
- **AC-3 (FR-3/4).** With a stubbed extension present, the in-IDE entry point is called and
  `openExternal` is not.
- **AC-4 (FR-5).** With the entry point stubbed to throw, `openExternal` is called with the
  original URL and the failure is logged; with the extension absent, `openExternal` is called.
- **AC-5 (FR-6).** Install offer fires nothing before the click; "Not now" is a no-op.
- **AC-6 (INV-1).** Test over every string FR-7 or the toasts emit: no `SPEC-`, `DR-`, `EPIC-`.
- **AC-7 (INV-2).** No new network import in `packages/minspec` (existing import-ban test passes).

## Decisions needed (Clarify)

- **D1 - how to open in-IDE.** (a) **(rec)** `vscode://github.vscode-pull-request-github/open-pull-request-webview?uri=<encoded PR URL>`
  via `vscode.env.openExternal`: a documented-looking URI handler, works without knowing
  internal command ids; cost: I believe, unverified, that this handler exists in current
  extension builds, and the handler's contract is the extension's to change, so Plan must
  verify it against a real install. (b) an internal command such as `pr.openDescription`:
  needs a PR object, not a URL, so it is not a drop-in. (c) Open the PR page in VS Code's
  Simple Browser: stays in-IDE but is not the extension's review UI.
- **D2 - rewrite links in generated CLAUDE.md?** (a) **(rec)** No: generated text is committed
  and shared, so a `vscode://` link would be dead for teammates and CI without the extension,
  and is stale the moment the extension is removed; cost: the user's "one CLAUDE.md line"
  idea is not delivered and agents reading CLAUDE.md still emit browser links. (b) Yes,
  gated on detection: delivers the idea; cost: the cross-machine breakage above plus a
  committed file that changes by machine. (c) Instead add one CLAUDE.md *instruction* telling
  the agent to use the in-IDE form only in its own chat output, with no link rewriting.
- **D3 - webview and signpost surfaces.** The issue says they show `/pull/` links; I found
  none in `packages/*/src`. Options: (a) **(rec)** treat FR-1 as covering only the two
  verified sites and add each further surface as it is found, cost: the issue's wording
  overstates the work done; (b) hold the spec until the user points at a concrete surface.
- **D4 - non-VS-Code hosts (#531).** `getExtension` returns undefined there, so the browser
  fallback applies with no extra work. Confirm that is the whole answer.
