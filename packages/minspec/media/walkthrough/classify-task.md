# Classify Your First Task

The **MinSpec: Classify Task Complexity** command helps you determine how much specification a task needs.

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

## How classification works

The classifier scores your task on several dimensions: files touched, cross-boundary impact, data changes, reversibility, and more. The total score maps to a tier.

**You always have the final say.** The classifier suggests — you decide. Override the tier any time.
