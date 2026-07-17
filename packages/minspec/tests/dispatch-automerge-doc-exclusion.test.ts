/**
 * T0/T3 — #833: dispatch native auto-merge (DR-061) must NOT arm on a PR that
 * touches the docs-lane / human-owned corpus (specs/**, docs/**,
 * .minspec/approvals/**, top-level *.md).
 *
 * Root cause (reproduced live 2026-07-17, PR #832): a dispatched agent on #793
 * edited the UNAPPROVED `SPEC-031/requirements.md` (an OQ resolution — a human
 * design decision); ai-review passed and native auto-merge armed, landing an
 * agent-chosen resolution on main. The spec-gate correctly ALLOWED the edit
 * (doc-before-CODE); the missing gate was on the MERGE side — DR-061 armed on any
 * ai-review:pass with no approvable-doc exclusion.
 *
 * The fix reuses the SHARED corpus (scripts/lib/docs-corpus.sh -> DOCS_CORPUS_RE),
 * making dispatch the 4th lock-step enforcer of the same corpus already enforced by
 * docs-corpus.ts (canonical), docs-lane.yml, and push-docs.sh — NOT a divergent 4th
 * regex (the reviewer's structural finding). An adversarial review of the first,
 * narrower regex found real fail-open holes (.minspec/approvals/**, top-level
 * governance *.md); reusing the corpus closes them by construction.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DOCS_CORPUS_REGEX } from '../src/lib/docs-corpus';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}

const root = findRepoRoot();
const scriptPath = path.join(root, 'scripts', 'dispatch-issue.sh');
const corpusLibPath = path.join(root, 'scripts', 'lib', 'docs-corpus.sh');

/** Run the pure seam with `paths` on stdin. Returns {code, out}. */
function classify(paths: string): { code: number; out: string } {
  try {
    const out = execFileSync('bash', [scriptPath, '--paths-have-approvable-doc'], {
      input: paths,
      encoding: 'utf-8',
    });
    return { code: 0, out: out.trim() };
  } catch (e: any) {
    return { code: e.status ?? -1, out: String(e.stdout ?? '').trim() };
  }
}

describe('dispatch-issue.sh — docs-corpus auto-merge exclusion (#833)', () => {
  describe('HOLDS auto-merge (exit 0) — anything in the docs-lane corpus', () => {
    for (const p of [
      // specs/** — every path, any file, any depth (canonical corpus)
      'specs/minspec/SPEC-031-reviewer-all-approvables/requirements.md',
      'specs/minspec/SPEC-018-x/design.md',
      'specs/minspec/SPEC-018-x/tasks.md',
      'specs/anything.txt',
      // docs/** — decisions (DR + generated INDEX), domain, epics, research
      'docs/decisions/DR-047.md',
      'docs/decisions/INDEX.md',
      'docs/domain/reviewer.md',
      'docs/epics/EPIC-010.md',
      'docs/research/whitepaper.md',
      // .minspec/approvals/** — the human sign-off ledger (was a HIGH bypass)
      '.minspec/approvals/specs/minspec/SPEC-031/requirements.md.json',
      '.minspec/approvals/DR-001.md.json',
      // top-level *.md governance docs (was a HIGH bypass)
      'README.md',
      'CLAUDE.md',
      'AGENTS.md',
    ]) {
      it(`holds: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(0);
        expect(r.out).toBe('hold');
      });
    }

    it('holds a MIXED PR (code + one corpus path)', () => {
      const r = classify('packages/minspec/src/lib/foo.ts\nspecs/minspec/SPEC-031-x/requirements.md\n');
      expect(r.code).toBe(0);
      expect(r.out).toBe('hold');
    });
  });

  describe('ARMS auto-merge (exit 1) — code / non-corpus paths', () => {
    for (const p of [
      'scripts/dispatch-issue.sh',
      'packages/minspec/src/lib/classifier.ts',
      'packages/minspec/tests/foo.test.ts',
      '.github/workflows/ai-review.yml',
      'package.json',
      'tsconfig.json',
      'packages/minspec/README.md', // NESTED *.md is not top-level
      '.minspec/config.json', // under .minspec but NOT approvals/
      'specifications/foo.md', // not specs/
    ]) {
      it(`arms: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(1);
        expect(r.out).toBe('arm');
      });
    }
  });

  describe('classifier is honest on empty input (fail-closed lives at the arm site)', () => {
    // The pure classifier answers only "do these paths include a corpus path?" —
    // empty input has none, so it ARMs. The fail-closed-on-empty POLICY is applied
    // at the arm site (a separate `-z` branch, asserted statically below), NOT in
    // the classifier — conflating "no corpus match" with "can't tell" would be wrong.
    it('empty stdin -> arm (no corpus path present)', () => {
      const r = classify('');
      expect(r.code).toBe(1);
      expect(r.out).toBe('arm');
    });
  });

  describe('KNOWN RESIDUAL (tracked) — outside the current corpus, so ARMs', () => {
    // These approvables sit OUTSIDE the canonical corpus regex; covering them is a
    // SPEC-039 corpus amendment across all four enforcers (filed follow-up), NOT a
    // silent divergence here. Asserted so the residual is explicit, not hidden.
    for (const p of ['.minspec/constitution.md', '.cursorrules']) {
      it(`arms (residual): ${p}`, () => {
        expect(classify(p + '\n').out).toBe('arm');
      });
    }
  });

  describe('lock-step: the bash corpus === the TS canonical corpus', () => {
    it('scripts/lib/docs-corpus.sh DOCS_CORPUS_RE mirrors docs-corpus.ts DOCS_CORPUS_REGEX', () => {
      const lib = fs.readFileSync(corpusLibPath, 'utf-8');
      const m = lib.match(/DOCS_CORPUS_RE='([^']+)'/);
      expect(m, 'DOCS_CORPUS_RE not found in docs-corpus.sh').not.toBeNull();
      const bashRe = m![1];
      // JS regex source escapes `/` as `\/`; the bash ERE does not. Normalize.
      const tsRe = DOCS_CORPUS_REGEX.source.replace(/\\\//g, '/');
      expect(bashRe).toBe(tsRe);
    });
  });

  describe('static: the arm site wires the exclusion and fails closed', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8');

    it('sources the shared corpus and uses it in the classifier', () => {
      expect(content).toMatch(/source\s+"\$\{SCRIPT_DIR\}\/lib\/docs-corpus\.sh"/);
      expect(content).toMatch(/grep -qE "\$DOCS_CORPUS_RE"/);
    });

    it('the arm block consults the classifier before arming, via a here-string (no SIGPIPE)', () => {
      const guardIdx = content.indexOf('if native_automerge_enabled; then');
      const armBlock = content.slice(guardIdx);
      expect(armBlock).toMatch(/paths_have_approvable_doc <<<"\$changed_files"/);
      // must NOT feed grep via a pipe (pipefail + SIGPIPE fail-open on large lists)
      expect(armBlock).not.toMatch(/\|\s*paths_have_approvable_doc/);
    });

    it('fails CLOSED on both non-zero exit AND empty enumeration', () => {
      expect(content).toMatch(/if !\s*changed_files=\$\(gh pr diff "\$pr_num"[^\n]*--name-only/);
      expect(content).toMatch(/-z "\$\{changed_files\/\/\[\$'\\n\\r\\t '\]\/\}"/);
      expect(content).toMatch(/empty changed-file enumeration; failing closed/);
    });

    it('a withheld PR is labeled needs-human-review', () => {
      expect(content).toMatch(/--add-label "needs-human-review"/);
    });
  });
});
