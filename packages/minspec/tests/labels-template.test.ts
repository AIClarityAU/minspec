/**
 * T0 — the shipped label vocabulary (`.minspec/labels.md`).
 *
 * MinSpec's triage step classifies an issue by its TYPE, and reads the issue's type label
 * as one of its inputs. A type it is told to recognise but that does not exist as a label
 * is an input that is always absent — the classification then rests on body text alone.
 * This repo hit exactly that: `chore` was in the triage vocabulary and had no label, so
 * `gh issue create --label chore` failed.
 *
 * The template ships the vocabulary as documentation plus a copy-paste script. The
 * load-bearing property is the LAST block here: **MinSpec must never apply these itself.**
 * Constitution invariant 1 — core functionality works offline, no network call without
 * explicit consent — so creating a vocabulary label on a forge is always a command the
 * human runs. The single exception (#2243) is not a vocabulary label: the approval flow
 * may create `docs-lane`, inside a push the human already consented to, and that block
 * pins it to exactly one call site.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderTemplate, type TemplateContext } from '../src/lib/template-engine';
import { TEMPLATE_NAMES, TEMPLATE_OUTPUT_PATHS } from '../src/lib/template-registry';

const ctx = {
  projectName: 'TestProject',
  specsDir: 'specs',
  decisionsDir: 'docs/decisions',
} as unknown as TemplateContext;

const rendered = (): string => renderTemplate('labels.md', ctx);

describe('labels.md template', () => {
  it('is a scaffolded, refresh-managed template', () => {
    // Membership in TEMPLATE_NAMES is exactly "scaffolded + refresh-managed" — both
    // generateHarnessFiles and refreshHarnessFiles loop over it.
    expect(TEMPLATE_NAMES).toContain('labels.md');
  });

  it('lands inside .minspec/ — the opt-in marker, per invariant 3', () => {
    // MinSpec's blast radius is the project it is installed in. A file under `.minspec/`
    // exists only in a repo that opted in by having `.minspec/` at all.
    expect(TEMPLATE_OUTPUT_PATHS['labels.md']).toBe('.minspec/labels.md');
  });

  it('renders with no unsubstituted placeholders', () => {
    expect(rendered()).not.toMatch(/\{\{/);
  });

  /**
   * Derive the expected vocabulary FROM `scripts/roles/triage.md` — never a list written
   * here. The first version of this test hardcoded `documentation`; triage classifies
   * against `docs`. It passed green while `gh issue create --label docs` failed, i.e. it
   * asserted a vocabulary the author invented and re-created the exact gap the template
   * exists to close. A fixture that encodes the assumption under test proves nothing.
   */
  const TRIAGE_ROLE = path.resolve(__dirname, '../../../scripts/roles/triage.md');

  /** Backticked tokens inside the two type paragraphs of the triage role. */
  function declaredTypes(): string[] {
    const src = fs.readFileSync(TRIAGE_ROLE, 'utf-8');
    const grab = (heading: string): string[] => {
      const i = src.indexOf(heading);
      if (i < 0) throw new Error(`triage role has no "${heading}" section — parser is stale`);
      const para = src.slice(i, src.indexOf('\n\n**How to apply', i) > -1
        ? Math.min(src.indexOf('\n\n**', i + heading.length) + 1 || src.length, src.length)
        : src.length);
      return [...para.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]);
    };
    const tokens = [...grab('**Auto-buildable types**'), ...grab('**Human-only types**')];
    // `agent-ready` appears in that prose as the LIFECYCLE label a type may reach.
    // It is not a type, and the template says explicitly that it must never be pre-applied.
    return [...new Set(tokens.filter((t) => t !== 'agent-ready'))];
  }

  it('the triage role is readable and declares a non-trivial vocabulary', () => {
    // Guard the guard: if the parser silently returned [], every assertion below would
    // pass vacuously — which is precisely the failure this rewrite exists to prevent.
    expect(fs.existsSync(TRIAGE_ROLE), `${TRIAGE_ROLE} missing`).toBe(true);
    const types = declaredTypes();
    expect(types.length).toBeGreaterThan(8);
    expect(types).toContain('chore');   // the type whose absence started this
    expect(types).toContain('docs');    // the type the first version of this test got wrong
  });

  it('documents every type the triage role classifies against, IN THE TABLE', () => {
    // Scoped to table rows, not the whole document. A plain `toContain` was satisfiable by
    // the explanatory note further down — which mentions `docs` while describing this very
    // bug — so prose ABOUT the fix made the assertion pass on the broken table. Anything a
    // narrative sentence can satisfy is not a check on the artifact.
    const rows = rendered()
      .split('\n')
      .filter((l) => l.startsWith('| `'))
      .join('\n');
    for (const type of declaredTypes()) {
      expect(rows, `type \`${type}\` is declared by triage.md but has no row in the type table`)
        .toContain(`\`${type}\``);
    }
  });

  it('ships a create line for every type the triage role classifies against', () => {
    const out = rendered();
    const created = (out.match(/^gh label create \S+/gm) ?? []).map((l) =>
      l.replace('gh label create ', ''),
    );
    for (const type of declaredTypes()) {
      expect(created, `no \`gh label create ${type}\` line — the type would stay unusable`)
        .toContain(type);
    }
  });

  it('every create line is idempotent, so the block is safe to re-run', () => {
    for (const line of rendered().split('\n').filter((l) => l.startsWith('gh label create'))) {
      expect(line).toContain('--force');
    }
  });

  it('states that agent-ready is the gate OUTPUT, never its input', () => {
    // The lesson from #1134: the issue template handed `agent-ready` to any internet
    // user, so the label was never a permission. Anyone shipping this vocabulary into a
    // new repo needs to be told that before they wire it into a template.
    const out = rendered();
    expect(out).toMatch(/OUTPUT, never its input/i);
    expect(out).toMatch(/Do not pre-apply/i);
  });

  it('says human-only is about AUTHORSHIP, not difficulty', () => {
    // DR-072 §3 / DR-070 §5.2. Without this the reader assumes human-only means "hard",
    // and reclassifies a one-word copy change as auto-buildable.
    expect(rendered()).toMatch(/AUTHORSHIP, not difficulty/i);
  });

  // ── The invariant this whole template rests on ───────────────────────────
  //
  // #2243 narrowed it by exactly ONE call, and the tests below are what keep it at one.
  // Approvals in voip-sms-inbox needed an `Open PR` click and a manual merge because that
  // repository had no `docs-lane` label, and gh will not open a PR that names a missing
  // label. The fix lets the approval flow create THAT label, inside the push the user has
  // already consented to: the rationale above is constitution invariant 1, which is about
  // consent, and this write happens only inside a consented act. Nothing else moved. No
  // other label is created, edited or read, and no other file may make such a call.

  /** Every way extension source can reach a forge label OBJECT. */
  const LABEL_CALL_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
    // A shell-string invocation: `run("gh label create foo")`.
    ['gh label (shell string)', /gh\s+label\b/],
    // A forge REST path ending in /labels: `api('repos/o/r/labels')`.
    ['REST /labels path', /["'`][^"'`]*\/labels(\/|["'`?])/],
    // An argv array handed to execFile: `run('gh', ['label', 'create', …])`. This is the
    // form every gh call in this codebase actually uses, and the scan before #2243 could
    // not see it at all — a label call written the normal way passed it untouched.
    ['gh label (argv array)', /\[\s*["'`]label["'`]\s*,\s*["'`](create|edit|delete|list|view|clone)["'`]/],
  ];
  const ARGV_LABEL_CALL = /\[\s*["'`]label["'`]\s*,\s*["'`](create|edit|delete|list|view|clone)["'`]/g;

  const labelCalls = (src: string): string[] =>
    LABEL_CALL_PATTERNS.filter(([, re]) => re.test(src)).map(([name]) => name);

  /** The ONE sanctioned site (#2243): the lane-label create in the PR seam. */
  const SANCTIONED = path.join('lib', 'approval-pr.ts');
  /** The only caller allowed to switch it on: the approval flow (SPEC-050). */
  const OPT_IN_CALLER = path.join('commands', 'commit-on-approve.ts');

  const SRC_DIR = path.resolve(__dirname, '../src');
  /** Every extension source file, repo-relative to src/. The registry holds the documented script, so it is exempt. */
  function srcFiles(): Array<{ rel: string; src: string }> {
    const out: Array<{ rel: string; src: string }> = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name === 'template-registry.ts') continue; // holds the documented script
        out.push({ rel: path.relative(SRC_DIR, full), src: fs.readFileSync(full, 'utf-8') });
      }
    };
    walk(SRC_DIR);
    return out;
  }

  it('the file states the invariant AND its one exception', () => {
    const out = rendered();
    expect(out).toMatch(/never creates, edits, or reads any of these labels/i);
    // The exception is named in the artifact a maintainer reads, not only in code.
    expect(out).toMatch(/single exception: `docs-lane`/);
    expect(out).toMatch(/never edits a `docs-lane` label that already exists/i);
  });

  it('no extension source reaches a label object, except the one sanctioned site', () => {
    const files = srcFiles();
    // Guard the guard: an empty walk would pass vacuously.
    expect(files.length).toBeGreaterThan(50);
    expect(files.map((f) => f.rel)).toContain(SANCTIONED);
    const offenders = files
      .filter((f) => f.rel !== SANCTIONED && labelCalls(f.src).length > 0)
      .map((f) => `${f.rel} (${labelCalls(f.src).join(', ')})`);
    expect(offenders, `extension source must not reach forge labels: ${offenders.join('; ')}`).toEqual([]);
  });

  it('the sanctioned site makes exactly one label call: a create of DOCS_LANE_LABEL', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, SANCTIONED), 'utf-8');
    // No shell-string or REST form at all, and exactly one argv-form call…
    expect(labelCalls(src)).toEqual(['gh label (argv array)']);
    expect(src.match(ARGV_LABEL_CALL) ?? []).toHaveLength(1);
    // …which is a CREATE of MinSpec's own constant, never a name taken from input.
    expect(src).toMatch(/\[\s*'label',\s*'create',\s*DOCS_LANE_LABEL,/);
  });

  it('only the approval flow opts in to that create — SPEC-039 and every other caller do not', () => {
    const optIns = srcFiles()
      .filter((f) => f.rel !== SANCTIONED && /\bprovisionLaneLabel\b/.test(f.src))
      .map((f) => f.rel);
    expect(optIns).toEqual([OPT_IN_CALLER]);
  });

  // The narrowing is a DECISION, and the ai-review Architect blocked #2259 for shipping it
  // with none on record (constitution principle 6: record hard-to-reverse decisions before
  // implementing). The scan above pins WHERE the write may happen; this pins WHY it may,
  // so the sanctioned site can never again exist without its record. Every read fails
  // closed: a missing file throws, and a throw fails the test.
  const LANE_LABEL_DR = 'DR-098';
  const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

  it(`the sanctioned site is recorded: ${LANE_LABEL_DR} is in force and names it, and SPEC-050's design covers it`, () => {
    const cites = new RegExp(`\\b${LANE_LABEL_DR}\\b`);
    // The code points at its decision…
    expect(fs.readFileSync(path.join(SRC_DIR, SANCTIONED), 'utf-8')).toMatch(cites);
    // …the decision exists, is in force, and is about THIS write, not just any record
    // that happens to carry the number…
    const dr = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'decisions', `${LANE_LABEL_DR}.md`), 'utf-8');
    expect(dr).toMatch(new RegExp(`^id:\\s*${LANE_LABEL_DR}\\s*$`, 'm'));
    expect(dr).toMatch(/^status:\s*(proposed|accepted)\s*$/m);
    for (const symbol of ['DOCS_LANE_LABEL', 'buildLaneLabelCreateArgs', 'laneWorkflowPresent']) {
      expect(dr, `${LANE_LABEL_DR} must name ${symbol}`).toContain(symbol);
    }
    // …and the owning spec's design carries it. SPEC-050's approved requirements predate
    // the capability and are hash-locked (#2330 tracks their wording).
    const design = fs.readFileSync(
      path.join(REPO_ROOT, 'specs', 'minspec', 'SPEC-050-silent-approval-pr', 'design.md'),
      'utf-8',
    );
    expect(design).toMatch(cites);
    expect(design).toContain('provisionLaneLabel');
  });

  const scanHits = (sample: string): boolean => LABEL_CALL_PATTERNS.some(([, re]) => re.test(sample));

  it.each([
    'await run("gh label create foo")',
    'await run("gh label delete foo")',
    'await run("gh label list")',            // a READ — the stated invariant covers it
    'await api("repos/o/r/labels")',         // forge REST, no gh CLI involved
    "await api('repos/o/r/labels/bug')",
    "await run('gh', ['label', 'create', 'foo'])",          // argv form (#2243)
    'await execFileAsync("gh", [\n  "label",\n  "list",\n])', // argv form, one element per line
  ])('the offender scan is not vacuous — it catches %s', (sample) => {
    expect(scanHits(sample)).toBe(true);
  });

  it('…and does not fire on unrelated code', () => {
    for (const benign of [
      'const labels = node.labels;',
      'issue.labels.map(l => l.name)',
      '"/label-maker"',
      "const cols = ['label', 'value'];",
      "run('gh', ['issue', 'edit', '1', '--add-label', 'x'])", // applies a label; creates none
    ]) {
      expect(scanHits(benign), benign).toBe(false);
    }
  });
});
