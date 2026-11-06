import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * DR-021 Decision 3 — "tier = mechanical scope, not difficulty" reframe.
 *
 * These tests guard the public positioning against a regression to the
 * "the tool gauges how hard a change is" framing the DR removed. They assert
 * the reframe is present in user-facing copy and that the dead scoring-threshold
 * settings (Decision 5) are gone from the docs.
 *
 * Note: these scan committed markdown / template source, not behaviour — they
 * exist specifically so a future copy edit cannot silently re-introduce the
 * over-promise (DR-021 "Costly to Refactor": the reframe).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MINSPEC_README = path.join(REPO_ROOT, 'packages', 'minspec', 'README.md');
const ROOT_README = path.join(REPO_ROOT, 'README.md');
const MINSPEC_MANIFEST = path.join(REPO_ROOT, 'packages', 'minspec', 'package.json');
const TEMPLATE_REGISTRY = path.join(
  REPO_ROOT,
  'packages',
  'minspec',
  'src',
  'lib',
  'template-registry.ts',
);

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

describe('DR-021 Decision 3 — docs reframe tier as scope, not difficulty', () => {
  it('minspec README states a tier is mechanical scope, not how hard a change is', () => {
    const md = read(MINSPEC_README).toLowerCase();
    // Must explicitly disclaim difficulty detection.
    expect(md).toContain('not how hard');
    expect(md).toMatch(/mechanical scope|blast radius/);
  });

  it('minspec README describes the predicted tier as an upward-only floor', () => {
    const md = read(MINSPEC_README).toLowerCase();
    expect(md).toContain('floor');
    expect(md).toMatch(/upward-only|ratchets ceremony up|never auto-lower/);
  });

  it('root README frames MinSpec as scope-adaptive, not complexity/difficulty-adaptive', () => {
    const md = read(ROOT_README);
    expect(md).toContain('scope-adaptive');
    expect(md.toLowerCase()).toContain('not how hard');
  });

  it('the manifest description frames MinSpec as scope-adaptive, not complexity-adaptive', () => {
    // The description is the summary line of the Marketplace listing. It kept its
    // "Complexity-adaptive" opening after the two READMEs were reframed, because this file
    // read the READMEs and the templates and not the manifest (issue #2564).
    const manifest = JSON.parse(read(MINSPEC_MANIFEST)) as { description?: unknown };
    expect(typeof manifest.description).toBe('string');
    const description = String(manifest.description).toLowerCase();
    expect(description).toContain('scope-adaptive');
    expect(description).toMatch(/how far (it|a change) reaches|mechanical scope|blast radius/);
    expect(description).not.toMatch(/complexity|difficult|how hard/);
  });

  it('scaffolded harness templates describe tiers by scope, not difficulty', () => {
    const src = read(TEMPLATE_REGISTRY).toLowerCase();
    expect(src).toContain('mechanical scope');
    // The agent guide must tell the assistant scope ≠ difficulty.
    expect(src).toMatch(/not how hard|not how hard it feels|scope, not difficulty/);
  });

  it('no user-facing doc advertises a tunable complexity-score threshold (DR-021 Decision 5)', () => {
    for (const file of [MINSPEC_README, ROOT_README]) {
      const md = read(file);
      expect(md).not.toContain('thresholds.t1Max');
      expect(md).not.toContain('thresholds.t2Max');
      expect(md).not.toContain('thresholds.t3Max');
      expect(md.toLowerCase()).not.toContain('thresholds are tunable');
    }
  });
});
