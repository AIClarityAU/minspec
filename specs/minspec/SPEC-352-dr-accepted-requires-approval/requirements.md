---
id: SPEC-352
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity
aspects: [approval, validate, decision-records, gate-integrity, fail-closed, tier-0]
depends_on: []
relates_to: ["#47", "DR-012", "DR-034", "DR-081", "DR-108", "SPEC-022", "SPEC-337"]
implements: none
implements_reason: >-
  Specify phase only (DR-076 / #1169 dispatch for a T3/T4 issue). File ownership is decided at
  Plan, after Clarify picks the legacy-corpus policy (Q1) and the witness shape (Q2).
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-352: A decision record cannot be `accepted` without a recorded approval

Triggered by: [#47](https://github.com/AIClarityAU/minspec/issues/47) — "validate check — DR
cannot be 'accepted' without recorded approval". Rests on DR-012 (content-hash HITL gate;
its own record was born accepted without approval), DR-034 (canonical hash) and DR-108
(delegated approval actor/basis).

## Why

`status: accepted` on a DR is the claim "a human decided this". Today `npm run validate`
checks accepted DRs for other things (e.g. Rule 16, amendment targets) but never that an
approval act exists. A DR can be hand-edited to `accepted` and merge green; because an
accepted DR is authoritative, a never-approved one misinforms (CLAUDE.md: worst defect class).

## Current state (read 2026-11-16 at worktree base; claims below were checked, not inferred)

- `approvable.ts:15` already classifies ADRs as an approvable kind (`'spec' | 'adr' | 'epic'`),
  so the content-hash sidecar mechanism is not spec-only in the extension.
- `.minspec/approvals/docs/decisions/` holds 15 sidecars (`DR-102.md.json` onward, shape:
  `specPath, specHash, approvedAt, approvedBy, tier, migrated, baselineBlob`); `docs/decisions/`
  has 115 files with `status: accepted`. So roughly 100 accepted DRs have no sidecar —
  the rule cannot be turned on fatal without a legacy policy (Q1).
- `scripts/validate-frontmatter.ts` already evaluates sidecars for specs (`getApprovalStatus`,
  imported line 39) and has an orphan-sidecar rule (Rule 10, non-fatal). No rule requires a
  sidecar for an accepted DR. (Counts are as of this read; Plan must recompute them.)

## Functional requirements

- **FR1.** `npm run validate` fails (fatal, not a warning) when a DR with frontmatter
  `status: accepted` has no valid recorded approval, per the witness chosen in Q2.
- **FR2.** "Valid" means the sidecar exists, its `specPath` matches the DR, and its hash equals
  the DR's current canonical hash (DR-034 canonicalisation, which ignores `status`). A sidecar
  with a stale hash fails with the same message class as stale spec approvals.
- **FR3.** Delegated approvals (DR-108 actor/basis) count as valid when the existing validator
  already accepts them for specs; this spec adds no new authorising party.
- **FR4.** A missing, unreadable or malformed approvals directory/record fails the rule visibly
  (invariant 2); it never passes silently or skips. A run that scans 0 accepted DRs prints a
  "validated nothing" warning, as Rules 24/25 do.
- **FR5.** The failure message names the DR, the expected sidecar path, and the remedy
  (the MinSpec approve-ADR command), so the fix is actionable.
- **FR6.** The rule applies only in a repo with `.minspec/` (invariant 3) and makes no network
  call (invariant 1).
- **FR7.** Legacy handling per Q1, recorded explicitly (an allowlist/baseline file listing
  grandfathered DR ids), never an implicit date cutoff the rule cannot show.
- **FR8.** Statuses other than `accepted` (proposed, superseded, rejected, deprecated) are not
  checked by this rule.

## Acceptance criteria

- AC1. A DR set to `accepted` with no sidecar → validate exits non-zero naming that DR.
- AC2. Same DR with a current sidecar → passes.
- AC3. Sidecar present, DR body edited afterwards → fails as stale; editing only `status:` does not.
- AC4. A `proposed` DR with no sidecar → passes.
- AC5. Approvals dir deleted while accepted DRs exist (non-grandfathered) → fails, not skips.
- AC6. Grandfathered DR without sidecar → passes; removing it from the baseline makes it fail.
- AC7. Mutation check: the test suite fails if the rule is a no-op (test must vary DR count,
  not only code).

## Invariants this must not break

1. Offline, no network (constitution inv. 1).
2. No silent gate — fail closed and visibly; a second independent witness where the rule hinges
   on one producer (inv. 2).
3. Opt-in blast radius is `.minspec/` only (inv. 3).
4. No new authorising party; no agent-minted approval counts (see SPEC-337).

## Decisions needed (Clarify)

Recorded selections: each of the 3 selections below is an agent pick of the option this document marks recommended, recorded on 2026-11-17 under the founder decision in queue item clarsel. Sign-off ratifies them and may change any of them.

**Q1 — The ~100 accepted DRs with no sidecar.**
- (a) **Baseline allowlist (rec):** commit a list of grandfathered DR ids; rule is fatal for all
  others, list may only shrink. Cost: a one-off list that records "accepted without approval"
  as known debt, and needs its own no-growth check.
- (b) Backfill sidecars for all legacy DRs. Cost: mints approvals nobody gave — a borrowed-identity
  approval, which the project forbids.
- (c) Warn-only for legacy, fatal from a cutoff date. Cost: implicit cutoff, drifts, repeats the
  "warning joins ~110 others" failure Rule 16 documents.

**Recorded selection: the recommended option,** option (a), a baseline allowlist of grandfathered DR ids that may only shrink. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.

**Q2 — What counts as the witness.**
- (a) **Sidecar only (rec):** reuses the existing content-hash mechanism. Cost: one producer; a
  hand-written sidecar passes unless SPEC-337's forged-approval guard also lands.
- (b) Sidecar OR signed status-change commit (the issue's alternative). Cost: needs git history
  at validate time (shallow CI clones break it) and a signature trust root MinSpec lacks.
- (c) Both required (independent second witness per inv. 2). Cost: stricter, more friction on
  every accept.

**Recorded selection: the recommended option,** option (a), the sidecar only. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.

**Q3 — Severity rollout.** Fatal at once (rec, after Q1 baseline makes the corpus green) vs
warn for one release. Cost of rec: any in-flight DR PR that accepts without approval turns red.

**Recorded selection: the recommended option,** fatal at once, after the baseline allowlist makes the corpus green. Agent pick of the recommended option, founder decision queue item clarsel, recorded 2026-11-17; sign-off ratifies it.
