/**
 * SPEC-038 / #460 — TS↔Python ownership-path parity (design P1, canonical-parity pattern).
 *
 * The validator's owned-path rules (`src/lib/ownership-path-rules.ts`) MUST agree with
 * the gate's (`scripts/hooks/spec-gate.py`), or a declaration the validator accepts
 * might not actually arm the gate. This test reads the gate's `_SRC_EXT_RE` pattern and
 * `_INFRA_PREFIXES` straight from its source and asserts the TS constants match
 * byte-for-byte — it fails the moment either side drifts.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  OWNED_SRC_EXT_PATTERN,
  OWNED_INFRA_PREFIXES,
  isValidOwnedPath,
} from '../src/lib/ownership-path-rules';

const testDir = dirname(fileURLToPath(import.meta.url));
const GATE = resolve(testDir, '../../../scripts/hooks/spec-gate.py');
const gateSrc = readFileSync(GATE, 'utf-8');

/** Concatenate the `r'...'` raw-string segments of `_SRC_EXT_RE = re.compile( … )`. */
function gateSrcExtPattern(): string {
  // Anchor on the trailing `, re.I)` — the pattern itself contains `)` inside `(?:…)`,
  // so a bare first-`)` boundary would truncate the multi-line raw string.
  const block = gateSrc.match(/_SRC_EXT_RE\s*=\s*re\.compile\(([\s\S]*?),\s*re\.I\s*\)/);
  if (!block) throw new Error('could not locate _SRC_EXT_RE in spec-gate.py');
  const parts = [...block[1].matchAll(/r'([^']*)'/g)].map((m) => m[1]);
  if (parts.length === 0) throw new Error('no raw-string parts in _SRC_EXT_RE');
  return parts.join('');
}

/** The string tuple `_INFRA_PREFIXES = ( … )`. */
function gateInfraPrefixes(): string[] {
  const block = gateSrc.match(/_INFRA_PREFIXES\s*=\s*\(([\s\S]*?)\)/);
  if (!block) throw new Error('could not locate _INFRA_PREFIXES in spec-gate.py');
  return [...block[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

describe('SPEC-038 ownership-path rules ↔ spec-gate.py parity (#460)', () => {
  it('_SRC_EXT_RE pattern matches the TS mirror exactly', () => {
    expect(OWNED_SRC_EXT_PATTERN).toBe(gateSrcExtPattern());
  });

  it('_INFRA_PREFIXES matches the TS mirror exactly (same order)', () => {
    expect([...OWNED_INFRA_PREFIXES]).toEqual(gateInfraPrefixes());
  });

  describe('isValidOwnedPath mirrors the gate consider() filters', () => {
    it('accepts a repo-relative source path (existence-independent)', () => {
      expect(isValidOwnedPath('packages/minspec/src/lib/new-thing.ts')).toBe(true); // greenfield OK
      expect(isValidOwnedPath('./scripts/hooks/spec-gate.py')).toBe(true);
      expect(isValidOwnedPath('"packages/minspec/src/x.tsx"')).toBe(true); // quoted
    });
    it('rejects absolute and parent-escape paths', () => {
      expect(isValidOwnedPath('/etc/passwd.ts')).toBe(false);
      expect(isValidOwnedPath('../../x.ts')).toBe(false);
      expect(isValidOwnedPath('packages/../../x.ts')).toBe(false);
    });
    it('rejects infra-prefixed paths', () => {
      expect(isValidOwnedPath('node_modules/foo/index.js')).toBe(false);
      expect(isValidOwnedPath('dist/bundle.js')).toBe(false);
    });
    it('rejects non-source extensions and bare tokens', () => {
      expect(isValidOwnedPath('docs/README.md')).toBe(false); // .md not a source ext
      expect(isValidOwnedPath('just-a-word')).toBe(false); // no slash
      expect(isValidOwnedPath('')).toBe(false);
    });
  });
});
