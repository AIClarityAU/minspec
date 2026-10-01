# Welcome to MinSpec

MinSpec isn't a feature tour — it's a change in **how you work**. The next five steps set
expectations for that change before you touch a single command.

## The shift: spec before code, always

Every task — even a one-line typo fix — starts with a spec, not code. Not a 50-page design
doc: just enough structure to match the complexity of what you're doing. The size of "just
enough" is the whole idea.

MinSpec classifies every task into one of four tiers:

| Tier | Complexity | What you write |
|------|-----------|----------------|
| **T1** | Trivial (rename, typo fix) | One sentence of intent |
| **T2** | Small (add endpoint, UI tweak) | Specify + Plan |
| **T3** | Medium (new feature, refactor) | Full spec with tasks |
| **T4** | Large (new subsystem, migration) | All phases including clarification |

**Ceremony is proportional to complexity** — this is not "click Classify and move on." It's
the rule that decides how much you write for *every* task from here on: a one-line fix gets
one sentence, a new subsystem gets the full cycle. You'll feel the difference on day one —
a two-minute fix stays a two-minute fix.

## What you do vs. what the tool does

Content and verification swap roles from what you're used to. The classifier, the spec
scaffolding, AI-assisted drafts — that's content, and a tool (or an AI tool you bring) can
produce a first draft of it. Your job shifts to **verifying the signal**, not authoring the
prose: does this tier match the actual blast radius? Does this spec say what you meant? A
suggestion isn't a decision until you've looked at it — that's the *just-enough-human*
principle: the least human attention that still keeps every decision honest, never zero.

## One next task, never a backlog

MinSpec's status bar and sidebar don't show you a queue to triage. They surface **one
deterministic next human task** at a time — the single thing blocking progress right now.
No prioritization meeting, no backlog grooming. Finish that one thing and the next one
appears.

## What feels different, day one

- You write a spec sentence *before* opening the file you're about to change — even for a
  trivial fix.
- Validation is **never-wrong**: MinSpec tells you what it verified and what it didn't. It
  never reports "done" on a hunch, and neither should you.
- "I classified this T2" is a claim you can check, not a vibe — the classifier shows its
  reasoning.

## How it works

1. You classify your task's complexity (or accept the suggestion)
2. MinSpec tells you which phases that tier requires
3. You write just enough spec for that tier
4. You implement, and the tool verifies rather than assumes

No AI required. No accounts. No network calls. Just markdown files and a working method.
