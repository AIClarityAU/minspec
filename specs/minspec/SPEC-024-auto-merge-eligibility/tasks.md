---
id: SPEC-024
type: tasks
status: implementing
product: minspec
epic: EPIC-007  # Agent Execute
---

# MinSpec — Auto-Merge Eligibility Gate (Tasks)

**Requirements:** [requirements.md](requirements.md) · **Design:** [design.md](design.md)

> ⚠️ **Backfilled as-built.** The gate shipped in PR [#412](https://github.com/AIClarityAU/minspec/pull/412)
> (+ #422/#475) before this Tasks doc existed. Checked `[x]` tasks are **verified against
> merged code/tests** (cited `file:line`), not assumed from a commit subject (RCDD evidence
> discipline). Open `[ ]` tasks are the wrong-merge gaps the Acceptance Criteria (§J)
> surfaced — each is a tracked issue. Order follows design.md's *Build order*; within each
> slice, T0/T1 tests precede the code they cover (DR-003 test-first).

---

## Slice 1 — Pure eligibility decision core (FR-1, FR-4a, FR-5; INV-1/2/3/4/6)

*Tier-0, no IO. `packages/minspec/src/lib/auto-merge.ts` + `packages/minspec/tests/auto-merge.test.ts`.*

- [x] **(test, T0)** INV-1 deny-by-default property: dropping/undefining any required input → never eligible (`auto-merge.test.ts:124`). *(FR-1)*
- [x] **(test, T0)** INV-6 purity: module imports no `vscode`/`fs`/`path`/`child_process`/network; imports are type-only (`auto-merge.test.ts:431`).
- [x] `decideAutoMerge` deny-by-default conjunction + non-empty `reason` + `failed[]` (`auto-merge.ts:312`). *(FR-1)*
- [x] `classifyBlast` deny-by-default over signal names; unknown ⇒ high (`auto-merge.ts:180`; test `:223`,`:262`). *(FR-5)*
- [x] `deriveTouchesExportedSurface` from `public_api_*` presence; degraded emissions still force true (`auto-merge.ts:154`; test `:301`). *(FR-4a)*
- [x] `reachKnownLow` always false in v1 + reach-degrade escalation (`auto-merge.ts:232`; test `:344`). *(FR-4, INV-2)*
- [x] `withProverAuthority` overwrites self-reported regression flags (`auto-merge.ts:292`; test `:159`). *(INV-3)*
- [x] Hollow/stub finding ⇒ ineligible; missing array ⇒ ineligible (`auto-merge.ts:352`; test `:207`). *(INV-4)*

## Slice 2 — FR-2 red→green prover (IO/exec)

*`scripts/auto-merge-gate.ts` + `packages/minspec/tests/auto-merge-gate.test.ts`.*

- [x] **(test)** prover cannot be fooled: genuine red→green proves; import-failure/broken-base/green-on-base/red-on-head/flaky/not-found/no-test ⇒ NOT proven (`auto-merge-gate.test.ts:152`).
- [x] `proveRegression` runs the named test against base and head in an isolated checkout; a "red" verdict requires an *executed assertion failure*, not a load error (BLOCKER 2; `auto-merge-gate.test.ts:118`). *(FR-2)*
- [x] Prover result overwrites any agent-supplied flag before FR-1 (INV-3 seam). *(FR-2)*

## Slice 3 — Blast escalation for analyzer blind spots (#414, #422)

- [x] `detectManifestChange` injects `manifest_changed` for dependency/boundary manifests; recognized `HIGH_SIGNAL_NAME` (`auto-merge.ts:123`; test `auto-merge.test.ts:272`, `auto-merge-gate.test.ts:235`). *(#414 / BLOCKER 1)*
- [x] `detectBoundaryChange` escalates CI/build boundary files (`.github/workflows`, `tsconfig.json`, `.npmrc`, `Jenkinsfile`, `.githooks/*`); ordinary source not force-escalated (`auto-merge-gate.test.ts:286`, control `:438`). *(#422)*

## Slice 4 — Mode kill-switch + loop integration (C4, FR-6, FR-7)

- [x] **(test)** `resolveMode`/`parseArgs` deny-by-default: no/garbage `--mode` ⇒ `pr-gate`; exact token ⇒ `consequence-hybrid` (`auto-merge-gate.test.ts:85`). *(C4 / MAJOR-4)*
- [x] `pr-gate` mode always holds but reports blast (`auto-merge.test.ts:412`). *(C4)*
- [x] Dispatch merge predicate `eligible && PR && hybrid && ready-to-merge==success` ⇒ `gh pr merge --squash`; else label `needs-human-skim` + hold comment (`dispatch-issue.sh:431–463`). *(FR-6)*
- [x] `buildChangedFiles` throws on git failure ⇒ `main()` HOLD (`auto-merge-gate.test.ts:464`). *(FR-6 / MAJOR-5)*
- [x] FR-7 audit: `appendAudit` writes each decision to `.minspec/auto-merge-audit.log` (`auto-merge-gate.ts:591–615`, called `:691`). *(FR-7)*

## Slice 5 — FR-8 skim surface

- [x] Degraded GitHub-comment fallback: `renderReviewSignals` block + blast reason posted (`auto-merge-gate.ts:707`; `dispatch-issue.sh:462`). *(FR-8 fallback)*
- [ ] **In-IDE keyboard-first review-webview surface (INV-7)** — held PR as SPEC-012 next-human-task rendered in the SPEC-014 webview; two actions (approve+merge / open diff); approve+merge bound to a two-key chord + T-test. *Gated on [SPEC-014](../SPEC-014-review-webview/requirements.md). Unbuilt (AC-22/AC-23).*

## Slice 6 — Open wrong-merge gaps (Acceptance Criteria §J; not closed by the merged gate)

- [ ] **#489** — cross-check Signal-1 root cause against the real git diff (not the agent's self-reported `changedFiles`), or drop Signal-1 from eligibility. *(AC-25)*
- [ ] **#490** — floor an analyzed *code* change with zero recognized signals so it cannot classify low-blast (analyzer false-negative). *(AC-26)*
- [ ] **#491** — an audit-append failure on an `eligible` decision must HOLD (block the merge), not proceed untraced. *(AC-27)*
- [ ] **#466** — pin the merge to the evaluated SHA (`--match-head-commit` or re-evaluate), closing the TOCTOU window. *(AC-28)*
- [ ] **(test-gaps, from the AC audit)** add the named missing tests: AC-1 missing-conjunct key, AC-6 `hollow-findings-missing` key, AC-18 loop conjunction, AC-19 throw→HOLD conversion, AC-20 audit-record shape, AC-21 fallback-body parity, AC-24 filter-guard call-site.
