/**
 * classifier-validation.test.ts — SPEC-004 / DR-009
 *
 * Validates the tier classifier against real GitHub issue→PR diffs from
 * SWE-bench-Verified, using the hand-assigned tier labels in
 * scripts/classifier-validation/labels.json.
 *
 * NETWORK: none. This test reads only the gitignored .data/instances.json that
 * the out-of-tree fetch script produced. If that file is absent (fresh clone, CI
 * without network), the suite SKIPS — never fails (invariant #2, FR-5, AC-1).
 *
 * REAL PATH: each patch is parsed into the diff-summary shape and fed to the real
 * `analyzeGitDiff()` via its injectable `git` seam, then `classify()`. No analyzer
 * scoring logic is reimplemented here — only the git I/O layer is faked.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeGitDiff } from '../src/lib/git-analyzer';
import { classify } from '../src/lib/classifier';
import { runConsequenceAnalyzers } from '../src/lib/consequence-analyzers';
import type {
  ChangedFile,
  ChangeStatus,
  ConsequenceInput,
} from '../src/lib/consequence-analyzers';
import { DEFAULT_CONFIG } from '../src/lib/config';
import type { Tier } from '../src/lib/config';

// ─── Paths ───────────────────────────────────────────────────────────────────

const VALIDATION_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'classifier-validation',
);
const INSTANCES_FILE = path.join(VALIDATION_DIR, '.data', 'instances.json');
const LABELS_FILE = path.join(VALIDATION_DIR, 'labels.json');
const REPORT_FILE = path.join(VALIDATION_DIR, '.data', 'report.json');

// ─── Types ───────────────────────────────────────────────────────────────────

interface Instance {
  instanceId: string;
  repo?: string;
  problemStatement?: string;
  patch: string;
}

interface DiffFileStat {
  file: string;
  insertions: number;
  deletions: number;
  binary: boolean;
  isNew: boolean;
}

interface ValidationResult {
  instanceId: string;
  expectedTier: Tier;
  predictedTier: Tier;
  confidence: number;
  match: boolean;
}

const TIERS: Tier[] = ['T1', 'T2', 'T3', 'T4'];
const TIER_INDEX: Record<Tier, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

// ─── Patch parsing ───────────────────────────────────────────────────────────

/**
 * Parse a git unified-diff patch into per-file stats. Counts +/- lines exactly as
 * `git apply --numstat` would for text files; flags binary and new files.
 */
function parsePatch(patch: string): DiffFileStat[] {
  const files: DiffFileStat[] = [];
  let cur: DiffFileStat | null = null;

  const stripPrefix = (p: string): string =>
    p.replace(/^a\//, '').replace(/^b\//, '').trim();

  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(cur);
      // diff --git a/path b/path  → take the b/ path
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const file = m ? m[2].trim() : line.slice('diff --git '.length).trim();
      cur = { file, insertions: 0, deletions: 0, binary: false, isNew: false };
      continue;
    }
    if (!cur) continue;

    if (line.startsWith('new file mode')) {
      cur.isNew = true;
    } else if (line.startsWith('deleted file mode')) {
      // path stays the b/ path from the header; deletions counted below
    } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      cur.binary = true;
    } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      // file header markers — not content
    } else if (line.startsWith('+')) {
      cur.insertions++;
    } else if (line.startsWith('-')) {
      cur.deletions++;
    }
  }
  if (cur) files.push(cur);
  return files;
}

/**
 * Build a SimpleGit-shaped fake from parsed patch stats, satisfying exactly the
 * methods analyzeGitDiff calls: revparse, diffSummary, status, diff.
 */
function fakeGit(stats: DiffFileStat[], patch: string): any {
  return {
    revparse: async () => 'true\n',
    diffSummary: async () => ({
      files: stats.map((s) => ({
        file: s.file,
        insertions: s.insertions,
        deletions: s.deletions,
        binary: s.binary,
      })),
    }),
    status: async () => ({
      created: stats.filter((s) => s.isNew).map((s) => s.file),
      not_added: [],
    }),
    diff: async () => patch,
  };
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const hasData = fs.existsSync(INSTANCES_FILE);

describe.skipIf(!hasData)('Classifier validation — SWE-bench-Verified', () => {
  it('predicts tiers and reports accuracy against hand labels', async () => {
    const instances: Instance[] = JSON.parse(
      fs.readFileSync(INSTANCES_FILE, 'utf-8'),
    );
    const labelDoc = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf-8'));
    const labels: Record<string, Tier> = labelDoc.labels ?? {};

    const labelled = instances.filter((i) => labels[i.instanceId]);

    if (labelled.length === 0) {
      // Data fetched but nothing labelled yet — surface, don't silently pass.
      console.warn(
        `[classifier-validation] ${instances.length} instances fetched but 0 labelled in labels.json. ` +
          `Label some instanceIds to get an accuracy number.`,
      );
      expect(instances.length).toBeGreaterThan(0);
      return;
    }

    const results: ValidationResult[] = [];
    let skipped = 0;

    for (const inst of labelled) {
      const stats = parsePatch(inst.patch);
      if (stats.length === 0) {
        skipped++;
        continue;
      }
      const git = fakeGit(stats, inst.patch);
      const signals = await analyzeGitDiff('<fake>', { staged: true, git });
      const result = classify(signals, DEFAULT_CONFIG);
      const expectedTier = labels[inst.instanceId];
      results.push({
        instanceId: inst.instanceId,
        expectedTier,
        predictedTier: result.tier,
        confidence: result.confidence,
        match: result.tier === expectedTier,
      });
    }

    // Aggregate
    const applied = results.length;
    const exact = results.filter((r) => r.match).length;
    const adjacent = results.filter(
      (r) => Math.abs(TIER_INDEX[r.expectedTier] - TIER_INDEX[r.predictedTier]) <= 1,
    ).length;
    const accuracy = applied ? exact / applied : 0;
    const adjacentAccuracy = applied ? adjacent / applied : 0;

    const confusion: Record<Tier, Record<Tier, number>> = {
      T1: { T1: 0, T2: 0, T3: 0, T4: 0 },
      T2: { T1: 0, T2: 0, T3: 0, T4: 0 },
      T3: { T1: 0, T2: 0, T3: 0, T4: 0 },
      T4: { T1: 0, T2: 0, T3: 0, T4: 0 },
    };
    for (const r of results) confusion[r.expectedTier][r.predictedTier]++;

    const outliers = results.filter(
      (r) => Math.abs(TIER_INDEX[r.expectedTier] - TIER_INDEX[r.predictedTier]) >= 2,
    );

    const report = {
      n: labelled.length,
      applied,
      skipped,
      accuracy,
      adjacentAccuracy,
      confusion,
      outliers,
    };
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf-8');

    // Print human-readable summary
    /* eslint-disable no-console */
    console.log(
      `\nClassifier validation — SWE-bench-Verified ` +
        `(n=${labelled.length} labelled, ${applied} applied, ${skipped} skipped)`,
    );
    console.log(`Accuracy (exact tier):   ${(accuracy * 100).toFixed(1)}%`);
    console.log(`Adjacent (±1 tier):      ${(adjacentAccuracy * 100).toFixed(1)}%`);
    console.log(`\nConfusion (rows=expected, cols=predicted)`);
    console.log(`        ${TIERS.map((t) => t.padStart(4)).join(' ')}`);
    for (const e of TIERS) {
      console.log(
        `   ${e}   ${TIERS.map((p) => String(confusion[e][p]).padStart(4)).join(' ')}`,
      );
    }
    if (outliers.length) {
      console.log(`\nOutliers (|expected - predicted| >= 2):`);
      for (const o of outliers) {
        console.log(
          `   ${o.instanceId}  expected=${o.expectedTier} predicted=${o.predictedTier} conf=${o.confidence.toFixed(2)}`,
        );
      }
    }
    /* eslint-enable no-console */

    // The harness asserts it RAN, not a quality bar — accuracy is for human review.
    expect(applied).toBeGreaterThan(0);
  });
});

// ─── FR-8: consequence-axis ON vs OFF (SPEC-023) ─────────────────────────────

/**
 * Per-file content surfaces reconstructed from a unified diff: the `+` lines as
 * a (post-change) content proxy and the `-` lines as an (old-content) proxy.
 * This is exactly the inclusion-biased surface the analyzers scan (whole-content
 * regex), so an ON/OFF tier-shift measured this way is faithful to how the
 * command-layer path feeds them (FR-7). It cannot UNDER-detect a consequence the
 * real path would catch in the diff hunk; it only lacks unchanged context (which
 * the analyzers do not need for their regexes).
 */
interface PatchFile {
  file: string;
  status: ChangeStatus;
  added: string; // joined `+` content lines
  removed: string; // joined `-` content lines
}

function parsePatchForConsequence(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let cur: PatchFile | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(cur);
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const file = m ? m[2].trim() : line.slice('diff --git '.length).trim();
      cur = { file, status: 'modified', added: '', removed: '' };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.status = 'added';
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
    else if (line.startsWith('rename from') || line.startsWith('rename to')) cur.status = 'renamed';
    else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      /* header */
    } else if (line.startsWith('+')) cur.added += line.slice(1) + '\n';
    else if (line.startsWith('-')) cur.removed += line.slice(1) + '\n';
  }
  if (cur) files.push(cur);
  return files;
}

function buildConsequenceInputFromPatch(patch: string): ConsequenceInput {
  const pfs = parsePatchForConsequence(patch);
  const changedFiles: ChangedFile[] = pfs.map((pf) => ({
    path: pf.file,
    insertions: pf.added ? pf.added.split('\n').length - 1 : 0,
    deletions: pf.removed ? pf.removed.split('\n').length - 1 : 0,
    status: pf.status,
    // Post-change content proxy = added lines; deleted files have none.
    content: pf.status === 'deleted' ? undefined : pf.added || undefined,
    // Old content proxy = removed lines; added files have none.
    oldContent: pf.status === 'added' ? undefined : pf.removed || undefined,
  }));
  return { changedFiles, refIndex: null }; // refIndex always null in v1
}

describe.skipIf(!hasData)('SPEC-023 FR-8 — consequence axis ON vs OFF', () => {
  it('reports the tier-shift delta and asserts every shift is UPWARD (INV-3)', async () => {
    const instances: Instance[] = JSON.parse(
      fs.readFileSync(INSTANCES_FILE, 'utf-8'),
    );

    interface Shift {
      instanceId: string;
      off: Tier;
      on: Tier;
      tripped: string[];
    }
    const shifts: Shift[] = [];
    let evaluated = 0;
    let downward = 0;

    for (const inst of instances) {
      const stats = parsePatch(inst.patch);
      if (stats.length === 0) continue;
      const git = fakeGit(stats, inst.patch);

      // OFF: size signals only (the pre-SPEC-023 path).
      const sizeSignals = await analyzeGitDiff('<fake>', { staged: true, git });
      const off = classify(sizeSignals, DEFAULT_CONFIG).tier;

      // ON: size + consequence signals (the SPEC-023 path).
      const consequence = runConsequenceAnalyzers(
        buildConsequenceInputFromPatch(inst.patch),
      );
      const on = classify([...sizeSignals, ...consequence], DEFAULT_CONFIG).tier;

      evaluated++;
      if (on !== off) {
        if (TIER_INDEX[on] < TIER_INDEX[off]) downward++;
        shifts.push({
          instanceId: inst.instanceId,
          off,
          on,
          tripped: consequence
            .filter((s) => s.tierContribution !== 'T1')
            .map((s) => s.name),
        });
      }
    }

    // Tally direction.
    const byDirection: Record<string, number> = {};
    for (const s of shifts) {
      const key = `${s.off}→${s.on}`;
      byDirection[key] = (byDirection[key] ?? 0) + 1;
    }

    /* eslint-disable no-console */
    console.log(
      `\nSPEC-023 FR-8 — consequence axis ON vs OFF (n=${evaluated} evaluated)`,
    );
    console.log(`Tier shifts: ${shifts.length} of ${evaluated}`);
    console.log(`Downward shifts (MUST be 0 — INV-3): ${downward}`);
    if (Object.keys(byDirection).length) {
      console.log('Shift directions:');
      for (const [k, v] of Object.entries(byDirection).sort()) {
        console.log(`   ${k}: ${v}`);
      }
    }
    if (shifts.length) {
      console.log('\nShifted instances:');
      for (const s of shifts) {
        console.log(
          `   ${s.instanceId}  ${s.off}→${s.on}  [${s.tripped.join(', ')}]`,
        );
      }
    }
    /* eslint-enable no-console */

    // Write a machine-readable delta report alongside the validation report.
    const deltaReport = {
      n: evaluated,
      shifts: shifts.length,
      downward,
      byDirection,
      shiftedInstances: shifts,
    };
    fs.writeFileSync(
      path.join(VALIDATION_DIR, '.data', 'fr8-delta.json'),
      JSON.stringify(deltaReport, null, 2) + '\n',
      'utf-8',
    );

    // INV-3 is a HARD invariant: no shift may ever lower a tier.
    expect(downward).toBe(0);
    // Sanity: the harness actually evaluated instances.
    expect(evaluated).toBeGreaterThan(0);
  });
});

// ─── T0: invariant guards (run even without data) ────────────────────────────

describe('Classifier validation harness — invariants', () => {
  it('performs no network I/O (only fs + analyzer/classifier)', () => {
    const self = fs.readFileSync(__filename, 'utf-8');
    // No network primitives in the harness itself (the fetch script is out-of-tree).
    expect(self).not.toMatch(/\bfetch\s*\(/);
    expect(self).not.toMatch(/from ['"](node-fetch|axios|got|undici)['"]/);
    expect(self).not.toMatch(/\bhttps?\.(get|request)\b/);
  });

  it('parsePatch counts insertions/deletions and flags new files', () => {
    const patch = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 111..222 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,2 +1,3 @@',
      ' context',
      '-old line',
      '+new line',
      '+another new',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,1 @@',
      '+created',
    ].join('\n');
    const stats = parsePatch(patch);
    expect(stats).toHaveLength(2);
    const foo = stats.find((s) => s.file === 'src/foo.ts')!;
    expect(foo.insertions).toBe(2);
    expect(foo.deletions).toBe(1);
    expect(foo.isNew).toBe(false);
    const neu = stats.find((s) => s.file === 'src/new.ts')!;
    expect(neu.isNew).toBe(true);
    expect(neu.insertions).toBe(1);
  });

  it('fakeGit + analyzeGitDiff produces signals from a parsed patch (real path)', async () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');
    const stats = parsePatch(patch);
    const signals = await analyzeGitDiff('<fake>', {
      staged: true,
      git: fakeGit(stats, patch),
    });
    expect(signals.find((s) => s.name === 'files_changed')?.value).toBe(1);
    expect(signals.find((s) => s.name === 'lines_changed')?.value).toBe(2);
  });
});
