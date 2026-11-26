/**
 * T3 - a spec pull request that records a founder answer must carry every line of it.
 *
 * Incident (2026-11-26, SPEC-033 D-11). The founder answered D-11 through the queue proxy
 * (queue item in108). 37 seconds later the proxy added his second line to the same item as a
 * `detail` update, verbatim: "it should be off by default, but shown in the onboarding/setup
 * page as one of several easy toggles". The runner read the item with `tasks.py show`, whose
 * renderer never prints `detail`, briefed the spec edit with the item's `text` alone, and
 * closed the item. PR #4077 merged with the addition missing, and nothing compared the spec
 * against the item.
 *
 * Root cause: the item's later records were invisible on the read path the runner used, and
 * no gate checked a spec recording a founder answer against every founder quote in ALL of
 * the item's records. This file pins that gate: `scripts/lib/founder-words.ts` folds every
 * record of the item, extracts each quote marked verbatim, and reports any the spec does not
 * carry. The CLI fails closed: no quotes found is "cannot check" (exit 2), never a pass.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  itemRecords,
  extractVerbatimQuotes,
  missingQuotes,
} from '../../../scripts/lib/founder-words';

const PICK =
  '(a) Off, owner opts in (Recommended): deny on both auto-merge switches in a freshly scaffolded repo, no automatic flip; turning either on stays a deliberate per-repo act by its owner';
const ADDITION =
  'it should be off by default, but shown in the onboarding/setup page as one of several easy toggles';

// The two in108 records as the queue store held them (abridged `detail`, same shape).
const QUEUE = [
  JSON.stringify({
    op: 'add',
    key: 'in108',
    text: `SPEC-033 D-11: founder picked ${PICK}`,
    status: 'open',
    owner: 'to-runner',
    detail: "Founder answered D-11 via the proxy's AskUserQuestion on 2026-11-26.",
    at: 1795655255.3,
  }),
  JSON.stringify({ op: 'add', key: 'in109', text: 'unrelated', detail: "verbatim: 'not this one'", at: 1795655300 }),
  JSON.stringify({
    op: 'update',
    key: 'in108',
    detail: `ADDED by founder 2026-11-26, verbatim: '${ADDITION}'. So D-11 = (a) off by default, PLUS the toggle.`,
    at: 1795655292.0,
  }),
].join('\n');

// What PR #4077 merged: the pick, wrapped across lines, and no addition.
const SPEC_4077 = `## Decisions needed (Clarify)
- **D-11 - Recorded selection.** **Recorded selection: option (a),
  Off, owner opts in:** deny on both auto-merge switches in a freshly scaffolded repo, no
  automatic flip; turning either on stays a deliberate per-repo act by its owner.
`;

// What the fix carries: both lines, as blockquotes, the addition wrapped.
const SPEC_FIXED = `- **D-11 - Answered by the founder.** His pick, verbatim:

  > "${PICK}"

  His addition the same day, verbatim:

  > "it should be off by default, but shown in the onboarding/setup page as one of
  > several easy toggles"
`;

const ROOT = resolve(__dirname, '../../..');
const CLI = join(ROOT, 'scripts/check-founder-words.ts');

function runCli(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', CLI, ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

describe('founder-words: every record of the item is read', () => {
  it('folds the add AND its later updates, and only for the asked key', () => {
    const recs = itemRecords(QUEUE, 'in108');
    expect(recs.map((r) => r.op)).toEqual(['add', 'update']);
  });

  it('extracts the verbatim quote that only a later detail update carries', () => {
    expect(extractVerbatimQuotes(itemRecords(QUEUE, 'in108'))).toEqual([ADDITION]);
  });

  it("keeps an apostrophe inside a single-quoted quote (don't is not a closing quote)", () => {
    const recs = [{ op: 'add', detail: "founder, verbatim: 'don't flip it, ever'. Then act." }];
    expect(extractVerbatimQuotes(recs)).toEqual(["don't flip it, ever"]);
  });

  it('reads double and curly quotes too', () => {
    const recs = [{ op: 'add', text: 'verbatim: "one"', detail: 'his words, verbatim: “two”.' }];
    expect(extractVerbatimQuotes(recs)).toEqual(['one', 'two']);
  });
});

describe('founder-words: the spec must carry every quote', () => {
  it('REGRESSION: the #4077 text carries neither line verbatim (the pick was paraphrased, the addition dropped)', () => {
    const quotes = [PICK, ...extractVerbatimQuotes(itemRecords(QUEUE, 'in108'))];
    expect(missingQuotes(SPEC_4077, quotes)).toEqual([PICK, ADDITION]);
  });

  it('the fixed text carries both, across wraps and blockquote markers', () => {
    const quotes = [PICK, ADDITION];
    expect(missingQuotes(SPEC_FIXED, quotes)).toEqual([]);
  });

  it('control: a reworded line is missing, so matching is not just loose', () => {
    expect(missingQuotes(SPEC_FIXED, ['it should be on by default'])).toEqual(['it should be on by default']);
  });
});

describe('check-founder-words CLI: fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'founder-words-'));
  const queue = join(dir, 'tasks.jsonl');
  const bad = join(dir, 'bad.md');
  const good = join(dir, 'good.md');
  writeFileSync(queue, QUEUE);
  writeFileSync(bad, SPEC_4077);
  writeFileSync(good, SPEC_FIXED);

  it('exit 1 and names the missing line on the #4077 text', () => {
    const r = runCli(['--spec', bad, '--queue', queue, '--key', 'in108', '--quote', PICK]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(ADDITION);
  });

  it('exit 0 on the fixed text', () => {
    const r = runCli(['--spec', good, '--queue', queue, '--key', 'in108', '--quote', PICK]);
    expect(r.code).toBe(0);
  });

  it('exit 2 when the key has no records (cannot check is never a pass)', () => {
    const r = runCli(['--spec', good, '--queue', queue, '--key', 'nosuch']);
    expect(r.code).toBe(2);
  });

  it('exit 2 when no founder quote is found at all', () => {
    const r = runCli(['--spec', good, '--queue', queue, '--key', 'in108x']);
    expect(r.code).toBe(2);
    const none = join(dir, 'none.jsonl');
    writeFileSync(none, JSON.stringify({ op: 'add', key: 'k1', text: 'no quote here' }));
    expect(runCli(['--spec', good, '--queue', none, '--key', 'k1']).code).toBe(2);
  });
});
