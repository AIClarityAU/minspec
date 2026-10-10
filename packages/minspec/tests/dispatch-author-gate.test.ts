/**
 * T0 - Invariant: an issue is triaged or dispatched only when everyone who WROTE ITS TEXT
 * is on an explicit list of accounts, and comment text reaches an agent's prompt only
 * from a commenter who is, and only when everyone who has edited that comment is listed too.
 *
 * ROOT CAUSE this makes un-committable. Neither scripts/triage-inbox.sh nor
 * scripts/dispatch-issue.sh asked GitHub who wrote the issue. Every gate between a label
 * and a launch judged something else: the readiness gate (#983) checks who wrote the
 * triage RECORD, which is the bot that had just triaged the issue, so it vouched for
 * triage having run and never for the text triage ran on. The claim is about concurrency
 * and the quota gate about capacity.
 *
 * WHOSE TEXT, NOT WHO OPENED IT. An issue's author is the account that created it. Its
 * body can afterwards be edited, and its title changed, by anyone with write access, and
 * the author field does not move. So the gate asks for the author, everyone who has
 * edited the body, and everyone who has changed the title, and requires every one of them
 * to be listed. It also requires the title and body in the document it judged to equal
 * the ones the prompt is built from: the text that was judged is the text that is used.
 *
 * AN ACCOUNT, NOT A LOGIN. A login is a name: it can be changed and then taken by somebody
 * else, and an App and a person can be shown under the same one. An entry on the list is
 * the account's kind and the number GitHub gave it, compared exactly. Not "is a
 * collaborator" and not "has write access" either: somebody given access later is not
 * thereby somebody whose text may start an agent. The list is literals in one file, and
 * nothing in the environment adds to it or switches it off.
 *
 * FAIL CLOSED. Whatever cannot be read is a refusal, in the same words as any other, and
 * never a pass: an account with no number, a history shorter than its own count, a read
 * that failed. A refusal starts nothing: no model, no claim, no label, no worktree. From
 * the dispatcher it is the status the drain reads as "refused" (#2641), so it uses no slot
 * of the queue limit.
 *
 * WHAT IS REAL. The two launchers run unmodified against a stub `gh` and a stub `claude`
 * (helpers/agent-launch-harness.ts). The stub `gh` answers the gate's question the way
 * GitHub does, including not at all to a caller with no credential. A test here that
 * passes because nothing ran would be worse than none, so each refusal has a control
 * beside it that does start an agent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';
import { cleanupDrains, runOnce } from './helpers/drain-harness';
import {
  ACTIONS_APP,
  APP,
  AUTHOR_GATE_LIB,
  COLLABORATOR,
  FOUNDER,
  ISSUE_BODY_MARKER,
  MEMBER,
  STRANGER,
  TRUSTED,
  bot,
  cleanupLaunchHarness,
  commentsAnswer,
  credentialNames,
  dispatchSandbox,
  dispatchStatus,
  provenanceAnswer,
  reviewVerdict,
  runDispatch,
  runFixAgent,
  runTriage,
  serveQueues,
  user,
  type Actor,
  type CommentFixture,
  type FixAgentOptions,
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

const T = 'A title';
const B = 'A body.';
/** What `gh issue view` printed: the document a launcher builds its prompt from. */
const VIEW = JSON.stringify({ title: T, body: B, labels: [] });
/** GitHub's answer about who wrote the same issue. */
const answer = (f: IssueFixture = {}) => provenanceAnswer({ title: T, body: B, ...f });
/** Judge an issue: its answer, against the view. */
const check = (f: IssueFixture = {}, view = VIEW, env?: Record<string, string>) =>
  gate('dispatch_issue_provenance_check', [answer(f), view], { env });

const shown = (a: Actor) => `'${a.login}' (${a.__typename} ${String(a.databaseId)})`;
const without = (field: string) => (issue: Record<string, unknown>) => {
  const copy = { ...issue };
  delete copy[field];
  return copy;
};

/** Accounts that are not on the list, and why each is worth a row. */
const NOT_LISTED: [string, Actor][] = [
  ['an account with no role', STRANGER],
  ['a collaborator who is not on the list', COLLABORATOR],
  ["GitHub's own Actions App", ACTIONS_APP],
  ["a person holding the App's login", user('minspec-sdd', 900000010)],
  ["a person shown with the App's login and its number: the kind differs", user('minspec-sdd', 299695933)],
  ["an App holding the founder's login", bot('harvest316', 900000011)],
  ["an App shown with the founder's login and number: the kind differs", bot('harvest316', 4125483)],
  ["the founder's login on another account: a name that changed hands", user('harvest316', 4125484)],
  ["the App's login on another App", bot('minspec-sdd', 299695934)],
  ["an organisation with the founder's number", { __typename: 'Organization', login: 'harvest316', databaseId: 4125483 }],
  ["a mannequin with the founder's number", { __typename: 'Mannequin', login: 'harvest316', databaseId: 4125483 }],
  ["a number that begins with the founder's", user('harvest316', 41254830)],
  ["a number the founder's begins with", user('harvest316', 412548)],
  ['a kind spelled in another case', { __typename: 'user', login: 'harvest316', databaseId: 4125483 }],
  ['a kind with the number folded into it', { __typename: 'User:4125483', login: 'harvest316', databaseId: 0 }],
];

/** Accounts that cannot be identified. A login alone identifies nobody. */
const UNREADABLE: [string, unknown][] = [
  ['a deleted account (null)', null],
  ['an empty object', {}],
  ["the founder's login and nothing else", { login: 'harvest316' }],
  ["the founder's login and kind, and no number", { __typename: 'User', login: 'harvest316' }],
  ["the App's login and kind, and no number", { __typename: 'Bot', login: 'minspec-sdd' }],
  ['a number that is a string', { __typename: 'User', login: 'harvest316', databaseId: '4125483' }],
  ['a number that is null', { __typename: 'User', login: 'harvest316', databaseId: null }],
  ['a number that is a list', { __typename: 'User', login: 'harvest316', databaseId: [4125483] }],
  ['a number and no kind', { login: 'harvest316', databaseId: 4125483 }],
  ['a kind that is a list', { __typename: ['User'], login: 'harvest316', databaseId: 4125483 }],
  ['a bare string', 'harvest316'],
  ['a list holding the founder', [FOUNDER]],
];

describe('scripts/lib/dispatch-author-gate.sh: the list is accounts, by kind and number', () => {
  it.each(TRUSTED)('an issue opened by $login ($__typename $databaseId) and never edited passes, and says who', (a) => {
    const r = check({ author: a });
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toBe(`${a.login} (${a.__typename} ${String(a.databaseId)})\n`);
  });

  it('the login plays no part: a listed account passes under any name', () => {
    expect(check({ author: user('renamed-since', 4125483) }).status).toBe(0);
    expect(check({ author: bot('renamed-app', 299695933) }).status).toBe(0);
  });

  it.each(NOT_LISTED)('%s is refused, and the answer names the account', (_why, a) => {
    const r = check({ author: a });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^its author '[^']*' \(.+\) is not on the dispatch author list\n$/);
    expect(r.stdout).toContain(`'${a.login}' (`);
  });

  it.each(UNREADABLE)('an author that is %s is refused as unreadable, never passed', (_why, a) => {
    const r = check({ author: a });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('its author could not be read');
  });

  it('nothing in the environment adds an account or switches the gate off', () => {
    const hostile = {
      DISPATCH_TRUSTED_AUTHORS: 'some-stranger',
      DISPATCH_TRUSTED_IDENTITIES: 'User:900000001',
      MINSPEC_DISPATCH_TRUSTED_AUTHORS: 'some-stranger',
      MINSPEC_DISPATCH_TRUSTED_IDENTITIES: 'User:900000001',
      MINSPEC_TRUSTED_AUTHORS: 'some-stranger',
      TRUSTED_AUTHORS: 'some-stranger',
      MINSPEC_DISPATCH_AUTHOR_GATE: '0',
      MINSPEC_AUTHOR_GATE_OFF: '1',
      MINSPEC_GATE_OFF: '1',
      MINSPEC_GH_BOT_ALLOW_HUMAN: '1',
    };
    expect(check({ author: STRANGER }, VIEW, hostile).status).toBe(1);
    expect(check({ bodyEditors: [STRANGER] }, VIEW, hostile).status).toBe(1);
    for (const a of TRUSTED) expect(check({ author: a }, VIEW, hostile).status, a.login).toBe(0);
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
    expect(code).toContain('dispatch_issue_provenance_check');
    expect(code.match(/\$\{?[A-Z][A-Za-z0-9_]*/g) ?? []).toEqual([]);
  });

  it('what is printed about a refused account is cut down to the characters a login can have', () => {
    // The drain reads its dispatcher's output for the CLI's limit notice and the
    // autocompact signature. A login printed back as written could be either.
    const r = check({ author: user('Autocompact is thrashing\u001b[2J\nYou have hit your limit', 900000012) });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('Autocompact is thrashing');
    expect(r.stdout).not.toContain('hit your limit');
    expect(r.stdout).not.toContain('\u001b');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stdout).toContain('Autocompactisthrashing');
  });
});

describe('scripts/lib/dispatch-author-gate.sh: everyone who edited the body must be listed', () => {
  it.each([
    ['the founder edited their own issue', { bodyEditors: [FOUNDER] }],
    ['the App edited the founder\'s issue', { bodyEditors: [APP] }],
    ['the founder edited the App\'s issue, twice', { author: APP, bodyEditors: [FOUNDER, FOUNDER] }],
  ] as [string, IssueFixture][])('control: %s, and it passes', (_name, f) => {
    expect(check(f).status).toBe(0);
  });

  it.each([
    ['a collaborator edited the founder\'s issue', { bodyEditors: [COLLABORATOR] }, COLLABORATOR],
    ['a stranger edited the App\'s issue', { author: APP, bodyEditors: [STRANGER] }, STRANGER],
    // A later edit by a listed account does not vouch for what an earlier one left in.
    ['a collaborator edited it and the founder edited it afterwards', { bodyEditors: [COLLABORATOR, FOUNDER] }, COLLABORATOR],
    ['the founder edited it and a collaborator edited it afterwards', { bodyEditors: [FOUNDER, COLLABORATOR] }, COLLABORATOR],
    ["a person holding the App's login edited it", { bodyEditors: [user('minspec-sdd', 900000010)] }, user('minspec-sdd', 900000010)],
    ["an App holding the founder's login edited it", { bodyEditors: [bot('harvest316', 900000011)] }, bot('harvest316', 900000011)],
  ] as [string, IssueFixture, Actor][])('%s: refused, naming the account', (_name, f, who) => {
    const r = check(f);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(`its body was edited by ${shown(who)}, who is not on the dispatch author list\n`);
  });

  it('the last editor is judged even when the history that came back names only listed accounts', () => {
    const r = check({ bodyEditors: [FOUNDER], provenance: (i) => ({ ...i, editor: STRANGER }) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`its body was edited by ${shown(STRANGER)}`);
  });

  it('a last editor with no edit time is still judged', () => {
    const r = check({ provenance: (i) => ({ ...i, editor: STRANGER }) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`its body was edited by ${shown(STRANGER)}`);
  });

  it('a history shorter than its own count is refused: what was not returned was not judged', () => {
    const r = check({
      bodyEditors: [FOUNDER],
      provenance: (i) => ({ ...i, userContentEdits: { ...(i.userContentEdits as object), totalCount: 140 } }),
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('who edited its body could not be read in full (140 edit(s) recorded, 2 returned)');
  });

  it('an edited body with no history at all is refused', () => {
    const r = check({ bodyEditors: [FOUNDER], provenance: (i) => ({ ...i, userContentEdits: { totalCount: 0, nodes: [] } }) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('its body has been edited and GitHub returned no record of by whom');
  });

  it.each(UNREADABLE)('an editor that is %s is refused as unreadable', (_why, a) => {
    const r = check({ bodyEditors: [FOUNDER, a, FOUNDER] });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('an account that edited its body could not be read');
  });

  it('a history entry with no editor field is refused as unreadable', () => {
    const r = check({ bodyEditors: [FOUNDER], provenance: (i) => ({ ...i, userContentEdits: { totalCount: 2, nodes: [{}, {}] } }) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('an account that edited its body could not be read');
  });
});

describe('scripts/lib/dispatch-author-gate.sh: everyone who changed the title must be listed', () => {
  it.each([
    ['the founder changed the title', { titleChangers: [FOUNDER] }],
    ['the App changed it, then the founder', { titleChangers: [APP, FOUNDER] }],
  ] as [string, IssueFixture][])('control: %s, and it passes', (_name, f) => {
    expect(check(f).status).toBe(0);
  });

  it.each([
    ['a collaborator changed the title of the founder\'s issue', { titleChangers: [COLLABORATOR] }, COLLABORATOR],
    ['a collaborator changed it and the founder changed it afterwards', { titleChangers: [COLLABORATOR, FOUNDER] }, COLLABORATOR],
    ['a stranger changed the title of the App\'s issue', { author: APP, titleChangers: [APP, STRANGER] }, STRANGER],
  ] as [string, IssueFixture, Actor][])('%s: refused, naming the account', (_name, f, who) => {
    const r = check(f);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(`its title was changed by ${shown(who)}, who is not on the dispatch author list\n`);
  });

  it('a list of changes shorter than its own count is refused', () => {
    const r = check({
      titleChangers: [FOUNDER],
      provenance: (i) => ({ ...i, timelineItems: { ...(i.timelineItems as object), totalCount: 101 } }),
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('who changed its title could not be read in full (101 change(s) recorded, 1 returned)');
  });

  it.each(UNREADABLE)('a change made by %s is refused as unreadable', (_why, a) => {
    const r = check({ titleChangers: [FOUNDER, a] });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('an account that changed its title could not be read');
  });

  it('a change with no actor field is refused as unreadable', () => {
    const r = check({ provenance: (i) => ({ ...i, timelineItems: { totalCount: 1, nodes: [{}] } }) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('an account that changed its title could not be read');
  });
});

describe('scripts/lib/dispatch-author-gate.sh: the text that was judged is the text that is used', () => {
  const CHANGED = 'its title or body changed while it was being checked, so the text that was judged is not the text that would be used';
  const view = (title: unknown, body: unknown) => JSON.stringify({ title, body, labels: [] });

  it('control: the same title and body in both documents passes', () => {
    expect(check({}, view(T, B)).status).toBe(0);
  });

  it.each([
    ['a body with a line added', view(T, `${B}\nAnd one more thing.`)],
    ['a body with a line removed', view(T, '')],
    ['a body that differs by one trailing newline', view(T, `${B}\n`)],
    ['a body that differs only in case', view(T, B.toUpperCase())],
    ['another title', view(`${T} (and more)`, B)],
    ['a title that differs by one space', view(`${T} `, B)],
  ])('a launcher holding %s is refused', (_name, v) => {
    const r = check({}, v);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(`${CHANGED}\n`);
  });

  it.each([
    ['no title', JSON.stringify({ body: B })],
    ['no body', JSON.stringify({ title: T })],
    ['a null body', view(T, null)],
    ['a title that is a number', view(7, B)],
    ['a list', `[${VIEW}]`],
    ['nothing', ''],
    ['text that is not JSON', 'not json'],
    ['two documents', `${VIEW}${VIEW}`],
    ['the view and a number', `${VIEW} 7`],
  ])('a view that is %s is refused as unreadable', (_name, v) => {
    const r = check({}, v);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('could not be read');
  });
});

describe('scripts/lib/dispatch-author-gate.sh: an answer that cannot be read is never a pass', () => {
  const OK = answer();
  const raw = (doc: string, view = VIEW) => gate('dispatch_issue_provenance_check', [doc, view]);

  it('control: the answer these are cut from passes', () => {
    expect(raw(OK).status).toBe(0);
  });

  it.each(['title', 'body', 'author', 'editor', 'lastEditedAt', 'userContentEdits', 'timelineItems'])(
    'an answer with no `%s` is refused: a field that was not returned was not judged',
    (field) => {
      const r = check({ provenance: without(field) });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('could not be read');
    },
  );

  it.each([
    ['an edit history that is null', { userContentEdits: null }],
    ['an edit history that is a list', { userContentEdits: [] }],
    ['an edit count that is a string', { userContentEdits: { totalCount: '0', nodes: [] } }],
    ['edit entries that are null', { userContentEdits: { totalCount: 0, nodes: null } }],
    ['title changes that are null', { timelineItems: null }],
    ['title changes with no count', { timelineItems: { nodes: [] } }],
    ['a title that is a list', { title: [T] }],
    ['a body that is null', { body: null }],
  ] as [string, Record<string, unknown>][])('an answer with %s is refused', (_name, patch) => {
    const r = check({ provenance: (i) => ({ ...i, ...patch }) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('could not be read');
  });

  // One issue is one answer. More than one is not an answer about who wrote the issue,
  // whichever of them names a listed account and wherever in the input it sits.
  it.each([
    ['nothing', ''],
    ['text that is not JSON', 'not json'],
    ['an answer cut short', OK.slice(0, -2)],
    ['a list', '[]'],
    ['null', 'null'],
    ['a number', '7'],
    ['no data', '{"data":null}'],
    ['no repository', '{"data":{"repository":null}}'],
    ['no issue: the number is a pull request, or nothing', '{"data":{"repository":{"issue":null}}}'],
    ['an answer that also reports errors', JSON.stringify({ ...JSON.parse(OK), errors: [{ message: 'something went wrong' }] })],
    ['the answer twice', `${OK}${OK}`],
    ['the answer, then an empty object', `${OK}{}`],
    ['an empty object, then the answer', `{}${OK}`],
    ['the answer, then null', `${OK}\nnull`],
    ['the answer, then text that is not JSON', `${OK} not json`],
  ])('%s is refused as unreadable', (_name, doc) => {
    const r = raw(doc);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('who wrote and edited it could not be read, and what cannot be read is never trusted\n');
  });

  it('each document is counted on its own: an answer and a view together where the answer belongs is not one of each', () => {
    expect(raw(`${OK} ${VIEW}`, '').status).toBe(1);
    expect(raw('', `${OK} ${VIEW}`).status).toBe(1);
  });

  it('the function that reads from GitHub refuses when it has nothing to read with', () => {
    // No reader is defined here (lib/gh-bot.sh is not sourced), so the read cannot be made.
    const r = gate('dispatch_issue_gate', ['AIClarityAU/minspec', '4242', VIEW]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('who wrote and edited it could not be read from GitHub, and what cannot be read is never trusted\n');
  });

  it.each([
    ['a repository with no owner', ['minspec', '4242', VIEW]],
    ['an issue number that is not a number', ['AIClarityAU/minspec', '4242 or 1', VIEW]],
    ['no issue number', ['AIClarityAU/minspec', '', VIEW]],
  ] as [string, string[]][])('it refuses %s before any read', (_name, args) => {
    const r = gate('dispatch_issue_gate', args);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('could not be read');
  });
});

// What both launchers must refuse, each with the reason the run prints. Every one of
// these is READY in all other respects when it reaches the dispatcher.
const cutShort = (i: Record<string, unknown>) => ({
  ...i,
  userContentEdits: { ...(i.userContentEdits as object), totalCount: 140 },
});
const REFUSED: { name: string; issue: IssueFixture; says: RegExp }[] = [
  { name: 'opened by a stranger', issue: { author: STRANGER }, says: /^Refusing #4242 — its author 'some-stranger' \(User 900000001\) is not on the dispatch author list\. /m },
  { name: 'opened by a collaborator who is not on the list', issue: { author: COLLABORATOR }, says: /^Refusing #4242 — its author 'outside-collab' \(User 900000002\) is not on the dispatch author list\. /m },
  // Stays refused: issues filed by a workflow's own token wait for a person.
  { name: "opened by GitHub's Actions App", issue: { author: ACTIONS_APP }, says: /^Refusing #4242 — its author 'github-actions' \(Bot 41898282\) is not on the dispatch author list\. /m },
  { name: "opened by a person holding the App's login", issue: { author: user('minspec-sdd', 900000010) }, says: /^Refusing #4242 — its author 'minspec-sdd' \(User 900000010\) is not on the dispatch author list\. /m },
  { name: "opened by an App holding the founder's login", issue: { author: bot('harvest316', 900000011) }, says: /^Refusing #4242 — its author 'harvest316' \(Bot 900000011\) is not on the dispatch author list\. /m },
  { name: "opened by an account shown with the founder's login and number, of another kind", issue: { author: bot('harvest316', 4125483) }, says: /^Refusing #4242 — its author 'harvest316' \(Bot 4125483\) is not on the dispatch author list\. /m },
  { name: 'opened by an account that has since been deleted', issue: { author: null }, says: /^Refusing #4242 — its author could not be read, and an author that cannot be read is never trusted\. /m },
  { name: 'opened by an account GitHub gave no number for', issue: { author: { __typename: 'User', login: 'harvest316' } }, says: /^Refusing #4242 — its author could not be read/m },
  { name: "the founder's, with its body edited by a collaborator", issue: { bodyEditors: [COLLABORATOR] }, says: /^Refusing #4242 — its body was edited by 'outside-collab' \(User 900000002\), who is not on the dispatch author list\. /m },
  { name: "the founder's, edited by a collaborator and then by the founder", issue: { bodyEditors: [COLLABORATOR, FOUNDER] }, says: /^Refusing #4242 — its body was edited by 'outside-collab' \(User 900000002\), who is not on/m },
  { name: "the App's, with its title changed by a collaborator", issue: { author: APP, titleChangers: [COLLABORATOR] }, says: /^Refusing #4242 — its title was changed by 'outside-collab' \(User 900000002\), who is not on the dispatch author list\. /m },
  { name: "the founder's, with an edit history that did not come back in full", issue: { bodyEditors: [FOUNDER], provenance: cutShort }, says: /^Refusing #4242 — who edited its body could not be read in full \(140 edit\(s\) recorded, 2 returned\)/m },
  { name: "the founder's, edited between the two reads", issue: { provenance: (i) => ({ ...i, body: `${String(i.body)}\nAnd one more thing.` }) }, says: /^Refusing #4242 — its title or body changed while it was being checked, so the text that was judged is not the text that would be used\. /m },
  { name: "the founder's, renamed between the two reads", issue: { provenance: (i) => ({ ...i, title: `${String(i.title)} (and more)` }) }, says: /^Refusing #4242 — its title or body changed while it was being checked/m },
  { name: "the founder's, when the read of who wrote it fails", issue: { provenanceFails: true }, says: /^Refusing #4242 — who wrote and edited it could not be read from GitHub, and what cannot be read is never trusted\. /m },
  { name: "the founder's, when the answer is not JSON", issue: { provenanceRaw: 'not json' }, says: /^Refusing #4242 — who wrote and edited it could not be read, and what cannot be read is never trusted\. /m },
  { name: "the founder's, when the answer is empty", issue: { provenanceRaw: '' }, says: /^Refusing #4242 — who wrote and edited it could not be read, and what cannot be read is never trusted\. /m },
];

/** Passes: every account that wrote the text is listed. */
const ALLOWED: { name: string; issue: IssueFixture }[] = [
  { name: 'opened by the founder', issue: { author: FOUNDER } },
  { name: 'opened by the App', issue: { author: APP } },
  { name: "the App's, edited and renamed by the founder", issue: { author: APP, bodyEditors: [FOUNDER], titleChangers: [FOUNDER] } },
];

describe('T0: the real scripts/triage-inbox.sh triages only an issue whose text is all from listed accounts', () => {
  it.each(ALLOWED)('control: an issue $name is triaged', ({ issue }) => {
    const r = runTriage({ issues: { '4242': issue }, only: '4242' });
    expect(r.status, r.out).toBe(0);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).toContain(ISSUE_BODY_MARKER);
    expect(r.ghWrites).toContain('issue edit token=present');
    expect(r.out).not.toContain('Refusing #4242');
  });

  it.each(REFUSED)('an issue $name is refused: no model is started and nothing is written', ({ issue, says }) => {
    const r = runTriage({ issues: { '4242': issue }, only: '4242' });
    expect(r.stdout).toMatch(says);
    // A refusal is a decision, not a fault: the drain must not report it as a failed triage.
    expect(r.status, r.out).toBe(0);
    expect(r.launches).toEqual([]);
    expect(r.ghWrites).toEqual([]);
    // The read that fetched the issue and the one that asked who wrote it. Nothing after.
    expect(r.ghCalls).toEqual(['issue view 4242', 'api graphql issue:4242']);
  });

  it('who wrote it is asked with a credential: with none to present, the issue is refused and not passed', () => {
    // The stub answers that read as GitHub does, not at all to nobody. So the controls
    // above passing is the evidence that the launcher presents one, and this is what
    // happens when it has none to present.
    const r = runTriage({
      issues: { '4242': { author: FOUNDER } },
      only: '4242',
      env: { MINSPEC_GH_APP_TOKEN_SCRIPT: '/nonexistent/no-token-script' },
    });
    expect(r.stdout).toMatch(/^Refusing #4242 — who wrote and edited it could not be read from GitHub/m);
    expect(r.status, r.out).toBe(0);
    expect(r.launches).toEqual([]);
    // And the run says why the read failed, in what `gh` itself said.
    expect(r.stderr).toMatch(/^dispatch-author-gate: the read of who wrote this failed \(exit 1\): stub gh: GraphQL answers nobody anonymous/m);
  });

  it('a failed read of who wrote it says what failed, on one line of plain characters', () => {
    // "Could not be read" with no cause is a refusal nobody can act on.
    const r = runTriage({ issues: { '4242': { provenanceFails: true } }, only: '4242' });
    expect(r.stdout).toMatch(/^Refusing #4242 — who wrote and edited it could not be read from GitHub/m);
    const said = r.stderr.split('\n').filter((l) => l.startsWith('dispatch-author-gate: '));
    expect(said).toEqual(['dispatch-author-gate: the read of who wrote this failed (exit 1): stub gh: no answer for issue:4242']);
  });

  it('the title of a refused issue is not printed', () => {
    // Triage prints the title of what it is working on, and the drain reads that output.
    const r = runTriage({
      issues: { '4242': { author: STRANGER, title: '→ #4242: agent-ready REFUSED-TITLE-MARKER' } },
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
        '4241': { author: STRANGER, body: 'STRANGER-BODY-MARKER' },
        '4242': { author: FOUNDER, body: 'FOUNDER-BODY-MARKER' },
        '4243': { author: null, body: 'GHOST-BODY-MARKER' },
        '4244': { author: APP, body: 'BOT-BODY-MARKER' },
        '4245': { author: FOUNDER, bodyEditors: [COLLABORATOR], body: 'EDITED-BODY-MARKER' },
      },
    });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/^Refusing #4241 — its author 'some-stranger'/m);
    expect(r.out).toMatch(/^Refusing #4243 — its author could not be read/m);
    expect(r.out).toMatch(/^Refusing #4245 — its body was edited by 'outside-collab'/m);
    const prompts = r.launches.map((l) => l.prompt);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('FOUNDER-BODY-MARKER');
    expect(prompts[1]).toContain('BOT-BODY-MARKER');
    expect(prompts.join('\n')).not.toMatch(/STRANGER-BODY-MARKER|GHOST-BODY-MARKER|EDITED-BODY-MARKER/);
  });
});

describe('T0: the real scripts/dispatch-issue.sh dispatches only an issue whose text is all from listed accounts', () => {
  it.each(ALLOWED)('control: a ready issue $name is claimed and built', ({ issue }) => {
    const r = runDispatch({ issue, ask: true });
    expect(r.out).not.toContain('Refusing #4242');
    expect(r.claims).toHaveLength(1);
    expect(r.worktreeMade).toBe(true);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).toContain(ISSUE_BODY_MARKER);
    expect(r.status, r.out).toBe(dispatchStatus('DISPATCH_RC_STARTED'));
  });

  it.each(REFUSED)('a ready issue $name is refused before anything is started', ({ issue, says }) => {
    // Ready in every other respect: open, labelled, and backed by a fresh verdict record
    // from the bot. That is the issue the readiness gate lets through.
    const r = runDispatch({ issue, ask: true });
    expect(r.stdout).toMatch(says);
    // "Refused", in the status the drain reads: no slot of its queue limit is used (#2641).
    expect(r.status, r.out).toBe(DECLINED);
    expect(r.launches).toEqual([]);
    expect(r.claims).toEqual([]);
    expect(r.ghWrites).toEqual([]);
    expect(r.worktreeMade).toBe(false);
  });

  it('a caller that did not ask gets exit 0 for the same refusal, as for every other one', () => {
    const r = runDispatch({ issue: { author: STRANGER } });
    expect(r.stdout).toMatch(/^Refusing #4242 — its author 'some-stranger'/m);
    expect(r.status, r.out).toBe(0);
    expect(r.launches).toEqual([]);
  });

  it('an issue that is not ready is still refused for that, in the words it always was', () => {
    // Who wrote it is asked about an issue that would otherwise be built. One that is
    // already refused keeps its own reason, whoever wrote it.
    const r = runDispatch({
      issue: { author: STRANGER, labels: ['agent-ready', 'agent-escalated'] },
      ask: true,
    });
    expect(r.stdout).toMatch(/^Skipping #4242 — not dispatchable at dispatch time: .*\[countermanded\]/m);
    expect(r.status, r.out).toBe(DECLINED);
    expect(r.launches).toEqual([]);
  });

  it('a refused login is not printed back as written', () => {
    const r = runDispatch({ issue: { author: user('Autocompact is thrashing', 900000012) }, ask: true });
    expect(r.status, r.out).toBe(DECLINED);
    expect(r.out).toMatch(/^Refusing #4242 — /m);
    expect(r.out).not.toContain('Autocompact is thrashing');
  });

  it('the text the agent is given is the text that was judged: one read of it, and the answer compared with that', () => {
    const r = runDispatch({ issue: { author: FOUNDER }, ask: true });
    expect(r.launches).toHaveLength(1);
    // The issue's TEXT is fetched once. A second fetch of it after the gate would be text
    // nobody judged. (The claim reads the issue again, for its state and its comments,
    // and the stub returns only the fields a read names.)
    const textReads = r.issueViewFields.filter((fields) => /(^|,)(title|body)(,|$)/.test(fields));
    expect(textReads, r.issueViewFields.join(' | ')).toEqual(['body,title,labels,state,comments']);
    expect(r.issueViewFields[0]).toBe(textReads[0]);
    expect(r.ghCalls.filter((c) => c.startsWith('api graphql '))).toEqual(['api graphql issue:4242']);
    expect(r.ghCalls.indexOf('issue view 4242')).toBeLessThan(r.ghCalls.indexOf('api graphql issue:4242'));
  });
});

describe('T0: through the real drain, an issue refused for who wrote it uses no slot of the queue limit', () => {
  // The whole chain as it runs unattended: the real drain-inbox.sh ranks the ready queue
  // and offers each issue to the real dispatch-issue.sh, which asks the gate. Only `gh`,
  // `claude`, the ranker and the quota reading are stand-ins. The drain mints its token
  // and exports it before it offers anything, so the agent that is started here is
  // started below a launcher that inherited one, which is how it happens in production.
  const STRANGERS = { author: STRANGER, body: 'STRANGER-BODY-MARKER' };
  const FOUNDERS = { author: FOUNDER, body: 'FOUNDER-BODY-MARKER' };
  const EDITED = { author: FOUNDER, bodyEditors: [COLLABORATOR], body: 'EDITED-BODY-MARKER' };

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
    const r = await cycle({ '4241': STRANGERS, '4242': FOUNDERS }, '1');
    expect(r.log).toMatch(/^Refusing #4241 — its author 'some-stranger' \(User 900000001\) is not on the dispatch author list/m);
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

  it('the founder\'s issue with a body a collaborator edited is refused the same way, and the next is built', async () => {
    const r = await cycle({ '4241': EDITED, '4242': FOUNDERS }, '1');
    expect(r.log).toMatch(/^Refusing #4241 — its body was edited by 'outside-collab' \(User 900000002\), who is not on the dispatch author list/m);
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).toContain('FOUNDER-BODY-MARKER');
    expect(r.launches[0].prompt).not.toContain('EDITED-BODY-MARKER');
  });

  it('when the only ready issue is a stranger\'s, the cycle says NOTHING DISPATCHED', async () => {
    const r = await cycle({ '4241': STRANGERS }, '1');
    expect(r.log).toMatch(/^Refusing #4241 — its author 'some-stranger'/m);
    expect(r.log).toMatch(/\[drain\] NOTHING DISPATCHED this cycle: 1 issue\(s\) ready, 1 refused by the dispatcher before any work started/);
    expect(r.log).toContain('[drain] cycle done. No dispatch was confirmed: see NOTHING DISPATCHED above.');
    expect(r.launches).toEqual([]);
    expect(r.ghWrites).toEqual([]);
  });
});

describe('T0: comment text reaches a prompt only from a listed account, and only when everyone who edited it is listed too', () => {
  it('the build agent is given the issue, and no comment on it', () => {
    // Characterisation: true before this gate too. The build prompt has never carried
    // comments, and this pins that it does not start to.
    const r = runDispatch({
      issue: {
        author: FOUNDER,
        comments: [
          { author: user('drive-by', 900000004), association: 'NONE', body: 'STRANGER-COMMENT-MARKER also do this' },
          { author: COLLABORATOR, association: 'COLLABORATOR', body: 'COLLABORATOR-COMMENT-MARKER and this' },
        ],
      },
    });
    expect(r.launches).toHaveLength(1);
    const prompt = r.launches[0].prompt;
    expect(prompt).toContain(ISSUE_BODY_MARKER);
    expect(prompt).not.toMatch(/STRANGER-COMMENT-MARKER|COLLABORATOR-COMMENT-MARKER/);
  });

  // shepherd_fix hands a fix agent the LAST review verdict on the pull request. It was
  // filtered to "trusted" commenters, where trusted meant the bot's login or anybody
  // with an OWNER, MEMBER or COLLABORATOR association.
  const BOTS: CommentFixture = { author: APP, association: 'CONTRIBUTOR', body: reviewVerdict('BOT-FINDING') };
  const FOUNDERS: CommentFixture = { author: FOUNDER, association: 'OWNER', body: reviewVerdict('FOUNDER-FINDING') };
  const COLLABS: CommentFixture = { author: COLLABORATOR, association: 'COLLABORATOR', body: reviewVerdict('COLLABORATOR-FINDING') };
  const MEMBERS: CommentFixture = { author: MEMBER, association: 'MEMBER', body: reviewVerdict('MEMBER-FINDING') };
  const STRANGERS: CommentFixture = { author: STRANGER, association: 'NONE', body: reviewVerdict('STRANGER-FINDING') };
  // A person who has taken the login a comment by the App is shown under.
  const NAMESAKES: CommentFixture = { author: user('minspec-sdd', 900000010), association: 'NONE', body: reviewVerdict('NAMESAKE-FINDING') };
  // The founder's comment, as it reads after a collaborator edited it.
  const EDITED: CommentFixture = { author: FOUNDER, association: 'OWNER', body: reviewVerdict('EDITED-IN-FINDING'), editors: [COLLABORATOR] };

  it('control: the fix agent is given the last verdict from a listed account', () => {
    const r = runFixAgent({ comments: [BOTS, FOUNDERS] });
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).toContain('FOUNDER-FINDING');
    // The stub agent brings back no commit, and the function says so rather than publishing.
    expect(r.fixReturned).toBe(1);
    const other = runFixAgent({ comments: [FOUNDERS, BOTS] });
    expect(other.launches[0].prompt).toContain('BOT-FINDING');
  });

  it('control: a verdict its own listed author edited afterwards is still given', () => {
    const r = runFixAgent({ comments: [BOTS, { ...FOUNDERS, editors: [FOUNDER] }] });
    expect(r.launches[0].prompt).toContain('FOUNDER-FINDING');
    expect(r.stderr).not.toContain('dropped');
  });

  it.each([
    { name: 'a collaborator who is not on the list', late: COLLABS, marker: 'COLLABORATOR-FINDING', says: "'outside-collab' (User 900000002)" },
    { name: 'a member who is not on the list', late: MEMBERS, marker: 'MEMBER-FINDING', says: "'new-member' (User 900000003)" },
    { name: 'a stranger', late: STRANGERS, marker: 'STRANGER-FINDING', says: "'some-stranger' (User 900000001)" },
    { name: "a person holding the App's login", late: NAMESAKES, marker: 'NAMESAKE-FINDING', says: "'minspec-sdd' (User 900000010)" },
    { name: 'the founder, in a comment a collaborator has edited', late: EDITED, marker: 'EDITED-IN-FINDING', says: "'harvest316' (User 4125483), in a comment that an account not on the list has edited" },
  ])('a later verdict from $name is dropped, and the run says so', ({ late, marker, says }) => {
    const r = runFixAgent({ comments: [BOTS, late] });
    expect(r.launches).toHaveLength(1);
    const prompt = r.launches[0].prompt;
    expect(prompt).not.toContain(marker);
    // Dropped, not refused: the agent still gets the verdict it is entitled to.
    expect(prompt).toContain('BOT-FINDING');
    expect(r.stderr).toMatch(/dropped 1 of 2 comment\(s\) on pull request #77/);
    expect(r.stderr).toContain(says);
    expect(r.stderr).toContain('not wholly from the dispatch author list');
    expect(r.fixReturned).toBe(1);
  });

  it('with only unlisted commenters, the agent is started with no review text at all', () => {
    const r = runFixAgent({ comments: [COLLABS, STRANGERS, NAMESAKES] });
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).not.toMatch(/COLLABORATOR-FINDING|STRANGER-FINDING|NAMESAKE-FINDING|REVIEW_VERDICT_BEGIN/);
    expect(r.stderr).toMatch(/dropped 3 of 3 comment\(s\)/);
  });

  it.each([
    ['the read of who wrote the comments fails', { commentsUnreadable: true }],
    ['the answer is not JSON', { commentsRaw: 'not json' }],
    ['the answer reports an error', { commentsRaw: JSON.stringify({ ...JSON.parse(commentsAnswer([BOTS])), errors: [{ message: 'x' }] }) }],
  ] as [string, Partial<FixAgentOptions>][])('when %s, no comment text reaches the agent, and the run says so', (_name, how) => {
    // `gh pr view` would still return these comments, with a login beside each. That is
    // not who wrote them, so nothing is taken from it.
    const r = runFixAgent({ comments: [BOTS, FOUNDERS], ...how });
    expect(r.launches).toHaveLength(1);
    expect(r.launches[0].prompt).not.toMatch(/BOT-FINDING|FOUNDER-FINDING|REVIEW_VERDICT_BEGIN/);
    expect(r.stderr).toContain('could not read the comments on pull request #77, so no comment text is given to the agent');
    expect(r.fixReturned).toBe(1);
  });

  it('when GitHub holds more comments than were read, the run says so', () => {
    const r = runFixAgent({ comments: [BOTS, FOUNDERS], total: 140 });
    expect(r.launches[0].prompt).toContain('FOUNDER-FINDING');
    expect(r.stderr).toContain('pull request #77 has 140 comments and only the newest 2 were read');
  });

  it('nothing is said when nothing is dropped', () => {
    const r = runFixAgent({ comments: [BOTS, FOUNDERS] });
    expect(r.stderr).not.toContain('dropped');
    expect(r.stderr).not.toContain('could not read');
    expect(r.stderr).not.toContain('were read');
  });
});

describe('scripts/lib/dispatch-author-gate.sh: filtering a list of comments', () => {
  const filter = (doc: string) => gate('dispatch_trusted_comments', ['pull request #77'], { input: doc });
  const c = (author: unknown, body: string, more: Partial<CommentFixture> = {}): CommentFixture => ({ author, body, ...more });
  const bodies = (stdout: string) => (JSON.parse(stdout) as { comments: { body: string }[] }).comments.map((k) => k.body);

  it('keeps comments by the App and the founder, in order, in the shape the next filter reads', () => {
    const r = filter(
      commentsAnswer([
        c(APP, 'one', { association: 'CONTRIBUTOR' }),
        c(user('drive-by', 900000004), 'two'),
        c(COLLABORATOR, 'three', { association: 'COLLABORATOR' }),
        c(FOUNDER, 'four', { association: 'OWNER' }),
        c(ACTIONS_APP, 'five', { association: 'CONTRIBUTOR' }),
        c(user('minspec-sdd', 900000010), 'six'),
        c(bot('harvest316', 900000011), 'seven'),
      ]),
    );
    expect(r.status).toBe(0);
    expect(bodies(r.stdout)).toEqual(['one', 'four']);
    const kept = (JSON.parse(r.stdout) as { comments: Record<string, unknown>[] }).comments;
    // Exactly what dispatch-ready-check.sh --trusted-comment-bodies reads, and no more.
    expect(kept[0]).toEqual({ author: { login: 'minspec-sdd' }, authorAssociation: 'CONTRIBUTOR', body: 'one', createdAt: '2026-10-01T00:00:00Z' });
    expect(r.stderr).toMatch(/dropped 5 of 7 comment\(s\) on pull request #77 whose text is not wholly from the dispatch author list/);
    for (const who of ["'drive-by' (User 900000004)", "'outside-collab'", "'github-actions' (Bot 41898282)", "'minspec-sdd' (User 900000010)", "'harvest316' (Bot 900000011)"]) {
      expect(r.stderr).toContain(who);
    }
  });

  it('a comment somebody else has edited is dropped, whoever wrote it and whoever edited it last', () => {
    const r = filter(
      commentsAnswer([
        c(FOUNDER, 'kept: edited by its own author', { editors: [FOUNDER] }),
        c(FOUNDER, 'kept: edited by the App', { editors: [APP] }),
        c(FOUNDER, 'edited by a collaborator', { editors: [COLLABORATOR] }),
        c(APP, 'edited by a collaborator, then by the founder', { editors: [COLLABORATOR, FOUNDER] }),
        c(FOUNDER, 'last editor is not in the history', { editors: [FOUNDER], node: (n) => ({ ...n, editor: STRANGER }) }),
        c(FOUNDER, 'an editor and no edit time', { node: (n) => ({ ...n, editor: STRANGER }) }),
        c(FOUNDER, 'a history cut short', { editors: [FOUNDER], node: (n) => ({ ...n, userContentEdits: { ...(n.userContentEdits as object), totalCount: 21 } }) }),
        c(FOUNDER, 'edited, with no history', { editors: [FOUNDER], node: (n) => ({ ...n, userContentEdits: { totalCount: 0, nodes: [] } }) }),
        c(FOUNDER, 'edited by a deleted account', { editors: [null] }),
        c(FOUNDER, 'no history field', { node: (n) => { const copy = { ...n }; delete copy.userContentEdits; return copy; } }),
        c(FOUNDER, 'no editor field', { node: (n) => { const copy = { ...n }; delete copy.editor; return copy; } }),
      ]),
    );
    expect(r.status).toBe(0);
    expect(bodies(r.stdout)).toEqual(['kept: edited by its own author', 'kept: edited by the App']);
    expect(r.stderr).toMatch(/dropped 9 of 11 comment\(s\)/);
    expect(r.stderr).toContain("'harvest316' (User 4125483), in a comment that an account not on the list has edited or that could not be read in full");
  });

  it.each(UNREADABLE)('a comment whose author is %s is dropped', (_why, a) => {
    const r = filter(commentsAnswer([c(a, 'unreadable'), c(FOUNDER, 'kept')]));
    expect(bodies(r.stdout)).toEqual(['kept']);
    expect(r.stderr).toMatch(/dropped 1 of 2 comment\(s\)/);
  });

  it('a comment that is not an object, or has no body, is dropped', () => {
    const doc = JSON.parse(commentsAnswer([c(FOUNDER, 'kept')])) as {
      data: { repository: { pullRequest: { comments: { totalCount: number; nodes: unknown[] } } } };
    };
    const list = doc.data.repository.pullRequest.comments;
    const good = list.nodes[0] as Record<string, unknown>;
    list.nodes = [null, 'text', { ...good, body: null }, good];
    list.totalCount = 4;
    const r = filter(JSON.stringify(doc));
    expect(bodies(r.stdout)).toEqual(['kept']);
    expect(r.stderr).toMatch(/dropped 3 of 4 comment\(s\)/);
  });

  it('a pull request with no comments is an empty list, silently', () => {
    const r = filter(commentsAnswer([]));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ comments: [] });
    expect(r.stderr).toBe('');
  });

  it('says so when GitHub holds more comments than the answer returned', () => {
    const r = filter(commentsAnswer([c(FOUNDER, 'kept')], 140));
    expect(r.status).toBe(0);
    expect(bodies(r.stdout)).toEqual(['kept']);
    expect(r.stderr).toContain('pull request #77 has 140 comments and only the newest 1 were read. An older comment is not given to the agent.');
  });

  const ONE = commentsAnswer([c(FOUNDER, 'a')]);
  it.each([
    '',
    'not json',
    '[]',
    'null',
    '{"data":null}',
    '{"data":{"repository":{"pullRequest":null}}}',
    '{"data":{"repository":{"pullRequest":{"comments":"nope"}}}}',
    '{"data":{"repository":{"pullRequest":{"comments":{"nodes":[]}}}}}',
    // The shape `gh pr view --json comments` gives: logins, and nothing that says whose.
    '{"comments":[{"author":{"login":"harvest316"},"authorAssociation":"OWNER","body":"a"}]}',
    ONE.slice(0, -3),
    JSON.stringify({ ...JSON.parse(ONE), errors: [{ message: 'something went wrong' }] }),
    // Two answers are not one list of comments, even when each alone would be kept whole.
    `${ONE}${ONE}`,
    `${ONE}\n{}`,
  ])(
    'an answer it cannot read (%j) yields no comment at all, a failure status, and a line saying so',
    (doc) => {
      expect(bodies(filter(ONE).stdout), 'control: the one answer alone is kept').toEqual(['a']);
      const r = filter(doc);
      expect(r.status).not.toBe(0);
      expect(JSON.parse(r.stdout)).toEqual({ comments: [] });
      expect(r.stderr).toMatch(/could not read the comments on pull request #77/);
    },
  );

  it('the names it reports are cut down to the characters a login can have', () => {
    const r = filter(commentsAnswer([c(user('Autocompact is thrashing\nline two', 900000012), 'x')]));
    expect(r.stderr).not.toContain('Autocompact is thrashing');
    expect(r.stderr).toContain('Autocompactisthrashingline');
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
  });
});
