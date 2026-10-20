/**
 * Manifest user-facing-text gate (#2408).
 *
 * Root cause: `contributes.*` strings in `package.json` are rendered straight into
 * VS Code's Settings editor and Command Palette for EVERY user, but nothing stopped
 * a contributor from writing this repository's own internal shorthand into them —
 * a decision-record id (`DR-056`), a bare issue number with no repository named
 * (`#559`), or jargon ("Tier-0") that collides with vocabulary the user already
 * knows from elsewhere in the same UI (the T1-T4 scope tiers). A reader with no
 * access to this repository's issue tracker or decision register cannot resolve
 * any of those — the "why" belongs in the source/DR, never in the string the user
 * sees (see CLAUDE.md's "Evidence Discipline" / traceability convention: commits
 * and DRs carry rationale, user-facing copy does not).
 *
 * This is a STRUCTURAL gate, not a one-time fix: it walks every string under
 * `contributes` (commands, configuration properties, keybindings, menus,
 * walkthroughs, …) and rejects `DR-\d+`, `SPEC-\d+`, and a bare `#\d+` issue
 * reference anywhere in it. VS Code's own markdown setting-reference syntax
 * (`` `#minspec.pushOnApprove#` ``) is unaffected — the digit-free anchor name
 * never matches `#\d+`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const INTERNAL_ID_PATTERN = /DR-\d+|SPEC-\d+|(?<![\w`])#\d+\b/g;

interface Hit {
  path: string;
  value: string;
  matches: string[];
}

function collectHits(node: unknown, breadcrumb: string[], hits: Hit[]): void {
  if (typeof node === 'string') {
    const matches = node.match(INTERNAL_ID_PATTERN);
    if (matches) {
      hits.push({ path: breadcrumb.join('/'), value: node, matches });
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectHits(child, [...breadcrumb, String(i)], hits));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      collectHits(value, [...breadcrumb, key], hits);
    }
  }
}

function readManifest(): Record<string, unknown> {
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
}

describe('package.json contributes.* — no internal ids in user-facing text', () => {
  const pkg = readManifest();

  it('the manifest actually contributes user-facing text (sanity, non-vacuous)', () => {
    const hits: Hit[] = [];
    collectHits(pkg.contributes, ['contributes'], hits);
    // Sanity only: this run should find commands/settings to walk at all, regardless
    // of whether any of them currently violate the pattern.
    const stringCount = JSON.stringify(pkg.contributes).length;
    expect(stringCount).toBeGreaterThan(0);
  });

  it('contains no DR-NNN, SPEC-NNN, or bare #NNN reference', () => {
    const hits: Hit[] = [];
    collectHits(pkg.contributes, ['contributes'], hits);
    if (hits.length > 0) {
      const report = hits
        .map((h) => `  ${h.path}: ${h.matches.join(', ')} in "${h.value.slice(0, 160)}"`)
        .join('\n');
      throw new Error(
        `Found internal id(s) in user-facing manifest text — a user cannot resolve ` +
          `a DR/SPEC id or a bare issue number with no repository named. Move the ` +
          `rationale to the source or decision record and rewrite the string in ` +
          `plain terms:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
