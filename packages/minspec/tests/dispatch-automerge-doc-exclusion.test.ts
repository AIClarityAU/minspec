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
      'specifications/foo.md', // not specs/
    ]) {
      it(`arms: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(1);
        expect(r.out).toBe('arm');
      });
    }
  });

  describe('HOLDS auto-merge — .minspec/ governance-config + top-level agent rules (#834 re-review)', () => {
    // NOT docs-lane documents (so they stay OUT of DOCS_CORPUS_RE), but human-owned
    // policy the guard withholds as a documented superset. config.json is the
    // highest-value hole — it holds the autoMerge/ownership dials themselves.
    for (const p of [
      '.minspec/config.json',
      '.minspec/project-prefixes.md',
      '.minspec/constitution.md',
      '.minspec/generated-hashes.json',
      '.minspec/hooks/pre-commit',
      '.cursorrules',
    ]) {
      it(`holds: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(0);
        expect(r.out).toBe('hold');
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

  describe('KNOWN RESIDUAL (tracked #835) — case-insensitivity only', () => {
    // The governance-config holes (constitution.md, config.json, project-prefixes.md,
    // .cursorrules) are now COVERED by the .minspec/ + .cursorrules superset above.
    // The one remaining residual is case-insensitivity: the regex is lowercase-only, so
    // a mis-cased real doc arms. Dampened (the frontmatter validator is also
    // case-sensitive, so mis-cased docs are shadows the whole system ignores). Asserted
    // so the residual stays explicit, not hidden. Closing it is #835.
    // NB: the residual is only a mis-cased PREFIX (SPECS/) or a mis-cased TOP-LEVEL
    // extension (CLAUDE.MD). A case variant in a subpath/extension UNDER specs/ or docs/
    // (e.g. specs/foo.MD, docs/Decisions/x.md) correctly HOLDS via the broad prefix.
    for (const p of ['SPECS/foo.md', 'DOCS/x.md', '.MINSPEC/approvals/x.json', 'CLAUDE.MD']) {
      it(`arms (case residual): ${p}`, () => {
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

    it('docs-lane.yml allowed= is byte-identical to the bash DOCS_CORPUS_RE (4th enforcer pinned)', () => {
      // docs-corpus.sh's header claims byte-identity with docs-lane.yml; pin it so the
      // yml can't silently drift (#834 re-review LOW finding).
      const lib = fs.readFileSync(corpusLibPath, 'utf-8');
      const bashRe = lib.match(/DOCS_CORPUS_RE='([^']+)'/)![1];
      const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'docs-lane.yml'), 'utf-8');
      const ymlMatch = yml.match(/allowed='([^']+)'/);
      expect(ymlMatch, "allowed='...' not found in docs-lane.yml").not.toBeNull();
      expect(ymlMatch![1]).toBe(bashRe);
    });
  });

  describe('static: the arm site wires the exclusion and fails closed', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8');

    it('sources the shared corpus and uses it (+ the .minspec/ governance superset)', () => {
      expect(content).toMatch(/source\s+"\$\{SCRIPT_DIR\}\/lib\/docs-corpus\.sh"/);
      expect(content).toMatch(/grep -qE "\$\{DOCS_CORPUS_RE\}"'\|\^\\\.minspec\/\|\^\\\.cursorrules\$'/);
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
