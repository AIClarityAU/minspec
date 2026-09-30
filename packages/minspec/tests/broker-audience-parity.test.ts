/**
 * SPEC-034 — the broker's OIDC audience is declared, and nothing disagrees with it.
 *
 * WHY THIS IS A GATE. `verify.ts` refuses an empty audience rather than defaulting it, so
 * a Worker deployed without `BROKER_AUDIENCE` answers every request 500. That is correct
 * fail-closed behaviour and a miserable thing to debug, because the symptom appears at
 * the far end of a CI run as a token problem.
 *
 * The worse failure is a MISMATCH: the broker and the workflow each hold a value, both
 * are present and well-formed, and every request 401s with "invalid token". That reads as
 * a signature or key problem and sends the reader to the JWKS, the App key, and the
 * clock - anywhere but the two string literals that simply differ. `aud` is agreed out of
 * band by construction, so nothing at runtime can catch it.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WRANGLER = path.join(REPO_ROOT, 'packages/broker/wrangler.toml');

/** `BROKER_AUDIENCE = "..."` at line start, ignoring commented-out copies. */
const DECLARED = /^\s*BROKER_AUDIENCE\s*=\s*"([^"]+)"\s*$/m;

function declaredAudience(): string | null {
  const m = DECLARED.exec(fs.readFileSync(WRANGLER, 'utf8'));
  return m ? m[1] : null;
}

/** Every workflow and generated template that could carry an `audience:` request. */
function consumerFiles(): string[] {
  const out: string[] = [];
  for (const rel of ['.github/workflows', 'packages/minspec/src/lib']) {
    const dir = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.(yml|yaml|ts)$/.test(entry.name)) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

describe('SPEC-034 broker audience', () => {
  it('is declared and well-formed in wrangler.toml', () => {
    const aud = declaredAudience();
    expect(aud, 'BROKER_AUDIENCE missing from packages/broker/wrangler.toml').not.toBeNull();
    // A URL-shaped audience by convention: opaque to the protocol, but collision-proof
    // and self-describing when it turns up in a token nobody expected.
    expect(aud).toMatch(/^https:\/\/\S+$/);
  });

  it('the detector actually detects — it would notice the line disappearing', () => {
    // Without this, renaming the var turns the assertion above into "null is not null"
    // only if it is written correctly; this pins the regex against known shapes so it
    // cannot rot into matching nothing and reporting compliance.
    expect(DECLARED.test('BROKER_AUDIENCE = "https://x.example"')).toBe(true);
    expect(DECLARED.test('# BROKER_AUDIENCE = "https://x.example"')).toBe(false);
    expect(DECLARED.test('BROKER_AUDIENCE = ""')).toBe(false);
    expect(DECLARED.test('MINSPEC_APP_ID = "4212099"')).toBe(false);
  });

  it('no workflow or template requests a DIFFERENT audience', () => {
    // The parity half. It is deliberately conditional: the workflow that requests an
    // OIDC token lands with the rest of task 1.4, and until then this finds nothing.
    // Written now rather than later because the mismatch it guards is invisible at
    // runtime, and the moment the workflow lands is exactly when it would be introduced.
    const aud = declaredAudience();
    const mismatches: string[] = [];
    let scanned = 0;
    for (const file of consumerFiles()) {
      scanned += 1;
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/audience:\s*['"]?(https:\/\/[^\s'"]+)/g)) {
        if (m[1] !== aud) mismatches.push(`${path.relative(REPO_ROOT, file)} → ${m[1]}`);
      }
    }
    // Non-vacuity for the SCAN, not for the finding: a scan that read nothing would
    // report parity and mean it.
    expect(scanned, 'scanned no workflow/template files').toBeGreaterThan(5);
    expect(
      mismatches,
      `these request an OIDC audience the broker will reject (declared: ${aud}):\n` +
        mismatches.join('\n'),
    ).toEqual([]);
  });
});
