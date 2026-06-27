/**
 * Template registry — Handlebars template strings bundled as constants.
 * This avoids esbuild file-loader complexity for .hbs files.
 */

import {
  parseSections,
  buildSectionHashes,
  type GeneratedHashes,
  type SectionHashes,
} from './merge-refresh';

/**
 * Template names that can be rendered.
 *
 * NOTE — `DESIGN.md` is intentionally absent (#206). It is NOT a harness
 * template: a split-layout `design.md` is a T3+ **Plan-phase** artifact, created
 * when planning starts, not at init. Scaffolding an empty `DESIGN.md` stub at
 * init produced a doc the project's own gap-audit (#205) would flag, and — being
 * a managed template — refresh resurrected it after deletion. Never re-add it
 * here; both `generateHarnessFiles` and `refreshHarnessFiles` loop over
 * `TEMPLATE_NAMES`, so membership is exactly "scaffolded + refresh-managed".
 */
export type TemplateName = 'CLAUDE.md' | 'AGENTS.md' | '.cursorrules' | 'constitution.md';

/** All template names in generation order */
export const TEMPLATE_NAMES: readonly TemplateName[] = [
  'CLAUDE.md',
  'AGENTS.md',
  '.cursorrules',
  'constitution.md',
] as const;

/** Output file paths relative to project root (constitution goes inside .minspec/) */
export const TEMPLATE_OUTPUT_PATHS: Record<TemplateName, string> = {
  'CLAUDE.md': 'CLAUDE.md',
  'AGENTS.md': 'AGENTS.md',
  '.cursorrules': '.cursorrules',
  'constitution.md': '.minspec/constitution.md',
};

const CLAUDE_MD_TEMPLATE = `# {{projectName}} — Project Instructions

## Overview

{{projectName}} project managed with MinSpec SDD methodology.

- **Specs directory:** \`{{specsDir}}/\`
- **Decisions directory:** \`{{decisionsDir}}/\`

## Invariants

These rules must never be violated. All changes must preserve them.

{{#if invariants}}
{{#each invariants}}
{{incremented @index}}. {{this}}
{{/each}}
{{else}}
<!-- Add project invariants here -->
{{/if}}

## SDD Methodology

This project uses Specification-Driven Development. Tasks are classified by **mechanical scope** (blast radius — files, lines, boundaries touched), not by how hard they are to reason about. The predicted tier is an upward-only floor: it never lowers ceremony on its own, and you can always raise it.

| Tier | Ceremony | Phases Required |
|------|----------|-----------------|
| T1 | One-sentence spec | specify |
| T2 | Spec + plan | specify, plan |
| T3 | Full spec cycle | specify, plan, tasks, implement |
| T4 | Complete ceremony | all phases |

## File Locations

| Artifact | Location |
|---|---|
| Specs | \`{{specsDir}}/\` |
| Decisions | \`{{decisionsDir}}/\` |
| Constitution | \`.minspec/constitution.md\` |
| Config | \`.minspec/config.json\` |

## Commands

MinSpec is a **VS Code extension**, not a CLI — run everything from the Command Palette (\`Ctrl/Cmd+Shift+P\`), typing "MinSpec:".

| Command Palette | Purpose |
|---|---|
| *MinSpec: Initialize SDD Structure* | Scaffold \`.minspec/\` + harness files. Also offered automatically when you open an un-initialized project. |
| *MinSpec: Refresh Harness Files* | Re-merge harness templates, preserving your edits. |
| *MinSpec: Classify Task Complexity* | Classify the current change into a tier (T1–T4). |
| *MinSpec: Show SDD Status* | Show the current phase and spec status. |
| *MinSpec: Create Architecture Decision Record* | Create a new \`DR-NNN\` in \`{{decisionsDir}}/\`. |
`;

const AGENTS_MD_TEMPLATE = `# {{projectName}} — Agent Instructions

## For AI Coding Assistants

This project uses MinSpec SDD (Specification-Driven Development). Before implementing any change:

1. **Check scope** — How far does this change reach (files, lines, boundaries)? That sets the tier — not how hard the change feels.
2. **Read the spec** — Check \`{{specsDir}}/\` for existing specs related to your task.
3. **Follow the tier** — Don't over-specify small-scope tasks. Don't under-specify wide-scope ones. The predicted tier is a floor: raise it (never lower it) if a small change is subtler than its footprint.

## Specs Directory

All specifications live in \`{{specsDir}}/\`. Each spec file uses Spec Kit-compatible markdown with YAML frontmatter.

## Decision Records

Architecture decisions are documented in \`{{decisionsDir}}/\`. Check existing decisions before proposing conflicting approaches.

## Constitution

Project invariants, principles, and constraints are in \`.minspec/constitution.md\`. These rules must never be violated.

{{#if invariants}}
### Key Invariants

{{#each invariants}}
- {{this}}
{{/each}}
{{/if}}

## Task Classification Guide

Before starting work, classify the task by its **mechanical scope** (blast radius), not by how hard it is to think through:

- **T1 (Contained):** Single file, one-line fix, typo, config change. One sentence of spec is enough.
- **T2 (Standard):** A few files, contained feature, no cross-boundary changes. Needs spec + plan.
- **T3 (Wide):** Many files, new APIs, schema/dependency changes. Full spec cycle.
- **T4 (Architectural):** Cross-project impact, new services, breaking changes. Complete ceremony required.

The classifier sees scope, not difficulty. A subtle one-line fix and a trivial one are the same size — so the predicted tier is a **floor**: raise it when a change is harder than its footprint, never lower it below the prediction.

## Rules

1. Never skip the spec phase, even for T1.
2. User override always wins — if the human says "just do it," do it. The predicted tier only ratchets up, never auto-down.
3. Ceremony must be proportional to scope — don't over-engineer small-scope tasks.
`;

const CURSORRULES_TEMPLATE = `# {{projectName}} — Cursor Rules

## Project Context

This project uses MinSpec SDD methodology. Specs in \`{{specsDir}}/\`, decisions in \`{{decisionsDir}}/\`.

## Invariants

{{#if invariants}}
{{#each invariants}}
- {{this}}
{{/each}}
{{else}}
<!-- Add project invariants here -->
{{/if}}

## Principles

{{#if principles}}
{{#each principles}}
- {{this}}
{{/each}}
{{else}}
- Ceremony proportional to scope (blast radius), not to perceived difficulty
- User override always wins
- Specs are living documents
{{/if}}

## Before Making Changes

1. Check if a spec exists for the area you're modifying
2. Classify the change by mechanical scope (T1-T4) — how far it reaches, not how hard it feels
3. Follow the appropriate ceremony level (the predicted tier is a floor — raise it, never lower it)
4. Never violate the invariants listed above

## Coding Standards

- Follow existing patterns in the codebase
- Keep changes focused and atomic
- Document decisions that are hard to reverse
`;

const CONSTITUTION_MD_TEMPLATE = `# {{projectName}} — Constitution

## Invariants

Rules that must never be violated. All changes must preserve them.

{{#if invariants}}
{{#each invariants}}
{{incremented @index}}. {{this}}
{{/each}}
{{else}}
<!-- Add invariants here. Example: -->
<!-- 1. No breaking changes to public API without deprecation cycle -->
<!-- 2. All user data stays local — no network calls without consent -->
{{/if}}

## Principles

Guidelines that should be followed. Can be bent in exceptional circumstances with justification.

{{#if principles}}
{{#each principles}}
{{incremented @index}}. {{this}}
{{/each}}
{{else}}
<!-- Add principles here. Example: -->
<!-- 1. Ceremony proportional to scope (blast radius), not perceived difficulty -->
<!-- 2. User override always wins -->
<!-- 3. Specs are living documents, not bureaucracy -->
{{/if}}

## Constraints

Technical or business constraints that bound the solution space.

{{#if constraints}}
{{#each constraints}}
{{incremented @index}}. {{this}}
{{/each}}
{{else}}
<!-- Add constraints here. Example: -->
<!-- 1. Must run offline — zero network dependency -->
<!-- 2. VS Code extension size < 5MB -->
<!-- 3. Node.js 18+ runtime only -->
{{/if}}

## Goals

What this project is trying to achieve. The outcomes work should ladder up to.

<!-- Add goals here. Example: -->
<!-- 1. Ship a frictionless SDD experience for solo developers -->
<!-- 2. Keep ceremony proportional to scope -->
`;

/** Registry of all templates keyed by name */
export const TEMPLATES: Record<TemplateName, string> = {
  'CLAUDE.md': CLAUDE_MD_TEMPLATE,
  'AGENTS.md': AGENTS_MD_TEMPLATE,
  '.cursorrules': CURSORRULES_TEMPLATE,
  'constitution.md': CONSTITUTION_MD_TEMPLATE,
};

/**
 * Compute the raw-template baseline: the SHA-256 of each *unrendered* template
 * section (`{{placeholders}}` intact), keyed by output path → heading.
 *
 * This is the canonical "which template version are we at" signal. Because it
 * hashes the raw template — never the rendered output — it is independent of any
 * project context: re-rendering with a different project name, specs dir, or
 * invariant list never perturbs it. `hasHarnessDrift` compares this (the current
 * bundled template) against the stored baseline (the template at last generate)
 * to decide whether the bundled template has genuinely moved upstream (#117).
 */
export function computeTemplateBaseline(): GeneratedHashes {
  const baseline: Record<string, SectionHashes> = {};
  for (const name of TEMPLATE_NAMES) {
    baseline[TEMPLATE_OUTPUT_PATHS[name]] = buildSectionHashes(
      parseSections(TEMPLATES[name]),
    );
  }
  return baseline;
}

// ---------------------------------------------------------------------------
// Managed-region templates (#249, DR-037)
//
// A second class of scaffolded file that the Markdown section-merge engine
// (`mergeFile` / `parseSections` in merge-refresh.ts) cannot manage: its merge
// unit is the `## ` heading, so it can only carry Markdown. Non-Markdown harness
// artifacts — YAML workflows, shell scripts, JS/TS configs — have no `## `
// sections to merge and would be corrupted by section reassembly.
//
// Instead of treating these as opaque whole files, MinSpec wraps its owned
// content in comment-delimited MARKERS whose comment syntax matches the target
// file type — the same `minspec:` marker convention already used for the DR-index
// (`<!-- minspec:dr-index:start -->`), generalized to any file type:
//
//   # >>> minspec:managed:<name> >>>     (YAML / shell — `#` comments)
//   # <<< minspec:managed:<name> <<<
//   <!-- >>> minspec:managed:<name> >>> -->   (Markdown / HTML / XML)
//   <!-- <<< minspec:managed:<name> <<< -->
//   // >>> minspec:managed:<name> >>>    (JS / TS / C-family)
//   // <<< minspec:managed:<name> <<<
//
// Contract:
//   - Scaffold (init): write the file with the MinSpec-owned content wrapped in
//     the managed block. A fully-MinSpec-owned file (the CI workflow) = one
//     managed block spanning the file; the user adds custom content OUTSIDE the
//     markers.
//   - Refresh: parse the markers; OVERWRITE only the content BETWEEN them with the
//     current template; PRESERVE everything outside verbatim. User edits outside
//     the region survive; MinSpec's region stays current — the key improvement over
//     the old preserve-on-any-edit whole-file rule, which let one stray edit freeze
//     MinSpec out of its own region forever.
//   - Missing/corrupted markers (user deleted them): NEVER a silent clobber. If
//     the file exists but has no recognizable markers → SKIP + warn; if the file
//     is absent → re-scaffold it with markers.
//
// No content baseline file is needed — the markers ARE the boundary between
// MinSpec-owned and user-owned content. This mechanism is the reusable foundation
// for the hook-script scaffolds (#246/#247) and the python validator (#244).
// ---------------------------------------------------------------------------

/**
 * Comment syntax used to delimit a managed region, chosen to match the target
 * file type so the markers are valid comments in that language.
 *  - `hash`  → `#` line comments (YAML, shell, Python, TOML, .gitignore)
 *  - `html`  → `<!-- -->` block comments (Markdown, HTML, XML)
 *  - `slash` → `//` line comments (JS, TS, JSON-with-comments, C-family)
 */
export type CommentStyle = 'hash' | 'html' | 'slash';

/** Shared marker token — reuses the `minspec:` convention (cf. dr-index markers). */
const MANAGED_MARKER_PREFIX = 'minspec:managed:';

/**
 * Build the start marker line for a managed region of the given name + comment
 * style. Exported so the parser and tests derive markers from one source of truth
 * (never hand-typed, so the scaffold and refresh halves can never drift).
 */
export function managedRegionStartMarker(name: string, style: CommentStyle): string {
  const token = `>>> ${MANAGED_MARKER_PREFIX}${name} >>>`;
  switch (style) {
    case 'hash':
      return `# ${token}`;
    case 'slash':
      return `// ${token}`;
    case 'html':
      return `<!-- ${token} -->`;
  }
}

/** Build the end marker line for a managed region. See {@link managedRegionStartMarker}. */
export function managedRegionEndMarker(name: string, style: CommentStyle): string {
  const token = `<<< ${MANAGED_MARKER_PREFIX}${name} <<<`;
  switch (style) {
    case 'hash':
      return `# ${token}`;
    case 'slash':
      return `// ${token}`;
    case 'html':
      return `<!-- ${token} -->`;
  }
}

/** A scaffolded file with a comment-delimited MinSpec-managed region. */
export interface ManagedRegionTemplate {
  /** Stable identifier (used in markers, messages, tests). */
  readonly name: string;
  /** Output path relative to project root. */
  readonly outputPath: string;
  /** Comment syntax for the markers (must be valid in the target file type). */
  readonly commentStyle: CommentStyle;
  /**
   * The MinSpec-owned region body (between the markers). Managed-region templates
   * are NOT Handlebars-rendered — the content is project-independent and pinned so
   * the region stays byte-stable across projects.
   */
  readonly content: string;
}

/**
 * Wrap a managed-region template's content in its start/end markers, producing the
 * full block written to disk at scaffold time and used to overwrite the region on
 * refresh. The block is a self-contained unit: start marker, content, end marker,
 * each on its own line, newline-terminated. This is the SINGLE place the on-disk
 * managed-block shape is defined — scaffold and refresh both call it, so they can
 * never disagree about the bytes.
 */
export function renderManagedBlock(tpl: ManagedRegionTemplate): string {
  const start = managedRegionStartMarker(tpl.name, tpl.commentStyle);
  const end = managedRegionEndMarker(tpl.name, tpl.commentStyle);
  // Normalize: exactly one trailing newline on the content body so the end marker
  // always sits on its own line regardless of how the template literal was written.
  const body = tpl.content.replace(/\n+$/, '') + '\n';
  return `${start}\n${body}${end}\n`;
}

/**
 * GitHub Actions workflow: the authoritative post-push MinSpec validation gate
 * (DR-037, #249). Runs the Node-tier validator on every push / PR so that
 * contributors without the local git hooks — or any local bypass — are still
 * caught before merge. Local hook = fast fail; CI = never-merge guarantee.
 *
 * Pinned to a literal YAML string (no Handlebars): it is project-independent and
 * must remain byte-stable so the refreshed region matches exactly.
 */
const MINSPEC_VALIDATE_WORKFLOW = `name: MinSpec Validate

on:
  push:
  pull_request:

jobs:
  validate:
    name: MinSpec SDD validation
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Run MinSpec validation
        run: npx --yes @aiclarity/minspec-validator`;

/** All managed-region templates in scaffold order. */
export const MANAGED_REGION_TEMPLATES: readonly ManagedRegionTemplate[] = [
  {
    name: 'validate-workflow',
    outputPath: '.github/workflows/minspec-validate.yml',
    commentStyle: 'hash',
    content: MINSPEC_VALIDATE_WORKFLOW,
  },
] as const;
