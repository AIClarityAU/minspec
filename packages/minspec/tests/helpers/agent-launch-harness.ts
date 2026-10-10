/**
 * agent-launch-harness.ts - run the REAL launchers up to, and through, the moment they
 * start an agent, and record what that agent was handed.
 *
 * WHY IT EXISTS. Two properties of a dispatched agent were asserted in comments and
 * checked nowhere a child process could be seen: what is in its environment, and whose
 * text is in its prompt. The one test near the first (agent-context-slim.test.ts) matches
 * launcher SOURCE TEXT, so it stays green whatever the child receives. This harness looks
 * at the child instead.
 *
 * WHAT IS REAL. scripts/triage-inbox.sh and scripts/dispatch-issue.sh run unmodified, top
 * to bottom, with their real libraries and the real readiness gate. For the dispatcher
 * that includes the claim, the worktree and the launch line with its `timeout` in front.
 * The fix agent's launch (shepherd_fix) is the real function, run out of the script the
 * way dispatch-outcome-status.test.ts runs the status and claim blocks, because reaching
 * it for real needs a push, a pull request and a failing merge gate.
 *
 * WHAT IS A STUB. `gh` and `claude`, on PATH. `gh` serves the fixture, keeps the comments
 * a run posts (so a claim can be read back, which is what lets the real claim be WON
 * here), and notes each write with whether the launcher still held a token for it.
 * `claude` records the environment it was started with, its arguments and its directory.
 *
 * NOTHING HERE CAN REACH GITHUB OR THIS CHECKOUT. The dispatcher pins its git operations
 * to the repository its own script directory sits in, so it is run from a throwaway
 * repository whose `scripts` is a link to the real one and whose `origin` is a bare
 * repository beside it. The token is the committed stub's. Every "secret" below is a
 * fixture value that says so: the tests need the NAME of a credential, never one.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { GH_BOT_STUB_ENV } from './gh-bot-env';

export const ROOT = path.resolve(__dirname, '../../../..');
export const SCRIPTS = path.join(ROOT, 'scripts');
export const TRIAGE = path.join(SCRIPTS, 'triage-inbox.sh');
export const DISPATCH = path.join(SCRIPTS, 'dispatch-issue.sh');
export const READY_CHECK = path.join(SCRIPTS, 'dispatch-ready-check.sh');
export const AUTHOR_GATE_LIB = path.join(SCRIPTS, 'lib', 'dispatch-author-gate.sh');
export const LAUNCH_ENV = path.join(SCRIPTS, 'lib', 'agent-context.sh');

/** A value that is plainly not a credential and matches no secret scanner's shape. */
export const FIXTURE_VALUE = 'fixture-value-not-a-credential';

/**
 * An account as GitHub's GraphQL API names one: its kind, a login to print, and the number
 * GitHub gave it once and never reuses. The gate decides on the kind and the number.
 */
export interface Actor {
  __typename: string;
  login: string;
  databaseId?: unknown;
}

export const user = (login: string, databaseId: number): Actor => ({ __typename: 'User', login, databaseId });
export const bot = (login: string, databaseId: number): Actor => ({ __typename: 'Bot', login, databaseId });

/** The two accounts on the list in scripts/lib/dispatch-author-gate.sh. Public numbers, not secrets. */
export const FOUNDER = user('harvest316', 4125483);
export const APP = bot('minspec-sdd', 299695933);
export const TRUSTED: Actor[] = [FOUNDER, APP];

/** Accounts that are not on it. The numbers of the first three are made up. */
export const STRANGER = user('some-stranger', 900000001);
export const COLLABORATOR = user('outside-collab', 900000002);
export const MEMBER = user('new-member', 900000003);
/** GitHub's own Actions App, by its real number: refused like any other unlisted account. */
export const ACTIONS_APP = bot('github-actions', 41898282);

/** What a name must not look like to reach an agent. The contract's own pattern. */
export const CREDENTIAL_SHAPE = /(_API_KEY|_TOKEN|_SECRET)$/;

/** Names that must be absent whatever their shape: the token, its twin, and its stamp. */
export const NAMED_CREDENTIALS = ['GH_TOKEN', 'GITHUB_TOKEN', 'MINSPEC_GH_BOT_TOKEN_STAMP'];

export function withFixtureValues(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, FIXTURE_VALUE]));
}

/** One start of the stub `claude`, exactly as the launcher handed it over. */
export interface Launch {
  env: Record<string, string>;
  names: string[];
  argv: string[];
  /** The prompt: the argument after `-p`, or what arrived on stdin when there was none. */
  prompt: string;
  cwd: string;
  /** Was there a file at the launch helper's own relative path in the directory it started in? */
  helperCopyInCwd: boolean;
}

/** What the stubs recorded, whoever ran the launcher. */
export interface Recorded {
  launches: Launch[];
  /** Every `--help` capability probe of the CLI. Only its environment is meaningful. */
  probes: Launch[];
  /** Every `gh` call, first three words. */
  ghCalls: string[];
  /** The `--json` field list of every `gh issue view`, in order. */
  issueViewFields: string[];
  /** Every `gh` WRITE, as `<noun> <verb> token=present|absent`. */
  ghWrites: string[];
  /** The body of every comment the run posted. */
  posted: string[];
  dir: string;
}

export interface Run extends Recorded {
  status: number | null;
  stdout: string;
  stderr: string;
  /** stdout then stderr. */
  out: string;
}

const created: string[] = [];

/** Remove every directory this harness made. Call from afterEach. */
export function cleanupLaunchHarness(): void {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function scratch(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function writeStubs(dir: string, agentOut: string): string {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-out.txt'), agentOut);

  // `claude`. Shell builtins only, and its directory is written into it rather than read
  // from the environment: an environment the launcher has cut down to an allowlist has
  // neither a helper variable nor, necessarily, a PATH to find `env` with.
  //
  // A `--help` start is a capability probe (the reviewers ask the CLI whether it has
  // --json-schema before they will review). It is recorded apart, as probe.N, and
  // answered with the flag: a stub that did not advertise it would make every reviewer
  // refuse before its real launch, and the probe would be the only thing ever observed.
  //
  // With no prompt after `-p` the real CLI reads its prompt from stdin, and so does this:
  // the reviewers hand their prompt over that way. launch-fail.N, when a test wrote one,
  // makes start N fail with that text on stderr, which is how a quota outage is staged.
  // agent-act.sh, when a test wrote one, is what the agent does in its worktree (see
  // agent-worktree-harness.ts).
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env bash
dir='${dir}'
for a in "$@"; do
  if [[ "$a" == "--help" ]]; then
    n=0
    while [[ -e "$dir/probe.$n.env" ]]; do n=$((n + 1)); done
    while IFS= read -r -d '' kv; do printf '%s\\0' "$kv"; done < "/proc/$$/environ" > "$dir/probe.$n.env"
    echo "  --json-schema <schema>"
    exit 0
  fi
done
n=0
while [[ -e "$dir/launch.$n.env" ]]; do n=$((n + 1)); done
while IFS= read -r -d '' kv; do printf '%s\\0' "$kv"; done < "/proc/$$/environ" > "$dir/launch.$n.env"
printf '%s\\0' "$@" > "$dir/launch.$n.argv"
printf '%s' "$PWD" > "$dir/launch.$n.cwd"
[[ -e scripts/lib/agent-context.sh ]] && : > "$dir/launch.$n.helper-copy-in-cwd"
prev=""; prompted=no
for a in "$@"; do
  [[ "$prev" == "-p" && "$a" != -* ]] && prompted=yes
  prev="$a"
done
if [[ "$prompted" == no ]]; then
  text=""
  IFS= read -r -d '' -t 20 text || true
  printf '%s' "$text" > "$dir/launch.$n.stdin"
fi
if [[ -e "$dir/launch-fail.$n" ]]; then
  printf '%s\\n' "$(<"$dir/launch-fail.$n")" >&2
  exit 1
fi
# What the agent DID while it ran, when a test wrote one: agent-act.sh is run where the
# agent was started, with the environment the agent was given and the start number.
if [[ -x "$dir/agent-act.sh" ]]; then
  "$dir/agent-act.sh" "$n" >> "$dir/agent-act.log" 2>&1 || echo "agent-act.sh failed: $?" >> "$dir/agent-act.log"
fi
printf '%s\\n' "$(<"$dir/agent-out.txt")"
exit 0
`,
    { mode: 0o755 },
  );

  // `gh`. Answers an identity probe the way GitHub answers an installation token (403, no
  // user), honours --jq, serves one list per label, and keeps the comments posted on each
  // issue so they can be listed back. Anything it was not taught is empty and succeeds.
  //
  // `api graphql` is the read the author gate makes: who wrote an issue's text
  // (provenance.<N>.json), who wrote a pull request's comments (pr-comments.json), and
  // which account wrote the comments with given ids (comment-nodes.json, a map from id to
  // the comment as GitHub holds it; an id it does not have comes back null). It is
  // answered the way GitHub answers it: not at all without a credential, which is what
  // makes a launcher that forgot to present one refuse here as it would for real. A
  // fixture that is missing, or one marked `.fail`, is a failed read. So is the Nth read
  // of comment-nodes.json when `comment-nodes.json.fail-at` holds N, which is how a read
  // that fails part-way through a long list of comments is staged. It is logged as
  // `api graphql issue:<N>`, `pullRequest:<N>` or `nodes`, and a mutation is noted as a
  // write.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
set -u
dir='${dir}'
noun="\${1:-}"; verb="\${2:-}"; third="\${3:-}"
jqexpr=""; body=""; label=""; thread="\${3:-}"; prev=""; number=""; query=""; fields=""
for a in "$@"; do
  [[ "$prev" == "--jq" || "$prev" == "-q" ]] && jqexpr="$a"
  [[ "$prev" == "--json" ]] && fields="$a"
  [[ "$prev" == "--body" ]] && body="$a"
  [[ "$prev" == "--label" ]] && label="$a"
  [[ "$a" =~ /issues/([0-9]+)/comments ]] && thread="\${BASH_REMATCH[1]}"
  [[ "$a" == number=* ]] && number="\${a#number=}"
  [[ "$a" == query=* ]] && query="\${a#query=}"
  prev="$a"
done
answer=""
if [[ "$noun $verb" == "api graphql" ]]; then
  case "$query" in
    *"nodes(ids:"*) third="nodes"; answer="$dir/comment-nodes.json" ;;
    *"pullRequest("*) third="pullRequest:$number"; answer="$dir/pr-comments.json" ;;
    *"issue("*) third="issue:$number"; answer="$dir/provenance.$number.json" ;;
    *) third="unrecognised" ;;
  esac
fi
printf '%s %s %s\\n' "$noun" "$verb" "$third" >> "$dir/gh-calls.log"
emit() { if [[ -n "$jqexpr" ]]; then jq -r "$jqexpr"; else cat; fi; }
token=absent; [[ -n "\${GH_TOKEN:-}" ]] && token=present
wrote() { printf '%s token=%s\\n' "$1" "$token" >> "$dir/gh-writes.log"; }
case "$noun $verb" in
  "api user")
    echo '{"message":"Resource not accessible by integration","status":"403"}'
    exit 1 ;;
  "api graphql")
    [[ "$query" == mutation* ]] && wrote "api graphql-mutation"
    # A query it was not taught is empty and succeeds, like everything else here.
    if [[ -n "$answer" ]]; then
      if [[ "$token" == absent ]]; then
        echo "stub gh: GraphQL answers nobody anonymous, and no credential was presented" >&2
        exit 1
      fi
      if [[ ! -f "$answer" || -e "$answer.fail" ]]; then
        echo "stub gh: no answer for $third" >&2
        exit 1
      fi
      if [[ "$third" == nodes && -f "$answer.fail-at" ]]; then
        printf 'read\\n' >> "$dir/nodes-reads.log"
        if [[ "$(wc -l < "$dir/nodes-reads.log" | tr -d ' ')" == "$(<"$answer.fail-at")" ]]; then
          echo "stub gh: HTTP 502 on read $(<"$answer.fail-at") of $third" >&2
          exit 1
        fi
      fi
      if [[ "$third" == nodes ]]; then
        # A test that wants an answer no map of comments gives (an error document) wrote
        # it out whole.
        if [[ -f "$dir/comment-nodes.raw.json" ]]; then emit < "$dir/comment-nodes.raw.json"; exit 0; fi
        ids="$(printf '%s' "$query" | sed -E 's/.*nodes\\(ids: *(\\[[^]]*\\]).*/\\1/')"
        printf '%s\\n' "$ids" >> "$dir/nodes-asked.log"
        jq -c --argjson ids "$ids" '. as $all | {data: {nodes: [$ids[] | $all[.] // null]}}' "$answer" | emit
        exit 0
      fi
      emit < "$answer"
    fi ;;
  "issue view")
    [[ -f "$dir/issue.\${3:-}.json" ]] || { echo "stub gh: no fixture for issue \${3:-}" >&2; exit 1; }
    printf '%s\\n' "$fields" >> "$dir/issue-views.log"
    # Only the fields that were asked for, as the real command returns.
    jq -c --arg f "$fields" '. as $d | if $f == "" then . else reduce ($f | split(",")[]) as $k ({}; if ($d | has($k)) then .[$k] = $d[$k] else . end) end' "$dir/issue.\${3:-}.json" | emit ;;
  "issue list")
    [[ -f "$dir/issue-list.$label.json" ]] && emit < "$dir/issue-list.$label.json" ;;
  "pr view") emit < "$dir/pr.json" ;;
  "pr diff") [[ -f "$dir/pr.diff" ]] && cat "$dir/pr.diff" ;;
  "pr checks") [[ -f "$dir/pr-checks.txt" ]] && cat "$dir/pr-checks.txt" ;;
  "issue comment"|"pr comment")
    n=0; [[ -f "$dir/comments.$thread.jsonl" ]] && n=$(wc -l < "$dir/comments.$thread.jsonl")
    jq -n -c --argjson id "$((n + 1000))" --arg b "$body" '{id: $id, body: $b}' >> "$dir/comments.$thread.jsonl"
    wrote "$noun $verb" ;;
  "issue edit"|"label create"|"pr create"|"pr edit"|"pr merge"|"pr review")
    wrote "$noun $verb" ;;
  "api "*)
    if [[ " $* " == *" -X DELETE "* || " $* " == *" -X PATCH "* ]]; then
      wrote "api write"
    elif [[ "$*" == *"/comments"* ]]; then
      if [[ -f "$dir/comments.$thread.jsonl" ]]; then jq -s -c . "$dir/comments.$thread.jsonl"; else echo '[]'; fi
    fi ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return bin;
}

function lines(file: string): string[] {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) : [];
}

/**
 * The auto-maintenance pins vitest.setup.ts sets (#1532), for an environment built from
 * scratch. Without them a fixture's git call can leave a detached repack still writing
 * under `.git` when the fixture directory is removed (#2627).
 */
function gitConfigPins(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(e[0]) && e[1] !== undefined,
    ),
  );
}

function readEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const kv of fs.readFileSync(file, 'utf-8').split('\0').filter(Boolean)) {
    const eq = kv.indexOf('=');
    if (eq > 0) env[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return env;
}

function readLaunches(dir: string): Launch[] {
  const launches: Launch[] = [];
  for (let n = 0; fs.existsSync(path.join(dir, `launch.${n}.env`)); n++) {
    const env = readEnv(path.join(dir, `launch.${n}.env`));
    const argv = fs.readFileSync(path.join(dir, `launch.${n}.argv`), 'utf-8').split('\0');
    argv.pop(); // every argument is NUL-terminated, so the last piece is empty
    const p = argv.indexOf('-p');
    const stdin = path.join(dir, `launch.${n}.stdin`);
    launches.push({
      env,
      names: Object.keys(env).sort(),
      argv,
      // With no prompt after `-p` the launcher handed it over on stdin.
      prompt: fs.existsSync(stdin) ? fs.readFileSync(stdin, 'utf-8') : p >= 0 ? (argv[p + 1] ?? '') : '',
      cwd: fs.readFileSync(path.join(dir, `launch.${n}.cwd`), 'utf-8'),
      helperCopyInCwd: fs.existsSync(path.join(dir, `launch.${n}.helper-copy-in-cwd`)),
    });
  }
  return launches;
}

/** The environment of each `--help` probe, in the order they were made. */
function readProbes(dir: string): Launch[] {
  const probes: Launch[] = [];
  for (let n = 0; fs.existsSync(path.join(dir, `probe.${n}.env`)); n++) {
    const env = readEnv(path.join(dir, `probe.${n}.env`));
    probes.push({ env, names: Object.keys(env).sort(), argv: ['-p', '--help'], prompt: '', cwd: '', helperCopyInCwd: false });
  }
  return probes;
}

function recorded(dir: string): Recorded {
  const posted = fs
    .readdirSync(dir)
    .filter((f) => /^comments\..*\.jsonl$/.test(f))
    .sort()
    .flatMap((f) => lines(path.join(dir, f)))
    .map((l) => (JSON.parse(l) as { body: string }).body);
  return {
    launches: readLaunches(dir),
    probes: readProbes(dir),
    ghCalls: lines(path.join(dir, 'gh-calls.log')),
    issueViewFields: lines(path.join(dir, 'issue-views.log')),
    ghWrites: lines(path.join(dir, 'gh-writes.log')),
    posted,
    dir,
  };
}

function collect(dir: string, r: { status: number | null; stdout: string | null; stderr: string | null }): Run {
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  return { status: r.status, stdout, stderr, out: `${stdout}${stderr}`, ...recorded(dir) };
}

/** Names present in a launch that no agent may hold. Empty is the pass. */
export function credentialNames(launch: Launch): string[] {
  return launch.names.filter((n) => NAMED_CREDENTIALS.includes(n) || CREDENTIAL_SHAPE.test(n));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

export interface CommentFixture {
  /** Who wrote it. Written as given, so it can be null or an account with no number. */
  author: unknown;
  association?: string;
  body: string;
  /** Everyone who has edited it since, oldest first. Default: nobody. */
  editors?: unknown[];
  /** Change the comment as GitHub would return it, for an answer no real comment has. */
  node?: (node: Record<string, unknown>) => unknown;
}

export interface IssueFixture {
  /**
   * Who opened the issue. Default: the founder. Written as given, so a fixture can be
   * null (a deleted account), a string, or an account with no number.
   */
  author?: unknown;
  /** Everyone who has edited the body since it was opened, oldest first. Default: nobody. */
  bodyEditors?: unknown[];
  /** Everyone who has changed the title, oldest first. Default: nobody. */
  titleChangers?: unknown[];
  /**
   * Change what GitHub answers about who wrote the issue, after it is built from the
   * fields above: for an answer no real issue has (a history cut short, a field missing),
   * and for one whose text is not the text `gh issue view` returned.
   */
  provenance?: (issue: Record<string, unknown>) => unknown;
  /** Serve this as the whole answer instead: not JSON, two documents, an error. */
  provenanceRaw?: string;
  /** The read of who wrote it fails. */
  provenanceFails?: boolean;
  title?: string;
  body?: string;
  labels?: string[];
  state?: string;
  comments?: CommentFixture[];
  /** Attach the verdict record that makes the issue dispatchable. Default true. */
  ready?: boolean;
  /** The read of which account wrote the issue's comments fails. */
  commentAuthorsFail?: boolean;
}

const TITLE = 'Typo in a log line';
export const ISSUE_BODY_MARKER = 'ISSUE-BODY-MARKER-7f3a';
const BODY = `One-word fix in a log line. ${ISSUE_BODY_MARKER}`;
const WHEN = '2026-10-01T00:00:00Z';

const loginOf = (a: unknown): string =>
  typeof a === 'object' && a !== null && typeof (a as Actor).login === 'string' ? (a as Actor).login : 'ghost';

/**
 * GitHub's answer to the gate's question about one issue (dispatch_issue_provenance_query),
 * in the shape the API returned when it was read for real on 2026-10-10: an issue nobody
 * has edited has no editor, no edit time and an empty history, and one that has been
 * edited has a history that begins with its creation.
 */
export function provenanceAnswer(f: IssueFixture = {}, number = 4242): string {
  if (f.provenanceRaw !== undefined) return f.provenanceRaw;
  const author = f.author === undefined ? FOUNDER : f.author;
  const editors = f.bodyEditors ?? [];
  const edited = editors.length > 0;
  const changers = f.titleChangers ?? [];
  const built: Record<string, unknown> = {
    number,
    title: f.title ?? TITLE,
    body: f.body ?? BODY,
    author,
    editor: edited ? editors[editors.length - 1] : null,
    lastEditedAt: edited ? WHEN : null,
    userContentEdits: {
      totalCount: edited ? editors.length + 1 : 0,
      nodes: edited ? [author, ...editors].map((editor) => ({ editedAt: WHEN, editor })) : [],
    },
    timelineItems: { totalCount: changers.length, nodes: changers.map((actor) => ({ actor })) },
  };
  return JSON.stringify({ data: { repository: { issue: f.provenance ? f.provenance(built) : built } } });
}

/**
 * GitHub's answer to the gate's question about a pull request's comments
 * (dispatch_pr_comments_query). `total` is how many GitHub says there are, when that is
 * more than it returned.
 */
export function commentsAnswer(comments: CommentFixture[], total?: number): string {
  const nodes = comments.map((c) => {
    const editors = c.editors ?? [];
    const edited = editors.length > 0;
    const built: Record<string, unknown> = {
      authorAssociation: c.association ?? 'NONE',
      body: c.body,
      createdAt: WHEN,
      author: c.author,
      editor: edited ? editors[editors.length - 1] : null,
      lastEditedAt: edited ? WHEN : null,
      userContentEdits: {
        totalCount: edited ? editors.length + 1 : 0,
        nodes: edited ? [c.author, ...editors].map((editor) => ({ editor })) : [],
      },
    };
    return c.node ? c.node(built) : built;
  });
  return JSON.stringify({
    data: { repository: { pullRequest: { comments: { totalCount: total ?? nodes.length, nodes } } } },
  });
}

/**
 * Put one issue on the stub GitHub: what `gh issue view` returns, who wrote it, and which
 * account wrote each of its comments (asked for by the comment's id).
 */
function serveIssue(dir: string, n: string, f: IssueFixture, forDispatch: boolean): void {
  const comments = issueComments(f, forDispatch, n);
  fs.writeFileSync(path.join(dir, `issue.${n}.json`), issueJson(f, forDispatch, comments));
  fs.writeFileSync(path.join(dir, `provenance.${n}.json`), provenanceAnswer(f, Number(n)));
  if (f.provenanceFails) fs.writeFileSync(path.join(dir, `provenance.${n}.json.fail`), '');
  const file = path.join(dir, 'comment-nodes.json');
  const nodes: Record<string, unknown> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
  for (const c of comments) nodes[c.id] = { __typename: 'IssueComment', id: c.id, body: c.body, author: c.author };
  fs.writeFileSync(file, JSON.stringify(nodes));
  if (f.commentAuthorsFail) fs.writeFileSync(`${file}.fail`, '');
}

interface ServedComment {
  id: string;
  /** The account, as GitHub answers when asked who wrote the comment with this id. */
  author: unknown;
  association: string;
  body: string;
}

/** The verdict record that makes this issue's text dispatchable, as a comment body. */
export function readyRecordComment(f: IssueFixture = {}): string {
  return `**Triage:** agent-ready\n\n${verdictRecord(f.title ?? TITLE, f.body ?? BODY)}`;
}

/** An issue's comments, oldest first, each with the id `gh issue view` gives it. */
function issueComments(f: IssueFixture, forDispatch: boolean, n: string): ServedComment[] {
  const comments: ServedComment[] = (f.comments ?? []).map((c, i) => ({
    id: `IC_fixture_${n}_${i}`,
    author: c.author,
    association: c.association ?? 'NONE',
    body: c.body,
  }));
  if (forDispatch && f.ready !== false) {
    // The readiness gate's own App wrote the record.
    comments.unshift({ id: `IC_fixture_${n}_record`, author: APP, association: 'CONTRIBUTOR', body: readyRecordComment(f) });
  }
  return comments;
}

/** The verdict record triage would have written for this text, from the real renderer. */
function verdictRecord(title: string, body: string): string {
  return execFileSync('bash', [READY_CHECK, '--render-record', 'agent-ready', 'dev', 'T1', 'no', 'none'], {
    input: `# ${title}\n\n${body}`,
    encoding: 'utf-8',
  });
}

function issueJson(f: IssueFixture, forDispatch: boolean, served: ServedComment[]): string {
  const title = f.title ?? TITLE;
  const body = f.body ?? BODY;
  // As `gh issue view --json comments` prints them: an id, a login, an association. The
  // App appears under its bare login (`minspec-sdd`), and nothing here says which account
  // a login belongs to.
  const comments = served.map((c) => ({
    id: c.id,
    author: { login: loginOf(c.author) },
    authorAssociation: c.association,
    body: c.body,
  }));
  // Everything `gh issue view` could be asked for. The stub returns only the fields a
  // launcher names in `--json`, as the real one does, so `author` reaches a launcher that
  // asks for it and no other. It is the login-only rendering that command has: an App is
  // `app/<slug>`, and nothing in it says which account a login belongs to.
  const a = f.author === undefined ? FOUNDER : f.author;
  const isActor = typeof a === 'object' && a !== null && typeof (a as Actor).login === 'string';
  const viewAuthor = !isActor
    ? a
    : (a as Actor).__typename === 'Bot'
      ? { login: `app/${(a as Actor).login}`, is_bot: true }
      : { login: (a as Actor).login, is_bot: false };
  return JSON.stringify({
    author: viewAuthor,
    title,
    body,
    state: f.state ?? 'OPEN',
    labels: (f.labels ?? (forDispatch ? ['agent-ready', 'role:dev'] : ['inbox'])).map((name) => ({ name })),
    comments,
  });
}

const TRIAGE_VERDICT = [
  'TRIAGE_VERDICT_BEGIN',
  'decision: agent-ready',
  'role: dev',
  'tier: T1',
  'human_only: no',
  'rationale: trivial',
  'TRIAGE_VERDICT_END',
].join('\n');

// ── scripts/triage-inbox.sh ──────────────────────────────────────────────────

export interface TriageOptions {
  /** The issues GitHub has, by number. */
  issues: Record<string, IssueFixture>;
  /** Triage this one issue (`triage-inbox.sh <N>`). Omit to triage the whole inbox. */
  only?: string;
  env?: Record<string, string>;
}

export function runTriage(opts: TriageOptions): Run {
  const dir = scratch('launch-triage-');
  const bin = writeStubs(dir, TRIAGE_VERDICT);
  for (const [n, f] of Object.entries(opts.issues)) serveIssue(dir, n, f, false);
  fs.writeFileSync(
    path.join(dir, 'issue-list.inbox.json'),
    JSON.stringify(Object.keys(opts.issues).map((n) => ({ number: Number(n) }))),
  );
  const r = spawnSync('bash', opts.only === undefined ? [TRIAGE] : [TRIAGE, opts.only], {
    encoding: 'utf-8',
    // Hermetic on purpose: the operator's own variables must not decide a result here.
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: dir, ...GH_BOT_STUB_ENV, ...opts.env },
  });
  return collect(dir, r);
}

// ── scripts/dispatch-issue.sh ────────────────────────────────────────────────

export const DISPATCH_ISSUE = '4242';
let sandboxes = 0;

/** A status constant, read from the script that owns it. */
export function dispatchStatus(name: 'DISPATCH_RC_DECLINED' | 'DISPATCH_RC_STARTED'): number {
  const m = fs.readFileSync(DISPATCH, 'utf-8').match(new RegExp(`^${name}=(\\d+)$`, 'm'));
  if (!m) throw new Error(`${name} not found in dispatch-issue.sh: fix this extractor, do not hard-code the number`);
  return Number(m[1]);
}

/** Somewhere the real dispatcher can run to completion without touching this checkout. */
export interface DispatchSandbox {
  dir: string;
  /** The environment a caller hands the dispatcher (or the drain that will run it). */
  env: Record<string, string>;
  /**
   * An executable that runs the real dispatcher for one issue, as the drain's own run
   * directory would: point MINSPEC_DRAIN_DISPATCH at it.
   */
  dispatcher: string;
  /** Where the agent's worktree for that issue would be. */
  worktree(issue: string): string;
  /** What the stubs have recorded so far. */
  recorded(): Recorded;
}

/**
 * Build a repository of its own for the dispatcher to work in, with these issues on its
 * stub GitHub. Nothing is run.
 *
 * The dispatcher pins every git operation to the repository its own script directory sits
 * in. Here that is a throwaway repository whose `scripts` is a link to the real one, so
 * the script and every library it sources are the shipped files, and its fetch, its
 * worktree and its branch land in the throwaway and its bare `origin`.
 */
export function dispatchSandbox(
  issues: Record<string, IssueFixture>,
  agentOut?: string,
  plantHelperCopy = false,
): DispatchSandbox {
  const dir = scratch('launch-dispatch-');
  const bin = writeStubs(dir, agentOut ?? 'ESCALATE: fixture stop, nothing to build');
  for (const [n, f] of Object.entries(issues)) serveIssue(dir, n, f, true);

  const repo = path.join(dir, 'repo');
  const origin = path.join(dir, 'origin.git');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(repo, '.minspec'), { recursive: true });
  fs.mkdirSync(home);
  const gitEnv = {
    ...process.env,
    HOME: home,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (...args: string[]) => execFileSync('git', args, { env: gitEnv, stdio: 'pipe' });
  git('init', '-q', '--bare', '-b', 'main', origin);
  git('-C', repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, '.minspec', 'config.json'), '{"version":1}\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  git('-C', repo, 'add', 'README.md', '.minspec/config.json');
  git('-C', repo, 'commit', '-q', '-m', 'fixture');
  git('-C', repo, 'remote', 'add', 'origin', origin);
  git('-C', repo, 'push', '-q', 'origin', 'main');
  fs.symlinkSync(SCRIPTS, path.join(repo, 'scripts'));

  if (plantHelperCopy) {
    // `origin/main` gains a file at the helper's own path that hands a command
    // everything. The agent's worktree is cut from `origin/main`, so that copy sits
    // exactly where a launch made with a relative path, after `cd` into the worktree,
    // would find it. Pushed from a clone of its own: this repository's `scripts` is the
    // link above and stays that way.
    const seed = path.join(dir, 'seed');
    git('clone', '-q', origin, seed);
    fs.mkdirSync(path.join(seed, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'scripts', 'lib', 'agent-context.sh'), PASS_THROUGH_HELPER, { mode: 0o755 });
    git('-C', seed, 'add', 'scripts/lib/agent-context.sh');
    git('-C', seed, 'commit', '-q', '-m', 'fixture: a copy of the helper an agent could have edited');
    git('-C', seed, 'push', '-q', 'origin', 'main');
  }

  // The session id names each worktree, so it is unique to this sandbox: nothing here
  // can meet a live drain's worktree for the same issue number.
  const sid = `launchtest-${process.pid}-${sandboxes++}-${Date.now().toString(36)}`;
  const worktree = (issue: string) => `/tmp/minspec-agent/issue-${issue}-${sid}`;
  for (const n of Object.keys(issues)) created.push(worktree(n));

  // MINSPEC_FRESHNESS_CHECKED is what the drain exports once its run directory is
  // verified. Without it the dispatcher fetches and compares against `origin/main`.
  const dispatcher = path.join(bin, 'dispatch-in-sandbox');
  fs.writeFileSync(
    dispatcher,
    `#!/usr/bin/env bash\nMINSPEC_FRESHNESS_CHECKED=1 exec bash '${path.join(repo, 'scripts', 'dispatch-issue.sh')}' "$@"\n`,
    { mode: 0o755 },
  );

  return {
    dir,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: home,
      MINSPEC_LEASE_SID: sid,
      // One launch per issue: an escalation is not retried on a second model.
      MINSPEC_ESCALATE_RETRY_OFF: '1',
      ...gitConfigPins(),
      ...GH_BOT_STUB_ENV,
    },
    dispatcher,
    worktree,
    recorded: () => recorded(dir),
  };
}

export interface DispatchOptions {
  issue: IssueFixture;
  /** Ask for the dispatcher's started/refused exit status, as the drain does. */
  ask?: boolean;
  env?: Record<string, string>;
  /** What the stub agent prints. Default: an escalation, which ends the run before any publish. */
  agentOut?: string;
  /** Put a hand-everything copy of the launch helper at its own path in the agent's worktree. */
  plantHelperCopy?: boolean;
}

export interface DispatchRun extends Run {
  /** Where the agent's worktree would be, and whether the run made it. */
  worktree: string;
  worktreeMade: boolean;
  /** The claim comments the run posted (SPEC-044 lease). */
  claims: string[];
}

/** Run the real dispatcher for one issue, in a sandbox of its own. */
export function runDispatch(opts: DispatchOptions): DispatchRun {
  const sb = dispatchSandbox({ [DISPATCH_ISSUE]: opts.issue }, opts.agentOut, opts.plantHelperCopy === true);
  const env: Record<string, string> = { ...sb.env, ...opts.env };
  if (opts.ask) env.MINSPEC_DISPATCH_OUTCOME_STATUS = '1';
  const r = spawnSync(sb.dispatcher, [DISPATCH_ISSUE], { encoding: 'utf-8', env });
  const run = collect(sb.dir, r);
  const worktree = sb.worktree(DISPATCH_ISSUE);
  return {
    ...run,
    worktree,
    worktreeMade: fs.existsSync(worktree),
    claims: run.posted.filter((b) => b.includes('minspec-claim')),
  };
}

/** Write the label queues the stub `gh` serves to a drain: which issues wear which label. */
export function serveQueues(sb: DispatchSandbox, queues: Record<string, string[]>): void {
  for (const [label, numbers] of Object.entries(queues)) {
    fs.writeFileSync(
      path.join(sb.dir, `issue-list.${label}.json`),
      JSON.stringify(numbers.map((n) => ({ number: Number(n) }))),
    );
  }
}

// ── shepherd_fix: the fix agent's launch ─────────────────────────────────────

export interface FixAgentOptions {
  /** The pull request's comments, oldest first. */
  comments: CommentFixture[];
  /** How many comments GitHub says the pull request has, when that is more than it returned. */
  total?: number;
  /** Serve this as the whole answer about the comments instead. */
  commentsRaw?: string;
  /** The read of who wrote the comments fails. */
  commentsUnreadable?: boolean;
  env?: Record<string, string>;
}

export interface FixAgentRun extends Run {
  /** What shepherd_fix itself returned. 1 is its answer when no commit came back. */
  fixReturned: number;
}

/** A REVIEW_VERDICT block carrying `marker`, the grammar shepherd_fix reads. */
export function reviewVerdict(marker: string): string {
  return ['REVIEW_VERDICT_BEGIN', 'verdict: changes', `finding: ${marker}`, 'REVIEW_VERDICT_END'].join('\n');
}

/**
 * Run the real shepherd_fix against a pull request with these comments.
 *
 * The function is taken out of dispatch-issue.sh as shipped. What it leans on is set up
 * by the script's OWN lines, also taken as shipped: every library it sources and, in a
 * version of the script that still makes it itself, the assignment that names the launch
 * program (it is made by lib/agent-context.sh now). Nothing about the fix is written
 * here, so this runs the same against the script before the change and after it.
 */
export function runFixAgent(opts: FixAgentOptions): FixAgentRun {
  const src = fs.readFileSync(DISPATCH, 'utf-8');
  const start = src.indexOf('\nshepherd_fix() {\n');
  const end = src.indexOf('\n}\n', start);
  if (start < 0 || end <= start) {
    throw new Error('shepherd_fix() not found in dispatch-issue.sh: fix this extractor rather than deleting the test');
  }
  const fn = src.slice(start + 1, end + 2);
  if (!/\bclaude -p\b/.test(fn)) throw new Error('shepherd_fix() no longer launches an agent: this harness is testing nothing');
  const setup = src
    .split('\n')
    .filter((l) => /^source "\$\{SCRIPT_DIR\}\/lib\/[a-z0-9-]+\.sh"$/.test(l) || /^AGENT_LAUNCH_ENV=/.test(l));

  const dir = scratch('launch-fix-');
  const bin = writeStubs(dir, 'ESCALATE: fixture stop, nothing to fix');
  // Both reads a fix agent's feedback could come from are served, with the same
  // comments: the query that says which ACCOUNT wrote each one, and `gh pr view`, which
  // gives a login and nothing else.
  if (opts.commentsRaw !== undefined) fs.writeFileSync(path.join(dir, 'pr-comments.json'), opts.commentsRaw);
  else if (!opts.commentsUnreadable) {
    fs.writeFileSync(path.join(dir, 'pr-comments.json'), commentsAnswer(opts.comments, opts.total));
  }
  fs.writeFileSync(
    path.join(dir, 'pr.json'),
    JSON.stringify({
      comments: opts.comments.map((c) => ({
        author: { login: loginOf(c.author) },
        authorAssociation: c.association ?? 'NONE',
        body: c.body,
      })),
    }),
  );
  // A linked worktree of a repository beside it, which is what the dispatcher gives an
  // agent: its git directory is outside it, under the repository's own.
  const repo = path.join(dir, 'repo');
  const worktree = path.join(dir, 'worktree');
  fs.mkdirSync(repo);
  const gitEnv = fixtureGitEnv(dir);
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { env: gitEnv, stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'fixture'], { env: gitEnv, stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'agent/issue-4242', worktree], { env: gitEnv, stdio: 'pipe' });

  const script = [
    'set -euo pipefail',
    `SCRIPT_DIR=${JSON.stringify(SCRIPTS)}`,
    'REPO="AIClarityAU/minspec"',
    'ISSUE=4242',
    `WORKTREE=${JSON.stringify(worktree)}`,
    `LOG=${JSON.stringify(path.join(dir, 'agent.log'))}`,
    'RUN_MODEL=sonnet',
    'ALLOWED_TOOLS="Read"',
    'SYS_PROMPT_ARGS=()',
    'SHEPHERD_ATTEMPT_MARKER="<!-- minspec-auto-remediation -->"',
    ...setup,
    'gh_bot_init',
    // The script pins its worktree straight after making it. This driver made the
    // worktree, so it does the pinning, when the script under test knows how to.
    'if declare -F agent_worktree_pin >/dev/null; then agent_worktree_pin "$WORKTREE"; fi',
    'shepherd_publish() { echo PUBLISHED; }',
    fn,
    // The function's own status is reported, never discarded: a stub brings back no
    // commit, and what the function returns for that is asserted by the caller.
    'fix_rc=0',
    'shepherd_fix 77 fix-ci || fix_rc=$?',
    'echo "SHEPHERD-FIX-RETURNED:$fix_rc"',
  ].join('\n');
  const file = path.join(dir, 'fix-agent.sh');
  fs.writeFileSync(file, script);
  const r = spawnSync('bash', [file], {
    encoding: 'utf-8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: dir, ...gitConfigPins(), ...GH_BOT_STUB_ENV, ...opts.env },
  });
  const run = collect(dir, r);
  const m = run.stdout.match(/^SHEPHERD-FIX-RETURNED:(\d+)$/m);
  // A driver that never reached the function, or died inside it, is not a result.
  if (!m) throw new Error(`shepherd_fix did not return (driver exit ${r.status}):\n${run.out}`);
  return { ...run, fixReturned: Number(m[1]) };
}

// ── The other launch sites ───────────────────────────────────────────────────

export const REVIEW_BRANCH = path.join(SCRIPTS, 'review-branch.sh');
export const REVIEW_PR = path.join(SCRIPTS, 'review-pr.sh');
export const REVIEW_APPROVABLE = path.join(SCRIPTS, 'review-approvable.sh');
export const REMEDIATE = path.join(SCRIPTS, 'remediate-pr.sh');
export const RADAR = path.join(SCRIPTS, 'tooling-radar', 'run-radar.sh');

/** What the CLI prints on stderr when the subscription is out of quota. */
export const QUOTA_STDERR = 'Claude AI usage limit reached. Your limit will reset at 3pm.';

/** A finished review, in the envelope `claude -p --output-format json` returns. */
const REVIEW_ENVELOPE = JSON.stringify({
  is_error: false,
  result: 'fixture review',
  structured_output: {
    verdict: 'changes',
    blocking: 1,
    summary: 'fixture',
    findings: [{ severity: 'blocking', location: 'a.txt:1', problem: 'fixture' }],
  },
});

function fixtureGitEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
}

/** The environment every site below is run with, before a test adds its own. */
function hermeticEnv(dir: string, bin: string, extra?: Record<string, string>): Record<string, string> {
  return { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: dir, ...gitConfigPins(), ...GH_BOT_STUB_ENV, ...extra };
}

/**
 * A stand-in for agent-context.sh that hands its command EVERYTHING: what a launcher
 * would run if the path to its helper could be pointed somewhere else. Tests offer it to
 * a launcher two ways (in the environment, and as the copy in an agent's worktree) and
 * assert that it is never the one that runs.
 */
export const PASS_THROUGH_HELPER = [
  '#!/usr/bin/env bash',
  'while [[ "${1:-}" == "--model-login" ]]; do shift 2; done',
  'case "${1:-}" in --report|--names) exit 0 ;; esac',
  'exec "$@"',
  '',
].join('\n');

export function passThroughHelper(): string {
  const file = path.join(scratch('launch-passthrough-'), 'agent-context.sh');
  fs.writeFileSync(file, PASS_THROUGH_HELPER, { mode: 0o755 });
  return file;
}

/**
 * A checkout in which the launch helper is not there: a git repository of its own whose
 * `scripts/` is a real COPY of the shipped one with that single file removed, and stubs
 * on PATH. For what each launcher does then. The shipped files are copied, never edited.
 */
export function checkoutWithoutLaunchHelper(): {
  root: string;
  scripts: string;
  env: Record<string, string>;
  recorded(): Recorded;
  /** Remove it. It outlives a single test on purpose, so cleanupLaunchHarness leaves it alone. */
  dispose(): void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-nohelper-'));
  const bin = writeStubs(dir, REVIEW_ENVELOPE);
  const root = path.join(dir, 'root');
  fs.mkdirSync(root);
  fs.cpSync(SCRIPTS, path.join(root, 'scripts'), {
    recursive: true,
    filter: (src) => !/\/(node_modules|__pycache__)(\/|$)/.test(src),
  });
  fs.rmSync(path.join(root, 'scripts', 'lib', 'agent-context.sh'));
  // The dispatcher refuses a root that is not a MinSpec repository.
  fs.mkdirSync(path.join(root, '.minspec'));
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), '{"version":1}\n');
  // The reviewers read their verdict schema from the guard beside scripts/.
  fs.mkdirSync(path.join(root, '.github', 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, '.github', 'scripts', 'ai-review-guard.js'),
    path.join(root, '.github', 'scripts', 'ai-review-guard.js'),
  );
  const gitEnv = fixtureGitEnv(dir);
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'main'], { env: gitEnv, stdio: 'pipe' });
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'fixture'], { env: gitEnv, stdio: 'pipe' });
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'fixture two'], { env: gitEnv, stdio: 'pipe' });
  serveIssue(dir, '4242', { author: FOUNDER }, true);
  fs.writeFileSync(path.join(dir, 'pr.json'), JSON.stringify({ title: 't', body: 'b', files: [], headRefName: 'fix/x', state: 'OPEN' }));
  return {
    root,
    scripts: path.join(root, 'scripts'),
    env: hermeticEnv(dir, bin, { MINSPEC_FRESHNESS_CHECKED: '1' }),
    recorded: () => recorded(dir),
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

export interface SiteOptions {
  env?: Record<string, string>;
  /**
   * Stage a subscription quota outage, so the reviewer goes on to its pay-as-you-go
   * failover: the first start fails with the CLI's limit notice and the second answers.
   */
  failover?: boolean;
}

function failoverEnv(dir: string, opts: SiteOptions): Record<string, string> {
  if (!opts.failover) return {};
  fs.writeFileSync(path.join(dir, 'launch-fail.0'), QUOTA_STDERR);
  return { AI_REVIEW_FAILOVER: 'payg', ANTHROPIC_API_KEY: FIXTURE_VALUE };
}

/** The real scripts/review-branch.sh, over a two-commit repository of its own. */
export function runReviewBranch(opts: SiteOptions = {}): Run {
  const dir = scratch('launch-review-branch-');
  const bin = writeStubs(dir, REVIEW_ENVELOPE);
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { env: fixtureGitEnv(dir), encoding: 'utf-8', stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'head');
  const head = git('rev-parse', 'HEAD').trim();
  const env = hermeticEnv(dir, bin, { ...failoverEnv(dir, opts), ...opts.env });
  const r = spawnSync('bash', [REVIEW_BRANCH, base, head, '--role', 'reviewer'], { cwd: repo, encoding: 'utf-8', env });
  return collect(dir, r);
}

/** The real scripts/review-approvable.sh, over one document, with no test seam set. */
export function runReviewApprovable(opts: SiteOptions = {}): Run {
  const dir = scratch('launch-review-approvable-');
  const bin = writeStubs(dir, REVIEW_ENVELOPE);
  const doc = path.join(dir, 'requirements.md');
  fs.writeFileSync(doc, '---\nid: SPEC-999\ntype: requirements\n---\n\n# A fixture spec\n\nFR-1: the fixture exists.\n');
  const env = hermeticEnv(dir, bin, { ...failoverEnv(dir, opts), ...opts.env });
  const r = spawnSync('bash', [REVIEW_APPROVABLE, doc], { cwd: dir, encoding: 'utf-8', env });
  return collect(dir, r);
}

/** The real scripts/review-pr.sh, for a pull request the stub `gh` serves. */
export function runReviewPr(opts: SiteOptions = {}): Run {
  const dir = scratch('launch-review-pr-');
  const bin = writeStubs(dir, REVIEW_ENVELOPE);
  fs.writeFileSync(
    path.join(dir, 'pr.json'),
    JSON.stringify({
      title: 'fixture: a one-line change',
      body: 'A fixture pull request.',
      files: [{ path: 'a.txt' }],
      headRefName: 'fix/launch-site-fixture',
      state: 'OPEN',
    }),
  );
  fs.writeFileSync(path.join(dir, 'pr.diff'), 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n one\n+two\n');
  const r = spawnSync('bash', [REVIEW_PR, '77', '--repo', 'AIClarityAU/minspec'], {
    cwd: dir,
    encoding: 'utf-8',
    env: hermeticEnv(dir, bin, opts.env),
  });
  return collect(dir, r);
}

let remediations = 0;

export interface RemediateRun extends Run {
  /** Where the agent's worktree was made (and removed again when the sweep ended). */
  worktree: string;
  /** The pull request's branch, and the bare repository it was pushed to. */
  branch: string;
  origin: string;
}

/** What a test can reach while the fixture is built, before the launcher is started. */
export interface RemediateFixture {
  /** The stubs' directory: what they serve is read from here and what they see is written here. */
  dir: string;
  /** The repository the launcher runs from, and the bare one it pushes to. */
  repo: string;
  origin: string;
  /** A clone, checked out on the pull request's branch and not yet pushed. */
  seed: string;
  branch: string;
  /** Where the launcher will make the agent's worktree. */
  worktree: string;
  git(...args: string[]): string;
}

export interface RemediateOptions extends SiteOptions {
  /** Fields that replace the pull request's own, as `gh pr view` serves them. */
  pr?: Record<string, unknown>;
  /**
   * The pull request's comments, oldest first. They are served both ways a launcher
   * could read them: with the account that wrote each, and as `gh pr view` gives them,
   * which is a login and nothing else.
   */
  comments?: CommentFixture[];
  /** What the stub agent prints. Default: an escalation, which ends the sweep before any push. */
  agentOut?: string;
  /** Change the fixture before the branch is pushed and the launcher is started. */
  prepare?(fixture: RemediateFixture): void;
}

/**
 * The real scripts/remediate-pr.sh, for a pull request with one failing check.
 *
 * It runs from a throwaway repository whose `scripts` is a link to the real one, as the
 * dispatcher's sandbox does. The pull request's branch is pushed to that repository's
 * bare `origin` from a clone of its own, and it carries a file at the helper's path that
 * hands a command everything: the agent's worktree is a checkout of that branch, so the
 * copy an agent could have edited is sitting right where a relative path would find it.
 */
export function runRemediate(opts: RemediateOptions = {}): RemediateRun {
  const dir = scratch('launch-remediate-');
  const bin = writeStubs(dir, opts.agentOut ?? 'ESCALATE: fixture stop, nothing to fix');
  const repo = path.join(dir, 'repo');
  const seed = path.join(dir, 'seed');
  const origin = path.join(dir, 'origin.git');
  const branch = 'fix/launch-site-fixture';
  const gitEnv = fixtureGitEnv(dir);
  const git = (...args: string[]) => execFileSync('git', args, { env: gitEnv, encoding: 'utf-8', stdio: 'pipe' });
  git('init', '-q', '--bare', '-b', 'main', origin);
  fs.mkdirSync(repo);
  git('-C', repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  git('-C', repo, 'add', 'README.md');
  git('-C', repo, 'commit', '-q', '-m', 'fixture');
  git('-C', repo, 'remote', 'add', 'origin', origin);
  git('-C', repo, 'push', '-q', 'origin', 'main');
  fs.symlinkSync(SCRIPTS, path.join(repo, 'scripts'));

  // The worktree's path is fixed by the script (/tmp/minspec-remediate/pr-<N>), so the
  // number is one no real pull request has and no other run of this harness shares.
  const pr = String(990_000_000 + (process.pid % 100_000) * 100 + (remediations++ % 100));
  const worktree = `/tmp/minspec-remediate/pr-${pr}`;
  created.push(worktree);

  git('clone', '-q', origin, seed);
  git('-C', seed, 'checkout', '-q', '-b', branch);
  fs.mkdirSync(path.join(seed, 'scripts', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'scripts', 'lib', 'agent-context.sh'), PASS_THROUGH_HELPER, { mode: 0o755 });
  git('-C', seed, 'add', 'scripts/lib/agent-context.sh');
  git('-C', seed, 'commit', '-q', '-m', 'fixture: the branch under remediation');
  opts.prepare?.({ dir, repo, origin, seed, branch, worktree, git });
  git('-C', seed, 'push', '-q', 'origin', branch);

  if (opts.comments) fs.writeFileSync(path.join(dir, 'pr-comments.json'), commentsAnswer(opts.comments));
  fs.writeFileSync(
    path.join(dir, 'pr.json'),
    JSON.stringify({
      number: Number(pr),
      state: 'OPEN',
      isDraft: false,
      headRefName: branch,
      headRepository: { name: 'minspec' },
      headRepositoryOwner: { login: 'AIClarityAU' },
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'BLOCKED',
      labels: [],
      title: 'fixture: a failing check',
      author: { login: 'app/minspec-sdd' },
      statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }],
      comments: (opts.comments ?? []).map((c) => ({
        author: { login: loginOf(c.author) },
        authorAssociation: c.association ?? 'NONE',
        body: c.body,
      })),
      ...opts.pr,
    }),
  );
  const r = spawnSync('bash', [path.join(repo, 'scripts', 'remediate-pr.sh'), pr, '--repo', 'AIClarityAU/minspec'], {
    cwd: repo,
    encoding: 'utf-8',
    // One launch: an escalation is not retried on a second model.
    env: hermeticEnv(dir, bin, { MINSPEC_ESCALATE_RETRY_OFF: '1', ...opts.env }),
  });
  return { ...collect(dir, r), worktree, branch, origin };
}

/**
 * The real scripts/tooling-radar/run-radar.sh, in dry-run, from a throwaway root.
 *
 * The stub agent's answer is not a scan, so the parse stage stops the run right after
 * the launch: the filing stage, which is the one that holds a credential, is never
 * reached, and `--dry-run` would file nothing if it were.
 */
export function runRadar(opts: SiteOptions = {}): Run {
  const dir = scratch('launch-radar-');
  const bin = writeStubs(dir, 'this is not the JSON a scan returns');
  const root = path.join(dir, 'root');
  fs.mkdirSync(root);
  fs.symlinkSync(SCRIPTS, path.join(root, 'scripts'));
  const r = spawnSync('bash', [path.join(root, 'scripts', 'tooling-radar', 'run-radar.sh'), '--dry-run'], {
    cwd: root,
    encoding: 'utf-8',
    env: hermeticEnv(dir, bin, opts.env),
  });
  return collect(dir, r);
}
