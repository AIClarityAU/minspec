---
id: SPEC-063
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — uninstall is the guaranteed exit that makes "opt-in blast radius" (invariant #3) truthful; the reverse of SPEC-033 provisioning
relates_to: [SPEC-033, SPEC-042]  # SPEC-033 is the provisioning half this must reverse file-for-file · SPEC-042 is the onboarding front door whose init this mirrors
implements: [packages/minspec/src/commands/uninstall.ts, packages/minspec/src/lib/uninstall-inventory.ts, packages/minspec/tests/uninstall.test.ts]  # all NEW (greenfield ownership, SPEC-038 AC-3). The command/lib split is pre-declared deliberately: adding a path AFTER approval stales the hash and forces a re-sign - the SPEC-051 #1323 trap.
affects: [packages/minspec/package.json, packages/minspec/src/extension.ts, packages/minspec/src/lib/template-registry.ts, packages/minspec/src/lib/ruleset-advisor.ts]  # command contribution + registration; the marker-region strip (FR-4) and gh-api DELETE (FR-3) reuse the provisioning helpers in reverse - reused, never owned.
---

# MinSpec — Clean uninstall (graded disable / remove-harness / full removal) — Requirements

**Date:** 2026-08-06
**Status:** Specifying
**Triggered by:** [#889](https://github.com/AIClarityAU/minspec/issues/889) — "Clean uninstall — let the user disable/remove GH Actions, rulesets, CLAUDE.md, harness, and optionally all MinSpec files."
**Builds on:** [DR-011](../../../docs/decisions/DR-011.md) — the marker-bounded write contract this must reverse without touching user content outside the markers · [DR-037](../../../docs/decisions/DR-037.md) — the editor-independent git hooks (`core.hooksPath`) this must also unwind · the constitution's **invariant #3** (MinSpec's blast radius is the opt-in repo; `.minspec/` is the opt-in marker) — uninstall is what makes that promise keepable.
**Inverse of:** [SPEC-033](../SPEC-033-repo-governance-provisioning/requirements.md) — Repo Governance Provisioning. Everything SPEC-033 scaffolds (ai-review workflow set, branch-protection rulesets, dispatch/drain scripts, auto-merge gate) is in this spec's removal surface. Read the two together: the provisioning inventory is the uninstall inventory.

> This spec gives the user a **guaranteed, graded exit** from MinSpec. Init writes a lot
> into a repo — GitHub Actions, branch-protection **rulesets**, `CLAUDE.md`/`AGENTS.md`
> marker regions, the `.minspec/` harness, git hooks, and real sign-off/spec/decision work.
> Today there is no reverse operation: a user who wants MinSpec gone must hand-hunt every
> artifact, and can neither prove it is fully removed nor avoid deleting their own specs by
> accident. This is a direct threat to invariant #3 — an opt-in whose opt-**out** is manual
> and lossy is not really opt-in. The design has **three graded levels** with sharply
> different risk, so the spec's structure follows the issue's: **Disable** (stop gating,
> keep files) → **Remove harness** (delete what MinSpec owns) → **Full removal** (also delete
> real work: approvals, specs, decisions). The two genuinely irreversible/authority questions
> — *does the extension ever `gh api DELETE` a ruleset*, and *how is destructive Level 3
> confirmed and backed up* — are **human-only calls**; see *Decisions needed (Clarify)*.

---

## Context

MinSpec installs across four distinct surfaces. A clean uninstall must know all four, and
must classify each artifact by **who owns it** (MinSpec-generated vs user-authored) and
**where it lives** (local file vs GitHub server-side state the extension can only reach over
the network with admin auth). The inventory below is drawn from the provisioning side
(`template-registry.ts` `MANAGED_REGION_TEMPLATES`, `init.ts`, `ruleset-advisor.ts`) and
from the constitution's opt-in marker.

### The install inventory (what a uninstall must be able to reverse)

| # | Surface | Artifacts (examples, not exhaustive) | Owner | Reach |
|---|---|---|---|---|
| A | **GitHub Actions** | `.github/workflows/{ai-review,ai-review-retry,ready-to-merge,docs-lane,minspec-validate,minspec-ci-parity,supply-chain-daily}.yml`, `.github/scripts/ai-review-guard.js` | MinSpec-generated | local files (delete = disable) |
| B | **Branch-protection rulesets** | `main` ruleset requiring the `ai-review` check, blocking force-push/deletion (`ruleset-advisor.ts`) | MinSpec-provisioned | **GitHub server-side** — removal is a `gh api DELETE`, needs repo-admin |
| C | **Repo variables / secrets** | `AI_REVIEW_BOT_LOGINS`, `CLAUDE_CODE_OAUTH_TOKEN`, `MINSPEC_APP_ID`, `MINSPEC_APP_PRIVATE_KEY` | user-set (MinSpec surfaced) | **GitHub server-side**; secret *values* are not the extension's to read |
| D | **Labels** | `inbox`, `agent-ready`, `agent-ready-specify`, `ai-review:pass`, `ai-review:changes`, `needs-review`… (`.minspec/labels.md`) | MinSpec-provisioned | GitHub server-side |
| E | **Dispatch/automation scripts** | `scripts/review-branch.sh`, `review-decide.sh`, `dispatch-issue.sh`, `triage-inbox.sh`, `drain-inbox.sh`, `auto-merge-gate.ts`, `scripts/roles/*` | MinSpec-generated | local files |
| F | **Co-owned harness prose** | `CLAUDE.md`, `AGENTS.md` — MinSpec content lives **inside markers** (DR-011); the file may also hold user prose | **shared** — MinSpec owns only the marker region | local file |
| G | **`.minspec/` harness (generated)** | `constitution.md`, `labels.md`, `config.json`, `generated-hashes.json`, `template-baseline.json`, `preferences.json`, `calibration.json`, `session.json`, `hooks/`, `queue/`, `sessions/` | MinSpec-generated | local files |
| H | **Git hooks** | `.githooks/commit-msg` (RCDD gate) + `git config core.hooksPath .githooks` (DR-037) | MinSpec-generated + git config | local file + repo git config |
| I | **Real work (NOT harness)** | `.minspec/approvals/**/*.json` (sign-off records), `specs/**`, `docs/decisions/**`, `docs/epics/**` | **user-authored** | local files |

The bright line is between rows A–H (**MinSpec's own machinery**) and row I (**the user's
real work**). Level 2 removes A–H and preserves I; only Level 3 touches I, and only under a
sharper confirmation.

### Root cause (mechanism + missing gate)

The mechanism gap: **`init.ts` / provisioning has no inverse.** Every write path
(`renderManagedFile`, ruleset POST, hook install, marker-region merge) is one-directional;
nothing enumerates what was written or removes it. The missing gate: invariant #3 promises a
bounded, opt-in blast radius, but nothing **enforces the exit** — there is no command that can
assert "MinSpec no longer changes behaviour in this repo," which is exactly what invariant #3
requires to be true on demand. A user's only recourse today is manual deletion, which is both
lossy (easy to delete `specs/` real work) and unverifiable (server-side rulesets/labels are
invisible from a file tree).

### What exists — reuse, do not rebuild

| Piece | Where | Reuse for |
|---|---|---|
| Managed-region marker contract (write only between markers, preserve outside) | `template-registry.ts` `renderManagedFile`, `merge-refresh.ts` (DR-011) | Level 2 marker-region **removal** from co-owned files (F) — the exact inverse |
| Ruleset detect/read/write via credential-free `gh api` | `ruleset-advisor.ts` (GET to detect, POST to write) | Level 1/2 ruleset **removal** (`gh api DELETE`), same auth model |
| Non-modal "offer to fix" HITL pattern | `init.ts` `offerScaffoldCommit` / `offerRulesetAdvisory` | The uninstall confirmation UX — non-modal, visible, never focus-stealing |
| The full provisioning inventory | SPEC-033 FR-1/FR-3/FR-6/FR-7 | The authoritative removal checklist — keep the two specs in lockstep |
| The opt-in marker | `.minspec/` at repo root (invariant #3) | The single presence signal uninstall keys on; its deletion is the terminal step |

---

## Scope

### In scope

- **FR-1 — Graded uninstall command with three explicit levels.** A `MinSpec: Uninstall /
  Remove from Repo` command that presents the three levels from #889 as an explicit,
  non-modal choice, each level a strict superset of the one before:
  - **Level 1 — Disable (stop gating, keep files).** Stop MinSpec's checks from
    blocking work while leaving every file in place, so the choice is fully reversible by
    re-enabling. Mechanically this is: remove/relax the branch-protection ruleset's
    `ai-review` required-check (B) so PRs merge without it, and disable the workflow runs
    (A) — **exact mechanism is a Clarify call, see D-1**. No file is deleted at this level.
  - **Level 2 — Remove harness.** Delete everything MinSpec **owns** — rows A, D, E, G, H
    in full; **strip only the marker region** from co-owned files (F, per DR-011) — and
    remove server-side state MinSpec provisioned (B rulesets, D labels) subject to the
    authority gate (D-2). **Preserves row I entirely** (approvals, specs, decisions).
  - **Level 3 — Full removal (as if never installed).** Everything in Level 2 **plus**
    row I: `.minspec/approvals/**`, and the `specs/` / `docs/decisions/` / `docs/epics/`
    scaffolding. This deletes real work and is gated by a sharper confirmation + backup
    offer (D-4).
- **FR-2 — Per-level preview before any destructive action.** Each level, before executing,
  shows the **enumerated list of exactly what it will delete, strip, or change on the
  server**, grouped by the A–I rows, so the user acts on a visible artifact — never a vague
  "remove MinSpec? [y/N]" ([HITL approval UX](../../../docs/decisions/DR-062.md) — act on an
  enumerated artifact). Level 3's preview lists every real-work path (approvals/specs/
  decisions) individually.
- **FR-3 — Server-side removal is HITL + fail-safe + honest.** Ruleset (B) and label (D)
  removal go through the credential-free `gh api` path (`ruleset-advisor.ts` precedent).
  When `gh` is unavailable / not authed / lacks repo-admin, the command **downgrades to
  advisory** — it surfaces the exact `gh`/GitHub-UI steps and changes nothing server-side,
  and it **reports the server-side items as NOT removed** (never marks them done). No stored
  PAT, no direct token client (holds to DR-054/DR-050 — MinSpec holds no credential).
- **FR-4 — Co-owned files: strip the marker region, don't clobber (DR-011 inverse).** For
  `CLAUDE.md`/`AGENTS.md` (F), Level 2/3 removes **only** the MinSpec-owned content between
  the markers, plus the markers. If prose outside the markers remains, the file is kept with
  its user content intact; if the file becomes empty (or MinSpec-only), it is deleted.
  Deleted/absent/corrupt markers ⇒ skip + warn, never a blind whole-file delete (the DR-011
  no-clobber contract, run in reverse).
- **FR-5 — Git-config + hooks unwind (DR-037).** Level 2/3 deletes `.githooks/` and reverts
  the `core.hooksPath` git config **only if MinSpec set it to `.githooks`**; a
  `core.hooksPath` the user pointed elsewhere is left untouched (surface it, do not fight the
  user's config). Reverting is a plain `git config --unset` on the **local repo** config,
  never `--global` (the global gitconfig is out of MinSpec's blast radius — invariant #3).
- **FR-6 — Level 3 real-work protection.** Level 3 requires a **distinct, stronger
  confirmation** than Level 1/2 (D-4) and **offers a backup/export** of row I (a single
  archive of `specs/` + `docs/decisions/` + `docs/epics/` + `.minspec/approvals/`) before
  deleting, so a mis-click is recoverable. The extension never deletes row I without both
  the stronger confirm and the offered (accept-or-explicitly-decline) backup step.
- **FR-7 — Verifiable, idempotent completion.** After a level runs, the command reports what
  was removed, what was preserved, and — for the server-side items it could not reach — what
  the user must still do by hand. Re-running any level is a clean no-op on already-removed
  artifacts (never an error on a missing file). After Level 2/3, the terminal signal is the
  absence of the `.minspec/` opt-in marker (invariant #3): its removal is the last step, so
  the repo reads as un-opted-in only once everything above it is gone.
- **FR-8 — Mirror of init, reachable the same way.** The command is the palette mirror of
  *MinSpec: Initialize / Refresh SDD Structure* (SPEC-033 FR-9), keyboard-reachable, showing
  its keybinding. It appears in the palette regardless of scaffolding state, but on a repo
  with no `.minspec/` it reports "nothing to remove" rather than erroring.

### Out of scope (explicitly)

- **Uninstalling the VS Code extension itself** — that is the Marketplace/`code
  --uninstall-extension` path, owned by VS Code, not this command. This spec removes what the
  extension *wrote into a repo*, not the extension binary.
- **Deleting repo *secret values*** (row C) — the extension cannot read them and should not
  silently delete credentials the user may reuse. Uninstall **surfaces** the secret names to
  remove (advisory), never touches them. (Mirror of SPEC-033 FR-4's headless-honesty stance.)
- **Cross-repo / workspace-wide uninstall** — Level operates on the current repo. A
  workspace-wide sweep mirrors SPEC-033 FR-8 and is a separable follow-up, not this spec.
- **Reverting individual commits MinSpec authored** — uninstall removes present-state
  artifacts; it does not rewrite git history. Real-work backups (FR-6) are the recovery path,
  not history surgery.
- **Un-provisioning another repo's fork of the ai-review App install** — App installs are a
  web-OAuth flow the extension cannot drive headlessly (same infeasibility SPEC-033 records);
  surfaced as an advisory step, never faked.

## Invariants (T0 — write these tests before implementation)

- **INV-1 — Blast-radius reversal (invariant #3).** After Level 2 or Level 3, no
  MinSpec-authored file or MinSpec-set local git config remains except (Level 2 only) row I;
  the `.minspec/` marker is absent. Nothing outside the repo (global gitconfig, other repos,
  machine config) is ever touched by any level.
- **INV-2 — No clobber of user content (DR-011 inverse).** Stripping the marker region from a
  co-owned file (F) never removes a byte outside the markers; a file with surviving user
  prose is kept, not deleted. Deleted/absent markers ⇒ skip + warn, never whole-file delete.
- **INV-3 — Real work is Level-3-only and backup-gated.** Rows I (approvals, specs,
  decisions, epics) are untouched by Level 1 and Level 2; Level 3 deletes them only after the
  stronger confirm (D-4) **and** the offered backup step (FR-6). No level silently deletes a
  spec or an approval sidecar.
- **INV-4 — Headless honesty (never-wrong).** The command never reports a server-side item
  (ruleset, label) as removed when the `gh api` call did not run or failed; those render as an
  explicit "still present — remove by hand" list. A false "fully removed" is the worst defect
  in a never-wrong product.
- **INV-5 — Server-side removal is HITL + fail-safe.** No ruleset/label deletion without
  explicit confirm; no admin auth ⇒ advisory only, never a silent partial server write; the
  path holds no credential (DR-054/DR-050).
- **INV-6 — Idempotent.** Any level re-run is a no-op on already-removed artifacts and never
  errors on a missing file/config/ruleset.
- **INV-7 — Preview-before-destroy.** No file is deleted, no marker stripped, and no
  server-side call made before the FR-2 enumerated preview is shown and confirmed. The
  preview lists exactly the artifacts the run will touch (no more, no fewer).
- **INV-8 — Keyboard-reachable + visible.** The command and its per-level confirmations have
  a keyboard path and show their keybinding; confirmations are non-modal over a visible
  artifact, never a focus-stealing modal ([HITL approval UX](../../../docs/decisions/DR-062.md)).
- **INV-9 — Local-only git config.** FR-5's `core.hooksPath` unset operates on the repo-local
  config only; `git config --global` is never invoked (invariant #3 — the global config did
  not opt in).

## Decisions needed (Clarify — human-only)

- **D-1 — Level 1 "Disable" mechanism.** What does "stop gating but keep files" mechanically
  do to the workflows (A) and ruleset (B)? Options: **(a)** remove only the ruleset's
  `ai-review` required-check (PRs merge without waiting) and leave workflows running but
  non-blocking; **(b)** also disable the workflow runs via the GitHub "disable workflow" API;
  **(c)** rename/neuter the workflow files locally (a file edit, no server call). Trade-off:
  (a)/(b) need the same admin auth as removal and are cleanly reversible server-side; (c) is
  a local-only file change (no auth) but mutates files the user said to "keep." *Recommendation:*
  (a) as the default (minimal, reversible, matches the gate's meaning of "gating"); offer (b)
  when admin auth is present; avoid (c) since "Disable" promised to keep files as-is.
- **D-2 — Does the extension ever `gh api DELETE` a ruleset, or advise-only?** Same authority
  question as SPEC-033 D-2, now on the removal side. Deleting a branch-protection ruleset is a
  destructive server-side admin write. Options: **advise-only** (surface the exact steps,
  change nothing server-side) vs **opt-in write** behind explicit confirm + present-admin-auth
  check. *Recommendation:* advise-only by default; opt-in delete behind explicit confirm and a
  present-`gh`-admin check, downgrading to advisory when auth is absent (FR-3). **If Clarify
  chooses "ever write," file the DR** flagged in SPEC-033's follow-ups (the "which governance
  bits the vsix auto-writes vs surfaces" DR) — a server-side delete is not reversible in
  <1 day and crosses the DR-359 ADR filter.
- **D-3 — Level 3 destructive-confirm mechanism.** Deleting `specs/`, `docs/decisions/`, and
  approval sidecars is real, possibly-uncommitted work. Options for the stronger confirm:
  **(a)** type the repo name to confirm; **(b)** a two-step "are you sure / really sure";
  **(c)** require a clean git working tree first (so everything is at least committed and
  recoverable from history). Trade-off: (a)/(b) are pure UX friction; (c) adds a real safety
  property (recoverable from git) but blocks users who keep specs uncommitted. *Recommendation:*
  (a) type-repo-name **and** (c)-as-a-warning (warn if the working tree is dirty, don't hard-block),
  plus the FR-6 backup offer.
- **D-4 — Backup format for Level 3 (FR-6).** A single `.tar.gz`/`.zip` of row I written where
  (repo root? a user-chosen path? OS temp?), or defer to "commit to git first" as the only
  recovery path? *Recommendation:* offer a timestamped archive at a user-chosen path by
  default, with "I've committed, skip backup" as an explicit opt-out — never a silent skip.
- **D-5 — Tier: T3 or T4?** Level 1/local-file removal is T3-shaped. Level 2/3's server-side
  ruleset/label **deletes** (D-2 opt-in path) and irreversible real-work deletion arguably make
  the destructive half T4, warranting a security review of the `gh api DELETE` path (symmetry
  with SPEC-033 D-1, which security-reviewed the provisioning write). *Recommendation:* keep the
  file-removal + advisory path T3; treat the opt-in server-side-delete path as its own
  security-reviewed slice.
- **D-6 — Label removal blast radius (row D).** Labels like `inbox`/`agent-ready` may have been
  applied to real issues; deleting the label strips it from every issue. Options: delete only
  MinSpec-defined labels that are **unused** on open issues; delete all regardless; or advise-only.
  *Recommendation:* advise-only for labels by default (low harm to leave, real harm to strip
  issue metadata), with an opt-in "delete unused MinSpec labels" — never bulk-delete labels that
  carry issue state.
- **D-7 — Tier-0 / positioning.** Local file deletion is Tier-0 (no network). The server-side
  removal path (B/D via `gh api`) is a delegated network write, consistent with SPEC-033's
  relaxed-network stance (DR-054, data-sovereignty not air-gap). Confirm this sits in the same
  tier envelope as provisioning, and whether uninstall ships in the core MinSpec ext or (like
  dispatch) is Execute-tier. *Recommendation:* ship the local-removal command in core MinSpec
  (it is the invariant-#3 exit, which core must guarantee); keep server-side deletes on the same
  delegated-network footing as SPEC-033.

## Acceptance (feature-level, verified end-to-end)

1. On a fully-provisioned repo, `MinSpec: Uninstall / Remove from Repo` presents the three
   graded levels, each with an enumerated preview of exactly what it will touch (grouped A–I)
   before any change. [FR-1, FR-2, INV-7]
2. **Level 1 (Disable)** stops the `ai-review` gate from blocking merges without deleting any
   file; re-enabling restores gating. No local file is removed. [FR-1, D-1]
3. **Level 2 (Remove harness)** deletes rows A/E/G/H and strips only the marker region from
   `CLAUDE.md`/`AGENTS.md`; a user paragraph outside the markers survives; a `CLAUDE.md` that
   becomes MinSpec-only is deleted; `specs/`, `docs/decisions/`, and `.minspec/approvals/**`
   are **untouched**. [FR-4, INV-2, INV-3]
4. With `gh` admin auth absent, Level 2 removes local files but reports the ruleset (B) and
   labels (D) as **not removed**, printing the exact manual steps — never marking them done.
   [FR-3, INV-4, INV-5]
5. **Level 3 (Full removal)** additionally deletes row I, but only after the stronger confirm
   (D-3) and the offered backup (FR-6/D-4); declining the backup requires an explicit opt-out,
   not a silent skip. After it completes, `.minspec/` is absent and the repo reads as
   un-opted-in (invariant #3). [FR-6, FR-7, INV-1, INV-3]
6. `core.hooksPath` is unset **only** when MinSpec set it to `.githooks`; a user-pointed
   `core.hooksPath` and the global gitconfig are never touched. [FR-5, INV-9]
7. Re-running any level is a clean no-op — no error on already-removed files, configs, or
   rulesets. [FR-7, INV-6]
8. Running the command on a repo with no `.minspec/` reports "nothing to remove" and makes no
   change. [FR-8]

## Follow-ups (tracked — DR-023)

- **A DR for "which governance bits the vsix auto-deletes vs surfaces"** — file **if** Clarify
  (D-2) lands on ever `gh api DELETE`-ing a ruleset from the extension. This is the removal-side
  twin of the write-side DR already flagged in SPEC-033's follow-ups; a single DR can cover both
  directions (provision-write and uninstall-delete authority). `None` unless D-2 chooses "ever
  write."
- **Workspace-wide uninstall** — the mirror of SPEC-033 FR-8 (workspace-wide init). Separable
  follow-up issue if the founder wants a multi-folder sweep; not in this spec.
- **Keep the inventory in lockstep with SPEC-033.** Any artifact SPEC-033 (or a later
  provisioning spec) adds to the scaffold set must be added to this spec's removal inventory
  (rows A–I) in the same change — a provisioned-but-not-removable artifact is an invariant-#3
  leak. File the cross-reference check as a test/CI note during Plan.
- **Secret/label residue advisory copy** (rows C, D) — the exact `gh`/UI wording for the
  manual-removal steps is UX content to settle at Plan; ensure it names each secret/label
  explicitly rather than a vague "remove MinSpec secrets."
