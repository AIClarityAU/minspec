---
id: SPEC-041
title: GitHub-native approval for all audiences
type: requirements
status: specifying
tier: T3
product: minspec
created: 2026-07-21
epic: EPIC-006  # Trust, Consent & Supply Chain
depends_on: [DR-066, SPEC-022, DR-056, DR-012]
relates_to: [SPEC-042, SPEC-043]
phases:
  specify: done
  clarify: done
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-041: GitHub-native approval for all audiences

## Summary

Let anyone who owns part of a spec sign it off from GitHub — including from a phone —
using GitHub's normal "Approve" button, instead of needing the desktop app. When they
approve, MinSpec records exactly the same approval it would have recorded locally, so
nothing about the record changes — only where the person was standing when they approved.

## Context

Approval today is the VS Code-only `MinSpec: Approve` command, which writes a committed
per-file `ApprovalRecord` sidecar bound to the file's canonical content hash (SPEC-022).
A non-technical PO has no browser path to it, and a developer cannot approve from mobile.
DR-066 (decision 3) resolves this by making the approval *ingress* multi-surface and
audience-agnostic: GitHub itself is the networked/mobile surface for every audience, and
a per-file approval already scopes each role to their own files.

## Requirements

- **FR-1 (role routing via CODEOWNERS).** A maintained `CODEOWNERS` maps audience file
  globs to teams — `**/requirements.md` → PO team; `**/design.md`, `**/tasks.md` →
  engineering; extensible to future role globs (SPEC-043). Branch protection "require
  review from Code Owners" makes the matching role a required reviewer per file.
- **FR-2 (trigger).** A GitHub Action runs on `pull_request_review` submitted with state
  `approved`, resolves which audience file(s) the reviewer is a code owner for, and acts
  only on those files.
- **FR-3 (authority gate).** The Action verifies the reviewer's membership of the team the
  file is routed to; deny-by-default if they are not a member.
- **FR-4 (materialise the record).** For each covered file the Action recomputes the
  canonical hash via the SPEC-022 FR-3 shared canonicalizer (Node module / Python twin)
  and writes the committed `ApprovalRecord` attributing the reviewer — never the Action's
  identity. The attributed `approvedBy` is the reviewer's GitHub-**verified** email, or
  `<id>+<login>@users.noreply.github.com` when no verified public email exists, and the
  record also stores `approverLogin`; reviewers of `type:"Bot"` or on the DR-056 denylist
  are rejected (RD-1). DR-056's human-not-bot gate passes because `approvedBy` is the human.
- **FR-5 (self-consistency).** The sidecar write is committed to the PR branch and must not
  invalidate the approval it records (sidecars are excluded from the spec content hash).
- **FR-6 (freshness by hash, not review-state).** The committed sidecar hash is the arbiter
  of freshness. A later push changing only lifecycle fields (`status`/`phases`) must not
  invalidate; a content change invalidates per SPEC-022 — regardless of GitHub's own
  dismiss-stale behaviour. Merge is gated on a MinSpec approval **status check** computed
  from the committed sidecar, **not** on GitHub's native review-approved state, so GitHub's
  dismiss-stale-on-push is cosmetic and never invalidates a hash-valid approval (RD-3).
- **FR-7 (optional, offline preserved).** The networked path is opt-in per project (enable
  the Action + CODEOWNERS). The offline `MinSpec: Approve` command remains and writes an
  identical record. No MinSpec-core file gains a network dependency — the Action lives in
  `.github/`, not the extension.
- **FR-8 (least privilege).** The Action is least-privilege, pins its dependencies by SHA,
  and exfiltrates no secrets (EPIC-006 supply-chain).

## Invariants (T0 — tests before implementation)

- **INV-1.** A GitHub-materialised record is schema- and hash-identical to a locally written
  one.
- **INV-2.** `approvedBy` is always the human reviewer, never the Action/bot.
- **INV-3.** Core (offline) approval never requires the network.

## Acceptance Criteria

- [ ] **AC-1 (FR-4).** Approving `requirements.md` on GitHub produces
      `.minspec/approvals/.../requirements.md.json` with `approvedBy` = the reviewer's email
      and the canonical hash.
- [ ] **AC-2 (FR-3).** A reviewer not in the routed team approving produces no record.
- [ ] **AC-3 (INV-2).** No record is ever written with `approvedBy` = the Action identity.
- [ ] **AC-4 (FR-6).** A push changing only `status:`/`phases:` after approval leaves the
      record valid; a body change marks it stale.
- [ ] **AC-5 (INV-3).** With the Action/CODEOWNERS absent, `MinSpec: Approve` still writes
      the identical record offline.
- [ ] **AC-6 (FR-4).** The hash the Action computes matches the Node/Python twin byte-for-byte.

## Resolved Decisions (Clarify)

- **RD-1 (identity → email).** Attribute `approvedBy` to the reviewer's GitHub-**verified**
  email; when none is public, use the GitHub noreply `<id>+<login>@users.noreply.github.com`
  and also store `approverLogin`, so provenance is never `unknown`. Reject `type:"Bot"`
  reviewers and DR-056-denylisted identities. (Verified identity is *stronger* provenance
  than the self-asserted local git email.)
- **RD-2 (ingress) — review-only for v1.** The native *Approve* review event is the
  canonical, CODEOWNERS-gated, hard-to-forge signal. A `/approve` PR-comment (not
  CODEOWNERS-gated, easier to spoof) is **deferred**, keeping the surface minimal.
- **RD-3 (dismiss-stale) — sidecar status check is the arbiter.** Merges gate on a MinSpec
  approval status check derived from the committed sidecar, not GitHub's review-approved
  state; GitHub's dismiss-stale-on-push is cosmetic and never invalidates a hash-valid
  approval. No auto-re-materialise needed.

## Out of scope

- Sub-file paragraph projection and the bespoke webview (dropped in DR-066).
- The per-audience auto-approve policy (SPEC-042).

## Traceability

DR-066 (decision 3); SPEC-022 (record + canonical hash); DR-056 (human gate); DR-012
(approve gate); SPEC-043 (audience→file map); EPIC-006.
