/**
 * #1683 / DR-087 — Rule 19, the forbidden-integrity-claim gate.
 *
 * DR-087 records that a hash binds content, never authorship, and that the strong
 * integrity properties are structurally unavailable to a local offline tool. It
 * therefore forbids three words in the corpus. That decision is prose, and prose
 * enforcing prose is the failure mode the constitution names, so Rule 19 is what
 * makes the decision failable.
 *
 * This suite exists because a gate that cannot be shown to FIRE is indistinguishable
 * from a gate that has gone inert. Every forbidden variant gets its own red case, and
 * each escape hatch gets a green case, with a control asserting the fixture is
 * otherwise clean. Without the control, "passed" could mean the scan found nothing
 * because it scanned nothing.
 *
 * The CLI is exercised as a subprocess rather than imported, because the script has
 * top-level side effects including `process.exit(1)`, which would kill the worker.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = process.cwd();
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');

/** A minimal well-formed DR, so any failure is attributable to Rule 19 alone. */
function writeDoc(tmpDir: string, body: string, relPath = 'docs/probe.md'): void {
  const full = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `# Probe\n\n${body}\n`, 'utf-8');
}

function runValidate(cwd: string): { status: number | null; output: string } {
  const result = spawnSync('npx', ['tsx', SCRIPT_PATH], { cwd, encoding: 'utf-8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function withTmp(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-claim-words-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Every spelling the rule claims to catch. Listed individually rather than looped
// over one regex, so a variant that stops matching names itself in the failure.
const FORBIDDEN = [
  'tamper-proof',
  'tamperproof',
  'tamper proof',
  'non-forgeable',
  'nonforgeable',
  'unforgeable',
  'non-repudiable',
  'non-repudiability',
];

describe('#1683 Rule 19 — forbidden integrity claims', () => {
  it.each(FORBIDDEN)('fails on "%s" (base-red)', word => {
    withTmp(dir => {
      writeDoc(dir, `The log is ${word} and therefore trustworthy.`);
      const { status, output } = runValidate(dir);
      expect(status).not.toBe(0);
      expect(output).toContain('forbidden integrity claim');
    });
  }, 30000);

  it('names the honest alternative in the failure, not just the violation', () => {
    withTmp(dir => {
      writeDoc(dir, 'The record is tamper-proof.');
      const { output } = runValidate(dir);
      // A gate that only says "no" makes the author guess. DR-087's whole point is
      // that there IS a correct thing to say instead.
      expect(output).toContain('tamper-evident');
    });
  }, 30000);

  it('reports the line number, so the finding is actionable', () => {
    withTmp(dir => {
      writeDoc(dir, 'Line one is fine.\n\nThis line claims to be non-forgeable.');
      const { output } = runValidate(dir);
      expect(output).toMatch(/line \d+:/);
    });
  }, 30000);

  it('passes an otherwise identical document with no forbidden word (control)', () => {
    withTmp(dir => {
      writeDoc(dir, 'The log is tamper-evident below an independently held mark.');
      const { status, output } = runValidate(dir);
      expect(status).toBe(0);
      expect(output).not.toContain('forbidden integrity claim');
    });
  }, 30000);

  it('suppresses on a claim-ok marker, so the word can be discussed deliberately', () => {
    withTmp(dir => {
      writeDoc(dir, 'The word non-forgeable is the one DR-087 forbids. claim-ok');
      const { status, output } = runValidate(dir);
      expect(status).toBe(0);
      expect(output).not.toContain('forbidden integrity claim');
    });
  }, 30000);

  it('suppression is per-line, not per-file', () => {
    withTmp(dir => {
      writeDoc(
        dir,
        'Discussing non-forgeable here is fine. claim-ok\n\nBut asserting tamper-proof here is not.',
      );
      const { status, output } = runValidate(dir);
      expect(status).not.toBe(0);
      expect(output).toContain('tamper-proof');
    });
  }, 30000);

  it('skips docs/research/, which analyses these properties rather than claiming them', () => {
    withTmp(dir => {
      writeDoc(
        dir,
        'This note examines whether a log can be non-forgeable at all.',
        'docs/research/probe.md',
      );
      const { status, output } = runValidate(dir);
      expect(status).toBe(0);
      expect(output).not.toContain('forbidden integrity claim');
    });
  }, 30000);

  it('scans specs/ as well as docs/', () => {
    withTmp(dir => {
      const specDir = path.join(dir, 'specs', 'demo');
      fs.mkdirSync(specDir, { recursive: true });
      fs.writeFileSync(
        path.join(specDir, 'requirements.md'),
        `---
id: SPEC-001
title: Probe
type: requirements
tier: T1
status: new
created: 2026-01-01
---

# Probe

## Acceptance Criteria

- [ ] **Thing** - the approval chain is non-repudiable. (FR-1)
`,
        'utf-8',
      );
      const { status, output } = runValidate(dir);
      expect(status).not.toBe(0);
      expect(output).toContain('forbidden integrity claim');
    });
  }, 30000);

  it('warns rather than passing silently when it scans nothing (invariant 2)', () => {
    withTmp(dir => {
      // No specs/ and no docs/ at all. A zero-file scan means the roots moved, and
      // a green with no scan is exactly the silent gate the constitution forbids.
      const { output } = runValidate(dir);
      expect(output).toContain('Rule 19 scanned 0 files');
    });
  }, 30000);
});
