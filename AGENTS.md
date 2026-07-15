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

## Task Classification Guide

Before starting work, classify the task by its **mechanical scope** (blast radius), not by how hard it is to think through:

- **T1 (Contained):** Single file, one-line fix, typo, config change. One sentence of spec is enough.
- **T2 (Standard):** A few files, contained feature, no cross-boundary changes. Needs spec + plan.
- **T3 (Wide):** Many files, new APIs, schema/dependency changes. Full spec cycle.
- **T4 (Architectural):** Cross-project impact, new services, breaking changes. Complete ceremony required.

The classifier sees scope, not difficulty. A subtle one-line fix and a trivial one are the same size — so the predicted tier is a **floor**: raise it when a change is harder than its footprint, never lower it below the prediction.

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
