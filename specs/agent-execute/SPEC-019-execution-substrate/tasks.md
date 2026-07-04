---
id: SPEC-019
type: tasks
# Editing voids approval (hash → stale); re-run "MinSpec: Approve Spec". DR-012
status: implementing
product: agent-execute
epic: EPIC-007  # Agent Execute Extension
---

# Agent Execute — Layer-2 Execution Substrate (Tasks)

**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md) · **Decisions:** [DR-017](../../../docs/decisions/DR-017.md) (substrate) · [DR-008](../../../docs/decisions/DR-008.md) (no-cred isolation) · [DR-046](../../../docs/decisions/DR-046.md) (rule-#8 / base-freshness) · [DR-052](../../../docs/decisions/DR-052.md) (billing amendment)

**Scope: v1 = manual Layer-1 (Slices 0–3).** Layer-2 (Slice 4 milestone) is **gated on #74 + a dedicated security review** and is authored as tasks but not started. Order follows the design's Build order (vertical slices). **Within each slice, T0/T1 test tasks precede the implementation they cover (DR-003 test-first).** Each task names its file allowlist (from the design Module-layout table) and the FR/CL/INV it advances. Tests are vitest under `packages/agent-execute/tests/`.

> **DR-052 fold-in (do FIRST — design edit, re-triggers design.md approval).** Before Slice 0, fold DR-052 into `design.md` FR-5/FR-14: subscription mode = genuine `claude` CLI direct (no broker reroute); attestation `spawn-token-whitelisted` = the subscription path, `no-cred` = API-key/L2; FR-14 caps mandatory. See the pre-Slice-0 task below.

---

## Slice 0 — Package scaffold + frozen contracts + mock + by-construction guards

*Goal: freeze the costly-to-refactor seams as types, prove them with a mock runner + T0 invariant tests — no real runtime. ~95% of the extension becomes testable with no docker (FR-2).*

- [ ] **(design fold-in)** Fold DR-052 into `design.md` (FR-5 subscription = genuine-CLI-direct, no broker reroute; FR-14 caps mandatory; attestation modes). Re-run *Approve Spec* on design.md afterward (edit voids its approval). *(DR-052; FR-5/FR-14)* — allowlist: `specs/agent-execute/SPEC-019-execution-substrate/design.md`
- [ ] **(scaffold)** Create `packages/agent-execute` (package.json id `aiclarity.agent-execute`, tsconfig extending the monorepo base, vitest config). **Single new dep: `zod`.** Wire into the workspace + Pro pack per DR-015; MinSpec/shared gain no dependency on it. *(FR-16, DR-015)* — allowlist: `packages/agent-execute/package.json`, `packages/agent-execute/tsconfig.json`, `packages/agent-execute/vitest.config.ts`, root `package.json`
- [ ] **(impl)** `src/ports/sandbox-runner.ts`: `Result<T>`, `RunnerFailure` (closed set: `no-runtime|spawn-failed|attest-failed|timeout|oom|base-advanced-conflict|git-lock-contention|checkout-moved`), `Handle`, branded `AttestedHandle`, `SandboxRunner` (spawn→attest→run→collect-diff→teardown; `attest` returns `Result<AttestationVerdict>`; `run`/`collectDiff` take `AttestedHandle`), `attestedHandle()` promoter. *(FR-2, FR-11; INV-attest-fail-closed)* — allowlist: `packages/agent-execute/src/ports/sandbox-runner.ts`
- [ ] **(impl)** `src/contracts/agent-result.ts`: `AgentResult` Zod (seed | `{results[]}`), explicit `foldResult` (confidence=MIN, tests_passed=AND, files=union), `RejectReason` (incl. `stale-base`), `Disposition` (push | close-noop | reject), `rejectBundle(result, bundle, summary)`. *(CL-5, CL-2, CL-11; DR-046 stale-base)* — allowlist: `packages/agent-execute/src/contracts/agent-result.ts`
- [ ] **(impl)** `src/control/prompt.ts`: `AgentPrompt` (branded) + `buildPrompt(ctx, issueBody, role)` — the ONLY constructor; wraps body in `<untrusted_issue_body>` DATA + injection-aware preamble + `baseSha` caveat. *(FR-15; INV-untrusted-data)* — allowlist: `packages/agent-execute/src/control/prompt.ts`
- [ ] **(impl)** `src/ports/outcome-store.ts`: `OutcomeRecord` (`qualityAttempt`/`dispatchSeq` split, `failure?`, `verdict?`), `OutcomeStore` (tri-state fail-closed `get`: found|absent|corrupt). *(CL-4, CL-6)* — allowlist: `packages/agent-execute/src/ports/outcome-store.ts`
- [ ] **(impl)** `src/stores/file-outcome-store.ts`: one-file-per-dispatch JSON backend, Zod-validated; `list()` = read-dir sorted by `startedAt`. Add `.minspec/agent-execute/` to `.gitignore`. *(CL-4, FR-16)* — allowlist: `packages/agent-execute/src/stores/file-outcome-store.ts`, `.gitignore`
- [ ] **(impl)** `src/runners/mock-runner.ts`: in-memory `SandboxRunner` for control-plane tests (trivially-pass attest). *(FR-2, FR-8)* — allowlist: `packages/agent-execute/src/runners/mock-runner.ts`
- [ ] **(test, T0)** `tests/invariants.test.ts`: `run()` won't type-accept a bare `Handle`; `buildPrompt` keeps the raw body inside the delimiters (never leaks outside); `rejectBundle` rejects each CL-5 case (empty diff / missing summary / malformed confidence / tests-failed / stale-base); `foldResult` on `{results:[hi,lo]}` yields MIN confidence + AND tests; `OutcomeStore.get` corrupt/torn ⇒ `corrupt` (never success); dep-graph `minspec`/`shared` → agent-execute = none. *(FR-2/11/15/16, CL-5/6; INVs)* — allowlist: `packages/agent-execute/tests/invariants.test.ts`

## Slice 1 — One issue, end-to-end, Layer-1 (the thinnest vertical path)

*Goal: dispatch ONE self-authored issue through the whole L1 path on a real subprocess in an isolated worktree, parent-side push. Happy path + close-noop + reject.*

- [ ] **(impl)** `src/ports/sandbox-runner.ts` (extend): `SubprocessPolicy` (`allowedTools` closed list — no node/npx/cat/gh/git push|remote|config; `disallowBypass: true`); `ExecContext` (`runId` uuid, `baseSha`, `worktree`, `branch`, `policy`). *(CL-12, FR-1; DR-008)* — allowlist: `packages/agent-execute/src/ports/sandbox-runner.ts`
- [ ] **(test, T0 — the L1 boundary)** `tests/subprocess-policy.test.ts`: the v1 subprocess cannot read `~/.claude` / run `git push` / `gh` (allowlist enforced); no `bypassPermissions` code path (grep gate). *(CL-12, INV-no-cred-actions)* — allowlist: `packages/agent-execute/tests/subprocess-policy.test.ts`
- [ ] **(impl)** `src/git/exec-context.ts`: parent-side fetch `origin/main` → pin `baseSha` (`rev-parse FETCH_HEAD`); mint worktree `~/code/.worktrees/<repo>/sealbox-<runId>` (outside every checkout); verify primary checkout NAME+HEAD unchanged before/after; `teardown` (worktree remove + temp-branch -D in a finally/trap). Raw `execFile` git, explicit refspec. *(FR-13, DR-046; INV-rule-#8)* — allowlist: `packages/agent-execute/src/git/exec-context.ts`
- [ ] **(test, T0 — rule-#8)** `tests/exec-context.test.ts`: base is a pinned immutable SHA (not a live ref); no HEAD-moving op on the primary checkout; primary NAME+HEAD verified pre/post; teardown removes the worktree + temp branch; `git -C <worktree>` + explicit refspec used (never bare push). *(DR-046; INV-rule-#8, INV-symmetric-base-freshness)* — allowlist: `packages/agent-execute/tests/exec-context.test.ts`
- [ ] **(impl)** `src/runners/subprocess-runner.ts`: v1 L1 `SandboxRunner` — `claude -p` subprocess in the worktree, `SubprocessPolicy` enforced, trivially-pass attest (no container); collect diff + `.agent-summary.md`, never a push. Port `parseClaudeOutput`/`extractFixSummary` pure logic from the AgentSystem seed (adapt, not adopt). *(FR-1, FR-13, CL-1)* — allowlist: `packages/agent-execute/src/runners/subprocess-runner.ts`
- [ ] **(impl)** `src/control/dispatch.ts` (v1 core): orchestrate `buildPrompt → spawn → run → collectDiff → foldResult → rejectBundle → Disposition`; parent-side `gh comment` + ff-only push on `push`; `close-noop` (CL-11) closes without push; `reject` (CL-5) surfaces. *(FR-13, CL-11/12/13)* — allowlist: `packages/agent-execute/src/control/dispatch.ts`
- [ ] **(test, T2 — feature)** `tests/dispatch-l1.test.ts` (mock runner): one issue → push path; empty-diff-resolved → close-noop (no push); reject bundle → no push, surfaced. Parent holds the only push/gh token; agent never does. *(FR-13, CL-5/11/12)* — allowlist: `packages/agent-execute/tests/dispatch-l1.test.ts`

## Slice 2 — Tier-gate + retry + reconcile + staleness + side-effects

*Goal: the HITL differentiator + the DR-046 exit-time base reconcile + terminal-state discipline.*

- [ ] **(impl)** `src/control/tier-gate.ts`: consume the shared classifier (DR-014) over the spec; T1–T2 auto / T3–T4 `needs-review`; CL-2 low-confidence escalation (never auto-approve). *(FR-12, CL-2, CL-8)* — allowlist: `packages/agent-execute/src/control/tier-gate.ts`
- [ ] **(impl)** `src/control/staleness.ts`: CL-10 "still-actionable?" re-check → `Staleness` (`proceed` | `resolved`); asymmetric fail-soft (skip ONLY on positive proof of resolution). *(CL-10)* — allowlist: `packages/agent-execute/src/control/staleness.ts`
- [ ] **(impl)** `src/git/reconcile.ts`: exit-time re-fetch `origin/main` vs `baseSha` → `ReconcileResult` (unchanged→push | advanced-clean→rebase-in-worktree→re-run gate→push | conflict/overlap→`base-advanced-conflict` fail-soft → `needs-review`). Push = create/ff-only, per-dispatch-unique branch, never `--force`. *(FR-13, DR-046; INV-symmetric-base-freshness)* — allowlist: `packages/agent-execute/src/git/reconcile.ts`
- [ ] **(test, T0 — symmetric base-freshness)** `tests/reconcile.test.ts`: unchanged→push; advanced-clean→rebase+re-gate+push with recomputed diff range; conflict/overlap→no push, `needs-review`; push is ff-only-no-force (grep the push primitive for any force path). *(DR-046; INV-symmetric-base-freshness)* — allowlist: `packages/agent-execute/tests/reconcile.test.ts`
- [ ] **(impl)** `src/control/side-effects.ts`: CL-13 declared, orchestrator-routed post-merge action set (close issue, update linked records) — result handler never reaches into foreign state. *(CL-13)* — allowlist: `packages/agent-execute/src/control/side-effects.ts`
- [ ] **(impl)** `src/control/dispatch.ts` (extend): retry ≤3 → `blocked` (CL-7 terminal set completed|blocked|cancelled); infra failures (CL-6) never consume a `qualityAttempt`; wire staleness + reconcile + tier-gate + side-effects. *(CL-6/7/8, FR-12)* — allowlist: `packages/agent-execute/src/control/dispatch.ts`
- [ ] **(test, T2)** `tests/dispatch-slice2.test.ts`: T3→needs-review (no dispatch); low-confidence T1→escalate; 3 quality attempts→blocked; an interleaved infra failure does NOT bump `qualityAttempt` (CL-6); staleness `resolved`→skip, else proceed. *(FR-12, CL-2/6/7/10)* — allowlist: `packages/agent-execute/tests/dispatch-slice2.test.ts`

## Slice 3 — Caps, detect-or-degrade, orphan GC

*Goal: v1 never-throw degrade + the concurrency cap that respects the shared subscription quota.*

- [ ] **(impl)** Concurrency cap (global, v1, CL-3) in the dispatch loop, respecting the 5h-window/weekly subscription quota (DR-052: subscription dispatch draws the interactive quota while the Agent-SDK credit is paused — cap is mandatory, not optional). **Verify exact current Anthropic-plan limits before wiring** (FR-14 precondition). *(FR-14, CL-3; DR-052)* — allowlist: `packages/agent-execute/src/control/dispatch.ts`
- [ ] **(impl)** `src/runners/*` + activation probe: mirror `isGhAvailable()`/`claude` probes — no container runtime → degrade to L1 manual (NOT "off"); every seam `catch → log reason → typed {ok:false,reason}` (FR-11 closed reason set). *(FR-10, FR-11; INV-degrades)* — allowlist: `packages/agent-execute/src/runners/detect.ts`, `packages/agent-execute/src/control/dispatch.ts`
- [ ] **(impl)** CL-7 orphan/worktree GC: lifecycle sweep (soft timeout→re-queue off a FRESH fetch, hard timeout→blocked); GC orphaned worktrees + temp branches; git-lock contention → retryable `git-lock-contention` fail-soft. *(CL-7; DR-046)* — allowlist: `packages/agent-execute/src/control/reclaim.ts`
- [ ] **(test, T0/T2)** `tests/degrade.test.ts`: no-runtime → Layer-1 fallback (not off); every failure seam returns a typed `{ok:false,reason}` (never a bare null / silent throw); orphan sweep re-queues off a fresh fetch, never a stale worktree. *(FR-10/11, CL-7; INV-degrades)* — allowlist: `packages/agent-execute/tests/degrade.test.ts`

## Slice 4 — Layer-2 milestone (GATED — do not start)

*Gated on **#74** (subscription-oauth broker-injectability — resolved by DR-052 to genuine-CLI-direct) + a **dedicated security review**. Authored as tasks; not scheduled for v1.*

- [ ] **(GATED, impl)** `src/runners/docker-runner.ts`: container/devcontainer `SandboxRunner` adapter behind the port. *(FR-2)*
- [ ] **(GATED, impl)** `src/attest/*`: probe manifest (negative asserts + positive controls, FR-7) + pure `verdict(checks)` (FAIL on empty OR any not-(denied&controlOk)); FR-5 `spawn-token-whitelisted` mode; probe = the FR-8 substrate integration test (needs a docker-capable CI runner). *(FR-6/7/8; INV-attest-fail-closed)*
- [ ] **(GATED, impl)** `src/broker/*`: host-side broker (sole egress seam), `BrokerRoute` (model+effort+thinking + credential route sub→API→Scrooge), `SpendMeter` reserve/settle (calendar daily+weekly, race-free), FR-3 web-tool config (server-side on, client-side off). Per DR-052: subscription = genuine CLI direct, no broker reroute of subscription traffic; broker/Scrooge value = API-key mode only. *(FR-3/4/5/14, CL-9/15; DR-052)*
- [ ] **(GATED, test)** Attestation fail-closed + positive-control T0 tests on a docker-capable runner; spend-cap reserve/settle race test; broker credential-precedence test. *(FR-6/7/14; INVs)*

---

## Out of scope (Tasks)

Unchanged from [requirements §Out of scope](requirements.md): microVM/gVisor + untrusted dispatch (#73); remote/cloud substrate; the SPEC-016 reviewer; ScroogeLLM internals; the `scripts/` dev-seed; the AgentSystem DB-queue/systemd architecture; public brand name (#66, OQ-4).

## Follow-ups (tracked)

- **DR-052 Accept** — the billing amendment is `proposed`; Accept before the Slice-0 fold-in is final.
- **#74 / security review** — gate for Slice 4 (Layer-2).
- **`OutcomeStore` SQLite backend** — v3, behind the port (CL-4).
- **Per-class caps (v2) / load-scaled worker pool (v3)** — behind the FR-14 cap abstraction.
