/**
 * T1 — Contract Tests: Scaffold
 *
 * Tests generateHarnessFiles() and refreshHarnessFiles() from src/lib/scaffold.ts.
 * Uses real filesystem (temp directories) — no mocking.
 *
 * scaffold() is already tested in init.test.ts; these tests cover the
 * uncovered lines in generateHarnessFiles and refreshHarnessFiles.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  applyAuthorshipCorrections,
  generateHarnessFiles,
  refreshHarnessFiles,
} from '../src/lib/scaffold';
import { TEMPLATE_NAMES, TEMPLATE_OUTPUT_PATHS } from '../src/lib/template-registry';
import { loadHashes } from '../src/lib/merge-refresh';

describe('generateHarnessFiles()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-scaffold-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all harness files from templates', () => {
    generateHarnessFiles(tmpDir);

    for (const name of TEMPLATE_NAMES) {
      const relativePath = TEMPLATE_OUTPUT_PATHS[name];
      const fullPath = path.join(tmpDir, relativePath);
      expect(fs.existsSync(fullPath), `expected ${relativePath} to exist`).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('creates .minspec/config.json', () => {
    generateHarnessFiles(tmpDir);
    const configPath = path.join(tmpDir, '.minspec', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('stores section hashes in generated-hashes.json', () => {
    generateHarnessFiles(tmpDir);
    const hashes = loadHashes(tmpDir);

    // There should be hash entries for each template output path
    for (const name of TEMPLATE_NAMES) {
      const relativePath = TEMPLATE_OUTPUT_PATHS[name];
      expect(hashes[relativePath], `expected hashes for ${relativePath}`).toBeDefined();
      // Each file should have at least one section hash
      expect(Object.keys(hashes[relativePath]).length).toBeGreaterThan(0);
    }
  });

  it('does not overwrite existing harness files', () => {
    generateHarnessFiles(tmpDir);

    // Modify one of the generated files
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    const customContent = '# Custom content - do not overwrite\n';
    fs.writeFileSync(claudePath, customContent);

    // Re-run generate
    generateHarnessFiles(tmpDir);

    // Custom content should be preserved
    const content = fs.readFileSync(claudePath, 'utf-8');
    expect(content).toBe(customContent);
  });

  it('uses project directory name as projectName in templates', () => {
    generateHarnessFiles(tmpDir);

    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    const content = fs.readFileSync(claudePath, 'utf-8');
    const dirName = path.basename(tmpDir);
    expect(content).toContain(dirName);
  });

  it('uses package.json name when available', () => {
    // Create a package.json with a project name
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-awesome-project' }),
    );

    generateHarnessFiles(tmpDir);

    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    const content = fs.readFileSync(claudePath, 'utf-8');
    expect(content).toContain('my-awesome-project');
  });

  it('is idempotent — second call does not duplicate or corrupt files', () => {
    generateHarnessFiles(tmpDir);
    const firstHashes = loadHashes(tmpDir);

    generateHarnessFiles(tmpDir);
    const secondHashes = loadHashes(tmpDir);

    // Hashes should be identical
    expect(secondHashes).toEqual(firstHashes);
  });
});

describe('refreshHarnessFiles()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-refresh-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates harness files when none exist (same as generate)', () => {
    refreshHarnessFiles(tmpDir);

    for (const name of TEMPLATE_NAMES) {
      const relativePath = TEMPLATE_OUTPUT_PATHS[name];
      const fullPath = path.join(tmpDir, relativePath);
      expect(fs.existsSync(fullPath), `expected ${relativePath} to exist`).toBe(true);
    }
  });

  it('preserves user-modified sections on refresh', () => {
    // First, generate the files
    generateHarnessFiles(tmpDir);

    // Modify a section in CLAUDE.md
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    let content = fs.readFileSync(claudePath, 'utf-8');

    // Replace the "Overview" section body with custom content
    content = content.replace(
      /## Overview\n[\s\S]*?(?=## )/,
      '## Overview\n\nMy custom overview that I wrote myself.\n\n',
    );
    fs.writeFileSync(claudePath, content);

    // Now refresh
    refreshHarnessFiles(tmpDir);

    // User-modified section should be preserved
    const refreshed = fs.readFileSync(claudePath, 'utf-8');
    expect(refreshed).toContain('My custom overview that I wrote myself.');
  });

  it('updates unmodified sections from new template on refresh', () => {
    // Generate files
    generateHarnessFiles(tmpDir);

    // Read original content to compare
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    const originalContent = fs.readFileSync(claudePath, 'utf-8');

    // Refresh without modifying anything — should re-render templates
    refreshHarnessFiles(tmpDir);

    const refreshedContent = fs.readFileSync(claudePath, 'utf-8');
    // Content should be structurally the same (unmodified sections get template version)
    expect(refreshedContent.length).toBeGreaterThan(0);
    // The file should still have the same key sections
    expect(refreshedContent).toContain('## Overview');
    expect(refreshedContent).toContain('## Invariants');
  });

  it('stores updated hashes after refresh', () => {
    generateHarnessFiles(tmpDir);
    const hashesBeforeRefresh = loadHashes(tmpDir);

    refreshHarnessFiles(tmpDir);
    const hashesAfterRefresh = loadHashes(tmpDir);

    // All template files should have hash entries
    for (const name of TEMPLATE_NAMES) {
      const relativePath = TEMPLATE_OUTPUT_PATHS[name];
      expect(hashesAfterRefresh[relativePath]).toBeDefined();
    }
  });

  it('handles missing file during refresh (creates fresh copy)', () => {
    // Generate files first
    generateHarnessFiles(tmpDir);

    // Delete one of the generated files
    const agentsPath = path.join(tmpDir, 'AGENTS.md');
    fs.unlinkSync(agentsPath);
    expect(fs.existsSync(agentsPath)).toBe(false);

    // Refresh — should recreate the missing file
    refreshHarnessFiles(tmpDir);
    expect(fs.existsSync(agentsPath)).toBe(true);

    const content = fs.readFileSync(agentsPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('Agent Instructions');
  });

  it('preserves user-added sections not in template', () => {
    // Generate files
    generateHarnessFiles(tmpDir);

    // Add a custom section to CLAUDE.md
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    let content = fs.readFileSync(claudePath, 'utf-8');
    content += '\n## My Custom Section\n\nThis is a section I added manually.\n';
    fs.writeFileSync(claudePath, content);

    // Refresh
    refreshHarnessFiles(tmpDir);

    const refreshed = fs.readFileSync(claudePath, 'utf-8');
    expect(refreshed).toContain('## My Custom Section');
    expect(refreshed).toContain('This is a section I added manually.');
  });
});

/**
 * Regression (#206): init must NOT scaffold an empty DESIGN.md stub. A
 * split-layout design doc is a T3+ Plan-phase artifact created when planning
 * starts, not a harness template. The empty stub it used to emit had no
 * frontmatter and would be flagged by the project's own brownfield gap-audit
 * (#205) — and, being a managed template, refresh resurrected it after deletion.
 * Invariant: fresh init has no self-flagged DESIGN.md, and refresh never
 * resurrects it.
 */
describe('#206 — DESIGN.md is not a harness template', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-design-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fresh init does not scaffold DESIGN.md', () => {
    generateHarnessFiles(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'DESIGN.md'))).toBe(false);
  });

  it('refresh does not resurrect a user-deleted DESIGN.md', () => {
    generateHarnessFiles(tmpDir);
    // Even if a DESIGN.md existed and the user removed it, refresh must leave it gone.
    expect(fs.existsSync(path.join(tmpDir, 'DESIGN.md'))).toBe(false);

    refreshHarnessFiles(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'DESIGN.md'))).toBe(false);
  });

  it('DESIGN.md is absent from the recorded harness hashes', () => {
    generateHarnessFiles(tmpDir);
    const hashes = loadHashes(tmpDir);
    expect(hashes['DESIGN.md']).toBeUndefined();
  });
});


// ── #1697 NEW-A3: the manifest composition rule, on its own ──────────────────
//
// `applyAuthorshipCorrections` was extracted out of `recordVerifyAndSaveManifest`
// so that the CORRECTION half of "what baseline will the next refresh read?" has one
// implementation. (The other half is the disk argument, which a real refresh hashes
// AFTER the post-merge writers have run — sharing this half does not compose that
// one.) `mergeFile` used to offer a second, unread answer (`newHashes`) that could
// disagree with it, and a tier of merge tests steered by that instead. The rule now
// has a name, an export and its own tests, so a caller that needs it takes it rather
// than rebuilding it.
describe('applyAuthorshipCorrections() — #1697 NEW-A3', () => {
  const DISK = { __preamble__: 'p0', Invariants: 'd1', Goals: 'd2', 'Ops runbook': 'd3' };

  it('returns the disk map unchanged when there is nothing to correct', () => {
    expect(applyAuthorshipCorrections(DISK)).toEqual(DISK);
    expect(applyAuthorshipCorrections(DISK, {}, [])).toEqual(DISK);
  });

  it('records the WITHHELD template body for a heading whose body was kept', () => {
    // The #1697 F1 correction: disk holds the user's bytes, so filing disk would
    // claim MinSpec authored them and license the next refresh to overwrite.
    expect(applyAuthorshipCorrections(DISK, { Invariants: 'withheld-template' })).toEqual({
      ...DISK,
      Invariants: 'withheld-template',
    });
  });

  it('invents no entry for an ordinary withheld heading that is not on disk', () => {
    // A manifest entry for a section that does not exist is the class of lie this
    // module exists to prevent, so the override applies only where disk already has
    // the heading.
    expect(applyAuthorshipCorrections(DISK, { Nonexistent: 'x' })).toEqual(DISK);
  });

  it('DOES invent one for an `Object.prototype` heading — #1752, latent, pinned', () => {
    // Not a `never`: the guard is `heading in corrected`, and `in` walks the
    // prototype chain, so the eight `Object.prototype` names pass it on a map that
    // does not carry them. Asserted as the CURRENT behaviour rather than described in
    // a comment, so #1752's fix (`Object.create(null)` for every heading-keyed map)
    // turns this red and is noticed.
    //
    // Latent, not live: a withheld hash exists only for a heading the TEMPLATE also
    // carries, and MinSpec ships no template heading with a prototype name.
    const out = applyAuthorshipCorrections(DISK, { constructor: 'INVENTED' });
    expect(Object.prototype.hasOwnProperty.call(out, 'constructor')).toBe(true);
    expect(Object.keys(out)).toContain('constructor');
  });

  it('deletes an unauthored heading outright rather than correcting it', () => {
    // #1697 NEW-2/NEW-3: MinSpec rendered no body for this heading, so there is no
    // hash it may honestly file. Absence is what routes it to the fail-closed branch
    // next time, loudly.
    const out = applyAuthorshipCorrections(DISK, undefined, ['Ops runbook']);
    expect(out).not.toHaveProperty('Ops runbook');
    expect(out).toEqual({ __preamble__: 'p0', Invariants: 'd1', Goals: 'd2' });
  });

  it('applies deletions AFTER overrides, so the two orders cannot disagree', () => {
    // The two sets are disjoint by construction in `mergeFile`; this makes the
    // outcome independent of that, so a future producer that overlaps them cannot
    // leave a withheld hash on a heading MinSpec disclaims.
    const out = applyAuthorshipCorrections(DISK, { Goals: 'withheld' }, ['Goals']);
    expect(out).not.toHaveProperty('Goals');
  });

  it('preserves disk key order, so the serialized manifest stays byte-stable', () => {
    // SPEC-043 INV-4: two identical runs must produce identical bytes, and JSON key
    // order is part of the bytes.
    const out = applyAuthorshipCorrections(DISK, { Invariants: 'withheld' }, ['Goals']);
    expect(Object.keys(out)).toEqual(['__preamble__', 'Invariants', 'Ops runbook']);
  });

  it('does not mutate the disk map it was given', () => {
    const disk = { ...DISK };
    applyAuthorshipCorrections(disk, { Invariants: 'withheld' }, ['Goals']);
    expect(disk).toEqual(DISK);
  });
});
