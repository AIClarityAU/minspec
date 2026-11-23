---
id: SPEC-408
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - a manifest that vouches for bytes MinSpec never wrote is a false signpost
aspects: [managed-files, refresh, manifest, migration, no-silent-gate, tier-0]
depends_on: []
relates_to: ["#1718", "#1697", SPEC-043, SPEC-224, SPEC-263]
affects: [packages/minspec/src/lib/merge-refresh.ts, packages/minspec/src/lib/scaffold.ts]  # both already carry the code; scaffold.ts is OWNED by SPEC-043
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-408: A manifest written by a pre-fix MinSpec is never read as proof of authorship

> **This is a SPECIFICATION ONLY.** No code or test is created by this document. It is the
> Specify-phase artifact for #1718 (migration gap left by #1697), triaged T3.

## In plain terms

#1697 stopped MinSpec **minting** a false "MinSpec wrote this" claim in
`.minspec/generated-hashes.json`. It cannot **retract** a claim a pre-fix build already
wrote: a forged entry and a genuine one are both `hash(disk)`. This spec states the rule that
closes that gap and the evidence for it, so the behaviour is owned by a spec and not only by
code comments.

**What you are approving:** an unstamped (pre-fix) manifest yields no evidence; the first
refresh after upgrading holds and reports sections it cannot prove, once, then goes quiet.

## Measured state (read at `5ec29bac`)

Unverified claims are marked; the rest cite code.

| Fact | Where |
|---|---|
| The manifest carries a reserved stamp key `__minspec__` and the current format is `'2'` | `merge-refresh.ts:1148-1195` (`MANIFEST_STAMP_KEY`, `MANIFEST_HASH_VERSION`) |
| `saveHashes` is the only writer in `src/` and always stamps | `merge-refresh.ts:1408-1430` |
| `loadProvenHashes` returns `proven` only when the stamp equals `'2'`; an unstamped, non-empty manifest returns no entries plus a state (`pre-authorship` or `unrecognised-version`) | `merge-refresh.ts:1396-1405`, `classifyUnspentManifest` at `:1307` |
| The raw reader `loadHashes` exists but a test forbids spending it as evidence | `merge-refresh.ts:1341`; `merge-refresh.test.ts:3327` (AC-60) |
| The always-stamps rule is test-asserted | `merge-refresh.test.ts:3373` (AC-73) |
| The issue's option 3 (version-stamp, treat pre-fix entries as absent on read) is therefore ALREADY in the tree | the two rows above; the source comment names #1718 |

So the open question is not "how to fix" but "is the shipped behaviour the right one, and is
it specified and covered end to end". I believe the issue's measured probe (`rv3-upgrade*`)
now passes, but I did not re-run it here; the plan phase must.

## Functional requirements

- **FR-1.** A manifest without a recognised current stamp MUST yield zero proven entries, for
  every consumer that treats a recorded hash as evidence of authorship.
- **FR-2.** Every write of the manifest MUST carry the current stamp; no code path in `src/`
  may write it unstamped.
- **FR-3.** The first refresh over an unspent manifest MUST hold, and report, each section
  that has authored content differing from the template, and MUST name the true reason
  (pre-fix manifest, or unrecognised version) in the notice.
- **FR-4.** That refresh MUST rewrite the manifest stamped, so the next refresh has a baseline
  and is quiet (no repeat notices for sections already resolved).
- **FR-5.** The migration MUST NOT delete the manifest file and MUST NOT require user action.
- **FR-6.** A hand-edited or foreign manifest (stamp removed, unknown version) MUST fail
  closed to the same hold-and-report path, never to a spent entry.

## Acceptance criteria

- **AC-1.** Given a manifest, unstamped, whose entry equals the hash of user-authored
  content, and a template that later ships that heading: refresh holds the section, user text
  survives, and the section is reported (the issue's "refresh 2" case, which previously lost it).
- **AC-2.** Same fixture with a `'2'` stamp written by current code: behaviour is unchanged
  from today (no regression to proven entries).
- **AC-3.** After one refresh over the unstamped manifest, a second refresh emits no notice
  for the same sections.
- **AC-4.** A source-text gate (AC-60/AC-73 style) fails if any `src/` file spends the raw
  manifest or writes it without the stamp.
- **AC-5.** The notice for a pre-fix manifest says why every section was held at once.

## Invariants this must not break

- **INV-1 (constitution 2, no silent gate).** An unreadable baseline holds and says so; it
  never silently passes or silently overwrites.
- **INV-2 (constitution 1, offline).** No network call.
- **INV-3 (constitution 3, blast radius).** Only `.minspec/generated-hashes.json` in an
  opted-in repo is read or written.
- **INV-4 (SPEC-043 INV-4).** Manifest bytes stay deterministic for identical input.
- **INV-5.** Content-safe: a hold is recoverable, a silent deletion is not.

## Decisions needed (Clarify)

**D1. Keep the version stamp (option 3), or switch to delete-on-bump (option 1)?**

- **(rec) Keep the stamp.** Already built and test-asserted; no file deletion; falsifiable by
  AC-1. **Cost:** adds a reserved `__minspec__` key to shared persisted state, and any future
  format change needs a new version and the same one-time burst.
- Delete the manifest on a version bump. **Cost:** needs a recorded-MinSpec-version
  comparison that is not evidently stored today (unverified), and a destructive write.
- Do nothing, document the remedy. **Cost:** leaves the latent silent loss the issue names.

**D2. Is the one-time burst of hold notices acceptable, or should it be collapsed?**

- **(rec) Accept as is.** It is content-safe and happens once per machine. **Cost:** a noisy
  first refresh, including false holds on sections MinSpec itself wrote.
- Collapse into one summary notice. **Cost:** extra UI work, and a user can miss which
  sections were held (SPEC-224 observability).

**D3. Scope: is this a ratify-only spec, with implementation tasks limited to the missing
tests (AC-1 to AC-5)?**

- **(rec) Yes.** The code exists; the plan phase audits which ACs lack a test and adds only
  those. **Cost:** if the audit finds the stamp logic wrong, scope grows to a real fix.
- Re-implement from the spec. **Cost:** churn on code that already ships.

## Follow-ups (tracked)

- #1718 stays open until a plan-phase audit confirms AC-1 to AC-5 are covered, then closes
  on that evidence, not on this spec's approval.
