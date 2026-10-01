/**
 * #2465 — scripts/validate-frontmatter.ts assumed `\n` frontmatter fences
 * (`/^---\n([\s\S]*?)\n---/`), so a CRLF checkout (Windows `core.autocrlf=true`;
 * `docs/decisions/**` and `docs/epics/**` are not LF-pinned by this repo's
 * `.gitattributes` the way `specs/**` already is) silently broke two things:
 *
 *   1. `parseFrontmatter` returned `{}` for a CRLF file, so every rule reading
 *      frontmatter read it as absent rather than failing loudly.
 *   2. The epic gate (Rule 2/5) is guarded by `if (epicRefs.size > 0)` — built
 *      from `loadEpicRefs()`. With CRLF epic files, that registry came back
 *      EMPTY, which is indistinguishable from "this repo has never adopted
 *      epics", so the whole gate skipped silently instead of failing. This is
 *      the "stops evaluating without saying so" shape constitution invariant 2
 *      forbids.
 *
 * These tests spawn the real CLI as a subprocess (`runTsxCli`), same pattern as
 * `validate-frontmatter-acceptance-criteria.test.ts` — the script has top-level
 * side effects (`process.exit`), so it cannot be imported in-process.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runTsxCli, REPO_ROOT } from './helpers/run-tsx-cli';

const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');

/** `\n` → `\r\n`, applied once, so callers write normal template strings. */
function crlf(content: string): string {
  return content.replace(/\n/g, '\r\n');
}

function writeSpec(tmpDir: string, id: string, epic: string): void {
  const specDir = path.join(tmpDir, 'specs', 'demo');
  fs.mkdirSync(specDir, { recursive: true });
  const content = crlf(
    `---\nid: ${id}\ntitle: Test Spec\ntype: requirements\ntier: T1\nstatus: new\ncreated: 2026-01-01\nepic: ${epic}\n---\n\n# Test Spec\n\nBody.\n`,
  );
  fs.writeFileSync(path.join(specDir, 'requirements.md'), content, 'utf-8');
}

function writeEpicCrlf(tmpDir: string, id: string): void {
  const epicsDir = path.join(tmpDir, 'docs', 'epics');
  fs.mkdirSync(epicsDir, { recursive: true });
  const content = crlf(`---\nid: ${id}\ntitle: Test Epic\n---\n\n# Test Epic\n`);
  fs.writeFileSync(path.join(epicsDir, `${id}.md`), content, 'utf-8');
}

function runValidate(cwd: string): { status: number | null; output: string } {
  return runTsxCli(SCRIPT_PATH, [], { cwd });
}

function withTmpDir<T>(fn: (tmpDir: string) => T): T {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-crlf-gate-'));
  try {
    return fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('#2465 scripts/validate-frontmatter.ts — CRLF frontmatter and the epic gate', () => {
  it('reads a CRLF epic registry and still FAILS a mismatched epic ref (the measured row-2 defect, base-red)', () => {
    withTmpDir((tmpDir) => {
      writeEpicCrlf(tmpDir, 'EPIC-001');
      writeSpec(tmpDir, 'SPEC-001', 'EPIC-999'); // does not match the registered epic
      const { status, output } = runValidate(tmpDir);
      expect(status).not.toBe(0);
      expect(output).toContain('epic "EPIC-999" does not match any registered epic');
    });
  }, 30000);

  it('passes a CRLF epic registry with a matching epic ref (head-green control)', () => {
    withTmpDir((tmpDir) => {
      writeEpicCrlf(tmpDir, 'EPIC-001');
      writeSpec(tmpDir, 'SPEC-001', 'EPIC-001');
      const { status, output } = runValidate(tmpDir);
      expect(status).toBe(0);
      expect(output).not.toContain('does not match any registered epic');
    });
  }, 30000);

  it('FAILS CLOSED when epic files exist but none can be read for id/slug, instead of silently skipping the gate', () => {
    withTmpDir((tmpDir) => {
      const epicsDir = path.join(tmpDir, 'docs', 'epics');
      fs.mkdirSync(epicsDir, { recursive: true });
      // Frontmatter present, but neither `id:` nor `slug:` — a malformed epic file,
      // not a CRLF one. Before #2465, loadEpicRefs() returned an EMPTY set here too,
      // and `epicRefs.size > 0` could not tell this apart from "no epics adopted".
      fs.writeFileSync(
        path.join(epicsDir, 'EPIC-001.md'),
        '---\ntitle: Missing id and slug\n---\n\n# Test Epic\n',
        'utf-8',
      );
      writeSpec(tmpDir, 'SPEC-001', 'EPIC-001'); // irrelevant — registry never builds
      const { status, output } = runValidate(tmpDir);
      expect(status).not.toBe(0);
      expect(output).toContain('epic file(s) exist in docs/epics/ but none could be');
    });
  }, 30000);

  it('skips the epic gate entirely when docs/epics/ has no files at all (unchanged behaviour)', () => {
    withTmpDir((tmpDir) => {
      writeSpec(tmpDir, 'SPEC-001', 'EPIC-999'); // would mismatch if epics were registered
      const { status, output } = runValidate(tmpDir);
      expect(status).toBe(0);
      expect(output).not.toContain('does not match any registered epic');
      expect(output).not.toContain('epic file(s) exist in docs/epics/');
    });
  }, 30000);
});
