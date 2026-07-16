/**
 * Spec→code ownership path rules (SPEC-038 / #460).
 *
 * The single TypeScript mirror of the owned-code-path filters that the PreToolUse
 * spec-gate (`scripts/hooks/spec-gate.py`) already applies to `implements:`/`affects:`
 * tokens. The validator (`spec-validator.ts`) uses these to decide whether a declared
 * ownership path is *valid* — it MUST agree with the gate, or a declaration the
 * validator accepts might not actually arm the gate (or vice-versa).
 *
 * Parity with the gate is pinned by `tests/ownership-path-parity.test.ts`: the
 * constants below are compared byte-for-byte against `spec-gate.py`'s `_SRC_EXT_RE`
 * pattern and `_INFRA_PREFIXES`. If you change one side, the parity test fails until
 * both match. Do not edit these constants without updating the gate (and vice-versa).
 *
 * Tier-0: no vscode/network imports (INV-3).
 */

/**
 * EXACT mirror of `spec-gate.py` `_SRC_EXT_RE.pattern`. A declared owned-code path
 * must end in one of these source extensions (precision filter — a bare prose token
 * like `the-thing` or a `.md` doc is never owned code).
 */
export const OWNED_SRC_EXT_PATTERN =
  '\\.(?:ts|tsx|js|jsx|mjs|cjs|py|sh|bash|json|jsonc|css|scss|less|html|htm|vue|svelte|sql|ya?ml|toml)$';

/**
 * EXACT mirror of `spec-gate.py` `_INFRA_PREFIXES`. A path under one of these is
 * build output / vendored / VCS metadata — never owned source.
 */
export const OWNED_INFRA_PREFIXES = ['node_modules/', 'out/', 'dist/', 'coverage/', '.git/'] as const;

const SRC_EXT_RE = new RegExp(OWNED_SRC_EXT_PATTERN, 'i');

/**
 * True iff `token` is a path the spec-gate would treat as owned code — i.e. it would
 * be added to a spec's owned set. Mirrors `spec-gate.py` `consider()` **minus the
 * existence check** (a declared path is valid whether or not the file exists yet;
 * greenfield ownership is the point — FR-4 / AC-3).
 *
 * Rejects: empty tokens, tokens with no `/` (not a repo path), absolute paths,
 * parent-escapes (`../` or any `..` segment), infra-prefixed paths, and anything not
 * ending in a source extension.
 */
export function isValidOwnedPath(token: string): boolean {
  // Mirror python `token.strip().strip('"').strip("'").strip()`.
  let t = token.trim().replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();
  if (!t || !t.includes('/')) return false;

  let p = t.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);

  // No absolute / parent-escape paths.
  if (p.startsWith('/') || p.startsWith('../') || p.split('/').includes('..')) return false;
  // No infra-prefixed paths.
  if (OWNED_INFRA_PREFIXES.some((pre) => p.startsWith(pre))) return false;
  // Must end in a source extension.
  if (!SRC_EXT_RE.test(p)) return false;

  return true;
}

/**
 * True iff `token` is a path that **escapes the repo root** — an absolute path, a
 * `../` climb, or any `..` segment. This is the genuinely-invalid case per FR-4/AC-4:
 * a declared ownership path must be repo-relative. It is a strict subset of
 * `!isValidOwnedPath` — infra-prefixed / wrong-extension tokens are NOT escaping
 * (the gate silently skips them, so flagging them would false-positive a valid spec).
 * Bare tokens (no `/`) are not paths and are not escaping.
 */
export function isEscapingPath(token: string): boolean {
  let t = token.trim().replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();
  if (!t || !t.includes('/')) return false;
  let p = t.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  return p.startsWith('/') || p.startsWith('../') || p.split('/').includes('..');
}
