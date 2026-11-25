/**
 * #1959 — the generator's SOURCES list and the portability suite's CI_STACK were two
 * hand-kept lists that drifted (six sources, incl. CANONICAL_PY, were in only one), so
 * the Rule 12 witness in validate-frontmatter.ts was the sole check on them. This suite
 * is the independent second witness (constitution invariant 2): it walks the
 * generator's OWN source set, so nothing here is re-listed by hand.
 */
import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';

const ROOT = path.resolve(__dirname, '..', '..', '..');

async function loadGen() {
  return (await import(pathToFileURL(path.join(ROOT, 'scripts', 'gen-ci-templates.mjs')).href)) as {
    CI_TEMPLATE_SOURCE_PATHS: readonly string[];
    SOURCES: ReadonlyArray<{ constName: string; srcPath: string }>;
    generateAll: (root: string) => { outputPath: string; content: string }[];
  };
}

describe('#1959 embedded CI templates — independent witness to Rule 12', () => {
  it('includes the CANONICAL_PY source the portability suite never enumerated', async () => {
    const gen = await loadGen();
    expect(gen.SOURCES.map((s) => s.constName)).toContain('CANONICAL_PY');
    expect(gen.CI_TEMPLATE_SOURCE_PATHS).toContain('scripts/hooks/canonical.py');
  });

  it('sources embedded but NOT registered as managed-region templates are a pinned, visible set', async () => {
    // The generator embeds these but no registry entry scaffolds them today (no consumer
    // of the constants in src/). Pinning the set means a NEW omission fails here instead
    // of drifting silently; shrinking it is a deliberate edit.
    const gen = await loadGen();
    const shipped = new Set(MANAGED_REGION_TEMPLATES.map((t) => t.outputPath));
    const unshipped = gen.CI_TEMPLATE_SOURCE_PATHS.filter((p) => !shipped.has(p)).sort();
    expect(unshipped).toEqual([
      'scripts/review-approvable.sh',
      'scripts/review-pr.sh',
      'scripts/roles/approvable-reviewer.md',
    ]);
  });
});
