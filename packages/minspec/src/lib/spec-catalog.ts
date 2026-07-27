import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveAndValidate } from './config';
import type { MinspecConfig, Phase } from './config';
import { parseSpec } from './spec';
import type { SpecFrontmatter } from './spec';
import type { SpecSummary } from './spec-manager';
import { isSpecKitDirEntry, readSpecKitDir } from './spec-layout';

// SPEC-040 FR-4: the recursive spec catalog is Tier-0 (`lib`) — the `approve`,
// `approve-active`, and `validate` flows depend on it, so it must not ride along
// in the high-churn `views/spec-tree-provider.ts`. Moved here verbatim (behaviour-
// preserving, INV-2) from that view. `SpecSummary` is re-exported so callers get
// the type and the function from one import (a one-line diff at each call site).
export type { SpecSummary };

/**
 * Count completed (done/skipped) required phases for a spec's tier.
 * "Required" comes from config.phaseMappings so progress reflects ceremony:
 * a T1 spec is 100% at specify-done, a T4 needs all five phases.
 */
function phaseProgress(fm: SpecFrontmatter, config: MinspecConfig): { done: number; total: number } {
  const required = config.phaseMappings[fm.tier]?.requiredPhases ?? ['specify'];
  let done = 0;
  for (const phase of required) {
    const st = fm.phases[phase];
    if (st === 'done' || st === 'skipped') done++;
  }
  return { done, total: required.length };
}

/**
 * Derive the current active phase from frontmatter phase statuses.
 * Returns the first in-progress phase, or first pending phase, or null if all done/skipped.
 */
function deriveCurrentPhase(fm: SpecFrontmatter): Phase | null {
  const phases: Phase[] = ['specify', 'clarify', 'plan', 'tasks', 'implement'];

  // First check for in-progress
  for (const phase of phases) {
    if (fm.phases[phase] === 'in-progress') return phase;
  }
  // Then check for first pending
  for (const phase of phases) {
    if (fm.phases[phase] === 'pending') return phase;
  }
  return null;
}

/**
 * Scan the specs directory and return summaries for all specs.
 *
 * Recurses into product/feature subfolders (e.g. `specs/minspec/SPEC-007-epic-grouping/`)
 * — monorepos nest specs under a product dir, which the old top-level-only scan
 * missed entirely. Still handles flat files and spec-kit directories. Multiple
 * files sharing one `id` (a spec split across requirements/design/tasks) collapse
 * to a single entry, preferring the canonical requirements.md/spec.md.
 */
export function listSpecs(rootDir: string): SpecSummary[] {
  const config = loadConfig(rootDir);
  const specsDir = resolveAndValidate(rootDir, config.specsDir);

  if (!fs.existsSync(specsDir)) {
    return [];
  }

  // id → {summary, rank}. Lower rank wins as the representative file.
  const byId = new Map<string, { summary: SpecSummary; rank: number }>();
  const rankOf = (name: string): number =>
    name === 'requirements.md' ? 0
      : name === 'spec.md' ? 1
        : name === 'design.md' ? 2
          : 3;

  // id → which phase-file roles it OWNS, keyed by the role file's OWN
  // frontmatter id — never by directory co-location. A flat directory can
  // hold several independently-numbered specs (this repo's own
  // specs/minspec/{requirements,design,tasks}.md are SPEC-001/002/003, not
  // three shards of one spec), so "design.md exists next to me" is not the
  // same claim as "design.md is MY design phase". Populated inline as the
  // walk below parses each candidate file anyway — no extra fs pass.
  const rolesById = new Map<string, { design: boolean; tasks: boolean }>();
  const addRole = (id: string, role: 'design' | 'tasks'): void => {
    const roles = rolesById.get(id) ?? { design: false, tasks: false };
    roles[role] = true;
    rolesById.set(id, roles);
  };

  const consider = (fm: SpecFrontmatter, displayPath: string): void => {
    if (!fm.id) return;
    const { done, total } = phaseProgress(fm, config);
    const summary: SpecSummary = {
      id: fm.id,
      title: fm.title,
      tier: fm.tier,
      status: fm.status,
      currentPhase: deriveCurrentPhase(fm),
      filePath: displayPath,
      phasesDone: done,
      phasesTotal: total,
      epic: fm.epic,
      product: fm.product,
    };
    const rank = rankOf(path.basename(displayPath));
    const prev = byId.get(fm.id);
    if (!prev || rank < prev.rank) byId.set(fm.id, { summary, rank });

    const base = path.basename(displayPath).toLowerCase();
    if (base === 'design.md' || base === 'plan.md') addRole(fm.id, 'design');
    if (base === 'tasks.md') addRole(fm.id, 'tasks');
  };

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      try {
        if (stat.isFile() && entry.endsWith('.md')) {
          consider(parseSpec(fs.readFileSync(fullPath, 'utf-8')).frontmatter, fullPath);
        } else if (stat.isDirectory() && isSpecKitDirEntry(entry)) {
          // Spec-kit dir: merge shards, don't recurse into it. Unlike the flat
          // walk above, plan.md/tasks.md here have no frontmatter id of their
          // own to key by (mergeSpecKitShards folds them into one spec) — the
          // directory itself is scoped to a single spec by construction, so a
          // plain existence check is safe (no cross-spec collision is possible).
          const specMd = path.join(fullPath, 'spec.md');
          if (fs.existsSync(specMd)) {
            const fm = readSpecKitDir(fullPath).frontmatter;
            consider(fm, specMd);
            if (fm.id) {
              if (fs.existsSync(path.join(fullPath, 'plan.md'))) addRole(fm.id, 'design');
              if (fs.existsSync(path.join(fullPath, 'tasks.md'))) addRole(fm.id, 'tasks');
            }
          }
        } else if (stat.isDirectory()) {
          walk(fullPath); // product / feature subfolder
        }
      } catch {
        // Skip unparseable entries
      }
    }
  };
  walk(specsDir);

  const summaries = [...byId.values()].map(({ summary }) => {
    const roles = rolesById.get(summary.id);
    return { ...summary, hasDesignFile: roles?.design ?? false, hasTasksFile: roles?.tasks ?? false };
  });
  // Sort by ID for stable ordering
  summaries.sort((a, b) => a.id.localeCompare(b.id));
  return summaries;
}
