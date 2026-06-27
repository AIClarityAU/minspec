/**
 * #249 / DR-037 — Managed-region template class.
 *
 * Managed-region templates are non-Markdown harness artifacts (the CI workflow
 * YAML) that the `## `-section merge engine cannot carry. Instead of treating them
 * as opaque whole files, MinSpec wraps its owned content in comment-delimited
 * markers (`# >>> minspec:managed:<name> >>>` … `# <<< minspec:managed:<name> <<<`),
 * generalizing the existing dr-index marker convention to any file type. On Refresh
 * MinSpec overwrites ONLY the content between the markers and preserves everything
 * outside verbatim:
 *   - scaffolded once at init, with markers wrapping the MinSpec region,
 *   - refresh OVERWRITES the managed region with the current template,
 *   - refresh PRESERVES user content added OUTSIDE the markers,
 *   - refresh updates the region even when the user edited outside it (the key
 *     improvement over the old preserve-on-any-edit whole-file rule),
 *   - refresh with markers DELETED → skip + warn, file untouched,
 *   - refresh on a DELETED file → re-scaffold with markers.
 *
 * The first registered managed-region template is
 * .github/workflows/minspec-validate.yml (`#`-comment markers).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  generateHarnessFiles,
  refreshHarnessFiles,
} from '../src/lib/scaffold';
import {
  MANAGED_REGION_TEMPLATES,
  managedRegionStartMarker,
  managedRegionEndMarker,
  renderManagedBlock,
} from '../src/lib/template-registry';
import { splitManagedRegion, spliceManagedRegion } from '../src/lib/merge-refresh';

const WORKFLOW_PATH = '.github/workflows/minspec-validate.yml';
const TPL = MANAGED_REGION_TEMPLATES[0];
const START = managedRegionStartMarker(TPL.name, TPL.commentStyle);
const END = managedRegionEndMarker(TPL.name, TPL.commentStyle);

describe('managed-region template registry (#249)', () => {
  it('registers minspec-validate.yml as the first managed-region template', () => {
    expect(TPL).toBeDefined();
    expect(TPL.name).toBe('validate-workflow');
    expect(TPL.outputPath).toBe(WORKFLOW_PATH);
    expect(TPL.commentStyle).toBe('hash');
    expect(TPL.content.length).toBeGreaterThan(0);
  });

  it('the workflow content is valid YAML invoking MinSpec validation', () => {
    const yaml = TPL.content;

    // Structural YAML sanity (no parser dependency): YAML forbids hard tabs for
    // indentation, and a GitHub Actions workflow needs name / on / jobs.
    expect(yaml).not.toMatch(/\t/);
    expect(yaml).toMatch(/^name:\s*.+$/m);
    expect(yaml).toMatch(/^on:\s*$/m);
    expect(yaml).toMatch(/^jobs:\s*$/m);

    // Indentation is consistent (every indented line uses spaces only).
    for (const line of yaml.split('\n')) {
      const indent = line.match(/^(\s*)/)?.[1] ?? '';
      expect(indent.includes('\t')).toBe(false);
    }

    // It actually runs the MinSpec validator (the post-push gate, DR-037).
    expect(yaml).toMatch(/push:/);
    expect(yaml).toMatch(/pull_request:/);
    expect(yaml).toMatch(/@aiclarity\/minspec-validator/);
  });

  it('uses the minspec: marker convention with `#` comment syntax for YAML', () => {
    // Reuses the existing `minspec:` marker token, generalized to `#` comments so
    // the markers are valid YAML comments.
    expect(START).toBe('# >>> minspec:managed:validate-workflow >>>');
    expect(END).toBe('# <<< minspec:managed:validate-workflow <<<');
  });

  it('picks the comment syntax per style (hash / html / slash)', () => {
    expect(managedRegionStartMarker('x', 'hash')).toBe('# >>> minspec:managed:x >>>');
    expect(managedRegionEndMarker('x', 'hash')).toBe('# <<< minspec:managed:x <<<');
    expect(managedRegionStartMarker('x', 'html')).toBe('<!-- >>> minspec:managed:x >>> -->');
    expect(managedRegionEndMarker('x', 'html')).toBe('<!-- <<< minspec:managed:x <<< -->');
    expect(managedRegionStartMarker('x', 'slash')).toBe('// >>> minspec:managed:x >>>');
    expect(managedRegionEndMarker('x', 'slash')).toBe('// <<< minspec:managed:x <<<');
  });

  it('renderManagedBlock wraps content between start and end markers', () => {
    const block = renderManagedBlock(TPL);
    const lines = block.split('\n');
    expect(lines[0]).toBe(START);
    // End marker is the last non-empty line.
    const nonEmpty = lines.filter((l) => l.length > 0);
    expect(nonEmpty[nonEmpty.length - 1]).toBe(END);
    expect(block).toContain(TPL.content);
  });
});

describe('splitManagedRegion / spliceManagedRegion (#249)', () => {
  it('returns null when markers are absent', () => {
    expect(splitManagedRegion('no markers here\njust text\n', START, END)).toBeNull();
  });

  it('returns null when only the start marker is present (corrupted)', () => {
    expect(splitManagedRegion(`${START}\nbody\n`, START, END)).toBeNull();
  });

  it('returns null when the end marker precedes the start (out of order)', () => {
    expect(splitManagedRegion(`${END}\nbody\n${START}\n`, START, END)).toBeNull();
  });

  it('splits before/after around the region (markers excluded, raw surroundings)', () => {
    // No trailing newline in the source → `after` is the exact surrounding bytes.
    const content = `header line\n${START}\nold body\n${END}\nfooter line`;
    const split = splitManagedRegion(content, START, END);
    expect(split).not.toBeNull();
    expect(split!.before).toBe('header line');
    expect(split!.after).toBe('footer line');
  });

  it('tolerates indented / padded marker lines', () => {
    const content = `pre\n   ${START}   \nx\n\t${END}\t\npost`;
    const split = splitManagedRegion(content, START, END);
    expect(split).not.toBeNull();
    expect(split!.before).toBe('pre');
    expect(split!.after).toBe('post');
  });

  it('splice + split round-trips idempotently', () => {
    const block = renderManagedBlock(TPL);
    const original = `top\n\n${block}\nbottom\n`;
    const split1 = splitManagedRegion(original, START, END)!;
    const out1 = spliceManagedRegion(split1, block);
    const split2 = splitManagedRegion(out1, START, END)!;
    const out2 = spliceManagedRegion(split2, block);
    // Re-splicing the same block produces byte-identical output.
    expect(out2).toBe(out1);
    expect(out1).toContain('top');
    expect(out1).toContain('bottom');
  });
});

describe('managed-region template scaffolding (#249)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-managed-region-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init scaffolds the workflow file wrapped in managed markers', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);
    expect(fs.existsSync(full)).toBe(true);
    const onDisk = fs.readFileSync(full, 'utf-8');
    expect(onDisk).toBe(renderManagedBlock(TPL));
    // Markers are present and the MinSpec content sits between them.
    expect(onDisk).toContain(START);
    expect(onDisk).toContain(END);
    const split = splitManagedRegion(onDisk, START, END);
    expect(split).not.toBeNull();
  });

  it('init does NOT record a whole-file baseline (markers are the boundary)', () => {
    generateHarnessFiles(tmpDir);
    // The obsolete per-file baseline is gone — the markers replace it.
    expect(fs.existsSync(path.join(tmpDir, '.minspec', 'whole-file-baseline.json'))).toBe(false);
  });

  it('init does not overwrite a pre-existing workflow file', () => {
    const full = path.join(tmpDir, WORKFLOW_PATH);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const userContent = 'name: my own workflow\non: push\n';
    fs.writeFileSync(full, userContent);

    generateHarnessFiles(tmpDir);

    expect(fs.readFileSync(full, 'utf-8')).toBe(userContent);
  });

  it('refresh OVERWRITES the managed region with the current template', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);

    // Simulate the bundled template having moved upstream: rewrite the on-disk
    // region body to an OLD value while keeping the markers intact. Refresh must
    // restore the current template inside the markers.
    const stale = `${START}\nname: OLD workflow\non:\n  push:\njobs: {}\n${END}\n`;
    fs.writeFileSync(full, stale);

    const warnings = refreshHarnessFiles(tmpDir);
    expect(warnings).toEqual([]);

    const onDisk = fs.readFileSync(full, 'utf-8');
    expect(onDisk).toContain(TPL.content);
    expect(onDisk).not.toContain('name: OLD workflow');
  });

  it('refresh PRESERVES user content added OUTSIDE the markers', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);

    const scaffolded = fs.readFileSync(full, 'utf-8');
    const userTail =
      '\n# my own extra workflow below the MinSpec region\n' +
      'name: my-extra\non: workflow_dispatch\n';
    const userHead = '# user note above the MinSpec region\n\n';
    fs.writeFileSync(full, userHead + scaffolded + userTail);

    const warnings = refreshHarnessFiles(tmpDir);
    expect(warnings).toEqual([]);

    const onDisk = fs.readFileSync(full, 'utf-8');
    // The user's content outside the region survives verbatim.
    expect(onDisk).toContain('# user note above the MinSpec region');
    expect(onDisk).toContain('# my own extra workflow below the MinSpec region');
    expect(onDisk).toContain('name: my-extra');
    // MinSpec's region is still present and current.
    expect(onDisk).toContain(TPL.content);
  });

  it('refresh updates the MinSpec region EVEN WHEN the user edited outside it (invariant)', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);

    // User edited content outside, AND the region body is stale (upstream moved).
    const stale = `${START}\nname: OLD\non:\n  push:\njobs: {}\n${END}\n`;
    fs.writeFileSync(full, `# user header\n\n${stale}\n# user footer\n`);

    refreshHarnessFiles(tmpDir);

    const onDisk = fs.readFileSync(full, 'utf-8');
    // Outside edits preserved...
    expect(onDisk).toContain('# user header');
    expect(onDisk).toContain('# user footer');
    // ...and MinSpec's region was STILL refreshed (the whole-file rule could not
    // do this — any outside edit would have frozen the region).
    expect(onDisk).toContain(TPL.content);
    expect(onDisk).not.toContain('name: OLD');
  });

  it('refresh on a file with markers DELETED → skip + warn, file untouched', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);

    // User deleted the markers (kept some hand-written content).
    const noMarkers = 'name: hand-rolled, markers removed\non: push\njobs: {}\n';
    fs.writeFileSync(full, noMarkers);

    const warnings = refreshHarnessFiles(tmpDir);

    // File is byte-for-byte untouched.
    expect(fs.readFileSync(full, 'utf-8')).toBe(noMarkers);
    // A single, actionable warning was surfaced for this path.
    expect(warnings).toHaveLength(1);
    expect(warnings[0].outputPath).toBe(WORKFLOW_PATH);
    expect(warnings[0].message).toContain('markers missing');
    expect(warnings[0].message).toContain(WORKFLOW_PATH);
  });

  it('refresh re-scaffolds a DELETED workflow file with markers', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);
    fs.unlinkSync(full);
    expect(fs.existsSync(full)).toBe(false);

    const warnings = refreshHarnessFiles(tmpDir);
    expect(warnings).toEqual([]);

    expect(fs.existsSync(full)).toBe(true);
    expect(fs.readFileSync(full, 'utf-8')).toBe(renderManagedBlock(TPL));
  });

  it('refresh on an unchanged scaffold is a no-op (idempotent)', () => {
    generateHarnessFiles(tmpDir);
    const full = path.join(tmpDir, WORKFLOW_PATH);
    const before = fs.readFileSync(full, 'utf-8');

    const warnings = refreshHarnessFiles(tmpDir);
    expect(warnings).toEqual([]);

    expect(fs.readFileSync(full, 'utf-8')).toBe(before);
  });
});
