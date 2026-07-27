---
id: SPEC-042
type: tasks
# NO `status:` here — deliberately. Only requirements.md carries an approval record, so only
# it carries approval-derived state (mirroring the existing "only requirements.md carries the
# tier" convention). "MinSpec: Approve Spec" never touches this file, so a status here could
# only be hand-maintained and would silently lag every approval — the drift #972 exists to
# kill, observed live on #971/#996. Read the sidecar for SPEC-042's real approval state.
# tier lives on requirements.md (the single tier-carrying approvable, per the
# spec-gate convention). A tier on a NON-approved sibling doc is treated by
# spec-gate.py as a second unapproved spec and can shadow the approved
# requirements.md — so this doc omits it. (SPEC-042 is T3.)
product: minspec
epic: EPIC-003
relates_to: [SPEC-018, SPEC-037, DR-056]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: pending
---

# MinSpec — Onboarding consolidation (Tasks)

Tasks map to the FR/INV/AC set in [requirements.md](./requirements.md) and the D1–D7
decisions + slice plan in [design.md](./design.md). Materializes
[#533](https://github.com/AIClarityAU/minspec/issues/533).

**Three vertical slices; ordering is load-bearing** — Slice 2 writes through the model
Slice 1 builds, Slice 3 hangs the network-touching actions off the rows Slice 2 wires.
Each slice ships end-to-end (open the page → see the change) before the next starts.

**Phase-2 gate (INV-6).** This is public-onboarding polish
([constitution Phases](../../../.minspec/constitution.md#L59)). **No task below may be
started while an unmet Phase-1 item is the signpost's next task.** Check the signpost
first; if Phase-1 work is outstanding, this spec waits.

**Nothing here is implemented yet** — every box is unchecked and stays unchecked until
its code exists and its test passes (evidence discipline: a checked box is a claim).

**Dependency budget: 0 new npm dependencies** (design.md §Dependency budget). Adding one
is a stop-and-discuss, not a task.

---

## Slice 1 — the page exists, read-only — PENDING

Covers **FR-1, FR-2, FR-14**, FR-9 (hero row), **INV-1, INV-2, INV-6**.
Thinnest end-to-end path: open the command → render current state offline → run init.

### T0 — Invariants (write first, before implementation)
- [ ] `packages/minspec/tests/getting-started.test.ts` (**new — owned**) — **INV-1 / AC-1**:
      a network-recording harness asserts **zero** network/external calls on open+render
      (no `fetch`, no `https`, no `gh`/child-process spawn), including the identity seed.
- [ ] same file — **INV-2 / AC-2**: a structure assertion that the rendered HTML contains
      **no** progress-meter / "N of M" / percentage-complete element. Written as a
      deny-list on the markup, so a later slice cannot reintroduce one silently.
- [ ] same file — **AC-11 (FR-15)**: no reading-time and no conformance
      (`minspec.conformance.enabled`) control is present anywhere on the page.

### T1 — Contract
- [ ] `packages/minspec/tests/onboarding-settings.test.ts` (**new — owned**) — the pure
      `buildOnboardingModel()` returns the design.md §API row inventory: every row's
      `settingId` / `commandId` is a **real** contributed key or registered command
      (assert against `package.json` `contributes`, not a hand-copied literal), tiers are
      `required|recommended|optional`, and the model builder performs **no** I/O beyond
      config + the offline `resolveApproverEmail` read.

### Implementation
- [ ] `packages/minspec/src/lib/onboarding-settings.ts` (**new — owned**) — the pure
      `OnboardingModel` / `OnboardingRow` builder (design.md §API/Contracts). No vscode
      webview imports, no network; reads current config values and the offline
      `resolveApproverEmail` seed ([approve.ts:92](../../../packages/minspec/src/commands/approve.ts#L92)).
- [ ] `packages/minspec/src/views/getting-started-webview.ts` (**new — owned**) — the
      webview panel: four-point primer, hero *Initialize SDD structure* → `minspec.init`,
      read-only tiered render, Phase-2 banner (INV-6). **Strict CSP**, theme tokens only
      (`var(--vscode-*)`), no remote resources — the CSP is what makes AC-1 hold by
      construction, not just by test.
- [ ] `packages/minspec/src/commands/getting-started.ts` (**new — owned**) — registers
      `minspec.gettingStarted`, opens/reveals the single panel (re-openable, never a
      one-shot modal — FR-1).
- [ ] `packages/minspec/package.json` (**affects**) — contribute the
      `minspec.gettingStarted` command; point the existing *Get Started with MinSpec*
      walkthrough steps at `command:minspec.gettingStarted` (D1 — deep-link, don't
      duplicate).
- [ ] `packages/minspec/src/extension.ts` (**affects**) — register the command in
      `activate`; **no panel is opened at activation** (constitution Constraints: cheap,
      side-effect-free activation).

### Done when
AC-1, AC-2, AC-11 pass; `MinSpec: Getting Started` opens a page that renders the primer,
the hero action, and the current tier state read-only; no writes, no network, no meter.

---

## Slice 2 — standing switches + meta-controls — PENDING

Covers **FR-4, FR-6, FR-7, FR-10, FR-13**, FR-9 (meta-toggle + shortcut labels),
**INV-3, INV-5**.

### T0 — Invariants (first)
- [ ] `getting-started.test.ts` — **INV-3 / AC-3**: a page dismissal round-trips through
      the [#883] `answeredSignatures` model
      ([auto-bootstrap.ts:68](../../../packages/minspec/src/lib/auto-bootstrap.ts#L68))
      — dismissed item stays hidden, and **reappears** once its state signature changes.
      Asserts **no second dismissal store** is created (D2).
- [ ] `getting-started.test.ts` — **INV-5**: `silentRefresh` renders **disabled with a
      "Planned" tag** and is not writable from the page (it is not a contributed setting;
      a live no-op toggle would fail this test).
- [ ] `packages/minspec/tests/advance-phase-default.test.ts` (**new — owned**) —
      **INV-5 / FR-6 back-compat**: with the contributed default flipped to `true`, a user
      who has **explicitly** set `minspec.advancePhaseOnApprove: false` still reads
      `false` through
      [`advancePhaseOnApproveEnabled()`](../../../packages/minspec/src/commands/approve.ts#L108).
      This is the one irreversible-feeling change in the spec — it gets its own test.

### T1 — Contract
- [ ] `onboarding-settings.test.ts` — **AC-7 (FR-10)**: `rowClickToggles` is `true`
      **only** for non-planned `kind: 'toggle'` rows. Truth-tabled over: email row,
      coverage row, approvals/multi row, refresh row (secondary action), planned
      `silentRefresh` row, plain toggle row.

### Implementation
- [ ] `onboarding-settings.ts` — the `rowClickToggles` derivation (D7) and
      `planned: true` for `silentRefresh` ([#186]).
- [ ] `getting-started-webview.ts` — toggle rows write via
      `workspace.getConfiguration('minspec').update(key, value, scope)`, honoring each
      setting's declared scope (`approverEmail` is `scope: application` —
      [package.json:510](../../../packages/minspec/package.json#L510)); whole-row click
      handler bound **only** where `rowClickToggles`; Space/Enter flips the focused
      switch; Tab order follows visual order.
- [ ] `getting-started-webview.ts` — the **"Show setting ids"** meta-toggle, **default
      off** (FR-9), and the footer master `minspec.autoBootstrap.enabled` (FR-13).
- [ ] `getting-started-webview.ts` — render each row's keybinding where one exists
      (inline/tooltip, always visible — hotkey-visibility rule); rows without a binding
      do **not** invent one.
- [ ] `packages/minspec/package.json` (**affects**) — flip
      `minspec.advancePhaseOnApprove` default `false → true` (D5,
      [package.json:504](../../../packages/minspec/package.json#L504)); update the
      `commitOnApprove` label copy to the single unified consent wording (FR-7:
      "commit MinSpec's own changes (approvals + harness refreshes); never pushed
      automatically").
- [ ] `packages/minspec/src/lib/auto-bootstrap.ts` (**affects — reuse only**) — page
      dismissals call the existing `loadPreferences`/`savePreferences` +
      `answeredSignatures`. **No behavior change to the module**; if this task starts
      needing one, stop — that is a different spec.

### Done when
AC-3, AC-4, AC-7, AC-8 pass; every Recommended switch reads/writes its real setting;
`advancePhaseOnApprove` shows **on** by default while an explicit user `false` survives;
`silentRefresh` shows Planned/disabled.

---

## Slice 3 — identity + per-action buttons + seed — PENDING

Covers **FR-5, FR-8, FR-11, FR-12, FR-16, FR-17, FR-14**, **INV-1, INV-4**.
This is the only slice that introduces an external read — every one of them is a click.

### T0 — Invariants (first)
- [ ] `getting-started.test.ts` — **INV-1/INV-4 / AC-14**: the `gh api user` read fires
      **only** on an explicit *Verify against GitHub* click, **never** on the identity
      row's first render; before that click the row shows the offline value with zero
      network; on an air-gapped host (spawn fails / `gh` absent) the page renders without
      hanging and the offline value stands.
- [ ] `getting-started.test.ts` — **INV-4 / AC-5**: entering a valid email writes **only**
      `minspec.approverEmail` and **no approval record** — asserted by watching the **real
      approval store**, the per-file sidecar tree `.minspec/approvals/**` (37 tracked
      records; `.minspec/approvals/specs/<specPath>.json`), for zero writes across the
      whole interaction. The watch must be the **directory tree**, not the legacy
      `.minspec/approvals.json` path — that path is gitignored ([.gitignore:92](../../../.gitignore#L92))
      and absent from every checkout, so watching it would assert nothing and let a
      spurious sign-off through (#974). The page must never mint a sign-off; DR-056
      ([approve.ts:240](../../../packages/minspec/src/commands/approve.ts#L240)) stays the
      sole adjudicator.
- [ ] `getting-started.test.ts` — **FR-14 / AC-6, AC-12, AC-13**: render-only tests assert
      `minspec.backfillEpics`, `minspec.initRefresh`, and the GitHub-PR-extension install
      path each fire **zero** times on render, and exactly once on their button click.
      AC-13 explicitly fails an implementation that **omits** the Install button.
- [ ] `getting-started.test.ts` — **AC-10 (FR-12)**: the page never writes
      `minspec.scroogellmNudge.enabled = false` (asserted over every interaction, not just
      the Scrooge row) and renders it **on** with no off-control.

### T1 — Contract
- [ ] `onboarding-settings.test.ts` — `ApproverIdentity`: `value` is the offline
      `resolveApproverEmail` seed with no network; `valid` is a pure email-format check;
      `divergesFromGh` is **false whenever `ghLogin === null`** (i.e. impossible before a
      verify click) and true only for valid-but-different — truth-tabled.

### Implementation
- [ ] `onboarding-settings.ts` — `ApproverIdentity` compute (offline seed + format check;
      divergence computable only post-verify).
- [ ] `getting-started-webview.ts` — the approver email field (offline seed, editable, not
      hard-locked), the click-gated **Verify against GitHub** action (best-effort
      `gh api user` shell-out — D4), and the **non-blocking amber** divergence line
      (`--vscode-editorWarning-foreground`) reading *"differs from your GitHub login —
      approvals under this email can't be auto-verified."*
- [ ] `getting-started-webview.ts` — **Backfill with AI** button → `minspec.backfillEpics`
      with `{ aiConsent: true }` on click only (mirrors
      [auto-bootstrap.ts:592](../../../packages/minspec/src/lib/auto-bootstrap.ts#L592));
      `minspec.autoBackfillUseAi` is deliberately **not** rendered (FR-8).
- [ ] `getting-started-webview.ts` — **Refresh now** button → existing
      `minspec.initRefresh` on click only (FR-16); its row is excluded from row-click
      (FR-10).
- [ ] `getting-started-webview.ts` — **Install** button → the existing
      [`offerGitHubPrExtensionAdvisory` install path](../../../packages/minspec/src/commands/init.ts#L707)
      on click only (FR-17). **No new install logic.**
- [ ] `getting-started-webview.ts` — the coverage number field bound to
      `minspec.coverage.minimumPercentage`, helper copy **verbatim from**
      [package.json:528](../../../packages/minspec/package.json#L528) (FR-11 / AC-9); and
      the Scrooge nudge row rendered **on** with no off-control (FR-12).
- [ ] `packages/minspec/src/commands/init.ts` (**affects — reuse only**) — expose/reuse the
      existing install + refresh entry points for the buttons. No new network capability
      beyond the click-gated `gh api user` read named in D4.

### Done when
AC-5, AC-6, AC-9, AC-10, AC-12, AC-13, AC-14 pass; the page is feature-complete against
requirements FR-1..FR-17 with every external action click-gated.

---

## Cross-slice — closing tasks

- [ ] **T3 regressions** — one per bug found during implement (design.md §Test strategy).
- [ ] **Coverage gate** — the repo's vitest thresholds
      ([vitest.config.ts:42-47](../../../vitest.config.ts#L42), currently 85 from
      `.minspec/config.json`) must stay green; new webview code counts.
- [ ] **Full suite + validate** — `npm test` and `npm run validate` from the repo root
      (the vitest include glob is `packages/*/tests/**`, so a package-scoped run misses
      files).
- [ ] **Manual verification** — install the built `.vsix` (bump version; same-version
      `--force` reinstall is unreliable), reload, and confirm the page opens, persists,
      and re-opens with the dismissals remembered.
- [ ] **Retire nothing silently** — the six activation toasts stay under
      `autoBootstrap.enabled`; if implement finds a toast made redundant, that is a
      **follow-up issue**, not an in-scope deletion (requirements Out of scope).

## Traceability

| Artifact | Ref |
|---|---|
| Issue | [#533](https://github.com/AIClarityAU/minspec/issues/533) — merge onboarding toasts into one page |
| Requirements | [requirements.md](./requirements.md) — FR-1..17, INV-1..6, AC-1..14 |
| Plan | [design.md](./design.md) — D1..D7, slice plan, test strategy |
| Foundation reused | [#883] per-signature toast memory (merged, PR [#887]) |
| Dependencies (not built here) | [#186] `silentRefresh` behavior · [#758] harness-refresh commit unification |
| Adjacent, out of scope | [#920] scaffolded projects get the coverage seed without the enforcement (narrowed 2026-07-26; the in-repo gate at [vitest.config.ts:11](../../../vitest.config.ts#L11) **is** real) |
| Identity gate | [DR-056] / [SPEC-037] — the page sets `minspec.approverEmail` only; it never mints a sign-off |

[#186]: https://github.com/AIClarityAU/minspec/issues/186
[#533]: https://github.com/AIClarityAU/minspec/issues/533
[#758]: https://github.com/AIClarityAU/minspec/issues/758
[#883]: https://github.com/AIClarityAU/minspec/issues/883
[#887]: https://github.com/AIClarityAU/minspec/pull/887
[#920]: https://github.com/AIClarityAU/minspec/issues/920
[DR-056]: ../../../docs/decisions/DR-056.md
[SPEC-037]: ../SPEC-037-approver-identity/requirements.md
