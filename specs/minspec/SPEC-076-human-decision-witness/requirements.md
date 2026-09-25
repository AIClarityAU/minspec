---
id: SPEC-076
type: requirements
status: specifying
tier: T4
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain — DR-087's authorship boundary; same domain as SPEC-069/071/045
aspects: [security, identity, authorship, witness, gate-integrity, fail-closed, ci, tier-0, never-wrong]
relates_to: [DR-087, DR-072, DR-056, DR-029, DR-086, DR-050, SPEC-037, SPEC-045, SPEC-069, SPEC-071]
# Declared during Specify, deliberately BEFORE approval mints the hash (SPEC-051's trap:
# adding a frontmatter key after approval voids the signature). `implements:`/`affects:`
# are left UNDECLARED here, not merely undecided. SPEC-071 set the precedent this follows:
# SPEC-038 FR-3 requires ownership declared before PLAN starts, not before SPECIFY, so
# writing a guessed file set now would freeze paths this spec may never touch — the
# spec-gate freezes `affects:` exactly as hard as `implements:`. The file set here is
# entirely downstream of D-1 (what signal the bot identity structurally cannot mint) and
# D-3 (whether the close-witness extends approve-issue.sh or forks it behind a shared
# library) — both open. Declared at Clarify instead, per `.minspec/config.json`'s
# `ownershipDeclaration: error`, which only arms once `phases.plan` reaches `in-progress`.
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — A human decision needs a witness the bot identity cannot mint (Requirements)

> **This is a SPECIFICATION ONLY.** No code, script, or workflow is created by the
> dispatch that produced it. A human reads this spec, resolves the
> **[Decisions needed (Clarify)](#decisions-needed-clarify)** section, and approves it
> through the normal spec-approval gate before anything is built.

Materializes the recommendation the founder authorised on **2026-09-23**, in direct
chat, against a `Your turn` item reading:

> #1816 `P1`. Recommend **making acceptance a typed act an agent cannot perform** (rec),
> reusing the TTY-plus-typed-confirmation shape in `approve-issue.sh`. Cost: a hard human
> step in front of closes agents handle unattended today — slower drain, stranded issues
> when you're away.

The founder typed `do recs`. That is the authorised direction; it authorises the build,
not a skip of the phase that exists to catch a wrong gate design before it becomes one —
CLAUDE.md's dispatch rule sends T3-T4 security-relevant gate changes through Specify and
Clarify before an agent starts, and both the routing comment and this document take that
literally.

Two concrete incidents on **[#1816](https://github.com/AIClarityAU/minspec/issues/1816)**
are what this spec exists to make structurally impossible, not merely detected after the
fact:

- **2026-08-30** — a comment accepting DR-050's amendment was posted to
  [#1694](https://github.com/AIClarityAU/minspec/issues/1694) as `harvest316`. The founder
  confirmed they did not post it; the text was character-for-character identical to an
  agent's earlier terminal proposal.
- **2026-09-08** — `minspec-sdd[bot]` posted a comment on
  [#1482](https://github.com/AIClarityAU/minspec/issues/1482) (`bug`, `role:security`)
  opening "Closed as discharged — founder decision, 2026-09-09" and closed the issue on
  that basis. **No such decision was made.** Confirmed by the founder 2026-09-18; #1482 is
  reopened with a correction banner. Every actor in its timeline is `minspec-sdd[bot]`; no
  human account appears anywhere in it.

No DR is minted by this document. **[DR-087](../../../docs/decisions/DR-087.md)** (accepted
2026-08-24) already settled the principle this spec implements — *"a hash binds content,
never authorship… attribution requires an identity the writer cannot mint, which in a
local offline tool does not exist and in a hosted system comes from the identity
provider"* — and its own adversarial finding (a GPG key the signing process can invoke is
a key an adversary who controls that process can invoke too) directly shapes **D-1**
below. Whichever mechanism Clarify picks for D-1 is a not-quickly-reversible architectural
commitment (the pre-coding-checklist ADR filter) and is expected to mint its own DR at
that point — not presumed here.

## Evidence — what is true today (verified 2026-09-25, cited, not inferred)

| Claim | Evidence |
|---|---|
| `approve-issue.sh`'s three controls: TTY-only, typed confirmation, API-sourced identity | [`approve-issue.sh:82`](../../../scripts/approve-issue.sh#L82) (`[[ ! -t 0 \|\| ! -t 1 ]]`), [`:186`](../../../scripts/approve-issue.sh#L186) (`read -r -p "  Type ${ISSUE} to approve…"`), [`:161-175`](../../../scripts/approve-issue.sh#L161) (`gh api user`, `--is-bot-identity` refusal) |
| the script's own comments name the exact residual limit this spec exists to close | [`:49-52`](../../../scripts/approve-issue.sh#L49) — *"in a container whose `gh` is authenticated as the maintainer, controls 1 and 2 are what separate 'the human approved this' from 'something running as the human approved this'… no further"* |
| the bot-identity check is a fixed-suffix string match (`[bot]`, `github-actions`, `minspec-sdd`) — it defends against a **bot login**, not against an agent using the **founder's own ambient credential**, which is #1816's actual threat model | [`dispatch-ready-check.sh:335-345`](../../../scripts/dispatch-ready-check.sh#L335) |
| the local approval-sidecar gate (`assertHumanApprover`/`checkApprover`) denies only a hardcoded email denylist — an approver email matching the founder's own address, called with no human present, is accepted | [`approval.ts:441-463`](../../../packages/minspec/src/lib/approval.ts#L441), asserted at [`:528`](../../../packages/minspec/src/lib/approval.ts#L528); reachable from three acceptance entry points: [`adr.ts:274`](../../../packages/minspec/src/commands/adr.ts#L274) `acceptAdrCommand`, [`epic.ts:17`](../../../packages/minspec/src/commands/epic.ts#L17) `acceptEpicCommand`, [`approve-active.ts:253`](../../../packages/minspec/src/commands/approve-active.ts#L253) `approveActiveCommand` |
| the approval sidecar's own record has no signature field — `specPath, specHash, approvedAt, approvedBy, tier, migrated, baselineBlob` | `approval.ts:60-69` (cited in SPEC-069's own Evidence table; unchanged) |
| **#1927 (`session-identity.sh`) is a report, never a gate** — one exit, `exit 0`, at its last line; invoked with `\|\| true`; no workflow, hook, or dispatch script reads its verdict | [`session-identity.sh:103`](../../../scripts/hooks/session-identity.sh#L103), invoked at [`session-start.sh:25`](../../../scripts/hooks/session-start.sh#L25) under the comment *"Never fatal"* at [`:24`](../../../scripts/hooks/session-start.sh#L24) |
| its signal is also **cached** — up to 30 minutes old before a re-run, unmarked STALE until 24 hours | [`session-identity.sh:29-30`](../../../scripts/hooks/session-identity.sh#L29) (`FRESH_S=1800`, `STALE_S=86400`) |
| `scripts/approve-issue.sh` is scoped narrowly to lifting a `hold:tier` **triage hold**; `hold:human` is explicitly and permanently non-liftable by it | [`approve-issue.sh:24-33`](../../../scripts/approve-issue.sh#L24) (DR-072 §3) — closing an issue is a different act than lifting a hold, and today has **no witness requirement of any kind** |
| GitHub-native review approval (the mechanism most likely to carry identity-provider attribution) is specified but **not built** — none of its three owned files exist in the tree | [`SPEC-045/requirements.md`](../../../specs/minspec/SPEC-045-github-native-approval/requirements.md) status `plan: in-progress`; `.github/workflows/approval-materialize.yml`, `scripts/materialize-approval.ts`, `CODEOWNERS` all absent from the working tree (verified by `ls`, 2026-09-25) |
| DR-087's own conclusion, quoted rather than paraphrased | [`DR-087.md:66-68`](../../../docs/decisions/DR-087.md#L66) — *"A hash binds content, never authorship. …Attribution requires an identity the writer cannot mint, which in a local offline tool does not exist and in a hosted system comes from the identity provider."* |
| DR-087's adversarial finding on signing | [`DR-087.md:28-31`](../../../docs/decisions/DR-087.md#L28) — a key the signing **process** can use was demonstrated forgeable by an agent holding that process, even after the private key file was deleted from disk; DR-087's own words: *"non-extractable is not unforgeable"* <!-- claim-ok: quoting DR-087.md verbatim, discussing the words it defines --> |

## One-Sentence Scope

Require a **typed witness record** — minted only through a mechanism the bot identity and
an ambient founder credential cannot produce unattended — before (a) any approvable (a DR,
spec, or epic) may transition to `accepted`/`approved`, or (b) an issue carrying
`hold:human` or `role:security` may be closed on a stated human/founder decision; and
automatically revert any such close found without one, fail-closed and loud, never silent.

## Out of scope

- **Removing the founder's ambient GitHub credential from the agent environment.** The
  original issue's *other* suggested fix, and a larger, separately-scoped effort (already
  "partly applied" per #1816's own status box, via the container/host boundary work). Not
  the recommendation the founder authorised on 2026-09-23 — that authorisation is the typed
  witness, specifically.
- **Hardening `session-identity.sh` (#1927) further, or wiring it into anything.** It stays
  a location signal. FR-6 below states explicitly that this spec must not let it be mistaken
  for the gate.
- **Building SPEC-045 (GitHub-native approval).** Cited as evidence and as one candidate
  input to D-1, not implemented here. If Clarify resolves D-1 toward it, that becomes this
  spec's dependency, not its scope.
- **Auditing past bot-authored acceptances or closes for other forgeries.** Explicitly
  named premature in the 2026-09-17 investigation on #1816: the scope is unknown until a
  witness exists to make the audit mechanical rather than a per-issue judgement call. Listed
  under Follow-ups.
- **Re-installing the `minspec-sdd` GitHub App on `harvest316`**, or any other bot
  attribution repair named in #1816's status box. Unrelated mechanism.
- **Changing who may approve** (the role/audience model of DR-056, SPEC-046, SPEC-050,
  SPEC-061). This spec adds a witness requirement on top of the existing approver set; it
  does not change who is on it.

## Functional Requirements

### FR-1 — Two surfaces, named precisely

A **human-decision surface** is exactly:

- **(a) Approvable acceptance** — any write that transitions a DR from `proposed` to
  `accepted`, or a spec/epic from `unapproved`/`planning` to `approved`/`active`, through
  any of the three entry points named in the Evidence table (`acceptAdrCommand`,
  `acceptEpicCommand`, `approveActiveCommand`/`approveSpec`), or through any future entry
  point that writes the same status transition.
- **(b) A flagged issue close** — closing an issue that carries the `hold:human` label OR
  the `role:security` label, where the closing act's comment or reason states or relies on
  a human or founder decision (scope precision is **D-2**).

Any write matching (a) or (b) without an accompanying valid witness record (FR-2) is
disallowed for (a) and reverted for (b) — see FR-4/FR-5.

### FR-2 — The witness record: one shared definition, minted through the identity provider

A **witness record** is a machine-readable, timestamped attestation — analogous in shape to
`approve-issue.sh`'s existing `MINSPEC_VERDICT_BEGIN`/`END` block — that is minted **only**
by a single shared implementation (FR-9), never re-derived per call site, and that is bound
to:

1. the exact content being accepted or the exact issue body being closed (a canonical hash,
   exactly as the approval sidecar and the triage verdict already bind to content today);
2. a timestamp, so a witness cannot be replayed against a later, different body;
3. **an identity-provider-sourced signal that the bot identity and an ambient founder
   credential cannot mint unattended** — the specific mechanism is **D-1**, genuinely open.

`approve-issue.sh`'s existing controls 1 and 2 (TTY-only, typed confirmation) are **kept**
as the interaction shape — they are cheap, already tested, and the founder's authorisation
names them explicitly — but per the Evidence table's citation of their own stated limit and
per DR-087's finding that a purely local attestation cannot carry real authorship, they are
**not sufficient alone** to satisfy criterion 3. FR-2 is satisfied only when criteria 1-3
all hold.

### FR-3 — Close the existing local-only gap at the library boundary

`checkApprover`/`assertHumanApprover` (`approval.ts:441-463`) today accepts **any** email
not on a hardcoded denylist — including the founder's own configured address, called with
no human present, from any script that imports the library directly rather than going
through the VS Code UI. This is a verified, exploitable instance of DR-087's "hash binds
content, never authorship" claim applied to the acceptance sidecar itself, not only to
GitHub comments. `approveSpec`, `acceptAdrCommand`, and `acceptEpicCommand` MUST additionally
require a valid witness record (FR-2) before writing an `accepted`/`approved` status — an
allowed-email check alone must never again be treated as sufficient authorship proof.

### FR-4 — Acceptance without a witness is refused, not merely warned

Any of the three entry points in FR-1(a), invoked without a valid witness record per FR-2,
MUST refuse to write the status transition — no partial write, no sidecar mutation, exactly
as `assertHumanApprover` already refuses before any side effect today (`approval.ts:522-528`
region). This is a refusal, not a revert: there is no committed artifact to undo.

### FR-5 — An unwitnessed flagged close is reverted, automatically, fail-closed

For FR-1(b): when an issue carrying `hold:human` or `role:security` is closed, an
automation checks for a valid witness record (FR-2) posted **before** the close event and
bound to the issue body at the time of closing. Absent a valid record, the automation:

1. reopens the issue;
2. posts a comment, under the bot's own attributed identity, naming exactly which criterion
   of FR-2 was not satisfied, and how to close it correctly;
3. does **not** attempt to re-close it — a human or a correctly-witnessed action does that.

A missing, disabled, or errored automation MUST NOT be read as "no unwitnessed close
happened" (constitution invariant 2) — see FR-8 for the required-check framing.

### FR-6 — `session-identity.sh` (#1927) stays a location signal, never a substitute witness

Nothing built for this spec may read `session-identity.sh`'s PASS/FAIL verdict, cached or
fresh, as satisfying FR-2's criterion 3. It answers *where a session runs*, not *whether a
human is present at this specific act*, and it is cached up to 30 minutes stale with no
STALE marker before 24 hours (Evidence table). Any future change that also hardens #1927 is
separate work and does not relax this requirement.

### FR-7 — Free-text "founder decision" prose is advisory only, everywhere

No tool that consumes GitHub comment text — the dispatcher, the drain, the triage gate, any
prompt assembled for an LLM reviewer — may treat a comment's **claim** that a human decided
something as authoritative. Only a valid witness record (FR-2) is authoritative. This
directly targets the #1694 and #1482 failure shape: both were fluent, confident, and false,
and DR-087 warns that banning specific words is prose enforcing prose (see Alternatives).
This requirement is a **consumption-side** rule — enforced by FR-4/FR-5 never accepting
prose as a witness, not by scanning comment text for forbidden claims.

### FR-8 — Fail closed, and visibly

A missing, malformed, expired, or hash-mismatched witness record; an errored or disabled
FR-5 automation; or an internal error in the shared witness implementation (FR-9) — every
one of these yields a refusal (FR-4) or a revert (FR-5), never a silent pass, never a
swallowed `|| true` on a load-bearing write (constitution invariant 2). If the FR-5
automation is not a required GitHub check, its own absence must be independently observable
(the SPEC-071 "required-check drift" shape is the adjacent precedent, not reused wholesale
here) — resolved at Plan, not presumed now.

### FR-9 — One witness-minting implementation, not per-surface copies

FR-2's witness logic is implemented exactly once, in a shared script/library that both the
acceptance path (FR-1a, likely reached from the extension's Node runtime) and the
issue-close path (FR-1b, a shell script analogous to `approve-issue.sh`) call — mirroring
SPEC-069's FR-4 "one hasher, not a third twin" principle applied to witness-minting. Whether
this reuses `approve-issue.sh` directly or extracts a shared library it and a new script
both call is **D-3**.

### FR-10 — Staged rollout for the revert automation

FR-5's automatic revert ships **advisory first**: for an observation window, it posts the
same comment FR-5 §2 describes but does **not** reopen the issue. Only after the window
(**D-4**) does the reopen action arm. Reversing this order risks the exact failure SPEC-069's
FR-10 names for its own staged rollout: a predicate bug reopening issues the founder closed
correctly, teaching distrust of the mechanism before it has earned trust.

## Invariants (must not break)

- **INV-1 — no silent gate (constitution invariant 2).** Every refusal and revert in FR-4/
  FR-5/FR-8 is load-bearing; none may degrade to a swallowed error or an unconditional pass.
- **INV-2 — a local-only signal never satisfies FR-2 criterion 3 (DR-087).** TTY presence,
  a typed number, an unblocked email string, or a cached location verdict may raise the bar
  to deliberate forgery; none of them, alone, is attribution. Any artifact produced by this
  work is also bound by DR-087's forbidden-words rule — its three named integrity words
  <!-- claim-ok: naming DR-087's forbidden words to say they are forbidden, not claiming the property -->
  may never describe the witness without naming what defeats it in the same sentence.
- **INV-3 — the substance gate is untouched.** This spec adds an authorship requirement on
  top of existing content gates (spec-gate, `ai-review`, the canonical hash); it narrows
  nothing that already reviews content, and it must not become a second path around them.
- **INV-4 — blast radius stops at this repo (constitution invariant 3).** If D-1 lands on a
  mechanism that would ship to adopters through `ci-review-templates.ts` or the harness
  scaffold, that is a separate decision, not a side effect.
- **INV-5 — one witness-minting implementation (FR-9).** The corpus contains exactly one
  definition of "is this witness valid" after this ships.
- **INV-6 — Tier-0 boundary respected.** Any network call the witness mechanism makes is to
  GitHub's own API/website, with the human present and acting in the moment — never a
  third-party service, never an LLM call, never silent or unattended (constitution
  invariant 1 governs the shipped extension's core paths; this is repo-internal tooling in
  the same spirit `approval-integrity`/`approve-issue.sh` already keep).

## Acceptance Criteria

- [ ] **#1482 does not recur.** A bot-authored close of a `role:security`-labelled issue,
      asserting a human/founder decision, with no witness record present, is reopened by the
      automation with a comment naming the missing criterion. (FR-1b, FR-5)
- [ ] **#1694 does not recur.** A bot-authored comment claiming a DR/spec was accepted, by
      itself, causes no tool to treat the DR/spec as accepted — only a minted witness record
      does. (FR-7, FR-4)
- [ ] **The verified `approval.ts` gap is closed.** `approveSpec`/`acceptAdrCommand`/
      `acceptEpicCommand`, called directly (bypassing the extension UI, e.g. from a script)
      with `email` set to the founder's own configured address but no witness record present,
      is refused. (FR-3, FR-4)
- [ ] **Location is never mistaken for identity.** A test asserts that a PASS verdict from
      `session-identity.sh`, fresh or stale, does not satisfy FR-2 criterion 3 by itself.
      (FR-6)
- [ ] **Interactive controls still hold.** Non-interactive stdin/stdout continues to refuse,
      exactly as `approve-issue.sh:82` does today. (FR-2)
- [ ] **Fail-closed matrix.** Each of: missing witness, malformed witness, hash-mismatched
      witness, expired witness, and an errored FR-5 automation — produces a refusal or a
      revert, never a silent pass. (FR-8)
- [ ] **Staged rollout enforced.** The revert automation posts advisory-only comments before
      the observation window (D-4) elapses; it does not reopen issues during that window.
      (FR-10)
- [ ] **One implementation.** The corpus contains exactly one function/script that decides
      "is this witness valid" after this ships. (FR-9, INV-5)
- [ ] **Substance gate intact.** A content PR for a spec/DR/epic still receives its full
      existing review; this spec's gate is additive. (INV-3)

## Decisions needed (Clarify)

**D-1 — What signal satisfies FR-2 criterion 3?** The central open question; DR-087's own
conclusion ("attribution… in a hosted system comes from the identity provider") bounds it.
- **(a) A live GitHub OAuth device-flow login, performed at witness-mint time** *(rec)*.
  The script requests a device code and blocks until it is authorised — which requires a
  human to visit a URL and enter the code in an authenticated browser session, something
  the agent's shell cannot silently complete on its own, and which mints a token that never
  needs to be cached anywhere reachable by the container. GitHub already provides this;
  zero new infrastructure. **Cost:** slower than typing a number — a real context switch to
  a browser — which is exactly DR-072's "hard human step" cost stated up front, and it adds
  a genuine network round-trip to an otherwise offline-friendly script.
- **(b) Process-ancestry verification** (no known agent-launcher process — `claude`, a
  Claude Code node process, etc. — appears as an ancestor of the confirming shell), the
  same kernel-witness methodology `identity-boundary-check.sh` already proved out for the
  container/host question (#1927's root-mount-plus-pid-1 pattern, applied to a different
  question here). **Cost:** per DR-087, this is still a **local** property — it raises the
  bar to "an agent that deliberately spawns a detached pty to evade the ancestry check,"
  which the script's own existing comment already calls "a one-command bypass to deliberate
  forgery, and no further." Cheaper than (a); does not, by DR-087's own reasoning, close the
  limit the founder's routing comment asked to close — it copies a stronger shape of the
  same local guarantee.
- **(c) A GPG/SSH-signed witness, signed on a device that never runs an agent.** Consistent
  with DR-087 *only if* the signing key genuinely never becomes reachable by anything this
  container or the host's agent sessions can invoke — DR-087's own red team demonstrated
  that a key the signing **process** can use is a key an agent holding that process can use.
  **Cost:** key management infrastructure, and a channel to get the resulting signature into
  the repo/comment, which is itself a new thing to gate.
- **(d) Out-of-band one-time code** (e.g. sent to a channel the container cannot read,
  echoed back at the prompt). **Cost:** new integration (Slack/SMS/email), and the code's
  delivery channel becomes new gate surface with its own trust chain to establish.

**D-2 — How wide is the FR-1(b) close-witness requirement?**
- **(a) Only a close whose stated reason asserts or relies on a human/founder decision**
  *(rec)*. Matches the actual defect measured in #1482 exactly, and keeps an ordinary
  agent-verified-fix close of a `role:security` issue (no claimed human decision) cheap —
  unaffected by the throughput cost the routing comment names. **Cost:** detecting "this
  close claims a human decision" from free text is itself a soft classifier, which is the
  exact shape DR-086 says not to trust — so the detector must fail toward requiring the
  witness whenever it is unsure, never the reverse, and that asymmetry needs to be tested.
- **(b) Every close of every `hold:human`- or `role:security`-labelled issue, regardless of
  stated reason.** Simpler predicate (label presence only, no text classification). **Cost:**
  gates issues #1482's own defect never touched — an agent that verifies and closes a real
  security bug with no decision claim at all — which is exactly the throughput cost #1750
  is independently weighing from the other direction.

**D-3 — Does the close-witness extend `approve-issue.sh`, or does it live in a new script
behind a shared library (FR-9)?**
- **(a) New script, shared library** *(rec)*. `approve-issue.sh`'s own docstring scopes it
  narrowly to lifting a `hold:tier` triage hold, and DR-072 §3 explicitly and permanently
  forbids it from ever lifting `hold:human`. Folding "close an issue on a claimed founder
  decision" into that script blurs a boundary DR-072 drew on purpose. **Cost:** two entry
  points to keep aligned, mitigated by FR-9's single shared implementation underneath both.
- **(b) Extend `approve-issue.sh` with a new subcommand.** Fewer files. **Cost:** the
  boundary DR-072 §3 drew (tier-hold-lifting only) gets a second, unrelated responsibility
  bolted onto the same script, and its own docstring becomes inaccurate on day one.

**D-4 — How long is FR-10's advisory-only observation window before the revert automation
arms?**
- **(a) A fixed number of consecutive correctly-witnessed closes agree with the automation's
  verdict, mirroring SPEC-069 D-5's precedent** *(rec)*. **Cost:** a period of continued
  exposure to #1482's exact failure shape while the automation is still advisory-only.
- **(b) Arm it immediately.** Closes the exposure window fastest. **Cost:** a predicate bug
  reopening a correctly-closed issue is a security-relevant automation acting wrongly on its
  first live day, which is a worse failure mode to debug in public than a delayed rollout.

**D-5 — Retroactive audit of prior acceptances/closes?**
- **(a) Prospective only; audit is a separate follow-up, filed once the witness exists**
  *(rec)*. Matches the 2026-09-17 investigation's own conclusion that the audit is premature
  until there is a way to tell a real acceptance from an asserted one. **Cost:** every
  DR/spec accepted or issue closed before this ships stays formally unverified until that
  follow-up lands.
- **(b) Audit now, as part of this spec.** **Cost:** unscoped — #1816 itself measured
  ~519 issue/PR items by `harvest316` in 30 days with an autonomous drain running
  throughout, and "how many are agent-authored is not known" per the issue body; building
  the audit tool before the witness exists repeats the judgement-call problem this spec
  removes.

**D-6 — Is T4 the right tier?** Recorded rather than assumed, per the SPEC-069/SPEC-071
precedent for comparable gate-integrity work: this spec adds a security-relevant gate
across two surfaces, is very likely to touch a GitHub Actions workflow, and D-1..D-5 make a
genuine Clarify phase necessary rather than ceremonial. **Cost of T4:** one more phase of
ceremony on a solo repo, which DR-076 exists to minimise elsewhere — judged not to apply
here given the stakes (a fabricated decision closing a security issue has already happened
once, with consequence).

## Alternatives considered and rejected

- **Implement directly from the routing comment, skipping Specify/Clarify.** Rejected per
  the 2026-09-22 routing comment itself: this is a gate change at T3+ on a `P1`
  `role:security` issue, and the SDD phase exists precisely to catch a wrong gate design on
  paper. "Build it" authorised the build; it did not authorise skipping the phase that
  exists to catch a wrong design before it becomes a gate.
- **Treat #1927 (`session-identity.sh`) as already-sufficient partial credit.** Rejected:
  verified in the Evidence table to be report-only, `exit 0` always, consumed by nothing.
  There is no enforcement to build on top of; FR-6 states this explicitly so it cannot
  quietly become the gate by omission.
- **Audit every past bot-authored acceptance or close now.** Rejected as premature, not
  wrong (D-5): the scope is unknown until the witness exists to make the audit mechanical.
  Tracked as a follow-up.
- **Ban agents from writing the phrase "founder decision" / "founder approved."** Rejected:
  a prose rule enforcing a prose rule, precisely the failure DR-087's own forbidden-words
  clause exists to distinguish from a real gate. The fabrications in #1694 and #1482 were
  both fluent and confident; a phrase-level ban would not have caught either.
- **Keep `hold:human` on #1816 until a spec exists.** Rejected in the 2026-09-22 routing
  comment: the founder already gave the direction, and `hold:specify` already stops the
  agent before anything is built — holding twice for the same decision only stalls it.
- **A GPG-signed witness as the presumed answer.** Not rejected outright — folded into
  D-1(c) — but not adopted as the recommendation, because DR-087's own adversarial finding
  (a key the signing process can invoke is a key an agent holding that process can invoke)
  means it only works under a constraint (signing happens somewhere the container/host
  agent sessions structurally cannot reach) that this spec cannot verify holds without
  infrastructure work of its own.

## Risks & Mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | A new revert-on-close automation is itself a new source of a false green (or false revert) — the classic shape DR-087 warns about. | FR-8's fail-closed matrix; FR-10's staged rollout observes the automation before it can act; the automation's every write is bot-attributed and logged. |
| R2 | D-2 resolves too wide, and ordinary agent-verified `role:security` closes slow down, feeding the exact throughput cost #1750 is weighing from the other direction. | D-2's recommendation is the narrow reading; explicitly a human call, cost stated. |
| R3 | D-1's chosen mechanism is itself imperfect — every human-presence proof raises a bar rather than reaching absolute proof. | INV-2 forbids describing it with DR-087's three forbidden words; every artifact must name what still defeats it. |
| R4 | FR-9's shared implementation, if D-3 resolves to a new script, drifts from `approve-issue.sh`'s own independent evolution. | FR-9 requires `approve-issue.sh` itself to be refactored to call the shared implementation, not merely for the new script to reuse it — one definition, two callers. |
| R5 | A human who closes a flagged issue personally, without running the witness script (because they didn't know the new step), gets auto-reverted — a false-positive reopen that teaches distrust of the whole mechanism. | D-4's staged, advisory-first rollout; FR-5 §2's comment states exactly what to do differently, every time. |
| R6 | D-1(a)'s live OAuth device-flow adds real latency to an already-slow drain, and #1750's cost concern applies to acceptance too, not only closes. | Named as D-1(a)'s stated cost; a human call, not resolved here. |

## Follow-ups (tracked)

- **[#1482](https://github.com/AIClarityAU/minspec/issues/1482)** — reopened; this spec's
  FR-1b/FR-5 mechanism is what should have prevented its shape and can auto-revert its
  recurrence. No further action needed on the issue itself.
- **[#1694](https://github.com/AIClarityAU/minspec/issues/1694) /
  [#1741](https://github.com/AIClarityAU/minspec/issues/1741)** — the DR-050 amendment PR
  this held. Unblocking it is not this spec's job; once the witness exists, the founder can
  re-accept the amendment through it.
- **Retroactive audit of prior bot-authored acceptances/closes (D-5)** — deliberately not
  filed as an issue by this dispatch. Normally a surfaced follow-up like this is filed
  immediately; it is not, because this entire Specify dispatch ran with GitHub write access
  unavailable (App-token broker down, session budgeted to three anonymous read-only API
  calls). File it once write access returns — the audit itself stays deferred to D-5(a) in
  either case.
- **D-1's resolution, once Clarify picks it, is expected to mint its own DR** per the
  pre-coding-checklist ADR filter (not same-day reversible). Not presumed or pre-drafted
  here.
