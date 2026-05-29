import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  splitSpecForSpecKit,
  mergeSpecKitShards,
  writeSpecKitDir,
  readSpecKitDir,
  specKitDirName,
  isSpecKitDirEntry,
  SPEC_KIT_FILES,
} from '../src/lib/spec-layout';
import { parseSpec, writeSpec } from '../src/lib/spec';

const FULL_SPEC = `---
id: SPEC-007
title: Add OAuth login
tier: T3
status: implementing
created: 2026-05-29
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: pending
---

Preamble paragraph describing the feature in plain text.

## Specify

OAuth login via Google and GitHub.

## Clarify

- Use PKCE flow
- Refresh tokens stored in keychain

## Plan

1. Add /auth/oauth/:provider route
2. Wire passport strategies

## Tasks

- [x] Add passport-google-oauth20
- [ ] Add passport-github2
- [ ] Write integration tests

## Implement

Begin with the Google provider.

## Open Questions

Should we support Microsoft too?
`;

describe('specKitDirName()', () => {
  it('strips SPEC- prefix and joins with slug', () => {
    expect(specKitDirName('SPEC-007', 'add-oauth-login')).toBe('007-add-oauth-login');
  });

  it('handles missing slug', () => {
    expect(specKitDirName('SPEC-042', '')).toBe('042');
  });

  it('preserves multi-digit IDs', () => {
    expect(specKitDirName('SPEC-1234', 'something')).toBe('1234-something');
  });
});

describe('isSpecKitDirEntry()', () => {
  it('matches NNN-slug dir names', () => {
    expect(isSpecKitDirEntry('007-add-oauth-login')).toBe(true);
    expect(isSpecKitDirEntry('001-anything')).toBe(true);
  });

  it('rejects non-numeric prefixes', () => {
    expect(isSpecKitDirEntry('SPEC-007-add-oauth')).toBe(false);
    expect(isSpecKitDirEntry('README.md')).toBe(false);
    expect(isSpecKitDirEntry('drafts')).toBe(false);
  });
});

describe('splitSpecForSpecKit()', () => {
  it('routes phase sections to correct files', () => {
    const parsed = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(parsed);

    expect(shards['spec.md'].sections.has('Specify')).toBe(true);
    expect(shards['spec.md'].sections.has('Clarify')).toBe(true);
    expect(shards['plan.md'].sections.has('Plan')).toBe(true);
    expect(shards['tasks.md'].sections.has('Tasks')).toBe(true);
    expect(shards['tasks.md'].sections.has('Implement')).toBe(true);
  });

  it('keeps non-phase sections in spec.md', () => {
    const parsed = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(parsed);
    expect(shards['spec.md'].sections.has('Open Questions')).toBe(true);
    expect(shards['plan.md'].sections.has('Open Questions')).toBe(false);
  });

  it('puts preamble in spec.md only', () => {
    const parsed = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(parsed);
    expect(shards['spec.md'].preamble).toContain('Preamble paragraph');
    expect(shards['plan.md'].preamble).toBe('');
    expect(shards['tasks.md'].preamble).toBe('');
  });
});

describe('split → merge round trip (T0 invariant: no data loss)', () => {
  it('preserves frontmatter, preamble, every section, and tasks', () => {
    const original = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(original);
    const merged = mergeSpecKitShards(shards);

    expect(merged.frontmatter).toEqual(original.frontmatter);
    expect(merged.preamble).toBe(original.preamble);

    for (const [heading, body] of original.sections) {
      expect(merged.sections.get(heading)).toBe(body);
    }
  });

  it('serialized merged form re-parses to identical frontmatter', () => {
    const original = parseSpec(FULL_SPEC);
    const shards = splitSpecForSpecKit(original);
    const merged = mergeSpecKitShards(shards);
    const written = writeSpec(merged);
    const reparsed = parseSpec(written);

    expect(reparsed.frontmatter).toEqual(original.frontmatter);
    expect(reparsed.phaseSections.tasks?.tasks).toEqual(original.phaseSections.tasks?.tasks);
  });
});

describe('writeSpecKitDir / readSpecKitDir (filesystem round trip)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-layout-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes spec.md with frontmatter and plan.md/tasks.md without', () => {
    const parsed = parseSpec(FULL_SPEC);
    const dirPath = path.join(tmpDir, '007-add-oauth-login');
    writeSpecKitDir(dirPath, parsed);

    const specMd = fs.readFileSync(path.join(dirPath, 'spec.md'), 'utf-8');
    expect(specMd.startsWith('---\n')).toBe(true);
    expect(specMd).toContain('id: SPEC-007');

    const planMd = fs.readFileSync(path.join(dirPath, 'plan.md'), 'utf-8');
    expect(planMd.startsWith('---')).toBe(false);
    expect(planMd).toContain('## Plan');

    const tasksMd = fs.readFileSync(path.join(dirPath, 'tasks.md'), 'utf-8');
    expect(tasksMd.startsWith('---')).toBe(false);
    expect(tasksMd).toContain('## Tasks');
    expect(tasksMd).toContain('## Implement');
  });

  it('round-trips through filesystem without data loss', () => {
    const original = parseSpec(FULL_SPEC);
    const dirPath = path.join(tmpDir, '007-add-oauth-login');
    writeSpecKitDir(dirPath, original);

    const reread = readSpecKitDir(dirPath);
    expect(reread.frontmatter).toEqual(original.frontmatter);
    for (const [heading, body] of original.sections) {
      expect(reread.sections.get(heading)).toBe(body);
    }
  });

  it('tolerates missing plan.md/tasks.md (only spec.md required)', () => {
    const minimal = `---
id: SPEC-001
title: Minimal
tier: T1
status: new
created: 2026-05-29
phases:
  specify: pending
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

## Specify

Just the spec.
`;
    const dirPath = path.join(tmpDir, '001-minimal');
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, 'spec.md'), minimal, 'utf-8');

    const parsed = readSpecKitDir(dirPath);
    expect(parsed.frontmatter.id).toBe('SPEC-001');
    expect(parsed.sections.get('Specify')).toContain('Just the spec.');
  });

  it('removes plan.md/tasks.md on rewrite if their phases became empty', () => {
    const parsed = parseSpec(FULL_SPEC);
    const dirPath = path.join(tmpDir, '007-add-oauth-login');
    writeSpecKitDir(dirPath, parsed);
    expect(fs.existsSync(path.join(dirPath, 'plan.md'))).toBe(true);

    // Strip the Plan section, rewrite
    const trimmed = { ...parsed, sections: new Map(parsed.sections) };
    trimmed.sections.delete('Plan');
    writeSpecKitDir(dirPath, trimmed);

    expect(fs.existsSync(path.join(dirPath, 'plan.md'))).toBe(false);
    // tasks.md still has Tasks + Implement
    expect(fs.existsSync(path.join(dirPath, 'tasks.md'))).toBe(true);
  });

  it('exports the canonical SPEC_KIT_FILES list', () => {
    expect(SPEC_KIT_FILES).toEqual(['spec.md', 'plan.md', 'tasks.md']);
  });
});
