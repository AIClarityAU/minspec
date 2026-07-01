/**
 * Slice 4 — M1 glue tests for `computeSpecRework` (FR-2, FR-3, FR-4, FR-12,
 * AC-2, AC-3, INV — Deterministic).
 *
 * Uses a real git repo in a tmp dir (mirrors approve-baseline.test.ts Slice 3
 * setup) so the git-read side is exercised end-to-end.
 *
 * Test coverage:
 *   AC-3 — same char delta applied as "editor-style" vs "agent-style" on-disk
 *           body yields IDENTICAL computeSpecRework (no surface instrumented).
 *   AC-2 — first-ever/no-baseline → undefined (NEVER 0%, 100%, div-by-zero, throw).
 *   back-compat — baselineBlob absent/'' → undefined; no record → undefined.
 *   recoverable baseline → correct reworkPct.
 *   unrecoverable (missing) blob → undefined, NO throw.
 *   INV — Deterministic (git-read side): same call twice, no intervening change →
 *           identical number.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { sidecarPath } from '../src/lib/approval-store';
import { approveSpec, GZIP_MARKER } from '../src/lib/approval';
import type { ApprovalRecord } from '../src/lib/approval';
import { computeSpecRework } from '../src/lib/trust-metrics';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-trust-metrics-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Initialize a git repo with minimal user config. */
function initGitRepo(dir: string): void {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@minspec.test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'MinSpec Test'], { cwd: dir, stdio: 'ignore' });
}

/** Write a spec file with the given body text; returns abs path. */
function writeSpecFile(
  rootDir: string,
  relPath: string,
  body: string,
): string {
  const absPath = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const content = `---\nid: SPEC-TEST\ntype: requirements\nstatus: specifying\nproduct: minspec\n---\n\n${body}`;
  fs.writeFileSync(absPath, content, 'utf-8');
  return absPath;
}

/** Write raw JSON directly to the approval sidecar (injects legacy/synthetic records). */
function writeSidecarRaw(specRel: string, json: object): void {
  const p = sidecarPath(tmp, specRel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf-8');
}

const SPEC_REL = 'specs/minspec/SPEC-017-test/requirements.md';

// ─────────────────────────────────────────────────────────────────────────────
// No record → undefined
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSpecRework — no record → undefined', () => {
  it('returns undefined when the spec has never been approved', () => {
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'Some body text.\n');
    const result = computeSpecRework(tmp, specPath);
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 back-compat: baselineBlob absent / '' → undefined (no datapoint, no throw)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSpecRework — back-compat: baselineBlob absent/\'\' → undefined', () => {
  it('returns undefined when baselineBlob is absent (legacy record)', () => {
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'Some body text.\n');

    // Inject a legacy record (no baselineBlob)
    writeSidecarRaw(SPEC_REL, {
      specPath: SPEC_REL,
      specHash: 'a'.repeat(64),
      approvedAt: '2026-06-01T00:00:00.000Z',
      approvedBy: 'paul@harvest316.com',
      tier: 'T3',
      migrated: false,
      // NO baselineBlob — legacy shape
    });

    let result: number | undefined;
    expect(() => { result = computeSpecRework(tmp, specPath); }).not.toThrow();
    expect(result).toBeUndefined();
  });

  it('returns undefined when baselineBlob is empty string \'\'', () => {
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'Some body text.\n');

    writeSidecarRaw(SPEC_REL, {
      specPath: SPEC_REL,
      specHash: 'a'.repeat(64),
      approvedAt: '2026-06-01T00:00:00.000Z',
      approvedBy: 'paul@harvest316.com',
      tier: 'T3',
      migrated: false,
      baselineBlob: '', // explicitly empty — both mint paths failed
    });

    let result: number | undefined;
    expect(() => { result = computeSpecRework(tmp, specPath); }).not.toThrow();
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — first-ever approval edge: no prior baseline → undefined
// NEVER 0%, 100%, div-by-zero, or throw
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2 — first-ever approval: no prior baseline → undefined, never 0%/100%/throw', () => {
  it('a spec that was never approved before has no record → computeSpecRework returns undefined', () => {
    // Before ANY approval: no sidecar exists → no record → undefined.
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'First ever body.\n');

    let result: number | undefined;
    expect(() => { result = computeSpecRework(tmp, specPath); }).not.toThrow();

    // Must be undefined — NOT 0, NOT 1 (0%/100%), NOT NaN
    expect(result).toBeUndefined();
  });

  it('result is never 0 (falsily "no rework") for a first-ever unreviewed spec', () => {
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'First ever body.\n');
    const result = computeSpecRework(tmp, specPath);
    // 0 would falsely imply "compared and identical" — must be undefined
    expect(result).not.toBe(0);
    expect(result).not.toBe(1);
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recoverable baseline → correct reworkPct
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSpecRework — recoverable baseline → correct reworkPct', () => {
  it('identical body after approval → reworkPct 0 (no change)', () => {
    initGitRepo(tmp);
    const body = '# Spec\n\nThis is the approved body.\n';
    const specPath = writeSpecFile(tmp, SPEC_REL, body);

    // Approve — baseline is minted from CURRENT body
    approveSpec(tmp, specPath, 'T3', 'test@minspec.test');

    // computeSpecRework on the SAME on-disk file (no changes) → 0
    const result = computeSpecRework(tmp, specPath);
    expect(result).toBe(0);
  });

  it('modified body after approval → reworkPct > 0', () => {
    initGitRepo(tmp);
    const baseBody = 'Original body content that is approved.\n';
    const specPath = writeSpecFile(tmp, SPEC_REL, baseBody);

    // Approve with the baseline body
    approveSpec(tmp, specPath, 'T3', 'test@minspec.test');

    // Now update the on-disk file with a different body
    const newBody = 'Modified body content that is totally reworked.\n';
    const content = `---\nid: SPEC-TEST\ntype: requirements\nstatus: specifying\nproduct: minspec\n---\n\n${newBody}`;
    fs.writeFileSync(specPath, content, 'utf-8');

    const result = computeSpecRework(tmp, specPath);
    expect(result).not.toBeUndefined();
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('reworkPct matches expected value for known delta', () => {
    // Use exactly "abcde" in the body, but note that getSpecBodyOnly returns
    // the content AFTER the frontmatter block including the leading \n from the
    // blank line separator.  writeSpecFile produces:
    //   ---\n...\n---\n\nabcde
    // so getSpecBodyOnly → "\nabcde" (6 chars).
    // Comparing "\nabcde" vs "\nabXde": LCS = "\nabde" (5 chars)
    // charDelta = max(6,6) − 5 = 1  ⇒  reworkPct = 1/6 ≈ 0.1667
    initGitRepo(tmp);

    const baseBody = 'abcde';
    const specPath = writeSpecFile(tmp, SPEC_REL, baseBody);
    approveSpec(tmp, specPath, 'T3', 'test@minspec.test');

    // Overwrite with the modified body (same frontmatter, different body text)
    const modifiedBody = 'abXde';
    const content = `---\nid: SPEC-TEST\ntype: requirements\nstatus: specifying\nproduct: minspec\n---\n\n${modifiedBody}`;
    fs.writeFileSync(specPath, content, 'utf-8');

    const result = computeSpecRework(tmp, specPath);
    expect(result).not.toBeUndefined();
    // The body extracted by getSpecBodyOnly is "\nabcde" vs "\nabXde" (6 chars each).
    // LCS-subsequence("\nabcde", "\nabXde") = "\nabde" = 5 chars.
    // charDelta = max(6,6) - 5 = 1 ⇒ reworkPct = 1/6 ≈ 0.1667
    expect(result).toBeCloseTo(1 / 6, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unrecoverable blob → undefined, NO throw
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSpecRework — unrecoverable blob → undefined, no throw', () => {
  it('a phantom (non-existent) SHA in baselineBlob → undefined, no throw', () => {
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'Some body.\n');

    // Inject a record with a plausible-looking but non-existent SHA
    const phantomSha = 'deadbeef'.repeat(5); // 40 hex chars
    writeSidecarRaw(SPEC_REL, {
      specPath: SPEC_REL,
      specHash: 'a'.repeat(64),
      approvedAt: '2026-06-28T00:00:00.000Z',
      approvedBy: 'test@minspec.test',
      tier: 'T3',
      migrated: false,
      baselineBlob: phantomSha,
    });

    let result: number | undefined;
    expect(() => { result = computeSpecRework(tmp, specPath); }).not.toThrow();
    expect(result).toBeUndefined();
  });

  it('a GZIP_MARKER with no .gz file → undefined, no throw', () => {
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'Some body.\n');

    // Inject a record pointing to gzip fallback, but no .gz file written
    writeSidecarRaw(SPEC_REL, {
      specPath: SPEC_REL,
      specHash: 'a'.repeat(64),
      approvedAt: '2026-06-28T00:00:00.000Z',
      approvedBy: 'test@minspec.test',
      tier: 'T3',
      migrated: false,
      baselineBlob: GZIP_MARKER,
    });

    let result: number | undefined;
    expect(() => { result = computeSpecRework(tmp, specPath); }).not.toThrow();
    expect(result).toBeUndefined();
  });

  it('a blob that was gc-pruned → undefined, no throw', () => {
    initGitRepo(tmp);
    const specPath = writeSpecFile(tmp, SPEC_REL, 'Prunable spec body.\n');

    // Write a blob to git without pinning it (will be pruned)
    const unpinnedSha = execFileSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: tmp,
      input: Buffer.from('some body', 'utf-8'),
      stdio: ['pipe', 'pipe', 'ignore'],
    }).toString().trim();

    // Prune it immediately (not pinned by any ref)
    execFileSync('git', ['gc', '--prune=now', '--quiet'], { cwd: tmp, stdio: 'ignore' });

    // Inject record pointing at the pruned SHA
    writeSidecarRaw(SPEC_REL, {
      specPath: SPEC_REL,
      specHash: 'a'.repeat(64),
      approvedAt: '2026-06-28T00:00:00.000Z',
      approvedBy: 'test@minspec.test',
      tier: 'T3',
      migrated: false,
      baselineBlob: unpinnedSha,
    });

    let result: number | undefined;
    expect(() => { result = computeSpecRework(tmp, specPath); }).not.toThrow();
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — same char delta on any surface yields identical computeSpecRework
// No surface instrumented — the file is the source of truth.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-3 — same delta via editor-style vs agent-style on-disk body → identical result', () => {
  it('editor-style write (fs.writeFileSync) and agent-style write (buffer via write+close) give same result', () => {
    // Both "surfaces" write the SAME logical content to disk via different mechanisms.
    // computeSpecRework reads the file — so the surface is invisible; only bytes matter.

    initGitRepo(tmp);

    const baseBody = 'The original approved spec body.\n';
    const modifiedBody = 'The modified reworked spec body.\n';
    const frontmatter = '---\nid: SPEC-TEST\ntype: requirements\nstatus: specifying\nproduct: minspec\n---\n\n';

    // --- Editor-style write in repo A ---
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-ac3-A-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: tmpA, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@minspec.test'], { cwd: tmpA, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'MinSpec Test'], { cwd: tmpA, stdio: 'ignore' });

      const specRelA = SPEC_REL;
      const specPathA = path.join(tmpA, specRelA);
      fs.mkdirSync(path.dirname(specPathA), { recursive: true });

      // Approve with base body
      fs.writeFileSync(specPathA, frontmatter + baseBody, 'utf-8');
      approveSpec(tmpA, specPathA, 'T3', 'test@minspec.test');

      // Editor-style: direct writeFileSync with the modified body
      fs.writeFileSync(specPathA, frontmatter + modifiedBody, 'utf-8');
      const resultEditor = computeSpecRework(tmpA, specPathA);

      // --- Agent-style write in repo B (same content via write() fd) ---
      const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-ac3-B-'));
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: tmpB, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'test@minspec.test'], { cwd: tmpB, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.name', 'MinSpec Test'], { cwd: tmpB, stdio: 'ignore' });

        const specRelB = SPEC_REL;
        const specPathB = path.join(tmpB, specRelB);
        fs.mkdirSync(path.dirname(specPathB), { recursive: true });

        // Approve with SAME base body
        fs.writeFileSync(specPathB, frontmatter + baseBody, 'utf-8');
        approveSpec(tmpB, specPathB, 'T3', 'test@minspec.test');

        // Agent-style: write via fd (open → write → close), same bytes
        const fd = fs.openSync(specPathB, 'w');
        const buf = Buffer.from(frontmatter + modifiedBody, 'utf-8');
        fs.writeSync(fd, buf);
        fs.closeSync(fd);

        const resultAgent = computeSpecRework(tmpB, specPathB);

        // Both surfaces → same result (AC-3: no surface instrumented, file is truth)
        expect(resultEditor).not.toBeUndefined();
        expect(resultAgent).not.toBeUndefined();
        expect(resultEditor).toBe(resultAgent);
      } finally {
        fs.rmSync(tmpB, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(tmpA, { recursive: true, force: true });
    }
  });

  it('same delta applied via writeFile vs rename-into-place gives identical result', () => {
    // "Rename-into-place" is what many editors and agents do (write to tmpfile then rename).
    initGitRepo(tmp);

    const baseBody = 'Original body for rename test.\n';
    const modifiedBody = 'Renamed-into-place modified body.\n';
    const frontmatter = '---\nid: SPEC-TEST\ntype: requirements\nstatus: specifying\nproduct: minspec\n---\n\n';

    // --- Direct write repo ---
    const tmpDirect = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-ac3-direct-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDirect, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@minspec.test'], { cwd: tmpDirect, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'MinSpec Test'], { cwd: tmpDirect, stdio: 'ignore' });

      const specRelDirect = SPEC_REL;
      const specPathDirect = path.join(tmpDirect, specRelDirect);
      fs.mkdirSync(path.dirname(specPathDirect), { recursive: true });
      fs.writeFileSync(specPathDirect, frontmatter + baseBody, 'utf-8');
      approveSpec(tmpDirect, specPathDirect, 'T3', 'test@minspec.test');
      fs.writeFileSync(specPathDirect, frontmatter + modifiedBody, 'utf-8');
      const resultDirect = computeSpecRework(tmpDirect, specPathDirect);

      // --- Rename-into-place repo ---
      const tmpRename = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-ac3-rename-'));
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: tmpRename, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.email', 'test@minspec.test'], { cwd: tmpRename, stdio: 'ignore' });
        execFileSync('git', ['config', 'user.name', 'MinSpec Test'], { cwd: tmpRename, stdio: 'ignore' });

        const specRelRename = SPEC_REL;
        const specPathRename = path.join(tmpRename, specRelRename);
        fs.mkdirSync(path.dirname(specPathRename), { recursive: true });
        fs.writeFileSync(specPathRename, frontmatter + baseBody, 'utf-8');
        approveSpec(tmpRename, specPathRename, 'T3', 'test@minspec.test');

        // Write to tmpfile, then rename into place (atomic editor pattern)
        const tmpFile = specPathRename + '.tmp';
        fs.writeFileSync(tmpFile, frontmatter + modifiedBody, 'utf-8');
        fs.renameSync(tmpFile, specPathRename);

        const resultRename = computeSpecRework(tmpRename, specPathRename);

        // Surface doesn't matter — only the final bytes do (AC-3)
        expect(resultDirect).not.toBeUndefined();
        expect(resultRename).not.toBeUndefined();
        expect(resultDirect).toBe(resultRename);
      } finally {
        fs.rmSync(tmpRename, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(tmpDirect, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INV — Deterministic (git-read side): call twice with no intervening change
// → identical number.
// ─────────────────────────────────────────────────────────────────────────────

describe('INV — Deterministic (git-read side): same call twice → identical number', () => {
  it('computeSpecRework called twice with no change → identical number (not undefined)', () => {
    initGitRepo(tmp);

    const baseBody = 'The approved body.\n';
    const modifiedBody = 'A reworked body content.\n';
    const frontmatter = '---\nid: SPEC-TEST\ntype: requirements\nstatus: specifying\nproduct: minspec\n---\n\n';

    const specPath = path.join(tmp, SPEC_REL);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, frontmatter + baseBody, 'utf-8');
    approveSpec(tmp, specPath, 'T3', 'test@minspec.test');

    // Modify the on-disk file so we have a non-zero rework
    fs.writeFileSync(specPath, frontmatter + modifiedBody, 'utf-8');

    // Call once
    const result1 = computeSpecRework(tmp, specPath);
    // Call again — no change to repo or file between calls
    const result2 = computeSpecRework(tmp, specPath);

    expect(result1).not.toBeUndefined();
    expect(result2).not.toBeUndefined();
    // Must be bit-identical (INV — Deterministic)
    expect(result1).toBe(result2);
  });

  it('computeSpecRework called twice on identical-to-baseline body → 0 both times', () => {
    initGitRepo(tmp);
    const body = '# Spec\n\nContent.\n';
    const specPath = writeSpecFile(tmp, SPEC_REL, body);

    approveSpec(tmp, specPath, 'T3', 'test@minspec.test');

    // No change — current body matches baseline
    const result1 = computeSpecRework(tmp, specPath);
    const result2 = computeSpecRework(tmp, specPath);

    expect(result1).toBe(0);
    expect(result2).toBe(0);
    expect(result1).toBe(result2);
  });
});
