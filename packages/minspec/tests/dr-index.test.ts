/**
 * T1 — Contract Tests: DR Index Regeneration
 *
 * Tests the auto-generated detailed Decision Register INDEX.md:
 *   - summarizeContext (offline summarizer, no AI dependency)
 *   - extractContextBody (fallback chain)
 *   - renderDrEntry (header + link + meta + summary format)
 *   - buildDrIndexContent (multi-DR assembly)
 *   - mergeDrIndex (invariant 6 — preserves user content outside markers)
 *   - regenerateDrIndex (end-to-end on disk)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  summarizeContext,
  extractContextBody,
  renderDrEntry,
  buildDrIndexContent,
  mergeDrIndex,
  regenerateDrIndex,
  type AdrSummary,
} from '../src/lib/adr-manager';

describe('dr-index regenerator', () => {
  let tmpDir: string;
  let decisionsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-drindex-'));
    fs.mkdirSync(path.join(tmpDir, '.minspec'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.minspec', 'config.json'),
      JSON.stringify({ decisionsDir: 'docs/decisions' }),
      'utf-8',
    );
    decisionsDir = path.join(tmpDir, 'docs', 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── summarizeContext ────────────────────────────────────────────────

  describe('summarizeContext()', () => {
    it('returns first paragraph when within word budget', () => {
      const body = 'A short context paragraph explaining the motivation for the architectural decision in ' +
        'roughly fifty words with enough substance to clear the minimum word budget yet remain well ' +
        'under the word maximum cap so it is neither padded nor truncated for the index output.';
      const result = summarizeContext(body, { wordMin: 40, wordMax: 80 });
      const wc = result.split(/\s+/).length;
      expect(wc).toBeGreaterThanOrEqual(40);
      expect(wc).toBeLessThanOrEqual(80);
      expect(result).not.toContain('…');
    });

    it('truncates with ellipsis when exceeding wordMax', () => {
      const long = 'word '.repeat(200).trim();
      const result = summarizeContext(long, { wordMin: 40, wordMax: 80 });
      expect(result.endsWith('…')).toBe(true);
      expect(result.split(/\s+/).length).toBeLessThanOrEqual(81);
    });

    it('pulls additional paragraphs to reach wordMin', () => {
      const body = 'Short one.\n\nAnother short paragraph here.\n\nThird one continues to push toward the minimum word count.\n\nFourth.';
      const result = summarizeContext(body, { wordMin: 15, wordMax: 80 });
      expect(result.split(/\s+/).length).toBeGreaterThanOrEqual(10);
    });

    it('strips HTML comments and code fences', () => {
      const body = '<!-- a comment -->\n```\ncode block\n```\n\nReal paragraph content here with enough words.';
      const result = summarizeContext(body, { wordMin: 5, wordMax: 80 });
      expect(result).not.toContain('comment');
      expect(result).not.toContain('code block');
      expect(result).toContain('Real paragraph');
    });

    it('flattens markdown links to label text', () => {
      const body = 'See [this link](https://example.com/page) for details about the issue and the chosen path forward.';
      const result = summarizeContext(body, { wordMin: 5, wordMax: 80 });
      expect(result).toContain('this link');
      expect(result).not.toContain('example.com');
    });

    it('returns empty string when no usable content', () => {
      expect(summarizeContext('', { wordMin: 40, wordMax: 80 })).toBe('');
      expect(summarizeContext('<!-- only comments -->', { wordMin: 40, wordMax: 80 })).toBe('');
    });
  });

  // ─── extractContextBody ──────────────────────────────────────────────

  describe('extractContextBody()', () => {
    it('extracts the Context section when present', () => {
      const body = '# DR-001\n\n## Context\n\nThe motivation.\n\n## Decision\n\nWhat we do.\n';
      const result = extractContextBody(body);
      expect(result.trim()).toBe('The motivation.');
    });

    it('falls back to Decision when Context is empty', () => {
      const body = '# DR-001\n\n## Context\n\n## Decision\n\nThe decision text.\n';
      const result = extractContextBody(body);
      expect(result.trim()).toBe('The decision text.');
    });

    it('falls back to body after H1 when neither section present', () => {
      const body = '# DR-001\n\nA plain paragraph without sections.\n';
      const result = extractContextBody(body);
      expect(result.trim()).toContain('plain paragraph');
    });
  });

  // ─── renderDrEntry ───────────────────────────────────────────────────

  describe('renderDrEntry()', () => {
    it('produces clickable header + meta + summary', () => {
      const filePath = path.join(decisionsDir, 'DR-001-test-decision.md');
      fs.writeFileSync(
        filePath,
        '---\nid: DR-001\ntitle: Test Decision\nstatus: accepted\ndate: 2026-05-28\n---\n\n## Context\n\n' +
          'This is the context paragraph explaining why we are making this choice in enough words to clear forty.\n',
        'utf-8',
      );
      const summary: AdrSummary = {
        id: 'DR-001',
        title: 'Test Decision',
        status: 'accepted',
        date: '2026-05-28',
        filePath,
      };
      const out = renderDrEntry(summary);
      expect(out).toContain('## [DR-001 — Test Decision](DR-001-test-decision.md)');
      expect(out).toContain('Status: accepted');
      expect(out).toContain('Date: 2026-05-28');
      expect(out).toContain('context paragraph');
    });

    it('emits fallback when ADR has no parseable summary', () => {
      const filePath = path.join(decisionsDir, 'DR-002-empty.md');
      fs.writeFileSync(filePath, '---\nid: DR-002\ntitle: Empty\nstatus: proposed\n---\n\n', 'utf-8');
      const summary: AdrSummary = {
        id: 'DR-002',
        title: 'Empty',
        status: 'proposed',
        date: '',
        filePath,
      };
      const out = renderDrEntry(summary);
      expect(out).toContain('_No summary available._');
    });
  });

  // ─── buildDrIndexContent ─────────────────────────────────────────────

  describe('buildDrIndexContent()', () => {
    it('returns empty-state message when no DRs exist', () => {
      const { content, count } = buildDrIndexContent(tmpDir);
      expect(count).toBe(0);
      expect(content).toContain('No decisions recorded yet');
    });

    it('assembles multiple DRs in sorted order', () => {
      fs.writeFileSync(
        path.join(decisionsDir, 'DR-001-first.md'),
        '---\nid: DR-001\ntitle: First\nstatus: accepted\ndate: 2026-01-01\n---\n\n## Context\n\nFirst rationale paragraph.\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(decisionsDir, 'DR-002-second.md'),
        '---\nid: DR-002\ntitle: Second\nstatus: proposed\ndate: 2026-02-01\n---\n\n## Context\n\nSecond rationale paragraph.\n',
        'utf-8',
      );

      const { content, count } = buildDrIndexContent(tmpDir);
      expect(count).toBe(2);
      const firstIdx = content.indexOf('DR-001');
      const secondIdx = content.indexOf('DR-002');
      expect(firstIdx).toBeGreaterThan(-1);
      expect(secondIdx).toBeGreaterThan(firstIdx);
    });
  });

  // ─── mergeDrIndex (invariant 6) ──────────────────────────────────────

  describe('mergeDrIndex()', () => {
    it('wraps auto content in markers when file is empty', () => {
      const merged = mergeDrIndex(null, '# Decision Register\n\nbody\n');
      expect(merged).toContain('<!-- minspec:dr-index:start -->');
      expect(merged).toContain('<!-- minspec:dr-index:end -->');
      expect(merged).toContain('# Decision Register');
    });

    it('replaces content between existing markers, preserves outer content', () => {
      const existing =
        '# Custom Heading\n\nMy own notes.\n\n' +
        '<!-- minspec:dr-index:start -->\n' +
        'OLD AUTO CONTENT\n' +
        '<!-- minspec:dr-index:end -->\n\n' +
        '## My Footer\n\nFooter notes.\n';
      const merged = mergeDrIndex(existing, '# Decision Register\n\nNEW BODY\n');

      expect(merged).toContain('# Custom Heading');
      expect(merged).toContain('My own notes.');
      expect(merged).toContain('NEW BODY');
      expect(merged).not.toContain('OLD AUTO CONTENT');
      expect(merged).toContain('## My Footer');
      expect(merged).toContain('Footer notes.');
    });

    it('full-replaces a legacy table-only INDEX.md', () => {
      const legacy =
        '# Decision Register\n\n' +
        '| ID | Title | Status | Date |\n|---|---|---|---|\n' +
        '| [DR-001](DR-001.md) | First | accepted | 2026-01-01 |\n';
      const merged = mergeDrIndex(legacy, '# Decision Register\n\nNEW DETAILED BODY\n');
      expect(merged).toContain('NEW DETAILED BODY');
      expect(merged).not.toContain('| ID | Title |');
    });

    it('appends markered block when file has unrecognised user content', () => {
      const existing = '# Some Other Doc\n\nA much longer document\n' + 'line\n'.repeat(40);
      const merged = mergeDrIndex(existing, '# Decision Register\n\nAUTO\n');
      expect(merged).toContain('A much longer document');
      expect(merged).toContain('AUTO');
      expect(merged).toContain('<!-- minspec:dr-index:start -->');
    });

    // ─── #152: a $-special sequence in a DR title must not corrupt the INDEX ──
    it('writes auto content with $-special sequences verbatim when replacing markers', () => {
      const existing =
        '# Heading\n\n' +
        '<!-- minspec:dr-index:start -->\nOLD\n<!-- minspec:dr-index:end -->\n';
      // `$1`, `$&`, `$\`` and `$$` are all RegExp-replacement specials.
      const auto = '# Decision Register\n\n## [DR-001 — cost is $5 ($1 each), A$AP, $& $`]\n';
      const merged = mergeDrIndex(existing, auto);
      expect(merged).toContain('cost is $5 ($1 each), A$AP, $& $`');
      expect(merged).not.toContain('OLD');
    });
  });

  // ─── regenerateDrIndex (end-to-end) ──────────────────────────────────

  describe('regenerateDrIndex()', () => {
    it('writes INDEX.md and is idempotent across re-runs', () => {
      fs.writeFileSync(
        path.join(decisionsDir, 'DR-001-alpha.md'),
        '---\nid: DR-001\ntitle: Alpha\nstatus: accepted\ndate: 2026-01-01\n---\n\n## Context\n\nAlpha rationale paragraph.\n',
        'utf-8',
      );

      const r1 = regenerateDrIndex(tmpDir);
      expect(r1.count).toBe(1);
      const content1 = fs.readFileSync(r1.filePath, 'utf-8');
      expect(content1).toContain('DR-001');
      expect(content1).toContain('<!-- minspec:dr-index:start -->');

      const r2 = regenerateDrIndex(tmpDir);
      const content2 = fs.readFileSync(r2.filePath, 'utf-8');
      expect(content2).toBe(content1);
    });

    it('preserves user content outside markers on regeneration', () => {
      fs.writeFileSync(
        path.join(decisionsDir, 'DR-001-alpha.md'),
        '---\nid: DR-001\ntitle: Alpha\nstatus: accepted\ndate: 2026-01-01\n---\n\n## Context\n\nAlpha rationale paragraph.\n',
        'utf-8',
      );

      regenerateDrIndex(tmpDir);
      const indexPath = path.join(decisionsDir, 'INDEX.md');
      const initial = fs.readFileSync(indexPath, 'utf-8');
      const withUserNotes = initial + '\n## Reviewer Notes\n\nDR-001 needs a follow-up.\n';
      fs.writeFileSync(indexPath, withUserNotes, 'utf-8');

      regenerateDrIndex(tmpDir);
      const after = fs.readFileSync(indexPath, 'utf-8');
      expect(after).toContain('## Reviewer Notes');
      expect(after).toContain('DR-001 needs a follow-up.');
    });

    // ─── #152: a $-special title survives the full marker-replace regeneration ──
    it('keeps a DR title with $-special sequences intact across a re-run', () => {
      const title = 'cost is $5 ($1 each) for A$AP — $& $`';
      fs.writeFileSync(
        path.join(decisionsDir, 'DR-001-dollar.md'),
        `---\nid: DR-001\ntitle: ${title}\nstatus: accepted\ndate: 2026-01-01\n---\n\n## Context\n\nWhy this matters.\n`,
        'utf-8',
      );

      // First run seeds the markers; the second run hits the marker-replace path.
      regenerateDrIndex(tmpDir);
      regenerateDrIndex(tmpDir);

      const content = fs.readFileSync(path.join(decisionsDir, 'INDEX.md'), 'utf-8');
      expect(content).toContain(`## [DR-001 — ${title}]`);
      // Corruption ($& / $` expansion) duplicates the marker block, so the title
      // and each marker must appear exactly ONCE — a plain `toContain` is fooled
      // by the re-injected copy the buggy replacement leaves behind.
      expect(content.match(/## \[DR-001 —/g)).toHaveLength(1);
      expect(content.match(/minspec:dr-index:start/g)).toHaveLength(1);
      expect(content.match(/minspec:dr-index:end/g)).toHaveLength(1);
    });
  });
});
