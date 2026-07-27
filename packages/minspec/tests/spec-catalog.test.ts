import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listSpecs } from '../src/lib/spec-catalog';

// SPEC-040 FR-4 (AC-6): the recursive spec catalog moved from views/spec-tree-provider
// into lib/spec-catalog. These fs-scan parity tests moved with it — asserting recursion
// into product folders, id-collapse, and phase/progress derivation are behaviour-preserved.

describe('listSpecs()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-tree-test-'));
  });

  function writeSpecFile(dir: string, filename: string, content: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
  }

  function writeMinspecConfig(rootDir: string, specsDir = 'specs'): void {
    const configDir = path.join(rootDir, '.minspec');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ version: '1', specsDir }),
    );
  }

  it('returns empty array when specs dir does not exist', () => {
    const result = listSpecs(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns parsed specs from the specs directory', () => {
    writeMinspecConfig(tmpDir);
    const specsDir = path.join(tmpDir, 'specs');
    writeSpecFile(specsDir, 'SPEC-001.md', `---
id: SPEC-001
title: Rate limiting
tier: T1
status: new
created: 2026-05-26
phases:
  specify: pending
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

## Specify

Add rate limiting.
`);

    const result = listSpecs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('SPEC-001');
    expect(result[0].title).toBe('Rate limiting');
    expect(result[0].tier).toBe('T1');
    expect(result[0].status).toBe('new');
    expect(result[0].currentPhase).toBe('specify');
    expect(result[0].filePath).toBe(path.join(specsDir, 'SPEC-001.md'));
  });

  // T3 regression: specs nested under product/feature subfolders were invisible
  // (listSpecs scanned only specsDir top-level + spec-kit dirs) → empty Specs pane.
  function fmSpec(id: string, title: string, status = 'new'): string {
    return `---\nid: ${id}\ntitle: ${title}\ntier: T2\nstatus: ${status}\ncreated: 2026-05-31\nphases:\n  specify: done\n---\n\n# ${title}\n`;
  }

  it('recurses into product/feature subfolders (nested specs)', () => {
    writeMinspecConfig(tmpDir);
    const specsDir = path.join(tmpDir, 'specs');
    writeSpecFile(path.join(specsDir, 'minspec'), 'requirements.md', fmSpec('SPEC-001', 'Core'));
    writeSpecFile(path.join(specsDir, 'minspec', 'epic-grouping'), 'requirements.md', fmSpec('SPEC-007', 'Epics'));
    writeSpecFile(path.join(specsDir, 'scroogellm'), 'design.md', fmSpec('SPEC-100', 'Proxy'));

    const ids = listSpecs(tmpDir).map(s => s.id).sort();
    expect(ids).toEqual(['SPEC-001', 'SPEC-007', 'SPEC-100']);
  });

  it('collapses multiple files sharing one id, preferring requirements.md', () => {
    writeMinspecConfig(tmpDir);
    const dir = path.join(tmpDir, 'specs', 'minspec', 'classifier-validation');
    writeSpecFile(dir, 'requirements.md', fmSpec('SPEC-004', 'Validation'));
    writeSpecFile(dir, 'design.md', fmSpec('SPEC-004', 'Validation'));
    writeSpecFile(dir, 'tasks.md', fmSpec('SPEC-004', 'Validation'));

    const matches = listSpecs(tmpDir).filter(s => s.id === 'SPEC-004');
    expect(matches).toHaveLength(1);
    expect(path.basename(matches[0].filePath)).toBe('requirements.md');
    // design.md/tasks.md share SPEC-004's OWN id — genuinely its phase-files.
    expect(matches[0].hasDesignFile).toBe(true);
    expect(matches[0].hasTasksFile).toBe(true);
  });

  // Invariant guard (PR #472 review finding #1): ownership is keyed by the
  // phase-file's OWN frontmatter id, never by directory co-location — so a
  // design.md/tasks.md carrying a DIFFERENT id than the sibling requirements.md
  // is never claimed. (The live repo's mis-numbered clusters —
  // specs/minspec/{design,tasks}.md and SPEC-007-epic-grouping/{design,tasks}.md
  // — were renumbered to share their parent id in this same PR, so the intended
  // split-layout specs now resolve correctly; this test locks the algorithm's
  // no-cross-id-contamination guarantee so a future stray file can't leak in.)
  it('does NOT claim a sibling design.md/tasks.md that belongs to a DIFFERENT spec id', () => {
    writeMinspecConfig(tmpDir);
    const dir = path.join(tmpDir, 'specs', 'minspec');
    writeSpecFile(dir, 'requirements.md', fmSpec('SPEC-001', 'Core requirements'));
    writeSpecFile(dir, 'design.md', fmSpec('SPEC-002', 'Core design'));
    writeSpecFile(dir, 'tasks.md', fmSpec('SPEC-003', 'Core tasks'));

    const result = listSpecs(tmpDir);
    const spec001 = result.find(s => s.id === 'SPEC-001');
    expect(spec001?.hasDesignFile).toBe(false);
    expect(spec001?.hasTasksFile).toBe(false);

    // SPEC-002/SPEC-003 are real, independent specs — they still appear.
    expect(result.map(s => s.id).sort()).toEqual(['SPEC-001', 'SPEC-002', 'SPEC-003']);
  });

  it('spec-kit layout: hasDesignFile/hasTasksFile reflect real plan.md/tasks.md shard files', () => {
    writeMinspecConfig(tmpDir, 'specs');
    const dir = path.join(tmpDir, 'specs', '005-spec-kit-example');
    writeSpecFile(dir, 'spec.md', fmSpec('SPEC-005', 'Spec kit example'));
    writeSpecFile(dir, 'plan.md', '# Plan\n');
    // tasks.md deliberately absent — Tasks phase not started yet.

    const matches = listSpecs(tmpDir).filter(s => s.id === 'SPEC-005');
    expect(matches).toHaveLength(1);
    expect(matches[0].hasDesignFile).toBe(true);
    expect(matches[0].hasTasksFile).toBe(false);
  });

  it('skips files without an id', () => {
    writeMinspecConfig(tmpDir);
    const specsDir = path.join(tmpDir, 'specs');
    writeSpecFile(specsDir, 'random.md', '# Just a readme\n\nNo frontmatter spec.');

    const result = listSpecs(tmpDir);
    expect(result).toHaveLength(0);
  });

  it('skips non-markdown files', () => {
    writeMinspecConfig(tmpDir);
    const specsDir = path.join(tmpDir, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'notes.txt'), 'not a spec');
    writeSpecFile(specsDir, 'SPEC-001.md', `---
id: SPEC-001
title: Real spec
tier: T2
status: new
created: 2026-05-26
phases:
  specify: pending
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---
`);

    const result = listSpecs(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('SPEC-001');
  });

  it('sorts specs by id', () => {
    writeMinspecConfig(tmpDir);
    const specsDir = path.join(tmpDir, 'specs');
    writeSpecFile(specsDir, 'SPEC-003.md', `---
id: SPEC-003
title: Third
tier: T1
status: new
created: 2026-05-26
phases:
  specify: pending
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---
`);
    writeSpecFile(specsDir, 'SPEC-001.md', `---
id: SPEC-001
title: First
tier: T1
status: new
created: 2026-05-26
phases:
  specify: pending
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---
`);

    const result = listSpecs(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('SPEC-001');
    expect(result[1].id).toBe('SPEC-003');
  });

  it('derives current phase correctly for in-progress spec', () => {
    writeMinspecConfig(tmpDir);
    const specsDir = path.join(tmpDir, 'specs');
    writeSpecFile(specsDir, 'SPEC-001.md', `---
id: SPEC-001
title: In progress
tier: T2
status: implementing
created: 2026-05-26
phases:
  specify: done
  clarify: skipped
  plan: done
  tasks: done
  implement: in-progress
---
`);

    const result = listSpecs(tmpDir);
    expect(result[0].currentPhase).toBe('implement');
  });

  it('returns null currentPhase when all phases done', () => {
    writeMinspecConfig(tmpDir);
    const specsDir = path.join(tmpDir, 'specs');
    writeSpecFile(specsDir, 'SPEC-001.md', `---
id: SPEC-001
title: Complete
tier: T2
status: done
created: 2026-05-26
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: done
---
`);

    const result = listSpecs(tmpDir);
    expect(result[0].currentPhase).toBeNull();
  });
});

// ─── AC-6: the fs scan stays OUT of the view ─────────────────────────────────
//
// The behavioural tests above all call `listSpecs` from lib, so they pass just
// as happily if a SECOND recursive scan is re-introduced into
// views/spec-tree-provider.ts alongside it — the exact regression FR-4 exists to
// prevent, and one no behavioural assertion can see. AC-6's "spec-tree-provider
// no longer defines the fs scan" clause therefore needs a source-level check.
// Mirrors the read-the-source pattern import-boundaries.test.ts uses for
// presence.ts's type-only vscode import.
const SPEC_TREE_PROVIDER = path.resolve(__dirname, '..', 'src', 'views', 'spec-tree-provider.ts');

describe('AC-6: spec-tree-provider delegates the fs scan to lib/spec-catalog', () => {
  const source = fs.readFileSync(SPEC_TREE_PROVIDER, 'utf8');

  it('does not read the specs directory itself', () => {
    expect(
      source,
      'views/spec-tree-provider.ts calls readdirSync again. SPEC-040 FR-4 moved the recursive ' +
        'spec scan to lib/spec-catalog precisely so the approve/approve-active/validate flows ' +
        'stop depending on a high-churn UI file — a second scan in the view re-opens that ' +
        'coupling and lets the two silently diverge. Extend lib/spec-catalog instead.',
    ).not.toContain('readdirSync');
  });

  it('imports the catalog scan from lib/spec-catalog', () => {
    expect(
      /^import \{[^}]*\blistSpecs\b[^}]*\} from '\.\.\/lib\/spec-catalog';$/m.test(source),
      'views/spec-tree-provider.ts no longer imports listSpecs from ../lib/spec-catalog. ' +
        'The view must keep consuming the Tier-0 catalog (AC-6) rather than growing its own ' +
        'scan; if the import genuinely moved, repoint this assertion at its new lib home.',
    ).toBe(true);
  });
});

