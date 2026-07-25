/**
 * SPEC-043 — Harness-refresh manifest consistency (#890, surfaced by sealbox PR #21).
 *
 * The harness-refresh hash manifest (`.minspec/generated-hashes.json`) must record,
 * for every managed section, the hash of the FINAL bytes on disk after every write
 * path has run — not a pre-normalization template body, and not `mergeFile`'s
 * intermediate return that a later AGENTS.md injection overwrites. A fail-closed
 * write-time self-check refuses to persist a manifest that disagrees with disk.
 *
 * Test tiers (per design.md):
 *   T0  INV-1 manifest == hash(disk) for every tracked file (incl. AGENTS.md post-injection)
 *   T0  INV-2 refresh-vs-refresh idempotence: R2 bumps zero hashes (files + JSON byte-identical)
 *   T0  INV-3 predicate flags an injected manifest≠disk mismatch (read-only); and the write-path
 *          gate (recordVerifyAndSaveManifest) aborts-without-persist when record/disk actually diverge
 *   T0  INV-4 determinism: N settled refreshes yield a byte-identical manifest
 *   T1  sectionHashesFromMarkdown / verifyGeneratedHashesConsistent contract truth-tables
 *   T3  AC-1 / sealbox #21 internal `\n\n\n` normalization gap (red-before-green)
 *   T3  AC-7 AGENTS.md post-merge injection ordering (FR-6, red-before-green)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseSections,
  hashSection,
  mergeFile,
  loadHashes,
  sectionHashesFromMarkdown,
  verifyGeneratedHashesConsistent,
} from '../src/lib/merge-refresh';
import {
  generateHarnessFiles,
  refreshHarnessFiles,
  recordVerifyAndSaveManifest,
} from '../src/lib/scaffold';
import { TEMPLATE_NAMES, TEMPLATE_OUTPUT_PATHS } from '../src/lib/template-registry';

// ── fs divergence harness (write-path throw coverage, INV-3/AC-3) ─────────────
// `vi.spyOn(fs, 'readFileSync')` cannot redefine the non-configurable ESM namespace,
// so to genuinely exercise recordVerifyAndSaveManifest's fail-closed abort we mock 'fs'
// file-wide as a pure passthrough that — ONLY when armed — corrupts the SECOND read of
// one target file (the VERIFY read) so it diverges from the FIRST (RECORD) read. All
// library fs imports are `import * as fs from 'fs'`, so the namespace override reaches
// scaffold.ts and merge-refresh.ts. Disarmed (`targetAbs === null`) it is transparent,
// so every other test in this file is unaffected.
const fsDivergence = vi.hoisted(() => ({ targetAbs: null as string | null, reads: 0 }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const nodePath = await import('path');
  const readFileSync = ((p: unknown, opts?: unknown) => {
    const real = (actual.readFileSync as (a: unknown, b?: unknown) => unknown)(p, opts);
    if (
      fsDivergence.targetAbs &&
      typeof p === 'string' &&
      nodePath.resolve(p) === fsDivergence.targetAbs &&
      typeof real === 'string'
    ) {
      fsDivergence.reads += 1;
      // 1st read = RECORD (real bytes); 2nd = VERIFY (diverged) → record ≠ disk.
      if (fsDivergence.reads >= 2) return `${real}DIVERGED_BY_TEST\n`;
    }
    return real;
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

const hashesPath = (root: string) =>
  path.join(root, '.minspec', 'generated-hashes.json');

/** Snapshot every tracked harness file's bytes, keyed by relative path. */
function readTracked(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of TEMPLATE_NAMES) {
    const rel = TEMPLATE_OUTPUT_PATHS[name];
    out[rel] = fs.readFileSync(path.join(root, rel), 'utf-8');
  }
  return out;
}

/**
 * A constitution with HUMAN (non-DRAFT) list content in every section.
 *
 * SPEC-043 INV-2/AC-2 asserts "no content change AND no user edit → no hash bump".
 * The `seedConstitution` proposer only fires on an EMPTY section; once a section
 * holds authored (non-DRAFT) content it proposes nothing, so no write path mutates
 * the tree between refreshes. Using this fixture isolates the manifest-consistency
 * guarantee from the pre-existing constitution-proposer/principles-context feedback
 * loop (unbounded DRAFT growth), which is orthogonal to this spec and filed
 * separately — that loop mutates content every refresh and is not the "no content
 * change" scenario INV-2 is about.
 */
const HUMAN_CONSTITUTION = [
  '# proj — Constitution',
  '',
  '## Invariants',
  '',
  'Rules that must never be violated. All changes must preserve them.',
  '',
  '1. Core functionality works offline — no network calls without consent.',
  '',
  '## Principles',
  '',
  'Guidelines that should be followed.',
  '',
  '1. Ceremony proportional to scope, not perceived difficulty.',
  '',
  '## Constraints',
  '',
  'Technical or business constraints that bound the solution space.',
  '',
  '1. Must run offline — zero network dependency.',
  '',
  '## Goals',
  '',
  'What this project is trying to achieve.',
  '',
  '1. Ship a frictionless SDD experience.',
  '',
].join('\n');

/**
 * Scaffold a project whose refresh has reached a genuine fixed point: init, seed a
 * human constitution (neutralizing the proposer), then settle two refreshes so any
 * derived re-render (e.g. CLAUDE.md's invariants list) has converged. From here a
 * further refresh must be a byte-for-byte no-op.
 */
function scaffoldSettled(root: string): void {
  generateHarnessFiles(root);
  fs.writeFileSync(path.join(root, '.minspec', 'constitution.md'), HUMAN_CONSTITUTION);
  refreshHarnessFiles(root); // settle: re-render derived sections from the human constitution
  refreshHarnessFiles(root); // settle: reach the fixed point
}

// ── T1: sectionHashesFromMarkdown (first-occurrence-wins, D2/R3) ──────────────

describe('sectionHashesFromMarkdown (T1 contract)', () => {
  it('hashes each unique section by heading, including the preamble', () => {
    const doc = '# Title\n\npreamble text\n\n## A\n\nalpha\n\n## B\n\nbeta\n';
    const h = sectionHashesFromMarkdown(doc);
    expect(Object.keys(h).sort()).toEqual(['A', 'B', '__preamble__']);
    expect(h['A']).toBe(hashSection('alpha'));
    expect(h['B']).toBe(hashSection('beta'));
  });

  it('first-occurrence-wins for a duplicate heading (R3)', () => {
    const doc = '## Dup\n\nfirst body\n\n## Other\n\nx\n\n## Dup\n\nsecond body\n';
    const h = sectionHashesFromMarkdown(doc);
    expect(h['Dup']).toBe(hashSection('first body'));
    expect(h['Dup']).not.toBe(hashSection('second body'));
  });

  it('equals hashSection of the on-disk body for a mergeFile-produced document', () => {
    const { merged } = mergeFile('# P\n\n## S\n\nold\n', '# P\n\n## S\n\nnew\n', {});
    const body = parseSections(merged).find((s) => s.heading === 'S')!.body;
    expect(sectionHashesFromMarkdown(merged)['S']).toBe(hashSection(body));
  });

  it('a trailing blank line never diverges (labeled not-the-reproduction, AC-1)', () => {
    const a = '## S\n\nbody\n';
    const b = '## S\n\nbody\n\n';
    // hashSection trims outer whitespace, so both agree — a trailing blank line is
    // NOT the #890 reproduction (only an INTERNAL \n\n\n is).
    expect(sectionHashesFromMarkdown(a)['S']).toBe(sectionHashesFromMarkdown(b)['S']);
  });
});

// ── T1 + INV-3 + AC-8: verifyGeneratedHashesConsistent ────────────────────────

describe('verifyGeneratedHashesConsistent (T1 / INV-3 / AC-8)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-890-gate-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns [] on a freshly-refreshed tree', () => {
    generateHarnessFiles(tmp);
    refreshHarnessFiles(tmp);
    expect(verifyGeneratedHashesConsistent(tmp, loadHashes(tmp))).toEqual([]);
  });

  it('flags a section whose recorded hash disagrees with disk', () => {
    generateHarnessFiles(tmp);
    const m = loadHashes(tmp);
    const poisoned = {
      ...m,
      'CLAUDE.md': { ...m['CLAUDE.md'], Overview: 'f'.repeat(64) },
    };
    const v = verifyGeneratedHashesConsistent(tmp, poisoned);
    expect(v.some((x) => x.filePath === 'CLAUDE.md' && x.heading === 'Overview')).toBe(true);
  });

  it('AC-8 (FR-3a): skips an entry whose file is ABSENT on disk — never a violation', () => {
    generateHarnessFiles(tmp);
    const m = loadHashes(tmp);
    const withGhost = { ...m, 'GHOST.md': { Foo: 'abc123' } };
    // Absent file → skipped; the real (consistent) entries still verify clean.
    expect(verifyGeneratedHashesConsistent(tmp, withGhost)).toEqual([]);
  });

  it('flags a recorded section that is missing from an otherwise-present file', () => {
    generateHarnessFiles(tmp);
    const m = loadHashes(tmp);
    const withGhostSection = {
      ...m,
      'CLAUDE.md': { ...m['CLAUDE.md'], 'No Such Heading': 'deadbeef' },
    };
    const v = verifyGeneratedHashesConsistent(tmp, withGhostSection);
    expect(v.some((x) => x.heading === 'No Such Heading')).toBe(true);
  });
});

// ── T0 invariants (full generate/refresh over the real templates) ─────────────

describe('SPEC-043 invariants (T0)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-890-inv-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('INV-1: every manifest hash equals sectionHashesFromMarkdown of the on-disk file', () => {
    generateHarnessFiles(tmp);
    refreshHarnessFiles(tmp);
    const manifest = loadHashes(tmp);
    for (const name of TEMPLATE_NAMES) {
      const rel = TEMPLATE_OUTPUT_PATHS[name];
      const disk = fs.readFileSync(path.join(tmp, rel), 'utf-8');
      expect(sectionHashesFromMarkdown(disk), rel).toEqual(manifest[rel]);
    }
    expect(verifyGeneratedHashesConsistent(tmp, manifest)).toEqual([]);
  });

  it('INV-1 / AC-7: the AGENTS.md manifest equals the POST-injection on-disk bytes', () => {
    // The load-bearing AGENTS.md case: generateSlashCommandShims rewrites the file
    // AFTER the merge loop, so recording must happen from final disk (red on pre-fix,
    // which saved the manifest BEFORE the injection).
    generateHarnessFiles(tmp);
    const agents = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('<!-- minspec:slash-commands:start -->');
    expect(agents).toContain('## Spec Kit Slash Commands');

    const manifest = loadHashes(tmp);
    const diskHashes = sectionHashesFromMarkdown(agents);
    expect(manifest['AGENTS.md']).toEqual(diskHashes);
    // Both the injected section AND the start-marker-absorbing '## Rules' section:
    expect(manifest['AGENTS.md']['Spec Kit Slash Commands']).toBe(
      diskHashes['Spec Kit Slash Commands'],
    );
    expect(manifest['AGENTS.md']['Rules']).toBe(diskHashes['Rules']);
    expect(verifyGeneratedHashesConsistent(tmp, manifest)).toEqual([]);
  });

  it('INV-2 / AC-2: R2 == R1 — a no-change refresh bumps zero hashes', () => {
    scaffoldSettled(tmp); // fixed point reached (proposer neutralized)
    const filesR1 = readTracked(tmp);
    const manifestR1 = fs.readFileSync(hashesPath(tmp), 'utf-8');

    refreshHarnessFiles(tmp); // a further refresh — no template change, no user edit
    const filesR2 = readTracked(tmp);
    const manifestR2 = fs.readFileSync(hashesPath(tmp), 'utf-8');

    expect(filesR2).toEqual(filesR1);
    // The exact "#890" assertion: a no-content-change refresh must not bump any hash.
    expect(manifestR2).toBe(manifestR1);
  });

  it('INV-3 (predicate): a bad-hash manifest is flagged, the read-only predicate never writes, and a real refresh stays consistent', () => {
    // This proves the PREDICATE half of INV-3 and only that: verifyGeneratedHashesConsistent
    // detects an injected manifest≠disk mismatch and is read-only. It does NOT exercise the
    // write-path abort — the poisoned manifest is hand-built in memory, not produced by the
    // real recording path (which records from the SAME disk it verifies, so on its own it can
    // never diverge). The write-path abort-without-persist contract (AC-3 / D4) is proven
    // separately, by driving recordVerifyAndSaveManifest into its throw, in the test below.
    generateHarnessFiles(tmp);
    refreshHarnessFiles(tmp);
    const lastGoodBytes = fs.readFileSync(hashesPath(tmp), 'utf-8');
    const lastGood = loadHashes(tmp);

    // Inject a deliberately-inconsistent hash into an in-memory manifest.
    const poisoned = {
      ...lastGood,
      'CLAUDE.md': { ...lastGood['CLAUDE.md'], Overview: '0'.repeat(64) },
    };
    const violations = verifyGeneratedHashesConsistent(tmp, poisoned);
    expect(violations.length).toBeGreaterThan(0);

    // The predicate is pure/read-only: inspecting a poisoned manifest never touches disk.
    expect(fs.readFileSync(hashesPath(tmp), 'utf-8')).toBe(lastGoodBytes);

    // A real refresh over the good tree never throws and its manifest verifies clean — the
    // write-path tripwire is green by construction (Slice 1), exactly as documented.
    expect(() => refreshHarnessFiles(tmp)).not.toThrow();
    expect(verifyGeneratedHashesConsistent(tmp, loadHashes(tmp))).toEqual([]);
  });

  it('INV-3 / AC-3 (write path): recordVerifyAndSaveManifest aborts WITHOUT persisting when the recorded manifest diverges from final disk', () => {
    // The actual fail-closed guarantee the gate exists for. It CANNOT arise in the current
    // correct write path — Slice 1 records the manifest from the SAME final disk the self-check
    // re-reads, so record == verify by construction. We simulate a FUTURE record-before-write
    // regression (equivalently, a post-record mutation of a tracked file) by making the VERIFY
    // read of one tracked file return different bytes than the RECORD read, and prove the write
    // path fails closed: it throws the abort error AND leaves the last-good manifest
    // byte-unchanged (nothing persisted).
    scaffoldSettled(tmp);
    const lastGoodBytes = fs.readFileSync(hashesPath(tmp), 'utf-8');

    // recordVerifyAndSaveManifest reads each tracked file exactly twice: once while RECORDING
    // (its record loop) and once while VERIFYING (inside verifyGeneratedHashesConsistent),
    // record strictly before verify. Arm the fs harness on CLAUDE.md so only the SECOND read
    // diverges — its recorded hash (real bytes) then disagrees with its verified hash (mutated
    // bytes), the exact record/disk divergence a record-before-write refactor would produce.
    fsDivergence.targetAbs = path.resolve(tmp, TEMPLATE_OUTPUT_PATHS['CLAUDE.md']);
    fsDivergence.reads = 0;
    try {
      expect(() => recordVerifyAndSaveManifest(tmp)).toThrow(/MinSpec refresh aborted/);
      // The divergent file's second (verify) read fired — the throw path was actually taken,
      // not short-circuited before verification.
      expect(fsDivergence.reads).toBeGreaterThanOrEqual(2);
    } finally {
      fsDivergence.targetAbs = null;
    }

    // Abort-without-persist (D4): the on-disk manifest is byte-identical to the last-good one.
    expect(fs.readFileSync(hashesPath(tmp), 'utf-8')).toBe(lastGoodBytes);
  });

  it('INV-4 / AC-5: the manifest is byte-identical across N settled refreshes', () => {
    scaffoldSettled(tmp);
    const first = fs.readFileSync(hashesPath(tmp), 'utf-8');
    for (let i = 0; i < 3; i++) refreshHarnessFiles(tmp);
    expect(fs.readFileSync(hashesPath(tmp), 'utf-8')).toBe(first);
  });
});

// ── T3 regressions ────────────────────────────────────────────────────────────

describe('SPEC-043 regressions (T3)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-890-t3-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('AC-1 / sealbox #21: internal `\\n\\n\\n` — final-disk recording is honest; the pre-normalization recording lies', () => {
    // A template section body that acquires an INTERNAL blank-line run which
    // sectionsToMarkdown collapses on the way to disk (the one delta the two
    // transforms disagree on). No oldHash → the template body is taken.
    const existing = '# P\n\n## S\n\nalpha\n\nbeta\n';
    const generated = '# P\n\n## S\n\nalpha\n\n\nbeta\n'; // internal \n\n\n
    const { merged, newHashes } = mergeFile(existing, generated, {});

    // The write path collapses the internal run — disk is byte-different from the
    // pre-normalization template body.
    expect(generated).toContain('alpha\n\n\nbeta');
    expect(merged).not.toContain('alpha\n\n\nbeta');

    const onDiskBody = parseSections(merged).find((s) => s.heading === 'S')!.body;
    // PRE-FIX recording (mergeFile.newHashes, from the pre-normalization body) LIES:
    expect(newHashes['S']).not.toBe(hashSection(onDiskBody)); // red-before-green
    // FINAL-DISK recording (the fix) is honest by construction:
    expect(sectionHashesFromMarkdown(merged)['S']).toBe(hashSection(onDiskBody)); // green
  });

  it('AC-7 / FR-6: a manifest recorded BEFORE the AGENTS.md slash injection is inconsistent with final disk', () => {
    generateHarnessFiles(tmp);
    const finalDisk = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf-8');

    // Reconstruct the pre-injection document (what recording-from-`merged`/
    // saving-before-injection would have hashed): everything up to the start marker.
    const startIdx = finalDisk.indexOf('<!-- minspec:slash-commands:start -->');
    expect(startIdx).toBeGreaterThan(0);
    const preInjection = finalDisk.slice(0, startIdx).trimEnd() + '\n';

    const preHashes = sectionHashesFromMarkdown(preInjection);
    const finalHashes = sectionHashesFromMarkdown(finalDisk);

    // The pre-injection manifest lacks the injected section and records a DIFFERENT
    // '## Rules' hash (no absorbed start marker) than final disk.
    expect(preHashes).not.toHaveProperty('Spec Kit Slash Commands');
    expect(finalHashes).toHaveProperty('Spec Kit Slash Commands');
    expect(preHashes['Rules']).not.toBe(finalHashes['Rules']);

    // The self-check FLAGS the pre-injection manifest against final disk (red)...
    const badViolations = verifyGeneratedHashesConsistent(tmp, { 'AGENTS.md': preHashes });
    expect(badViolations.length).toBeGreaterThan(0);
    // ...while the REAL (post-injection) manifest verifies clean (green).
    expect(verifyGeneratedHashesConsistent(tmp, { 'AGENTS.md': finalHashes })).toEqual([]);
  });

  it('AC-7 end-to-end: after a slash-guidance-shaped refresh, the AGENTS.md manifest matches post-injection disk', () => {
    generateHarnessFiles(tmp);
    refreshHarnessFiles(tmp);
    const agents = fs.readFileSync(path.join(tmp, 'AGENTS.md'), 'utf-8');
    const manifest = loadHashes(tmp);
    expect(manifest['AGENTS.md']).toEqual(sectionHashesFromMarkdown(agents));
    expect(verifyGeneratedHashesConsistent(tmp, manifest)).toEqual([]);
  });
});
