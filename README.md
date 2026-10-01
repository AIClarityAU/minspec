# MinSpecPro

![status](https://img.shields.io/badge/status-under%20construction-orange)
![release](https://img.shields.io/badge/release-none%20yet-lightgrey)
![marketplace](https://img.shields.io/badge/marketplace-not%20published-red)

> 🚧 **Under construction — pre-release.** APIs, specs, and layout change daily; nothing here is published to the VS Code Marketplace or Open VSX, and there are no stability guarantees. Star/watch to follow along — don't depend on it yet.
>
> **ScroogeLLM is not a live product.** Its source, spec, design, and research live in a separate private repository ([DR-027](docs/decisions/DR-027.md)), and it has since been shelved as a product there (scrooge DR-021) — only its measurement instruments (tee-proxy, shadow classifier) stay in use. This monorepo hosts **MinSpec** (open), the shared package, and the `packages/extension-pack` manifest, which is currently blocked on that shelving (see table below).

Monorepo for the open **MinSpec** VS Code extension and its shared package.

| Package | ID | Domain | Status |
|---|---|---|---|
| [`packages/minspec`](packages/minspec) | `aiclarity.minspec` | [minspec.dev](https://minspec.dev) | SDD Implement (pre-release) |
| [`packages/shared`](packages/shared) | `@aiclarity/shared` | — | Tier-0 contract types; classifier engine still lives in `packages/minspec` (DR-014 move here is `proposed`, not executed — #54) |
| [`packages/extension-pack`](packages/extension-pack) | `aiclarity.minspec-pro` | — | Manifest only; packaging blocked — it references `aiclarity.scroogellm`, which won't ship (shelved, scrooge DR-021) |

## What is this?

**MinSpec** — scope-adaptive spec-driven development. Classifies each change by its mechanical scope (blast radius — files touched, lines, cross-boundary spread) into a tier, then applies proportional ceremony. A tier measures *how far a change reaches*, not how hard it is to think through. One-file fix = one sentence of spec. Architecture rewrite = full treatment. The predicted tier is a *floor* (ceremony only ratchets up); you can always raise it. Works with zero AI tools installed.

**ScroogeLLM** — shelved as a product (scrooge DR-021); lives in its own private repo ([DR-027](docs/decisions/DR-027.md)) and is no longer part of this monorepo's roadmap.

## Invariants

Rules every change must preserve. See [CLAUDE.md](CLAUDE.md) for full list.

1. No AI dependency — core path makes zero AI calls.
2. Tiered network consent ([DR-004](docs/decisions/DR-004.md)) — Tier 0 fully offline. No `http`/`fetch` in `packages/minspec` or `packages/shared`.
3. No lock-in — Spec Kit-compatible markdown, no proprietary format.
4. Ceremony proportional to complexity.
5. User override always wins — classifier suggests, human decides.
6. Harness regeneration preserves user edits (merge, not overwrite).

ScroogeLLM's own invariants (proxy, PII, keychain, localhost-binding) live in its
own repo now that it has been split out and shelved — see [DR-027](docs/decisions/DR-027.md).

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
packages/                Workspaces
scripts/hooks/           Pre-commit + dispatch
```

## Methodology

Spec-driven development. Three phases per product: **Specify → Plan → Implement**. MinSpec is at Implement. ScroogeLLM is shelved as a product (scrooge DR-021) and has no active Specify/Plan/Implement cycle here or in its own repo.

Bug fixes follow [**RCDD** — Root-Cause-Driven Debugging](docs/decisions/DR-003.md) — reproduce, diagnose, fix, harden. No code changes in phases 1–2.

All architectural decisions land in [docs/decisions/](docs/decisions/INDEX.md) as `DR-NNN.md`.

## License

All code is **MIT** — see [`LICENSE`](LICENSE). Prose is CC-BY-4.0. See [DR-083](docs/decisions/DR-083.md) for why, and [DR-018](docs/decisions/DR-018.md) for the multi-licence scheme it superseded.

| Path | License |
|---|---|
| `packages/shared` (contract types + canonical hashing) | **MIT** |
| `packages/minspec`, `packages/extension-pack`, `scripts/` | **MIT** |
| docs / site copy / whitepaper ([`LICENSE-CONTENT`](LICENSE-CONTENT)) | **CC-BY-4.0** |

Publisher: `aiclarity`.
