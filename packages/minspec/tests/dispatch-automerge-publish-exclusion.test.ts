/**
 * T0/T3 — #981: dispatch native auto-merge (DR-061) must NOT arm on a PR whose
 * merge PUBLISHES to the public internet (`sites/**` → Cloudflare Pages).
 *
 * Root cause (repro confirmed live 2026-07-26, pre-fix): `run_reviewer_stage`'s
 * DR-061 arm site arms `gh pr merge --auto` for any dispatched PR whose changed
 * paths fail `paths_have_approvable_doc`. That withhold set was built from two
 * OWNERSHIP mandates (docs-lane corpus, `.minspec/` governance config) and asked
 * only "who owns this content?" — never "what does landing it DO?". `sites/**`
 * belongs to neither, so it fell through to `arm`, and
 * `.github/workflows/deploy-sites.yml` (`on: push → main → paths: sites/**`) turns
 * that merge into a public `wrangler pages deploy`. Result: a `sites/**`-only agent
 * PR with a genuine `ai-review:pass` merged itself and published publicly with ZERO
 * human keystrokes. The missing gate: no path classifier keyed on deploy/publish
 * CONSEQUENCE existed; the maintainer's "published sites are human-only" policy
 * lived only as prose in an LLM triage prompt (`scripts/roles/triage.md:38`) — an
 * instruction the model must remember, not a gate. Constitution invariant DR-066
 * ("no silent gate") + "enforce via code, don't hope" ⇒ deterministic withhold.
 *
 * The fix adds mandate 3 (`PUBLISH_PATH_RE`) to the SAME withhold seam, so the one
 * arm site keeps one decision point — and pins it in LOCK-STEP with the workflow
 * that makes it load-bearing (see the sync suite below), so a newly-deployed
 * directory added to `deploy-sites.yml` cannot silently escape the withhold.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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
const deployWorkflowPath = path.join(root, '.github', 'workflows', 'deploy-sites.yml');

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

describe('dispatch-issue.sh — publish-path auto-merge exclusion (#981)', () => {
  describe('HOLDS auto-merge (exit 0) — anything whose merge publishes publicly', () => {
    for (const p of [
      // sites/** — every deployed file, any depth. THESE ARE THE LIVE HOLE:
      // pre-fix each of them returned `arm`.
      'sites/minspec.dev/index.html',
      'sites/minspec.dev/js/waitlist.js',
      'sites/minspec.dev/functions/api/waitlist.js', // nested Pages Function
      'sites/minspec.dev/img/logo.svg',
      'sites/robots.txt',
      // the deploy definition itself is also an `on.push` path trigger
      '.github/workflows/deploy-sites.yml',
    ]) {
      it(`holds: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(0);
        expect(r.out).toBe('hold');
      });
    }

    it('holds a MIXED PR (code + one publish path)', () => {
      const r = classify('packages/minspec/src/lib/foo.ts\nsites/minspec.dev/index.html\n');
      expect(r.code).toBe(0);
      expect(r.out).toBe('hold');
    });
  });

  describe('NO OVER-BLOCK (exit 1) — ordinary code still arms', () => {
    for (const p of [
      'packages/minspec/src/lib/foo.ts',
      'packages/minspec/src/lib/classifier.ts',
      'packages/minspec/tests/foo.test.ts',
      'package.json',
      // prefix precision: `^sites/` is anchored, so these are NOT publish paths
      'mysites/index.html',
      'websites/foo.ts',
      'packages/minspec/src/sites/foo.ts',
      // NB `scripts/dispatch-issue.sh` and `.github/workflows/ai-review.yml` used to
      // sit in this arm-list as non-publish paths; since #1264 they hold via the
      // MACHINERY mandate — see dispatch-automerge-machinery-exclusion.test.ts.
    ]) {
      it(`arms: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(1);
        expect(r.out).toBe('arm');
      });
    }
  });

  describe('PRESERVED — the two pre-existing mandates still hold (#833/#834)', () => {
    for (const p of [
      'specs/minspec/SPEC-031-reviewer-all-approvables/requirements.md',
      'docs/decisions/DR-061.md',
      '.minspec/approvals/DR-001.md.json',
      'README.md',
      '.minspec/config.json',
      '.cursorrules',
    ]) {
      it(`holds: ${p}`, () => {
        const r = classify(p + '\n');
        expect(r.code, r.out).toBe(0);
        expect(r.out).toBe('hold');
      });
    }
  });

  describe('LOCK-STEP: PUBLISH_PATH_RE still covers every publish trigger in deploy-sites.yml', () => {
    const yml = fs.readFileSync(deployWorkflowPath, 'utf-8');

    /**
     * Collect the `paths:` list nested under `on: push:`. Hand-scanned rather than
     * YAML-parsed on purpose: `js-yaml` is only a transitive dep here, and the house
     * lock-step tests (docs-lane.yml `allowed=`) already pin workflow text directly.
     * Indentation contract: `push:` at 2, `paths:` at 4, items at 6.
     */
    function parseOnPushPaths(source: string): string[] {
      const lines = source.split('\n');
      const start = lines.findIndex((l) => /^on:\s*$/.test(l));
      if (start < 0) throw new Error('no top-level `on:` block in deploy-sites.yml');
      const paths: string[] = [];
      let inPush = false;
      let inPaths = false;
      for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') continue;
        const indent = line.length - line.trimStart().length;
        if (indent === 0) break; // left the `on:` block
        if (indent === 2) {
          inPush = /^\s*push:\s*$/.test(line);
          inPaths = false;
          continue;
        }
        if (!inPush) continue;
        if (indent === 4) {
          inPaths = /^\s*paths:\s*$/.test(line);
          continue;
        }
        if (inPaths && /^\s*-\s+/.test(line)) {
          paths.push(line.trim().replace(/^-\s+/, '').replace(/^['"]|['"]$/g, ''));
        }
      }
      return paths;
    }

    /** Materialize a concrete file path a glob would match, to feed the real seam. */
    function probeFor(glob: string): string {
      if (glob.endsWith('/**')) return glob.slice(0, -3) + '/probe-dir/probe-file.txt';
      return glob.replace(/\*\*/g, 'probe-dir/probe-file').replace(/\*/g, 'probe');
    }

    const pushPaths = parseOnPushPaths(yml);

    // Both directions (validator-asymmetry class): assert the parse FOUND something
    // and found the expected shape, so a silently-empty scan can never vacuously pass
    // the per-path assertions below.
    it('the workflow scan actually found the push-path triggers', () => {
      expect(pushPaths.length).toBeGreaterThan(0);
      expect(pushPaths).toContain('sites/**');
    });

    for (const glob of pushPaths) {
      it(`withholds auto-merge for on.push path: ${glob}`, () => {
        const probe = probeFor(glob);
        const r = classify(probe + '\n');
        expect(
          r.out,
          `deploy-sites.yml deploys on '${glob}' (probe '${probe}') but PUBLISH_PATH_RE ` +
            `in scripts/dispatch-issue.sh does not cover it — a merge of that path would ` +
            `publish publicly with no human keystroke (#981).`,
        ).toBe('hold');
      });
    }

    // Second axis: the deploy matrix. `paths:` says WHEN the workflow runs; the matrix
    // says WHAT it uploads. A new deployed directory shows up here too.
    const matrixDirs = [...yml.matchAll(/^\s*-\s+dir:\s*(\S+)\s*$/gm)].map((m) => m[1]);

    it('the workflow scan actually found the deploy matrix dirs', () => {
      expect(matrixDirs.length).toBeGreaterThan(0);
    });

    for (const dir of matrixDirs) {
      it(`withholds auto-merge for deployed dir: ${dir}`, () => {
        const r = classify(dir + '/index.html\n');
        expect(
          r.out,
          `deploy-sites.yml uploads '${dir}' to a public Cloudflare Pages project but ` +
            `PUBLISH_PATH_RE does not cover it (#981).`,
        ).toBe('hold');
      });
    }
  });

  describe('static: the publish mandate is a documented constant, wired at the arm site', () => {
    const content = fs.readFileSync(scriptPath, 'utf-8');

    it('defines PUBLISH_PATH_RE covering sites/**', () => {
      const m = content.match(/^PUBLISH_PATH_RE='([^']+)'/m);
      expect(m, 'PUBLISH_PATH_RE not defined in dispatch-issue.sh').not.toBeNull();
      expect(m![1]).toContain('^sites/');
    });

    it('names deploy-sites.yml as what makes it load-bearing (not a blind regex)', () => {
      const idx = content.indexOf("PUBLISH_PATH_RE='");
      const preamble = content.slice(Math.max(0, idx - 1800), idx);
      expect(preamble).toMatch(/deploy-sites\.yml/);
      expect(preamble).toMatch(/wrangler pages deploy|Cloudflare Pages/);
    });

    it('the withhold classifier includes the publish mandate', () => {
      // `.` (no /s) stops at the newline — the body is the single grep line. A
      // `[^}]*` body match would false-negative on the `${DOCS_CORPUS_RE}` brace.
      const fn = content.match(/paths_have_approvable_doc\(\) \{\n(.*)\n\}/);
      expect(fn, 'paths_have_approvable_doc() not found').not.toBeNull();
      expect(fn![1]).toMatch(/\$\{PUBLISH_PATH_RE\}/);
    });

    it('the docblock documents FOUR mandates, not two', () => {
      const idx = content.indexOf('paths_have_approvable_doc() {');
      const doc = content.slice(Math.max(0, idx - 4000), idx);
      expect(doc).toMatch(/UNION of four intentionally-distinct mandates/);
      expect(doc).toMatch(/PUBLISH_PATH_RE \(#981\)/);
      expect(doc).toMatch(/MACHINERY_PATH_RE \(#1264\)/);
    });

    it('the arm site names the publish mandate in the withhold message (never-wrong)', () => {
      const guardIdx = content.indexOf('if native_automerge_enabled; then');
      const armBlock = content.slice(guardIdx);
      expect(armBlock).toMatch(/merging IS publishing \(#981\)/);
      // the classifier — not a second, driftable predicate — remains the decision
      expect(armBlock).toMatch(/paths_have_approvable_doc <<<"\$changed_files"/);
    });

    it('still fails CLOSED on an unknown/unreadable changed-set (unchanged, re-pinned)', () => {
      expect(content).toMatch(/if !\s*changed_files=\$\(gh pr diff "\$pr_num"[^\n]*--name-only/);
      expect(content).toMatch(/empty changed-file enumeration; failing closed/);
    });
  });
});
