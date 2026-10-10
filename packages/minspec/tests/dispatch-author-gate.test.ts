/**
 * T0 - Invariant: an issue is triaged or dispatched only when its AUTHOR is on an explicit
 * list of logins, and comment text from an author who is not on that list never reaches an
 * agent's prompt.
 *
 * ROOT CAUSE this makes un-committable. Neither scripts/triage-inbox.sh nor
 * scripts/dispatch-issue.sh asked GitHub who wrote the issue: the field was not in either
 * `gh issue view`. Every gate between a label and a launch judged something else. The
 * readiness gate (#983) checks who wrote the triage RECORD, which is the bot that had just
 * triaged the issue, so it vouched for triage having run and never for the text triage
 * ran on. The claim is about concurrency and the quota gate about capacity.
 *
 * THE RULE. A login is trusted when it is on the list in scripts/lib/dispatch-author-gate.sh:
 * the pipeline's own App, in the two spellings GitHub gives an App that wrote an issue, and
 * the founder. Not "is a collaborator" and not "has write access": somebody given access
 * later is not thereby somebody whose text may start an agent. The list is literals in one
 * file. Nothing in the environment adds to it or switches it off.
 *
 * FAIL CLOSED. An author that cannot be read is a refusal, in the same words as any other,
 * and never a pass. A refusal starts nothing: no model, no claim, no label, no worktree.
 * From the dispatcher it is the status the drain reads as "refused" (#2641), so it uses no
 * slot of the queue limit.
 *
 * WHAT IS REAL. The two launchers run unmodified against a stub `gh` and a stub `claude`
 * (helpers/agent-launch-harness.ts). A test here that passes because nothing ran would be
 * worse than none, so each refusal has a control beside it that does start an agent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { cleanupDrains, runOnce } from './helpers/drain-harness';
import {
  AUTHOR_GATE_LIB,
  ISSUE_BODY_MARKER,
  TRUSTED_LOGINS,
  author,
  cleanupLaunchHarness,
  credentialNames,
  dispatchSandbox,
  dispatchStatus,
  reviewVerdict,
  runDispatch,
  runFixAgent,
  runTriage,
  serveQueues,
  type IssueFixture,
} from './helpers/agent-launch-harness';

// Module scope, never a hook: vitest resolves timeouts before beforeAll runs (#1399).
useShellTimeout();
afterEach(() => {
  cleanupDrains();
  cleanupLaunchHarness();
});

const DECLINED = dispatchStatus('DISPATCH_RC_DECLINED');

/** Run one function of the gate library. Throws unless the function itself answered. */
function gate(fn: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(
    'bash',
    ['-c', `set -euo pipefail; source "$1"; shift; rc=0; "$@" || rc=$?; echo "GATE-ANSWERED:$rc"`, 'bash', AUTHOR_GATE_LIB, fn, ...args],
    { encoding: 'utf-8', input: opts.input ?? '', env: { PATH: process.env.PATH ?? '', ...opts.env } },
  );
  const m = r.stdout.match(/GATE-ANSWERED:(\d+)\n$/);
  // A missing library or a crash is not an answer, and must not read as a refusal.
  if (!m) throw new Error(`${fn} did not answer (exit ${r.status}):\n${r.stdout}${r.stderr}`);
  return { status: Number(m[1]), stdout: r.stdout.replace(/GATE-ANSWERED:\d+\n$/, ''), stderr: r.stderr };
}

const trusted = (login: string | undefined, env?: Record<string, string>) =>
  gate('dispatch_author_trusted', login === undefined ? [] : [login], { env }).status === 0;

/** Logins that are not on the list, and why each is worth a row. */
const NOT_TRUSTED = [
  ['some-stranger', 'an account with no role'],
  ['outside-collab', 'a collaborator who is not on the list'],
  ['github-actions[bot]', 'another App'],
  ['app/github-actions', 'another App, as gh renders it'],
  ['dependabot[bot]', 'another App'],
  ['minspec-sdd', 'the bare login a USER account could hold: the App never appears this way as an issue author'],
  ['app/minspec-sdd2', 'a near miss'],
  ['minspec-sdd2[bot]', 'a near miss'],
  ['app/harvest316', 'the founder is not an App'],
  ['harvest316[bot]', 'the founder is not an App'],
  ['xharvest316', 'a suffix match'],
  ['harvest316x', 'a prefix match'],
  ['Harvest316', 'compared exactly, so a different spelling is refused, not guessed at'],
  ['minspec-sddb', '`[bot]` read as a pattern would match one of b, o, t'],
  ['minspec-sddo', '`[bot]` read as a pattern would match one of b, o, t'],
  [' harvest316', 'padding'],
  ['harvest316 ', 'padding'],
  ['harvest316\nsome-stranger', 'two lines'],
  ['*', 'a pattern'],
  ['app/*', 'a pattern'],
  ['', 'empty'],
] as const;

describe('scripts/lib/dispatch-author-gate.sh: the list', () => {
  it.each(TRUSTED_LOGINS)('%s is trusted', (login) => {
    expect(trusted(login)).toBe(true);
  });

  it.each(NOT_TRUSTED)('%j is not trusted (%s)', (login) => {
    expect(trusted(login)).toBe(false);
  });

  it('no login at all is not trusted', () => {
    expect(trusted(undefined)).toBe(false);
  });

  it('nothing in the environment adds a login or switches the gate off', () => {
    const hostile = {
      DISPATCH_TRUSTED_AUTHORS: 'some-stranger',
      MINSPEC_DISPATCH_TRUSTED_AUTHORS: 'some-stranger',
      MINSPEC_TRUSTED_AUTHORS: 'some-stranger',
      TRUSTED_AUTHORS: 'some-stranger',
      MINSPEC_DISPATCH_AUTHOR_GATE: '0',
      MINSPEC_AUTHOR_GATE_OFF: '1',
      MINSPEC_GATE_OFF: '1',
      MINSPEC_GH_BOT_ALLOW_HUMAN: '1',
    };
    expect(trusted('some-stranger', hostile)).toBe(false);
    for (const login of TRUSTED_LOGINS) expect(trusted(login, hostile), login).toBe(true);
  });

  it('the library reads no variable it did not set itself', () => {
    // The behavioural test above can only try the names somebody thought of. This is the
    // rule that makes the rest unnecessary: every variable the library reads is a
    // lowercase local or a positional, so there is no name to set from outside.
    const code = fs
      .readFileSync(AUTHOR_GATE_LIB, 'utf-8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    expect(code).toContain('dispatch_author_trusted');
    expect(code.match(/\$\{?[A-Z][A-Za-z0-9_]*/g) ?? []).toEqual([]);
  });
});

/** Shapes of an issue whose author cannot be read. `undefined` leaves the field out. */
const UNREADABLE: { name: string; author: unknown }[] = [
  { name: 'no author field', author: undefined },
  { name: 'a null author', author: null },
  { name: 'an author with no login', author: {} },
  { name: 'an empty login', author: { login: '' } },
  { name: 'a null login', author: { login: null } },
  { name: 'a login that is a number', author: { login: 316 } },
  { name: 'a login that is a list', author: { login: ['harvest316'] } },
  { name: 'an author that is a bare string', author: 'harvest316' },
  { name: 'an author that is a list', author: [{ login: 'harvest316' }] },
];

describe('scripts/lib/dispatch-author-gate.sh: reading the author of an issue', () => {
  const check = (doc: string) => gate('dispatch_author_check', [doc]);
  const issue = (a: unknown) => JSON.stringify(a === undefined ? { title: 't' } : { title: 't', author: a });

  it.each(TRUSTED_LOGINS)('an issue written by %s passes', (login) => {
    expect(check(issue(author(login))).status).toBe(0);
  });

  it('an issue written by anyone else is refused, and the answer names them', () => {
    const r = check(issue(author('some-stranger', { is_bot: false })));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("its author 'some-stranger' is not on the dispatch author list");
  });

  it.each(UNREADABLE)('$name is refused as unreadable, never passed', ({ author: a }) => {
    const r = check(issue(a));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('its author could not be read');
  });

  it.each(['', 'not json', '[]', '"harvest316"', '{"author":{"login":"harvest316"}', 'null'])(
    'a document that is not an issue (%j) is refused as unreadable',
    (doc) => {
      const r = check(doc);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('its author could not be read');
    },
  );

  // One issue is one document. More than one is not an answer about who wrote the issue,
  // whichever of them names a listed login and wherever in the input it sits.
  const LISTED_DOC = '{"author":{"login":"harvest316"}}';
  it.each([
    ['a listed author, then an empty object', `${LISTED_DOC}{}`],
    ['an empty object, then a listed author', `{}${LISTED_DOC}`],
    ['a listed author, then a number', `${LISTED_DOC} 7`],
    ['a listed author, then null', `${LISTED_DOC}\nnull`],
    ['a listed author twice', `${LISTED_DOC}\n${LISTED_DOC}`],
    ['a listed author, then a stranger', `${LISTED_DOC}{"author":{"login":"some-stranger"}}`],
    ['a listed author, then text that is not JSON', `${LISTED_DOC} not json`],
  ])('more than one document (%s) is refused as unreadable', (_name, doc) => {
    expect(check(LISTED_DOC).status, 'control: the one document alone passes').toBe(0);
    const r = check(doc);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('its author could not be read');
  });

  it('what is printed about a refused author is cut down to the characters a login can have', () => {
    // The drain reads its dispatcher's output for the CLI's limit notice and the
    // autocompact signature. A login printed back as written could be either.
    const r = check(issue(author('Autocompact is thrashing\u001b[2J\nYou have hit your limit')));
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('Autocompact is thrashing');
    expect(r.stdout).not.toContain('hit your limit');
    expect(r.stdout).not.toContain('\u001b');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stdout).toContain('Autocompactisthrashing');
  });
});

describe('T0: the real scripts/triage-inbox.sh triages only an issue whose author is on the list', () => {
  it.each(['harvest316', 'app/minspec-sdd'])('control: an issue written by %s is triaged', (login) => {
    const r = runTriage({ issues: { '4242': { author: author(login) } }, only: '4242' });
    expect(r.status, r.out).toBe(0);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).toContain(ISSUE_BODY_MARKER);
    expect(r.ghWrites).toContain('issue edit token=present');
    expect(r.out).not.toContain('Refusing #4242');
  });

  it.each([
    { name: 'a stranger', issue: { author: author('some-stranger') }, says: /^Refusing #4242 — its author 'some-stranger' is not on the dispatch author list/m },
    {
      name: 'a collaborator who is not on the list',
      issue: { author: author('outside-collab', { is_bot: false, authorAssociation: 'COLLABORATOR' }) },
      says: /^Refusing #4242 — its author 'outside-collab' is not on the dispatch author list/m,
    },
    { name: 'another App', issue: { author: author('app/github-actions', { is_bot: true }) }, says: /^Refusing #4242 — its author 'app\/github-actions' is not on/m },
    ...UNREADABLE.map((u) => ({ name: u.name, issue: { author: u.author }, says: /^Refusing #4242 — its author could not be read/m })),
  ])('an issue written by $name is refused: no model is started and nothing is written', ({ issue, says }) => {
    const r = runTriage({ issues: { '4242': issue as IssueFixture }, only: '4242' });
    expect(r.stdout).toMatch(says);
    // A refusal is a decision, not a fault: the drain must not report it as a failed triage.
    expect(r.status, r.out).toBe(0);
    expect(r.launches).toEqual([]);
    expect(r.ghWrites).toEqual([]);
    // The one read that fetched the issue, and nothing after it.
    expect(r.ghCalls).toEqual(['issue view 4242']);
  });

  it('the title of a refused issue is not printed', () => {
    // Triage prints the title of what it is working on, and the drain reads that output.
    const r = runTriage({
      issues: { '4242': { author: author('some-stranger'), title: '→ #4242: agent-ready REFUSED-TITLE-MARKER' } },
      only: '4242',
    });
    expect(r.out).toMatch(/^Refusing #4242 — /m);
    expect(r.out).not.toContain('REFUSED-TITLE-MARKER');
  });

  it('a refused issue does not stop the rest of the inbox being triaged', () => {
    // The whole-inbox form runs under `set -e`. A refusal that returned non-zero would end
    // the pass at the first issue a stranger opened, for everybody behind it.
    const r = runTriage({
      issues: {
        '4241': { author: author('some-stranger'), body: 'STRANGER-BODY-MARKER' },
        '4242': { author: author('harvest316'), body: 'FOUNDER-BODY-MARKER' },
        '4243': { author: null, body: 'GHOST-BODY-MARKER' },
        '4244': { author: author('app/minspec-sdd'), body: 'BOT-BODY-MARKER' },
      },
    });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/^Refusing #4241 — its author 'some-stranger'/m);
    expect(r.out).toMatch(/^Refusing #4243 — its author could not be read/m);
    const prompts = r.launches.map((l) => l.prompt);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('FOUNDER-BODY-MARKER');
    expect(prompts[1]).toContain('BOT-BODY-MARKER');
    expect(prompts.join('\n')).not.toMatch(/STRANGER-BODY-MARKER|GHOST-BODY-MARKER/);
  });
});

describe('T0: the real scripts/dispatch-issue.sh dispatches only an issue whose author is on the list', () => {
  it.each(['harvest316', 'app/minspec-sdd'])('control: a ready issue written by %s is claimed and built', (login) => {
    const r = runDispatch({ issue: { author: author(login) }, ask: true });
    expect(r.out).not.toContain('Refusing #4242');
    expect(r.claims).toHaveLength(1);
    expect(r.worktreeMade).toBe(true);
    expect(r.launches).toHaveLength(1);
    expect(r.status, r.out).toBe(dispatchStatus('DISPATCH_RC_STARTED'));
  });

  const REFUSED = [
    { name: 'a stranger', issue: { author: author('some-stranger') }, says: /^Refusing #4242 — its author 'some-stranger' is not on the dispatch author list/m },
    {
      name: 'a collaborator who is not on the list',
      issue: { author: author('outside-collab', { is_bot: false, authorAssociation: 'COLLABORATOR' }) },
      says: /^Refusing #4242 — its author 'outside-collab' is not on the dispatch author list/m,
    },
    { name: 'another App', issue: { author: author('app/github-actions', { is_bot: true }) }, says: /^Refusing #4242 — its author 'app\/github-actions' is not on/m },
    { name: 'a user account with the bot\'s bare login', issue: { author: author('minspec-sdd') }, says: /^Refusing #4242 — its author 'minspec-sdd' is not on/m },
    ...UNREADABLE.map((u) => ({ name: u.name, issue: { author: u.author }, says: /^Refusing #4242 — its author could not be read/m })),
  ];

  it.each(REFUSED)('a ready issue written by $name is refused before anything is started', ({ issue, says }) => {
    // Ready in every other respect: open, labelled, and backed by a fresh verdict record
    // from the bot. That is the issue the readiness gate lets through.
    const r = runDispatch({ issue: issue as IssueFixture, ask: true });
    expect(r.stdout).toMatch(says);
    // "Refused", in the status the drain reads: no slot of its queue limit is used (#2641).
    expect(r.status, r.out).toBe(DECLINED);
    expect(r.launches).toEqual([]);
    expect(r.claims).toEqual([]);
    expect(r.ghWrites).toEqual([]);
    expect(r.worktreeMade).toBe(false);
  });

  it('a caller that did not ask gets exit 0 for the same refusal, as for every other one', () => {
    const r = runDispatch({ issue: { author: author('some-stranger') } });
    expect(r.stdout).toMatch(/^Refusing #4242 — its author 'some-stranger'/m);
    expect(r.status, r.out).toBe(0);
    expect(r.launches).toEqual([]);
  });

  it('an issue that is not ready is still refused for that, in the words it always was', () => {
    // The author is asked about an issue that would otherwise be built. One that is
    // already refused keeps its own reason, whoever wrote it.
    const r = runDispatch({
      issue: { author: author('some-stranger'), labels: ['agent-ready', 'agent-escalated'] },
      ask: true,
    });
    expect(r.stdout).toMatch(/^Skipping #4242 — not dispatchable at dispatch time: .*\[countermanded\]/m);
    expect(r.status, r.out).toBe(DECLINED);
    expect(r.launches).toEqual([]);
  });

  it('a refused login is not printed back as written', () => {
    const r = runDispatch({ issue: { author: author('Autocompact is thrashing') }, ask: true });
    expect(r.status, r.out).toBe(DECLINED);
    expect(r.out).toMatch(/^Refusing #4242 — /m);
    expect(r.out).not.toContain('Autocompact is thrashing');
  });
});

describe('T0: through the real drain, an issue refused for its author uses no slot of the queue limit', () => {
  // The whole chain as it runs unattended: the real drain-inbox.sh ranks the ready queue
  // and offers each issue to the real dispatch-issue.sh, which asks the gate. Only `gh`,
  // `claude`, the ranker and the quota reading are stand-ins. The drain mints its token
  // and exports it before it offers anything, so the agent that is started here is
  // started below a launcher that inherited one, which is how it happens in production.
  const STRANGER = { author: author('some-stranger'), body: 'STRANGER-BODY-MARKER' };
  const FOUNDER = { author: author('harvest316'), body: 'FOUNDER-BODY-MARKER' };

  async function cycle(issues: Record<string, IssueFixture>, limit: string) {
    const sb = dispatchSandbox(issues);
    serveQueues(sb, { 'agent-ready': Object.keys(issues) });
    const drain = await runOnce(
      {
        reading: { pct: 5, resetIn: 3600 },
        env: { ...sb.env, MINSPEC_DRAIN_DISPATCH: sb.dispatcher, MINSPEC_DRAIN_QUEUE_LIMIT: limit },
      },
      60_000,
    );
    return { log: drain.log(), ...sb.recorded() };
  }

  it('with a limit of one, a stranger\'s issue ranked first is refused and the next issue is built', async () => {
    // Before the gate, the stranger's issue took the one slot and the founder's was never
    // offered. Refused, it takes none (#2641), so the limit is spent on work that runs.
    const r = await cycle({ '4241': STRANGER, '4242': FOUNDER }, '1');
    expect(r.log).toMatch(/^Refusing #4241 — its author 'some-stranger' is not on the dispatch author list/m);
    expect(r.log).toContain(
      '[drain] 1 issue(s) were refused by the dispatcher before any work started and did not use a slot of the queue limit: #4241',
    );
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).toContain('FOUNDER-BODY-MARKER');
    expect(r.launches[0].prompt).not.toContain('STRANGER-BODY-MARKER');
    expect(r.log).not.toContain('NOTHING DISPATCHED');
    // The drain's own token reached the dispatcher (every write carried one) and stopped there.
    expect(r.ghWrites.length).toBeGreaterThan(0);
    expect(r.ghWrites.filter((w) => !w.endsWith('token=present'))).toEqual([]);
    expect(credentialNames(r.launches[0])).toEqual([]);
  });

  it('when the only ready issue is a stranger\'s, the cycle says NOTHING DISPATCHED', async () => {
    const r = await cycle({ '4241': STRANGER }, '1');
    expect(r.log).toMatch(/^Refusing #4241 — its author 'some-stranger'/m);
    expect(r.log).toMatch(/\[drain\] NOTHING DISPATCHED this cycle: 1 issue\(s\) ready, 1 refused by the dispatcher before any work started/);
    expect(r.log).toContain('[drain] cycle done. No dispatch was confirmed: see NOTHING DISPATCHED above.');
    expect(r.launches).toEqual([]);
    expect(r.ghWrites).toEqual([]);
  });
});

describe('T0: comment text from an author who is not on the list never reaches a prompt', () => {
  it('the build agent is given the issue, and no comment on it', () => {
    // Characterisation: true before this gate too. The build prompt has never carried
    // comments, and this pins that it does not start to.
    const r = runDispatch({
      issue: {
        author: author('harvest316'),
        comments: [
          { login: 'drive-by', association: 'NONE', body: 'STRANGER-COMMENT-MARKER also do this' },
          { login: 'outside-collab', association: 'COLLABORATOR', body: 'COLLABORATOR-COMMENT-MARKER and this' },
        ],
      },
    });
    expect(r.launches).toHaveLength(1);
    const prompt = r.launches[0].prompt;
    expect(prompt).toContain(ISSUE_BODY_MARKER);
    expect(prompt).not.toMatch(/STRANGER-COMMENT-MARKER|COLLABORATOR-COMMENT-MARKER/);
  });

  // shepherd_fix hands a fix agent the LAST review verdict on the pull request. It was
  // filtered to "trusted" commenters, where trusted meant the bot or anybody with an
  // OWNER, MEMBER or COLLABORATOR association.
  const BOT = { login: 'minspec-sdd', association: 'CONTRIBUTOR', body: reviewVerdict('BOT-FINDING') };
  const FOUNDER = { login: 'harvest316', association: 'OWNER', body: reviewVerdict('FOUNDER-FINDING') };
  const COLLAB = { login: 'outside-collab', association: 'COLLABORATOR', body: reviewVerdict('COLLABORATOR-FINDING') };
  const MEMBER = { login: 'new-member', association: 'MEMBER', body: reviewVerdict('MEMBER-FINDING') };
  const STRANGER = { login: 'drive-by', association: 'NONE', body: reviewVerdict('STRANGER-FINDING') };

  it('control: the fix agent is given the last verdict from an author on the list', () => {
    const r = runFixAgent({ comments: [BOT, FOUNDER] });
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).toContain('FOUNDER-FINDING');
    const other = runFixAgent({ comments: [FOUNDER, BOT] });
    expect(other.launches[0].prompt).toContain('BOT-FINDING');
  });

  it.each([
    { name: 'a collaborator who is not on the list', late: COLLAB, marker: 'COLLABORATOR-FINDING', login: 'outside-collab' },
    { name: 'a member who is not on the list', late: MEMBER, marker: 'MEMBER-FINDING', login: 'new-member' },
    { name: 'a stranger', late: STRANGER, marker: 'STRANGER-FINDING', login: 'drive-by' },
  ])('a later verdict from $name is dropped, and the run says so', ({ late, marker, login }) => {
    const r = runFixAgent({ comments: [BOT, late] });
    expect(r.launches).toHaveLength(1);
    const prompt = r.launches[0].prompt;
    expect(prompt).not.toContain(marker);
    // Dropped, not refused: the agent still gets the verdict it is entitled to.
    expect(prompt).toContain('BOT-FINDING');
    expect(r.stderr).toMatch(/dropped 1 of 2 comment\(s\)/);
    expect(r.stderr).toContain(login);
    expect(r.stderr).toContain('not on the dispatch author list');
  });

  it('with only unlisted commenters, the agent is started with no review text at all', () => {
    const r = runFixAgent({ comments: [COLLAB, STRANGER] });
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).not.toMatch(/COLLABORATOR-FINDING|STRANGER-FINDING|REVIEW_VERDICT_BEGIN/);
    expect(r.stderr).toMatch(/dropped 2 of 2 comment\(s\)/);
  });

  it('nothing is said when nothing is dropped', () => {
    const r = runFixAgent({ comments: [BOT, FOUNDER] });
    expect(r.stderr).not.toContain('dropped');
  });
});

describe('scripts/lib/dispatch-author-gate.sh: filtering a list of comments', () => {
  const filter = (doc: string) => gate('dispatch_trusted_comments', ['pull request 77'], { input: doc });
  const c = (login: string, body: string, association = 'NONE') => ({
    id: `id-${body}`,
    author: { login },
    authorAssociation: association,
    body,
  });

  it('keeps the App in each spelling GitHub gives it, and the founder, in order and untouched', () => {
    // A comment's author comes back as a bare login, with no `app/` in front: that is
    // the one form `gh ... --json comments` has for an App.
    const doc = {
      comments: [
        c('minspec-sdd', 'one', 'CONTRIBUTOR'),
        c('drive-by', 'two'),
        c('minspec-sdd[bot]', 'three'),
        c('outside-collab', 'four', 'COLLABORATOR'),
        c('harvest316', 'five', 'OWNER'),
        c('app/minspec-sdd', 'six'),
        c('github-actions', 'seven', 'CONTRIBUTOR'),
      ],
    };
    const r = filter(JSON.stringify(doc));
    expect(r.status).toBe(0);
    const kept = (JSON.parse(r.stdout) as typeof doc).comments;
    expect(kept.map((k) => k.body)).toEqual(['one', 'three', 'five', 'six']);
    expect(kept[0]).toEqual(doc.comments[0]);
    expect(r.stderr).toMatch(/dropped 3 of 7 comment\(s\) on pull request 77/);
    for (const login of ['drive-by', 'outside-collab', 'github-actions']) expect(r.stderr).toContain(login);
  });

  it('a commenter with no readable login is dropped', () => {
    const doc = { comments: [{ body: 'no-author' }, { author: null, body: 'null-author' }, { author: { login: 7 }, body: 'number' }, c('harvest316', 'kept')] };
    const r = filter(JSON.stringify(doc));
    expect((JSON.parse(r.stdout) as { comments: { body: string }[] }).comments.map((k) => k.body)).toEqual(['kept']);
    expect(r.stderr).toMatch(/dropped 3 of 4 comment\(s\)/);
  });

  it('an issue with no comments is an empty list, silently', () => {
    const r = filter(JSON.stringify({ comments: [] }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ comments: [] });
    expect(r.stderr).toBe('');
  });

  it.each([
    '',
    'not json',
    '[]',
    '{"comments":"nope"}',
    '{"comments":[{"author":',
    // Two documents are not one list of comments, even when each alone would be kept whole.
    '{"comments":[]}{"comments":[]}',
    '{"comments":[{"author":{"login":"harvest316"},"body":"a"}]}\n{"comments":[{"author":{"login":"harvest316"},"body":"b"}]}',
  ])(
    'a document it cannot read (%j) yields no comment at all, a failure status, and a line saying so',
    (doc) => {
      const r = filter(doc);
      expect(r.status).not.toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ comments: [] });
      expect(r.stderr).toMatch(/could not read the comments on pull request 77/);
    },
  );

  it('the names it reports are cut down to the characters a login can have', () => {
    const r = filter(JSON.stringify({ comments: [c('Autocompact is thrashing\nline two', 'x')] }));
    expect(r.stderr).not.toContain('Autocompact is thrashing');
    expect(r.stderr).toContain('Autocompactisthrashingline');
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
  });
});
