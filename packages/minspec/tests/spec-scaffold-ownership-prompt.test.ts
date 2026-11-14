/**
 * SPEC-051 T5 — the spec scaffold prompts for `implements:` at Specify (design.md §3,
 * DQ-1 Option C), so ownership lands in the approved bytes and the approve-path refusal
 * (`ownership-advance-guard.ts`) becomes a rarely-fired backstop.
 *
 * Invariants pinned here (T0 first):
 *   - INERT: the prompt is a comment. A freshly created spec declares nothing, so no
 *     file is block-listed and no ownership finding changes because of the prompt.
 *   - EXACT: the documented `none` escape, uncommented verbatim, is a declaration
 *     `validateOwnership` accepts at error severity — the template cannot teach a shape
 *     the validator rejects. A control (prompt left commented) proves the rule is armed.
 *   - NO GATE: `validateSpec` output is identical with and without the prompt (T5.2).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createSpec,
  OWNERSHIP_PROMPT_MARKER,
  ownershipDeclarationPrompt,
} from '../src/lib/spec-manager';
import { parseSpec, setSpecPhases, setSpecStatus } from '../src/lib/spec';
import { validateSpec } from '../src/lib/spec-validator';
import { DEFAULT_CONFIG, type MinspecConfig, type SpecsLayout } from '../src/lib/config';

const MISSING = 'ownership.implements.missing';
const INVALID = 'ownership.implements.invalid';
const ERROR_CONFIG: MinspecConfig = { ...DEFAULT_CONFIG, ownershipDeclaration: 'error' };

let root: string;

function makeProject(layout: SpecsLayout = 'flat'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-prompt-'));
  fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.minspec', 'config.json'),
    JSON.stringify({ ...DEFAULT_CONFIG, specsLayout: layout }, null, 2),
    'utf-8',
  );
  return dir;
}

beforeEach(() => {
  root = makeProject();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const frontmatterOf = (src: string): string => src.match(/^---\n([\s\S]*?)\n---/)![1];

/** Put a created spec into the build band (plan: in-progress), where SPEC-038 FR-3 fires. */
function intoBuildBand(src: string): string {
  return src
    .replace(/^ {2}specify:.*$/m, '  specify: done')
    .replace(/^ {2}clarify:.*$/m, '  clarify: done')
    .replace(/^ {2}plan:.*$/m, '  plan: in-progress');
}

/** Remove the `# ` prefix from exactly the documented `none`-escape pair. */
function uncommentNoneEscape(src: string): string {
  return src
    .replace(/^# (implements: none)$/m, '$1')
    .replace(/^# (implements_reason: .+)$/m, '$1');
}

const ownershipRules = (src: string, config: MinspecConfig = ERROR_CONFIG): string[] =>
  validateSpec(parseSpec(src), config)
    .violations.map((v) => v.rule)
    .filter((r) => r.startsWith('ownership.'));

describe('SPEC-051 T5 — createSpec prompts for implements: at Specify', () => {
  it('stamps the prompt, with both legal forms, into a new spec frontmatter', () => {
    const src = fs.readFileSync(createSpec(root, 'Demo thing', 'T3').filePath, 'utf-8');
    const fm = frontmatterOf(src);
    expect(fm).toContain(OWNERSHIP_PROMPT_MARKER);
    expect(fm).toMatch(/^# implements: \[.+\]$/m);
    expect(fm).toMatch(/^# implements: none$/m);
    expect(fm).toMatch(/^# implements_reason: .+$/m);
    expect(fm).toContain('affects:');
  });

  it('sits immediately above `phases:` — where the corpus puts ownership fields', () => {
    const lines = frontmatterOf(
      fs.readFileSync(createSpec(root, 'Demo thing', 'T4').filePath, 'utf-8'),
    ).split('\n');
    const phasesIdx = lines.findIndex((l) => /^phases:/.test(l));
    const promptLines = ownershipDeclarationPrompt().split('\n');
    expect(lines.slice(phasesIdx - promptLines.length, phasesIdx)).toEqual(promptLines);
  });

  it('INERT — every prompt line is a comment, so the spec declares no ownership', () => {
    for (const line of ownershipDeclarationPrompt().split('\n')) {
      expect(line.startsWith('#')).toBe(true);
    }
    const fm = parseSpec(
      fs.readFileSync(createSpec(root, 'Demo thing', 'T3').filePath, 'utf-8'),
    ).frontmatter as unknown as Record<string, unknown>;
    expect(fm.implements).toBeUndefined();
    expect(fm.implements_reason).toBeUndefined();
    expect(fm.id).toBe('SPEC-001');
    expect(fm.tier).toBe('T3');
  });

  it('CONTROL — left commented, the build-band rule still fires (the prompt is not a declaration)', () => {
    const src = intoBuildBand(
      fs.readFileSync(createSpec(root, 'Demo thing', 'T3').filePath, 'utf-8'),
    );
    expect(ownershipRules(src)).toContain(MISSING);
  });

  it('EXACT — the documented none-escape, uncommented verbatim, satisfies the rule at error severity', () => {
    const src = uncommentNoneEscape(
      intoBuildBand(fs.readFileSync(createSpec(root, 'Demo thing', 'T3').filePath, 'utf-8')),
    );
    // guard against a vacuous pass: the uncomment really happened
    expect(src).toMatch(/^implements: none$/m);
    expect(src).toMatch(/^implements_reason: .+$/m);
    const rules = ownershipRules(src);
    expect(rules).not.toContain(MISSING);
    expect(rules).not.toContain(INVALID);
  });

  it('EXACT — the documented path example, uncommented, is a valid owned path', () => {
    const src = intoBuildBand(
      fs.readFileSync(createSpec(root, 'Demo thing', 'T4').filePath, 'utf-8'),
    ).replace(/^# (implements: \[.+\])$/m, '$1');
    expect(src).toMatch(/^implements: \[.+\]$/m);
    const rules = ownershipRules(src);
    expect(rules).not.toContain(MISSING);
    expect(rules).not.toContain(INVALID);
  });

  it('NO GATE (T5.2) — validateSpec output is identical with and without the prompt', () => {
    const src = fs.readFileSync(createSpec(root, 'Demo thing', 'T3').filePath, 'utf-8');
    const stripped = src.replace(`${ownershipDeclarationPrompt()}\n`, '');
    expect(stripped).not.toContain(OWNERSHIP_PROMPT_MARKER);
    for (const variant of [(s: string) => s, intoBuildBand]) {
      const withPrompt = validateSpec(parseSpec(variant(src)), ERROR_CONFIG).violations;
      const without = validateSpec(parseSpec(variant(stripped)), ERROR_CONFIG).violations;
      expect(withPrompt).toEqual(without);
    }
  });

  it.each(['T1', 'T2', 'T3', 'T4'] as const)(
    'is emitted at %s — createSpec defaults to T2 and tiers are raised later',
    (tier) => {
      const src = fs.readFileSync(createSpec(root, `Tier ${tier}`, tier).filePath, 'utf-8');
      expect(src.split(OWNERSHIP_PROMPT_MARKER).length - 1).toBe(1);
    },
  );

  it('appears exactly once alongside the #1510 hash-lock reminder', () => {
    const src = fs.readFileSync(createSpec(root, 'Demo thing').filePath, 'utf-8');
    expect(src.split(OWNERSHIP_PROMPT_MARKER).length - 1).toBe(1);
    expect(src).toContain('# 🔒 Approval is recorded');
  });

  it('is emitted for the spec-kit layout too', () => {
    const kit = makeProject('spec-kit');
    try {
      const src = fs.readFileSync(createSpec(kit, 'Kit thing', 'T3').filePath, 'utf-8');
      expect(frontmatterOf(src)).toContain(OWNERSHIP_PROMPT_MARKER);
    } finally {
      fs.rmSync(kit, { recursive: true, force: true });
    }
  });

  it('survives the lifecycle writers the approve path actually uses', () => {
    // `setSpecStatus` / `setSpecPhases` are line-level and keep every other frontmatter
    // line verbatim — the prompt is still there for a human re-reading the spec after the
    // first lifecycle write. (`transitionPhase` round-trips through `writeSpec`, which
    // drops frontmatter comments, but has no production caller.)
    const { filePath } = createSpec(root, 'Demo thing', 'T3');
    setSpecStatus(filePath, 'specifying');
    setSpecPhases(filePath, { specify: 'in-progress' }, { createIfAbsent: false });
    const src = fs.readFileSync(filePath, 'utf-8');
    expect(src).toMatch(/^status: specifying$/m);
    expect(src).toMatch(/^ {2}specify: in-progress$/m);
    expect(frontmatterOf(src)).toContain(ownershipDeclarationPrompt());
  });
});
