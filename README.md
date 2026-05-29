# MinSpecPro

Monorepo for two VS Code extensions plus an extension pack that bundles them.

| Package | ID | Domain | Status |
|---|---|---|---|
| [`packages/minspec`](packages/minspec) | `aiclarity.minspec` | [minspec.dev](https://minspec.dev) | SDD Implement |
| [`packages/scroogellm`](packages/scroogellm) | `aiclarity.scroogellm` | [scroogellm.com](https://scroogellm.com) | SDD Specify (future) |
| [`packages/shared`](packages/shared) | `@aiclarity/shared` | — | Shared classifier |
| [`packages/extension-pack`](packages/extension-pack) | `aiclarity.minspec-pro` | — | Bundles both |

## What is this?

**MinSpec** — complexity-adaptive spec-driven development. Classifies changes into tiers and applies proportional ceremony. One-line fix = one sentence of spec. Architecture rewrite = full treatment. Works with zero AI tools installed.

**ScroogeLLM** — LLM proxy that minimises token spend. Anonymises PII, caches aggressively, downgrades models when the task allows. Every token counts.

**MinSpec Pro** — extension pack referencing both. Unlocks spec-conformance checks that use ScroogeLLM as the inference layer.

## Invariants

Rules every change must preserve. See [CLAUDE.md](CLAUDE.md) for full list.

### MinSpec

1. No AI dependency — core path makes zero AI calls.
2. Tiered network consent ([DR-004](docs/decisions/DR-004.md)) — Tier 0 fully offline. No `http`/`fetch` in `packages/minspec` or `packages/shared`.
3. No lock-in — Spec Kit-compatible markdown, no proprietary format.
4. Ceremony proportional to complexity.
5. User override always wins — classifier suggests, human decides.
6. Harness regeneration preserves user edits (merge, not overwrite).

### ScroogeLLM

7. All LLM calls go through proxy.
8. Savings auditable — raw vs actual cost logged per request.
9. PII anonymisation deterministic.
10. User API keys in OS keychain only.
11. Proxy binds localhost by default.
12. Free-tier optimisations always active.

## Commands

```bash
npm test          # all packages
npm run lint
npm run build
npm run validate  # frontmatter check on specs/**/*.md

# Package one extension
cd packages/minspec && npm run package    # → .vsix

# Publish (requires vsce token)
cd packages/minspec && npx vsce publish
```

## Layout

```
specs/<product>/         SDD artifacts (requirements, design, tasks)
docs/decisions/DR-NNN.md Architectural decisions (see INDEX.md)
docs/research/           Background research
sites/minspec.dev/       Marketing site
sites/scroogellm.com/    Marketing site
packages/                Workspaces
scripts/hooks/           Pre-commit + dispatch
```

## Methodology

Spec-driven development. Three phases per product: **Specify → Plan → Implement**. MinSpec is at Implement. ScroogeLLM has not started Specify.

Bug fixes follow [**RCDD** — Root-Cause-Driven Debugging](docs/decisions/DR-003.md) — reproduce, diagnose, fix, harden. No code changes in phases 1–2.

All architectural decisions land in [docs/decisions/](docs/decisions/INDEX.md) as `DR-NNN.md`.

## License

MIT. Publisher: `aiclarity`.
