/**
 * #2467 — nothing detects a harness file whose sections were all appended a
 * second time.
 *
 * `refreshHarnessFiles` → `mergeFile` (merge-refresh.ts) can leave a CRLF
 * `existing` harness file (CLAUDE.md, .minspec/constitution.md, …) with every
 * template section doubled: `parseSections` splits on `\n` only, and a bare
 * `.` in JS excludes `\r` as a line terminator, so a still-CRLF heading line
 * (`## Overview\r`) fails `^## (.+)$` entirely and is swallowed into the
 * surrounding body instead of being recognized as a heading. The whole file
 * then reads as one `__preamble__` section, every template section gets
 * freshly appended (nothing matched to consume it), and the old headings
 * survive only as plain text inside the preserved preamble — present in the
 * raw bytes, invisible to section-level parsing. A later Refresh keeps a
 * surplus duplicate-named section as user content BY DESIGN (#153), so the
 * file stays doubled forever.
 *
 * `detectDoubledTemplateHeadings` is the validator-side backstop that finds a
 * file already in this state, by counting raw heading-line occurrences
 * directly (not via `parseSections`, which structurally cannot see the
 * damage). These tests pin detection on the realistic mixed-EOL shape AND the
 * false-positive discipline: a user file with its OWN legitimately repeated
 * heading (not owned by the template) must never be flagged.
 */
import { describe, it, expect } from 'vitest';
import { detectDoubledTemplateHeadings } from '../src/lib/merge-refresh';

describe('detectDoubledTemplateHeadings() — #2467', () => {
  it('detects every template heading doubled, in the realistic mixed-EOL shape', () => {
    // The old CRLF file survives as one preserved blob (headings invisible to
    // parseSections), followed by the freshly-appended, clean-LF template
    // sections — exactly what `mergeFile` produces when it cannot recognize
    // any heading in a CRLF `existing` file.
    const damaged =
      ['# Old Title\r', '## Overview\r', 'old body line 1\r', '## Rules\r', 'old rule\r'].join('\n') +
      '\n' +
      ['## Overview', 'new body line 1', '## Rules', 'new rule'].join('\n');

    expect(detectDoubledTemplateHeadings(damaged, ['Overview', 'Rules'])).toEqual(
      expect.arrayContaining(['Overview', 'Rules']),
    );
  });

  it('detects a doubled heading even when both copies are plain LF', () => {
    const damaged = '## Overview\nfirst copy\n## Overview\nsecond copy\n';
    expect(detectDoubledTemplateHeadings(damaged, ['Overview'])).toEqual(['Overview']);
  });

  it('does not flag a clean, undamaged file', () => {
    const clean = '## Overview\nfoo\n## Rules\nbar\n';
    expect(detectDoubledTemplateHeadings(clean, ['Overview', 'Rules'])).toEqual([]);
  });

  it('does not flag a user-added heading the template does not own, even if repeated', () => {
    // mergeFile's own documented behavior (#153): a user file may legitimately
    // repeat a heading the template never carries. That is ordinary user
    // content, not damage, and must never be flagged.
    const legit = '## Overview\nfoo\n## Notes\nuser note 1\n## Notes\nuser note 2\n';
    expect(detectDoubledTemplateHeadings(legit, ['Overview'])).toEqual([]);
  });

  it('does not flag a heading that appears once', () => {
    const once = '## Overview\nfoo\n## Rules\nbar\n';
    expect(detectDoubledTemplateHeadings(once, ['Overview', 'Rules', 'Unused'])).toEqual([]);
  });
});
