/**
 * T3 — the per-SHA fetch/cache emit path in scripts/review-churn-report.sh (#1840).
 *
 * This exists because the sibling test did NOT cover it and said it did. That test
 * asserts "three records stay three" while feeding already-separated rows straight to
 * the counting loop, which lives inside different markers entirely. The defect it
 * claimed to guard is here, in the cache path, and reverting the fix left the sibling
 * green. A test that names a defect it cannot reproduce is a false signpost, which is
 * the one thing this instrument is not allowed to be.
 *
 * The defect: the cache was written with `printf '%s'` (no trailing newline) while the
 * fresh path emitted `printf '%s\n'`. On a cache HIT for a SHA shared across PRs, `cat`
 * emitted rows with no final newline, so the next SHA's first row was appended to the
 * last cached row. `sort -u` then merged two records into one and the parser read the
 * trailing fields as a fingerprint: one run dropped, another corrupted.
 *
 * The block is executed VERBATIM out of the script between `# >>> sha-emit` markers,
 * with gh_retry stubbed, so the cache write and the cache read are the real ones.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/review-churn-report.sh');
const src = fs.readFileSync(SCRIPT, 'utf-8');
const BEGIN = '# >>> sha-emit';
const END = '# <<< sha-emit';

function emitBlock(): string {
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END);
  if (b < 0 || e < 0 || e <= b) {
    throw new Error(
      `sha-emit markers missing from ${SCRIPT} — the block this test executes has moved. ` +
        `Fix the markers rather than deleting the test: without it, the cache path that ` +
        `silently merged two check-runs into one has no enforcement at all.`,
    );
  }
  return src.slice(src.indexOf('\n', b) + 1, e);
}

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const row = (fp: string, ts: string) => ['2026-09-12T' + ts, 'success', 'minspec-sdd', fp].join('\\t');

/**
 * Drive the real emit block over a list of SHAs, with gh_retry stubbed to return the
 * canned rows for each. Repeating a SHA exercises the cache-HIT branch.
 */
function emit(shas: string[], rowsBySha: Record<string, string[]>): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-cache-'));
  const caseStmts = Object.entries(rowsBySha)
    .map(([sha, rows]) => `    ${sha}) printf '%s\\n' $'${rows.join("' $'")}' ;;`)
    .join('\n');
  const script = [
    'set -uo pipefail',
    `SHACACHE="${dir}"`,
    'ERRS="$(mktemp)"',
    'REPO=owner/repo',
    // Stub: emit canned rows for the SHA, matching what the real jq pipeline produces.
    'gh_retry() {',
    // ${*##pat} strips the pattern from EACH positional parameter and rejoins, so it
    // cannot be used to pull one field out of an argv. Scan for the arg that is the URL.
    '  local a sha=""',
    '  for a in "$@"; do',
    '    case "$a" in *"/commits/"*) sha="${a##*/commits/}"; sha="${sha%%/check-runs*}" ;; esac',
    '  done',
    '  case "$sha" in',
    caseStmts,
    '    *) : ;;',
    '  esac',
    '}',
    `printf '%s\\n' ${shas.join(' ')} |`,
    'while read -r sha; do',
    emitBlock(),
    'done | sort -u',
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf-8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return out.split('\n').filter((l) => l.length > 0);
}

describe('per-SHA fetch/cache emit path', () => {
  it('keeps records separate across a CACHE HIT', () => {
    // sha1 twice: the second read comes from the cache. If the cache is written
    // without a trailing newline, sha2's row is appended to sha1's and sort -u
    // yields 2 lines instead of 3.
    const lines = emit(['sha1', 'sha1', 'sha2'], {
      sha1: [row(FP_A, '01:00:00Z')],
      sha2: [row(FP_B, '02:00:00Z')],
    });
    expect(lines).toHaveLength(2); // sort -u collapses the duplicate sha1 read
    for (const l of lines) {
      expect(l.split('\t')).toHaveLength(4);
      expect(l).toMatch(/^2026-09-12T\d\d:\d\d:\d\dZ\tsuccess\tminspec-sdd\t[0-9a-f]{64}$/);
    }
  });

  it('keeps every field intact when a cached multi-row SHA is followed by another', () => {
    const lines = emit(['sha1', 'sha1', 'sha2'], {
      sha1: [row(FP_A, '01:00:00Z'), row(FP_B, '02:00:00Z')],
      sha2: [row(FP_A, '03:00:00Z')],
    });
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l.split('\t')).toHaveLength(4);
      // A merged record shows up as a fingerprint field longer than 64 chars.
      expect(l.split('\t')[3]).toHaveLength(64);
    }
  });

  it('caches an empty result without emitting a blank record', () => {
    const lines = emit(['sha1', 'sha1', 'sha2'], { sha2: [row(FP_A, '01:00:00Z')] });
    expect(lines).toHaveLength(1);
  });
});
