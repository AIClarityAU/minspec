/**
 * Spec progress derivation — Tier-0 (`lib`).
 *
 * SPEC-040 FR-5: these three helpers are pure frontmatter→display derivations
 * with no `vscode` dependency, but they used to live in `views/status-bar.ts`.
 * That put a Tier-0 consumer (`lib/active-spec.ts`) in the position of importing
 * *upward* from `lib` into `views` — the exact layering inversion FR-1 bans.
 * Moved here verbatim (behaviour-preserving, INV-2); the status bar and the
 * active-spec summary both import them from `lib` now, so the edge only ever
 * points `views → lib`.
 *
 * `StatusBarSpec` keeps its name deliberately: renaming it (OQ-4's optional
 * `SpecProgressView`) is orthogonal churn across four call sites and would
 * blur the behaviour-preserving move with a rename in one diff.
 */

import type { SpecFrontmatter, PhaseStatus } from './spec';
import type { Phase, Tier } from './config';
import { PHASES, DEFAULT_CONFIG } from './config';

/** Lightweight summary passed to the status bar for display */
export interface StatusBarSpec {
  readonly id: string;
  readonly title: string;
  readonly tier: string;
  readonly currentPhase: Phase | null;
  readonly phases: Record<Phase, PhaseStatus>;
}

/**
 * Build a StatusBarSpec from a SpecFrontmatter.
 * Determines the current phase from the phases map.
 */
export function fromFrontmatter(fm: SpecFrontmatter): StatusBarSpec {
  let currentPhase: Phase | null = null;
  // First check for in-progress
  for (const phase of PHASES) {
    if (fm.phases[phase] === 'in-progress') {
      currentPhase = phase;
      break;
    }
  }
  // If none in-progress, find first pending
  if (!currentPhase) {
    for (const phase of PHASES) {
      if (fm.phases[phase] === 'pending') {
        currentPhase = phase;
        break;
      }
    }
  }

  return {
    id: fm.id,
    title: fm.title,
    tier: fm.tier,
    currentPhase,
    phases: fm.phases,
  };
}

/**
 * Compute a tier-aware completion percentage from a phases map (#38).
 *
 * When `tier` is given, the denominator is the phases that tier *requires*
 * (DR-362 `phaseProgress` logic, replicated locally) — so a T1 spec reads 100%
 * once `specify` is done, while a T4 needs all five phases. When `tier` is
 * omitted, the denominator is the full five-phase pipeline (the legacy
 * whole-pipeline semantics — what the active-spec summary in `lib/active-spec.ts`
 * passes). Done + skipped count as completed. Returns the progress token
 * "· N%" — no redundant " done" suffix (#97).
 */
export function computeProgress(
  phases: Record<Phase, PhaseStatus>,
  tier?: string,
): string {
  const required: readonly Phase[] =
    tier === undefined
      ? PHASES
      : DEFAULT_CONFIG.phaseMappings[tier as Tier]?.requiredPhases ?? ['specify'];
  let completed = 0;
  for (const phase of required) {
    const status = phases[phase];
    if (status === 'done' || status === 'skipped') {
      completed++;
    }
  }
  const pct = required.length === 0 ? 0 : Math.round((completed / required.length) * 100);
  return `· ${pct}%`;
}
