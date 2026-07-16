/**
 * SPEC-038 / #460 — required `implements:`/`affects:` spec→code ownership.
 *
 * TEST-FIRST (DR-003): written RED against a not-yet-wired `validateOwnership`.
 * The POSITIVE cases (missing / invalid → a finding) fail until the rule ships;
 * the NEGATIVE guards (clean cases) pass trivially now and must keep passing after.
 * The AC-7 symmetry test is the T0 invariant — it fails in BOTH directions, so the
 * validator-asymmetry class (#137) cannot silently return.
 *
 * Ships as `warn` by default (FR-7); tests force severity by rule identity, not
 * config, so they hold across the warn→error ratchet.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { validateSpec } from '../src/lib/spec-validator';
import { parseSpec } from '../src/lib/spec';
import { DEFAULT_CONFIG } from '../src/lib/config';

const AC5_DIR = dirname(fileURLToPath(import.meta.url));

const MISSING = 'ownership.implements.missing';
const INVALID = 'ownership.implements.invalid';

/** Build a raw spec with ownership frontmatter + phase state. */
function ownSpec(o: {
  tier?: string;
  clarify?: string; // clarify phase status (default done = past Clarify)
  implementsVal?: string; // raw value after `implements:` (omit = absent)
  affectsVal?: string;
  reason?: string; // implements_reason:
  body?: string;
}): string {
  const fm: string[] = [
    '---',
    'id: SPEC-999',
    'title: Ownership Test',
    `tier: ${o.tier ?? 'T3'}`,
    'status: implementing',
    'created: 2026-07-15',
  ];
  if (o.implementsVal !== undefined) fm.push(`implements: ${o.implementsVal}`);
  if (o.affectsVal !== undefined) fm.push(`affects: ${o.affectsVal}`);
  if (o.reason !== undefined) fm.push(`implements_reason: ${o.reason}`);
  fm.push(
    'phases:',
    '  specify: done',
    `  clarify: ${o.clarify ?? 'done'}`,
    '  plan: pending',
    '  tasks: pending',
    '  implement: pending',
    '---',
    '',
  );
  const body = o.body ?? '## Specify\nx\n- [ ] c\n\n## Plan\np\n\n## Tasks\n- [ ] t\n\n## Implement\ni\n';
  return fm.join('\n') + '\n' + body;
}

const rules = (raw: string): string[] =>
  validateSpec(parseSpec(raw), DEFAULT_CONFIG).violations.map((v) => v.rule);

describe('SPEC-038 ownership declaration (#460)', () => {
  // ── T0 invariant: symmetry (AC-7 / INV-2 / #137) ──────────────────────────
  it('AC-7 — fails on BOTH missing and invalid (asymmetry cannot return)', () => {
    // missing direction
    expect(rules(ownSpec({ tier: 'T3', clarify: 'done' }))).toContain(MISSING);
    // invalid direction
    expect(rules(ownSpec({ tier: 'T3', implementsVal: '[../../evil.ts]' }))).toContain(INVALID);
  });

  // ── Presence (FR-3) ───────────────────────────────────────────────────────
  it('AC-1 — T3 past Clarify with no implements: → missing', () => {
    expect(rules(ownSpec({ tier: 'T3', clarify: 'done' }))).toContain(MISSING);
  });

  it('AC-2 — implements: none + reason → clean', () => {
    const r = rules(ownSpec({ implementsVal: 'none', reason: 'policy spec — owns no code' }));
    expect(r).not.toContain(MISSING);
    expect(r).not.toContain(INVALID);
  });

  it('AC-2b — implements: none WITHOUT a reason → missing (escape is not free, FR-5)', () => {
    expect(rules(ownSpec({ implementsVal: 'none' }))).toContain(MISSING);
  });

  // ── Validity (FR-4) ───────────────────────────────────────────────────────
  it('AC-3 — a declared but non-existent path is valid (greenfield ownership)', () => {
    const r = rules(ownSpec({ implementsVal: '[packages/minspec/src/lib/does-not-exist-yet.ts]' }));
    expect(r).not.toContain(INVALID);
    expect(r).not.toContain(MISSING); // a real declaration satisfies presence too
  });

  it('AC-4 — absolute / parent-escape paths → invalid', () => {
    expect(rules(ownSpec({ implementsVal: '[/etc/passwd.ts]' }))).toContain(INVALID);
    expect(rules(ownSpec({ implementsVal: '[../x.ts]' }))).toContain(INVALID);
  });

  // ── Scope (FR-6, option (a): required T3/T4 only) ─────────────────────────
  it('AC-6 — T1/T2 without implements: is exempt (clean)', () => {
    expect(rules(ownSpec({ tier: 'T2', clarify: 'done' }))).not.toContain(MISSING);
    expect(rules(ownSpec({ tier: 'T1', clarify: 'done' }))).not.toContain(MISSING);
  });

  // ── Trigger predicate (P2 — phases.clarify) ───────────────────────────────
  it('a T3 still in Clarify (clarify: pending) is NOT yet required', () => {
    expect(rules(ownSpec({ tier: 'T3', clarify: 'pending' }))).not.toContain(MISSING);
  });
});

describe('SPEC-038 AC-5 — the produced signal arms the real spec-gate (#460)', () => {
  const gateSh = resolve(AC5_DIR, '../../../scripts/hooks/spec-gate.sh');

  function gateDecision(cwd: string, filePath: string): string {
    const envelope = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath }, cwd });
    try {
      return execFileSync('bash', [gateSh], { input: envelope, encoding: 'utf-8', env: process.env });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      return (err.stdout ?? '') + (err.stderr ?? '');
    }
  }

  it('an unapproved T3 spec that declares implements: blocks creation of the declared (non-existent) file, but not an undeclared sibling', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'own-ac5-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: tmp });
      mkdirSync(join(tmp, '.minspec'), { recursive: true });
      writeFileSync(join(tmp, '.minspec/config.json'), '{"version":"1"}');
      const specDir = join(tmp, 'specs/minspec/SPEC-900-ac5');
      mkdirSync(specDir, { recursive: true });
      writeFileSync(
        join(specDir, 'requirements.md'),
        [
          '---', 'id: SPEC-900', 'title: AC5 fixture', 'tier: T3', 'status: implementing',
          'created: 2026-07-15', 'implements: [src/owned.ts]',
          'phases:', '  specify: done', '  clarify: done', '  plan: in-progress',
          '  tasks: pending', '  implement: pending', '---', '', '## Specify', 'x', '',
        ].join('\n'),
      );
      // declared, unapproved → creation blocked (the declaration arms the gate)
      expect(gateDecision(tmp, join(tmp, 'src/owned.ts'))).toContain('deny');
      // undeclared sibling → not owned → allowed (doc-before-CODE is per-declaration, not a repo freeze)
      expect(gateDecision(tmp, join(tmp, 'src/other.ts'))).toContain('allow');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
