---
description: Author or update .minspec/constitution.md — invariants, principles, constraints, goals
---

<!-- >>> minspec:managed:slash-claude-constitution >>> -->
# /minspec-constitution — MinSpec Constitution Phase

Run the **Constitution** phase — author or refine `.minspec/constitution.md`, the project's durable rule set (Spec Kit's `constitution` command).

The constitution has four sections, in this order: **Invariants** (hard rules that must never be violated), **Principles** (guidelines that should hold, bendable with justification), **Constraints** (technical/business bounds on the solution space), **Goals** (outcomes the project is trying to achieve).

Read the existing file first. Never overwrite or delete a human-authored (non-DRAFT) entry — only add missing ones or refine wording in place.

Silence beats noise: propose only entries you are confident the project actually implies from its code, docs, and `docs/decisions/` — a thin, accurate constitution beats a padded one. When in doubt, leave it out rather than guess.

Mark any entry you are not fully certain of with a leading `DRAFT:` for human review, instead of asserting it outright — the same convention the deterministic "MinSpec: Propose Constitution Draft" seed uses, so mixed human/DRAFT content stays legible either way. Once reviewed, "MinSpec: Compact Constitution" strips the DRAFT markers.

`CLAUDE.md` / `AGENTS.md` / `.cursorrules` summarize this file's lead sentences into their own Invariants sections — write each entry so its first sentence stands alone. Arguments: $ARGUMENTS
<!-- <<< minspec:managed:slash-claude-constitution <<< -->
