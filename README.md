# MinSpecPro

![status](https://img.shields.io/badge/status-early%20preview-orange)
[![version](https://img.shields.io/github/package-json/v/AIClarityAU/minspec?filename=packages%2Fminspec%2Fpackage.json&label=version)](packages/minspec/CHANGELOG.md)
[![release channel](https://img.shields.io/badge/release%20channel-Marketplace%20preview-blue)](https://marketplace.visualstudio.com/items?itemName=aiclarity.minspec)

> 🚧 **Early preview.** MinSpec's release channel is the VS Code Marketplace, as a preview: [`aiclarity.minspec`](https://marketplace.visualstudio.com/items?itemName=aiclarity.minspec). Each release is published by hand after it merges here, so the Marketplace listing, not this page, is the record of what you can install today; the [changelog](packages/minspec/CHANGELOG.md) says what each version contains. Open VSX is not a release channel yet, and the MinSpec Pro extension pack is not released. APIs, specs, and layout still change daily, and there are no stability guarantees.
>
> **ScroogeLLM is not in this repo.** Its source, spec, design, and research live in a separate private repository ([DR-027](docs/decisions/DR-027.md)). This monorepo hosts **MinSpec** (open), the shared classifier, and the extension-pack manifest.

Monorepo for the open **MinSpec** VS Code extension, the shared classifier engine, and the MinSpec Pro extension-pack manifest.

| Package | ID | Domain | Status |
|---|---|---|---|
| [`packages/minspec`](packages/minspec) | `aiclarity.minspec` | [minspec.dev](https://minspec.dev) | SDD Implement (pre-release) |
| [`packages/shared`](packages/shared) | `@aiclarity/shared` | — | Shared classifier |
| [`packages/extension-pack`](packages/extension-pack) | `aiclarity.minspec-pro` | — | Manifest only — refs ScroogeLLM by marketplace ID |

> **ScroogeLLM** (`aiclarity.scroogellm`, [scroogellm.com](https://scroogellm.com)) — developed in a private repo (see banner above). The pack references it by marketplace ID once published.

## What is this?

**MinSpec** — scope-adaptive spec-driven development. Classifies each change by its mechanical scope (blast radius — files touched, lines, cross-boundary spread) into a tier, then applies proportional ceremony. A tier measures *how far a change reaches*, not how hard it is to think through. One-file fix = one sentence of spec. Architecture rewrite = full treatment. The predicted tier is a *floor* (ceremony only ratchets up); you can always raise it. Works with zero AI tools installed.

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
```

### Releasing MinSpec

A release is published by a person, never by an agent ([DR-076](docs/decisions/DR-076.md)), and always from a packaged file. Run these from the repository root.

Before packaging, fetch the current threat catalogs the supply-chain scan compares against (this needs a signed-in `gh`). With none fetched the scan still passes, as an inventory only ([#2410](https://github.com/AIClarityAU/minspec/issues/2410), the gap that lets a release build skip the comparison), so check that the package step prints `0 findings against N catalog(s)`:

```bash
BUMBLEBEE_CATALOG_REF=main ./scripts/fetch-bumblebee-catalogs.sh
```

Step 1, package. This runs the supply-chain scan, then the build, then writes `packages/minspec/minspec-<version>.vsix`:

```bash
(cd packages/minspec && npm run package)
```

Step 2, publish that file. It needs a Marketplace token:

```bash
(cd packages/minspec && npx vsce publish --packagePath "minspec-$(node -p "require('./package.json').version").vsix")
```

Do not run `vsce publish` without `--packagePath`. On its own it runs neither the scan nor the build, and it packages whatever is already in `packages/minspec/out/` ([#2411](https://github.com/AIClarityAU/minspec/issues/2411), the publish path that skipped the gate).

Why a packaged file: the supply-chain decision ([DR-005](docs/decisions/DR-005.md)) requires that a compromised dependency blocks a release, and the gate that does it runs in `npm run package`, through the `prepackage` hook. DR-005 also lists a `prepublish` hook. vsce never ran it, so it gated nothing, and it has been removed from the manifest. Publishing the file that step 1 wrote is what keeps DR-005's requirement true. Bringing DR-005's own wording into line is tracked in [#2563](https://github.com/AIClarityAU/minspec/issues/2563).

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

All code is **MIT** — see [`LICENSE`](LICENSE). Prose is CC-BY-4.0. See [DR-083](docs/decisions/DR-083.md) for why, and [DR-018](docs/decisions/DR-018.md) for the multi-licence scheme it superseded.

| Path | License |
|---|---|
| `packages/shared` (contract types + canonical hashing) | **MIT** |
| `packages/minspec`, `packages/extension-pack`, `scripts/` | **MIT** |
| docs / site copy / whitepaper ([`LICENSE-CONTENT`](LICENSE-CONTENT)) | **CC-BY-4.0** |

Publisher: `aiclarity`.
