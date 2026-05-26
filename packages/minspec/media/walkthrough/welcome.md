# Welcome to MinSpec

MinSpec brings **Specification-Driven Development (SDD)** to VS Code — just enough spec, never too much.

## What is SDD?

SDD means you write a lightweight specification *before* you code. Not a 50-page design doc — just enough structure to match the complexity of your task.

MinSpec classifies every task into one of four tiers:

| Tier | Complexity | What you write |
|------|-----------|----------------|
| **T1** | Trivial (rename, typo fix) | One sentence of intent |
| **T2** | Small (add endpoint, UI tweak) | Specify + Plan |
| **T3** | Medium (new feature, refactor) | Full spec with tasks |
| **T4** | Large (new subsystem, migration) | All phases including clarification |

The key insight: **ceremony is proportional to complexity.** A one-line fix doesn't need a design doc. A new subsystem does.

## How it works

1. You classify your task's complexity
2. MinSpec tells you which phases to complete
3. You write just enough spec for that tier
4. You implement with confidence

No AI required. No accounts. No network calls. Just markdown files and good engineering practice.
