# MinSpec

> Just enough spec. Never too much.

<!-- badge: marketplace version -->
<!-- badge: installs -->
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why This Exists

Every specification-driven development tool applies the same ceremony to every change. A one-line bug fix gets the same multi-page spec treatment as a full architecture rewrite. Developers try SDD, hit the overhead on small changes, and abandon it.

MinSpec fixes this. It classifies each change by complexity and applies proportional ceremony -- a trivial fix needs one sentence of spec, while an architectural change gets a full design document. You get the discipline of specification-driven development without the bureaucracy.

## Quick Start

1. Install MinSpec from the VS Code Marketplace.
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run **MinSpec: Initialize SDD Structure** to scaffold your project.
4. Run **MinSpec: Classify Task Complexity** to classify your current changes.
5. Write your spec -- MinSpec tells you how much (or how little) you need.

<!-- screenshot: quick-start-flow -->

## Features

### Complexity Classifier

MinSpec analyzes your git diff and classifies each change into one of four tiers. The classifier examines file count, line count, new exports, schema changes, dependency additions, and more -- then recommends the right level of specification ceremony.

<!-- screenshot: classifier-result -->

### Adaptive Phase Lifecycle

Each spec moves through a lifecycle of phases: **Specify, Clarify, Plan, Tasks, Implement**. MinSpec skips phases that do not add value for the current tier. A T1 trivial change jumps straight from a one-liner spec to implementation. A T3 complex change goes through the full pipeline.

<!-- screenshot: phase-stepper -->

### Sidebar Tree View

All specs in your project appear in the Explorer sidebar, grouped by status (active, done, archived) with tier badges (T1-T4). Click any spec to open it. Right-click for actions like reclassification and phase transitions.

<!-- screenshot: sidebar-tree -->

### Active Spec Panel

A webview panel displays the current spec as a vertical stepper. Completed phases collapse. The active phase expands with its content. Tasks appear as an interactive checklist you can toggle directly.

<!-- screenshot: active-spec-panel -->

### Harness Generator

`MinSpec: Initialize SDD Structure` generates opinionated project harness files from Handlebars templates:

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Claude Code project instructions |
| `AGENTS.md` | Cross-tool agent instructions (Codex, Copilot) |
| `.cursorrules` | Cursor-specific rules |
| `DESIGN.md` | Design document template |
| `.minspec/constitution.md` | Project invariants and principles |

`MinSpec: Refresh Harness Files` merges template updates with your edits. Sections you modified are preserved. Unmodified sections get the latest template content. New template sections are appended.

### AI Tool Integration

MinSpec detects which AI coding tools you use and injects your active spec context into their configuration files. Supported tools:

| Tool | Config file |
|------|-------------|
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursorrules` |
| Cline | `.clinerules` |
| Aider | `.aider.conf.yml` |
| Windsurf | `.windsurfrules` |
| GitHub Copilot | `AGENTS.md` |

No AI tool is required. MinSpec works perfectly without any of them -- your specs are plain markdown files that any tool can read.

### Session Discipline

Declare your session scope before starting work. MinSpec monitors file saves and warns you when you drift outside scope. Drifted work can be parked as a GitHub Issue (via `gh` CLI) or saved to a local parking lot file for later triage.

### Status Bar

The status bar shows the active spec's tier, current phase, and task progress at a glance. Click it to open the active spec panel.

## Tier System

MinSpec classifies every change into one of four complexity tiers:

| Tier | Label | Ceremony | When |
|------|-------|----------|------|
| **T1** | Trivial | One-sentence spec, no planning | Single file, <50 lines, no new exports or schema changes |
| **T2** | Standard | Requirements list, lightweight plan | 2-5 files, <200 lines, no cross-boundary changes |
| **T3** | Complex | Full requirements, design doc, task DAG | 6+ files, new APIs, schema migrations, new dependencies |
| **T4** | Architectural | Full spec + ADR + stakeholder review | Cross-project impact, new services, breaking API changes |

The classifier suggests a tier. You always have the final say -- override any classification with a single click.

## Phase Lifecycle

Each spec follows a lifecycle adapted to its tier:

| Phase | T1 | T2 | T3 | T4 |
|-------|----|----|----|----|
| **Specify** | One-liner | Requirements list | Full requirements + acceptance criteria | Full + cross-system impact |
| **Clarify** | Skip | Optional | Required | Required + review |
| **Plan** | Skip | One sentence | Design document | Full design + ADR |
| **Tasks** | Auto single task | Task list | Task DAG with deps | DAG + milestone gates |
| **Implement** | Direct | Guided | Phase-gated | Phase-gated + checkpoints |

Skipped phases appear greyed-out in the panel with a label like "skipped (T1)." You can unskip any phase at any time.

## Configuration

All settings are under the `minspec.*` namespace in VS Code Settings.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `minspec.specsDir` | `string` | `"specs"` | Directory for spec files, relative to workspace root |
| `minspec.decisionsDir` | `string` | `"docs/decisions"` | Directory for Architecture Decision Records, relative to workspace root |
| `minspec.thresholds.t1Max` | `number` | `3` | Maximum complexity score for T1 (trivial) classification |
| `minspec.thresholds.t2Max` | `number` | `7` | Maximum complexity score for T2 (standard) classification |
| `minspec.thresholds.t3Max` | `number` | `14` | Maximum complexity score for T3 (medium) classification |

Tier thresholds are tunable per project. Scores above `t3Max` classify as T4 (architectural).

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "MinSpec" to see all commands:

| Command | Description |
|---------|-------------|
| **MinSpec: Initialize SDD Structure** | Create `.minspec/` directory, config, constitution, and harness files (CLAUDE.md, AGENTS.md, etc.) |
| **MinSpec: Refresh Harness Files** | Regenerate harness files from templates, preserving your edits via section-level merge |
| **MinSpec: Classify Task Complexity** | Analyze the current git diff and classify the change into a complexity tier (T1-T4) |
| **MinSpec: Show SDD Status** | Display a summary of all specs, their tiers, and current phases |
| **MinSpec: Refresh Spec Tree** | Manually refresh the sidebar spec tree view |
| **MinSpec: Declare Session Scope** | Set the scope for your current work session (enables drift detection) |
| **MinSpec: Park Topic** | Create a GitHub Issue (or local note) for an out-of-scope topic |
| **MinSpec: Inject Active Spec Context** | Write the active spec's context into detected AI tool config files |
| **MinSpec: Remove Active Spec Context** | Remove injected spec context from AI tool config files |
| **MinSpec: Show Active Spec Panel** | Open the webview panel displaying the current spec's phase stepper and task checklist |

## Spec File Format

Specs are plain markdown with YAML frontmatter. They are compatible with [Spec Kit](https://github.com/spec-kit/spec-kit) -- you can use both tools on the same project.

```markdown
---
id: SPEC-001
title: Add rate limiting to /api/health
tier: T2
status: implementing
created: 2026-05-26
phases:
  specify: done
  clarify: skipped
  plan: done
  tasks: done
  implement: in-progress
---

## Specify

Health endpoint needs rate limiting at 100 req/min per IP.

## Tasks

- [x] Add express-rate-limit middleware to health route
- [ ] Add 429 response test
```

MinSpec extends the Spec Kit format with optional frontmatter fields (`tier`, `status`, `phases`). Spec Kit ignores these fields, so interoperability is maintained in both directions.

## FAQ

### Does MinSpec require an AI coding tool?

No. MinSpec has zero AI dependencies. It works with any AI coding tool (Claude Code, Cursor, Copilot, Cline, Aider, Windsurf) but does not require any of them. Your specs are plain markdown files.

### Does MinSpec make network calls or require an account?

No. MinSpec operates entirely locally. There are no network calls, no accounts, no telemetry, and no backend. All data lives in your project directory.

### Can I use MinSpec with Spec Kit?

Yes. MinSpec reads and writes Spec Kit's markdown format. Files created by either tool work in both. MinSpec adds optional frontmatter fields that Spec Kit safely ignores.

### What happens if I uninstall MinSpec?

You keep everything. Specs are plain markdown. Harness files (CLAUDE.md, AGENTS.md, etc.) are standard files in your repo. The `.minspec/` directory contains JSON config you can read or delete. There is no lock-in.

### How does the classifier work?

The classifier is a deterministic, multi-signal heuristic engine -- not ML. It analyzes your git diff for file count, line count, new exports, schema changes, dependency additions, cross-directory changes, and more. Each signal contributes to a complexity score that maps to a tier. You can override any classification, and MinSpec learns from your overrides over time.

## Contributing

Contributions are welcome. See the [GitHub repository](https://github.com/harvest316/minspec) for issues and pull requests.

## License

MIT
