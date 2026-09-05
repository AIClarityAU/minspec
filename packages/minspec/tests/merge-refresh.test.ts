import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The #1697 F2 block at the bottom drives the REAL `initRefreshCommand` over a
// REAL temp project, so the only thing stubbed is the editor surface itself. The
// rest of this file touches no vscode module, so the mock is inert for it.
//
// The temp projects below are deliberately NOT git repos: `offerScaffoldCommit`,
// `offerRemoteRenameAdvisory` and `offerRulesetAdvisory` all early-return on a
// missing `.git`, so the command reduces to exactly the toasts under test with no
// subprocess and no network.
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showTextDocument: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn() })),
    openTextDocument: vi.fn(async (p: string) => ({ path: p })),
  },
  commands: { executeCommand: vi.fn() },
}));

import * as vscode from 'vscode';
import {
  parseSections,
  hashSection,
  buildSectionHashes,
  hasAuthoredListItems,
  hasAuthoredContent,
  contentItems,
  mergeFile,
  sectionHashesFromMarkdown,
  loadHashes,
  loadProvenHashes,
  saveHashes,
  PREAMBLE_HEADING,
  type MergeResult,
  type SectionHashes,
} from '../src/lib/merge-refresh';
import {
  applyAuthorshipCorrections,
  generateHarnessFiles,
  refreshHarnessFiles,
  rescaffoldManagedRegionFile,
  preservedWithoutBaselineMessage,
  type ManagedRegionWarning,
} from '../src/lib/scaffold';
import {
  initRefreshCommand,
  refreshSummaryMessage,
  surfaceManagedRegionWarning,
} from '../src/commands/init';
import { MANAGED_REGION_TEMPLATES } from '../src/lib/template-registry';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * The baseline the NEXT refresh will read, composed exactly the way the product
 * composes it (#1697 NEW-A3).
 *
 * `mergeFile` used to hand back a `newHashes` map and this file chained it —
 * `merge(first.merged, TEMPLATE, first.newHashes)` — as if it were the manifest.
 * It never was. Nothing in `src/` read that field: `refreshHarnessFiles`
 * destructures `merged`, `preservedWithoutBaseline`, `withheldTemplateHashes` and
 * `unauthoredHeadings`, and `recordVerifyAndSaveManifest` rebuilds the manifest
 * from FINAL ON-DISK BYTES corrected by the latter two. The two answers DIFFER: a
 * branch-decided hash is taken from the template body before `sectionsToMarkdown`
 * collapses its internal blank runs, so a section MinSpec had just written was
 * recorded as `3d74d181…` while disk hashed `2741b60e…` — and a test that fed that
 * back pinned the section into the user-modified branch for ever, while the real
 * manifest kept it tracking. So a whole tier of these tests was steering by a value
 * the product does not use.
 *
 * That is the size of the claim and no larger, and the same narrowing is written at
 * {@link MergeResult}. The two answers agree except where the template body carries
 * an internal blank run — measured: a control body without one hashes identically at
 * the branch and on disk — so the chained tests were not each getting a wrong
 * answer. What they had was a SECOND ANSWER THAT CAN DISAGREE, which is the defect
 * removed.
 *
 * The field is gone. This helper is what replaces it, and it calls the SAME
 * exported function `recordVerifyAndSaveManifest` calls, over the bytes the merge
 * actually wrote — so a change to the CORRECTION rule reaches the product and this
 * helper together. It is not a guarantee that the two manifests match: each side
 * still composes its own disk argument, which is what the caveat below is about, and
 * AC-63 is what pins the pair against a real refresh.
 *
 * One honest caveat, and it is production's caveat rather than this helper's: a
 * real refresh hashes disk AFTER the post-merge writers (`seedConstitution`, the
 * AGENTS.md slash injection) have run. At the `mergeFile` level there are no such
 * writers, so the bytes the merge wrote ARE final disk. Tests that need the
 * post-writer manifest drive `refreshHarnessFiles` over a real directory instead,
 * as the integration tests below do.
 */
const persistedHashes = (result: MergeResult): SectionHashes =>
  applyAuthorshipCorrections(
    sectionHashesFromMarkdown(result.merged),
    result.withheldTemplateHashes,
    result.unauthoredHeadings,
  );

describe('merge-refresh', () => {
  describe('parseSections()', () => {
    it('parses preamble when no headings', () => {
      const sections = parseSections('Just some text\nwith lines');
      expect(sections).toHaveLength(1);
      expect(sections[0].heading).toBe('__preamble__');
      expect(sections[0].body).toContain('Just some text');
    });

    it('parses multiple ## headings', () => {
      const content = `# Title

Preamble text

## Section One

Content one

## Section Two

Content two
`;
      const sections = parseSections(content);
      expect(sections).toHaveLength(3);
      expect(sections[0].heading).toBe('__preamble__');
      expect(sections[0].body).toContain('# Title');
      expect(sections[1].heading).toBe('Section One');
      expect(sections[1].body).toContain('Content one');
      expect(sections[2].heading).toBe('Section Two');
      expect(sections[2].body).toContain('Content two');
    });

    it('handles empty sections', () => {
      const content = `## Empty Section

## Another Section

Content here
`;
      const sections = parseSections(content);
      expect(sections).toHaveLength(3); // preamble + 2 sections
      expect(sections[1].heading).toBe('Empty Section');
      expect(sections[1].body.trim()).toBe('');
    });
  });

  describe('hashSection()', () => {
    it('is deterministic — same content same hash', () => {
      const hash1 = hashSection('hello world');
      const hash2 = hashSection('hello world');
      expect(hash1).toBe(hash2);
    });

    it('different content produces different hash', () => {
      const hash1 = hashSection('hello');
      const hash2 = hashSection('world');
      expect(hash1).not.toBe(hash2);
    });

    it('trims whitespace before hashing', () => {
      const hash1 = hashSection('hello  \n\n');
      const hash2 = hashSection('  hello');
      expect(hash1).toBe(hash2);
    });

    it('returns a hex string', () => {
      const hash = hashSection('test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('buildSectionHashes()', () => {
    it('builds hash map from sections', () => {
      const sections = parseSections('## A\n\nfoo\n\n## B\n\nbar\n');
      const hashes = buildSectionHashes(sections);
      expect(hashes).toHaveProperty('__preamble__');
      expect(hashes).toHaveProperty('A');
      expect(hashes).toHaveProperty('B');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // #1697 F8 — the SCOPE LIMIT on failing closed, pinned at its boundaries.
  //
  // `hasAuthoredContent` is the predicate that decides whether the fail-closed
  // rule applies to a section at all, and it had no test of its own. Getting it
  // wrong is silent in both directions and neither direction shows up as a
  // crash:
  //
  //   too GENEROUS (a placeholder reads as content) → a section the user left
  //     empty can never again be populated from the template on any machine
  //     without the gitignored baseline, which is most machines. #706's
  //     "no over-preserve" boundary, inverted, and the harness quietly freezes.
  //
  //   too STINGY (real content reads as empty) → #1697 comes straight back: the
  //     template overwrites a section the merge had no evidence about.
  //
  // These pin the boundary itself, then pin that `mergeFile` really turns on it.
  // ───────────────────────────────────────────────────────────────────────────
  describe('hasAuthoredContent() — T0 #1697/F8: the fail-closed scope limit', () => {
    it('AC-20 (content): prose, a list, a table and a code fence all count', () => {
      expect(hasAuthoredContent('The v1.4 fan-out is authorised to bypass the queue.')).toBe(true);
      expect(hasAuthoredContent('- one bullet\n- another\n')).toBe(true);
      expect(hasAuthoredContent('1. a numbered item\n')).toBe(true);
      expect(hasAuthoredContent('| a | b |\n| - | - |\n| 1 | 2 |\n')).toBe(true);
      expect(hasAuthoredContent('```sh\nnpm test\n```\n')).toBe(true);
    });

    it('AC-20b (nothing there): empty and whitespace-only bodies do not count', () => {
      expect(hasAuthoredContent('')).toBe(false);
      expect(hasAuthoredContent('\n')).toBe(false);
      expect(hasAuthoredContent('   \n\t\n  \n')).toBe(false);
    });

    it('AC-20c (the template placeholder): an HTML-comment-only body does not count', () => {
      // Exactly what the bundled constitution ships for its content sections —
      // a commented-out example and nothing else. This is the case the scope
      // limit exists for: a section shaped like this has nothing to destroy, so
      // holding it would buy no safety and would cost the template update
      // forever.
      expect(hasAuthoredContent('<!-- Add project invariants here -->')).toBe(false);
      expect(
        hasAuthoredContent('<!-- Add goals here. Example: -->\n<!-- 1. Ship it -->\n'),
      ).toBe(false);
      // …including a multi-line comment, which the single-line regex would miss.
      expect(hasAuthoredContent('<!--\nAdd goals here.\n1. Ship it\n-->\n')).toBe(false);
    });

    it('AC-20d (a comment never masks real content): prose beside a comment counts', () => {
      expect(hasAuthoredContent('<!-- a note to editors -->\nRatified 2026-03-11.\n')).toBe(true);
      expect(hasAuthoredContent('Ratified 2026-03-11.\n<!-- a note to editors -->\n')).toBe(true);
    });

    it('AC-20e (DOCUMENTED COST, not an accident): a deliberate "intentionally empty" marker is unauthored', () => {
      // The docstring admits this and accepts it: a human who writes ONLY
      // `<!-- intentionally empty, see DR-012 -->` into a section has that
      // sentence replaced by the template on a machine with no baseline.
      //
      // Pinned so it is a DECISION with a test behind it rather than a
      // side-effect nobody chose. The trade is deliberate — treating any comment
      // as content would re-freeze every unfilled template placeholder, which is
      // the far larger population — and it is unchanged from the behaviour that
      // shipped before #1697, so the fix neither introduced nor widened it.
      //
      // If this ever becomes unacceptable, the fix is a positive marker the merge
      // recognises, NOT loosening the predicate — flipping this assertion alone
      // would reintroduce #706.
      expect(hasAuthoredContent('<!-- intentionally empty, see DR-012 -->')).toBe(false);
    });

    it('AC-20f (the predicate is load-bearing): mergeFile turns on it, both ways', () => {
      // The unit assertions above are only worth having if the merge really
      // consults them, so drive the two sides through `mergeFile` with the SAME
      // empty baseline and the SAME template — the only difference is whether
      // the existing body holds authored content.
      const template = '# X\n\n## Goals\n\n1. Seeded goal from the template.\n';

      // Placeholder-only → nothing to destroy → still populated (#706's
      // no-over-preserve boundary), and nothing reported, because nothing was
      // withheld from anybody.
      const placeholder = mergeFile('# X\n\n## Goals\n\n<!-- Add goals here -->\n', template, {});
      expect(placeholder.merged).toContain('Seeded goal from the template.');
      expect(placeholder.preservedWithoutBaseline).toEqual([]);

      // Authored prose → no evidence it is a template body → held AND reported.
      const authored = mergeFile(
        '# X\n\n## Goals\n\nShip the queue-boundary rule by Q3. Ratified 2026-03-11.\n',
        template,
        {},
      );
      expect(authored.merged).toContain('Ratified 2026-03-11.');
      expect(authored.merged).not.toContain('Seeded goal from the template.');
      expect(authored.preservedWithoutBaseline).toEqual(['Goals']);
    });
  });

  describe('mergeFile() — T0 invariant tests', () => {
    // Helper: create a simple markdown doc
    const makeDoc = (...sections: [string, string][]) => {
      return sections
        .map(([heading, body]) =>
          heading === '__preamble__' ? body : `## ${heading}\n\n${body}`,
        )
        .join('\n\n')
        .trimEnd() + '\n';
    };

    it('T0: refresh preserves user-edited sections', () => {
      const original = makeDoc(
        ['__preamble__', '# Project'],
        ['Overview', 'Original overview'],
        ['Setup', 'Original setup'],
      );
      const originalSections = parseSections(original);
      const oldHashes = buildSectionHashes(originalSections);

      // User edits the Overview section
      const userEdited = makeDoc(
        ['__preamble__', '# Project'],
        ['Overview', 'My custom overview with details'],
        ['Setup', 'Original setup'],
      );

      // New template has updated Setup
      const newTemplate = makeDoc(
        ['__preamble__', '# Project'],
        ['Overview', 'New template overview'],
        ['Setup', 'Updated setup instructions'],
      );

      const { merged } = mergeFile(userEdited, newTemplate, oldHashes);

      // User-edited Overview must be preserved
      expect(merged).toContain('My custom overview with details');
      expect(merged).not.toContain('New template overview');

      // Unmodified Setup gets updated from template
      expect(merged).toContain('Updated setup instructions');
      expect(merged).not.toContain('Original setup');
    });

    it('T0: refresh updates unmodified sections from new template', () => {
      const original = makeDoc(
        ['__preamble__', '# Project'],
        ['Intro', 'Old intro text'],
      );
      const oldHashes = buildSectionHashes(parseSections(original));

      // User did NOT edit — file is identical to original
      const unchanged = original;

      // New template has updated Intro
      const newTemplate = makeDoc(
        ['__preamble__', '# Project'],
        ['Intro', 'Brand new intro text'],
      );

      const { merged } = mergeFile(unchanged, newTemplate, oldHashes);
      expect(merged).toContain('Brand new intro text');
      expect(merged).not.toContain('Old intro text');
    });

    it('T0: refresh appends new sections not in existing file', () => {
      const original = makeDoc(
        ['__preamble__', '# Project'],
        ['Existing', 'Existing content'],
      );
      const oldHashes = buildSectionHashes(parseSections(original));

      const newTemplate = makeDoc(
        ['__preamble__', '# Project'],
        ['Existing', 'Existing content'],
        ['Brand New Section', 'This is a new section from template'],
      );

      const { merged } = mergeFile(original, newTemplate, oldHashes);
      expect(merged).toContain('## Brand New Section');
      expect(merged).toContain('This is a new section from template');
      // Existing content preserved
      expect(merged).toContain('Existing content');
    });

    it('T0: refresh preserves user-added sections not in template', () => {
      const original = makeDoc(
        ['__preamble__', '# Project'],
        ['Template Section', 'From template'],
      );
      const oldHashes = buildSectionHashes(parseSections(original));

      // User added a custom section
      const userFile = makeDoc(
        ['__preamble__', '# Project'],
        ['Template Section', 'From template'],
        ['My Custom Section', 'My custom content that I added'],
      );

      // New template doesn't include user's custom section
      const newTemplate = makeDoc(
        ['__preamble__', '# Project'],
        ['Template Section', 'Updated template content'],
      );

      const { merged } = mergeFile(userFile, newTemplate, oldHashes);
      // User's custom section must be preserved
      expect(merged).toContain('## My Custom Section');
      expect(merged).toContain('My custom content that I added');
      // Template section gets updated (was unmodified)
      expect(merged).toContain('Updated template content');
    });

    it('round-trip: generate → save hashes → no edits → refresh = identical', () => {
      const generated = makeDoc(
        ['__preamble__', '# Project'],
        ['Overview', 'Template overview'],
        ['Setup', 'Template setup'],
        ['Advanced', 'Template advanced'],
      );
      const sections = parseSections(generated);
      const hashes = buildSectionHashes(sections);

      // Refresh with no edits — content should be identical
      const { merged } = mergeFile(generated, generated, hashes);
      // Normalize whitespace for comparison
      expect(merged.trim()).toBe(generated.trim());
    });

    it('empty old hashes (first refresh after manual creation): existing sections are held, genuinely-new ones still added (#1697)', () => {
      const existing = makeDoc(
        ['__preamble__', '# Project'],
        ['Intro', 'User wrote this manually'],
      );

      const newTemplate = makeDoc(
        ['__preamble__', '# Project'],
        ['Intro', 'Template intro'],
        ['New Section', 'From template'],
      );

      // No old hashes — so there is NO evidence that `Intro` is unmodified, and
      // the merge must hold what is on disk rather than assume it is pristine
      // (#1697). `New Section` has no counterpart on disk, so no user content is
      // at risk and the template body is still added.
      const { merged } = mergeFile(existing, newTemplate, {});
      expect(merged).toContain('User wrote this manually');
      expect(merged).not.toContain('Template intro');
      expect(merged).toContain('## New Section');
      expect(merged).toContain('From template');
    });

    it('preserves section ordering: template sections first, then user sections', () => {
      const original = makeDoc(
        ['__preamble__', '# Project'],
        ['A', 'Section A'],
        ['B', 'Section B'],
      );
      const oldHashes = buildSectionHashes(parseSections(original));

      const userFile = makeDoc(
        ['__preamble__', '# Project'],
        ['A', 'Section A'],
        ['B', 'Section B'],
        ['Z-Custom', 'User added this'],
      );

      // Template reorders and adds C
      const newTemplate = makeDoc(
        ['__preamble__', '# Project'],
        ['A', 'Updated A'],
        ['C', 'New section C'],
        ['B', 'Updated B'],
      );

      const { merged } = mergeFile(userFile, newTemplate, oldHashes);

      // Template ordering: A, C, B, then user's Z-Custom
      const aIdx = merged.indexOf('## A');
      const cIdx = merged.indexOf('## C');
      const bIdx = merged.indexOf('## B');
      const zIdx = merged.indexOf('## Z-Custom');

      expect(aIdx).toBeLessThan(cIdx);
      expect(cIdx).toBeLessThan(bIdx);
      expect(bIdx).toBeLessThan(zIdx);
    });

    it('new hashes record the TEMPLATE body MinSpec generated, not the user body it kept', () => {
      const original = makeDoc(
        ['__preamble__', '# Project'],
        ['Sec', 'Original content'],
      );
      const oldHashes = buildSectionHashes(parseSections(original));

      // User edits Sec
      const userEdited = makeDoc(
        ['__preamble__', '# Project'],
        ['Sec', 'User edited content'],
      );

      const newTemplate = makeDoc(
        ['__preamble__', '# Project'],
        ['Sec', 'Template content v2'],
      );

      const result = mergeFile(userEdited, newTemplate, oldHashes);

      // The user's version is kept…
      expect(result.merged).toContain('User edited content');
      // …but the RECORDED hash is the template body that was withheld (#1697 F1).
      // Recording the kept body instead would claim MinSpec authored it, and the
      // next refresh would read `oldHash === existingHash` as proof the section is
      // a pristine template and overwrite the edit — the loss this file exists to
      // pin. This assertion was inverted before that was understood.
      //
      // Asserted against the manifest the refresh will actually FILE, not against
      // the discarded per-branch map this used to read (#1697 NEW-A3).
      expect(persistedHashes(result)['Sec']).toBe(hashSection('Template content v2'));
      expect(persistedHashes(result)['Sec']).not.toBe(hashSection('User edited content'));
    });

    it('T3 (#153): refresh preserves both bodies of duplicate-named ## sections', () => {
      // The original generated file had a single "Notes" + "Other" section.
      const original = `# Project

## Notes

Template notes body.

## Other

Template other content.
`;
      // Hashes are stored from that generation, so the merge can tell the user
      // edited the first "Notes" (it differs from this stored hash).
      const oldHashes = buildSectionHashes(parseSections(original));

      // User edits the first "Notes" AND adds a SECOND "Notes" section with a
      // distinct body — two sections now share the heading "Notes".
      const userFile = `# Project

## Notes

First notes body that the user wrote.

## Other

Template other content.

## Notes

Second notes body — completely different, must not be lost.
`;

      // Template still only knows about a single "Notes" + "Other".
      const newTemplate = original;

      // Without the fix, the Map keyed on heading text collapses the two
      // "Notes" sections and one body is dropped.
      const { merged } = mergeFile(userFile, newTemplate, oldHashes);

      // BOTH user bodies must survive the refresh.
      expect(merged).toContain('First notes body that the user wrote.');
      expect(merged).toContain(
        'Second notes body — completely different, must not be lost.',
      );

      // There must still be two "## Notes" headings, not one collapsed section.
      const notesHeadings = merged.match(/^## Notes$/gm) ?? [];
      expect(notesHeadings).toHaveLength(2);

      // The unrelated "Other" section is intact.
      expect(merged).toContain('## Other');
    });

    it('T3 (#153): user-added duplicate section with no template match is preserved verbatim', () => {
      // The template knows a single "Log"; the user has appended a SECOND "Log"
      // section whose body the template can never supply. On refresh, the
      // surplus occurrence must be preserved verbatim even with no prior hashes.
      const userFile = `# Project

## Log

Entry one.

## Log

Entry two — user-added duplicate, must survive.
`;
      const newTemplate = `# Project

## Log

Fresh template log.
`;

      const { merged } = mergeFile(userFile, newTemplate, {});

      // The surplus (unmatched) duplicate occurrence must never be dropped.
      expect(merged).toContain('Entry two — user-added duplicate, must survive.');
      const logHeadings = merged.match(/^## Log$/gm) ?? [];
      expect(logHeadings).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // T3 regression — #1697 (P1 data loss): "Refresh Harness Files" is documented
  // as "Re-merge harness templates, preserving your edits", but it destroyed a
  // project-authored paragraph of `.minspec/constitution.md` on three branches of
  // AIClarityAU/voip-sms-inbox. The paragraph was a ratified standing exception
  // authorising shipped code that takes live production traffic.
  //
  // Root cause: mergeFile reads an ABSENT baseline hash as PROOF the section is
  // unmodified (`mergeFile`'s user-modified branch — `oldHash && existingHash !== oldHash`
  // keeps the user's body, and everything else falls through to the template
  // body). Absence of evidence is treated as evidence of absence, and it fails
  // OPEN in the direction that destroys data.
  //
  // The baseline lives in `.minspec/generated-hashes.json`, which is gitignored
  // as machine-local state — so it is missing in every fresh clone, every new
  // worktree, and every checkout that did not itself scaffold. A merge DECISION
  // input that cannot travel with the repo is absent on most machines that run
  // the merge; that is why the loss recurred three times.
  //
  // It was invisible because with no baseline EVERY section falls through, so the
  // whole file reflows to template wording while one section quietly loses its
  // prose. The diff reads as a reformat. The concealment is produced by the bug.
  //
  // Fix (option A): fail CLOSED. No recorded hash means no evidence, so preserve
  // the existing body and REPORT the drift. No new persisted state — a committed
  // or derived baseline is a separate, still-open decision.
  // ─────────────────────────────────────────────────────────────────────────
  describe('mergeFile() — T3 #1697: a missing baseline fails CLOSED', () => {
    /**
     * The reporting surface this regression pins. `mergeFile` already returns a
     * `MergeResult`, so the drift report rides on it as a field:
     *
     *   preservedWithoutBaseline: readonly string[]
     *
     * Headings whose existing body was held ONLY because no baseline hash was
     * recorded for them AND the template's body for that heading differs from
     * what is on disk — i.e. the fail-closed path fired and a template update was
     * withheld. Template-pass order, no duplicates.
     *
     * The "differs" qualifier is load-bearing: without it, a baseline-less
     * refresh reports every section in the file, which is noise a human learns to
     * skip. With it, the list is exactly the set that still needs a human eye.
     *
     * Typed as the REAL `MergeResult`, in which the field is REQUIRED. It was
     * briefly widened to an optional local alias so this file would compile
     * against the pre-fix shape too — scaffolding for a migration that is over,
     * and now actively harmful: `?` makes `result.preservedWithoutBaseline`
     * legally `undefined`, so a regression that dropped the field entirely would
     * type-check here instead of failing at the compiler.
     */
    const merge = (
      existing: string,
      generated: string,
      oldHashes: SectionHashes = {},
    ): MergeResult => mergeFile(existing, generated, oldHashes);

    const bodyOf = (doc: string, heading: string): string =>
      parseSections(doc).find((s) => s.heading === heading)!.body;

    const hashOf = (doc: string, heading: string): string =>
      hashSection(bodyOf(doc, heading));

    // The shape of the real loss: a constitution whose `## Standing exceptions`
    // is PROSE on both sides. Neither body has an authored list item, so the
    // INV-2 list-item guard in `mergeFile` provably cannot fire, so the section is
    // decided by one of the branches below it. Named, not cited by line: the two
    // anchors that stood here (`:209`, `:226-230`) had rotted onto `parseSections`
    // and pointed at neither — a false signpost is the defect this round removes.
    const CONSTITUTION = [
      '# voip-sms-inbox — Constitution',
      '',
      'Ratified 2026-03-11.',
      '',
      '## Standing exceptions',
      '',
      'The webhook fan-out shipped in v1.4 predates the queue-boundary rule and is',
      'authorised to write directly to the provider. This exception is ratified and',
      'must not be removed without a superseding decision.',
      '',
    ].join('\n');

    // What the bundled template renders for the same heading: generic prose, one
    // unwrapped line per entry (template-registry.ts:726) — hence the reflow.
    const TEMPLATE = [
      '# voip-sms-inbox — Constitution',
      '',
      'Ratified 2026-03-11.',
      '',
      '## Standing exceptions',
      '',
      'Record any standing exception to the invariants above, with the decision that ratified it.',
      '',
    ].join('\n');

    it('AC-1 (core defect): with an EMPTY baseline and prose on both sides, the existing body survives', () => {
      // Both bodies are prose-only, so the INV-2 list-item guard is inert here.
      expect(hasAuthoredListItems(bodyOf(CONSTITUTION, 'Standing exceptions'))).toBe(false);
      expect(hasAuthoredListItems(bodyOf(TEMPLATE, 'Standing exceptions'))).toBe(false);

      const { merged } = merge(CONSTITUTION, TEMPLATE);

      expect(merged).toContain(
        'The webhook fan-out shipped in v1.4 predates the queue-boundary rule and is',
      );
      expect(merged).toContain('must not be removed without a superseding decision.');
      expect(merged).not.toContain('Record any standing exception to the invariants above');
      // The recorded hash must describe what was actually kept, not the template.
      expect(hashOf(merged, 'Standing exceptions')).toBe(
        hashOf(CONSTITUTION, 'Standing exceptions'),
      );
    });

    it('AC-2 (the reflow): with NO section carrying a baseline, the merge is a byte-for-byte no-op', () => {
      // Several sections at once — the whole-file reflow that made the loss read
      // as a reformat in review. A refresh with no baseline has no evidence about
      // ANY section, so it must change nothing at all.
      const existing = [
        '# voip-sms-inbox — Constitution',
        '',
        'Ratified 2026-03-11.',
        '',
        '## Invariants',
        '',
        'Delivery is exactly-once at the queue boundary, measured at the provider ack.',
        '',
        '## Standing exceptions',
        '',
        'The webhook fan-out shipped in v1.4 predates the queue-boundary rule and is',
        'authorised to write directly to the provider.',
        '',
        '## Principles',
        '',
        'Prefer boring infrastructure over a clever one we cannot debug at 3am.',
        '',
      ].join('\n');

      const reflowedTemplate = [
        '# voip-sms-inbox — Constitution',
        '',
        'Ratified 2026-03-11.',
        '',
        '## Invariants',
        '',
        'Rules that must never be violated. All changes must preserve them.',
        '',
        '## Standing exceptions',
        '',
        'Record any standing exception to the invariants above, with the decision that ratified it.',
        '',
        '## Principles',
        '',
        'Values that guide design decisions when the invariants leave room to choose.',
        '',
      ].join('\n');

      const { merged } = merge(existing, reflowedTemplate);

      // Byte-identical, not merely equivalent. `existing` is already in the
      // merge's own normalized form (verified by the round-trip test above), so
      // any difference here is lost content, never whitespace.
      expect(merged).toBe(existing);
    });

    it('AC-3 (the INV-2 guard is blind here): list items on BOTH sides, empty baseline → existing still survives', () => {
      // The INV-2 guard in `mergeFile` fires only when the user's section
      // has authored list items AND the template's has none. Once a project has
      // any seeded invariants, the regenerated template section ALSO has list
      // items, the guard goes inert, and the fall-through wins. Pin that directly.
      const existing = [
        '# Project — Constitution',
        '',
        '## Invariants',
        '',
        '1. Delivery is exactly-once at the queue boundary.',
        '2. The provider ack is the only source of truth for delivery.',
        '',
      ].join('\n');

      const generated = [
        '# Project — Constitution',
        '',
        '## Invariants',
        '',
        '1. Core functionality works offline.',
        '2. No silent gate.',
        '',
      ].join('\n');

      // Both sides carry list items, so the guard cannot fire.
      expect(hasAuthoredListItems(bodyOf(existing, 'Invariants'))).toBe(true);
      expect(hasAuthoredListItems(bodyOf(generated, 'Invariants'))).toBe(true);

      const { merged } = merge(existing, generated);

      expect(merged).toContain('Delivery is exactly-once at the queue boundary.');
      expect(merged).toContain('The provider ack is the only source of truth for delivery.');
      expect(merged).not.toContain('Core functionality works offline.');
      expect(merged).not.toContain('No silent gate.');
    });

    it('AC-4 (no regression): a RECORDED hash that matches the existing body still takes the template update', () => {
      // This is the behaviour the fix must not break — with real evidence that
      // the section is untouched, the refresh is still allowed to update it.
      const existing = '# X\n\n## Overview\n\nold overview prose from the template.\n';
      const generated = '# X\n\n## Overview\n\nNEW overview prose from the template.\n';

      const { merged } = merge(existing, generated, {
        Overview: hashOf(existing, 'Overview'),
      });

      expect(merged).toContain('NEW overview prose from the template.');
      expect(merged).not.toContain('old overview prose from the template.');
    });

    it('AC-5 (no regression): a RECORDED hash that differs still keeps the user body', () => {
      const pristine = '# X\n\n## Overview\n\ntemplate overview v1.\n';
      const userEdited = '# X\n\n## Overview\n\nmy own overview, hand-written.\n';
      const generated = '# X\n\n## Overview\n\ntemplate overview v2.\n';

      const { merged } = merge(userEdited, generated, {
        Overview: hashOf(pristine, 'Overview'),
      });

      expect(merged).toContain('my own overview, hand-written.');
      expect(merged).not.toContain('template overview v2.');
    });

    it('AC-6 (reporting): every baseline-less hold is named, and nothing decided on evidence is', () => {
      // One document exercising all four dispositions at once.
      //   Invariants        — baseline recorded, matches disk  → template taken
      //   Standing exceptions — NO baseline, bodies differ     → HELD + reported
      //   Principles        — baseline recorded, differs       → held on EVIDENCE
      //   Escalation path   — NO baseline, bodies differ       → HELD + reported
      //   Glossary          — NO baseline, bodies identical    → nothing withheld
      const pristinePrinciples = '## Principles\n\ntemplate principles v1.\n';

      const existing = [
        '# Project — Constitution',
        '',
        '## Invariants',
        '',
        'template invariants v1.',
        '',
        '## Standing exceptions',
        '',
        'The v1.4 webhook fan-out is authorised to bypass the queue boundary.',
        '',
        '## Principles',
        '',
        'my own principles, hand-written.',
        '',
        '## Escalation path',
        '',
        'Page the on-call SMS owner, then the platform lead.',
        '',
        '## Glossary',
        '',
        'Shared vocabulary for this document.',
        '',
      ].join('\n');

      const generated = [
        '# Project — Constitution',
        '',
        '## Invariants',
        '',
        'template invariants v2.',
        '',
        '## Standing exceptions',
        '',
        'Record any standing exception here.',
        '',
        '## Principles',
        '',
        'template principles v2.',
        '',
        '## Escalation path',
        '',
        'Describe who is paged, and in what order.',
        '',
        '## Glossary',
        '',
        'Shared vocabulary for this document.',
        '',
      ].join('\n');

      const result = merge(existing, generated, {
        Invariants: hashOf(existing, 'Invariants'),
        Principles: hashSection(bodyOf(pristinePrinciples, 'Principles')),
      });

      // The report names exactly the sections whose template update was withheld
      // for lack of evidence, in template-pass order.
      expect(result.preservedWithoutBaseline).toEqual([
        'Standing exceptions',
        'Escalation path',
      ]);

      // …and the merge itself agrees with the report.
      expect(result.merged).toContain(
        'The v1.4 webhook fan-out is authorised to bypass the queue boundary.',
      );
      expect(result.merged).toContain('Page the on-call SMS owner, then the platform lead.');
      expect(result.merged).toContain('template invariants v2.');
      expect(result.merged).toContain('my own principles, hand-written.');
    });

    it('AC-6b (reporting): a baseline-less refresh that withheld nothing reports an empty list', () => {
      // Same bytes on both sides with no baseline at all: the fail-closed path
      // never withholds an update, so there is nothing for a human to check. An
      // empty array, not `undefined` — a caller must be able to render the report
      // without a presence test.
      const doc = '# X\n\n## Overview\n\nidentical prose.\n';
      const result = merge(doc, doc);

      expect(result.preservedWithoutBaseline).toEqual([]);
      expect(result.merged).toBe(doc);
    });

    // ── F1: the hold must not launder itself into a baseline ──────────────────
    //
    // Failing closed decides ONE refresh correctly. What it records decides every
    // refresh after that. `refreshHarnessFiles` re-records the manifest from the
    // FINAL ON-DISK BYTES (`recordVerifyAndSaveManifest`) — and the fail-closed branch has just
    // written the USER's body to disk. So the recording turns "MinSpec has no
    // evidence about this section" into "MinSpec wrote this section", and the next
    // refresh reads that as proof the body is a pristine template and overwrites it.
    // The paragraph dies one command later, with no second warning.
    //
    // These pin the recorded value, not just the merged body: a merge that keeps
    // the right bytes but records the wrong hash is the bug, not the fix.

    it('AC-7 (F1): feeding a merge back the manifest it just filed must not destroy the body it preserved', () => {
      // The exact laundering, at the unit level. Merge once with no baseline
      // (fresh clone), then merge the same inputs again using what the first
      // merge recorded — which is what the refresh command actually does.
      const first = merge(CONSTITUTION, TEMPLATE, {});
      expect(first.merged).toContain('The webhook fan-out shipped in v1.4');
      expect(first.preservedWithoutBaseline).toEqual(['Standing exceptions']);

      const second = merge(first.merged, TEMPLATE, persistedHashes(first));

      expect(second.merged).toContain(
        'The webhook fan-out shipped in v1.4 predates the queue-boundary rule and is',
      );
      expect(second.merged).toContain('must not be removed without a superseding decision.');
      expect(second.merged).not.toContain('Record any standing exception to the invariants above');

      // Second time round the merge is no longer guessing: the recorded hash is
      // the template body it declined to write, so the divergence is EVIDENCE and
      // the section is kept on evidence, not on absence. Nothing left to report.
      expect(second.preservedWithoutBaseline).toEqual([]);
    });

    it('AC-8 (F1): a third merge keeps it too — the hold is stable, not deferred by one command', () => {
      const first = merge(CONSTITUTION, TEMPLATE, {});
      const second = merge(first.merged, TEMPLATE, persistedHashes(first));
      const third = merge(second.merged, TEMPLATE, persistedHashes(second));

      expect(third.merged).toContain('The webhook fan-out shipped in v1.4');
      expect(third.preservedWithoutBaseline).toEqual([]);
      // …and it has reached a fixed point: no reflow creeping in per refresh.
      expect(third.merged).toBe(second.merged);
    });

    it('AC-9 (F1): the hash recorded for a withheld section is the TEMPLATE body\u2019s, never the body it kept', () => {
      // The poisoned value itself. Recording the preserved body claims MinSpec
      // authored the user\u2019s prose; recording the template body it declined to
      // write is a true statement about what MinSpec generated, and it makes the
      // next refresh see a real divergence.
      const result = merge(CONSTITUTION, TEMPLATE, {});
      const recorded = persistedHashes(result);

      expect(recorded['Standing exceptions']).toBe(hashOf(TEMPLATE, 'Standing exceptions'));
      expect(recorded['Standing exceptions']).not.toBe(hashOf(CONSTITUTION, 'Standing exceptions'));
    });

    it('AC-9b (F1): the same laundering through the USER-MODIFIED branch, where a baseline exists', () => {
      // Not limited to the missing-baseline case. A section preserved because the
      // baseline PROVED modification is recorded the same way, so on the next
      // refresh oldHash === existingHash and the template wins. One preserved
      // edit survives exactly one refresh.
      const pristine = '# X\n\n## Overview\n\ntemplate overview v1.\n';
      const userEdited = '# X\n\n## Overview\n\nmy own overview, hand-written.\n';
      const generated = '# X\n\n## Overview\n\ntemplate overview v2.\n';

      const first = merge(userEdited, generated, {
        Overview: hashOf(pristine, 'Overview'),
      });
      expect(first.merged).toContain('my own overview, hand-written.');
      expect(persistedHashes(first)['Overview']).not.toBe(hashOf(userEdited, 'Overview'));

      const second = merge(first.merged, generated, persistedHashes(first));
      expect(second.merged).toContain('my own overview, hand-written.');
      expect(second.merged).not.toContain('template overview v2.');

      const third = merge(second.merged, generated, persistedHashes(second));
      expect(third.merged).toContain('my own overview, hand-written.');
    });

    it('AC-10 (no regression): a recorded hash matching the existing body still takes the template, and records it', () => {
      // The other half of the contract. Proven-unmodified content must keep
      // updating, and the recorded hash must describe the template body that was
      // just written — otherwise the fix buys data safety by freezing the harness.
      const existing = '# X\n\n## Overview\n\nold overview prose from the template.\n';
      const generated = '# X\n\n## Overview\n\nNEW overview prose from the template.\n';

      const result = merge(existing, generated, {
        Overview: hashOf(existing, 'Overview'),
      });

      expect(result.merged).toContain('NEW overview prose from the template.');
      expect(result.merged).not.toContain('old overview prose from the template.');
      expect(persistedHashes(result)['Overview']).toBe(hashOf(generated, 'Overview'));
      expect(result.preservedWithoutBaseline).toEqual([]);

      // …and it stays current on the next refresh rather than freezing.
      const second = merge(result.merged, generated, persistedHashes(result));
      expect(second.merged).toContain('NEW overview prose from the template.');
    });

    // ── F6: a held section must be held BYTE-for-byte ────────────────────────
    //
    // `sectionsToMarkdown` collapsed `\n{3,}` → `\n\n` across the whole document,
    // so a "preserved" section came back reflowed. That is the same reflow class
    // that concealed the original loss: the constitution was rewritten to template
    // wording, and the one section that lost a ratified paragraph read as part of a
    // reformat. AC-2's byte-identity assertion held only because its fixture was
    // already in the merge's normalized form.

    it('AC-14 (F6): a preserved body keeps its interior blank-line run, byte for byte', () => {
      // Two hand-written paragraphs separated by a DELIBERATE double blank line —
      // the shape that survives `parseSections` but not the old global collapse.
      const existing = [
        '# voip-sms-inbox — Constitution',
        '',
        '## Standing exceptions',
        '',
        'The webhook fan-out shipped in v1.4 predates the queue-boundary rule.',
        '',
        '',
        'Ratified 2026-03-11; must not be removed without a superseding decision.',
        '',
      ].join('\n');

      const generated = [
        '# voip-sms-inbox — Constitution',
        '',
        '## Standing exceptions',
        '',
        'Record any standing exception to the invariants above.',
        '',
      ].join('\n');

      // No baseline → fail closed → the body is HELD.
      const first = merge(existing, generated, {});
      expect(first.merged).toBe(existing);
      expect(first.merged).toContain('queue-boundary rule.\n\n\nRatified 2026-03-11');

      // …and held on EVIDENCE the second time round, still unreflowed.
      const second = merge(first.merged, generated, persistedHashes(first));
      expect(second.merged).toBe(existing);

      // The same must hold for the user-modified branch, which is the far commoner
      // hold — a recorded baseline that proves the section diverged.
      const held = merge(existing, generated, { 'Standing exceptions': 'a-stale-baseline' });
      expect(held.merged).toBe(existing);
    });

    it('AC-14b (F6): the collapse still applies to a body taken from the TEMPLATE', () => {
      // The exception is scoped to bodies MinSpec KEPT. Normalizing the seams of
      // its own output is what stops a generated file growing a blank line per
      // refresh, so a template-taken body must still be collapsed — otherwise the
      // fix buys byte-exactness with an idempotence regression (SPEC-043 INV-2).
      const existing = '# P\n\n## S\n\nalpha\n\nbeta\n';
      const generated = '# P\n\n## S\n\nalpha\n\n\nbeta\n';

      const { merged } = merge(existing, generated, {
        S: hashOf(existing, 'S'),
      });

      expect(merged).toContain('alpha\n\nbeta');
      expect(merged).not.toContain('alpha\n\n\nbeta');
      // …and it is a fixed point: a second identical refresh changes nothing.
      expect(merge(merged, generated, { S: hashOf(merged, 'S') }).merged).toBe(merged);
    });

    it('AC-14d (F6): the ONE byte a preserved section can still lose — the seam, and only the seam', () => {
      // The documented limit, pinned so it stays a limit rather than becoming a
      // surprise. The protected span runs from a verbatim body's first
      // non-whitespace character to its last; whitespace outside that span sits
      // between two headings, is stripped by `hashSection` before any comparison,
      // and MUST stay collapsible — otherwise a generated file grows a blank line
      // per refresh and never reaches a fixed point (SPEC-043 INV-2).
      const existing = [
        '# P',
        '',
        '## Kept',
        '',
        'first paragraph.',
        '',
        '',
        'second paragraph.',
        '',
        '',
        '',
        '## Next',
        '',
        'template body.',
        '',
      ].join('\n');
      const generated = '# P\n\n## Kept\n\nreplacement prose.\n\n## Next\n\ntemplate body.\n';

      const { merged } = merge(existing, generated, {});

      // Interior: byte-exact, run and all.
      expect(merged).toContain('first paragraph.\n\n\nsecond paragraph.');
      // Seam: the dangling run before the NEXT heading normalizes to one blank
      // line, exactly as it always has.
      expect(merged).toContain('second paragraph.\n\n## Next');
      // …and that normalization is stable, not a slow drift.
      expect(merge(merged, generated, {}).merged).toBe(merged);
    });

    it('AC-14c (F6): a user-added section the template never mentions is preserved verbatim', () => {
      const existing = [
        '# P',
        '',
        '## Overview',
        '',
        'template overview.',
        '',
        '## Escalation path',
        '',
        'Page the on-call SMS owner.',
        '',
        '',
        'Then the platform lead.',
        '',
      ].join('\n');
      const generated = '# P\n\n## Overview\n\ntemplate overview.\n';

      const { merged } = merge(existing, generated, { Overview: hashOf(existing, 'Overview') });
      expect(merged).toContain('on-call SMS owner.\n\n\nThen the platform lead.');
    });

    // ── F3: the report must not cry wolf over MinSpec's OWN output ───────────
    //
    // Several MinSpec writers run AFTER the merge (`seedConstitution`, the
    // AGENTS.md slash-command region) and the constitution then feeds back into
    // the CLAUDE.md / AGENTS.md / .cursorrules renders with different list markers
    // and numbering. So `renderTemplate` output is permanently BYTE-different from
    // disk for those sections even on a project nobody has touched, and a byte
    // test reported it.

    it('AC-15 (F3): a re-rendering of the same content is not reported as a withheld update', () => {
      // The exact two renderings MinSpec produces of one seeded DRAFT entry: the
      // seeder writes a `-` item with an INDENTED provenance line; the render
      // emits it as one numbered line, and renumbers as entries accumulate.
      const seeded = [
        '# P — Constitution',
        '',
        '## Principles',
        '',
        'Guidelines that should be followed.',
        '',
        '- DRAFT: Honor CLAUDE.md project instructions.',
        '  > _proposed because a CLAUDE.md instructions file is present_',
        '',
      ].join('\n');

      const rendered = [
        '# P — Constitution',
        '',
        '## Principles',
        '',
        'Guidelines that should be followed.',
        '',
        '1. DRAFT: Honor CLAUDE.md project instructions. > _proposed because a CLAUDE.md instructions file is present_',
        '2. DRAFT: Honor CLAUDE.md project instructions. > _proposed because a CLAUDE.md instructions file is present_',
        '',
      ].join('\n');

      // Byte-different — which is precisely why the byte test misfired…
      expect(bodyOf(seeded, 'Principles')).not.toBe(bodyOf(rendered, 'Principles'));
      // …while the content is the same, so nothing was withheld from anyone.
      expect(contentItems(bodyOf(seeded, 'Principles'))).toEqual(
        contentItems(bodyOf(rendered, 'Principles')),
      );

      const result = merge(seeded, rendered, {});
      expect(result.preservedWithoutBaseline).toEqual([]);
      // The body is still HELD — only the notice is suppressed, never the hold.
      expect(result.merged).toContain('- DRAFT: Honor CLAUDE.md project instructions.');
    });

    it('AC-15b (F3): an HTML-comment marker MinSpec injected after the merge is not content', () => {
      // The AGENTS.md slash-command region is bounded by `<!-- minspec:… -->`
      // markers written AFTER the merge, so disk carries a line the template body
      // never will. Comments are already "not authored content" everywhere else in
      // this module; the report must agree.
      const onDisk = [
        '# P',
        '',
        '## Rules',
        '',
        '1. Never skip the spec phase, even for T1.',
        '',
        '<!-- minspec:slash-commands:start -->',
        '',
      ].join('\n');
      const template = '# P\n\n## Rules\n\n1. Never skip the spec phase, even for T1.\n';

      expect(merge(onDisk, template, {}).preservedWithoutBaseline).toEqual([]);
    });

    it('AC-15c (F3): a real human paragraph is STILL reported — the filter is not a mute button', () => {
      // The regression guard on the two tests above. Content the template does not
      // carry must survive every normalization and reach the report.
      const result = merge(CONSTITUTION, TEMPLATE, {});
      expect(result.preservedWithoutBaseline).toEqual(['Standing exceptions']);
    });

    // ── F7: a baseline-less hold by the INV-2 guard is reported too ──────────
    //
    // The guard runs BEFORE the fail-closed branch, so its holds never reached the
    // report. The stated reason — "the template's body is an unfilled scaffold, so
    // nothing of value was withheld" — is not what the guard tests: its condition
    // is only "the generated body has no authored list items", which improved prose
    // satisfies just as well.

    it('AC-16 (F7): the guard holds a list against PROSE the template actually added — and says so', () => {
      const existing = [
        '# P — Constitution',
        '',
        '## Goals',
        '',
        '- Ship the queue-boundary rewrite by Q3.',
        '',
      ].join('\n');
      // No list items, so the guard fires — but this is a genuine template
      // rewrite, not an unfilled scaffold. Under the old exemption it vanished.
      const generated = [
        '# P — Constitution',
        '',
        '## Goals',
        '',
        'Name the outcomes this project ladders up to, and the measure for each.',
        '',
      ].join('\n');

      expect(hasAuthoredListItems(bodyOf(existing, 'Goals'))).toBe(true);
      expect(hasAuthoredListItems(bodyOf(generated, 'Goals'))).toBe(false);

      const result = merge(existing, generated, {});
      expect(result.merged).toContain('- Ship the queue-boundary rewrite by Q3.');
      expect(result.preservedWithoutBaseline).toEqual(['Goals']);
    });

    it('AC-16b (F7): a guard hold whose justification IS true stays silent', () => {
      // The seeded-constitution shape: the template's prose is already on disk and
      // the only difference is MinSpec's own DRAFT list. Nothing of value was
      // withheld, so the notice must not fire — that claim is now MEASURED on the
      // two bodies rather than asserted about the branch.
      const existing = [
        '# P — Constitution',
        '',
        '## Goals',
        '',
        'What this project is trying to achieve.',
        '',
        '- DRAFT: Trace specs to their owning epic.',
        '  > _proposed because docs/epics/ epics are tracked_',
        '',
      ].join('\n');
      const generated = [
        '# P — Constitution',
        '',
        '## Goals',
        '',
        'What this project is trying to achieve.',
        '',
        '<!-- - Example goal -->',
        '',
      ].join('\n');

      const result = merge(existing, generated, {});
      expect(result.merged).toContain('- DRAFT: Trace specs to their owning epic.');
      expect(result.preservedWithoutBaseline).toEqual([]);
    });

    it('AC-16c (F7): a guard hold with a RECORDED baseline is not reported as baseline-less', () => {
      // The notice says "no recorded baseline". Where one exists, the hold is a
      // #706 decision, not an evidence gap, and saying otherwise would be false.
      const existing = '# P\n\n## Goals\n\n- Ship the rewrite.\n';
      const generated = '# P\n\n## Goals\n\nName the outcomes this project ladders up to.\n';

      const result = merge(existing, generated, { Goals: hashOf(existing, 'Goals') });
      expect(result.merged).toContain('- Ship the rewrite.');
      expect(result.preservedWithoutBaseline).toEqual([]);
    });
  });

  describe('refreshHarnessFiles() — T3 #1697/F1: the loss survives the whole command path', () => {
    // The unit tests above pin `mergeFile`. They are not sufficient on their own:
    // `refreshHarnessFiles` DISCARDS `mergeFile`'s newHashes and re-records the
    // manifest from the final on-disk bytes (`recordVerifyAndSaveManifest`), and
    // `generateHarnessFiles` SKIPS a file that already exists and then records a
    // manifest for it anyway (`ManifestAuthorship.unauthored`). Both turn the user's
    // own bytes into a MinSpec authorship claim. These drive the real commands.

    const MARKER = 'The webhook fan-out shipped in v1.4 predates the queue-boundary rule';

    // A constitution shaped like the one that lost the paragraph: a populated
    // Invariants list PLUS a ratified prose paragraph the template has no notion of.
    const PROJECT_CONSTITUTION = [
      '# voip-sms-inbox — Constitution',
      '',
      '## Invariants',
      '',
      '1. Delivery is exactly-once at the queue boundary, measured at the provider ack.',
      '2. No inbound webhook is processed without a verified signature.',
      '',
      `${MARKER} and is`,
      'authorised to write directly to the provider. Ratified 2026-03-11; must not be',
      'removed without a superseding decision.',
      '',
      '## Principles',
      '',
      'Guidelines that should be followed. Can be bent in exceptional circumstances with justification.',
      '',
      '## Constraints',
      '',
      'Technical or business constraints that bound the solution space.',
      '',
      '## Goals',
      '',
      'What this project is trying to achieve. The outcomes work should ladder up to.',
      '',
    ].join('\n');

    let tmp: string;
    const constitutionPath = () => path.join(tmp, '.minspec', 'constitution.md');
    const readConstitution = () => fs.readFileSync(constitutionPath(), 'utf-8');
    const heldNotices = (notices: readonly { kind?: string }[]) =>
      notices.filter((n) => n.kind === 'preserved-without-baseline');

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-e2e-'));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('AC-11 (F1): Initialize over an existing constitution, then ONE Refresh — the paragraph survives', () => {
      // The shortest path to total loss, and the one the fail-closed branch never
      // even reaches: `generateHarnessFiles` skips the existing file, then records
      // a manifest from the user's own bytes, so the very first Refresh sees a
      // matching baseline and calls the ratified paragraph an untouched template.
      fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, '.minspec', 'config.json'),
        JSON.stringify({ projectName: 'voip-sms-inbox' }, null, 2),
      );
      fs.writeFileSync(constitutionPath(), PROJECT_CONSTITUTION);

      generateHarnessFiles(tmp); // "MinSpec: Initialize" — re-runnable by design
      expect(readConstitution()).toContain(MARKER);

      refreshHarnessFiles(tmp); // "MinSpec: Refresh Harness Files" — once
      expect(readConstitution()).toContain(MARKER);
      expect(readConstitution()).toContain('removed without a superseding decision.');
    });

    it('AC-12 (F1): three consecutive Refreshes with no baseline — survives all three, reported once', () => {
      // The fresh-clone path. `generated-hashes.json` is gitignored machine-local
      // state, so it is absent in every clone and every new worktree. The first
      // refresh has no evidence and must hold; the refreshes after it must hold
      // for a BETTER reason — recorded evidence — and must stop nagging about it.
      generateHarnessFiles(tmp);
      fs.writeFileSync(constitutionPath(), PROJECT_CONSTITUTION);
      fs.rmSync(path.join(tmp, '.minspec', 'generated-hashes.json'), { force: true });

      const r1 = refreshHarnessFiles(tmp);
      const after1 = readConstitution();
      expect(after1).toContain(MARKER);
      expect(heldNotices(r1).length).toBeGreaterThan(0);

      const r2 = refreshHarnessFiles(tmp);
      const after2 = readConstitution();
      expect(after2).toContain(MARKER);
      expect(heldNotices(r2)).toEqual([]);

      const r3 = refreshHarnessFiles(tmp);
      const after3 = readConstitution();
      expect(after3).toContain(MARKER);
      expect(heldNotices(r3)).toEqual([]);

      // No slow reflow either: once held on evidence, the file is a fixed point.
      expect(after2).toBe(after1);
      expect(after3).toBe(after2);
    });

    it('AC-13 (F1): re-running Initialize keeps the baseline it already had — a later hand-edit is still detected as one', () => {
      // "MinSpec wrote none of this file" must mean "make no NEW claim about it",
      // never "retract the claim I already made". Initialize is re-runnable, so
      // dropping the prior entry would demote a project that HAS a valid baseline
      // onto the fail-closed path and freeze its harness on the next refresh.
      //
      // The carried-forward baseline is also what makes the hand-edit legible: it
      // records what MinSpec last WROTE, so an edit made after that is a genuine
      // divergence rather than something re-guessed from absence.
      generateHarnessFiles(tmp);
      const baselineAfterInit = fs.readFileSync(
        path.join(tmp, '.minspec', 'generated-hashes.json'),
        'utf-8',
      );

      // The user hand-writes a ratified paragraph into the constitution.
      const seeded = readConstitution();
      fs.writeFileSync(
        constitutionPath(),
        seeded.replace(
          '## Principles',
          `${MARKER} and is\nauthorised to write directly to the provider.\n\n## Principles`,
        ),
      );

      // …then re-runs Initialize, whose template loop writes nothing (every file
      // exists; the post-loop writers leave this section alone).
      generateHarnessFiles(tmp);
      expect(
        fs.readFileSync(path.join(tmp, '.minspec', 'generated-hashes.json'), 'utf-8'),
      ).toBe(baselineAfterInit);
      expect(readConstitution()).toContain(MARKER);

      // …and Refresh reads that preserved baseline as proof the section diverged.
      refreshHarnessFiles(tmp);
      expect(readConstitution()).toContain(MARKER);
      refreshHarnessFiles(tmp);
      expect(readConstitution()).toContain(MARKER);
    });

    /** The four Markdown harness files the section merge owns. */
    const HARNESS_FILES = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', '.minspec/constitution.md'];
    const snapshot = () =>
      Object.fromEntries(
        HARNESS_FILES.map((f) => [
          f,
          fs.existsSync(path.join(tmp, f)) ? fs.readFileSync(path.join(tmp, f), 'utf-8') : '',
        ]),
      );

    it('AC-17 (F3): a project nobody has edited is reported on ZERO times when its baseline goes missing', () => {
      // The cry-wolf case, end to end and on the real bundled templates. Scaffold,
      // let the pipeline settle, then delete the machine-local manifest — exactly
      // what a fresh clone or a new linked worktree looks like. Every file MinSpec
      // wrote is still MinSpec's own; nothing was withheld from anybody.
      //
      // A BYTE comparison reported three files here against zero changed files,
      // because MinSpec's own post-merge writers (`seedConstitution`, the AGENTS.md
      // slash-command region) leave `renderTemplate` output permanently
      // byte-different from disk. Three warning toasts on a clean project is how a
      // report that must not be missed gets trained into background noise.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      refreshHarnessFiles(tmp);

      const before = snapshot();
      fs.rmSync(path.join(tmp, '.minspec', 'generated-hashes.json'), { force: true });

      const notices = refreshHarnessFiles(tmp);

      expect(heldNotices(notices)).toEqual([]);
      // …and the silence is honest: the refresh really did change nothing, so
      // there was nothing to report. A quiet report over a changed file would be
      // the opposite defect.
      expect(snapshot()).toEqual(before);
    });

    it('AC-18 (F3): holds across several files arrive as ONE notice naming every file', () => {
      // The surfacing layer awaits each notice before showing the next, so a
      // per-file notice turned a multi-file refresh into a queue of toasts to click
      // through — and a queue is dismissed unread, which defeats the report.
      generateHarnessFiles(tmp);
      fs.writeFileSync(constitutionPath(), PROJECT_CONSTITUTION);
      fs.rmSync(path.join(tmp, '.minspec', 'generated-hashes.json'), { force: true });

      const held = heldNotices(refreshHarnessFiles(tmp)) as ManagedRegionWarning[];

      expect(held).toHaveLength(1);
      expect(held[0].outputPaths!.length).toBeGreaterThan(1);
      // Every file it covers is named in the text, not just counted — a count
      // sends the reader off to diff the tree to find out which.
      for (const p of held[0].outputPaths!) expect(held[0].message).toContain(p);
      // …and `outputPath` still points at something real for a consumer that only
      // reads the single-path field.
      expect(held[0].outputPaths).toContain(held[0].outputPath);
    });

    // ── F8: the notice raised by the REAL command, not by `mergeFile` ─────────
    //
    // AC-18 above proves the notice names every FILE. It says nothing about the
    // sections inside them, and a notice that names only files is the "count, not
    // names" failure one level up: on a four-file refresh it sends the reader to
    // diff four files to find the one paragraph that was held.
    //
    // These drive `refreshHarnessFiles` over a SETTLED project — scaffolded,
    // refreshed until it stops moving — and then remove one file's baseline. That
    // is the shape of a partially-recovered manifest, and it isolates the report
    // to exactly the one section a human touched, which is what makes an assertion
    // on the section NAME meaningful rather than a substring lottery.

    /** A project scaffolded and refreshed until the harness stops changing. */
    const settledProject = (): void => {
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
    };

    const manifestPath = () => path.join(tmp, '.minspec', 'generated-hashes.json');

    /** Forget MinSpec's baseline for ONE file, leaving every other file's intact. */
    const forgetBaselineFor = (outputPath: string): void => {
      const manifest = JSON.parse(fs.readFileSync(manifestPath(), 'utf-8'));
      delete manifest[outputPath];
      fs.writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2));
    };

    /** Insert a hand-written paragraph immediately before `anchor` in a file. */
    const handWriteBefore = (outputPath: string, anchor: string, paragraph: string): void => {
      const full = path.join(tmp, outputPath);
      const before = fs.readFileSync(full, 'utf-8');
      expect(before).toContain(anchor);
      fs.writeFileSync(full, before.replace(anchor, `${paragraph}\n\n${anchor}`));
    };

    it('AC-20g (F8): the notice names the SECTION that was held, not just the file', () => {
      settledProject();
      // A ratified sentence hand-written into CLAUDE.md's `## Invariants` — the
      // shape of the paragraph #1697 deleted, in the file a human is likeliest to
      // have edited.
      handWriteBefore(
        'CLAUDE.md',
        '## SDD Methodology',
        'Ratified 2026-03-11: the on-call SMS owner is paged before the platform lead.',
      );
      forgetBaselineFor('CLAUDE.md');

      const held = heldNotices(refreshHarnessFiles(tmp)) as ManagedRegionWarning[];

      expect(held).toHaveLength(1);
      expect(held[0].kind).toBe('preserved-without-baseline');
      expect(held[0].outputPath).toBe('CLAUDE.md');
      // The section, by name — the assertion AC-18 cannot make.
      expect(held[0].message).toContain('"Invariants"');
      // …and only that section: every OTHER section of the same file is equally
      // baseline-less, so a report keyed on absence rather than on content would
      // name all twelve and be skipped by the reader.
      expect(held[0].message).toContain('1 existing section');
      // …and the paragraph really is still there, so the notice is true.
      expect(fs.readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf-8')).toContain(
        'the on-call SMS owner is paged before the platform lead',
      );
    });

    it('AC-20h (F8): a hold above the first heading is described, never printed as `__preamble__`', () => {
      // The parser sentinel reaching a toast is only visible end to end: the
      // merge produces it, the message builder is the only thing that rewrites
      // it, and nothing in between would notice it passing through.
      settledProject();
      handWriteBefore(
        'CLAUDE.md',
        '## Overview',
        'Ratified 2026-03-11: this harness is governed by DR-012.',
      );
      forgetBaselineFor('CLAUDE.md');

      const held = heldNotices(refreshHarnessFiles(tmp)) as ManagedRegionWarning[];

      expect(held).toHaveLength(1);
      expect(held[0].message).toContain('the text above the first heading');
      expect(held[0].message).not.toContain(PREAMBLE_HEADING);
      expect(fs.readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf-8')).toContain('DR-012');
    });

    it('AC-20i (F8): the content notice is returned FIRST, ahead of the housekeeping ones', () => {
      // Order is the surfacing contract, not cosmetics: `initRefreshCommand`
      // AWAITS each notice before showing the next, so whatever is last is shown
      // to a reader who has already clicked through everything else. Every other
      // notice reports scaffolding or index state; this one reports that the
      // user's own words were about to be replaced and were not.
      const real = path.join(tmp, 'realproj');
      fs.mkdirSync(real, { recursive: true });
      generateHarnessFiles(real);
      refreshHarnessFiles(real);
      refreshHarnessFiles(real);

      // Make the refresh ALSO raise a second, unrelated notice: a pre-#1529
      // project (no recorded projectName) refreshed from an arbitrarily-named
      // directory reports a project-name mismatch.
      const configPath = path.join(real, '.minspec', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      delete config.projectName;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      const claudePath = path.join(real, 'CLAUDE.md');
      fs.writeFileSync(
        claudePath,
        fs
          .readFileSync(claudePath, 'utf-8')
          .replace(
            '## SDD Methodology',
            'Ratified 2026-03-11: the on-call SMS owner is paged first.\n\n## SDD Methodology',
          ),
      );

      // …then look at it from a linked worktree, which is where the machine-local
      // baseline is absent in the first place.
      const worktree = path.join(tmp, 'wt-some-branch');
      fs.cpSync(real, worktree, { recursive: true });
      fs.rmSync(path.join(worktree, '.minspec', 'generated-hashes.json'), { force: true });

      const notices = refreshHarnessFiles(worktree);

      // Both fired — otherwise this asserts an order over a single element and
      // proves nothing.
      expect(notices.map((n) => n.kind)).toContain('project-name-mismatch');
      expect(heldNotices(notices)).toHaveLength(1);
      expect(notices[0].kind).toBe('preserved-without-baseline');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // #1697 F2: the notice must not be routed to a button that no-ops and then
  // claims success.
  //
  // `'preserved-without-baseline'` was added to the notice-kind union but not to
  // `surfaceManagedRegionWarning`'s branches, so it fell through to the default
  // `showWarningMessage` whose FIRST action is "Re-scaffold (overwrite)".
  // `rescaffoldManagedRegionFile` resolves its path through
  // MANAGED_REGION_TEMPLATES, which shares no path with the section-merge
  // outputs — so the click writes nothing and returns `false`, the caller
  // discards that `false`, and announces "MinSpec: re-scaffolded <path>."
  //
  // A guaranteed-false success claim, offered as the obvious remedy for the one
  // notice a human must not dismiss.
  // ─────────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────────
  // #1697 NEW-1: the fail-closed fix must not trade the data loss for a
  // permanent, silent freeze of the harness.
  //
  // The mechanism the round-2 fix introduced: the fail-closed branch decided the
  // HOLD on the recorded baseline and RAW BYTES, then recorded the WITHHELD
  // TEMPLATE's hash. From the next refresh on that recorded hash can never equal
  // the on-disk body, so the section landed in the user-modified branch forever,
  // and that branch recorded the template hash again — a stable fixed point no
  // later template update could escape. The REPORT meanwhile fired only while the
  // baseline was absent, so from refresh #2 the freeze was also silent. Every
  // byte-different-but-content-equal hold was therefore permanent AND never
  // reported at all: one word of MinSpec's OWN managed prose differing from the
  // current template froze that section for good.
  //
  // `generated-hashes.json` is gitignored machine-local state, so that is the
  // DEFAULT state of every fresh clone and every new linked worktree, not an edge
  // case. A harness that silently stops receiving updates is constitution
  // invariant 2 ("no silent gate") failing in the other direction — as forbidden
  // as the overwrite this fix removed.
  //
  // The rule these pin: the HOLD and the REPORT are decided on the SAME basis —
  // CONTENT, one predicate, read once for both answers. A section is HELD when
  // MinSpec declines to write the body it rendered, and the manifest records that
  // withheld body's hash instead of the bytes on disk: that recorded hash can never
  // equal disk, which is precisely what PINS the section into the user-modified
  // branch from then on. So pinning is the hold's whole consequence, and the rule
  // is that a section is pinned exactly when it is reported.
  //
  // The half that froze the harness was pinning sections nobody had edited. A
  // byte-only difference is MinSpec re-rendering its OWN output, so there is
  // nothing to withhold and nothing to report — and the manifest must record the
  // bytes that are actually there, a true claim, which leaves the section tracking
  // the template exactly as it did before its baseline went missing.
  //
  // Keeping those bytes rather than rewriting them is deliberate and is NOT a hold:
  // MinSpec has nothing to add, so it does not touch the file, and a refresh that
  // reports nothing also changes nothing (AC-15, AC-17). One refresh later the
  // recorded baseline is genuine and the template's own rendering lands.
  describe('mergeFile() — T3 #1697/NEW-1: a hold must never freeze the harness', () => {
    const merge = (
      existing: string,
      generated: string,
      oldHashes: SectionHashes = {},
    ): MergeResult => mergeFile(existing, generated, oldHashes);

    const bodyOf = (doc: string, heading: string): string =>
      parseSections(doc).find((s) => s.heading === heading)!.body;

    it('AC-30 (same basis, quiet half): a CONTENT-IDENTICAL section that differs only in bytes is not PINNED', () => {
      // NEW-1b, at the unit level. The two invariants are the same two invariants;
      // only their order and numbering moved. `contentItems` is a set with list
      // markers stripped, so this is MinSpec re-rendering its own output — there is
      // nothing of the user's to protect, so nothing is withheld and nothing is
      // reported (the report has always been content-based, so it was already
      // silent here — that silence is exactly what made the pin invisible).
      const existing = [
        '# P — Constitution',
        '',
        '## Invariants',
        '',
        '1. Delivery is exactly-once at the queue boundary.',
        '2. No inbound webhook is processed without a verified signature.',
        '',
      ].join('\n');
      const generated = [
        '# P — Constitution',
        '',
        '## Invariants',
        '',
        '1. No inbound webhook is processed without a verified signature.',
        '2. Delivery is exactly-once at the queue boundary.',
        '',
      ].join('\n');

      const result = merge(existing, generated, {});

      // MinSpec has nothing to add to these bytes, so it does not rewrite them —
      // a refresh that reports nothing must also change nothing.
      expect(result.merged).toBe(existing);
      expect(result.preservedWithoutBaseline).toEqual([]);
      // Nothing was withheld, so nothing is recorded as withheld…
      expect(result.withheldTemplateHashes).toEqual({});
      // …and the hash recorded is a TRUE statement about the bytes on disk. This is
      // the whole fix: recording the withheld TEMPLATE body here instead (round 2)
      // records a hash that can never equal disk, which pins the section into the
      // user-modified branch on every later run — permanently, and unreported.
      expect(persistedHashes(result)['Invariants']).toBe(hashSection(bodyOf(existing, 'Invariants')));

      // …so the section is still TRACKING. Feeding the merge its own record back —
      // which is what the refresh command does from one run to the next — reaches
      // the same verdict rather than reclassifying the section as user-modified,
      // and the moment the template carries content this body does not, the whole
      // template body lands and brings its newer rendering with it.
      const second = merge(result.merged, generated, persistedHashes(result));
      expect(second.merged).toBe(result.merged);
      expect(second.preservedWithoutBaseline).toEqual([]);

      const later = generated.replace(
        '2. Delivery is exactly-once at the queue boundary.',
        '2. Delivery is exactly-once at the queue boundary.\n3. Raw bodies are retained for 30 days.',
      );
      const third = merge(second.merged, later, persistedHashes(second));
      expect(third.merged).toBe(later);
    });

    it('AC-31 (same basis, loud half): a section whose CONTENT differs is held AND named', () => {
      const existing = '# P\n\n## Invariants\n\nThese rules must not be violated.\n';
      const generated = '# P\n\n## Invariants\n\nThese rules must never be violated.\n';

      const result = merge(existing, generated, {});

      expect(result.merged).toContain('must not be violated.');
      expect(result.preservedWithoutBaseline).toEqual(['Invariants']);
    });

    it('AC-32 (the rule itself): with no baseline anywhere, the set of PINNED sections equals the set of REPORTED ones', () => {
      // The design constraint, asserted directly rather than case by case, and
      // asserted over the CONSEQUENCE rather than over which bytes were emitted.
      //
      // "Held" is not "the existing bytes came through" — a section MinSpec has
      // nothing to add to comes through untouched and goes on tracking the
      // template. "Held" is "MinSpec declined to write what it rendered", and the
      // manifest is where that lands: a recorded hash that does not match the body
      // on disk is what pins a section into the user-modified branch for good. So
      // the rule is that a section is pinned exactly when it is reported — if it
      // is pinned the human can learn it is pinned, and a byte-only difference
      // pins nothing. Five sections, one per disposition, all with no baseline.
      const existing = [
        '# P — Constitution',
        '',
        '## Same content',
        '',
        '- alpha',
        '- beta',
        '',
        '## Different content',
        '',
        'my own hand-written paragraph.',
        '',
        '## Empty body',
        '',
        '## Comments only',
        '',
        '<!-- - Example entry -->',
        '',
        '## User is a superset',
        '',
        'template prose for this section.',
        '',
        'plus a ratified paragraph the template has never heard of.',
        '',
      ].join('\n');
      const generated = [
        '# P — Constitution',
        '',
        '## Same content',
        '',
        '1. beta',
        '2. alpha',
        '',
        '## Different content',
        '',
        'template prose v2.',
        '',
        '## Empty body',
        '',
        'template prose for a section the user left empty.',
        '',
        '## Comments only',
        '',
        'template prose for a section holding only a placeholder.',
        '',
        '## User is a superset',
        '',
        'template prose for this section.',
        '',
      ].join('\n');

      const result = merge(existing, generated, {});

      const headings = parseSections(generated)
        .map((s) => s.heading)
        .filter((h) => h !== PREAMBLE_HEADING);
      // Pinned == the manifest's claim does not describe the body that is there.
      const pinned = headings.filter(
        (h) => persistedHashes(result)[h] !== hashSection(bodyOf(result.merged, h)),
      );

      expect(pinned).toEqual(['Different content', 'User is a superset']);
      expect([...result.preservedWithoutBaseline]).toEqual(pinned);
      // …and the pin is the withheld template body, never the body that was kept.
      expect(Object.keys(result.withheldTemplateHashes)).toEqual(pinned);
      for (const h of pinned) {
        expect(persistedHashes(result)[h]).toBe(hashSection(bodyOf(generated, h)));
      }
      // Every other section carries a hash that matches its own bytes, so every
      // other section is still tracking the template.
      for (const h of headings.filter((h) => !pinned.includes(h))) {
        expect(persistedHashes(result)[h], `${h} must not be pinned`).toBe(
          hashSection(bodyOf(result.merged, h)),
        );
      }
    });

    it('AC-33 (NO FREEZE): a section held only on bytes still receives a LATER template update', () => {
      // The regression itself, end to end at the unit level. Round 2 recorded the
      // withheld TEMPLATE body's hash for every baseline-less hold, including the
      // ones held only on bytes. That hash can never equal disk, so from the next
      // run the section fell into the user-modified branch — which recorded the
      // template hash again. A stable fixed point no later template update could
      // escape, and one the content-based report never fired on.
      const existing = [
        '# P',
        '',
        '## Invariants',
        '',
        '1. Delivery is exactly-once.',
        '2. Every webhook is signed.',
        '',
        '## Standing exceptions',
        '',
        'The v1.4 fan-out is authorised.',
        '',
      ].join('\n');
      const generated = [
        '# P',
        '',
        '## Invariants',
        '',
        '1. Every webhook is signed.',
        '2. Delivery is exactly-once.',
        '',
        '## Standing exceptions',
        '',
        'Record any standing exception here.',
        '',
      ].join('\n');

      const first = merge(existing, generated, {});
      // Only the genuine divergence is reported, and only it is pinned.
      expect(first.preservedWithoutBaseline).toEqual(['Standing exceptions']);
      expect(Object.keys(first.withheldTemplateHashes)).toEqual(['Standing exceptions']);

      // The byte-only section is NOT pinned: its recorded hash describes the body
      // that is there, which is what leaves it proven-unmodified on the next run.
      expect(persistedHashes(first)['Invariants']).toBe(hashSection(bodyOf(first.merged, 'Invariants')));

      const second = merge(first.merged, generated, persistedHashes(first));
      // The user's paragraph is still protected…
      expect(second.merged).toContain('The v1.4 fan-out is authorised.');

      // …and the update that was never arriving arrives. A genuinely NEW invariant,
      // shipped by a later template, lands on the byte-only section — and brings the
      // newer rendering it was carrying with it. Under the pin it reached neither:
      // the section sat in the user-modified branch for good.
      const later = generated.replace(
        '2. Delivery is exactly-once.',
        '2. Delivery is exactly-once.\n3. Raw bodies are retained for 30 days.',
      );
      const third = merge(second.merged, later, persistedHashes(second));
      expect(third.merged).toContain('Raw bodies are retained for 30 days.');
      expect(bodyOf(third.merged, 'Invariants')).toBe(bodyOf(later, 'Invariants'));
      expect(third.merged).toContain('The v1.4 fan-out is authorised.');
    });

    it('AC-34 (the gate that must not open): a paragraph the template has never heard of is CONTENT-different, so it is still held', () => {
      // The guard on the new content gate, and on #1697 itself. Deciding the hold
      // on content rather than on bytes is what stops MinSpec pinning its own
      // re-renderings — it must not also let a ratified paragraph through. The
      // paragraph is an item `contentItems` finds in the existing body and not in
      // the template's, so the content test sees it and the section is held,
      // reported, and pinned on the withheld template body.
      const existing = [
        '# voip-sms-inbox — Constitution',
        '',
        '## Invariants',
        '',
        '1. Delivery is exactly-once at the queue boundary.',
        '',
        'The v1.4 webhook fan-out is authorised to bypass the queue boundary.',
        'Ratified 2026-03-11; must not be removed without a superseding decision.',
        '',
      ].join('\n');
      const generated = [
        '# voip-sms-inbox — Constitution',
        '',
        '## Invariants',
        '',
        '1. Delivery is exactly-once at the queue boundary.',
        '',
      ].join('\n');

      const result = merge(existing, generated, {});

      expect(result.merged).toContain('Ratified 2026-03-11');
      expect(result.preservedWithoutBaseline).toEqual(['Invariants']);
      expect(persistedHashes(result)['Invariants']).toBe(hashSection(bodyOf(generated, 'Invariants')));
      expect(result.withheldTemplateHashes['Invariants']).toBe(
        hashSection(bodyOf(generated, 'Invariants')),
      );
    });

    it('AC-35 (the way out, by convergence): once the template carries the same content, the hold ends', () => {
      // A hold that no user action can ever release is a freeze wearing a notice.
      const existing = '# P\n\n## Invariants\n\nThese rules must not be violated.\n';
      const stale = '# P\n\n## Invariants\n\nThese rules must never be violated.\n';

      expect(merge(existing, stale, {}).preservedWithoutBaseline).toEqual(['Invariants']);

      // The user accepts the template's wording by hand (or a later template
      // converges on theirs). Nothing is held, and the section is MinSpec's again.
      const resolved = merge(stale, stale, {});
      expect(resolved.preservedWithoutBaseline).toEqual([]);
      expect(persistedHashes(resolved)['Invariants']).toBe(hashSection(bodyOf(stale, 'Invariants')));
    });

    it('AC-36 (the way out, by emptying): clearing a held body hands the section back to the template', () => {
      // The documented #706 boundary — a body with no authored content has nothing
      // to lose — must keep applying on every run, not just the first. Under the
      // frozen manifest it did not: the emptied body landed in the user-modified
      // branch and the template never came back.
      const existing = '# P\n\n## Standing exceptions\n\nThe v1.4 fan-out is authorised.\n';
      const generated = '# P\n\n## Standing exceptions\n\nRecord any standing exception here.\n';

      const first = merge(existing, generated, {});
      expect(first.preservedWithoutBaseline).toEqual(['Standing exceptions']);

      // The user empties the section to ask for the template back.
      const emptied = '# P\n\n## Standing exceptions\n\n';
      const second = merge(emptied, generated, persistedHashes(first));

      expect(second.merged).toContain('Record any standing exception here.');
      expect(second.preservedWithoutBaseline).toEqual([]);
    });
  });

  describe('refreshHarnessFiles() — T3 #1697/NEW-1: the freeze over the real command path', () => {
    let tmp: string;
    const heldNotices = (notices: readonly { kind?: string }[]) =>
      notices.filter((n) => n.kind === 'preserved-without-baseline');
    const manifestPath = () => path.join(tmp, '.minspec', 'generated-hashes.json');
    const readManifest = () => JSON.parse(fs.readFileSync(manifestPath(), 'utf-8'));
    const forgetBaseline = () => fs.rmSync(manifestPath(), { force: true });
    const read = (rel: string) => fs.readFileSync(path.join(tmp, rel), 'utf-8');
    const write = (rel: string, body: string) =>
      fs.writeFileSync(path.join(tmp, rel), body);

    /** A constitution whose Invariants section the test drives. */
    const CONSTITUTION = (invariants: string) =>
      [
        '# acme — Constitution',
        '',
        '## Invariants',
        '',
        invariants,
        '',
        '## Principles',
        '',
        'Guidelines that should be followed. Can be bent in exceptional circumstances with justification.',
        '',
        '## Constraints',
        '',
        'Technical or business constraints that bound the solution space.',
        '',
        '## Goals',
        '',
        'What this project is trying to achieve. The outcomes work should ladder up to.',
        '',
      ].join('\n');

    const EXACTLY_ONCE = 'Delivery is exactly-once at the queue boundary.';
    const SIGNED = 'No inbound webhook is processed without a verified signature.';
    const RETENTION = 'Raw SMS bodies are retained for at most 30 days.';

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-new1-'));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('AC-37 (NEW-1a): a hold on stale MinSpec prose says so when it starts, and can be ended', () => {
      // The reproduction, on the real bundled templates. A repo whose CLAUDE.md was
      // rendered by an EARLIER template version — simulated the only way a user can
      // experience it, by changing one word of MinSpec's own managed prose. No user
      // content anywhere. Then a fresh clone, where the machine-local baseline is
      // absent.
      //
      // MinSpec cannot tell an older rendering of its own prose from a hand edit —
      // that is the premise of failing closed — so it holds, and once it has
      // recorded the withheld template body the hold is evidence-based and stops
      // nagging (AC-12). What made that a SILENT GATE was that the section had
      // stopped receiving the constitution's updates for good, the one notice said
      // "nothing is broken", and no user action could end it. So: the notice must
      // state the consequence, and the way out it names must actually work.
      generateHarnessFiles(tmp);
      write('.minspec/constitution.md', CONSTITUTION(`1. ${EXACTLY_ONCE}`));
      refreshHarnessFiles(tmp); // author's machine: everything in sync
      expect(read('CLAUDE.md')).toContain(EXACTLY_ONCE);

      write(
        'CLAUDE.md',
        read('CLAUDE.md').replace(
          'These rules must never be violated.',
          'These rules must not be violated.',
        ),
      );
      forgetBaseline();

      const first = heldNotices(refreshHarnessFiles(tmp));
      expect(first.length).toBe(1);
      expect(first[0].message).toContain('CLAUDE.md');
      // The consequence, in the message that starts the hold: it stands on every
      // later refresh, and here is how to end it.
      expect(first[0].message).toMatch(/every refresh|until/i);
      expect(first[0].message).toMatch(/empt/i);

      // Runs 2 and 3 hold on recorded evidence, so they are quiet — and the
      // constitution's new invariant really is not arriving, which is exactly why
      // run 1 had to say the hold stands rather than "your files are intact".
      write('.minspec/constitution.md', CONSTITUTION(`1. ${EXACTLY_ONCE}\n2. ${RETENTION}`));
      for (const run of [2, 3]) {
        expect(heldNotices(refreshHarnessFiles(tmp)), `refresh #${run}`).toEqual([]);
        expect(read('CLAUDE.md')).toContain('must not be violated.');
        expect(read('CLAUDE.md')).not.toContain(RETENTION);
      }

      // The way out the notice named, on the real command path: empty the held
      // section and the template comes back — with the ratified invariant on it.
      write('CLAUDE.md', read('CLAUDE.md').replace(/## Invariants\n[\s\S]*?(?=\n## )/, '## Invariants\n'));
      refreshHarnessFiles(tmp);
      expect(read('CLAUDE.md')).toContain('These rules must never be violated.');
      expect(read('CLAUDE.md')).toContain(RETENTION);
    });

    it('AC-38 (NEW-1b): a pure reorder pins nothing, so the next ratified invariant still lands', () => {
      // The fully silent freeze. A reorder is content-identical after
      // normalization, so the notice never named CLAUDE.md or AGENTS.md — yet both
      // were held on BYTES and PINNED, and a governance rule ratified afterwards
      // then never reached the agent harness at all.
      //
      // The fix is that nothing is PINNED here, not that the reorder is applied: a
      // refresh that reports nothing must also change nothing (AC-15, AC-17), so
      // the baseline-less run leaves the bytes alone and records a hash that
      // matches them. That recorded hash is a true claim, which leaves the section
      // proven-unmodified — so the next thing the constitution really says reaches
      // it, carrying the newer rendering along. Tracking is the property that
      // failed; the ordering is cosmetic and rides on the next real change.
      generateHarnessFiles(tmp);
      write('.minspec/constitution.md', CONSTITUTION(`1. ${EXACTLY_ONCE}\n2. ${SIGNED}`));
      refreshHarnessFiles(tmp);
      expect(read('CLAUDE.md')).toContain(EXACTLY_ONCE);

      // The author reorders the same two invariants and commits; the teammate's
      // clone has no machine-local baseline.
      write('.minspec/constitution.md', CONSTITUTION(`1. ${SIGNED}\n2. ${EXACTLY_ONCE}`));
      forgetBaseline();
      const notices = heldNotices(refreshHarnessFiles(tmp));

      // The hand-written constitution IS content MinSpec never wrote, so it is held
      // and named — correctly. What must NOT be held is the pair of files whose only
      // difference is the reorder, and the review's measurement of the defect is
      // exactly this: the notice named the constitution alone while CLAUDE.md and
      // AGENTS.md were silently held on bytes and pinned behind it.
      for (const notice of notices) {
        expect(notice.outputPaths ?? [notice.outputPath]).toEqual(['.minspec/constitution.md']);
      }

      // Nothing was pinned: every recorded hash still describes the bytes on disk.
      const manifest = readManifest();
      for (const f of ['CLAUDE.md', 'AGENTS.md']) {
        const disk = sectionHashesFromMarkdown(read(f));
        expect(manifest[f]['Invariants'], `${f} must not be pinned`).toBe(disk['Invariants']);
      }

      // …and a refresh that reports nothing has changed nothing, so the reorder
      // itself waits: an equal set of items is not an update, and rewriting four
      // managed files for one is a diff the user did not ask for and was not told
      // about.
      refreshHarnessFiles(tmp);
      for (const f of ['CLAUDE.md', 'AGENTS.md']) {
        const text = read(f);
        expect(text.indexOf(EXACTLY_ONCE), `${f} keeps the order it had`).toBeLessThan(
          text.indexOf(SIGNED),
        );
      }

      // Then a genuinely new invariant is ratified. THAT is content, so the whole
      // template body lands — the new invariant and the new order together. Under
      // the pin neither ever arrived, and nothing said so.
      write(
        '.minspec/constitution.md',
        CONSTITUTION(`1. ${SIGNED}\n2. ${EXACTLY_ONCE}\n3. ${RETENTION}`),
      );
      refreshHarnessFiles(tmp);
      for (const f of ['CLAUDE.md', 'AGENTS.md']) {
        const text = read(f);
        expect(text, `${f} must receive the new invariant`).toContain(RETENTION);
        expect(text.indexOf(SIGNED), `${f} must carry the new order`).toBeLessThan(
          text.indexOf(EXACTLY_ONCE),
        );
      }
    });

    it('AC-39 (NEW-1c): a project nobody has edited persists a manifest that still matches disk when its baseline goes missing', () => {
      // AC-17 pins the disk snapshot and the empty notice list for this same input,
      // and both were honestly green while the run silently poisoned the manifest:
      // three entries recorded with a hash that does not match disk, pinned from
      // then on. The damage lands in the file AC-17 never looks at.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      refreshHarnessFiles(tmp);

      forgetBaseline();
      expect(heldNotices(refreshHarnessFiles(tmp))).toEqual([]);

      const manifest = readManifest();
      const divergent: string[] = [];
      for (const rel of Object.keys(manifest)) {
        const full = path.join(tmp, rel);
        if (!fs.existsSync(full)) continue;
        const disk = sectionHashesFromMarkdown(fs.readFileSync(full, 'utf-8'));
        for (const heading of Object.keys(manifest[rel])) {
          if (manifest[rel][heading] !== disk[heading]) divergent.push(`${rel} :: ${heading}`);
        }
      }
      expect(divergent).toEqual([]);
    });

    it('AC-40 (NEW-1c, cashed): a governance edit propagates identically with and WITHOUT the machine-local baseline', () => {
      // The consequence of the poisoning, as a controlled A/B: identical inputs, the
      // only variable being whether the gitignored baseline existed at the first
      // refresh. The user then writes a principle into the constitution — the
      // governance act the whole product exists to propagate into the agent harness.
      const arm = (deleteBaseline: boolean): Record<string, boolean> => {
        generateHarnessFiles(tmp);
        refreshHarnessFiles(tmp);
        refreshHarnessFiles(tmp);
        if (deleteBaseline) forgetBaseline();
        refreshHarnessFiles(tmp); // the teammate's first refresh

        const constitution = path.join(tmp, '.minspec', 'constitution.md');
        fs.writeFileSync(
          constitution,
          fs
            .readFileSync(constitution, 'utf-8')
            .replace('## Principles\n', '## Principles\n\n- Never merge without an independent review.\n'),
        );
        refreshHarnessFiles(tmp);
        return Object.fromEntries(
          ['CLAUDE.md', 'AGENTS.md', '.cursorrules'].map((f) => [
            f,
            read(f).includes('Never merge without an independent review'),
          ]),
        );
      };

      const withBaseline = arm(false);
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-new1-'));
      const withoutBaseline = arm(true);

      expect(withoutBaseline).toEqual(withBaseline);
    });
  });

  // ── #1697 round 3: authorship of bodies MinSpec never wrote ────────────────
  //
  // The rule the whole fix runs on is "record what MinSpec wrote, never what
  // happens to be on disk". Two branches still broke it, and both were cashable —
  // the manifest entry read back as a permission slip and the next template that
  // shipped the same heading spent it.
  //
  //   NEW-2  the leftover-preserve pass recorded `hashSection(existSection.body)`
  //          for every section the template does not contain — i.e. every
  //          user-added section, in every managed file. MinSpec generated NOTHING
  //          for those headings, so there is no true hash to record and the honest
  //          record is no record at all.
  //   NEW-3  the INV-2 list-item guard recorded the user's body on the stated
  //          ground that the guard "cannot be defeated by [a baseline]". It is
  //          defeated by one, in two steps: hold the user's list against a
  //          scaffold template (recording their hash), then ship a template that
  //          DOES carry list items — the guard goes inert, the recorded hash reads
  //          as "proven unmodified", and the list is gone.
  //
  // Both are closed the same way, and it is the same way the fail-closed branch
  // was closed: a hold records the template body it declined to write, and where
  // MinSpec rendered no body at all it records nothing. "Nothing" is not a gap —
  // it is what routes the section to the fail-closed branch on the next run, so
  // the hold is loud instead of silent.
  describe('mergeFile() — T3 #1697/NEW-2 + NEW-3: a hash MinSpec has no right to record', () => {
    const merge = (
      existing: string,
      generated: string,
      oldHashes: SectionHashes = {},
    ): MergeResult => mergeFile(existing, generated, oldHashes);

    const bodyOf = (doc: string, heading: string): string =>
      parseSections(doc).find((s) => s.heading === heading)!.body;
    const hashOf = (doc: string, heading: string): string => hashSection(bodyOf(doc, heading));

    // The documented, supported thing to do: "User-added sections (not in
    // template) -> preserved".
    const RUNBOOK = [
      '# acme',
      '',
      '## Overview',
      '',
      'Generic MinSpec overview prose.',
      '',
      '## Ops runbook',
      '',
      'Paged at 3am? Restart the consumer first, THEN drain.',
      'Never truncate msgs.inbound — the regulator requires 7 years.',
      '',
    ].join('\n');
    const TEMPLATE_WITHOUT_RUNBOOK = [
      '# acme',
      '',
      '## Overview',
      '',
      'Generic MinSpec overview prose.',
      '',
    ].join('\n');
    const TEMPLATE_WITH_RUNBOOK = [
      '# acme',
      '',
      '## Overview',
      '',
      'Generic MinSpec overview prose.',
      '',
      '## Ops runbook',
      '',
      'Describe your on-call procedure here.',
      '',
    ].join('\n');

    it('AC-42 (NEW-2): a section the template has never heard of is recorded as nobody’s, not as MinSpec’s', () => {
      const result = merge(RUNBOOK, TEMPLATE_WITHOUT_RUNBOOK, {});

      // Preserved, exactly as documented…
      expect(result.merged).toContain('the regulator requires 7 years');
      // …and NOT claimed. MinSpec rendered no body for this heading, so there is
      // no true hash to record; the on-disk bytes are the user's.
      expect(persistedHashes(result)).not.toHaveProperty('Ops runbook');
      expect(result.unauthoredHeadings).toContain('Ops runbook');
      // The sections MinSpec really did write are still recorded.
      expect(persistedHashes(result)).toHaveProperty('Overview');
      expect(result.unauthoredHeadings).not.toContain('Overview');
    });

    it('AC-43 (NEW-2, the cashing): a later template that ships the heading HOLDS it instead of spending the claim', () => {
      // This is #1697's exact mechanism in the one path the earlier rounds left
      // uncovered. Feed the merge its OWN record back, then ship the heading.
      const first = merge(RUNBOOK, TEMPLATE_WITHOUT_RUNBOOK, {});
      const second = merge(first.merged, TEMPLATE_WITH_RUNBOOK, persistedHashes(first));

      expect(second.merged).toContain('the regulator requires 7 years');
      expect(second.merged).not.toContain('Describe your on-call procedure here');
      // And loudly: no baseline means no evidence, so the hold is reported.
      expect(second.preservedWithoutBaseline).toContain('Ops runbook');
    });

    it('AC-44 (NEW-2, not a retraction): a claim the baseline already PROVED is carried forward', () => {
      // "Make no new claim" must not become "retract the claim I already made".
      // A heading MinSpec wrote and a later template DROPPED is still MinSpec's
      // own content — the baseline says so — so it keeps its entry and a template
      // that restores the heading takes it back without a false hold.
      const minspecOwn = TEMPLATE_WITH_RUNBOOK; // MinSpec wrote every byte of this
      const proven = { 'Ops runbook': hashOf(minspecOwn, 'Ops runbook') };

      const dropped = merge(minspecOwn, TEMPLATE_WITHOUT_RUNBOOK, proven);
      expect(dropped.merged).toContain('Describe your on-call procedure here');
      expect(persistedHashes(dropped)['Ops runbook']).toBe(proven['Ops runbook']);
      expect(dropped.unauthoredHeadings).not.toContain('Ops runbook');

      // …so when the template brings the heading back, it is proven-unmodified and
      // updates cleanly rather than being held and reported at the user.
      const restored = merge(dropped.merged, TEMPLATE_WITH_RUNBOOK, persistedHashes(dropped));
      expect(restored.preservedWithoutBaseline).toEqual([]);
    });

    // ── NEW-3: the INV-2 guard ────────────────────────────────────────────────

    const USER_GOALS = [
      '# P — Constitution',
      '',
      '## Goals',
      '',
      '- Ship the regulator report by Q3.',
      '- Cut p99 to 200ms.',
      '',
    ].join('\n');
    /** The bundled shape the guard exists for: prose + COMMENTED examples. */
    const SCAFFOLD_GOALS = '# P — Constitution\n\n## Goals\n\n<!-- Add goals here -->\n';
    /** A later template that finally ships real list items in that section. */
    const LIST_GOALS = [
      '# P — Constitution',
      '',
      '## Goals',
      '',
      '- Describe a goal.',
      '- Describe another.',
      '',
    ].join('\n');

    it('AC-45 (NEW-3): the guard is defeated by a baseline in two steps — and must not be', () => {
      // Step 1: the guard holds the user's list against an unfilled scaffold and,
      // before this fix, recorded the USER's hash.
      const held = merge(USER_GOALS, SCAFFOLD_GOALS, {});
      expect(held.merged).toContain('Ship the regulator report by Q3.');
      expect(persistedHashes(held)['Goals']).not.toBe(hashOf(USER_GOALS, 'Goals'));

      // Step 2: a later template ships list items, so the guard goes inert. The
      // hash recorded in step 1 is what decides the section now.
      const later = merge(held.merged, LIST_GOALS, persistedHashes(held));
      expect(later.merged).toContain('Ship the regulator report by Q3.');
      expect(later.merged).not.toContain('Describe a goal.');
      // …and the hold is named, because there is still no evidence about the body.
      expect(later.preservedWithoutBaseline).toContain('Goals');
    });

    it('AC-46 (NEW-3, no over-correction): a guard hold the baseline PROVES is MinSpec’s keeps tracking', () => {
      // The seeded-constitution case the old justification was reaching for, decided
      // by measurement instead of by assertion: where the baseline says these exact
      // bytes are MinSpec's own output, recording them is TRUE, and the section goes
      // on taking template updates (#706 / AC-16c must not regress).
      const seeded = [
        '# P — Constitution',
        '',
        '## Goals',
        '',
        '- DRAFT: Trace specs to their owning epic.',
        '',
      ].join('\n');
      const proven = { Goals: hashOf(seeded, 'Goals') };

      const held = merge(seeded, SCAFFOLD_GOALS, proven);
      expect(held.merged).toContain('DRAFT: Trace specs to their owning epic.');
      expect(persistedHashes(held)['Goals']).toBe(proven['Goals']);
      expect(held.unauthoredHeadings).not.toContain('Goals');
      expect(held.preservedWithoutBaseline).toEqual([]);

      // Proven-unmodified, so a template that ships real list items lands.
      const later = merge(held.merged, LIST_GOALS, persistedHashes(held));
      expect(later.merged).toContain('Describe a goal.');
    });

    it('AC-47 (NEW-3, pinned exactly when reported): the guard obeys the NEW-1 rule too', () => {
      // A hold that withheld nothing must not pin the section (the manifest keeps
      // matching disk — AC-39); a hold that withheld real content pins it AND says
      // so, once (AC-12 must stay quiet from the second refresh on).
      const quiet = merge(USER_GOALS, SCAFFOLD_GOALS, {});
      expect(quiet.preservedWithoutBaseline).toEqual([]);
      expect(persistedHashes(quiet)).not.toHaveProperty('Goals');
      expect(quiet.unauthoredHeadings).toContain('Goals');

      const PROSE_GOALS = [
        '# P — Constitution',
        '',
        '## Goals',
        '',
        'Name the outcomes this project ladders up to, and the measure for each.',
        '',
      ].join('\n');
      const loud = merge(USER_GOALS, PROSE_GOALS, {});
      expect(loud.preservedWithoutBaseline).toEqual(['Goals']);
      expect(persistedHashes(loud)['Goals']).toBe(hashOf(PROSE_GOALS, 'Goals'));
      expect(loud.withheldTemplateHashes['Goals']).toBe(hashOf(PROSE_GOALS, 'Goals'));
      expect(loud.unauthoredHeadings).not.toContain('Goals');

      // …and once: the second refresh holds on recorded evidence and is silent.
      expect(merge(loud.merged, PROSE_GOALS, persistedHashes(loud)).preservedWithoutBaseline).toEqual([]);
    });

    // ── duplicate headings: the decision must survive the preserve pass ───────
    //
    // A heading can legally occur more than once (#153), so "record nothing" has to
    // be a decision the rest of the merge respects, not merely the absence of a
    // write that a later pass can fill in. Both directions are load-bearing and
    // both are one line.

    it('AC-52 (NEW-2/NEW-3): a surplus occurrence cannot re-mint the claim the template pass declined', () => {
      // The guard holds occurrence #1 and records nothing for it. A stale baseline
      // that happens to match occurrence #2 must not let the preserve pass file
      // that hash under the same heading — it would hand the section exactly the
      // "proven unmodified" evidence the template pass just refused to create.
      const existing = [
        '# P',
        '',
        '## Goals',
        '',
        '- Ship the regulator report by Q3.',
        '',
        '## Goals',
        '',
        '- Cut p99 to 200ms.',
        '',
      ].join('\n');
      const generated = '# P\n\n## Goals\n\n<!-- Add goals here -->\n';
      const surplusBody = parseSections(existing).filter((x) => x.heading === 'Goals')[1].body;

      const result = merge(existing, generated, { Goals: hashSection(surplusBody) });

      expect(result.merged).toContain('Ship the regulator report by Q3.');
      expect(result.merged).toContain('Cut p99 to 200ms.');
      expect(persistedHashes(result)).not.toHaveProperty('Goals');
      expect(result.unauthoredHeadings).toContain('Goals');
    });

    it('AC-52b (NEW-2/NEW-3, the other direction): a heading some occurrence DID record is never reported as unrecordable', () => {
      // The mirror hazard: occurrence #1 records nothing, occurrence #2 records a
      // real hash. Reporting the heading anyway would make the caller DELETE a true
      // entry — the manifest losing a claim MinSpec is entitled to make.
      const existing = [
        '# P',
        '',
        '## Goals',
        '',
        '- Ship the regulator report by Q3.',
        '',
        '## Goals',
        '',
        'plain prose the template also has',
        '',
      ].join('\n');
      const generated = [
        '# P',
        '',
        '## Goals',
        '',
        '<!-- Add goals here -->',
        '',
        '## Goals',
        '',
        'plain prose the template also has',
        '',
      ].join('\n');

      const result = merge(existing, generated, {});

      expect(result.merged).toContain('Ship the regulator report by Q3.');
      expect(persistedHashes(result)).toHaveProperty('Goals');
      expect(result.unauthoredHeadings).toEqual([]);
    });
  });

  describe('refreshHarnessFiles() — T3 #1697/NEW-2: the forged claim over the real command path', () => {
    let tmp: string;
    const read = (rel: string) => fs.readFileSync(path.join(tmp, rel), 'utf-8');
    const readManifest = () =>
      JSON.parse(fs.readFileSync(path.join(tmp, '.minspec', 'generated-hashes.json'), 'utf-8'));

    const RUNBOOK_MARKER = 'the regulator requires 7 years';

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-new2-'));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('AC-48 (NEW-2 end to end): the manifest makes no claim about a section the user added', () => {
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      fs.appendFileSync(
        path.join(tmp, 'CLAUDE.md'),
        `\n## Ops runbook\n\nPaged at 3am? Restart the consumer first, THEN drain.\nNever truncate msgs.inbound — ${RUNBOOK_MARKER}.\n`,
      );
      refreshHarnessFiles(tmp);

      expect(read('CLAUDE.md')).toContain(RUNBOOK_MARKER);
      // The manifest is recorded from FINAL DISK, so the user's own bytes were
      // being hashed and filed as MinSpec's output. The unit tests above cannot
      // see this: `refreshHarnessFiles` discards `mergeFile`'s newHashes.
      expect(readManifest()['CLAUDE.md']).not.toHaveProperty('Ops runbook');
    });

    it('AC-49 (NEW-2 end to end, cashed): the REAL persisted manifest cannot be spent on the user’s section', () => {
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      fs.appendFileSync(
        path.join(tmp, 'CLAUDE.md'),
        `\n## Ops runbook\n\nPaged at 3am? Restart the consumer first, THEN drain.\nNever truncate msgs.inbound — ${RUNBOOK_MARKER}.\n`,
      );
      refreshHarnessFiles(tmp);

      // A future MinSpec template ships a section with that heading. Everything
      // here is real except the template: the on-disk file and the persisted
      // manifest are the ones the command just wrote.
      const disk = read('CLAUDE.md');
      const generated = disk.replace(
        /## Ops runbook\n[\s\S]*$/,
        '## Ops runbook\n\nDescribe your on-call procedure here.\n',
      );
      const result = mergeFile(disk, generated, readManifest()['CLAUDE.md']);

      expect(result.merged).toContain(RUNBOOK_MARKER);
      expect(result.merged).not.toContain('Describe your on-call procedure here');
      expect(result.preservedWithoutBaseline).toContain('Ops runbook');
    });

    it('AC-50 (the older half, still fixed): a preserved edit with a baseline present survives MORE than one refresh', () => {
      // Not a new finding — the laundering the earlier round closed on the ordinary
      // user-modified branch, pinned so it cannot come back. Before that fix this
      // edit survived exactly ONE refresh and was silently destroyed by the second,
      // with the baseline fully present the whole time and on every path.
      //
      // "File Locations" carries no authored list items on either side, so the
      // INV-2 guard provably cannot fire and the user-modified branch is the only
      // path in play.
      const MARKER = 'Specs also live in ops/specs on the release branch. Ratified 2026-02-11.';
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      fs.writeFileSync(
        path.join(tmp, 'CLAUDE.md'),
        read('CLAUDE.md').replace('## File Locations\n', `## File Locations\n\n${MARKER}\n`),
      );
      expect(
        hasAuthoredListItems(
          parseSections(read('CLAUDE.md')).find((s) => s.heading === 'File Locations')!.body,
        ),
      ).toBe(false);

      for (let i = 0; i < 3; i++) {
        refreshHarnessFiles(tmp);
        expect(read('CLAUDE.md'), `refresh #${i + 1}`).toContain(MARKER);
      }
    });
  });

  describe('surfaceManagedRegionWarning() — T3 #1697/NEW-4: no success claim without a success', () => {
    let tmp: string;
    const infoCalls = () => vi.mocked(vscode.window.showInformationMessage).mock.calls;
    const warnCalls = () => vi.mocked(vscode.window.showWarningMessage).mock.calls;

    beforeEach(() => {
      vi.clearAllMocks();
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-new4-'));
      fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('AC-51 (NEW-4): a path that cannot be re-scaffolded is not announced as re-scaffolded', () => {
      // `rescaffoldManagedRegionFile` returns false WITHOUT writing for any path
      // outside MANAGED_REGION_TEMPLATES, and the caller discarded that false and
      // printed "MinSpec: re-scaffolded <path>." anyway. #1697 F2 routed the one
      // notice kind that could reach here away from this branch; it did not fix the
      // branch, leaving a false claim held off by nothing but the coincidence that
      // every current producer iterates MANAGED_REGION_TEMPLATES. This drives the
      // branch directly, so the guarantee no longer rests on that coincidence.
      const NOT_MANAGED = 'CLAUDE.md';
      expect(rescaffoldManagedRegionFile(tmp, NOT_MANAGED)).toBe(false);

      return (async () => {
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
          'Re-scaffold (overwrite)' as never,
        );
        await surfaceManagedRegionWarning(tmp, {
          outputPath: NOT_MANAGED,
          message: 'markers missing',
        });

        expect(infoCalls().some((c) => String(c[0]).includes('re-scaffolded'))).toBe(false);
        // …and the user is told what actually happened, rather than nothing.
        expect(
          warnCalls().some((c) => String(c[0]).includes('nothing was re-scaffolded')),
        ).toBe(true);
        // Nothing was written, either.
        expect(fs.existsSync(path.join(tmp, NOT_MANAGED))).toBe(false);
      })();
    });

    it('AC-51b (NEW-4, the other half): a real managed-region path IS announced', () => {
      // The regression guard on AC-51: the fix must not silence the true claim.
      return (async () => {
        const managed = MANAGED_REGION_TEMPLATES[0].outputPath;
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
          'Re-scaffold (overwrite)' as never,
        );
        await surfaceManagedRegionWarning(tmp, { outputPath: managed, message: 'markers missing' });

        expect(infoCalls().some((c) => String(c[0]).includes(`re-scaffolded ${managed}`))).toBe(
          true,
        );
        expect(fs.existsSync(path.join(tmp, managed))).toBe(true);
      })();
    });
  });

  describe('initRefreshCommand() — T3 #1697/F2: how the hold is surfaced', () => {
    const MARKER = 'The webhook fan-out shipped in v1.4 predates the queue-boundary rule';
    const PROJECT_CONSTITUTION = [
      '# voip-sms-inbox — Constitution',
      '',
      '## Invariants',
      '',
      '1. Delivery is exactly-once at the queue boundary, measured at the provider ack.',
      '',
      `${MARKER} and is`,
      'authorised to write directly to the provider.',
      '',
    ].join('\n');

    let tmp: string;

    /** A project holding a hand-written constitution and NO baseline. */
    const projectWithHeldContent = (): void => {
      generateHarnessFiles(tmp);
      fs.writeFileSync(path.join(tmp, '.minspec', 'constitution.md'), PROJECT_CONSTITUTION);
      fs.rmSync(path.join(tmp, '.minspec', 'generated-hashes.json'), { force: true });
    };

    const infoCalls = () => vi.mocked(vscode.window.showInformationMessage).mock.calls;

    beforeEach(() => {
      vi.clearAllMocks();
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-f2-'));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('AC-67 (NEW-A1): the completion toast makes no claim the refresh cannot back', async () => {
      // End to end, on the REAL command over a real project. The sentence that
      // stood here — "MinSpec: Refreshed harness files (user edits preserved)." —
      // was emitted unconditionally, so it was shown verbatim on a run that had
      // just silently replaced an ordering-, marker- or comment-only edit (AC-64).
      // A refresh may say what it did; it may not certify an outcome it does not
      // measure.
      projectWithHeldContent();
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as never);

      await initRefreshCommand(tmp);

      const summaries = infoCalls()
        .map((c) => String(c[0]))
        .filter((m) => m.startsWith('MinSpec: Refreshed harness files'));
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).not.toMatch(/user edits preserved/i);
      // This run DID hold sections, so the toast says so rather than staying mute
      // about it — the notice with the section names follows separately.
      expect(summaries[0]).toMatch(/kept as-is/i);
    });

    it('AC-19 (F2): no overwrite action is offered, and no re-scaffold is claimed', async () => {
      projectWithHeldContent();
      // Dismiss whatever is offered — the assertion is on what was OFFERED.
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as never);

      await initRefreshCommand(tmp);

      // The hold is surfaced…
      const held = infoCalls().filter((c) => String(c[0]).includes('no recorded baseline'));
      expect(held).toHaveLength(1);
      // …informationally: nothing is broken, the file is intact, and that is the
      // point of the notice.
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      // …with no action that would overwrite the very content just preserved.
      expect(held[0].slice(1)).not.toContain('Re-scaffold (overwrite)');
      // …and no success claim about work that could not have happened.
      expect(
        infoCalls().some((c) => String(c[0]).includes('re-scaffolded')),
      ).toBe(false);
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('AC-19b (F2): the offered action was guaranteed to do nothing — that is why it is gone', () => {
      // The mechanism, pinned independently of the routing: every path a hold can
      // name is a section-merge output, and `rescaffoldManagedRegionFile` knows
      // none of them. The old branch therefore could not have succeeded for ANY
      // input, so the "re-scaffolded" toast it printed was unconditionally false.
      projectWithHeldContent();
      const held = refreshHarnessFiles(tmp).filter(
        (n) => n.kind === 'preserved-without-baseline',
      );
      expect(held).toHaveLength(1);

      for (const p of held[0].outputPaths ?? [held[0].outputPath]) {
        expect(rescaffoldManagedRegionFile(tmp, p)).toBe(false);
      }
    });

    it('AC-19c (F2): the open action opens every file the notice names', async () => {
      projectWithHeldContent();
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(
        (async (_msg: string, ...actions: string[]) =>
          actions.find((a) => a.startsWith('Open file'))) as never,
      );

      await initRefreshCommand(tmp);

      // Read the paths back out of the notice the command actually showed — the
      // refresh has recorded a baseline by now, so re-running it would report
      // nothing and prove nothing.
      const message = String(
        infoCalls().find((c) => String(c[0]).includes('no recorded baseline'))![0],
      );
      const named = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', '.minspec/constitution.md'].filter(
        (p) => message.includes(p),
      );
      expect(named.length).toBeGreaterThan(1);
      for (const p of named) {
        expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(path.join(tmp, p));
      }
      expect(vi.mocked(vscode.workspace.openTextDocument).mock.calls).toHaveLength(named.length);
    });

    // ── F8: the surfacing branch's own edges ──────────────────────────────────
    //
    // AC-19..AC-19c drive the MULTI-file hold. The single-file hold takes a
    // different arm of the same branch (`paths.length > 1`), and the plural
    // action label is the visible half of a decision nothing tested: an action
    // reading "Open files" that opens one file is a small lie in the same toast
    // that exists to be trusted.
    //
    // These also pin what happens when the notice is DISMISSED — the ordinary
    // case, since it carries no action a user must take — because that is where
    // an accidental overwrite would be least likely to be noticed.

    /**
     * A settled project with a hold confined to ONE file: scaffold, refresh until
     * the harness stops moving, hand-write a paragraph into CLAUDE.md, then forget
     * only CLAUDE.md's baseline. Every other file keeps its baseline, so the merge
     * has evidence about them and reports nothing.
     */
    const projectWithOneHeldFile = (): void => {
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      refreshHarnessFiles(tmp);

      const claudePath = path.join(tmp, 'CLAUDE.md');
      fs.writeFileSync(
        claudePath,
        fs
          .readFileSync(claudePath, 'utf-8')
          .replace(
            '## SDD Methodology',
            'Ratified 2026-03-11: the on-call SMS owner is paged first.\n\n## SDD Methodology',
          ),
      );

      const manifestPath = path.join(tmp, '.minspec', 'generated-hashes.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      delete manifest['CLAUDE.md'];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    };

    /** The one info toast that reports a hold, as the command actually showed it. */
    const heldToast = () => infoCalls().find((c) => String(c[0]).includes('no recorded baseline'));

    it('AC-22 (F8): a single-file hold offers the SINGULAR action and opens exactly that file', async () => {
      projectWithOneHeldFile();
      vi.mocked(vscode.window.showInformationMessage).mockImplementation((async (
        message: string,
        ...actions: string[]
      ) =>
        String(message).includes('no recorded baseline')
          ? actions[0]
          : undefined) as never);

      await initRefreshCommand(tmp);

      const toast = heldToast();
      expect(toast).toBeDefined();
      // Exactly one action, and it is the singular label — a toast that says
      // "Open files" and then opens one is the never-wrong failure in miniature.
      expect(toast!.slice(1)).toEqual(['Open file']);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

      expect(vi.mocked(vscode.workspace.openTextDocument).mock.calls).toEqual([
        [path.join(tmp, 'CLAUDE.md')],
      ]);
      // …and it is actually SHOWN, not merely opened into the void.
      expect(vscode.window.showTextDocument).toHaveBeenCalledTimes(1);
    });

    it('AC-22b (F8): the toast carries the workspace attribution the other notices carry', async () => {
      // Two workspace roots can hold the identical harness file; a bare message
      // makes them indistinguishable, which is the defect #604 fixed for the
      // marker warning. A new notice kind that skipped the prefix would quietly
      // reopen it for the one notice that must be acted on.
      projectWithOneHeldFile();
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as never);

      await initRefreshCommand(tmp);

      expect(String(heldToast()![0])).toContain(`[${path.basename(tmp)}]`);
    });

    it('AC-22c (F8): dismissing the notice changes nothing on disk', async () => {
      // The default outcome, and the one an overwrite would hide in: this notice
      // asks for no decision, so most users will dismiss it. Nothing may be
      // rewritten, no error may be raised, and the held paragraph must still be
      // there afterwards.
      projectWithOneHeldFile();
      const claudePath = path.join(tmp, 'CLAUDE.md');
      vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as never);

      await initRefreshCommand(tmp);
      const afterDismissal = fs.readFileSync(claudePath, 'utf-8');

      expect(heldToast()).toBeDefined();
      expect(afterDismissal).toContain('the on-call SMS owner is paged first');
      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // #1697 F8 — the words the human actually reads.
  //
  // Everything above pins that a hold HAPPENS and that a notice is RAISED. None
  // of it looked at the sentence, and the sentence is the whole deliverable:
  // constitution invariant 2 is satisfied by a human understanding what was held
  // and what to do about it, not by an object existing in an array.
  //
  // Three things can go wrong here, all silent, none caught by any test that
  // merely counts notices: the sections stop being named (the reader is sent off
  // to diff the tree), the parser's own sentinel leaks into the prose
  // (`__preamble__` means nothing to anyone), or the counting disagrees with the
  // list it is counting.
  // ───────────────────────────────────────────────────────────────────────────
  describe('preservedWithoutBaselineMessage() — T2 #1697/F8: what the notice says', () => {
    it('AC-21 (names, not a count): every held section is named, in quotes, beside its file', () => {
      const message = preservedWithoutBaselineMessage([
        {
          outputPath: '.minspec/constitution.md',
          headings: ['Invariants', 'Standing exceptions'],
        },
      ]);

      expect(message).toContain('.minspec/constitution.md');
      expect(message).toContain('"Invariants"');
      expect(message).toContain('"Standing exceptions"');
      // …and the count agrees with the list. A message that says "1 section" and
      // then names two is worse than either half alone.
      expect(message).toContain('2 existing sections');
    });

    it('AC-21b (singular): one held section reads as one, not as "1 section(s)"', () => {
      const message = preservedWithoutBaselineMessage([
        { outputPath: 'CLAUDE.md', headings: ['Invariants'] },
      ]);

      expect(message).toContain('1 existing section as-is in CLAUDE.md');
      expect(message).not.toContain('existing sections');
    });

    it('AC-21c (displayHeading): the parser sentinel never reaches a human', () => {
      // `mergeFile` reports pre-heading content under `__preamble__`, which is a
      // parser token, not a section title. Printing it verbatim asks the reader
      // to search the file for a heading that does not exist.
      const message = preservedWithoutBaselineMessage([
        { outputPath: 'CLAUDE.md', headings: [PREAMBLE_HEADING] },
      ]);

      expect(message).not.toContain(PREAMBLE_HEADING);
      expect(message).toContain('the text above the first heading');
      // …and unquoted, because it is a description rather than a literal title.
      expect(message).not.toContain(`"${PREAMBLE_HEADING}"`);
    });

    it('AC-21d (mixed): the sentinel and a real heading coexist, each rendered its own way', () => {
      const message = preservedWithoutBaselineMessage([
        { outputPath: 'CLAUDE.md', headings: [PREAMBLE_HEADING, 'Invariants'] },
      ]);

      expect(message).not.toContain(PREAMBLE_HEADING);
      expect(message).toContain('the text above the first heading');
      expect(message).toContain('"Invariants"');
      expect(message).toContain('2 existing sections');
    });

    it('AC-21e (several files): the scope counts files, the total counts sections', () => {
      const message = preservedWithoutBaselineMessage([
        { outputPath: 'CLAUDE.md', headings: ['Invariants'] },
        { outputPath: 'AGENTS.md', headings: ['Invariants'] },
        { outputPath: '.minspec/constitution.md', headings: ['Invariants', 'Goals'] },
      ]);

      // Four sections across three files — the two numbers are different things
      // and must not be swapped for each other.
      expect(message).toContain('4 existing sections');
      expect(message).toContain('3 files');
      for (const p of ['CLAUDE.md', 'AGENTS.md', '.minspec/constitution.md']) {
        expect(message).toContain(p);
      }
      expect(message).toContain('"Goals"');
    });

    it('AC-21f (the two facts that stop this reading as damage)', () => {
      // Why it is informational, not a warning (F2): the file is INTACT. And why
      // it happened at all, so a fresh clone reporting this is understood rather
      // than escalated — the baseline is machine-local and gitignored, so its
      // absence is normal, not corruption.
      const message = preservedWithoutBaselineMessage([
        { outputPath: 'CLAUDE.md', headings: ['Invariants'] },
      ]);

      expect(message).toMatch(/nothing needs re-scaffolding/i);
      expect(message).toContain('.minspec/generated-hashes.json');
      // …and it says what to DO, since "your content was kept" on its own leaves
      // the reader with no next step.
      expect(message).toMatch(/re-apply/i);
    });

    it('AC-41 (#1697 NEW-1): it says the hold STANDS after this one notice, and names the way out', () => {
      // "Your files are intact" is true about the bytes and silent about the
      // system: until the section's content matches the template again, or its body
      // is emptied, it goes on being held and goes on not receiving updates. This
      // notice fires once — the refreshes after it hold on recorded evidence and
      // are quiet (AC-7, AC-12) — so the standing consequence and the release have
      // to be in the one message, or the reader takes silence for "resolved".
      const message = preservedWithoutBaselineMessage([
        { outputPath: 'CLAUDE.md', headings: ['Invariants'] },
      ]);

      expect(message).toMatch(/every refresh|until/i);
      // …and the release: an emptied section takes the template again (#706).
      expect(message).toMatch(/empt/i);
    });
  });

  describe('loadHashes() / saveHashes()', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-hash-test-'));
      fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty object when file does not exist', () => {
      const hashes = loadHashes(tmpDir);
      expect(hashes).toEqual({});
    });

    it('round-trips hashes through save and load', () => {
      const data = {
        'CLAUDE.md': { __preamble__: 'abc123', Overview: 'def456' },
        'AGENTS.md': { __preamble__: 'ghi789' },
      };
      saveHashes(tmpDir, data);
      const loaded = loadHashes(tmpDir);
      expect(loaded).toEqual(data);
    });

    it('returns empty object for invalid JSON', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.minspec', 'generated-hashes.json'),
        'not json!',
      );
      const hashes = loadHashes(tmpDir);
      expect(hashes).toEqual({});
    });
  });

  describe('refreshHarnessFiles() — T3 #1697/NEW-A2: a manifest an older MinSpec wrote is not a permission slip', () => {
    let tmp: string;
    const read = (rel: string) => fs.readFileSync(path.join(tmp, rel), 'utf-8');
    // Read the manifest RAW — the stamp is an on-disk contract, and `loadHashes`
    // deliberately hides it. The literals below are the contract too: a rename of
    // the exported constant must not be able to change the file format unnoticed.
    const readManifestRaw = (): Record<string, Record<string, string>> =>
      JSON.parse(fs.readFileSync(path.join(tmp, '.minspec', 'generated-hashes.json'), 'utf-8'));
    const STAMP_KEY = '__minspec__';
    const HASH_VERSION = '2';

    /** The four Markdown harness files the section merge owns. */
    const HARNESS_FILES = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', '.minspec/constitution.md'];

    /**
     * Rewrite `generated-hashes.json` exactly as a pre-#1697 MinSpec left it: every
     * entry hashed straight off final disk, and no version stamp — because the
     * concept did not exist. This is not a hypothetical file. The identical shape
     * was produced by running the pre-fix tree for real (probe `rv3-upgradeA.ts`),
     * and it is what every project that has ever run an older MinSpec has on disk
     * right now.
     */
    const downgradeManifest = (
      root: string,
      opts: { stamped?: boolean; version?: string } = {},
    ): void => {
      const legacy: Record<string, unknown> = {};
      // `version` writes an arbitrary stamp — the shape of a manifest some OTHER
      // MinSpec wrote, which is a different state from "no stamp at all" and owes
      // the reader a different sentence (#1718 pre-fix manifest migration gap).
      const stamp = opts.version ?? (opts.stamped ? HASH_VERSION : undefined);
      if (stamp !== undefined) legacy[STAMP_KEY] = { hashVersion: stamp };
      for (const rel of HARNESS_FILES) {
        const full = path.join(root, rel);
        if (!fs.existsSync(full)) continue;
        legacy[rel] = sectionHashesFromMarkdown(fs.readFileSync(full, 'utf-8'));
      }
      fs.writeFileSync(
        path.join(root, '.minspec', 'generated-hashes.json'),
        JSON.stringify(legacy, null, 2) + '\n',
      );
    };

    const RUNBOOK_MARKER = 'the regulator requires 7 years';
    const RUNBOOK =
      `\n## Ops runbook\n\nPaged at 3am? Restart the consumer first, THEN drain.\n` +
      `Never truncate msgs.inbound — ${RUNBOOK_MARKER}.\n`;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-newa2-'));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('AC-53 (NEW-A2 end to end): a claim an older MinSpec forged is torn up, not cashed', () => {
      // The whole change rests on "a recorded hash is a permission slip, and MinSpec
      // must never forge one". Shipping it without this leaves every EXISTING
      // installation's forged slips in the drawer and still spendable: the manifest
      // on disk was derived from disk by a MinSpec that had no authorship rules, so
      // it already claims the user's own paragraphs as MinSpec's output. The new
      // code reads those entries as proof and reproduces the original silent total
      // loss across the upgrade.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      fs.appendFileSync(path.join(tmp, 'CLAUDE.md'), RUNBOOK);
      downgradeManifest(tmp);

      // The forged slip, as it exists on disk today.
      expect(readManifestRaw()['CLAUDE.md']).toHaveProperty('Ops runbook');
      expect(readManifestRaw()).not.toHaveProperty(STAMP_KEY);

      // The user upgrades and refreshes. Nothing else changes.
      refreshHarnessFiles(tmp);

      expect(read('CLAUDE.md')).toContain(RUNBOOK_MARKER);
      expect(readManifestRaw()['CLAUDE.md']).not.toHaveProperty('Ops runbook');

      // …so a later template that ships the heading HOLDS the paragraph and says so,
      // instead of spending a claim MinSpec never had the right to make.
      const disk = read('CLAUDE.md');
      const generated = disk.replace(
        /## Ops runbook\n[\s\S]*$/,
        '## Ops runbook\n\nDescribe your on-call procedure here.\n',
      );
      const result = mergeFile(disk, generated, readManifestRaw()['CLAUDE.md'] ?? {});

      expect(result.merged).toContain(RUNBOOK_MARKER);
      expect(result.merged).not.toContain('Describe your on-call procedure here');
      expect(result.preservedWithoutBaseline).toContain('Ops runbook');
    });

    it('AC-54 (NEW-A2, the stamp is the only variable): the SAME entries, stamped, are still proof', () => {
      // The A/B against AC-53. Byte-identical entries, one difference: this manifest
      // carries the stamp, so it IS MinSpec's own record and its claims stand. Without
      // this, "distrust the old manifest" could just as well have been implemented as
      // "distrust every manifest", which would freeze every project's harness.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      fs.appendFileSync(path.join(tmp, 'CLAUDE.md'), RUNBOOK);
      downgradeManifest(tmp, { stamped: true });

      refreshHarnessFiles(tmp);

      expect(read('CLAUDE.md')).toContain(RUNBOOK_MARKER);
      expect(readManifestRaw()['CLAUDE.md']).toHaveProperty('Ops runbook');
    });

    it('AC-55 (NEW-A2, no laundering through Initialize): a re-run does not stamp an older manifest’s claims', () => {
      // Initialize is explicitly re-runnable, and its template loop writes nothing to
      // a file that already exists (`seedConstitution` and `generateSlashCommandShims`
      // run after it and can) — so it carries the prior manifest forward verbatim.
      // If the carry-forward is exempt from the trust gate, the very next Initialize
      // re-stamps the forged entries and hands them back their authority, which is
      // the same defect one command sideways.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      fs.appendFileSync(path.join(tmp, 'CLAUDE.md'), RUNBOOK);
      downgradeManifest(tmp);

      generateHarnessFiles(tmp);

      expect(readManifestRaw()['CLAUDE.md'] ?? {}).not.toHaveProperty('Ops runbook');
      expect(read('CLAUDE.md')).toContain(RUNBOOK_MARKER);
    });

    it('AC-56 (NEW-A2, the cost is reported, and reported honestly)', () => {
      // Distrusting the old manifest is not free: on the first refresh after the
      // upgrade every section is held on absence of evidence, exactly as a fresh
      // clone is. That is a visible cost and it MUST be visible — but the existing
      // notice explains itself with "the baseline is machine-local and gitignored,
      // so it is absent in a fresh clone", which is flatly untrue here: the file is
      // present and MinSpec chose not to act on it. A true hold with a false reason
      // is still a lie.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      // The #1697 shape itself: a ratified paragraph inside a section the template
      // ships. Under the old MinSpec this survived exactly one refresh, and the
      // manifest it left behind — hash of the user's own bytes — is what
      // `downgradeManifest` reproduces.
      const constitution = path.join(tmp, '.minspec', 'constitution.md');
      fs.writeFileSync(
        constitution,
        fs
          .readFileSync(constitution, 'utf-8')
          .replace(
            '## Invariants\n',
            '## Invariants\n\n1. No inbound webhook is processed without a verified ' +
              'signature. Ratified 2026-03-11.\n',
          ),
      );
      downgradeManifest(tmp);

      const notice = refreshHarnessFiles(tmp).find(
        (w) => w.kind === 'preserved-without-baseline',
      );

      expect(notice, 'the upgrade refresh holds sections, so it must report them').toBeDefined();
      expect(notice!.message).toContain('written by an older version of MinSpec');
      expect(notice!.message).not.toContain('absent in a fresh clone');
    });

    it('AC-57 (NEW-A2): every manifest MinSpec writes is stamped, and the stamp is not a file entry', () => {
      // The stamp rides INSIDE the manifest rather than beside it on purpose: one
      // file, one write, so the marker and the entries it vouches for can never be
      // out of step with each other, and it needs no .gitignore entry of its own to
      // stop it travelling to a machine whose manifest it does not describe.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-newa2-stamp-'));
      try {
        fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
        const data = { 'CLAUDE.md': { Overview: 'abc123' } };
        saveHashes(dir, data);

        const raw = JSON.parse(
          fs.readFileSync(path.join(dir, '.minspec', 'generated-hashes.json'), 'utf-8'),
        );
        expect(raw[STAMP_KEY]).toEqual({ hashVersion: HASH_VERSION });
        // …and it never escapes as a bogus file path: `GeneratedHashes` means
        // "file path → section hashes", and `__minspec__` is not a file.
        expect(loadHashes(dir)).toEqual(data);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('AC-58 (NEW-A2, the false hold is named): the notice never claims a held section is the user’s', () => {
      // The accepted cost, stated where the user meets it. Dropping an unproven
      // entry can strand a section MinSpec ITSELF wrote — a heading an older template
      // shipped and a newer one dropped keeps no claim, so if that heading ever
      // returns it is held and reported like any other. A notice that calls that
      // body "your content" is wrong about the one fact the reader needs, and leaves
      // them with no action; the honest version says MinSpec cannot prove the section
      // is its own, and that its own older wording is held on the same footing.
      const message = preservedWithoutBaselineMessage([
        { outputPath: 'CLAUDE.md', headings: ['Invariants'] },
      ]);

      expect(message).toMatch(/cannot prove/i);
      expect(message).toMatch(/own older|older wording|MinSpec’s own|MinSpec's own/i);
      // …and the action is stated for content the reader does NOT recognise.
      expect(message).toMatch(/do not recognise|don’t recognise|not recognise/i);
    });

    it('AC-59 (NEW-A2, the cost is paid ONCE): the upgrade settles, and the notice does not become a nag', () => {
      // The distrust is a ONE-TIME toll, and the notice says so in as many words —
      // "This is the only notice you will get about them". That sentence is a claim
      // about the next refresh, and nothing tested it on THIS path. AC-12 covers the
      // fresh-clone shape, where the manifest is absent and stays absent until the
      // refresh writes one. The upgrade shape is not that: a manifest is present,
      // MinSpec declines to spend it, and then overwrites it. If the rewrite failed
      // to stamp — or stamped a version the reader distrusts — every later refresh
      // would re-read an unproven manifest, hold again, and report again, and the
      // sentence above would be false on every repetition. A permanent nag about
      // MinSpec's own prose is the failure mode the carry-forward was built to
      // avoid; paying for it once is the trade, paying forever is not.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);

      // The #1697 shape itself: a ratified paragraph inside a section the template
      // ships, recorded by a MinSpec with no authorship rules.
      const constitution = path.join(tmp, '.minspec', 'constitution.md');
      const RATIFIED = 'Ratified 2026-03-11; must not be removed without a superseding decision.';
      fs.writeFileSync(
        constitution,
        fs
          .readFileSync(constitution, 'utf-8')
          .replace(
            '## Invariants\n',
            `## Invariants\n\n1. No inbound webhook is processed without a verified signature.\n   ${RATIFIED}\n`,
          ),
      );
      downgradeManifest(tmp);

      const held = (notices: readonly { kind?: string }[]) =>
        notices.filter((n) => n.kind === 'preserved-without-baseline');

      const r1 = refreshHarnessFiles(tmp);
      const after1 = fs.readFileSync(constitution, 'utf-8');
      expect(held(r1).length).toBeGreaterThan(0);
      expect(after1).toContain(RATIFIED);

      // The toll is paid: the manifest is now one MinSpec can stand behind…
      expect(readManifestRaw()[STAMP_KEY]).toEqual({ hashVersion: HASH_VERSION });

      // …so the refreshes after it are quiet, and the file is a fixed point.
      const r2 = refreshHarnessFiles(tmp);
      const after2 = fs.readFileSync(constitution, 'utf-8');
      expect(held(r2)).toEqual([]);
      expect(after2).toContain(RATIFIED);
      expect(after2).toBe(after1);

      const r3 = refreshHarnessFiles(tmp);
      const after3 = fs.readFileSync(constitution, 'utf-8');
      expect(held(r3)).toEqual([]);
      expect(after3).toContain(RATIFIED);
      expect(after3).toBe(after2);
    });

    it('AC-60 (NEW-A2, the rule is a gate and not a comment): no source file spends the RAW manifest', () => {
      // What actually made NEW-A2 possible was not a hard problem — it was that
      // "read the manifest" and "believe the manifest" were the same call. The fix
      // splits them, and every merge decision now goes through `loadProvenHashes`.
      // That split is currently held in place by a docstring asking callers to pick
      // the right one, and this project's own constitution says a load-bearing rule
      // the model is merely asked to remember is not a gate (invariant 2, "no silent
      // gate"). One future `loadHashes` at a decision site reinstates the whole bug
      // silently, and it would look exactly like the code that was there before.
      //
      // So the rule is enforced where it can be checked: `loadHashes` is the RAW
      // reader and has NO callers in src. If this test turns red, the new caller is
      // the thing to justify — decide deliberately whether that site is treating a
      // recorded hash as evidence (it almost certainly is; use `loadProvenHashes`)
      // rather than weakening the test.
      const srcRoot = path.resolve(__dirname, '../src');
      const collect = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) return collect(full);
          return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
        });

      // The declaration itself is the one legitimate occurrence.
      const DECLARATION = /export function loadHashes\(/;
      const offenders: string[] = [];
      for (const file of collect(srcRoot)) {
        fs.readFileSync(file, 'utf-8')
          .split('\n')
          .forEach((line, i) => {
            // `loadProvenHashes(` also ends in `loadHashes(`-ish text, so anchor on a
            // word boundary that the proven reader cannot satisfy.
            if (!/(^|[^A-Za-z])loadHashes\(/.test(line)) return;
            if (DECLARATION.test(line)) return;
            offenders.push(`${path.relative(srcRoot, file)}:${i + 1}: ${line.trim()}`);
          });
      }

      expect(
        offenders,
        'loadHashes is the RAW manifest reader — its entries are NOT proof of MinSpec ' +
          'authorship. A src caller must use loadProvenHashes instead (#1697 NEW-A2).\n' +
          offenders.join('\n'),
      ).toEqual([]);
    });

    it('AC-73 (NEW-A2 / #1718): `saveHashes` is the only writer of the manifest in src/, and it always stamps', () => {
      // The writer-side twin of AC-60, and it exists because two comments lean on it.
      // `classifyUnspentManifest` reads a MISSING stamp key as "written before #1718"
      // and `saveHashes` says an unstamped manifest is not a reachable state — both
      // true only while every write of this file goes through one stamping function.
      // That was a fact about the code with nothing holding it, which is the shape
      // this project's constitution calls a silent gate (invariant 2). A second
      // writer added later would not fail anything; it would just start producing
      // files that misdate themselves.
      //
      // Note what this does NOT claim: nothing here says MinSpec is the only thing
      // that ever writes the file. A hand-edited manifest is outside any test, and
      // `classifyUnspentManifest` carries what one costs — a wrong sentence in a
      // notice, never a spent entry.
      const srcRoot = path.resolve(__dirname, '../src');
      const collect = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) return collect(full);
          return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
        });
      const files = collect(srcRoot);

      // 1. Only `merge-refresh.ts` may build the manifest path at all. Every other
      //    module has to go through `saveHashes` / `loadProvenHashes` to touch it.
      //    (The literal in `scaffold.ts`'s gitignore list and in the notice prose
      //    names the file without building a path to it, so anchor on the constant.)
      //    Comment lines are skipped: `scaffold.ts` names the constant in prose
      //    while pinning its gitignore literal, and a guard that greps prose blocks
      //    on the documentation rather than on the code.
      const namesInCode = (file: string): boolean =>
        fs
          .readFileSync(file, 'utf-8')
          .split('\n')
          .some((line) => {
            const t = line.trim();
            if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false;
            return /(^|[^A-Za-z_])HASHES_FILENAME\b/.test(line);
          });
      const namers = files.filter(
        (f) => namesInCode(f) && path.basename(f) !== 'merge-refresh.ts',
      );
      expect(
        namers.map((f) => path.relative(srcRoot, f)),
        'only merge-refresh.ts may name the manifest path; write through saveHashes',
      ).toEqual([]);

      // 2. Inside that module, the manifest path is WRITTEN exactly once.
      const source = fs.readFileSync(path.join(srcRoot, 'lib', 'merge-refresh.ts'), 'utf-8');
      const lines = source.split('\n');
      const writeLines = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line }) =>
          /\b(writeFileSync|appendFileSync|createWriteStream|writeFile|openSync)\(\s*hashesPath\b/.test(
            line,
          ),
        );
      expect(
        writeLines.map(({ line, i }) => `${i + 1}: ${line.trim()}`),
        'the manifest must have exactly one writer',
      ).toHaveLength(1);

      // 3. …and that write is inside `saveHashes`, after the stamp is placed.
      const saveStart = lines.findIndex((l) => l.startsWith('export function saveHashes('));
      expect(saveStart).toBeGreaterThan(-1);
      const saveEnd = lines.findIndex((l, i) => i > saveStart && l === '}');
      const writeAt = writeLines[0].i;
      expect(writeAt).toBeGreaterThan(saveStart);
      expect(writeAt).toBeLessThan(saveEnd);
      const stampAt = lines.findIndex(
        (l, i) => i > saveStart && i < saveEnd && l.includes('[MANIFEST_STAMP_KEY]:'),
      );
      expect(stampAt, 'saveHashes must place the stamp').toBeGreaterThan(saveStart);
      expect(stampAt, 'the stamp must be written before the file is').toBeLessThan(writeAt);

      // 4. The behavioural half: whatever it is handed, what lands is stamped, and
      //    a caller cannot smuggle in a different stamp.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-newa2-writer-'));
      try {
        saveHashes(dir, { 'CLAUDE.md': { Overview: 'abc123' } });
        const raw = JSON.parse(
          fs.readFileSync(path.join(dir, '.minspec', 'generated-hashes.json'), 'utf-8'),
        );
        expect(raw[STAMP_KEY]).toEqual({ hashVersion: HASH_VERSION });

        saveHashes(dir, {
          [STAMP_KEY]: { hashVersion: '1' },
          'CLAUDE.md': { Overview: 'abc123' },
        } as unknown as Parameters<typeof saveHashes>[1]);
        const raw2 = JSON.parse(
          fs.readFileSync(path.join(dir, '.minspec', 'generated-hashes.json'), 'utf-8'),
        );
        expect(raw2[STAMP_KEY]).toEqual({ hashVersion: HASH_VERSION });
        expect(loadProvenHashes(dir).state).toBe('proven');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('AC-68 (NEW-A2 / #1718 pre-fix manifest migration gap): the version gate is `===`, and `1` and `3` are BOTH distrusted', () => {
      // The whole of NEW-A2 rests on ONE comparison, and nothing pinned it. The
      // edit that quietly undoes it is `>=` — it reads like "we understand
      // everything up to here" and is the natural thing to write at the next format
      // bump — after which this build spends entries produced under rules it has
      // never seen. That is the same "believe a slip you cannot read" the fix
      // removed, arriving from the other direction. So both directions are asserted:
      // `1` fails a `<=`, `3` fails a `>=`, and neither relaxation can pass.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-newa2-version-'));
      try {
        fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
        const entries = { 'CLAUDE.md': { Overview: 'abc123' } };
        const stampedWith = (hashVersion: unknown): void =>
          fs.writeFileSync(
            path.join(dir, '.minspec', 'generated-hashes.json'),
            JSON.stringify({ [STAMP_KEY]: { hashVersion }, ...entries }, null, 2) + '\n',
          );

        // The version this build WRITES is the only one it spends.
        stampedWith(HASH_VERSION);
        expect(loadProvenHashes(dir).proven).toEqual(entries);
        expect(loadProvenHashes(dir).state).toBe('proven');

        // Older: rules this build knows were wrong.
        stampedWith('1');
        expect(loadProvenHashes(dir).proven).toEqual({});
        expect(loadProvenHashes(dir).state).toBe('pre-authorship');

        // Newer: rules this build has never seen. Exactly as unproven — and this is
        // the assertion a `>=` would break.
        stampedWith('3');
        expect(loadProvenHashes(dir).proven).toEqual({});
        expect(loadProvenHashes(dir).state).toBe('unrecognised-version');

        // Not a version this build can read at all: hand-edited, or a `hashVersion`
        // that is not even a string. Distrusted, and NOT described as an old file.
        for (const bogus of ['banana', '', '2.0', 2, null]) {
          stampedWith(bogus);
          expect(loadProvenHashes(dir).proven, `stamp ${JSON.stringify(bogus)}`).toEqual({});
          expect(loadProvenHashes(dir).state, `stamp ${JSON.stringify(bogus)}`).toBe(
            'unrecognised-version',
          );
        }

        // …and the entries stay READABLE throughout: the gate decides what may be
        // SPENT, never what may be parsed.
        expect(loadHashes(dir)).toEqual(entries);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('AC-69 (NEW-A2 / #1718): a manifest with no stamp and one with no ENTRIES are different states', () => {
      // `absent` and `pre-authorship` differ by whether MinSpec DECLINED to spend
      // something. An empty manifest, or none at all, distrusted nothing — telling
      // that reader "an older MinSpec wrote your baseline" invents a file.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-newa2-absent-'));
      try {
        fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
        const manifest = path.join(dir, '.minspec', 'generated-hashes.json');

        expect(loadProvenHashes(dir).state).toBe('absent');

        fs.writeFileSync(manifest, '{}\n');
        expect(loadProvenHashes(dir).state).toBe('absent');

        fs.writeFileSync(manifest, 'not json!');
        expect(loadProvenHashes(dir).state).toBe('absent');

        // A stamp with no entries still distrusts nothing.
        fs.writeFileSync(manifest, JSON.stringify({ [STAMP_KEY]: { hashVersion: '9' } }) + '\n');
        expect(loadProvenHashes(dir).state).toBe('absent');

        // Entries and no stamp key at all: the pre-#1718 format for any file MinSpec
        // WROTE — the key did not exist then, and `saveHashes` stamps every file it
        // writes now (AC-73). A hand-edit that deletes the key lands here too and is
        // misdated as old: one wrong sentence in a notice, never a spent entry.
        fs.writeFileSync(manifest, JSON.stringify({ 'CLAUDE.md': { Overview: 'a' } }) + '\n');
        expect(loadProvenHashes(dir).state).toBe('pre-authorship');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('AC-70 (NEW-A2 / #1718): each of the three no-baseline states gets a sentence that is TRUE of it', () => {
      // The gate is one comparison; the REASON is three. `===` sends an absent
      // stamp, an older stamp and an unreadable stamp down the same hold, and the
      // notice asserted one of them for all three. "Written by an older version of
      // MinSpec" is false of a manifest a NEWER MinSpec wrote, and it sends the
      // reader hunting a downgrade that never happened — a true hold with a false
      // reason is still a false statement.
      const files = [{ outputPath: '.minspec/constitution.md', headings: ['Invariants'] }];
      const absent = preservedWithoutBaselineMessage(files, 'absent');
      const older = preservedWithoutBaselineMessage(files, 'pre-authorship');
      const unreadable = preservedWithoutBaselineMessage(files, 'unrecognised-version');

      expect(absent).toContain('absent in a fresh clone');
      expect(absent).not.toContain('older version of MinSpec');

      expect(older).toContain('written by an older version of MinSpec');
      expect(older).not.toContain('absent in a fresh clone');

      // The state the `===` gate makes reachable and neither sentence above covers.
      expect(unreadable).not.toContain('older version of MinSpec');
      expect(unreadable).not.toContain('absent in a fresh clone');
      expect(unreadable).toMatch(/cannot read/i);
      // …and it does not promise the quiet a downgrade cannot deliver: two MinSpecs
      // taking turns on one project distrust each other's manifest every time.
      expect(unreadable).not.toContain('later refreshes go back to being quiet');

      // Everything that does NOT depend on the reason survives in all three.
      for (const m of [absent, older, unreadable]) {
        expect(m).toContain('.minspec/constitution.md');
        expect(m).toContain('"Invariants"');
        expect(m).toMatch(/cannot prove/i);
        expect(m).toMatch(/empt/i);
        expect(m).toMatch(/nothing needs re-scaffolding/i);
      }
    });

    it('AC-71 (NEW-A2 / #1718, end to end): a refresh over a NEWER manifest holds, reports, and blames nothing on age', () => {
      // AC-56 is this test's twin for the unstamped case. This is the state the
      // `===` gate exists for and the message had no sentence for: the file on disk
      // was written by a MinSpec this build cannot read, so it is distrusted exactly
      // as a pre-#1718 one is — and the reader must not be told it is old.
      generateHarnessFiles(tmp);
      refreshHarnessFiles(tmp);
      const constitution = path.join(tmp, '.minspec', 'constitution.md');
      fs.writeFileSync(
        constitution,
        fs
          .readFileSync(constitution, 'utf-8')
          .replace(
            '## Invariants\n',
            '## Invariants\n\n1. No inbound webhook is processed without a verified ' +
              'signature. Ratified 2026-03-11.\n',
          ),
      );
      downgradeManifest(tmp, { version: '3' });

      const notice = refreshHarnessFiles(tmp).find(
        (w) => w.kind === 'preserved-without-baseline',
      );

      // The hold happens whatever the stamp says — the content is what matters.
      expect(notice, 'a distrusted manifest holds sections, so it must report them').toBeDefined();
      expect(fs.readFileSync(constitution, 'utf-8')).toContain('Ratified 2026-03-11');
      // …and the reason is the true one.
      expect(notice!.message).toContain('cannot read');
      expect(notice!.message).not.toContain('written by an older version of MinSpec');
      expect(notice!.message).not.toContain('absent in a fresh clone');
    });
  });

  // ── #1697 NEW-A3: the merge returns no manifest, and NEW-A1: what the merge
  //    does NOT protect ─────────────────────────────────────────────────────
  //
  // Two findings from the same review, and one root: a value nobody had checked
  // against the product.
  //
  // NEW-A3. `mergeFile` returned `newHashes`, a hash per heading decided branch by
  // branch, and NOTHING in src/ read it — `refreshHarnessFiles` destructures the
  // other four fields and the manifest is rebuilt from final on-disk bytes. It was
  // not a harmless duplicate: a branch-decided hash comes from the template body
  // BEFORE `sectionsToMarkdown` collapses its internal blank runs, so the two maps
  // disagree WHENEVER a template body carries an internal blank run — and a test that
  // chained `merge(first.merged, T, first.newHashes)` was steering the next run by a
  // map that CAN differ from the one the product writes. Not each of them was getting
  // a wrong answer: the divergence needs that blank run, and the round-4 review that
  // found this measured three diverging sites, none of them a chained one. The defect
  // is the second answer, not a tally of tests that had already tripped on it.
  //
  // NEW-A1. The re-render branch records the bytes on disk, and the comments
  // defending that recording claimed more than the code delivers. The recording
  // stays — the alternative was measured and is worse — but what it costs is now
  // stated in the source and pinned here, because a cost that lives only in a
  // comment is a cost nobody re-checks.
  describe('mergeFile() — T3 #1697/NEW-A1 + NEW-A3: the manifest nobody read, and the edits nobody protects', () => {
    const merge = (
      existing: string,
      generated: string,
      oldHashes: SectionHashes = {},
    ): MergeResult => mergeFile(existing, generated, oldHashes);

    const bodyOf = (doc: string, heading: string): string =>
      parseSections(doc).find((s) => s.heading === heading)!.body;

    // Three invariants MinSpec ships, and a fourth it ships later. Prose-free list
    // items on both sides, so the INV-2 guard cannot fire anywhere in this block.
    // Which of the REMAINING branches a test exercises is set by the baseline it
    // passes, and each test names its own.
    const TEMPLATE = [
      '# P',
      '',
      '## Invariants',
      '',
      '1. Core functionality works offline.',
      '2. No silent gate.',
      '3. MinSpec’s blast radius is the project it is installed in.',
      '',
    ].join('\n');
    const LATER = TEMPLATE.replace(
      '3. MinSpec’s blast radius is the project it is installed in.\n',
      '3. MinSpec’s blast radius is the project it is installed in.\n' +
        '4. Nothing is published without an approval on record.\n',
    );
    const settled = (): SectionHashes => ({ Invariants: hashSection(bodyOf(TEMPLATE, 'Invariants')) });

    it('AC-61 (NEW-A3, the gate): a merge result carries exactly the four fields the product consumes', () => {
      // The rule "every field of MergeResult has a production consumer" was a fact
      // about the code and nothing enforced it, which is how `newHashes` sat there
      // unread long enough for a whole tier of tests to grow on top of it. Enforce
      // it where it can be checked: the shape is fixed, so a new field has to be
      // added deliberately.
      //
      // If this turns red, the new field is the thing to justify — name its src
      // consumer, or take it back out. Do not simply widen the list; a field with
      // no consumer is a second answer waiting to disagree with the first.
      const result = merge(TEMPLATE, LATER, settled());

      expect(Object.keys(result).sort()).toEqual([
        'merged',
        'preservedWithoutBaseline',
        'unauthoredHeadings',
        'withheldTemplateHashes',
      ]);
    });

    it('AC-62 (NEW-A3): the merge’s decision-point hash is NOT the manifest, and steering by it freezes the section', () => {
      // The measurement that made NEW-A3 a defect rather than a tidy-up. A template
      // body carrying an internal `\n\n\n` — the one transform where the merge's own
      // view and the bytes it writes disagree.
      const existing = '# P\n\n## Rules\n\nLine A.\n\nLine B.\n';
      const generated = '# P\n\n## Rules\n\nLine A.\n\n\nLine B.\n';
      const first = merge(existing, generated, { Rules: hashSection(bodyOf(existing, 'Rules')) });

      // What the merge decided at the branch, versus what a refresh files.
      const decisionPoint = hashSection(bodyOf(generated, 'Rules'));
      const filed = persistedHashes(first);
      expect(filed['Rules']).toBe(hashSection(bodyOf(first.merged, 'Rules')));
      expect(decisionPoint).not.toBe(filed['Rules']);

      // …and the consequence, which is the reason this is not a cosmetic point.
      // Steer the next run by the decision-point hash and the section is pinned into
      // the user-modified branch: a later template’s content never arrives, and
      // nothing is reported. Steer it by the manifest the product actually writes
      // and the update lands.
      const later = generated.replace('Line B.\n', 'Line B.\n\nLine C.\n');
      const byDecisionPoint = merge(first.merged, later, { Rules: decisionPoint });
      expect(byDecisionPoint.merged).not.toContain('Line C.');
      expect(byDecisionPoint.preservedWithoutBaseline).toEqual([]);

      const byManifest = merge(first.merged, later, filed);
      expect(byManifest.merged).toContain('Line C.');
    });

    it('AC-63 (NEW-A3, one composition rule): what a real refresh files is `applyAuthorshipCorrections` over disk', () => {
      // `persistedHashes` above is only trustworthy if it is the product's own rule
      // rather than a test-local reimplementation of it — a reimplementation is how
      // a test tier drifts away from the product a second time. Both call the same
      // exported function, and this pins that against a REAL refresh: a project with
      // a user-added section (recorded not at all) and a held section (recorded as
      // the withheld template body) exercises both corrections at once.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-1697-a3-'));
      try {
        generateHarnessFiles(tmp);
        refreshHarnessFiles(tmp);
        fs.appendFileSync(
          path.join(tmp, 'CLAUDE.md'),
          '\n## Ops runbook\n\nRestart the consumer first, THEN drain.\n',
        );
        refreshHarnessFiles(tmp);

        const disk = fs.readFileSync(path.join(tmp, 'CLAUDE.md'), 'utf-8');
        const filed = JSON.parse(
          fs.readFileSync(path.join(tmp, '.minspec', 'generated-hashes.json'), 'utf-8'),
        )['CLAUDE.md'];

        // Disk alone would claim the user's runbook; the correction is what removes
        // it, and `applyAuthorshipCorrections` is where that correction lives.
        expect(sectionHashesFromMarkdown(disk)).toHaveProperty('Ops runbook');
        expect(applyAuthorshipCorrections(sectionHashesFromMarkdown(disk), undefined, ['Ops runbook'])).toEqual(
          filed,
        );
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    // ── NEW-A1: the cost of recording disk on the re-render branch ────────────
    //
    // `sectionContentDiffers` compares a SET of marker-stripped, whitespace-collapsed,
    // comment-free lines. An edit it cannot see is recorded as MinSpec's own output,
    // and the next template whose CONTENT changes replaces it with no notice. That is
    // a DECISION (see the branch comment), so it is pinned as one: if a future change
    // makes any of these survive, the trade has moved and the comment defending it is
    // now the thing to re-read.
    //
    // This array IS the disclosure. The four prose sites that used to enumerate the
    // shapes now cite AC-64 instead, so a newly-found shape has to be added HERE or it
    // goes undisclosed. The residual cost is the COUNT: those sites say "four" and
    // nothing checks that against this array's length, so a fifth entry added here
    // leaves four stale numbers behind it.
    const INVISIBLE_EDITS: ReadonlyArray<readonly [string, string]> = [
      [
        'ordering only',
        [
          '# P',
          '',
          '## Invariants',
          '',
          '1. No silent gate.',
          '2. MinSpec’s blast radius is the project it is installed in.',
          '3. Core functionality works offline.',
          '',
        ].join('\n'),
      ],
      ['list markers only', TEMPLATE.replace(/^(\d)\. /gm, '- ')],
      [
        'an added HTML comment only',
        TEMPLATE.trimEnd() + '\n\n<!-- ratified 2026-03-11, do not remove -->\n',
      ],
      [
        'a duplicated item only',
        TEMPLATE.replace('2. No silent gate.\n', '2. No silent gate.\n2. No silent gate.\n'),
      ],
    ];

    for (const [label, edited] of INVISIBLE_EDITS) {
      it(`AC-64 (NEW-A1): an edit of ${label} is recorded as MinSpec’s, and the next content change takes it — silently`, () => {
        const editedBody = bodyOf(edited, 'Invariants');

        // Refresh 1: content is set-equal, so the re-render branch keeps the bytes
        // AND files them as MinSpec's own output. Nothing reported, because nothing
        // was withheld.
        const first = merge(edited, TEMPLATE, settled());
        expect(bodyOf(first.merged, 'Invariants')).toBe(editedBody);
        expect(first.preservedWithoutBaseline).toEqual([]);
        const filed = persistedHashes(first);
        expect(filed['Invariants']).toBe(hashSection(editedBody));

        // Refresh 2, template content moves: the filed hash reads as proof the body
        // is MinSpec's, so the whole template body lands. The edit is GONE, and no
        // notice names it. This is the documented cost, not a regression.
        const second = merge(first.merged, LATER, filed);
        expect(bodyOf(second.merged, 'Invariants')).not.toBe(editedBody);
        expect(second.merged).toContain('4. Nothing is published without an approval on record.');
        expect(second.preservedWithoutBaseline).toEqual([]);
      });
    }

    it('AC-65 (NEW-A1, why the trade goes this way): a re-rendered section still RECEIVES a later template update', () => {
      // The property `recordNothing` on the re-render branch would destroy, measured
      // before the decision was made. With nothing on file, refresh 2 has no baseline
      // for the section, so a content change lands on the fail-closed branch: the old
      // body is HELD and the update is reported instead of delivered. Nobody had
      // edited anything here — only `renderTemplate`'s own re-rendering made the bytes
      // differ — so that would convert every routine governance update into a hold on
      // MinSpec's own prose, plus the F3 notice noise earlier rounds removed.
      const reRendered = TEMPLATE.replace(/^(\d)\. /gm, '- ');
      const first = merge(reRendered, TEMPLATE, settled());
      const filed = persistedHashes(first);
      expect(filed).toHaveProperty('Invariants'); // recorded, not withheld
      expect(first.unauthoredHeadings).toEqual([]);

      const second = merge(first.merged, LATER, filed);
      expect(second.merged).toContain('4. Nothing is published without an approval on record.');
      expect(second.preservedWithoutBaseline).toEqual([]);
    });

    it('AC-72 (NEW-A3): a duplicate LEFTOVER heading is decided ONCE, so its own second occurrence cannot delete the proven entry', () => {
      // `hashedThisRun` is what replaced the deleted hash map, and the preserve pass
      // reads it twice — to skip a heading already decided, and to filter
      // `unauthoredHeadings`. Its write on the carry-forward branch was the one no
      // test covered: deleting that single `.add` leaves the whole suite green
      // (mutation-checked) while changing the answer. Without it the SECOND
      // occurrence of a leftover heading reports the heading as unrecordable, and the
      // recorder then DELETES the manifest entry — and since
      // `sectionHashesFromMarkdown` is first-occurrence-wins, the entry being deleted
      // is the FIRST occurrence's, the one the baseline had just proven is MinSpec's
      // own. The next refresh has no evidence for a section it wrote, holds it, and
      // reports it: the false hold this round exists to keep rare.
      const existing =
        '# P\n\n## Rules\n\nR1.\n\n## Notes\n\nMinSpec wrote this one.\n\n' +
        '## Notes\n\nThe user wrote this second one.\n';
      const template = '# P\n\n## Rules\n\nR1.\n';

      const result = merge(existing, template, { Notes: hashSection(bodyOf(existing, 'Notes')) });

      // Every occurrence survives (#153)…
      expect(result.merged).toContain('MinSpec wrote this one');
      expect(result.merged).toContain('The user wrote this second one');
      // …and the heading keeps the entry its first occurrence proved.
      expect(result.unauthoredHeadings).toEqual([]);
      expect(persistedHashes(result)).toHaveProperty('Notes');
    });

    it('AC-66 (NEW-A1): the refresh toast claims no preservation, and names a hold when there is one', () => {
      // The command used to close every refresh with "(user edits preserved)",
      // unconditionally — including the AC-64 runs above, where an edit had just
      // been destroyed. A status line that is confident and wrong is the defect.
      const quiet = refreshSummaryMessage([]);
      expect(quiet).toBe('MinSpec: Refreshed harness files.');
      expect(quiet).not.toMatch(/preserved/i);

      const held = refreshSummaryMessage([
        {
          outputPath: '.minspec/constitution.md',
          message: 'Kept 1 existing section as-is…',
          kind: 'preserved-without-baseline',
        },
      ]);
      expect(held).toMatch(/kept as-is/i);
      expect(held).toMatch(/withheld/i);
      expect(held).not.toMatch(/preserved/i);

      // A notice of some OTHER kind is not a hold and must not be described as one.
      expect(
        refreshSummaryMessage([
          { outputPath: 'CLAUDE.md', message: 'removed from the index', kind: 'untracked' },
        ]),
      ).toBe('MinSpec: Refreshed harness files.');
    });
  });

});
