/**
 * #943 — accepting a DR must never leave the file asserting two statuses, and must date
 * the transition rather than relabel an old date.
 *
 * #1624 taught `setAdrStatus` to rewrite the body `## Status` claim alongside the
 * frontmatter — but only on the branch where the DR already HAS frontmatter. A pre-MinSpec
 * DR (no frontmatter, which the picker deliberately surfaces) took the synthesize branch,
 * which prepended `status: accepted` over a body still reading `Proposed (…)`: the exact
 * split #943 reported, still reachable through the Accept command.
 *
 * Two further parts of #943's fix were never built:
 *  - "stamp the accept date": swapping the token alone turns `Proposed (2026-06-01).` into
 *    `Accepted (2026-06-01).`, so the PROPOSAL date reads as the acceptance date — a false
 *    signpost the #626 gate cannot see, because it compares tokens, never dates.
 *  - "run the #626 parity check as part of accept and refuse to leave a split state": the
 *    gate ran only at commit/CI, after the ext had already written the split.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  setAdrStatus,
  reconcileBodyStatus,
  assertBodyStatusParity,
} from '../src/lib/adr-manager';
import { inspectAllStatusClaims, checkStatusParity } from '../src/lib/status-parity';

const TODAY = '2026-11-20';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr943-'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (name: string, text: string): string => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, text);
  return f;
};

/** Every comparable body claim, as the #626 gate reads them. */
const bodyTokens = (text: string): string[] =>
  inspectAllStatusClaims(text, 'dr')
    .filter((c): c is { kind: 'comparable'; token: string; line: number } => c.kind === 'comparable')
    .map((c) => c.token);

const frontmatterStatus = (text: string): string | undefined =>
  text.match(/^---\n[\s\S]*?^status:\s*(\S+)/m)?.[1];

describe('#943 — a frontmatter-less (pre-MinSpec) DR is reconciled too', () => {
  const PRE_MINSPEC = '# DR-005: Legacy thing\n\n## Status\n\nProposed (2026-06-01).\n\n## Context\n\nc\n';

  it('THE #943 CASE: accept leaves frontmatter and body agreeing', () => {
    const f = write('DR-005-legacy.md', PRE_MINSPEC);
    setAdrStatus(f, 'accepted');
    const out = fs.readFileSync(f, 'utf-8');
    expect(frontmatterStatus(out)).toBe('accepted');
    expect(bodyTokens(out)).toEqual(['accepted']);
    // The gate itself, not this file's idea of it.
    expect(checkStatusParity(out, 'accepted', 'dr')).toBeNull();
  });

  it('the synthesized `date:` is still the ORIGINAL date, not the stamp', () => {
    const f = write('DR-005-legacy.md', PRE_MINSPEC);
    setAdrStatus(f, 'accepted');
    const out = fs.readFileSync(f, 'utf-8');
    expect(out).toMatch(/^date: 2026-06-01$/m);
  });

  it('a negating status line is refused on this branch too, and nothing is written', () => {
    const text = '# DR-006: X\n\n## Status\n\n**Proposed** 2026-08-24. Not accepted yet.\n\n## Context\n\nc\n';
    const f = write('DR-006-x.md', text);
    expect(() => setAdrStatus(f, 'accepted')).toThrow(/negates a status word/);
    expect(fs.readFileSync(f, 'utf-8')).toBe(text);
  });
});

describe('#943 — the transition is dated, not relabelled', () => {
  const fm = (body: string) =>
    `---\nid: DR-999\nstatus: proposed\n---\n\n# DR-999\n\n## Status\n\n${body}\n\n## Context\n\nc\n`;

  it('parenthesised date: the old date is kept, labelled with the old status', () => {
    const f = write('DR-999.md', fm('Proposed (2026-06-01).'));
    setAdrStatus(f, 'accepted');
    expect(fs.readFileSync(f, 'utf-8')).toContain(`Accepted (${TODAY}; proposed 2026-06-01).`);
  });

  it('bare date after emphasis', () => {
    const f = write('DR-999.md', fm('**Proposed** 2026-08-24, founder review pending.'));
    setAdrStatus(f, 'accepted');
    expect(fs.readFileSync(f, 'utf-8')).toContain(
      `**Accepted** ${TODAY} (proposed 2026-08-24), founder review pending.`,
    );
  });

  it('parenthesised date after emphasis', () => {
    const f = write('DR-999.md', fm('*Proposed* (2026-06-01) — x.'));
    setAdrStatus(f, 'accepted');
    expect(fs.readFileSync(f, 'utf-8')).toContain(`*Accepted* (${TODAY}; proposed 2026-06-01) — x.`);
  });

  it('no date: today is inserted right after the token', () => {
    const f = write('DR-999.md', fm('**Proposed.** The decision was made by the founder.'));
    setAdrStatus(f, 'accepted');
    expect(fs.readFileSync(f, 'utf-8')).toContain(
      `**Accepted (${TODAY}).** The decision was made by the founder.`,
    );
  });

  it('head-blockquote form', () => {
    const text = `---\nid: DR-996\nstatus: proposed\n---\n\n# DR-996\n\n> **Status: proposed — born per DR-029**\n\n## Context\n\nc\n`;
    const f = write('DR-996.md', text);
    setAdrStatus(f, 'accepted');
    expect(fs.readFileSync(f, 'utf-8')).toContain(`> **Status: accepted (${TODAY}) — born per DR-029**`);
  });

  it('a stamped file still passes the #626 gate', () => {
    const f = write('DR-999.md', fm('Proposed (2026-06-01).'));
    setAdrStatus(f, 'accepted');
    const out = fs.readFileSync(f, 'utf-8');
    expect(bodyTokens(out)).toEqual(['accepted']);
    expect(checkStatusParity(out, 'accepted', 'dr')).toBeNull();
  });

  it('re-setting the SAME status stamps nothing (idempotent)', () => {
    const text = `---\nid: DR-999\nstatus: accepted\n---\n\n# DR-999\n\n## Status\n\nAccepted (2026-07-26; proposed 2026-06-23).\n\n## Context\n\nc\n`;
    const f = write('DR-999.md', text);
    setAdrStatus(f, 'accepted');
    expect(fs.readFileSync(f, 'utf-8')).toBe(text);
  });

  it('later transitions are dated the same way (accepted → superseded)', () => {
    const text = `---\nid: DR-999\nstatus: accepted\n---\n\n# DR-999\n\n## Status\n\nAccepted (2026-07-26).\n\n## Context\n\nc\n`;
    const f = write('DR-999.md', text);
    setAdrStatus(f, 'superseded');
    expect(fs.readFileSync(f, 'utf-8')).toContain(`Superseded (${TODAY}; accepted 2026-07-26).`);
  });

  it('the pure function stamps nothing unless asked', () => {
    const text = fm('Proposed (2026-06-01).');
    expect(reconcileBodyStatus(text, 'accepted')).toContain('Accepted (2026-06-01).');
  });

  it('rejects a stampDate that is not YYYY-MM-DD', () => {
    expect(() => reconcileBodyStatus(fm('Proposed.'), 'accepted', { stampDate: '20/11/2026' })).toThrow(
      /YYYY-MM-DD/,
    );
  });
});

describe('#943 — the #626 parity check runs inside the write path', () => {
  it('throws, naming the line, when a comparable claim disagrees', () => {
    const split = `---\nid: DR-999\nstatus: accepted\n---\n\n# DR-999\n\n## Status\n\nProposed.\n`;
    expect(() => assertBodyStatusParity('/x/DR-999.md', split, 'accepted')).toThrow(
      /DR-999\.md.*line 10.*"proposed"/s,
    );
  });

  it('passes when every comparable claim agrees, and ignores freeform lines', () => {
    const ok = `---\nid: DR-999\nstatus: accepted\n---\n\n# DR-999\n\n## Status\n\nAccepted.\n`;
    expect(() => assertBodyStatusParity('/x/DR-999.md', ok, 'accepted')).not.toThrow();
    const free = `---\nid: DR-999\nstatus: accepted\n---\n\n# DR-999\n\n## Status\n\nClarify complete — awaiting Accept.\n`;
    expect(() => assertBodyStatusParity('/x/DR-999.md', free, 'accepted')).not.toThrow();
  });
});
