import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * T0 — bare parent-register reference gate (issues #160, #179).
 *
 * This repo keeps its OWN local decision register (DR-001..DR-0NN, currently
 * topping out below 100). Any `DR-3xx` token therefore points into the PARENT /
 * global `mmo-platform` register (DR-355 agent-escalation, DR-360 parking-lot,
 * DR-359 contract-driven-development, DR-362 spec-gate enforcement, ...). Cited
 * bare, such a token is indistinguishable in form from a local ref and reads as
 * a dangling local DR (the inward cross-register-collision class — DR-032 /
 * SPEC-021 guard the OUTWARD direction).
 *
 * Root cause: no gate asserted that a parent-range `DR-3xx` token in this repo's
 * local prose carries explicit parent-register attribution, so the bare leaks
 * were never rejected.
 *
 * This test scans committed, user-facing markdown in the allowlist surfaces
 * (docs/, README.md, CLAUDE.md) and asserts every line that mentions a
 * parent-range `DR-3xx` also carries a parent-register attribution marker on
 * the SAME line. `specs/` is intentionally excluded: spec bodies are
 * approval-hash-bound and must not be edited by this gate (see #160 note).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Files/trees scanned. `specs/` is excluded by construction (approval-bound). */
const SCAN_ROOTS = ['docs', 'README.md', 'CLAUDE.md'];

/**
 * Generated artifacts excluded from the gate: it enforces attribution on the
 * AUTHORED source (DR bodies), not on derived files. `docs/decisions/INDEX.md`
 * is regenerated from the DR bodies — gating it would (a) double-enforce and
 * (b) make this PR perpetually conflict with any concurrent DR addition that
 * regenerates the index. The attributed DR bodies flow into INDEX on the next
 * regen.
 */
const EXCLUDE = new Set(['docs/decisions/INDEX.md']);

/**
 * Parent-range DR tokens — anything DR-100+ is outside the local register.
 *
 * SECOND, UNINTENDED JOB (since #2051). This predicate is now the only thing in
 * the repo that reacts to a global-register number minted into the LOCAL
 * register (the #41 / DR-362 class): a leaked record's own heading line is a
 * DR-100+ token with no attribution, so this gate fails on it. Rule 6 in
 * scripts/validate-frontmatter.ts used to report that class and no longer does,
 * and the id-collision gate never did — a leaked number is free, not duplicated,
 * so `decideDrIdCollision` returns ok:true on it.
 *
 * Two limits, both measured, before anyone relies on that: it matches line TEXT,
 * so a title containing an attributing word ("global", "parent register",
 * "mmo-platform") slips past; and the floor is DR-100 while main tops out at
 * DR-093, so the first legitimate local DR-100 turns this gate RED on correct
 * work. Raising the floor or dropping the rule is therefore also a decision
 * about the leak class — make it deliberately, not as a way to clear a red.
 */
const PARENT_DR = /DR-([1-9]\d{2,})/g;

/**
 * A line is attributed if it names the parent register / global origin in a way
 * a reader cannot mistake for a local ref. Kept deliberately permissive so the
 * gate checks for attribution, not an exact phrasing.
 */
const ATTRIBUTION =
  /(parent[ -]register|parent ?\/ ?global|parent\/external|mmo-platform|\bglobal\b|code comments)/i;

function listFiles(root: string): string[] {
  const abs = path.join(REPO_ROOT, root);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path.join(root, entry.name)));
    else if (entry.isFile() && entry.name.endsWith('.md') && !EXCLUDE.has(path.relative(REPO_ROOT, child)))
      out.push(child);
  }
  return out;
}

/**
 * Strip a leading YAML frontmatter block. `relates_to:` / `tags:` arrays are
 * STRUCTURED fields (machine-parsed), not prose citations — a parenthetical
 * attribution cannot live inside a YAML list without corrupting it, so they are
 * out of scope for the prose-attribution gate.
 */
function bodyLines(content: string): { line: string; n: number }[] {
  const raw = content.split('\n');
  let start = 0;
  if (raw[0]?.trim() === '---') {
    const close = raw.indexOf('---', 1);
    if (close !== -1) start = close + 1;
  }
  return raw.slice(start).map((line, i) => ({ line, n: start + i + 1 }));
}

function scan(): string[] {
  const offenders: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of listFiles(root)) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const { line, n } of bodyLines(content)) {
        PARENT_DR.lastIndex = 0;
        if (PARENT_DR.test(line) && !ATTRIBUTION.test(line)) {
          offenders.push(`${path.relative(REPO_ROOT, file)}:${n}: ${line.trim()}`);
        }
      }
    }
  }
  return offenders;
}

describe('parent-register reference attribution (#160, #179)', () => {
  it('every parent-range DR-3xx ref in docs/README/CLAUDE is attributed', () => {
    const offenders = scan();
    expect(
      offenders,
      `Bare parent-register DR-3xx refs (need "parent register" / "mmo-platform" attribution):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
