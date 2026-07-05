---
id: EPIC-009
slug: team-readiness
title: Team Readiness
status: active
order: 9
---

# EPIC-009: Team Readiness

## Goal

Make MinSpec correct and trustworthy when **more than one human (or human + CI)**
shares one repo's SDD ground truth. Everything single-developer assumes one local
truth on one machine; a team needs that truth **committed, attributed, and
collision-free** so a fresh clone, a CI runner, and a teammate all see the same
approved state — and so concurrent work does not race, duplicate, or forge.

"Done" = a shared approval store every checkout agrees on; an explicit
who-may-approve authority layer; SDD artifact IDs that never collide across
clones; and the shared agent/PR workflows (dispatch, drain, review queue) made
safe for many actors instead of one.

## Principle

Team features only have meaning when >1 actor shares the repo — that is the
membership test. The foundation is **shared ground truth, not coordination
chatter**: commit the truth (approvals, IDs) so git is the synchronization
substrate, rather than building a live IPC/coordination bus. Authority and
identity stay **Tier-0 by default** (offline, git-derived attribution) and only
escalate toward Tier-1 identity infra where genuine authority gating demands it
([DR-004](../decisions/DR-004.md) bounds this).

## Artifacts

- **Delivered spine (committed, attributed approval ground truth — primary home
  [EPIC-002 Signpost Integrity](EPIC-002-signpost-integrity.md), cross-listed here
  because it is the team substrate):**
  [DR-034](../decisions/DR-034.md) — un-gitignore approvals; per-spec, path-keyed
  **committed** sidecars (merge conflict only on same-spec double-approve);
  **attributed** records (`approvedBy` = git `user.email`); single-approver-suffices
  clears a spec for the whole team / CI / fresh clone.
  [SPEC-022 Approval Ground Truth + Derived Status](../../specs/minspec/SPEC-022-approval-foundation/requirements.md)
  — the spec that decision governs (shipped via PR #192).
  [DR-031](../decisions/DR-031.md) — canonical approval resolution across linked
  worktrees/dispatch (demoted to a fallback by DR-034 once the store is committed).

- **Open team work (members — labelled `epic:team-readiness`):**
  - [#95](https://github.com/AIClarityAU/minspec/issues/95) — team-readiness: shared,
    attributed approvals (core delivered by DR-034/SPEC-022; remaining: the full
    multi-dev "shared" workflow on top of the committed store).
  - [#207](https://github.com/AIClarityAU/minspec/issues/207) — reviewer-authority
    model (CODEOWNERS-style *who may approve*); the DR-034 fan-out-4 follow-up,
    deferred from v1's "any committer may approve" audit trail toward a Tier-1
    authority gate.

- **Issues:** label `epic:team-readiness`.

## Related (team modes — tracked under their own epics, cross-referenced)

These are team-mode variants of features rooted elsewhere; they stay in their home
epics and are not EPIC-009 members, but the team story depends on them:

- [#3](https://github.com/AIClarityAU/minspec/issues/3) — CI-based agent dispatch
  for teams (shared GitHub Actions runners; the team mode of agent dispatch).
- [#251](https://github.com/AIClarityAU/minspec/issues/251) — team-safe auto-drain
  (a shared inbox must not fan out across teammates — one designated drainer,
  atomic claim/dedup).
- [#267](https://github.com/AIClarityAU/minspec/issues/267) — collision-proof
  DR/SPEC IDs minted at merge (the multi-clone residual that #176's same-machine
  fix cannot reach).

> Excluded after review: DR-033 / [#211](https://github.com/AIClarityAU/minspec/issues/211)
> (PR-review queue) stays with its own DR-033 work, not this epic.
