---
id: SPEC-056
type: requirements
status: implementing
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — the Explain affordance is a rubber-stamp countermeasure on the review surfaces
aspects: [ux, tier-0, review, approval, honest-degrade]
depends_on: [SPEC-014, SPEC-018]
relates_to: [SPEC-014, SPEC-018, SPEC-013, SPEC-016, SPEC-017, DR-004, DR-057, DR-017, DR-012]
---

# MinSpec — Explain (?) affordance: a read-only, one-click "explain this to me" exit on the review surfaces (Requirements)

> Materializes **[#914](https://github.com/AIClarityAU/minspec/issues/914)** (role:architect, Specify phase only). The Explain control was already folded into the two owning host specs as normative FRs — **[SPEC-014](../SPEC-014-review-webview/requirements.md) FR-18** (reviewer action bar, requirements.md:212-230) and **[SPEC-018](../SPEC-018-spec-custom-editor/requirements.md) FR-18** (per-section hover toolbar, requirements.md:257-283). This spec is the **coordinating** home for the *cross-cutting* parts those two FRs share and neither one owns: the Tier-0 routing seam, the queue request contract, and the honest-degrade floor. It deliberately does **not** re-own the host-side interaction requirements — those stay with SPEC-014 / SPEC-018.

## One-Sentence Scope

Give a reviewer a read-only, one-click **`?` Explain** control — on both review surfaces (the SPEC-014 reviewer action bar at document scope, and the SPEC-018 per-section hover toolbar at section scope) — that requests a plain-language explanation of the artifact under review, routed **out of** the Tier-0 core (core enqueues a request and renders the reply, never calls an LLM), never mutating the document or its approval hash, and degrading honestly to a "no explainer available" notice when no consumer is present — so that *"I don't understand this"* becomes cheaper and more truthful than approving, without adding an "approve — not understood" button that would sanction rubber-stamping.

## Context

Grounded in the current code and specs, with `file:line` evidence. Every claim below was read, not inferred.

### The Explain FRs already exist in the two host specs — verified

- **SPEC-014 FR-18** — "Explain — a read-only exit cheaper than approving": the review action bar exposes a `?` control at **document** scope; read-only; routes through the *single* AI seam SPEC-014's revision loop resolves (its FR-OQ2); degrades honestly ([SPEC-014 requirements.md:212-230](../SPEC-014-review-webview/requirements.md)).
- **SPEC-018 FR-18** — "Explain — read-only, one-click preset of the chat channel": the per-**section** hover toolbar exposes the same `?`, a zero-typing preset of the FR-12/FR-16 chat channel; read-only; keyboard-first (revealed on section focus, two-key chord, hotkey in tooltip); degrades honestly ([SPEC-018 requirements.md:257-283](../SPEC-018-spec-custom-editor/requirements.md)).

So the feature is **not un-specified** — it is specified twice, at two scopes, by two owning specs, and each already carries its own AC (SPEC-018 AC-19, requirements.md:406; T0 boundary row at :570). What is **not** consolidated anywhere is the *shared contract* the two rely on: what a read-only Explain request looks like on the wire, which seam carries it, and what the degrade floor must show. That gap is this spec's subject.

### The Tier-0 routing constraint is real and enforced by construction

`packages/minspec` **cannot** call an LLM: [DR-004](../../../docs/decisions/DR-004.md) forbids any networking module in core/shared, enforced by tests (invariants asserting no `http`/`https`/`fetch`/`net` import from feature-reachable modules — the same boundary SPEC-014 FR-17 and SPEC-018 FR-8 already re-assert). Explain therefore cannot be "core calls the model"; it must be **core enqueues a request → a consumer outside core generates → core renders returned text**.

### The queue producer primitive exists but is typed only for phase-advance

The [DR-057](../../../docs/decisions/DR-057.md) `.minspec/queue` producer is built: `enqueuePhaseAdvance` writes a JSON request into `.minspec/queue/<spec>.json` ([phase-advance-queue.ts:47-60](../../../packages/minspec/src/lib/phase-advance-queue.ts#L47)). But its request type is **narrow**: `PhaseAdvanceRequest { specPath, requestedAt, source }` with `source: PhaseAdvanceSource = 'alt-a-toast'` ([phase-advance-queue.ts:25-33](../../../packages/minspec/src/lib/phase-advance-queue.ts#L25)) — there is no field for an artifact scope (section vs document), no free-text prompt, and no request *kind* distinguishing "advance a phase" from "explain this". So routing Explain through this exact queue is a **contract addition**, not a free ride (see FR-4 and DQ-2). The consumer that would drain such a request is **not built** (#732 / #734 / #735).

### Both host surfaces are specified-but-not-built — Explain cannot ship before them

SPEC-014 (`status: implementing`, requirements.md:3) has requirements only — no action-bar code; SPEC-018 (`status: implementing`) has 0/53 tasks and no custom-editor / hover-toolbar code. There is **no toolbar and no hover group** in code today to host a `?`. Explain **rides on** both, plus the DR-057 consumer; it is a small addition once they land and cannot precede them. This spec records that dependency; it does not attempt to unblock it.

## Functional Requirements

- **FR-1 (one control, two scopes, one behaviour).** The `?` Explain control MUST behave identically wherever it appears — SPEC-014's reviewer action bar at **document** scope, SPEC-018's hover toolbar at **section** scope — differing only in the *scope descriptor* of the artifact it names. The two host specs own placement/interaction (SPEC-014 FR-18, SPEC-018 FR-18); this spec owns that they resolve to the **same** request contract and the **same** degrade floor, so the two surfaces cannot drift into two different Explain features. *Rationale: single behaviour, single contract — the SPEC-038 "one matcher, no drift" lesson applied to a UX affordance.*

- **FR-2 (read-only — no write, no gate effect).** Explain MUST NOT invoke the revise/edit path (SPEC-018 FR-11/FR-12 apply step), MUST NOT produce a `WorkspaceEdit`, MUST NOT alter the document bytes or its canonical approval hash, and MUST NOT approve, skip, stop, or otherwise touch the approval gate. It is a non-destructive sibling of the SPEC-014 FR-3 comment pin. *Rationale: an explanation that can silently edit or void an approval would re-introduce the never-wrong hazard the feature exists to reduce; the read-only guarantee is what makes it truthful.*

- **FR-3 (Tier-0 — core enqueues and renders, never generates).** The `?` click MUST enqueue an **LLM-free** request from `packages/minspec`; generation happens in a consumer/agent **outside** core; core only **renders** the returned text. No file reachable from this feature may import `http`/`https`/`fetch`/`net`. *Rationale: [DR-004](../../../docs/decisions/DR-004.md); re-asserts SPEC-014 FR-17 / SPEC-018 FR-8 for the Explain path specifically.*

- **FR-4 (a defined request contract on the shared seam).** There MUST be a single, typed, serialisable **Explain request contract** that both host surfaces produce and the consumer reads, carrying at minimum: the target artifact (repo-relative path), the **scope** (`document` | `section`, with a section identifier when `section`), the canonical **preset prompt** (*"Explain this section in plain language; do not modify the document."*), a request **kind** distinguishing it from a phase-advance request, and a timestamp. Whether this contract is a new `source`/shape on the existing DR-057 `PhaseAdvanceRequest` queue, a sibling request type in the same `.minspec/queue` namespace, or the SPEC-014 FR-OQ2 channel directly is a **Clarify decision** (DQ-2). *Rationale: the two surfaces and the consumer are three separate boundaries; a cross-boundary feature needs one contract they agree on, or they drift (the issue's "adds a new request shape/source").* 

- **FR-5 (one AI seam, chosen by the host specs — never a second).** Explain MUST route through the **same** AI channel the host's revision loop already delegates to — the channel SPEC-014's FR-OQ2 resolves (chat-participant vs `minspec.dispatchRevision` vs prompt-file vs the [DR-017](../../../docs/decisions/DR-017.md) broker), which SPEC-018 FR-12 also binds to. Explain MUST NOT introduce a new or assumed seam. The DR-057 `.minspec/queue` primitive is **one candidate** for that channel, to be pinned alongside FR-OQ2 at plan — not a competing path. *Rationale: two AI seams is two Tier-0 boundaries to audit and two things to break; SPEC-018 FR-12 already forbids a second seam.*

- **FR-6 (honest degrade — never a silent no-op or a fabricated answer).** When no consumer/agent is present to service the request, the `?` MUST show a plain **"no explainer available"** notice ([SPEC-013](../SPEC-013-risk-section-policy/requirements.md) honest-floor), never a silent no-op and never a fabricated or placeholder "explanation". The reviewer MUST be able to tell "not answered" from "answered". *Rationale: a fake explanation on a comprehension aid is worse than none — it is the never-wrong signpost lying; constitution invariant #2 (no silent gate) at the UX layer.*

- **FR-7 (keyboard-first, per the host specs).** The control MUST be reachable by keyboard (revealed on section/document focus; two-key chord; hotkey shown in tooltip), consistent with SPEC-018 FR-18. This spec restates it as a shared requirement so the document-scope (SPEC-014) placement is not built mouse-only. *Rationale: RSI / keyboard-over-mouse preference recorded in the issue and SPEC-018.*

## Acceptance Criteria

- **AC-1 (FR-2 — read-only proof).** Triggering Explain at either scope produces **zero** `WorkspaceEdit`, leaves the document bytes **byte-identical**, and leaves the approval sidecar/hash unchanged. Asserted on a fixture: hash before == hash after, `git status` porcelain clean for the doc, no edit recorded.
- **AC-2 (FR-2 — gate untouched).** Triggering Explain does not change the artifact's approval state, does not advance/skip/stop the review walk, and does not enable the Approve control. Asserted on the approval store + walk state.
- **AC-3 (FR-3 — Tier-0).** A T0 test asserts no module reachable from the Explain path in `packages/minspec` imports `http`/`https`/`fetch`/`net`, matching the DR-004 boundary test the host specs already carry.
- **AC-4 (FR-4 — one contract, both surfaces).** A single typed Explain request produced from the document-scope control and from a section-scope control validates against the **same** schema and differs only in the scope descriptor. Asserted structurally on the two produced requests.
- **AC-5 (FR-6 — honest degrade).** With no consumer present, the `?` renders the "no explainer available" notice and never a fabricated answer; the reviewer-visible state is distinguishable from a delivered explanation. Asserted on the rendered surface for the no-consumer path.
- **AC-6 (FR-5 — no second seam).** No code added for Explain opens a network/LLM channel of its own; it hands the request to the single host-chosen channel. Asserted structurally (no new dispatch/transport module) plus the AC-3 import test.
- **AC-7 (FR-1 — parity).** The document-scope and section-scope controls resolve to the same behaviour and contract (same preset prompt, same read-only guarantee, same degrade floor); a parity test asserts they cannot diverge in those properties.

## Invariants

- **INV-1 (read-only / approval integrity — DR-012).** Explain never writes the document, never emits a `WorkspaceEdit`, and never voids, mints, or refreshes an approval. The only things that void an approval remain genuine content edits through the FR-11/FR-12 apply path.
- **INV-2 (Tier-0 / offline — DR-004).** No network or LLM call originates in `packages/minspec` for this feature. Core produces a request and renders a reply; generation is always out-of-core. Re-asserts SPEC-014 FR-17 / SPEC-018 FR-8.
- **INV-3 (no silent gate — constitution #2).** The absence of an explainer fails **visibly** (the honest-degrade notice), never as a silent no-op and never as a fabricated answer. A missing consumer is a shown state, not swallowed.
- **INV-4 (one AI seam — SPEC-018 FR-12).** Explain adds no second AI channel; it reuses the single host-resolved seam. Two seams is a boundary regression.
- **INV-5 (no rubber-stamp-sanctioning UX — constitution).** This feature must remain the *read-only, non-approving* exit. It must never grow into an "approve — not understood" button, a confidence slider, or any control that records an approval qualified by self-reported non-understanding — the patterns the issue and SPEC-014 R6 explicitly reject.

## Decisions needed (Clarify)

These are genuine forks a human must settle before Plan. None is guessed here.

- **DQ-1 — Should this standalone spec exist at all, or is #914 already fully covered by SPEC-014 FR-18 + SPEC-018 FR-18?** The Explain interaction is *already* normative in both host specs, each with its own AC. Three options:
  - **Option A — keep SPEC-056 as a thin coordinating spec (recommended).** It owns only the cross-cutting contract (FR-4), the shared seam agreement (FR-5), and the degrade floor (FR-6), and cross-references the host FRs for placement/interaction. Cost: one more spec to keep in sync; benefit: the shared queue/contract has a single owner instead of being implied by two FRs that could drift.
  - **Option B — fold everything back into the two FR-18s and close #914 as covered.** No new spec; the contract lives as a shared note in whichever host owns the chat channel (SPEC-018). Cost: the cross-boundary contract has no single home and is re-derived in two places (the exact drift this spec guards against). Benefit: less ceremony.
  - **Option C — promote the shared contract into SPEC-018 (chat-channel owner) and have SPEC-014 FR-18 reference it.** No SPEC-056; SPEC-018 becomes the contract owner. Cost: SPEC-014's document-scope Explain now depends on a SPEC-018-internal type; benefit: one owner, no new spec.
  - *Trade-off:* A gives the cross-boundary contract its own reviewable home at the cost of a third document; B/C avoid a new spec but leave the contract owned by prose in a host spec. If the human picks B or C, this spec should be **withdrawn**, not implemented — that is a legitimate, honest outcome of the Specify phase.

- **DQ-2 — Which seam carries the Explain request, and what is the exact contract (FR-4/FR-5)?**
  - **Option A — extend the DR-057 `.minspec/queue` request.** Add a request *kind* + scope + prompt to (or beside) `PhaseAdvanceRequest`, and a new `source` (e.g. `'explain'`). Cost: widens a shipped, phase-advance-typed contract ([phase-advance-queue.ts:25-33](../../../packages/minspec/src/lib/phase-advance-queue.ts#L25)); benefit: reuses the one built producer primitive.
  - **Option B — a sibling request type in the same queue namespace.** A distinct `ExplainRequest` written to `.minspec/queue` (or a `.minspec/queue/explain/` subdir), leaving `PhaseAdvanceRequest` untouched. Cost: a second file shape a consumer must recognise; benefit: no change to the phase-advance contract.
  - **Option C — route directly through the SPEC-014 FR-OQ2 channel** (chat-participant / dispatch command / prompt-file / DR-017 broker), with no queue involvement. Cost: depends entirely on FR-OQ2 being resolved; benefit: no queue contract at all if the chosen channel is synchronous.
  - *Trade-off:* this decision is **downstream of SPEC-014 FR-OQ2**, which is itself unresolved — so DQ-2 likely cannot be finalised until FR-OQ2 is. Plan should sequence accordingly and MUST NOT invent a seam FR-OQ2 has not chosen (FR-5).

- **DQ-3 — Does Explain need any DR of its own?** As scoped (read-only, reuse the one seam, reuse the one queue primitive) this is a *small addition* with **no irreversible choice** — it likely needs **no** DR (the DR-359 ADR filter: nothing here is un-undoable in <1 day). The one thing that *would* need a DR is DQ-2 Option A **if** widening `PhaseAdvanceRequest`'s contract is judged a public-ish, hard-to-reverse change; confirm at Plan whether the queue-contract change clears the ADR bar. *Recommendation to confirm:* no new DR; record the contract choice inside the owning spec.

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | Duplicate ownership: SPEC-056 + two host FR-18s describe the same control and drift apart. | DQ-1 forces an explicit owner choice; if A is kept, SPEC-056 owns *only* the contract/seam/degrade and cross-references (never restates) the host interaction FRs. |
| R2 | A second AI seam sneaks in for Explain (Tier-0 / boundary regression). | FR-5 / INV-4 bind Explain to the single host-resolved seam; AC-6 + AC-3 assert no new transport and no core network import. |
| R3 | The honest-degrade path is skipped and a fabricated "explanation" is shown when no consumer exists. | FR-6 / INV-3 mandate the SPEC-013 floor; AC-5 asserts the no-consumer render is distinguishable and never fabricated. |
| R4 | Widening the shipped `PhaseAdvanceRequest` contract (DQ-2 A) breaks the existing phase-advance producer/consumer. | DQ-2 offers a non-invasive sibling shape (B); if A is chosen, a contract test covers both request kinds and DQ-3 checks the ADR bar. |
| R5 | Explain is built before its hosts, producing a control with no toolbar to live in. | Dependency recorded (depends_on SPEC-014/SPEC-018 + the #732/#734/#735 consumer); Explain must not ship before them. |
| R6 | The feature drifts toward sanctioning rubber-stamping (a second Approve button / confidence slider). | INV-5 forbids it explicitly; the whole design is the read-only, non-approving counter to that pattern. |

## Out of Scope

- **Placement, hover reveal, chord, tooltip, and per-surface interaction detail** — owned by SPEC-014 FR-18 (document scope) and SPEC-018 FR-18 (section scope); this spec does not restate them normatively.
- **Building the DR-057 queue consumer / the explainer agent** — #732 / #734 / #735; this spec assumes it and degrades honestly without it (FR-6).
- **Resolving SPEC-014 FR-OQ2 (which AI channel)** — SPEC-014 owns that; DQ-2 is downstream of it.
- **The SPEC-018 FR-12/FR-16 chat channel itself, and the FR-11 revise/pen path** — Explain is a read-only preset *of* the chat channel, not a change to it.
- **The non-LLM comment/concern pin** (SPEC-014 FR-3) — a distinct affordance; Explain is a fourth, read-only affordance and does not fold it in.
- **Any glossary / delta-manifest / read-this comprehension feature** — adjacent, not duplicate (#672, #689, #185, #506, #468, #307).

## Traceability

- **Issue:** [#914](https://github.com/AIClarityAU/minspec/issues/914) — Explain (?) read-only one-click preset of the chat channel, in the reviewer toolbar + per-section hover toolbar.
- **Owning host FRs (already folded in):** [SPEC-014](../SPEC-014-review-webview/requirements.md) FR-18 (requirements.md:212-230); [SPEC-018](../SPEC-018-spec-custom-editor/requirements.md) FR-18 (requirements.md:257-283), AC-19 (:406), T0 row (:570).
- **Tier-0 boundary:** [DR-004](../../../docs/decisions/DR-004.md); enforced by the same invariant tests SPEC-014 FR-17 / SPEC-018 FR-8 assert.
- **Queue producer primitive:** `packages/minspec/src/lib/phase-advance-queue.ts:25-60` (`PhaseAdvanceSource`, `PhaseAdvanceRequest`, `enqueuePhaseAdvance`); [DR-057](../../../docs/decisions/DR-057.md) `.minspec/queue`.
- **Consumer (not built):** #732 / #734 / #735.
- **AI seam (unresolved):** SPEC-014 FR-OQ2; alternative [DR-017](../../../docs/decisions/DR-017.md) broker; alternative surface SPEC-016 reality-check (agent-execute, split to `AIClarityAU/sealbox`).
- **Approval gate / hash:** [DR-012](../../../docs/decisions/DR-012.md) — Explain must not touch it (INV-1).
- **Honest-degrade floor:** [SPEC-013](../SPEC-013-risk-section-policy/requirements.md).
- **Rubber-stamp rationale:** SPEC-014 R6 (approve-chain-fatigue → rubber-stamp); constitution *"avoid UX patterns that train the user into rubber-stamping"*.
- **Adjacent (not duplicate):** #672 (glossary), #689 (delta manifest), #185 (read-this eye-icon), #506 (report issue), #468 (explain-red-PRs), #307 (don't-trust-the-reviewer principle).
