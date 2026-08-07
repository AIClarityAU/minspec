# minspec-monorepo — Agent Instructions

## For AI Coding Assistants

This project uses MinSpec SDD (Specification-Driven Development). Before implementing any change:

1. **Check scope** — How far does this change reach (files, lines, boundaries)? That sets the tier — not how hard the change feels.
2. **Read the spec** — Check `specs/` for existing specs related to your task.
3. **Follow the tier** — Don't over-specify small-scope tasks. Don't under-specify wide-scope ones. The predicted tier is a floor: raise it (never lower it) if a small change is subtler than its footprint.

## Specs Directory

All specifications live in `specs/`. Each spec file uses Spec Kit-compatible markdown with YAML frontmatter.

## Decision Records

Architecture decisions are documented in `docs/decisions/`. Check existing decisions before proposing conflicting approaches.

## Constitution

Project invariants, principles, and constraints are in `.minspec/constitution.md`. These rules must never be violated.

### Key Invariants

> Summarized from `.minspec/constitution.md` — lead sentences only; the full text and rationale live there.

- Core functionality works offline — no network calls without explicit user consent
- No silent gate — a required or merge-gating check fails visibly, never best-effort: no load-bearing gate signal is written with a swallowed error (`|| true`), a missing or errored witness fails the gate closed and visibly (never silently passes or stops evaluating), and no required check hinges on a single producer that one permission/config gap can disable (provide an independent second witness).
- MinSpec's blast radius is the project it is installed in — nothing MinSpec ships (extension write, harness file, hook, CI workflow, convention, or prose rule) may change behaviour in a repo, org, or machine-wide config that did not opt in, and the opt-in marker is `.minspec/` at the repo root.

## Task Classification Guide

Before starting work, classify the task by its **mechanical scope** (blast radius), not by how hard it is to think through:

- **T1 (Contained):** Single file, one-line fix, typo, config change. One sentence of spec is enough.
- **T2 (Standard):** A few files, contained feature, no cross-boundary changes. Needs spec + plan.
- **T3 (Wide):** Many files, new APIs, schema/dependency changes. Full spec cycle.
- **T4 (Architectural):** Cross-project impact, new services, breaking changes. Complete ceremony required.

The classifier sees scope, not difficulty. A subtle one-line fix and a trivial one are the same size — so the predicted tier is a **floor**: raise it when a change is harder than its footprint, never lower it below the prediction.

## Naming waves, phases, and batches

Never refer to a group of work by a bare number.

- **Name what you coin.** A wave, batch, or group you invent gets a descriptive name ("the mechanical-bugfix wave"), never "Wave 1".
- **Gloss what is predefined.** When an identifier is fixed and numeric (`Phase 2`, `Slice 3`, `T3`), append a short reminder of what it covers the first time it appears in any response, doc, issue, PR, or commit — e.g. "Phase 2 (Public-ready — polish)".

A bare number makes the reader stop and look it up; a two-word gloss costs nothing.

## Human action items — mark them, then repeat them

Anything waiting on the human — a decision, a credential, a manual step, a merge — is invisible unless it is marked. One marker, two places.

- **Inline, the moment it arises.** Prefix the line with ➡️ mid-turn, where the need appears; never hold it back for the end.
- **Again at the end of every turn.** Close the response with a `**Your turn**` block repeating every still-pending item, one ➡️ line each. Nothing pending → omit the block; an empty one teaches the reader to skip it.
- **The heading carries no ➡️.** Only action items do, so the number of arrows equals the number of things waiting on the human — countable at a glance, with no off-by-one from the title.
- **Reserve ➡️ for this.** Never decorate ordinary prose with it, so scanning for ➡️ never returns a false hit.
- **Give each item a reply key.** One or two characters, restated on the line every turn so the human never scrolls back to find one: `m` merge · `c` close · `d` diff/details · `r` re-review · `s` skip.
- **Every choice carries a recommendation and its cost.** When an item asks the human to *decide*, name the option you recommend and, in the same breath, the primary downside or risk of the option you are recommending. A menu with no recommendation hands the analysis back to the human; a recommendation with no stated cost is advocacy, not advice. Mark it `(rec)` on the option and follow with one clause naming what it costs. This applies wherever a decision is put to a human — the `**Your turn**` block **and** the body of any issue, PR, or DR that asks them to choose.

The same block lists every pull request this session opened that is still unmerged — clickable URL, the gate state already observed this turn, and its keys:

```
**Your turn**
➡️ [#1231 dispatch env scrub](https://github.com/OWNER/REPO/pull/1231) — ai-review:pass · needs-review — `m` merge · `c` close · `d` diff
➡️ Name the new hook — `a` agent-context **(rec)**, matches the existing `agent-` prefix but reads oddly for session-scoped state · `b` session-context
```

Report the state you already observed; re-reading it from the git host is ordinary tool use, never a requirement, and MinSpec itself makes no network call.

## Rules

1. Never skip the spec phase, even for T1.
2. User override always wins — if the human says "just do it," do it. The predicted tier only ratchets up, never auto-down.
3. Ceremony must be proportional to scope — don't over-engineer small-scope tasks.

## Project Identity

- Repo: `AIClarityAU/minspec`
- Publisher: `aiclarity`
- `packages/minspec` extension in this repo; ScroogeLLM split out to `AIClarityAU/scroogellm` (DR-027)
- Shared code in `packages/shared`

## Invariants (Non-Negotiable)

Before making ANY change, verify these will still hold:

1. MinSpec makes zero network calls in its core path
2. MinSpec spec files remain Spec Kit-compatible markdown
3. ScroogeLLM never stores API keys in plaintext
4. ScroogeLLM proxy binds localhost by default
5. No new npm dependencies without explicit justification (budget: 0-1 per simple change)

## Task Intake Format

Every agent task issue must include:
```
## Contract
<TypeScript interface the output must satisfy>

## Tests to pass
<file path(s) with invariant + feature tests>

## File allowlist
<explicit list of files agent may modify>

## Invariants
<numbered list from above that this task touches>
```

## Escalation Protocol

If you cannot fully and correctly complete a task — due to complexity, missing context, or uncertainty — output exactly:

```
ESCALATE: <one-line reason>
```

Then stop. Do not produce partial/stub output.

## File Structure Reference

```
specs/minspec/          SDD specs for MinSpec (requirements, design, tasks)
specs/scroogellm/       SDD specs for ScroogeLLM (not yet started)
docs/decisions/         DR-NNN.md decision register
docs/domain/            Bounded context knowledge docs
docs/research/          Market research
packages/minspec/       VS Code extension A
packages/scroogellm/    VS Code extension B
packages/shared/        Planned shared code (scaffold only — classifier currently in packages/minspec/src/lib/)
packages/extension-pack/MinSpec Pro
scripts/hooks/          Claude Code session hooks
```

## Current Work

MinSpec is in SDD Implement phase. Work from `specs/minspec/tasks.md`.

All nine implementation phases (Foundation through Polish & Launch) are complete. Remaining work is post-launch ScroogeLLM bridge integration (Phase 10).

## Testing

```bash
npm test              # all packages via vitest
npm run validate      # frontmatter validation
```

New code must have:
- T0 invariant tests for any change touching the 12 invariants
- T2 feature tests (happy path + primary failure) for new features

## Do Not

- Add network calls to `packages/minspec` core path
- Store secrets in any tracked file
- Modify files outside the task's file allowlist
- Skip tests for invariant-touching changes
- Add task checklists (`- [ ]`) to `docs/domain/` files

<!-- minspec:slash-commands:start -->

## Spec Kit Slash Commands

Generic agents can invoke the following commands. Each routes to a MinSpec SDD phase against the active spec.

| Command | Phase | Purpose |
|---|---|---|
| `/minspec-constitution` | Constitution | Author or update .minspec/constitution.md — invariants, principles, constraints, goals |
| `/minspec-specify` | Specify | Start or update the Specify phase for the active MinSpec spec |
| `/minspec-clarify` | Clarify | Resolve open questions before planning |
| `/minspec-plan` | Plan | Draft the technical approach for the active spec |
| `/minspec-tasks` | Tasks | Break the plan into ordered, checkable tasks |
| `/minspec-analyze` | Analyze | Cross-check spec, plan, and tasks for consistency |
| `/minspec-implement` | Implement | Execute the task list against the active spec |
| `/minspec-checklist` | Checklist | Generate a requirements-quality checklist for the active spec |

Full per-command instructions live in `.claude/commands/*.md` (Claude Code) and `.cursor/rules/spec-kit-commands.mdc` (Cursor) when those tools are detected.

<!-- minspec:slash-commands:end -->
