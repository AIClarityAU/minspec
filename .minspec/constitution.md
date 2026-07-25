# minspec-monorepo — Constitution

## Invariants

- Core functionality works offline — no network calls without explicit user consent
- No silent gate — a required or merge-gating check fails visibly, never best-effort: no load-bearing gate signal is written with a swallowed error (`|| true`), a missing or errored witness fails the gate closed and visibly (never silently passes or stops evaluating), and no required check hinges on a single producer that one permission/config gap can disable (provide an independent second witness). (DR-066; instances #560/#810/#857.)

## Principles

- Just enough human
- Avoid UX patterns that train user into rubber-stamping
- User is always open to a better way - Push-back is welcome
- Avoid nagging
- Specs are living documents, not bureaucracy
- Record hard-to-reverse decisions as decision records before implementing
- **Conform to Spec Kit conventions by default.** Mirror Spec Kit's artifact names, folders, and command surface so a Spec-Kit user transitions with near-zero relearning. Diverge only where a recorded decision says our model requires it — deterministic write-time enforcement (G-7), `SPEC-NNN` ids (DR-027), the `.minspec` store, the never-wrong signpost (DR-055 §3). Familiar surface, stronger engine.
- Don't hope an LLM will follow rules - enforce it via code

## Constraints

- @aiclarity/shared stays vscode/network-free (Tier-0) — no editor or network imports.
- Cross-package changes must respect workspace boundaries; no deep reach into another package’s internals.
- Keep extension activation cheap and side-effect-free; do not block the editor on init.

## Goals

Ranked project goals. **Order = importance** (lower number = higher priority). Each goal
has a **stable ID** (`G-N`) that artifacts reference via `goal: G-N` frontmatter (like
`epic:`, DR-013). The next-task resolver reads `goal-rank` as a deterministic tie-break
within a severity class — never an LLM judgement (DR-039, DR-019).

1. **G-1 — AI-slop guardrails (ensure correctness).** Write-time enforcement that
   AI-assisted code is correct and specified, not vibe-coded slop. The lead benefit.
2. **G-2 — Prevent tech debt.** Avoid the 333Method failure mode — debt accreted through
   rework and scope creep (~3 days bugfixing per 1 day of new function). Rebuild-not-patch;
   guard scope.
3. **G-3 — Just enough human.** The human brain is the bottleneck — automate everything
   else. The LLM does the thorough thinking; the human verifies signal, not content.
4. **G-4 — Opinionated / signpost.** Always tell the human the one thing to review next,
   and park off-topic ideas instead of acting on them. Never a list, never wrong.
5. **G-5 — Top of funnel into Scrooge.** MinSpec is the acquisition surface that feeds
   ScroogeLLM — the money maker.
6. **G-6 — Determinism as moat.** The same rule fires across editor, commit, CI, and
   agent — reproducible, testable, auditable (Tier-0, DR-004 / DR-014).
7. **G-7 — Editor-native SDD / CDD / WSJF.** Methodology enforced *in the editor at write
   time*, not bolted on as a separate CLI or IDE (the differentiator vs spec-kit / Kiro).
8. **G-8 — Git transparency (hide VCS complexity).** MinSpec handles git *for* the
   developer. The primary checkout stays **clean, on `main`, synced with origin, and
   holding the latest docs** at (almost) all times — the only expected diff is what the
   dev directly modified. A non-git-literate dev never has to understand or resolve
   branches, rebases, stranded approvals, or push rejections: MinSpec routes approvals to
   origin, and syncs / reconciles the checkout transparently. This must remain fully
   **interoperable** — the same repo is safe for git-literate teammates working with
   normal git at the same time (no bespoke VCS, no rewriting shared history). Tracked:
   [#880](https://github.com/AIClarityAU/minspec/issues/880) (approvals stop stranding),
   [#888](https://github.com/AIClarityAU/minspec/issues/888) (autonomous sync/merge loop),
   [#890](https://github.com/AIClarityAU/minspec/issues/890) (harness-refresh consistency).

## Phases

MinSpec ships in **two phases**. Phase 1 is the gate that unblocks every dependent
project; Phase 2 is public polish. **Phase-1 work always outranks Phase-2 work** until
the Phase-1 line below is met — a priority signal for the next-task resolver (G-4),
not a soft preference.

MinSpec is a **hard dependency** of every other project (ColdForge, LeadForge, coldforge, …):
treat an unmet Phase-1 item as a cross-project blocker, not local backlog.

### Phase 1 — Dogfood-ready (the blocker line)

MinSpec stops being a blocker to dependent projects when a dependent repo can go from
`git init` to its **first implemented vertical slice** using *only* MinSpec Command-Palette
commands — no hand-editing of `.minspec/` state, no working around a missing phase command,
and every gate firing deterministically.

Done = all true:

- [ ] **Init + harness** scaffolds a fresh repo (`.minspec/`, CLAUDE.md, hooks).
- [ ] **Classify** assigns T1–T4 on a real change.
- [ ] **Phase commands** — specify → plan → tasks → implement — each produce *and* validate
      their artifacts.
- [ ] **Gates are deterministic + symmetric**: editor, commit, and CI agree, and the
      validator rejects *missing* and *invalid* values, not just dangling refs (closes the
      asymmetry class — #137).
- [ ] **Signpost never lies**: the resolver surfaces the one next human task and the wiring
      is live (SPEC-012, #288).
- [ ] **Approvals + status foundation** has committed ground truth so signpost/status cannot
      go stale (#95 shared+attributed approvals, #116 deterministic status).

This realises **G-1, G-2, G-3, G-4, G-6, G-7** at solo-dogfood strength. Explicitly **out of
Phase 1**: Marketplace publish, public onboarding, the ScroogeLLM funnel (G-5) beyond a stub,
agent-execute (DR-015), team/CI dispatch, DAG-viz polish, and marketing / site copy.

### Phase 2 — Public-ready (polish)

Everything deferred above: Marketplace listing + onboarding, the Scrooge funnel (G-5),
broader model / UX polish, team mode. May be polished incrementally **as long as no Phase-2
item displaces an unmet Phase-1 item**.

## Glossary

Canonical terms. Use these in UI labels, prose, and code.

| Term | Definition |
|---|---|
| **Approvable** | Any artifact that carries a human approval gate before work may proceed: Spec, DR, PR, Epic, or Issue. The set surfaces in the signpost as "Pending Approvables." Type alias: `type Approvable` in `packages/shared/src/contracts/`. Distinct from `approvals.json`, which is the *store* of approval hashes. (DR-041) |
