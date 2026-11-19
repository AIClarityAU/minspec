/**
 * #1083 — the Accept-ADR WRITER must move with the #998 corpus guard
 * (dr-status-blockquote.test.ts). After setAdrStatus(→ accepted) runs on a DR carrying
 * the standard born-proposed intro blockquote, the guard's predicate must pass.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setAdrStatus, reconcileIntroBlockquote } from '../src/lib/adr-manager';

// Same predicate + intro scan as dr-status-blockquote.test.ts.
const LIVE_STAYS_PROPOSED = /stays\s+`?proposed/i;
function introRegion(content: string): string {
  const body = content.replace(/^---\n([\s\S]*?)\n---/, '');
  const idx = body.search(/^##\s/m);
  return idx === -1 ? body : body.slice(0, idx);
}

const DR = `---
id: DR-900
status: proposed
date: 2026-07-29
title: Fixture
---

# DR-900: Fixture

> **Born / stays \`proposed\` per DR-029** — acceptance is a separate human act
> (*MinSpec: Accept ADR*). Nothing here turns consent on.

## Context

Quoting the convention: the DR "stays proposed" in a body paragraph.
`;

describe('#1083 accept rewrites the born-proposed intro blockquote', () => {
  it('setAdrStatus(accepted) leaves an intro the guard predicate accepts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-bq-'));
    const file = path.join(dir, 'DR-900.md');
    fs.writeFileSync(file, DR, 'utf-8');
    expect(LIVE_STAYS_PROPOSED.test(introRegion(DR))).toBe(true);
    setAdrStatus(file, 'accepted');
    const out = fs.readFileSync(file, 'utf-8');
    expect(out).toContain('status: accepted');
    expect(LIVE_STAYS_PROPOSED.test(introRegion(out))).toBe(false);
    expect(out).toContain('Born `proposed` per DR-029');
    expect(out).toContain('frontmatter `status:`');
    // body (after first ##) is never rewritten
    expect(out).toContain('"stays proposed" in a body paragraph');
  });

  it('is a no-op for a proposed target and for an already-clean intro', () => {
    expect(reconcileIntroBlockquote(DR, 'proposed')).toBe(DR);
    const clean = reconcileIntroBlockquote(DR, 'accepted');
    expect(reconcileIntroBlockquote(clean, 'accepted')).toBe(clean);
  });
});
