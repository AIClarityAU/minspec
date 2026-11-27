/**
 * #760 — marker-presence gate for managed-region templates.
 *
 * `refreshManagedRegionTemplates` (scaffold.ts) already DETECTS a managed file
 * whose MinSpec markers are missing — but only reactively, when a human happens
 * to run "MinSpec: Refresh Harness Files". Until then a marker-less managed file
 * (introduced by a hand-port, a copy, a linter strip) is fully committable and
 * stays that way indefinitely. `checkManagedRegionMarkers` asserts the same
 * on-disk state at commit/CI time instead, wired into `npm run validate`
 * (scripts/validate-frontmatter.ts Rule 14).
 *
 * Root-caused via a scrooge port (issue #760): `.github/workflows/ai-review.yml`
 * and `scripts/review-branch.sh` were hand-ported from minspec without their
 * markers; `ai-review.yml` then diverged locally (a self-heal-all-labels edit),
 * so it can no longer be auto-healed either. Both stayed merged, unnoticed,
 * across several commits — nothing asserted markers MUST exist.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { generateHarnessFiles, checkManagedRegionMarkers, refreshHarnessFiles, rescaffoldManagedRegionFile } from '../src/lib/scaffold';
import {
  MANAGED_REGION_TEMPLATES,
  SELF_HOSTED_TEMPLATE_NAMES,
  managedRegionStartMarker,
  managedRegionEndMarker,
} from '../src/lib/template-registry';
import { detectTools } from '../src/lib/tool-detector';

const TPL = MANAGED_REGION_TEMPLATES.find((t) => t.name === 'validate-workflow')!;
const WORKFLOW_PATH = TPL.outputPath;
const START = managedRegionStartMarker(TPL.name, TPL.commentStyle);
const END = managedRegionEndMarker(TPL.name, TPL.commentStyle);

describe('checkManagedRegionMarkers (#760)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-marker-gate-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is clean on a freshly scaffolded project', () => {
    generateHarnessFiles(tmpDir);
    expect(checkManagedRegionMarkers(tmpDir, detectTools(tmpDir))).toEqual([]);
  });

  it('flags a marker-less file with an UNMODIFIED body as a warning (auto-healable)', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);
    const original = fs.readFileSync(full, 'utf-8');

    // Strip only the two marker lines — the MinSpec body is untouched, exactly
    // the "linter stripped the marker comments" scenario auto-heal recovers from.
    const stripped = original
      .split('\n')
      .filter((line) => line.trim() !== START && line.trim() !== END)
      .join('\n');
    fs.writeFileSync(full, stripped);

    const violations = checkManagedRegionMarkers(tmpDir, detectTools(tmpDir));
    expect(violations).toHaveLength(1);
    expect(violations[0].outputPath).toBe(WORKFLOW_PATH);
    expect(violations[0].severity).toBe('warning');
    expect(violations[0].message).toContain('unmodified');
  });

  it('flags a marker-less file with a DIVERGED body as an error (unhealable)', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);
    // Markers gone AND the body no longer matches the template — auto-heal can't
    // find an unambiguous match, so Refresh would skip + warn this forever.
    fs.writeFileSync(full, 'name: hand-edited, markers gone\non: push\njobs: {}\n');

    const violations = checkManagedRegionMarkers(tmpDir, detectTools(tmpDir));
    expect(violations).toHaveLength(1);
    expect(violations[0].outputPath).toBe(WORKFLOW_PATH);
    expect(violations[0].severity).toBe('error');
    expect(violations[0].message).toContain('diverged');
  });

  it('skips an absent managed file (Refresh re-scaffolds it, not this gate’s concern)', () => {
    generateHarnessFiles(tmpDir);
    fs.unlinkSync(path.join(tmpDir, WORKFLOW_PATH));

    const violations = checkManagedRegionMarkers(tmpDir, detectTools(tmpDir));
    expect(violations.find((v) => v.outputPath === WORKFLOW_PATH)).toBeUndefined();
  });

  it('the `exclude` option filters violations by template name', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);
    fs.writeFileSync(full, 'name: hand-edited, markers gone\non: push\njobs: {}\n');

    const violations = checkManagedRegionMarkers(tmpDir, detectTools(tmpDir), {
      exclude: [TPL.name],
    });
    expect(violations.find((v) => v.outputPath === WORKFLOW_PATH)).toBeUndefined();
  });
});

describe('#760 self-hosted exclusion (minspec’s own repo)', () => {
  function findRepoRoot(): string {
    let dir = process.cwd();
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, '.github/workflows/ai-review.yml'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error('could not locate repo root (…/.github/workflows/ai-review.yml)');
  }

  it('minspec’s own tree passes the gate once SELF_HOSTED_TEMPLATE_NAMES is excluded', () => {
    const repoRoot = findRepoRoot();
    const violations = checkManagedRegionMarkers(repoRoot, detectTools(repoRoot), {
      exclude: SELF_HOSTED_TEMPLATE_NAMES,
    });
    expect(violations).toEqual([]);
  });

  it('WITHOUT the exclusion, minspec’s own CI-review-stack files would be flagged (proves the exclusion is load-bearing)', () => {
    const repoRoot = findRepoRoot();
    const violations = checkManagedRegionMarkers(repoRoot, detectTools(repoRoot));
    const flaggedPaths = new Set(violations.map((v) => v.outputPath));
    const selfHostedPaths = SELF_HOSTED_TEMPLATE_NAMES.map(
      (name) => MANAGED_REGION_TEMPLATES.find((t) => t.name === name)!.outputPath,
    );
    expect(selfHostedPaths.length).toBeGreaterThan(0);
    for (const p of selfHostedPaths) {
      expect(flaggedPaths.has(p)).toBe(true);
    }
  });
});

describe('self-hosted template sources are never marker-wrapped (#767)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-selfhost-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const selfHostedTpls = MANAGED_REGION_TEMPLATES.filter((t) => SELF_HOSTED_TEMPLATE_NAMES.includes(t.name));

  function markSelfHosting(root: string): void {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'gen-ci-templates.mjs'), '// generator\n');
    const gen = path.join(root, 'packages', 'minspec', 'src', 'lib');
    fs.mkdirSync(gen, { recursive: true });
    fs.writeFileSync(path.join(gen, 'ci-review-templates.ts'), '// embedded\n');
  }

  it('every SELF_HOSTED_TEMPLATE_NAMES entry names a real managed template (skip/read lists cannot drift)', () => {
    expect(selfHostedTpls.map((t) => t.name).sort()).toEqual([...SELF_HOSTED_TEMPLATE_NAMES].sort());
  });

  it('Refresh leaves every raw source untouched, does not re-create deleted ones, and reports the skip', () => {
    generateHarnessFiles(tmpDir);
    markSelfHosting(tmpDir);
    const [deleted, ...rest] = selfHostedTpls;
    for (const t of rest) {
      const full = path.join(tmpDir, t.outputPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, t.content);
    }
    fs.rmSync(path.join(tmpDir, deleted.outputPath), { force: true });
    const warnings = refreshHarnessFiles(tmpDir);
    for (const t of rest) {
      expect(fs.readFileSync(path.join(tmpDir, t.outputPath), 'utf-8')).toBe(t.content);
    }
    expect(fs.existsSync(path.join(tmpDir, deleted.outputPath))).toBe(false);
    const notice = warnings.find((w) => w.kind === 'self-hosted-skipped');
    expect(notice).toBeDefined();
    expect([...(notice!.outputPaths ?? [])].sort()).toEqual(selfHostedTpls.map((t) => t.outputPath).sort());
  });

  it('first init in a self-hosting repo does not scaffold the sources', () => {
    markSelfHosting(tmpDir);
    generateHarnessFiles(tmpDir);
    for (const t of selfHostedTpls) {
      expect(fs.existsSync(path.join(tmpDir, t.outputPath))).toBe(false);
    }
  });

  it('consent-gated rescaffold refuses a self-hosted source', () => {
    markSelfHosting(tmpDir);
    const t = selfHostedTpls[0];
    expect(rescaffoldManagedRegionFile(tmpDir, t.outputPath)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, t.outputPath))).toBe(false);
  });

  it('one generator file alone (a copy, not minspec own repo) does not trigger the skip', () => {
    generateHarnessFiles(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'scripts', 'gen-ci-templates.mjs'), '// copy\n');
    const warnings = refreshHarnessFiles(tmpDir);
    expect(warnings.some((w) => w.kind === 'self-hosted-skipped')).toBe(false);
  });

  it('a downstream repo (no generator) still gets the markers on every template', () => {
    generateHarnessFiles(tmpDir);
    for (const t of selfHostedTpls) {
      const full = path.join(tmpDir, t.outputPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, t.content);
    }
    refreshHarnessFiles(tmpDir);
    for (const t of selfHostedTpls) {
      expect(fs.readFileSync(path.join(tmpDir, t.outputPath), 'utf-8')).toContain(
        managedRegionStartMarker(t.name, t.commentStyle),
      );
    }
  });
});
