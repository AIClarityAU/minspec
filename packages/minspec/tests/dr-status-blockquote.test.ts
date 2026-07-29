import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * #998 — a settled (non-proposed) DR must not carry an intro blockquote that
 * still asserts it "stays proposed".
 *
 * A DR records its live status in ONE authoritative place: the frontmatter
 * `status:` field. The hand-authored intro blockquote is a convention reminder
 * (born `proposed` per DR-029; acceptance is a separate human act), NOT a second
 * status readout. Three accepted DRs (DR-054/DR-055/DR-066) drifted because their
 * blockquote asserted a live "stays `proposed`" that the Accept-ADR flow never
 * rewrites and the #626 body↔frontmatter parity gate never reads — that gate
 * inspects only the `## Status` heading / `**Status:**` line, never the intro
 * blockquote (see status-parity.ts), so this representation could drift
 * indefinitely.
 *
 * This guard closes the class deterministically. There is NO generating template
 * to fix at source (`generateAdrContent` in adr-manager.ts emits no such
 * blockquote — it is a hand-authored convention), so a corpus test is the
 * write-time teeth: constitution invariant #2 (no silent gate) / "enforce, don't
 * trust the author to remember".
 *
 * Deliberately NARROW: it forbids only the specific false live-status string
 * ("stays proposed") in a non-proposed DR's intro — NOT full blockquote↔frontmatter
 * parity (the heavier #626-gate extension #998 explicitly weighed and set aside as
 * "more machinery"). False-positive-safe by construction:
 *   - a `proposed` DR is unconstrained — it MAY say "stays proposed" (then true);
 *   - historical "Born `proposed` per DR-029" (no "stays") is always allowed;
 *   - only the intro region (before the first `##` heading) is scanned, so a body
 *     that quotes the convention verbatim never trips it.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DECISIONS_DIR = path.join(REPO_ROOT, 'docs', 'decisions');

const DR_FILE_RE = /^DR-\d+.*\.md$/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** A live "current status is proposed" assertion (the backtick is optional). */
const LIVE_STAYS_PROPOSED = /stays\s+`?proposed/i;

/** Lightweight frontmatter `status:` read (mirrors adr-manager's parser). */
function frontmatterStatus(content: string): string | null {
  const fm = content.match(FRONTMATTER_RE);
  if (!fm) return null;
  const m = fm[1].match(/^status:\s*(\S+)/m);
  return m ? m[1].toLowerCase() : null;
}

/** The intro region: everything after the frontmatter, before the first `##` heading. */
function introRegion(content: string): string {
  const body = content.replace(FRONTMATTER_RE, '');
  const idx = body.search(/^##\s/m);
  return idx === -1 ? body : body.slice(0, idx);
}

function drFiles(): string[] {
  if (!fs.existsSync(DECISIONS_DIR)) return [];
  return fs.readdirSync(DECISIONS_DIR).filter(f => DR_FILE_RE.test(f)).sort();
}

describe('#998 — settled DRs do not assert a live "stays proposed" in their intro', () => {
  it('finds DR files to check', () => {
    expect(drFiles().length).toBeGreaterThan(0);
  });

  for (const file of drFiles()) {
    const content = fs.readFileSync(path.join(DECISIONS_DIR, file), 'utf-8');
    const status = frontmatterStatus(content);
    // Only SETTLED (non-proposed) DRs are constrained. A `proposed` DR — or one
    // with no parseable frontmatter status — may legitimately say "stays proposed".
    if (!status || status === 'proposed') continue;

    it(`${file} (status: ${status}) intro does not claim it stays proposed`, () => {
      expect(LIVE_STAYS_PROPOSED.test(introRegion(content))).toBe(false);
    });
  }
});
