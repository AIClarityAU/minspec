---
id: SPEC-037
type: tasks
status: implementing
tier: T3
product: minspec
epic: EPIC-006
relates_to: [DR-056]
---

# MinSpec — Agent-Proof Approver Identity (Tasks)

Built under [#716](https://github.com/AIClarityAU/minspec/issues/716) on branch
`fix/dr-056-approver-gate` (commit 03b5c15). Tasks map to FRs in
[requirements.md](./requirements.md).

## T0 — Invariants (first)
- [x] `tests/approver-identity.test.ts` — `checkApprover` allow/deny (built-ins, empty,
      `unknown`, case-insensitive, whitespace), `parseAgentIdentities` grammar,
      `assertHumanApprover` throws typed error, `approveSpec` no-side-effect-on-deny. *(INV-1..4)*

## Implementation
- [x] FR-1/FR-2 — `checkApprover`, `BUILTIN_AGENT_IDENTITIES`, `parseAgentIdentities`,
      `assertHumanApprover`, `ApproverDeniedError` in `approval.ts`; enforced in `approveSpec`.
- [x] FR-1 (UX) — command pre-check + modal refusal in `approve.ts` before the status flip.
- [x] FR-3 — `minspec.approverEmail` setting (`package.json`) + `resolveApproverEmail` in `approve.ts`.
- [x] FR-4 — `scripts/reconcile-approver-identity.mjs` (downgrade-only, idempotent).
- [x] FR-5 — repo-local `.git/config` `user.email` repointed `claude@` → bot noreply
      (config, not tracked).

## Verify
- [x] Full suite green (2842 passed, 0 failed); typecheck + lint clean.
- [x] Reconcile dry-run: 22 agent-attributed flagged, 7 human kept.
- [x] Adversarial multi-lens verification (gate-bypass / reconcile-safety / completeness /
      correctness) — see #716.

## Deferred (tracked)
- [ ] OQ-1 — general agent-commit-identity mechanism for CI/other hosts (DR-056 Decision 1).
- [ ] FR-4 apply + re-ratification of the 22 — separate labelled change + human act (Decision 4).

## Re-verification 2026-10-16 (security role, #716 Specify-only re-dispatch)

#716 was re-dispatched for the Specify phase. The spec already exists, so no second id
was minted. **`requirements.md` was deliberately left byte-identical.** It carries a
founder approval (`.minspec/approvals/specs/minspec/SPEC-037-approver-identity/requirements.md.json`,
`approvedBy: github@harvest316.com`, 2026-07-14) whose `specHash` `b97a577c…ecf8c`
still matches the file's canonical hash, recomputed today with `specHash()` from
`packages/shared/src/canonical`. Editing that file would void a valid human approval
for code that has already shipped, so this refresh goes here, in a file with no
approval sidecar. Anything below that changes a requirement goes through the
Clarify decisions at the end, then a requirements edit and a fresh approval.

### What the code does today (observed, not inferred)

- **FR-1 / FR-2 are built.** `BUILTIN_AGENT_IDENTITIES` is at
  `packages/minspec/src/lib/approval.ts:402`, `checkApprover` at `:447`,
  `assertHumanApprover` at `:478`, and the call in `approveSpec` at `:534` comes before
  every side effect. The command-layer pre-check is at
  `packages/minspec/src/commands/approve.ts:345`.
- **FR-3 is built.** The `minspec.approverEmail` setting is in
  `packages/minspec/package.json:537` (`scope: application`). `resolveApproverEmail` is
  at `approve.ts:106-110`.
- **FR-4 is done, and done again since.** The 81 committed sidecars under
  `.minspec/approvals/` all record `approvedBy: github@harvest316.com`. None carries
  an agent, bot, empty or `unknown` approver (counted today by reading every sidecar
  JSON). The "22 agent-attributed" numbers in AC-6 describe the 2026-07-14 state; they
  are history, not the current corpus.
- **FR-5's mechanism has moved.** In a dispatch container, `git config --show-origin user.email`
  now reports the bot noreply from the container's **global** `~/.gitconfig`, not from a
  repo-local `.git/config`. Recent `main` commits author as `minspec-sdd[bot]`. The
  requirements text ("repo-local `.git/config` … repointed") is out of date on mechanism
  but right on outcome.
- **A second, server-side witness exists, but nothing runs it.**
  `scripts/approval-integrity.ts` (DR-081 approval-record ceremony §4, #1376) checks
  `approvedBy` against the committed `.minspec/config.json` `approvers` allowlist at
  `:214`, with the DR-056 denylist on top at `:223`. A grep of `.github/workflows/*.yml`
  and the root `package.json` today found **no invocation** (searched: `approval-integrity`,
  `integrity`). Its own header says it should "run ADVISORY" before it becomes required.

### Security findings (report only; nothing here is fixed)

- [ ] **[MEDIUM] `packages/minspec/src/lib/config.ts:73-79`: the denylist rests on a
      premise FR-3 removed.** The comment, and the reasoning in
      `scripts/approval-integrity.ts:75-79`, say a local denylist is enough "because
      `approveSpec` CAPTURES the identity from local git config — the approver cannot
      choose it". Since FR-3, the approver *types* the identity into
      `minspec.approverEmail`. Any text that is not on the denylist passes the local
      gate, including a typo or another agent's address (e.g. an unlisted CI email or a
      `claude+x@` sub-address). *Recommendation:* when `approvers` is configured, have the
      local gate require allowlist membership too, so the client and server witnesses
      apply the same rule (Clarify CQ-1).
- [ ] **[MEDIUM] Identity is a claim, not a proof. This is a design limit to record, not a
      code bug.** An agent with write access to the user `settings.json` can set
      `minspec.approverEmail` to the human's real address. An agent that writes a
      sidecar JSON by hand never runs `approveSpec` at all. Both produce an
      `approvedBy` that passes the denylist and the allowlist alike. Neither gate can
      tell "the human typed it" from "an agent typed the human's email". That is what
      DR-056 deferred as "cryptographic/verified human identity". Under Tier 0 the only
      real witness to a human act is a human merging the approval-record PR.
      *Recommendation:* say that in INV-1, which currently reads "No agent/bot/absent
      identity can ever be written as an approver" and overstates what an offline
      denylist can promise (Clarify CQ-2).
- [ ] **[MEDIUM] `scripts/approval-integrity.ts`: the server-side witness never runs.**
      See above. Today the client-side lib check is the only approver-identity check
      that executes, so a hand-written sidecar meets no identity gate in CI. This is the
      single-producer shape that constitution invariant 2 (no silent gate) names.
      DR-081 owns the wiring (#1376); it is listed here because SPEC-037's INV-1 depends
      on it. *Recommendation:* wire it into CI as an advisory, visible job (Clarify CQ-3).
- [ ] **[LOW] `packages/minspec/src/commands/adr.ts:278`: accepting a decision has no
      approver gate.** DR-056's Context describes capturing "the approver of a spec/DR",
      but `acceptAdrCommand` flips `status: accepted` without calling `checkApprover` and
      without recording an approver. `acceptEpicCommand` (`commands/epic.ts:17`) is the
      same. In this repo the commit's bot author still makes an agent acceptance
      visible, but an adopter whose ambient identity is an agent gets no refusal.
      *Recommendation:* decide whether FR-1 covers DR and epic acceptance (Clarify CQ-4).
- [ ] **[LOW, info] `approval.ts:402-410`: maintainer-specific data in the shipped
      denylist.** `claude@harvest316.com` and the `minspec-sdd[bot]` noreply ship in
      every adopter's extension. The blast radius is nil: the gate runs only on Approve
      inside an opted-in repo (constitution invariant 3), and only those exact addresses
      are refused. But an adopter's own agent identities are covered only if they set
      `MINSPEC_AGENT_IDENTITIES`, and FR-2 does not tell them to. *Recommendation:* fold
      this into CQ-1. An allowlist read from adopter config makes the built-in list
      a backstop, not the primary defence.
- **Checked, no issue found:** no secrets or high-entropy strings in this diff (one
      prose file). No new dependencies, so `npm audit` is unchanged. The gate adds no
      network surface: `gitConfigEmail` and the setting are local reads (INV-4 holds).
      OWASP Top 10: the relevant classes are A01 broken access control (findings above)
      and A07 identification/authentication failures (CQ-2). The rest (injection, SSRF,
      crypto, deserialization, vulnerable components) do not apply to a local
      string-compare gate. `parseAgentIdentities` only splits and lowercases. Because it
      only adds entries to the built-in list, the environment variable cannot weaken
      the gate.

### Decisions needed (Clarify)

Each of these changes `requirements.md` and so needs a founder re-approval. None is
built here.

- **CQ-1: should the local gate also enforce the `approvers` allowlist?**
  `a` yes, when `approvers` is configured; denylist only when it is absent **(rec)**.
  This closes the typo and unlisted-agent gap and makes the client and server rules
  match. *Cost:* a repo with `approvers` set refuses a legitimate new human approver
  until someone edits `config.json` in a reviewed PR.
  · `b` keep the denylist only. *Cost:* the local gate keeps passing any address it has
  not heard of.
- **CQ-2: what does INV-1 promise?** `a` reword it to "no *known* agent, bot or absent
  identity is recorded; proof of a human act is the human merge of the approval-record
  PR (DR-081)" **(rec)**. *Cost:* the spec openly admits that an agent with settings
  access can impersonate the human, which is less reassuring to read but true.
  · `b` keep the current wording and open a verified-identity follow-up (signed
  commits, or GitHub-native review attestation per DR-046's multi-surface approval
  ingress). *Cost:* an invariant the code cannot meet stays in an approved spec, which
  is the "signpost that lies" failure DR-003's evidence discipline names.
- **CQ-3: who wires `approval-integrity` into CI as an advisory job?** `a` file it
  under #1376 (DR-081's own build issue) and have SPEC-037 cite it **(rec)**.
  *Cost:* INV-1's second witness stays dark until #1376 lands.
  · `b` add it as an SPEC-037 FR. *Cost:* two specs own one check, and they can drift.
- **CQ-4: do DR acceptance and epic acceptance fall under FR-1?** `a` yes, gate
  `acceptAdrCommand` and `acceptEpicCommand` with the same `checkApprover` call **(rec)**.
  *Cost:* those commands must resolve an identity they do not use today, and a solo
  adopter with no git email gets a new refusal on Accept.
  · `b` no, write down that acceptance is unattributed by design. *Cost:* DR-056's
  "spec/DR" scope is only half met.
- **CQ-5: requirements text drift.** FR-5's mechanism (global container gitconfig,
  not repo-local) and AC-6's counts (now 81 human sidecars, 0 agent) are out of date.
  `a` fold the corrections into the same re-approval as CQ-1 to CQ-4 **(rec)**.
  *Cost:* until then, the approved text describes a past mechanism.
  · `b` leave them as historical record. *Cost:* a reader takes the July numbers as
  current.

Filing note: under the dispatch mandate this re-verification could not run `gh`, so
these findings are **not yet filed as issues**. Each unchecked box above is a
prose-only follow-up until the dispatcher or a human files it; the agent summary
for this dispatch says so.
