# Classify Your First Task

The **MinSpec: Classify Task Complexity** command is where the ways-of-working shift becomes
concrete. This isn't "pick a tier and move on" — it's the decision that sets how much you
write for everything that follows.

## The tier system

MinSpec uses four tiers based on complexity signals:

### T1 — Trivial
*Examples: fix typo, rename variable, update config value*

- One sentence of intent is enough
- Only the **Specify** phase is required
- Just document what you're doing and do it

### T2 — Small
*Examples: add API endpoint, fix a bug, UI adjustment*

- **Specify** + **Plan** phases required
- Write what you're building and how you'll approach it
- Clarify phase is optional if requirements are clear

### T3 — Medium
*Examples: new feature, significant refactor, integration*

- **Specify**, **Plan**, **Tasks**, **Implement** phases required
- Break the work into concrete tasks
- Consider edge cases and testing approach

### T4 — Large
*Examples: new subsystem, data migration, architecture change*

- All five phases required, including **Clarify**
- Identify unknowns and resolve them before coding
- Write an Architecture Decision Record (ADR)

## Suggest, don't author — the classifier's actual job

The classifier scores your task on several dimensions: files touched, cross-boundary impact,
data changes, reversibility, and more. The total score maps to a tier. That score is content
— a draft, produced deterministically instead of by an LLM, but still a draft.

**You always have the final say.** This is the verify-signal-not-content reversal in
practice: the classifier's job is to produce a defensible starting tier, and your job is to
check it against what you actually know about the blast radius — not to write the score
yourself. Override the tier any time; disagreeing with the suggestion is the expected use of
this command, not an edge case.

## Why this matters beyond this one task

The tier you pick here isn't a one-off checkbox — it's the ceremony contract for the rest of
the task. Every later step (what phases the sidebar tracks, what the signpost asks you to do
next) reads from this classification. Get it right once, and the rest of the workflow follows
without you re-deciding it at every step.
