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
 * load-bearing property is the LAST test here: **MinSpec must never apply these itself.**
 * Constitution invariant 1 — core functionality works offline, no network call without
 * explicit consent — so creating a label on a forge is always a command the human runs.
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
  it('MinSpec never creates or reads a label itself — the file says so, and the code obeys', () => {
    expect(rendered()).toMatch(/never creates, edits, or reads a label/i);

    // Assert the extension source contains no label-mutating forge call. The template
    // string itself is documentation, so exclude the registry that holds it.
    const libDir = path.resolve(__dirname, '../src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        if (entry.name === 'template-registry.ts') continue; // holds the documented script
        const src = fs.readFileSync(full, 'utf-8');
        // Matches the STATED invariant, not a subset of it: ANY `gh label` subcommand
        // (including the reads `list` / `view` / `clone`) and any forge REST path ending
        // in `/labels`. The first version checked only create|edit|delete, so its name
        // promised more than it verified.
        if (/gh\s+label\b/.test(src) || /["'`][^"'`]*\/labels(\/|["'`?])/.test(src)) offenders.push(full);
      }
    };
    walk(libDir);
    expect(offenders, `extension source must not mutate labels: ${offenders.join(', ')}`).toEqual([]);
  });

  it.each([
    'await run("gh label create foo")',
    'await run("gh label delete foo")',
    'await run("gh label list")',            // a READ — the stated invariant covers it
    'await api("repos/o/r/labels")',         // forge REST, no gh CLI involved
    "await api('repos/o/r/labels/bug')",
  ])('the offender scan is not vacuous — it catches %s', (sample) => {
    const hit = /gh\s+label\b/.test(sample) || /["'`][^"'`]*\/labels(\/|["'`?])/.test(sample);
    expect(hit).toBe(true);
  });

  it('…and does not fire on unrelated code', () => {
    for (const benign of ['const labels = node.labels;', 'issue.labels.map(l => l.name)', '"/label-maker"']) {
      const hit = /gh\s+label\b/.test(benign) || /["'`][^"'`]*\/labels(\/|["'`?])/.test(benign);
      expect(hit, benign).toBe(false);
    }
  });
});
