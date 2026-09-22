/**
 * #871 — `.github/scripts/ai-review-guard.test.js` is a parity-managed file.
 *
 * ROOT CAUSE this suite gates: `scripts/gen-ci-templates.mjs` and
 * `MANAGED_REGION_TEMPLATES` both enumerate `.github/scripts/ai-review-guard.js`, and
 * NOTHING enumerated its test. An enumeration with no entry for a file has no predicate
 * over that file, so a guard change could not fail any gate on a stale or absent
 * downstream test — measured twice: scroogellm carried a 568-line copy that went stale
 * the moment the guard's most-recent-by-`created_at` reducer advanced (scrooge#82), and
 * sealbox merged the guard with no test file at all (sealbox#18), both green.
 *
 * Same class as #1486 (the machinery-path comment in `ai-review.yml` claimed a coverage
 * that existed only in MinSpec's repo). #1486 removed the false claim on the way out;
 * this makes the equivalent claim in the guard's own header TRUE instead, by shipping
 * the suite it points at.
 *
 * The second half of the suite is the gate's own fail-closed property (constitution
 * invariant 2): a parity check that cannot READ a managed source must fail visibly, not
 * skip it. Registering a file in an enumeration is worthless if the gate that walks the
 * enumeration treats an unreadable entry as a pass.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';
import { generateHarnessFiles } from '../src/lib/scaffold';
// Namespace import (not named): before #871 lands, `CI_TEMPLATE_SOURCE_PATHS` does not
// exist, and a named import would make the whole FILE fail to load — one opaque red
// instead of a red per claim. This way each assertion below states what is missing.
import * as gen from '../../../scripts/gen-ci-templates.mjs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GUARD = '.github/scripts/ai-review-guard.js';
const GUARD_TEST = '.github/scripts/ai-review-guard.test.js';

const byPath = (p: string) => MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === p);

/** Copy every generator source into a scratch root, optionally omitting one. */
function stageSources(omit?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-871-src-'));
  const paths: readonly string[] = gen.CI_TEMPLATE_SOURCE_PATHS ?? [];
  for (const rel of paths) {
    if (rel === omit) continue;
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  }
  return root;
}

describe('#871 — the guard and its test are one parity-managed unit', () => {
  it('the generator enumerates the test as a source, alongside the guard', () => {
    const paths: readonly string[] = gen.CI_TEMPLATE_SOURCE_PATHS ?? [];
    expect(
      paths,
      'gen-ci-templates.mjs must export CI_TEMPLATE_SOURCE_PATHS so a gate can walk ' +
        'exactly the files the embedded copies are generated from',
    ).toContain(GUARD);
    expect(
      paths,
      `${GUARD_TEST} is not a generator source, so nothing byte-syncs it with the guard ` +
        'it tests (#871)',
    ).toContain(GUARD_TEST);
  });

  it('the generated CI-review templates embed the test', () => {
    const rendered: string = gen.generateCiReviewTemplates(REPO_ROOT);
    expect(rendered).toContain('export const AI_REVIEW_GUARD_JS');
    expect(rendered).toContain('export const AI_REVIEW_GUARD_TEST_JS');
  });

  it('an adopter repo is scaffolded the test as well as the guard', () => {
    expect(byPath(GUARD), `${GUARD} is a managed template`).toBeDefined();
    const tpl = byPath(GUARD_TEST);
    expect(
      tpl,
      `${GUARD_TEST} is not in MANAGED_REGION_TEMPLATES, so an adopter receives the ` +
        'guard without the suite its own header points at (#871)',
    ).toBeDefined();
    expect(tpl!.commentStyle).toBe('slash');
    expect(tpl!.executable).toBeFalsy();
    expect(tpl!.preamble).toBeUndefined();
    // Tool-independent, exactly like the guard: no `condition`.
    expect(tpl!.condition).toBeUndefined();
  });

  it('the shipped copy is byte-identical to this repo’s own working file', () => {
    const tpl = byPath(GUARD_TEST);
    expect(tpl, `${GUARD_TEST} is not a managed template`).toBeDefined();
    expect(tpl!.content).toBe(fs.readFileSync(path.join(REPO_ROOT, GUARD_TEST), 'utf-8'));
  });

  it('the guard’s header no longer says its test suite stays behind', () => {
    // The claim is now shipped-true. Leaving the old sentence would make the guard
    // lie in the opposite direction — the never-wrong-signpost defect, just inverted.
    const guard = fs.readFileSync(path.join(REPO_ROOT, GUARD), 'utf-8');
    expect(guard).toContain('ai-review-guard.test.js');
    expect(guard).not.toMatch(/its test suite does not/);
  });
});

describe('#871 — the parity gate fails CLOSED on an unreadable managed source (invariant 2)', () => {
  it('generating from a root whose managed guard test is missing THROWS, naming it', () => {
    const root = stageSources(GUARD_TEST);
    try {
      let thrown: unknown;
      try {
        gen.generateAll(root);
      } catch (e) {
        thrown = e;
      }
      expect(
        thrown,
        'a managed source that cannot be read must fail the gate closed, not be skipped',
      ).toBeDefined();
      expect(String((thrown as Error).message)).toContain('ai-review-guard.test.js');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('control: with every managed source present, generating succeeds', () => {
    // Without this, the assertion above would also pass on a root where generation
    // throws for an unrelated reason — proving nothing about the omitted file.
    const root = stageSources();
    try {
      expect(() => gen.generateAll(root)).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('the corpus validator REPORTS the unreadable source instead of skipping rule 12', () => {
    // `npm run validate` is the commit/PR-time witness for template staleness. Its
    // rule 12 wrapped the whole loop in `try { … } catch { /* stay silent */ }`, so an
    // absent managed source made the rule pass quietly — the gate that is supposed to
    // notice a missing managed file was the one gate guaranteed not to.
    const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
    if (!fs.existsSync(tsx)) {
      // Deliberately a HARD failure, not a skip: this assertion is the whole point of
      // the rule-12 change, and a silent skip here would repeat the defect under test.
      throw new Error('node_modules/.bin/tsx is absent — cannot verify rule 12 fails closed');
    }
    const script = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');
    const GENERATED = [
      'packages/minspec/src/lib/ci-review-templates.ts',
      'packages/minspec/src/lib/hook-templates.ts',
    ];

    const run = (root: string) =>
      spawnSync(tsx, [script], { cwd: root, encoding: 'utf-8', env: { ...process.env } });

    const stage = (omit?: string) => {
      const root = stageSources(omit);
      for (const rel of GENERATED) {
        const dest = path.join(root, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
      }
      return root;
    };

    const ok = stage();
    const broken = stage(GUARD_TEST);
    // A tree that holds NO generated file at all: `npm run validate` is also pointed at
    // scratch corpora (see validate-frontmatter-claim-words.test.ts), and "this is not
    // the repo that owns the embedded templates" must stay a different answer from "a
    // managed source is missing". Pinned here so the applicability test can never widen
    // back into the blanket catch this change removed.
    const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-871-unrelated-'));
    fs.mkdirSync(path.join(unrelated, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(unrelated, 'docs', 'probe.md'), '# Probe\n', 'utf-8');
    try {
      const control = run(ok);
      const missing = run(broken);
      const outOfScope = run(unrelated);
      const said = (r: ReturnType<typeof run>) =>
        `${r.stdout ?? ''}${r.stderr ?? ''}`.includes('gen-ci-templates.mjs');
      expect(said(control), 'control: a complete source tree must NOT report rule 12').toBe(false);
      expect(
        said(missing),
        'an absent managed source must be REPORTED by rule 12, not swallowed',
      ).toBe(true);
      expect(missing.status, 'and it must be fatal').not.toBe(0);
      expect(
        said(outOfScope),
        'a tree that owns no generated template is out of scope, not broken',
      ).toBe(false);
      expect(outOfScope.status, 'and stays clean').toBe(0);
    } finally {
      fs.rmSync(ok, { recursive: true, force: true });
      fs.rmSync(broken, { recursive: true, force: true });
      fs.rmSync(unrelated, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('#871 — the shipped test runs where it lands', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-871-scaffold-'));
    generateHarnessFiles(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('a scaffolded repo’s ai-review-guard.test.js passes under `node --test`', () => {
    // Shipping a suite that cannot RUN in the repo it lands in would re-create the
    // defect in a new dress: the guard's header would point at a file that reds on
    // arrival. The suite reads its sibling workflows (ai-review.yml, docs-lane.yml),
    // which the same scaffold writes — this proves that dependency chain is complete.
    const suite = path.join(tmpDir, GUARD_TEST);
    expect(fs.existsSync(suite), `${GUARD_TEST} scaffolded`).toBe(true);
    const r = spawnSync(process.execPath, ['--test', GUARD_TEST], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    expect(`${r.stdout}\n${r.stderr}`).toContain('# fail 0');
    expect(r.status, `node --test failed in the scaffolded repo:\n${r.stdout}\n${r.stderr}`).toBe(0);
  }, 180_000);
});
