/**
 * T0/T3 — remediate-pr.sh runaway-guard marker counting (#966).
 *
 * The two remediation budgets (MINSPEC_REMEDIATE_MAX_ATTEMPTS genuine attempts,
 * MINSPEC_REMEDIATE_MAX_CRASHES agent crashes) are counted from marker comments on the
 * PR. The original counter matched with jq `contains` over the WHOLE body and leaned on
 * the markers being pairwise non-substring — which does not prevent cross-counting at
 * all, because ONE body can independently contain TWO different markers:
 *
 *   • the success comment interpolates the agent-authored `.agent-summary.md` verbatim,
 *     and an agent remediating THIS script naturally quotes the crash marker;
 *   • `gh pr view --json comments` also returns the ai-review findings comments, and a
 *     reviewer quoting this file's diff reproduces all three markers at once.
 *
 * Measured consequences: genuine successes charged to the crash budget, and — worst —
 * a phantom CAPPED_MARKER suppressing the one-shot "capped, needs a human" notice, so
 * the PR was handed over with a label and NO message (a silent gate; constitution
 * invariant #2). The fix composes three layers, each asserted here:
 *   1. POSITION   — a marker counts only as the body's terminal text.
 *   2. SANITISE   — `<!--`/`-->` are neutralised in everything interpolated into a body.
 *   3. AUTHORSHIP — only comments written by this automation's own login are counted.
 * Plus the isolation gate itself, which used to wave two IDENTICAL markers through.
 *
 * Every assertion below runs the real script through its pure seams (`--count-markers`,
 * `--check-markers`, `--sanitize-body`, `--cap-notice-decision`) — no gh/git/claude —
 * mirroring the `--classify` convention of remediate-pr-classify.test.ts. Behaviour is
 * asserted by EXECUTING those seams; the only assertions against the source text are the
 * two structural ones at the foot of the file, which state properties (single emitter,
 * no second call site) that have no runtime observable without a live `gh`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/remediate-pr.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf-8');

const ATTEMPT = '<!-- minspec-auto-remediation -->';
const CRASH = '<!-- minspec-remediate-crash -->';
const CAPPED = '<!-- minspec-remediate-capped -->';

// The constants above must BE the script's constants, or every test below is theatre.
function markersInSource(): string[] {
  return ['ATTEMPT_MARKER', 'CRASH_MARKER', 'CAPPED_MARKER'].map((name) => {
    const m = new RegExp(`^${name}="([^"]+)"`, 'm').exec(SRC);
    if (!m) throw new Error(`${name} not found in remediate-pr.sh`);
    return m[1];
  });
}

type Comment = { author?: { login?: string }; body?: string };

function countMarkers(marker: string, comments: Comment[] | string, authors?: string): string {
  const args = [SCRIPT, '--count-markers', marker];
  if (authors !== undefined) args.push(authors);
  return execFileSync('bash', args, {
    encoding: 'utf-8',
    input: typeof comments === 'string' ? comments : JSON.stringify({ comments }),
  }).trim();
}

// stderr is captured too, and it MATTERS: this script exits 1 for any unrecognised
// first argument, so "exit code 1" alone cannot tell a gate REJECTING its input from a
// build that never had the gate. Tests below assert the distinguishing message.
function run(args: string[], input?: string): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf-8', input: input ?? '' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// The success comment as the script assembles it: sanitised body, marker on its own
// final line. `summary` stands in for the agent-authored `.agent-summary.md`.
function successBody(summary: string): string {
  const sanitised = run(['--sanitize-body'], summary).stdout;
  return `## 🤖 Auto-remediation — fixed the failing CI checks\n\n${sanitised}\n\n— pushed \`abc1234\` to \`fix/966\`.\n${ATTEMPT}`;
}

describe('remediate-pr.sh --count-markers: a QUOTED marker never spends another budget', () => {
  it('a genuine attempt whose summary discusses the crash marker is charged to attempts only', () => {
    // The exact #965/#966 scenario: an agent remediating remediate-pr.sh itself writes a
    // summary that names CRASH_MARKER. Whole-body `contains` charged this to BOTH caps.
    const comments: Comment[] = [
      {
        author: { login: 'drain-operator' },
        body: successBody(`Renamed the crash marker.\n\nBefore: \`CRASH_MARKER="${CRASH}"\`\nAfter: unchanged.`),
      },
    ];
    expect(countMarkers(ATTEMPT, comments, 'drain-operator')).toBe('1');
    expect(countMarkers(CRASH, comments, 'drain-operator')).toBe('0');
    expect(countMarkers(CAPPED, comments, 'drain-operator')).toBe('0');
  });

  it('two such successes spend 2 attempts and 0 crashes (the caps stay independent)', () => {
    const comments: Comment[] = [
      { author: { login: 'drain-operator' }, body: successBody(`quoting ${CRASH} and ${CAPPED}`) },
      { author: { login: 'drain-operator' }, body: successBody(`quoting ${CRASH} again`) },
    ];
    expect(countMarkers(ATTEMPT, comments, 'drain-operator')).toBe('2');
    expect(countMarkers(CRASH, comments, 'drain-operator')).toBe('0');
  });

  it('a marker in the MIDDLE of a body is not counted, even unsanitised', () => {
    const comments: Comment[] = [
      { author: { login: 'drain-operator' }, body: `prelude ${CRASH} postlude — no terminal marker` },
    ];
    expect(countMarkers(CRASH, comments, 'drain-operator')).toBe('0');
  });

  it('counts a real marker comment despite trailing whitespace/newlines', () => {
    const comments: Comment[] = [{ author: { login: 'drain-operator' }, body: `crashed.\n${CRASH}\n\n  \n` }];
    expect(countMarkers(CRASH, comments, 'drain-operator')).toBe('1');
  });

  it('still counts the legacy inline-suffix form (comments posted before this fix)', () => {
    const comments: Comment[] = [{ author: { login: 'drain-operator' }, body: `Left for a human. ${ATTEMPT}` }];
    expect(countMarkers(ATTEMPT, comments, 'drain-operator')).toBe('1');
  });
});

describe('remediate-pr.sh --count-markers: only this automation authors a budget', () => {
  const reviewerQuotingTheDiff: Comment = {
    // An ai-review findings comment quoting this very file's marker block — the second
    // confirmed cross-count vector. It ENDS with a marker, so position alone is not
    // enough; authorship is what makes it unreachable.
    author: { login: 'minspec-sdd[bot]' },
    body: `Findings on the diff:\n\n\`\`\`\n${ATTEMPT}\n${CRASH}\n${CAPPED}\n\`\`\`\n${CAPPED}`,
  };

  it('a reviewer-bot comment quoting the markers is charged to nothing', () => {
    const comments = [reviewerQuotingTheDiff];
    expect(countMarkers(ATTEMPT, comments, 'drain-operator')).toBe('0');
    expect(countMarkers(CRASH, comments, 'drain-operator')).toBe('0');
    expect(countMarkers(CAPPED, comments, 'drain-operator')).toBe('0');
  });

  it('a human comment ending with a marker is charged to nothing', () => {
    const comments: Comment[] = [{ author: { login: 'some-human' }, body: `looks like ${ATTEMPT}` }];
    expect(countMarkers(ATTEMPT, comments, 'drain-operator')).toBe('0');
  });

  it('accepts any login in the CSV allowlist (multi-operator drain)', () => {
    const comments: Comment[] = [{ author: { login: 'second-operator' }, body: `x\n${ATTEMPT}` }];
    expect(countMarkers(ATTEMPT, comments, 'drain-operator')).toBe('0');
    expect(countMarkers(ATTEMPT, comments, 'drain-operator,second-operator')).toBe('1');
  });

  it('trims each CSV element — a space after the comma must not silently un-bound the loop', () => {
    // MINSPEC_REMEDIATE_AUTHOR_LOGINS is hand-written, and `op, second` is at least as
    // natural as `op,second`. Untrimmed, the second element was " second" — matching no
    // GitHub login — so that operator's OWN attempt comments counted zero, spent no
    // budget, and the cap never tripped. UNDER-counting is the un-bounding direction.
    const comments: Comment[] = [{ author: { login: 'second-operator' }, body: `x\n${ATTEMPT}` }];
    expect(countMarkers(ATTEMPT, comments, 'drain-operator, second-operator')).toBe('1');
    expect(countMarkers(ATTEMPT, comments, ' second-operator ')).toBe('1');
    expect(countMarkers(ATTEMPT, comments, 'drain-operator ,\tsecond-operator\t')).toBe('1');
  });

  it('trimming widens nothing — a login that is merely a padded PREFIX still counts 0', () => {
    // The trim must not degenerate into loose matching: only whole logins are accepted.
    const comments: Comment[] = [{ author: { login: 'second-operator' }, body: `x\n${ATTEMPT}` }];
    expect(countMarkers(ATTEMPT, comments, ' second ')).toBe('0');
    expect(countMarkers(ATTEMPT, comments, 'drain-operator, third-operator')).toBe('0');
  });

  it('matches logins CASE-INSENSITIVELY, in both directions', () => {
    // GitHub logins are case-insensitive, so `minspec-sdd[bot]` in the env var and
    // `MinSpec-SDD[bot]` on the comment are the SAME account. Comparing them exactly
    // counted zero — the same un-bounding under-count as the untrimmed CSV above, and
    // reachable without anyone making a mistake: the casing comes from whatever wrote
    // the comment, not from the operator.
    const comments: Comment[] = [{ author: { login: 'MinSpec-SDD[bot]' }, body: `x\n${ATTEMPT}` }];
    expect(countMarkers(ATTEMPT, comments, 'minspec-sdd[bot]')).toBe('1');
    expect(countMarkers(ATTEMPT, comments, 'MINSPEC-SDD[BOT]')).toBe('1');
    expect(countMarkers(ATTEMPT, comments, 'minspec-sdd[bot], SECOND-Operator')).toBe('1');
    // Still whole-login, still not loose: a different account does not match.
    expect(countMarkers(ATTEMPT, comments, 'minspec-sdd')).toBe('0');
  });

  it('an allowlist of only whitespace/commas names NOBODY and degrades to any-author', () => {
    // `" , "` is a non-empty STRING that survives `[[ -n … ]]` but lists no login. It
    // must be treated as unresolvable authorship, not as a working filter.
    const comments: Comment[] = [{ author: { login: 'some-human' }, body: `x\n${ATTEMPT}` }];
    expect(countMarkers(ATTEMPT, comments, ' , ')).toBe('1');
  });

  it('an EMPTY allowlist degrades to any-author — the over-counting (caps sooner) direction', () => {
    // Deliberate: an unresolvable login must never silently un-bound the loop. The
    // script emits a visible NOTE on this path and refuses to dedup the cap notice.
    const comments = [reviewerQuotingTheDiff];
    expect(countMarkers(ATTEMPT, comments, '')).toBe('0'); // position layer still holds
    expect(countMarkers(CAPPED, comments, '')).toBe('1'); // terminal marker, foreign author
  });
});

describe('remediate-pr.sh --count-markers: fail-soft (a broken read must not un-bound the loop)', () => {
  it('malformed JSON yields 0 and exits 0', () => {
    const r = run(['--count-markers', ATTEMPT, 'drain-operator'], 'not json at all');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('0');
  });

  it('the empty-comments fallback the script uses on a gh failure yields 0', () => {
    expect(countMarkers(ATTEMPT, '{"comments":[]}', 'drain-operator')).toBe('0');
  });

  it('a comment with no author/body does not crash the count', () => {
    expect(countMarkers(ATTEMPT, [{}, { body: `x\n${ATTEMPT}` }], '')).toBe('1');
  });

  it('rejects a wrong arg count with a usage error', () => {
    expect(run(['--count-markers'], '{}').code).toBe(2);
    expect(run(['--count-markers', 'a', 'b', 'c'], '{}').code).toBe(2);
  });
});

describe('remediate-pr.sh --check-markers: the isolation gate compares by POSITION', () => {
  // Each rejection asserts the GATE'S OWN message, not merely a non-zero exit. The
  // script exits 1 on any unrecognised first argument, so `code === 1` alone is also
  // what a build with NO marker gate produces — an assertion that would pass against
  // the very absence it is meant to forbid.
  const COLLISION = /is identical to or a substring of marker #\d+ .* — counters would cross-count\./;
  const EMPTY = /marker #\d+ is empty — it would match every comment\./;

  it('rejects two IDENTICAL markers (the degenerate maximal-collision case)', () => {
    // Regression: the gate tested `[[ $a != $b ]]` FIRST, so identical markers — the
    // likeliest rename accident — passed the very check meant to catch them.
    const pair = run(['--check-markers', ATTEMPT, ATTEMPT]);
    expect(pair.code).toBe(1);
    expect(pair.stderr).toMatch(COLLISION);
    const triple = run(['--check-markers', ATTEMPT, CRASH, CRASH]);
    expect(triple.code).toBe(1);
    expect(triple.stderr).toMatch(COLLISION);
  });

  it('rejects a nested marker in either order', () => {
    const forward = run(['--check-markers', '<!-- a -->', '<!-- a --><!-- b -->']);
    expect(forward.code).toBe(1);
    expect(forward.stderr).toMatch(COLLISION);
    const reverse = run(['--check-markers', '<!-- a --><!-- b -->', '<!-- a -->']);
    expect(reverse.code).toBe(1);
    expect(reverse.stderr).toMatch(COLLISION);
  });

  it('rejects an empty marker (it would match every comment)', () => {
    const r = run(['--check-markers', '', ATTEMPT]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(EMPTY);
    // …and specifically NOT as a generic unknown-argument rejection.
    expect(r.stderr).not.toMatch(/Unknown arg/);
  });

  it('accepts the three markers the script actually ships', () => {
    const r = run(['--check-markers', ...markersInSource()]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('needs at least two markers to compare', () => {
    const r = run(['--check-markers', ATTEMPT]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Usage: remediate-pr\.sh --check-markers/);
  });
});

describe('remediate-pr.sh --cap-notice-decision: the "capped — needs a human" notice never goes silent', () => {
  // Constitution invariant #2 (no silent gate) hangs on THIS decision, so it is a pure
  // seam and every case below EXECUTES it. `post`/`skip` is the whole contract:
  // over-counting CAPPED_MARKER is the one place the unsafe direction is silence.
  const decide = (comments: Comment[], authors?: string): string => {
    const args = ['--cap-notice-decision'];
    if (authors !== undefined) args.push(authors);
    const r = run(args, JSON.stringify({ comments }));
    expect(r.code).toBe(0);
    return r.stdout.trim();
  };

  const ourNotice: Comment = { author: { login: 'drain-operator' }, body: `## 🛑 capped\n${CAPPED}` };
  // A phantom: an ai-review comment quoting this file, ending with the capped marker.
  const phantomNotice: Comment = { author: { login: 'minspec-sdd[bot]' }, body: `quoting the diff:\n${CAPPED}` };

  it('authorship provable + our notice already posted → skip (dedup, no per-sweep spam)', () => {
    expect(decide([ourNotice], 'drain-operator')).toBe('skip');
  });

  it('authorship provable + notice not yet posted → post', () => {
    expect(decide([], 'drain-operator')).toBe('post');
    expect(decide([{ author: { login: 'drain-operator' }, body: `x\n${ATTEMPT}` }], 'drain-operator')).toBe('post');
  });

  it('authorship provable + only a PHANTOM notice → post (a foreign marker suppresses nothing)', () => {
    expect(decide([phantomNotice], 'drain-operator')).toBe('post');
  });

  it('authorship NOT provable → always post, even when our own notice exists (never dedup)', () => {
    // The degraded path: `gh api user` failed and no override was configured. Counting
    // would run any-author, so a phantom would suppress the notice forever — a label
    // and no message. A repeated notice is noise; a missing one is a silent gate.
    expect(decide([ourNotice], '')).toBe('post');
    expect(decide([phantomNotice], '')).toBe('post');
    expect(decide([ourNotice, phantomNotice], '')).toBe('post');
    expect(decide([ourNotice])).toBe('post'); // allowlist argument omitted entirely
  });

  it('an allowlist naming NOBODY is unprovable authorship, not a working filter → post', () => {
    // `" , "` passes `[[ -n … ]]` but survives the trim as zero logins.
    expect(decide([ourNotice], ' , ')).toBe('post');
    expect(decide([ourNotice], '   ')).toBe('post');
  });

  it('rejects a wrong arg count with a usage error', () => {
    const r = run(['--cap-notice-decision', 'a', 'b'], '{"comments":[]}');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Usage: remediate-pr\.sh --cap-notice-decision/);
  });

  it('fail-soft: malformed comment JSON still posts rather than suppressing', () => {
    const r = run(['--cap-notice-decision', 'drain-operator'], 'not json at all');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('post');
  });
});

describe('remediate-pr.sh --cap-hit-summary: the capped notice cannot say something false', () => {
  // The clause this seam returns is interpolated verbatim into the "capped — needs a
  // human" comment. It used to be an if/elif that could only ever name ONE cap, followed
  // by a STATIC sentence asserting "only the cap named here is exhausted" — false
  // whenever both budgets were at their limit, and actively harmful: the maintainer
  // raises MINSPEC_REMEDIATE_MAX_ATTEMPTS to unblock the PR, the next sweep caps on
  // crashes, and the PR bounces straight back. Nothing covered CAP_HIT selection or the
  // notice body at all. Every state is now executed.
  const summary = (a: number, maxA: number, c: number, maxC: number) =>
    run(['--cap-hit-summary', String(a), String(maxA), String(c), String(maxC)]).stdout.trim();

  it('says nothing when neither budget is exhausted', () => {
    expect(summary(0, 2, 0, 2)).toBe('');
    expect(summary(1, 2, 1, 2)).toBe(''); // the boundary: both one short
  });

  it('names the attempts cap alone, and says the OTHER budget is not exhausted', () => {
    const s = summary(2, 2, 1, 2);
    expect(s).toContain('MINSPEC_REMEDIATE_MAX_ATTEMPTS');
    expect(s).not.toContain('MINSPEC_REMEDIATE_MAX_CRASHES');
    expect(s).toContain('the other budget is NOT exhausted');
    expect(s).not.toContain('BOTH');
  });

  it('names the crashes cap alone when only crashes tripped — not silently attempts', () => {
    const s = summary(0, 2, 2, 2);
    expect(s).toContain('MINSPEC_REMEDIATE_MAX_CRASHES');
    expect(s).not.toContain('MINSPEC_REMEDIATE_MAX_ATTEMPTS');
    expect(s).toContain('the other budget is NOT exhausted');
  });

  it('names BOTH caps when both are exhausted, and never claims the other one is fine', () => {
    // The defect this whole seam exists for.
    const s = summary(2, 2, 2, 2);
    expect(s).toContain('MINSPEC_REMEDIATE_MAX_ATTEMPTS');
    expect(s).toContain('MINSPEC_REMEDIATE_MAX_CRASHES');
    expect(s).toContain('BOTH budgets are exhausted');
    expect(s).not.toContain('the other budget is NOT exhausted');
  });

  it('handles counts ABOVE the cap (a cap lowered under an in-flight PR)', () => {
    const s = summary(3, 2, 5, 2);
    expect(s).toContain('3 automated remediation attempt(s)');
    expect(s).toContain('5 agent crash(es)');
    expect(s).toContain('BOTH budgets are exhausted');
  });

  it('rejects the wrong number of arguments with its own usage line, not a silent default', () => {
    const r = run(['--cap-hit-summary', '1', '2', '3']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Usage: remediate-pr\.sh --cap-hit-summary/);
    expect(r.stderr).not.toMatch(/Unknown arg/);
  });
});

describe('remediate-pr.sh --sanitize-body: interpolated text cannot carry a marker', () => {
  it('neutralises every marker an agent summary could quote', () => {
    const out = run(['--sanitize-body'], `I changed ${ATTEMPT}, ${CRASH} and ${CAPPED}.`).stdout;
    // Assert the seam RAN first: `not.toContain` alone is satisfied by empty output, so
    // without this the whole test would pass against a build that has no sanitiser.
    expect(out).toContain('I changed');
    for (const m of [ATTEMPT, CRASH, CAPPED]) expect(out).not.toContain(m);
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('-->');
  });

  it('keeps the text readable — nothing is truncated', () => {
    const out = run(['--sanitize-body'], `I changed ${CRASH}.`).stdout;
    expect(out).toContain('I changed');
    expect(out).toContain('minspec-remediate-crash');
  });

  it('leaves ordinary markdown alone', () => {
    const body = '## Fix\n\n- root cause: `foo()` returned null\n- see #966';
    expect(run(['--sanitize-body'], body).stdout.trim()).toBe(body);
  });
});

describe('remediate-pr.sh: the guard is structural, not a comment (enforce, do not trust)', () => {
  it('every marker is emitted through the single sanitising post_marked_comment seam', () => {
    // One `gh pr comment` invocation in the whole file, and it lives in the function
    // that sanitises the body and appends the marker last. If a future edit posts a
    // marker directly again, the terminal-position property silently stops holding.
    expect(SRC.match(/gh pr comment/g) ?? []).toHaveLength(1);
    const fn = /post_marked_comment\(\) \{([\s\S]*?)\n\}/.exec(SRC);
    expect(fn, 'post_marked_comment() must exist').not.toBeNull();
    expect(fn![1]).toContain('gh pr comment');
    expect(fn![1]).toContain('sanitize_comment_body');
    expect(fn![1]).toContain('${marker}');
  });

  it('no marker is interpolated into a comment body by any other call site', () => {
    // Any `_MARKER"` inside a `--body` argument would be a second, unsanitised emitter.
    expect(SRC).not.toMatch(/--body[^\n]*_MARKER/);
  });
});
