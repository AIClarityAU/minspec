# Optional companion tools

MinSpec recommends, never requires. Everything below is **optional**, installed and consented to by you, and MinSpec makes no network call and takes no dependency on any of it (Tier-0 core unchanged; [DR-054](decisions/DR-054.md) network posture, [DR-050](decisions/DR-050.md) consented CLI). Detection is not integration: MinSpec does not detect, configure, or call these tools.

## Recommended

### CodeGraph (MCP)

Structural code intelligence for your AI assistant: callers, impact, and blast radius of a change. It is the code-side provider of "see the repercussions before you change", and the external complement to the in-repo deterministic graph of [DR-056](decisions/DR-056.md). Install it yourself in your assistant's MCP settings if you want it; MinSpec works identically without it.

## Considered and not recommended

- **A GitHub MCP.** The consented `gh` CLI shell-out ([DR-050](decisions/DR-050.md)) already covers it; an MCP would duplicate.
- **Playwright MCP.** Crashes in the project's reference environment (crashpad SIGTRAP); the project uses a `playwright-core` workaround instead.
- **Vector-memory / semantic-recall MCP.** Conflicts with [DR-056](decisions/DR-056.md): probabilistic signal stays out of the decision path, and the spec corpus plus the DR register are already the durable knowledge.
