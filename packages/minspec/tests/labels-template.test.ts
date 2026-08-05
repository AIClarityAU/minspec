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

  it('documents every type the triage role classifies against', () => {
    const out = rendered();
    for (const type of [
      'bug', 'feat', 'chore', 'refactor', 'test', 'ci', 'documentation',
      'idea', 'decide', 'copy', 'marketing', 'positioning', 'legal', 'monetization',
    ]) {
      expect(out, `type ${type} missing from the vocabulary`).toContain(`\`${type}\``);
    }
  });

  it('ships a runnable create block covering the documented types', () => {
    const out = rendered();
    const creates = out.match(/^gh label create \S+/gm) ?? [];
    const named = creates.map((l) => l.replace('gh label create ', ''));
    for (const type of ['bug', 'feat', 'chore', 'refactor', 'test', 'ci', 'decide', 'copy']) {
      expect(named, `no create line for ${type}`).toContain(type);
    }
    // `--force` so re-running after a description edit updates instead of failing.
    for (const line of out.split('\n').filter((l) => l.startsWith('gh label create'))) {
      expect(line, 'create line must be idempotent').toContain('--force');
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
        if (/gh\s+label\s+(create|edit|delete)/.test(src)) offenders.push(full);
      }
    };
    walk(libDir);
    expect(offenders, `extension source must not mutate labels: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the offender scan is not vacuous — it would catch a real call', () => {
    // Guard the guard: prove the regex matches the thing it is looking for.
    expect(/gh\s+label\s+(create|edit|delete)/.test('await exec("gh label create foo")')).toBe(true);
  });
});
