# MinSpec Monorepo — Claude Instructions

## Project Overview

Monorepo for two VS Code extensions + extension pack:

| Package | ID | Domain | Status |
|---|---|---|---|
| `packages/minspec` | `aiclarity.minspec` | minspec.dev | SDD Implement phase |
| `packages/scroogellm` | `aiclarity.scroogellm` | scroogellm.com | SDD Specify (future) |
| `packages/shared` | `@aiclarity/shared` | — | Shared classifier |
| `packages/extension-pack` | `aiclarity.minspec-pro` | — | References both |

## Session Scope Protocol

Declare at session start:
```
Session scope: [one sentence]
Project: minspec / scroogellm / shared / infra
Type: bug / feat / explore / plan
```

### Triage Rules

0. **Root cause before fix.** Never rush into fixing an issue. Always identify root cause first — even for off-topic issues that get parked. Park ≠ skip the diagnosis.
1. **Topic drift → GitHub issue, do not act.** File on the relevant repo with `inbox` label, report URL, continue original scope.
2. **Scope-expansion triggers.** When the in-scope request contains any of these verbs, confirm before implementing — they almost always hide new scope:
   - "integrate with X" (≠ "detect X")
   - "also support X" / "include X too"
   - "expand to X" / "extend to X"
   - "and X" tacked on as a follow-up to an already-defined scope
   - "make it work with X" where X is a system not previously named
   Default action: confirm with user OR park as separate issue. Do NOT silently expand.
3. **Detection ≠ integration.** Reading a signal (filesystem existence, extension presence) is small. Acting on it (custom commands, exports, bidirectional sync) is a new feature surface. Treat them as separate work items.

## Invariants

These rules must never be violated. All changes must preserve them.

### MinSpec (from specs/minspec/requirements.md)

1. **No AI dependency** — works with zero AI tools installed. No AI calls in core path.
2. **Tiered network consent (DR-004)** — Tier 0 (core): zero network calls, fully offline. Tier 1 (opt-in): delegates to local CLI tools (`gh`, `claude`), no network code in extension. Tier 2 (MinSpec Pro): network services with explicit consent. No `http`/`https`/`fetch` imports in `packages/minspec` or `packages/shared`.
3. **No lock-in** — spec files are Spec Kit-compatible markdown. No proprietary format.
4. **Ceremony proportional to complexity** — T1 task never requires >1 sentence of spec.
5. **User override always wins** — classifier suggests, human decides. No forced classification.
6. **Harness file regeneration preserves user edits** — regenerate = merge, not overwrite.

### ScroogeLLM (from market research + design intent)

7. **All LLM calls through proxy** — no direct API access bypasses middleware chain.
8. **Savings auditable** — raw vs actual cost logged per request, inspectable by user.
9. **PII anonymization deterministic** — same input → same fake name, stable across session.
10. **User API keys in OS keychain only** — never stored in plaintext, never transmitted.
11. **Proxy binds localhost by default** — no remote exposure without explicit user opt-in.
12. **Free tier optimizations always active** — downgrades don't disable free optimizations.

## SDD Phases (current state)

MinSpec is at **Implement** phase. Work from `specs/minspec/tasks.md`.

ScroogeLLM has not started Specify phase. Future sessions only.

## File Locations

| Artifact | Location |
|---|---|
| Specs | `specs/<product>/*.md` |
| Decisions | `docs/decisions/DR-NNN.md` |
| Research | `docs/research/` |
| Websites | `sites/minspec.dev/`, `sites/scroogellm.com/` |
| Hooks | `scripts/hooks/` |

## Traceability Convention

Commits, issues, and DRs form a linked chain:

- **Commits** reference issue: `feat(#N): description` or `fix(#N): description`
- **DRs** reference triggering issue: `Triggered by: #N` in body
- **Issues** reference DR if one exists: link in issue body
- **Sub-issues** reference parent DR: `See DR-NNN for design rationale`

Purpose: Issues = what needs doing. DRs = why we chose this approach. Commits = what changed. Don't consolidate — link.

## Agent Dispatch (Tier-Gated HITL)

Triage agent auto-dispatches T1-T2 issues (`agent-ready`). T3-T4 get `needs-review` — human approves spec/plan before agent starts. Per SDD FR-2: Clarify phase required for T3-T4.

Roles: `scripts/roles/` — triage, dev, architect, security, reviewer.
Dispatch: `scripts/dispatch-issue.sh <N>` — reads `role:X` label, loads role prompt.
Triage: `scripts/triage-inbox.sh [N]` — processes inbox issues.

## Deploy Reference

VS Code extensions do not auto-deploy. Manual steps:

```bash
# Package an extension
cd packages/minspec && npm run package   # produces .vsix

# Publish (when ready — requires vsce token)
cd packages/minspec && npx vsce publish
```

## Test Commands

```bash
npm test              # all packages
npm run lint          # all packages
npm run build         # all packages
npm run validate      # frontmatter validation
```

## Pre-Commit Checks

1. No secrets (API keys, tokens, high-entropy strings)
2. `specs/**/*.md` must have `id: SPEC-NNN` frontmatter

## Decision Register

All architectural decisions → `docs/decisions/DR-NNN.md`. See `docs/decisions/INDEX.md`.

## Repo Mapping (Parking Lot)

| Topic | GitHub repo |
|---|---|
| MinSpec extension / SDD tool | `harvest316/minspec` |
| ScroogeLLM extension / proxy | `harvest316/minspec` (same monorepo) |
| Shared infra / cross-project | `harvest316/mmo-platform` |
