/**
 * #1888 — T0: minspec's own managed regions must equal what `renderManagedFile` writes.
 *
 * This repo ships the templates AND applies them to itself, so its own tree is the
 * first place template drift shows up. Nothing asserted that, so a managed region
 * here could diverge from the registry that generates it and stay that way: the
 * divergence is invisible from inside a PR, and "it works in MinSpecPro" stops being
 * evidence that the shipped template works.
 *
 * Measured when this gate was written (30 managed paths): 17 carry no markers here
 * because they are self-hosted template SOURCES that this repo authors directly
 * (#767 — the same exclusion the marker gate at `managed-region-marker-gate.test.ts`
 * already makes via `SELF_HOSTED_TEMPLATE_NAMES`), 8 match the registry, and 5 have
 * drifted.
 *
 * The 5 are waived below rather than fixed, because the direction of loss differs per
 * path and two of them are open design questions, not mechanical edits:
 *
 *   - `minspec-validate.yml` — the LIVE file carries `merge_group:` (#1394) that the
 *     template lacks, so a Refresh STRIPS a required-check trigger. This is the case
 *     in #1888's title.
 *   - `.minspec/hooks/validate.py` — drifts in BOTH directions: the live file targets
 *     `docs/domain` (which a Refresh would remove) while the template adds
 *     DR-frontmatter validation the live file lacks. Reconciling it is the #1698
 *     design question — that file is fully managed with no sanctioned extension
 *     point — not an edit this test should force.
 *   - `.minspec/hooks/pre-commit` — the live region is 91 lines against the
 *     template's 359 (a Refresh would mostly ADVANCE it, adding the Stage 0
 *     protected-branch guard) and it rewords the gitleaks invocation. Note this is
 *     the SCAFFOLDED copy, not this repo's active hook, which is `.githooks/pre-commit`
 *     via `core.hooksPath` (#1951 covers that naming split).
 *   - `.claude/commands/minspec-specify.md` and `.cursor/rules/spec-kit-commands.mdc`
 *     — both are behind the template by the same SPEC-038 ownership paragraph
 *     (`implements:`/`affects:`); a Refresh advances them.
 *
 * A waiver that only silenced failures would rot, so each waived path is asserted to
 * STILL drift. Reconcile one and this test fails until its waiver is removed, which
 * makes the waiver list self-retiring rather than a permanent allowlist.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  MANAGED_REGION_TEMPLATES,
  SELF_HOSTED_TEMPLATE_NAMES,
  renderManagedFile,
  type ManagedRegionTemplate,
} from '../src/lib/template-registry';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Number of managed templates this repo APPLIES to itself (i.e. excluding the
 * self-hosted sources it authors directly, #767). The single pinned bucket size —
 * every other count in this file is derived from it.
 */
const APPLIED_PATH_COUNT = 13;

/**
 * Paths whose managed region is known to differ from the registry, each with the
 * reason it is not simply fixed. Asserted to still drift — see the header.
 */
const KNOWN_DRIFT: Readonly<Record<string, string>> = {
  '.github/workflows/minspec-validate.yml':
    'live carries merge_group: (#1394) that the template lacks — a Refresh would strip it (#1888)',
  '.minspec/hooks/validate.py':
    'bidirectional: live targets docs/domain, template adds DR-frontmatter checks — reconciliation is the #1698 design question',
  '.minspec/hooks/pre-commit':
    'live region is far behind the template (91 vs 359 lines) and rewords the gitleaks invocation; this is the scaffolded copy, not the active .githooks hook (#1951)',
  '.claude/commands/minspec-specify.md':
    'behind the template by the SPEC-038 ownership paragraph (implements:/affects:)',
  '.cursor/rules/spec-kit-commands.mdc':
    'behind the template by the SPEC-038 ownership paragraph (implements:/affects:)',
};

/** Inner region between the managed markers, or null when the file carries none. */
function innerRegion(text: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes('>>> minspec:managed:'));
  const end = lines.findIndex((l) => l.includes('<<< minspec:managed:'));
  if (start < 0 || end < 0 || end <= start) return null;
  return lines.slice(start + 1, end).join('\n');
}

/** Count of opening and closing managed markers in a file. */
function markerCounts(text: string): { open: number; close: number } {
  const lines = text.split('\n');
  return {
    open: lines.filter((l) => l.includes('>>> minspec:managed:')).length,
    close: lines.filter((l) => l.includes('<<< minspec:managed:')).length,
  };
}

const normalize = (s: string): string =>
  s
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\s+$/, '');

/**
 * Managed templates this repo is expected to APPLY to itself: everything except the
 * self-hosted sources it authors directly (#767), restricted to files that exist here
 * and carry markers.
 */
function appliedTemplates(): { tpl: ManagedRegionTemplate; disk: string; rendered: string }[] {
  const selfHosted = new Set(SELF_HOSTED_TEMPLATE_NAMES);
  const out: { tpl: ManagedRegionTemplate; disk: string; rendered: string }[] = [];
  for (const tpl of MANAGED_REGION_TEMPLATES) {
    if (selfHosted.has(tpl.name)) continue;
    const abs = path.join(REPO_ROOT, tpl.outputPath);
    if (!fs.existsSync(abs)) continue;
    const disk = innerRegion(fs.readFileSync(abs, 'utf8'));
    if (disk === null) continue;
    const rendered = innerRegion(renderManagedFile(tpl));
    if (rendered === null) continue;
    out.push({ tpl, disk, rendered });
  }
  return out;
}

const drifts = (e: { disk: string; rendered: string }): boolean =>
  normalize(e.disk) !== normalize(e.rendered);

describe('managed-region self-application (T0, #1888)', () => {
  it('compares a real set — not vacuous', () => {
    // Guards the whole file: if marker detection or rendering broke, every entry
    // would be skipped and the match assertion below would pass trivially.
    const applied = appliedTemplates();
    expect(applied.length).toBeGreaterThanOrEqual(10);
    for (const e of applied) {
      expect(e.disk.length, `disk region for ${e.tpl.outputPath}`).toBeGreaterThan(0);
      expect(e.rendered.length, `rendered region for ${e.tpl.outputPath}`).toBeGreaterThan(0);
    }
  });

  it('pins the bucket sizes the header states, as a partition of the enumeration', () => {
    // The header's counts were prose until this assertion existed, so they could go
    // stale silently as the registry grew — the exact failure mode #1987 was filed
    // about, one level up. Stated as a partition so the buckets cannot drift apart:
    // every managed template is either self-hosted here or applied here.
    const selfHosted = new Set(SELF_HOSTED_TEMPLATE_NAMES);
    const selfHostedCount = MANAGED_REGION_TEMPLATES.filter((t) => selfHosted.has(t.name)).length;
    const applied = appliedTemplates();
    const matching = applied.filter((e) => !drifts(e));
    const drifting = applied.filter(drifts);

    // ONE pinned number; every other bucket is derived from it and from the partition
    // below. Five coupled magic numbers would make a single template addition demand
    // five edits — raised as a maintainability finding on this PR.
    expect(applied.length).toBe(APPLIED_PATH_COUNT);

    // Partition: nothing unclassified, and no self-hosted source counted as applied.
    // With `applied` pinned, this fixes the self-hosted count without restating it.
    expect(selfHostedCount + applied.length).toBe(MANAGED_REGION_TEMPLATES.length);
    expect(matching.length + drifting.length).toBe(applied.length);

    // The drifting set IS the waived set — the substantive invariant, restated here
    // so this test fails rather than the counts quietly disagreeing with the waiver.
    expect(drifting.map((e) => e.tpl.outputPath).sort()).toEqual(Object.keys(KNOWN_DRIFT).sort());
  });

  it('every applied file carries exactly one managed region', () => {
    // `innerRegion` reads the FIRST region only. That is correct for every current
    // path (one region each) but would silently compare a prefix if a managed file
    // ever gained a second region, so the assumption is asserted rather than relied
    // on. Raised as a non-blocking review finding on the PR that added this file.
    const selfHosted = new Set(SELF_HOSTED_TEMPLATE_NAMES);
    let checked = 0;
    for (const tpl of MANAGED_REGION_TEMPLATES) {
      if (selfHosted.has(tpl.name)) continue;
      const abs = path.join(REPO_ROOT, tpl.outputPath);
      if (!fs.existsSync(abs)) continue;
      const onDisk = markerCounts(fs.readFileSync(abs, 'utf8'));
      if (onDisk.open === 0 && onDisk.close === 0) continue;
      expect(onDisk.open, `${tpl.outputPath} opening markers`).toBe(1);
      expect(onDisk.close, `${tpl.outputPath} closing markers`).toBe(1);

      const rendered = markerCounts(renderManagedFile(tpl));
      expect(rendered.open, `${tpl.name} rendered opening markers`).toBe(1);
      expect(rendered.close, `${tpl.name} rendered closing markers`).toBe(1);
      checked += 1;
    }
    expect(checked).toBe(APPLIED_PATH_COUNT);
  });

  it('every applied managed region matches the registry, except the waived ones', () => {
    const unexpected = appliedTemplates()
      .filter((e) => !(e.tpl.outputPath in KNOWN_DRIFT))
      .filter(drifts)
      .map((e) => e.tpl.outputPath);
    expect(unexpected).toEqual([]);
  });

  it('every waived path STILL drifts, so the waiver list self-retires', () => {
    // Reconcile a waived path and this fails until its KNOWN_DRIFT entry is removed.
    const applied = appliedTemplates();
    const byPath = new Map(applied.map((e) => [e.tpl.outputPath, e]));
    const noLongerDrifting: string[] = [];
    for (const p of Object.keys(KNOWN_DRIFT)) {
      const e = byPath.get(p);
      expect(e, `${p} is waived but was not compared — stale waiver`).toBeDefined();
      if (e && !drifts(e)) noLongerDrifting.push(p);
    }
    expect(noLongerDrifting).toEqual([]);
  });

  it('every waived path is a real managed path and carries a reason', () => {
    const managed = new Set(MANAGED_REGION_TEMPLATES.map((t) => t.outputPath));
    const selfHosted = new Set(
      SELF_HOSTED_TEMPLATE_NAMES.map(
        (n) => MANAGED_REGION_TEMPLATES.find((t) => t.name === n)?.outputPath,
      ),
    );
    for (const [p, reason] of Object.entries(KNOWN_DRIFT)) {
      expect(managed.has(p), `${p} is waived but is not a managed path`).toBe(true);
      expect(selfHosted.has(p), `${p} is waived but is a self-hosted source`).toBe(false);
      expect(reason.length, `${p} needs a reason`).toBeGreaterThan(20);
    }
  });
});
