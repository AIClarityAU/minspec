/**
 * #2298 (mechanism B), T3: the claim lease's renewal and release really reach GitHub,
 * and a renewal that fails is reported instead of swallowed.
 *
 * WHAT BROKE. `lease_renew` and `lease_release` each carried a private copy of the
 * comments-endpoint parse, and both copies walked `.[][]` over UNSLURPED
 * `gh api --paginate` output. Without `-s` the second `[]` iterates a comment object's
 * field VALUES, and `.body` on the first of them (the `url` string) aborts jq with
 * exit 5. So a renewal never found its claim id and returned 1 before any PATCH, on
 * every tick, and a release deleted nothing. Only `lease_read_claims` slurped. The
 * renew ticker then discarded the failure (`>/dev/null 2>&1 || true`), so every claim
 * lapsed at LEASE_TTL_SECS (240s) with nothing in the log, and the creator-shepherd
 * read `holds=no` and stood down (36 of 37 polls).
 *
 * WHY NO EARLIER TEST SAW IT. The lease suites feed `classify_claim` claims JSON that is
 * already parsed (issue-lease-classify, issue-lease-reclaim, claim-lease-parity), and
 * the one test that reaches `lease_renew` stubs it out (the ticker smoke test in
 * shepherd-decide). No test executed either parse. These tests run the REAL functions
 * against a stateful fake `gh` serving the REST shape GitHub returns, across the page
 * axis: one merged array (what gh 2.100 prints for --paginate, measured on a three-page
 * read of #2221), two pages of two, and one comment per page.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { GH_BOT_STUB_ENV } from './helpers/gh-bot-env';

const LEASE = path.resolve(__dirname, '../../../scripts/lib/issue-lease.sh');
const REPO = 'fixture-org/fixture-repo';
const ITEM = 2221;
const SID = 'sid-4242-1759252430'; // production shape: sid-<pid>-<pid start time>
const OTHER_SID = 'sid-3131-1759240000';
const HOST = os.hostname();
const NOW = Math.floor(Date.now() / 1000);

function iso(offsetSec: number): string {
  return new Date((NOW + offsetSec) * 1000).toISOString().replace(/\.\d+Z$/, '.000Z');
}

/** Comment ids in server order. The own claim sits on page 2 when pages hold two. */
const IDS = { triage: 5906221070, staleForeign: 5906300001, own: 5916101678, later: 5916383183 };

/**
 * This session's claim: its owner is ALIVE (this test runner's pid, this host) but its
 * heartbeat is 300s old, past the 240s TTL. That is the #2298 state: the claim lapsed
 * only because no renewal was ever written.
 */
const OWN_CLAIMED_AT = iso(-300);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RestComment {
  url: string;
  id: number;
  body: string;
  [field: string]: unknown;
}

/**
 * A stateful fake `gh`. Serves one issue's comments from $FAKE_GH_STATE, applies
 * PATCH / DELETE to that file, and records every call in $FAKE_GH_LOG: each argv field
 * ends in \x1f and each call ends in \x1e, because a claim body spans lines.
 */
const FAKE_GH = String.raw`#!/usr/bin/env bash
{ printf '%s\x1f' "$@"; printf '\x1e'; } >> "$FAKE_GH_LOG"
[[ "${'$'}{1:-}" == api ]] || { echo "fake gh: unexpected call: $*" >&2; exit 97; }
shift
method=GET; path=""; body=""
while (( $# )); do
  case "$1" in
    --paginate) ;;
    -X) method="$2"; shift ;;
    -f) [[ "$2" == body=* ]] && body="${'$'}{2#body=}"; shift ;;
    -*) echo "fake gh: unexpected flag: $1" >&2; exit 97 ;;
    *) path="$1" ;;
  esac
  shift
done
comments="repos/${'$'}{FAKE_GH_REPO}/issues/${'$'}{FAKE_GH_ITEM}/comments"
one="repos/${'$'}{FAKE_GH_REPO}/issues/comments/"
exists() { jq -e --argjson id "$1" 'any(.[]; .id == $id)' "$FAKE_GH_STATE" >/dev/null; }
rewrite() { local t; t="$(mktemp "${'$'}{FAKE_GH_STATE}.XXXXXX")" && jq "$@" "$FAKE_GH_STATE" > "$t" && mv "$t" "$FAKE_GH_STATE"; }
case "$method $path" in
  "GET $comments")
    # FAKE_GH_PAGE_SIZE=0: ONE merged array, which is what gh 2.100 prints for --paginate.
    # N>0: one array per N comments, concatenated with no separator, which is what older
    # gh printed and what lease_read_claims' own comment describes.
    jq -j --argjson n "${'$'}{FAKE_GH_PAGE_SIZE:-0}" '
      if $n <= 0 or length == 0 then tojson
      else [range(0; length; $n) as $i | .[$i:$i + $n] | tojson] | join("") end' "$FAKE_GH_STATE" ;;
  "PATCH $one"*)
    id="${'$'}{path#"$one"}"
    exists "$id" || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    rewrite --argjson id "$id" --arg b "$body" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      'map(if .id == $id then .body = $b | .updated_at = $t else . end)'
    jq -c --argjson id "$id" '.[] | select(.id == $id)' "$FAKE_GH_STATE" ;;
  "DELETE $one"*)
    id="${'$'}{path#"$one"}"
    exists "$id" || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    rewrite --argjson id "$id" 'map(select(.id != $id))' ;;
  *) echo "fake gh: unexpected call: $method $path" >&2; exit 97 ;;
esac
`;

let dir = '';

function baseEnv(): Record<string, string> {
  // Hermetic: built from scratch so no ambient GH_TOKEN, session id or bot-token stamp
  // can change which path gh-bot.sh takes.
  return {
    PATH: `${path.join(dir, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: dir,
    MINSPEC_LEASE_REPO: REPO,
    MINSPEC_LEASE_SID: SID,
    MINSPEC_LEASE_WORKTREE_BASE: path.join(dir, 'agent'),
    FAKE_GH_STATE: path.join(dir, 'comments.json'),
    FAKE_GH_LOG: path.join(dir, 'gh-calls.log'),
    FAKE_GH_REPO: REPO,
    FAKE_GH_ITEM: String(ITEM),
    FAKE_GH_PAGE_SIZE: '0',
    ...GH_BOT_STUB_ENV,
  };
}

/** Run a bash snippet with issue-lease.sh sourced. `$1`, `$2` ... are `args`. */
function run(script: string, env: Record<string, string> = {}, args: string[] = []): Run {
  const r = spawnSync('bash', ['-c', `source ${JSON.stringify(LEASE)}\n${script}`, 'lease-test', ...args], {
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...baseEnv(), ...env },
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A claim body produced by the REAL writer, so the fixture cannot drift from what lease_acquire posts. */
function claimBody(sid: string, host: string, pid: number, claimedAt: string, lastRenewed: string): string {
  const r = run('lease_claim_body "$1" "$2" "$3" "$4" "$5" "$6"', {}, [
    sid,
    host,
    `/tmp/minspec-agent/issue-${ITEM}-${sid}`,
    String(pid),
    claimedAt,
    lastRenewed,
  ]);
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

/** A comment in the shape the REST API returns it, field order included: `url` first. */
function restComment(id: number, body: string, createdAt: string, login: string): RestComment {
  const bot = login.endsWith('[bot]');
  return {
    url: `https://api.github.com/repos/${REPO}/issues/comments/${id}`,
    html_url: `https://github.com/${REPO}/issues/${ITEM}#issuecomment-${id}`,
    issue_url: `https://api.github.com/repos/${REPO}/issues/${ITEM}`,
    id,
    node_id: `IC_kwDOfixture${id}`,
    user: { login, id: bot ? 263718419 : 1790427, type: bot ? 'Bot' : 'User', site_admin: false },
    created_at: createdAt.replace('.000Z', 'Z'),
    updated_at: createdAt.replace('.000Z', 'Z'),
    body,
    author_association: bot ? 'NONE' : 'OWNER',
    reactions: {
      url: `https://api.github.com/repos/${REPO}/issues/comments/${id}/reactions`,
      total_count: 0,
      '+1': 0,
      '-1': 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    performed_via_github_app: null,
  };
}

let OWN_BODY = '';
let STALE_FOREIGN_BODY = '';

function fixture(): RestComment[] {
  return [
    restComment(IDS.triage, 'Triage: `agent-ready` (T1). Dispatching.', iso(-3600), 'minspec-sdd[bot]'),
    // A claim an earlier dispatch left behind because its release never ran (#2298).
    restComment(IDS.staleForeign, STALE_FOREIGN_BODY, iso(-7200), 'minspec-sdd[bot]'),
    restComment(IDS.own, OWN_BODY, OWN_CLAIMED_AT, 'minspec-sdd[bot]'),
    restComment(IDS.later, 'Opened PR #2293 for this issue.', iso(-60), 'harvest316'),
  ];
}

function state(): RestComment[] {
  return JSON.parse(fs.readFileSync(path.join(dir, 'comments.json'), 'utf-8'));
}

function commentById(id: number): RestComment {
  const c = state().find((x) => x.id === id);
  if (!c) throw new Error(`comment ${id} is not in the fake's state`);
  return c;
}

function claimOf(body: string): Record<string, unknown> {
  const m = /<!-- minspec-claim:(\{.*?\}) -->/s.exec(body);
  if (!m) throw new Error(`no claim marker in: ${body}`);
  return JSON.parse(m[1]);
}

/** Every call the fake gh received, as argv arrays. */
function calls(): string[][] {
  const log = path.join(dir, 'gh-calls.log');
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, 'utf-8')
    .split('\x1e')
    .filter((rec) => rec.length > 0)
    .map((rec) => rec.split('\x1f').slice(0, -1));
}

/** The WRITE calls only, as [method, path]. */
function writes(): Array<[string, string]> {
  return calls()
    .map((argv): [string, string] => {
      const x = argv.indexOf('-X');
      return [x >= 0 ? argv[x + 1] : 'GET', argv.find((a) => a.startsWith('repos/')) ?? ''];
    })
    .filter(([method]) => method !== 'GET');
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-renew-bodies-'));
  OWN_BODY = claimBody(SID, HOST, process.pid, OWN_CLAIMED_AT, OWN_CLAIMED_AT);
  STALE_FOREIGN_BODY = claimBody(OTHER_SID, 'builder-2', 7777, iso(-7200), iso(-7200));
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-renew-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'gh'), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify(fixture()));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const PAGE_SHAPES: ReadonlyArray<[string, number, number]> = [
  // [label, FAKE_GH_PAGE_SIZE, top-level JSON values gh prints]
  ['one merged array (what gh 2.100 prints, measured)', 0, 1],
  ['two pages of two, own claim on page 2', 2, 2],
  ['one comment per page', 1, 4],
];

describe.each(PAGE_SHAPES)('lease renew / release against real paginated output: %s', (_label, pageSize, pages) => {
  const env = { FAKE_GH_PAGE_SIZE: String(pageSize) };

  it('the fixture really varies the page axis, and every comment leads with a string field', () => {
    // Guards against a vacuous axis: if the fake stopped splitting pages, the three
    // shapes would silently collapse into one.
    const out = spawnSync(path.join(dir, 'bin', 'gh'), ['api', '--paginate', `repos/${REPO}/issues/${ITEM}/comments`], {
      encoding: 'utf-8',
      env: { ...baseEnv(), ...env },
    });
    expect(out.status, out.stderr).toBe(0);
    const tops = spawnSync('jq', ['-c', 'length'], { input: out.stdout, encoding: 'utf-8' });
    expect(tops.stdout.trim().split('\n')).toHaveLength(pages);
    // The unslurped `.[][]` walked each comment's values; `.body` on the leading `url`
    // string is the exact jq error the bug produced.
    for (const c of fixture()) expect(typeof Object.values(c)[0]).toBe('string');
  });

  it("lease_renew PATCHes this session's claim, keeps claimedAt, and the lapsed claim is held again", () => {
    const t0 = Date.now();
    // One process for all three steps: the renewal stamps this shell's pid into the
    // claim, and a same-host claim is live only while that pid is.
    const r = run(
      [
        `lease_verify_holds ${ITEM} && echo before=held || echo before=lapsed`,
        `lease_renew ${ITEM}; echo renew=$?`,
        `lease_verify_holds ${ITEM} && echo after=held || echo after=lapsed`,
      ].join('\n'),
      env,
    );
    expect(r.stdout, 'precondition: the unrenewed claim is past its TTL').toContain('before=lapsed');
    expect(r.stdout, `lease_renew must succeed\n${r.stderr}`).toContain('renew=0');
    expect(writes()).toEqual([['PATCH', `repos/${REPO}/issues/comments/${IDS.own}`]]);

    const renewed = claimOf(commentById(IDS.own).body);
    expect(renewed.sessionId).toBe(SID);
    expect(renewed.claimedAt, 'claimedAt is preserved; only the heartbeat moves').toBe(OWN_CLAIMED_AT);
    expect(Date.parse(String(renewed.lastRenewed)), 'the heartbeat advanced to now').toBeGreaterThanOrEqual(t0 - 1000);
    expect(r.stdout, 'the outcome: after a renewal this session holds its claim again').toContain('after=held');

    expect(commentById(IDS.staleForeign).body, "another session's claim is never edited").toBe(STALE_FOREIGN_BODY);
  });

  it("lease_release DELETEs this session's claim and nothing else", () => {
    const r = run(`lease_release ${ITEM}; echo release=$?`, env);
    expect(r.stdout, r.stderr).toContain('release=0');
    expect(writes()).toEqual([['DELETE', `repos/${REPO}/issues/comments/${IDS.own}`]]);
    expect(state().map((c) => c.id)).toEqual([IDS.triage, IDS.staleForeign, IDS.later]);
  });
});

describe('issue-lease.sh reads the claims in ONE place (the gate #2298 lacked)', () => {
  // Three private copies of one parse is how two of them came to disagree with the
  // third. The behavioural tests above cover renew and release; this keeps a NEW
  // function from growing a fourth copy that no behavioural test would reach.
  const code = fs
    .readFileSync(LEASE, 'utf-8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line));
  const paginated = code.filter((line) => line.includes('gh api --paginate'));

  it('is wired to the real reader, not an empty match', () => {
    expect(paginated.length).toBeGreaterThan(0);
  });

  it('pages the comments endpoint exactly once, inside lease_read_claims, and slurps it', () => {
    expect(paginated, 'route every comments read through lease_read_claims').toHaveLength(1);
    const start = code.findIndex((line) => line.startsWith('lease_read_claims() {'));
    const end = code.findIndex((line, i) => i > start && line === '}');
    const body = code.slice(start, end).join('\n');
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('gh api --paginate');
    expect(body, 'gh --paginate emits one array per page; only a slurp sees them all').toMatch(/jq -s\b/);
  });
});

describe('lease renew ticker: a failed renewal is reported, never swallowed (constitution invariant 2)', () => {
  const FAILED = /^lease: renewal of the claim on #2221 FAILED \(exit (\d+)\)/gm;

  /**
   * Start a 0.1s ticker, wait until `until` holds (or 10s pass), run `beforeStop` with the
   * ticker still up, then tear it down.
   */
  function tick(
    setup: string,
    until: string,
    env: Record<string, string> = {},
    beforeStop = '',
  ): { run: Run; err: string } {
    const errFile = path.join(dir, 'ticker.err');
    const r = run(
      [
        'ERR="$1"; SCRATCH="$2"',
        'LEASE_RENEW_SECS=0.1',
        setup,
        `lease_start_renew_ticker ${ITEM} >/dev/null 2>"$ERR"`,
        `for _ in $(seq 1 100); do ${until} && break; sleep 0.1; done`,
        'kill -0 "$_LEASE_TICKER_PID" 2>/dev/null && echo ticker=alive',
        beforeStop,
        'lease_stop_renew_ticker',
        'sleep 0.3',
      ].join('\n'),
      env,
      [errFile, path.join(dir, 'scratch')],
    );
    return { run: r, err: fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf-8') : '' };
  }
  const twoReports = 'n=$(grep -c "FAILED" "$ERR" 2>/dev/null); (( ${n:-0} >= 2 ))';

  it('a renewal that returns non-zero is reported on stderr, on every tick, and the ticker keeps going', () => {
    const { run: r, err } = tick('lease_renew() { return 1; }', twoReports);
    expect([...err.matchAll(FAILED)].length, err).toBeGreaterThanOrEqual(2);
    expect(r.stdout).toContain('ticker=alive');
  });

  it('a renewal that EXITS (gh_bot_die: no bot token for the PATCH) is reported and does not kill the ticker', () => {
    // The real lease_renew, reaching its PATCH: the claim is found, then the bot wrapper
    // cannot mint a token and calls gh_bot_die, which is `exit 1`, not `return 1`. Run in
    // the ticker's own shell, that exit ended the ticker for the rest of the build.
    const { run: r, err } = tick('', twoReports, {
      FAKE_GH_PAGE_SIZE: '2',
      MINSPEC_GH_APP_TOKEN_SCRIPT: path.join(dir, 'no-such-token-script'),
    });
    const codes = [...err.matchAll(FAILED)].map((m) => m[1]);
    expect(codes.length, err).toBeGreaterThanOrEqual(2);
    expect(new Set(codes), 'every report carries the exit status of gh_bot_die').toEqual(new Set(['1']));
    expect(r.stdout, 'the ticker survives a renewal that exits').toContain('ticker=alive');
    expect(writes(), 'the refused write never reached GitHub').toEqual([]);
  });

  // The two no-false-alarm cases assert "no FAILED report", not "empty stderr": at
  // teardown the ticker's own shell prints bash's `Terminated` for the child that
  // lease_stop_renew_ticker kills. That line predates this change (68 of them in the
  // drain log on 2026-10-01, one per dispatch) and is not a renewal report.
  it('a successful renewal reports nothing', () => {
    const { err } = tick(
      'lease_renew() { echo tick >> "$SCRATCH"; }',
      'n=$(wc -l < "$SCRATCH" 2>/dev/null); (( ${n:-0} >= 3 ))',
    );
    expect(fs.readFileSync(path.join(dir, 'scratch'), 'utf-8').split('\n').length).toBeGreaterThan(3);
    expect(err).not.toMatch(/FAILED/);
  });

  it('a renewal reaped by SIGTERM, as lease_stop_renew_ticker reaps one in flight, is not reported', () => {
    // The stop kills the ticker's CHILDREN first, then the ticker, so a renewal in flight
    // at teardown dies of SIGTERM (exit 143) while the ticker is still alive to see it.
    // That is the designed stop, not a failed heartbeat. Whether the ticker reaches its
    // report before its own SIGTERM lands is a race the kill usually wins (measured 3 of
    // 3), which would let a full stop pass here with or without the rule. So kill only
    // the in-flight renewal, exactly as the stop's first step does, and give the ticker
    // time to report before tearing it down.
    const { run: r, err } = tick(
      'lease_renew() { : > "$SCRATCH"; sleep 3; }',
      '[[ -e "$SCRATCH" ]]',
      {},
      [
        'pkill -P "$_LEASE_TICKER_PID"',
        'sleep 0.5',
        'kill -0 "$_LEASE_TICKER_PID" 2>/dev/null && echo ticker=survived-the-reap',
      ].join('\n'),
    );
    expect(fs.existsSync(path.join(dir, 'scratch')), 'precondition: a renewal was in flight').toBe(true);
    expect(r.stdout).toContain('ticker=survived-the-reap');
    expect(err).not.toMatch(/FAILED/);
  });
});
