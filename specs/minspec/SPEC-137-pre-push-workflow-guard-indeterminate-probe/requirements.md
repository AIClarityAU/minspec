---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a refusal that is false trains operators to ignore the true one
aspects: [git-hooks, pre-push, ci-workflows, app-token, false-refusal, advisory-gate]
relates_to: [SPEC-073, DR-003]
---

# SPEC-137: The pre-push workflow guard must not refuse a push the server accepts

Issue: #1278 (stale #1120 premise). Builds on #1120 (the original guard), #1141
(credential probe), #1263 (merge-base range), #1460 / #1954 (the permission probe).

## Problem

`.githooks/pre-push` refuses a push that touches `.github/workflows/**` when the push
credential is a GitHub App installation token (`push_credential_is_app_token`,
`scripts/lib/workflow-paths.sh`). The premise was that the App lacks `workflows: write`.
That permission has since been granted, and the server accepted the push the hook refused
(#1278: `MINSPEC_ALLOW_WORKFLOW_PUSH=1` pushed `dr-id-collision.yml` successfully).

### What the issue gets right, and what main already changed (checked, not assumed)

The issue was filed against a tree that predates part of the fix. Reading `main`:

- **Permission probe already exists** (`workflow_permission_granted`,
  `scripts/lib/workflow-paths.sh`, called from `.githooks/pre-push` after path detection).
  The issue's fix option 2 is therefore partly built.
- **Path enumeration was already fixed by #1263** (the "also worth a look" item: the
  hook now uses the ref-update range, or merge-base against the default branch, instead
  of endpoints). The over-broad list should be re-verified, not re-fixed (FR-5).
- **The probe fails CLOSED when it cannot answer.** In a host-brokered environment the
  token script's `--permissions` flag reports a different quantity than the installation's
  grants; the function returns non-zero *without caching* and the hook refuses. This is
  the residual defect: **"the probe could not tell" is rendered to the operator as "the
  permission is absent"**, which is a false refusal exactly when the permission is in fact
  granted. (Hypothesis, unverified: this is the path #1278 hit; the implementer must
  reproduce it in a brokered session before relying on it.)

### Root cause (mechanism + missing gate)

The guard has two outcomes for the probe, answered/unanswered, but only one
*consequence* for unanswered: refuse, with wording identical to a determinate "absent".
The guard is documented as advisory (not an access control), yet its failure mode for an
unmeasurable premise is the strongest action it has. The missing piece is a distinct
third state — **indeterminate** — with its own, honest behaviour, and a test that a
granted-but-unprobable permission does not refuse.

## Functional requirements

- **FR-1 Three-valued probe.** `workflow_permission_granted` (or a successor) reports one of
  `granted`, `absent`, `indeterminate`. `absent` requires a determinate `name=level`
  permissions object lacking `workflows=write`. Every error, timeout, missing script, or
  non-permissions output is `indeterminate`, never `absent`.
- **FR-2 Refuse only on `absent`.** The hook refuses only when a workflow path is touched,
  the credential is an App token, and the probe is `absent`. `granted` proceeds silently.
- **FR-3 Indeterminate is visible, not silent.** On `indeterminate` the behaviour is set by
  Decision DQ-1. Whichever option is chosen, the hook prints a one-line stderr notice naming
  that the permission could not be verified and what the server will do if it is missing,
  and the refusal text (when emitted) never claims the permission is absent unless FR-1's
  `absent` holds.
- **FR-4 Override stays, and is rarer.** `MINSPEC_ALLOW_WORKFLOW_PUSH=1` and
  `minspec.allowWorkflowPush` are unchanged. No new bypass variable is added.
- **FR-5 Path list is the push's own delta.** A regression test proves a branch adding one
  workflow file while `main` independently changed others lists only the added file
  (re-verifies #1263 against the exact #1278 shape: `approve-on-label.yml` must not appear).
- **FR-6 Server rejection message.** Independent of the hook, the dispatch/remediate publish
  scripts that already call the workflow preflight keep their behaviour; any change there
  follows FR-1..FR-3 through the shared library, not a second copy.
- **FR-7 Comments.** The stale narrative ("the App lacks this permission") in
  `.githooks/pre-push` and `scripts/lib/workflow-paths.sh` is rewritten to the three-state
  model (sweep comments on change).

## Acceptance criteria

- **AC-1** Probe output `workflows=write` ⇒ push proceeds, no stderr noise, no override needed.
- **AC-2** Probe output with `name=level` pairs but no `workflows=write` ⇒ refusal (unchanged).
- **AC-3** Missing/non-executable token script, empty output, non-zero exit, or an
  unrecognised shape ⇒ `indeterminate`; outcome per DQ-1; never cached as `absent`.
- **AC-4** A determinate `absent` is cached for the TTL; `indeterminate` is never cached.
- **AC-5** Non-App credentials and pushes touching no workflow path make no probe call
  (unchanged; asserted).
- **AC-6** FR-5 test, run red on a tree that uses endpoint diffs, green on head.
- **AC-7** Tests drive the real hook with `MINSPEC_FAKE_APP_CRED` and a stub token script
  covering all three states (not source-text assertions).

## Invariants this must not break

- Constitution inv. 1: no network call without consent — the probe stays dev-time tooling
  in `scripts/`, runs only after path detection, and only for an App credential.
- Constitution inv. 2 (no silent gate): the choice under DQ-1 must keep the *indeterminate*
  case visible. Note this guard is advisory and is not a merge-gating or required check; the
  authoritative gate is the server (and CI), so failing open here removes no witness.
- Constitution inv. 3: nothing changes in repos without `.minspec/`; the hook already
  exits early when its library is absent.
- The hook never prompts on the terminal and never reads the credential password.

## Out of scope

Deleting the guard outright (option 1) and a push wrapper that parses the server's
rejection (option 3): see DQ-1 for why neither is the recommendation.

## Decisions needed (Clarify)

**DQ-1 — What does the hook do when the permission is `indeterminate`?**

- **A. Warn and allow (rec).** Print the FR-3 notice and let the push go; the server is the
  authority and rejects with its own message if the grant is missing. Eliminates the false
  refusal and the override habit. *Cost:* in the one case the guard exists for (permission
  genuinely missing AND probe unable to tell) the commit is already sealed when the server
  rejects it, which is the pain #1120 originally set out to avoid.
- **B. Keep refusing, but say "could not verify" and name the exact override.** Preserves
  the pre-emptive stop. *Cost:* still stops correct pushes in brokered sessions, so the
  override habit this issue is about persists; only the wording improves.
- **C. Delete the guard (issue option 1).** Simplest. *Cost:* loses the early, actionable
  message if the grant is ever revoked; #1120 showed that revocation is a real event.
- **D. Let the server decide via a push wrapper (issue option 3).** No false positives.
  *Cost:* a git hook cannot observe the server's rejection, so this needs a wrapper script
  or alias that operators bypass by running plain `git push`; it is more machinery than the
  advisory guard justifies.

Rejected by this draft without needing a decision: leaving the stale predicate as is.
