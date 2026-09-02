/**
 * T0/T3 — #1001: an OUTWARD-FACING doc must never earn the affirmative low-blast
 * certification, and must never ride the auto-merging docs-lane.
 *
 * Root cause (pre-fix): `detectLowBlastDocsTest` (scripts/auto-merge-gate.ts) used
 * `DOCS_EXT_RE` — "is this a docs file?" — as a PROXY for "is this low-consequence?".
 * That proxy is INVERTED for outward-facing prose: a `.md` that ships inside the
 * published `.vsix`, renders on the Marketplace/GitHub landing page, states a public
 * product claim, or deploys to minspec.dev has HIGHER consequence than most code, not
 * lower. The gate had no notion of outward-facing vs inward-facing docs, so marketing /
 * positioning / legal / README copy — the one content class the maintainer designates
 * human-only — was the ONLY class carrying an affirmative low-blast certification
 * pushing it toward auto-merge. (Sibling, merge-dispatch side: #981's `PUBLISH_PATH_RE`.)
 *
 * These tests are the enforcement proof for both enforcers:
 *   1. `detectLowBlastDocsTest` — the affirmative low-blast certifier.
 *   2. `.github/workflows/docs-lane.yml` — the auto-merge lane, exercised through the
 *      EXACT `outward='…'` ERE the workflow itself runs, so the two cannot disagree.
 *
 * The inward docs-lane (specs/**, docs/decisions/**, docs/epics/**) exists for a reason
 * (DR-051 / #575) and MUST NOT regress — the no-regression block below is as load-bearing
 * as the exclusion block.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectLowBlastDocsTest } from '../../../scripts/auto-merge-gate';
import type { ChangedFile } from '../src/lib/consequence-analyzers';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}

const root = findRepoRoot();
const gateSrcPath = path.join(root, 'scripts', 'auto-merge-gate.ts');
const docsLanePath = path.join(root, '.github', 'workflows', 'docs-lane.yml');

function cf(over: Partial<ChangedFile> & { path: string }): ChangedFile {
  return { insertions: 1, deletions: 0, status: 'modified', ...over };
}

/** Does the gate affirmatively certify this changed-set as low-blast? */
function certifiesLow(...paths: string[]): boolean {
  return detectLowBlastDocsTest(paths.map((p) => cf({ path: p }))) !== undefined;
}

// ─── The two catalogues, read from the artefacts that actually enforce them ───

/**
 * The `OUTWARD_DOC_PATTERN = '…'` literal in scripts/auto-merge-gate.ts, read as TEXT so a
 * pre-fix / drifted source fails LOUDLY here rather than importing an `undefined`.
 * A backslash must be doubled inside a TS string literal, so the raw text is un-escaped
 * back to the characters the RegExp actually sees before comparison — the same
 * normalization docs-corpus.test.ts does for `\/`. (The pattern deliberately writes a
 * literal dot as `[.]` so today there is nothing to un-escape; this keeps the lock-step
 * honest if that ever changes.)
 */
function tsOutwardPattern(): string {
  const src = fs.readFileSync(gateSrcPath, 'utf-8');
  const m = src.match(/OUTWARD_DOC_PATTERN(?::\s*string)?\s*=\s*\n?\s*'([^']+)'/);
  expect(m, "OUTWARD_DOC_PATTERN = '…' not found in scripts/auto-merge-gate.ts").not.toBeNull();
  return m![1].replace(/\\\\/g, '\\');
}

/** The `outward='…'` ERE in .github/workflows/docs-lane.yml. */
function ymlOutwardPattern(): string {
  const yml = fs.readFileSync(docsLanePath, 'utf-8');
  const m = yml.match(/outward='([^']+)'/);
  expect(m, "outward='…' not found in .github/workflows/docs-lane.yml").not.toBeNull();
  return m![1];
}

/**
 * Behavioural: run the workflow's OWN ERE, with the workflow's OWN grep flags, over a
 * path. Proves the deployed yml classifies correctly — not merely that its text mentions
 * a variable.
 */
function ymlRejectsAsOutward(p: string): boolean {
  const re = ymlOutwardPattern();
  const r = execFileSync('bash', ['-c', 'grep -qiE "$1" <<<"$2" && echo yes || echo no', '_', re, p], {
    encoding: 'utf-8',
  });
  return r.trim() === 'yes';
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Outward-facing docs are NOT low-blast and are NOT docs-lane-auto-mergeable
// ─────────────────────────────────────────────────────────────────────────────
describe('#1001 — outward-facing docs never certify low-blast', () => {
  const outward = [
    // sites/** — merging IS publishing (deploy-sites.yml → wrangler pages deploy → minspec.dev)
    'sites/minspec.dev/index.html',
    'sites/minspec.dev/copy.md',
    'sites/x.md',
    // repo / Marketplace landing pages
    'README.md',
    'packages/minspec/README.md',
    'docs/README.md',
    // release notes rendered on the Marketplace listing (ships in the .vsix)
    'CHANGELOG.md',
    'packages/minspec/CHANGELOG.md',
    // legal instruments (ship in the .vsix)
    'LICENSE',
    'LICENSE-CONTENT',
    'packages/minspec/LICENSE',
    'packages/minspec/THIRD-PARTY-NOTICES.md',
    'NOTICE',
    // VS Code Getting Started walkthrough copy — SHIPS in the .vsix and is rendered to
    // every user on install (verified with `vsce ls`)
    'packages/minspec/media/walkthrough/welcome.md',
    'packages/minspec/media/walkthrough/ai-integration.md',
    // any package-root doc: vsce ships every file .vscodeignore does not exclude
    'packages/shared/OVERVIEW.md',
  ];

  for (const p of outward) {
    it(`does NOT certify low-blast: ${p}`, () => {
      expect(certifiesLow(p), `${p} is outward-facing — it must not certify low-blast`).toBe(false);
    });
  }

  it('an outward-only `.md` diff (the #645 shape) is not certified', () => {
    // #645 — "re-state network posture off air-gapped → data-sovereignty + BYO-LLM":
    // `.md`-only, and it rewrites the product's PUBLIC network-posture claim.
    expect(certifiesLow('sites/minspec.dev/index.html', 'README.md')).toBe(false);
  });
});

describe('#1001 — outward-facing docs are refused by the docs-lane workflow', () => {
  for (const p of [
    'sites/minspec.dev/copy.md',
    'README.md',
    'packages/minspec/README.md',
    'docs/README.md',
    'CHANGELOG.md',
    'LICENSE',
    'LICENSE-CONTENT',
    'NOTICE',
    'packages/minspec/media/walkthrough/welcome.md',
  ]) {
    it(`docs-lane rejects as outward: ${p}`, () => {
      expect(ymlRejectsAsOutward(p), `${p} must be refused the docs-lane`).toBe(true);
    });
  }

  it('the workflow wires the denylist into its per-file loop and fails the job', () => {
    const yml = fs.readFileSync(docsLanePath, 'utf-8');
    expect(yml).toMatch(/outward='[^']+'/);
    // the loop must actually consult it …
    expect(yml).toMatch(/grep -qiE "\$outward"/);
    // … and a hit must FAIL the job (no auto-merge), not merely warn.
    const loopIdx = yml.indexOf("outward='");
    expect(yml.slice(loopIdx)).toMatch(/outward_bad[\s\S]*exit 1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. NO REGRESSION — the inward docs-lane (DR-051 / #575) still works
// ─────────────────────────────────────────────────────────────────────────────
describe('#1001 — inward docs still certify low-blast (no docs-lane regression)', () => {
  const inward = [
    'specs/minspec/SPEC-039-push-docs-lane-command/requirements.md',
    'specs/minspec/SPEC-001/design.md',
    'specs/minspec/SPEC-024/tasks.md',
    'docs/decisions/DR-001.md',
    'docs/decisions/INDEX.md',
    'docs/epics/EP-001.md',
    'docs/contract-driven-development.md',
  ];

  for (const p of inward) {
    it(`still certifies low-blast: ${p}`, () => {
      expect(certifiesLow(p), `${p} is inward — the docs-lane must not regress`).toBe(true);
    });
  }

  it('a multi-file inward docs diff still certifies', () => {
    expect(certifiesLow('specs/minspec/SPEC-001/design.md', 'docs/decisions/DR-001.md')).toBe(true);
  });

  it('a test-only diff still certifies (unchanged by #1001)', () => {
    expect(certifiesLow('packages/minspec/tests/foo.test.ts')).toBe(true);
  });

  it('docs-lane does NOT flag inward docs as outward', () => {
    for (const p of inward) {
      expect(ymlRejectsAsOutward(p), `${p} must still ride the docs-lane`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Taint — ONE outward path poisons the whole set
// ─────────────────────────────────────────────────────────────────────────────
describe('#1001 — one outward path taints a mixed diff', () => {
  it('inward specs + one outward README → NOT low-blast', () => {
    expect(certifiesLow('specs/minspec/SPEC-001/design.md', 'README.md')).toBe(false);
  });

  it('inward DR + one sites/ file → NOT low-blast', () => {
    expect(certifiesLow('docs/decisions/DR-001.md', 'sites/minspec.dev/index.html')).toBe(false);
  });

  it('tests + one outward CHANGELOG → NOT low-blast', () => {
    expect(certifiesLow('packages/minspec/tests/a.test.ts', 'CHANGELOG.md')).toBe(false);
  });

  it('a TEST file parked under sites/ is outward too (publish beats file-kind)', () => {
    expect(certifiesLow('sites/minspec.dev/smoke.test.ts')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Prefix near-misses must NOT false-positive (over-blocking is a regression too)
// ─────────────────────────────────────────────────────────────────────────────
describe('#1001 — near-misses do not false-positive', () => {
  const nearMiss = [
    'mysites/x.md', // `sites` is not a path prefix here
    'packages/minspec/src/sites/x.md', // nested `sites/` is source, not the deployed site
    'docs/websites.md', // substring only
    'READMEs.md', // NOT `README` — the basename must match exactly
    'CHANGELOGS.md',
    'docs/licensing-notes.md', // `LICEN[CS]E` must be a basename, not a substring
  ];

  for (const p of nearMiss) {
    it(`still certifies low-blast: ${p}`, () => {
      expect(certifiesLow(p), `${p} is a near-miss — it must not be over-blocked`).toBe(true);
    });
    it(`docs-lane does not flag: ${p}`, () => {
      expect(ymlRejectsAsOutward(p)).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Fail closed — an unclassifiable path never certifies low-blast
// ─────────────────────────────────────────────────────────────────────────────
describe('#1001 — unclassifiable paths fail CLOSED', () => {
  for (const p of [
    '', // empty
    '   ', // whitespace only
    '/etc/passwd.md', // absolute — not repo-relative, cannot be classified
    '/sites/minspec.dev/index.html',
    '../outside/README.md', // parent escape
    'docs/../sites/minspec.dev/index.html', // escape that would re-enter as sites/
    'specs/../../etc/x.md',
  ]) {
    it(`does NOT certify low-blast: ${JSON.stringify(p)}`, () => {
      expect(certifiesLow(p), `${JSON.stringify(p)} is unclassifiable — must fail closed`).toBe(false);
    });
  }

  it('one unclassifiable path taints an otherwise-inward diff', () => {
    expect(certifiesLow('docs/decisions/DR-001.md', '../outside/x.md')).toBe(false);
  });

  it('Windows separators are normalized before classification (no separator bypass)', () => {
    expect(certifiesLow('sites\\minspec.dev\\copy.md')).toBe(false);
    expect(certifiesLow('packages\\minspec\\README.md')).toBe(false);
    // …while a genuine inward doc with Windows separators still certifies
    expect(certifiesLow('specs\\minspec\\SPEC-001\\design.md')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. LOCK-STEP — the two enforcers share one catalogue, character for character
// ─────────────────────────────────────────────────────────────────────────────
describe('#1001 — lock-step: auto-merge-gate.ts and docs-lane.yml cannot disagree', () => {
  it("docs-lane.yml `outward=` is byte-identical to OUTWARD_DOC_PATTERN", () => {
    expect(ymlOutwardPattern()).toBe(tsOutwardPattern());
  });

  it('the pattern is a plain ERE (portable to both grep -E and JS RegExp)', () => {
    const p = tsOutwardPattern();
    // No JS-only constructs: no lookaround, no `\d`/`\w` shorthand, no lazy quantifier.
    expect(p).not.toMatch(/\(\?[=!<]/);
    expect(p).not.toMatch(/\\[dws]/i);
    // and it must compile in JS
    expect(() => new RegExp(p, 'i')).not.toThrow();
  });

  it('the gate comments the inverted-proxy rationale next to the constant', () => {
    const src = fs.readFileSync(gateSrcPath, 'utf-8');
    const idx = src.indexOf('OUTWARD_DOC_PATTERN');
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, idx - 3000), idx)).toMatch(/#1001/);
  });
});
