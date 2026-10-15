---
id: SPEC-187
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain - same epic as DR-056 (approver identity) and DR-081 (approval-record integrity)
aspects: [approval, provenance, hitl, identity, signing, agent, never-wrong, tier-0, offline, no-silent-gate]
relates_to: [DR-012, DR-056, DR-033, DR-081, SPEC-022, SPEC-037, SPEC-045, SPEC-050, SPEC-069, SPEC-136, "#517", "#515", "#95", "#116", "#464"]
# Ownership (SPEC-038) is deliberately NOT declared yet. Which files this spec creates
# depends entirely on the answer to Clarify D1 (a record signature lives in lib/approval*.ts
# plus a verifier; a GitHub-side witness lives in .github/ plus a script). Declare
# `implements:`/`affects:` once D1 is answered and BEFORE the approval mints a hash -
# adding them after approval voids it (SPEC-051's recorded trap).
---

# MinSpec - An approval record carries a witness an agent cannot produce (Requirements)

> Triggered by **[#517](https://github.com/AIClarityAU/minspec/issues/517)** - *approveSpec has
> no signal distinguishing human-clicked Approve from agent-invoked headless approval*, found
> while fixing #515 (SPEC-024 stale status), when an agent minted a T4 approval sidecar by
> calling `approveSpec()` from a script.
> Builds on [DR-056](../../../docs/decisions/DR-056.md) (agent-proof approver identity; its
> *Alternatives considered* deferred "full cryptographic/verified human identity") and
> [SPEC-037](../SPEC-037-approver-identity/requirements.md) OQ-2, which left exactly that
> question open.

## In plain terms

Approving a spec is meant to be something only a human does. Today an approval is a small
JSON file holding a hash and an email address. Anything that can write a file can write that
file, and anything that can type an email address can type the human's. The checks we have
today all look at the email address, so none of them can tell a real approval from a copy.

This spec adds a witness to each approval that only the human can produce, and makes every
gate that trusts an approval check that witness, not the email.

## One-Sentence Scope

Every approval record that a gate trusts carries a witness that an agent running in this repo
cannot produce. The approval sites and the merge gate verify that witness, not the
caller-chosen `approvedBy` string, and a record with no valid witness is visibly not a human
approval.

## Threat model - what the agent can and cannot do

The attacker is **not** malicious by assumption. #517 was an honest agent doing what looked
like a cleanup. The model has to hold for an honest-but-wrong agent and for a
prompt-injected one, so it assumes the agent's full capability:

| The agent CAN | Evidence |
|---|---|
| Import `approveSpec` and pass **any** `email`. The approver is a caller-supplied parameter, not something the function captures itself | [`approval.ts:523-528`](../../../packages/minspec/src/lib/approval.ts#L523) - `email: string` is an argument; the gate at `:534` checks only the string it was handed |
| Write the sidecar JSON directly, with no MinSpec code at all | [`approval-store.ts:168-172`](../../../packages/minspec/src/lib/approval-store.ts#L168) - the record is `JSON.stringify` to a plain file; nothing in it depends on a secret |
| Set `git config user.email`, `MINSPEC_AGENT_IDENTITIES`, or workspace settings to anything | DR-056 Context; `gitConfigEmail` at [`approval.ts:357-367`](../../../packages/minspec/src/lib/approval.ts#L357) |
| Name the one permitted human approver | [`.minspec/config.json:3-5`](../../../.minspec/config.json) - `approvers: ["github@harvest316.com"]` is committed and readable |
| Push a branch and open a PR under the App identity `minspec-sdd[bot]` | DR-056 Decision 1; `approve-on-label.yml` header |

| The agent CANNOT (and this spec must keep it so) | Evidence / status |
|---|---|
| Use a human GitHub user credential | The session-start identity check reports "no GitHub user credential reachable" in the container. That is observed per session, not guaranteed. FR-7 makes it a stated precondition |
| Read the human's private signing key | **Not yet true or false. Nothing creates such a key today.** It is a precondition this spec introduces (FR-7, AC-9) |

**What the current gates actually prove, given the table above:**

- DR-056 / SPEC-037's denylist (`checkApprover`, [`approval.ts:447-470`](../../../packages/minspec/src/lib/approval.ts#L447))
  stops the *exact* #517 incident, where an agent's own email was recorded. It does not stop an
  agent that passes `github@harvest316.com`. It is also bypassed entirely by a direct file
  write.
- `approval-integrity`'s allowlist ([`scripts/approval-integrity.ts:207-224`](../../../scripts/approval-integrity.ts#L207))
  and SPEC-069 FR-3.5 re-check `approvedBy` on the server. The value they re-check is still
  a string the agent wrote, and the allowlist they check it against is public.
- SPEC-069 FR-3.3 binds the record to the approvable's hash. That proves the record matches the
  file. It proves nothing about who made the record.

So the property #517 asks for ("a fabricated record does not pass as valid") holds today only
while no agent tries it. Constitution invariant 2 forbids exactly that: a required check must
not depend on a single producer behaving.

**Why an in-process check cannot be the answer.** An "only inside the VS Code extension host"
check, a TTY check, or a "who called me" check inside `approveSpec` closes one *path* to the
file (the function) and leaves the *capability* (writing the file) intact. The agent writes
the JSON directly instead. Such a check stops honest accidents, which is worth having (FR-6).
It must never be described, in code or prose, as the security boundary (INV-3).

## Terms

- **Approval record** - the per-spec sidecar under `.minspec/approvals/` (SPEC-022 FR-1).
- **Witness** - data attached to, or derivable for, an approval record that only a human
  approver can produce. Forging it would need a secret or a credential the agent does not hold.
- **Witnessed record** - a record whose witness verifies against the permitted-approver
  material (FR-3).
- **Gating consumer** - any code whose decision changes because a record says `approved`: the
  merge gate (`ready-to-merge` / `approval-integrity`), dispatch readiness, auto-merge
  eligibility, and the spec-gate hook.

## Functional Requirements

### FR-1 - Every new approval record carries a witness

Every approval minted through a sanctioned human path carries a witness. The sanctioned
paths are the **MinSpec: Approve Spec** command, SPEC-050's approve-and-land flow, and
SPEC-045's GitHub-review materializer once built. The witness covers, at minimum, `specPath`,
`specHash`, `approvedAt`, `approvedBy` and `tier`. A record whose fields were edited after
witnessing fails verification. Which witness is used is **Clarify D1**.

### FR-2 - The witness is something the threat model's agent cannot produce

The witness MUST need either a secret or a credential that is on the CANNOT side of the threat
model. A value the agent can read, compute, or choose does not qualify. That rules out an
email, a timestamp, a hash of public data, an environment flag, a process-ancestry check, or a
"called from the UI" marker.

### FR-3 - Verification material is read from the trusted base, never from the change under review

The material used to verify a witness (allowed public keys, the approver-to-account map, or
whatever D1 needs) is read from the **base** of the change being judged. It is never read from
the PR head. A PR that adds its own key, or names its own account as an approver, cannot
witness approvals in that same PR. A change to the verification material is a
machinery-class change that needs a separate human merge, like a change to the
`approvers` allowlist today (`approval-integrity.ts` header, file-set rule).

### FR-4 - Gating consumers verify the witness, not the email

Every gating consumer treats an approval as `approved` for the purpose of its gate only when
the record is witnessed. Two consumers are named:

- `approval-integrity` (SPEC-069 FR-3) gains a predicate: *every changed sidecar is
  witnessed*. A sidecar with a missing, malformed or non-verifying witness fails the check and
  names the path and the reason.
- Dispatch readiness and auto-merge eligibility for T3/T4 work refuse to treat an unwitnessed
  record as human approval.

The validator and the extension's tree view **surface** an unwitnessed record distinctly
(e.g. "approved - unverified"). They never hide it and never render it the same as a
witnessed one. How unwitnessed records are graded per tier is **Clarify D2**.

### FR-5 - Verification is offline wherever the record is consumed offline

The extension and validator are Tier-0. Any verification they perform MUST make no network
call (constitution invariant 1). A witness that can only be verified online (for example a
GitHub API lookup) is acceptable only in the CI gate. The offline consumers must then show
such a record as "verified in CI at <sha>" or "unverified locally". They must never claim a
local verification they did not perform.

### FR-6 - Record how the approval was invoked (accident guard, not a boundary)

The record gains an informational `origin` field. Its values are the UI command, the
approve-and-land flow, the GitHub-review materializer, migration, or `programmatic` for
anything else. `approveSpec` refuses unless its caller passes an explicit approval-gesture
argument, which only the command layer constructs. A script that imports `approveSpec` the
way #517's agent did therefore fails loudly, with a message that points at this spec and
does not tell the caller how to get past it. This exists to stop honest accidents.
INV-3 governs how it is described.

### FR-7 - The preconditions are stated and checked, not assumed

The spec's security rests on the CANNOT rows of the threat model. The shipped docs and the
**MinSpec: Approve Spec** first-run flow state the precondition for the chosen witness. For a
signing key, the precondition is that the key is never forwarded or mounted into an agent
container or session. Where it can be detected cheaply and offline, the extension warns
once (one-time prompt, then silence) if it is about to sign from an environment the user has
marked as an agent environment. A precondition that cannot be checked is listed as a
residual risk. It is never silently dropped.

### FR-8 - Existing records are reconciled honestly, never silently upgraded

Records written before this spec ships carry no witness. They are handled per **Clarify D3**.
Whatever the answer, no tool may add a witness to a record on the human's behalf.
Re-witnessing is a human act, the same rule as SPEC-037 FR-4 / DR-056 Decision 4.

### FR-9 - A failure to witness never lands a record that looks witnessed

If the approve flow cannot produce a witness (no key configured, signer error, user cancelled),
it does one of two things. It writes no record, or it writes a record that verifiably carries
no witness and is shown as unwitnessed. It never writes a record with a placeholder, empty
or stale witness that any consumer could read as valid. Which of the two it does is
**Clarify D4**.

## Invariants (must not break)

- **INV-1 - Tier-0 core stays offline.** Nothing in `packages/minspec` or `packages/shared`
  gains a network call (constitution invariant 1). Signing and verification in the extension use
  local material only.
- **INV-2 - No silent gate.** A missing, unreadable or erroring witness or verification material
  fails the gate closed and names the cause. "Could not verify" never becomes "verified"
  (constitution invariant 2). Verification errors are not swallowed.
- **INV-3 - The accident guard is never called a boundary.** FR-6's invocation check and
  `origin` field are documented, in code comments and in prose, as accident prevention. No
  gate may decide on `origin` alone, because `origin` is agent-writable.
- **INV-4 - Blast radius.** No signing setup, key generation, git-config write or settings
  write happens outside a repo with `.minspec/` at its root, or without the user's explicit
  action (constitution invariant 3). MinSpec never edits global git config or the user's SSH
  configuration on its own.
- **INV-5 - Canonical hash unchanged.** The witness lives in the sidecar, which is already
  excluded from the approvable's canonical hash. Adding it changes no spec's `specHash`
  (DR-034 / `canonical.ts`).
- **INV-6 - Back-compat read.** A legacy record (no witness, no `origin`) still parses.
  `readRecord` never drops a legacy approval silently. Its *grading* changes per D2/D3, and
  the change is visible.
- **INV-7 - DR-056's denylist stays.** The witness is added on top of `checkApprover`. It does
  not replace it, so a known agent identity is still refused before any signing happens.

## Acceptance Criteria

- [ ] **AC-1 (FR-2, the #517 reproduction).** In a test fixture, a script imports the library
      and calls the approval function with `email = <the permitted human approver>`, outside
      the command layer. Result: either no record is written (FR-6), or the record written
      fails `approval-integrity` with a witness failure naming the path.
- [ ] **AC-2 (FR-2, direct write).** A sidecar hand-written as JSON, byte-shaped exactly like a
      real one with the human's `approvedBy` and the correct `specHash`, fails
      `approval-integrity` and is shown as unwitnessed by the validator.
- [ ] **AC-3 (FR-1).** A record produced by the sanctioned UI path with valid approver material
      passes `approval-integrity`. Editing any one witnessed field (`approvedBy`, `specHash`,
      `tier`, `approvedAt`, `specPath`) afterwards makes it fail. There is one test per field,
      and each test changes only that field.
- [ ] **AC-4 (FR-3).** A PR that adds a new key or approver to the verification material *and*
      a sidecar witnessed by that new key fails, because the material is read from base.
- [ ] **AC-5 (FR-3, laundering).** A forged sidecar commit followed by a later, legitimate
      human commit on the same branch does not pass. Verification is bound to the sidecar
      bytes at head, not to "some human touched this PR".
- [ ] **AC-6 (INV-2).** Delete the verification material, make it unreadable, or make the
      verifier throw. Each case turns `approval-integrity` red with a message naming the
      cause. There is one test per fault, and each fault is placed *first* in the iteration
      order as well as last, so an early exit cannot hide it.
- [ ] **AC-7 (FR-5 / INV-1).** The extension and validator code paths that grade a record make
      no network call. This is pinned by the existing child-process / network invariant tests,
      extended to the new verifier.
- [ ] **AC-8 (FR-4).** Dispatch readiness and auto-merge eligibility treat a T3/T4 spec whose
      only record is unwitnessed as not human-approved. Grading follows D2.
- [ ] **AC-9 (FR-7).** The docs state the key/credential precondition, and the first-run
      approve flow shows it once.
- [ ] **AC-10 (FR-8).** The reconcile step never adds a witness. Run twice, it leaves every
      record in the same state (idempotent).
- [ ] **AC-11 (INV-5).** `specHash` for every approvable in the corpus is identical before and
      after the change.

## Decisions needed (Clarify)

Each option carries the cost of choosing it. **(rec)** marks the recommendation.

### D1 - What is the witness?

- **(a) A detached SSH signature over the record (`ssh-keygen -Y sign`, SSHSIG format,
  namespace e.g. `minspec-approval`), stored in the sidecar and verified against an
  allowed-signers list read from base. (rec)** It works offline in the extension, the
  validator and CI. It survives squash-merge, because the signature lives in the record and
  not in commit metadata. It ports to adopters who do not use GitHub. It can reuse the key a
  developer may already have for git commit signing.
  *Cost:* the founder must create and register a signing key, and every approval needs that
  key on the machine where it is made. The whole witness is void if the key or a forwarded
  ssh-agent is reachable from an agent container, and nothing in-repo can fully prove it is
  not. Offline verification in Node needs either a child process (`ssh-keygen -Y verify`,
  which needs an entry in the `CHILD_PROCESS_ALLOWLIST`) or a pure-JS SSHSIG verifier. I
  believe Node's `crypto.verify` supports Ed25519 natively, which would make a pure-JS
  verifier small. That is unverified here.
- **(b) Signed git commit.** The commit that last changed the sidecar must carry a signature
  from an allowed key. *Cost:* squash-merge replaces the commit, so the witness is gone on
  `main`, and offline consumers cannot re-verify a merged record.
- **(c) GitHub-side witness.** Accept a record only when a GitHub actor that is a human, not a
  bot, either pushed the commit that introduced its exact bytes or submitted the review that
  materialized it (SPEC-045). *Cost:* it can only be verified online, so CI is the only place
  that checks it (FR-5). It needs per-push state to defeat laundering (AC-5). It does not work
  for adopters without GitHub. It relies on agents never holding a human GitHub token, which
  today is a per-session observation, not a guarantee.
- **(d) In-process only** (extension-host / TTY / caller check). *Rejected as the witness*: it
  is agent-bypassable by a direct file write (see *Why an in-process check cannot be the
  answer*). It is kept as FR-6.

(a) and (c) compose. SPEC-045's GitHub-review records could be accepted under (c) while
local approvals use (a). Choosing (a) also overturns DR-056's premise that a cryptographic
identity "likely" conflicts with Tier-0, which is a decision that cannot be undone in a day
once records are signed. **The answer to D1 should be recorded as a DR** that amends DR-056's
deferred alternative. That DR is not minted here, because the choice is the human's.

### D2 - How is an unwitnessed record graded?

- **(a) T3/T4: not approved for any gate. T1/T2: approved but flagged "unverified". (rec)**
  This puts the strictness where #517's harm is: the T3/T4 "human approves before agent
  starts" gate and auto-merge eligibility. *Cost:* after cutover, every live T3/T4 approval
  must be re-witnessed by hand before work on it can dispatch or auto-merge (see D3).
- **(b) Every tier: not approved.** *Cost:* T1/T2 have no spec-approval HITL by design
  (DR-076), so this adds ceremony that solo mode removed.
- **(c) Every tier: approved but flagged.** *Cost:* it leaves #517 open. A forged T4 record
  still gates as approved, and only a reader who notices the flag would catch it.

### D3 - What happens to records that exist at cutover?

- **(a) No grandfathering. Every unwitnessed T3/T4 record is graded per D2 from the cutover,
  and the founder re-witnesses the live ones in one clearly labelled batch. (rec)** *Cost:* a
  one-time batch of re-approvals. Measure how many T3/T4 sidecars are live before
  committing to this (not measured here). The batch can be misread as new approvals unless it
  is labelled, the same lesson as DR-056's re-ratification row.
- **(b) Grandfather records already on `main` at a named cutover SHA.** *Cost:* any record
  forged before cutover stays trusted forever, and it is not possible to tell which ones were
  forged. That is exactly #517's failure, frozen in place.

### D4 - When the approve flow cannot produce a witness, does it write anything?

- **(a) Write nothing, and say why (no key configured / signer failed / cancelled). (rec)**
  *Cost:* a human without a configured key cannot approve at all until they set one up. That
  is friction on the first approval in every new repo.
- **(b) Write an explicitly unwitnessed record, graded per D2.** *Cost:* it creates a stream
  of records that look approved at T1/T2 but carry nothing. Invariant 2's "fail visibly" then
  rests on the UI flag being noticed.

### D5 - Which identity does the witness bind to?

- **(a) A key or account listed against the email in `.minspec/config.json` `approvers`, read
  from base. (rec)** It reuses the existing allowlist, the existing machinery-change gate,
  and the existing mental model. *Cost:* the approver list grows from strings to objects. That
  is a config schema change that every reader of `approvers`, including
  `approval-integrity.ts`'s `permittedApprovers`, must migrate in the same change.
- **(b) A separate `allowed_signers` file in git's native format.** It is directly usable by
  `ssh-keygen -Y verify`. *Cost:* there are then two approver lists that can drift apart, the
  shape the "one matcher" rule (SPEC-051 INV-5) exists to prevent.

## Rejected alternatives

- **Keep the email allowlist and add more denylist entries.** Rejected. Any denylist passes
  every identity it has not heard of, and the allowlist entry is public. Neither binds the
  record to an act.
- **Make `approveSpec` non-exported / extension-host-only.** Rejected as the fix (kept as FR-6),
  because the file is writable without the function.
- **Reuse the GitHub PR "Approve" review state as the witness for every approval.** Rejected as
  the only path. SPEC-045 RD-3 already decided that the committed sidecar, not GitHub's review
  state, is the arbiter. Approval must also keep working offline (SPEC-045 FR-7, INV-3).

## Costly to Refactor

The sidecar schema is committed and kept forever (SPEC-017's "never drop a legacy record"
rule). Once records carry a witness format, every future reader must parse that format. If
the witness is changed later, there are two formats in the corpus forever, or a
re-witnessing of every record. This is the main reason D1 should be settled, and recorded as a
DR, before any code.

## Out of scope

- Separating agent commit identity from the human (DR-056 Decision 1 / SPEC-037 FR-5). That is
  done.
- Who may approve which file by role (SPEC-045 FR-1, SPEC-047).
- The record-vs-tree hash check and the approval-PR exemption (SPEC-069). This spec adds one
  predicate to that check and does not redesign it.
- VM approvals that stay inside a ZCode project (SPEC-136 BND-4). If the witness lands, SPEC-136
  can state whether a VM approval carries one. It is not decided here.
- Multi-developer visibility of approvals (#95), and the reviewer bot's own identity (#464).

## Notes on the issue's citations

- The issue cites a coherence detector at `next-task.ts:416`. At this commit `scripts/next-task.ts`
  has no approval or coherence logic near that line; the only approval reference is a comment at
  `:35`. The detector the issue meant has moved or been removed. FR-4 names the gating consumers
  by role, not by that line, so the requirement does not depend on the stale citation.
- The issue's exact incident (`approvedBy = claude@harvest316.com`) is now refused by DR-056's
  denylist, which shipped after #517 was filed. The defect #517 names is still live. The
  approver is still a caller-chosen string, and the record is still a plain file (threat model
  table).

## Traceability

- **Trigger:** #517 (found on #515). **Design lineage:** DR-012 (approval is a human act) →
  DR-056 / SPEC-037 (approver must not be an agent identity) → **this spec** (the approval must
  carry proof an agent cannot forge).
- **Composes with:** SPEC-069 (`approval-integrity` gains the witness predicate), SPEC-045
  (GitHub-review ingress, possible D1(c) witness), SPEC-050 (the approve-and-land flow must
  produce the witness), SPEC-022 (record schema).
- **Follow-up when Clarify closes:** a DR recording the D1 answer, which amends DR-056's
  *Alternatives considered*.
