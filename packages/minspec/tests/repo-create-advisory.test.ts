/**
 * T0 — repo-create advisory (#1694), governed by DR-050 Amendment 2026-08-25.
 *
 * CONTRACT-DRIVEN: this file is written BEFORE the implementation exists and is
 * EXPECTED to fail today with "does not provide an export named
 * 'probeOwnerCandidates'" (or the same for `createGitHubRepo`). That is the
 * intended red — a syntax/import-path error would NOT be.
 *
 * THE BUG. After "MinSpec: Initialize SDD Structure" in a repo with no GitHub
 * remote, `offerRulesetAdvisory` printed a dead end: "add a GitHub remote, then
 * create a branch ruleset — see the GitHub docs." It names the obstacle and
 * hands over a docs page, inside an extension that already mutates GitHub config
 * on a click. The fix replaces it with an OFFER —
 * [Create GitHub repo] [Not now] [Learn more] — that creates the repo via the
 * user's own `gh`, sets the remote, and STOPS.
 *
 * IT DOES NOT FALL THROUGH INTO THE RULESET ADVISORY, and this paragraph said it
 * did until 2026-08-29. The repository the offer creates is EMPTY (the create
 * deliberately carries no `--push`), so the ruleset offer would ask for checks
 * nothing can report — #559's permanent-pending deadlock, at the one moment
 * MinSpec knows for certain that no check is producible. The C1 block below owns
 * that stop and states the reasoning; this header contradicted it, which makes
 * the file's own first paragraph the least trustworthy thing in it.
 *
 * INVARIANTS UNDER TEST (each is a T0 target; the section headings name them):
 *   INV-1  Tier-0 / no socket. Every network action shells the USER's `gh`
 *          through the injected {@link CommandRunner}. No new http/https/net/
 *          fetch/axios/node-fetch/got/undici import in packages/minspec or
 *          packages/shared; no `child_process` import at a call site — only the
 *          single sanctioned `defaultCommandRunner`.
 *   INV-2  Mutation is consent-gated. The repo is created ONLY on the explicit
 *          "Create GitHub repo" click, exactly as `createRequiredChecksRuleset`
 *          is gated today.
 *   INV-3  The org probe is BRANCH-SCOPED. `gh api /user/memberships/orgs` runs
 *          ONLY where `gh` is ready AND no GitHub remote resolves. A repo that
 *          already resolves a GitHub remote must NEVER trigger it. This is a
 *          load-bearing bound of DR-050's amendment, not optional hardening.
 *   INV-4  No persistence. The org list is never written to VS Code settings,
 *          workspace state, a cache file, or anything under `.minspec/`.
 *   INV-5  Fail-safe. ANY probe failure (unauthed, missing read:org, rate limit,
 *          non-zero exit, malformed JSON, spawn rejection) degrades to a
 *          personal-account-only offer plus the docs link. Never throws, never
 *          blocks, never fails the init.
 *   INV-6  Never claim App-install detection. `role: admin` is a PROXY for
 *          "where you could create/install", never evidence MinSpec is
 *          installed — MinSpec cannot detect installs at all (/user/installations
 *          → 403, /orgs/{org}/installation → 401 with a gh OAuth token, tested
 *          2026-08-25). Asserted as a deny-list over the RENDERED strings,
 *          because prose enforcing prose is the failure mode the constitution
 *          names.
 *   INV-7  Zero-network fallback intact. `gh` missing/unauthed → the existing
 *          docs-link path still fires, with zero `gh api`.
 *
 * Plus the OWNER-DEFAULTING rule: memberships filtered to state 'active'; if
 * exactly ONE org has role 'admin' that org is the DEFAULT pick (personal
 * account still selectable); otherwise the personal account leads, with
 * admin-capable orgs ordered ahead of member-only ones. Encoded as ORDER:
 * `candidates[0]` IS the default pick.
 *
 * Two shape pins the implementation must honour (chosen here, stated plainly so
 * they are a decision and not an accident):
 *   - the memberships read returns RAW JSON (no `--jq`), so the TS side parses a
 *     structured array; the identity read may use `--jq .login` (the contract
 *     names it) and this runner answers either form.
 *   - `candidates[0]` is the default pick, and the offer NAMES that destination
 *     up front — DR-050's stated reason for permitting the read at all.
 *
 * The command runner is ALWAYS mocked: these tests never hit the network and
 * never create a real repository.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Mock vscode (only what the advisory touches) ────────────────────────────
// Lazy wrappers so the hoisted `vi.mock` factory dereferences these consts at
// CALL time, not at factory time (the coverage-onboarding.test.ts idiom).

const showInformationMessage = vi.fn();
const showQuickPick = vi.fn();
const showInputBox = vi.fn();
const configGet = vi.fn();
/** Settings WRITE. INV-4: must never be called by the probe or the offer. */
const configUpdate = vi.fn();
/**
 * WARNING toasts, HOISTED into a const like the others rather than left as an
 * anonymous `vi.fn()` inside the factory.
 *
 * F7 is entirely about what this mock records: a flow the user consented to with
 * an explicit "Create GitHub repo" click may not end in silence, and an
 * un-referenceable spy makes "it said nothing" and "it said something nobody
 * looked at" the same observation.
 */
const showWarningMessage = vi.fn();

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: (...args: unknown[]) => showInformationMessage(...args),
    showErrorMessage: vi.fn(),
    showWarningMessage: (...args: unknown[]) => showWarningMessage(...args),
    showQuickPick: (...args: unknown[]) => showQuickPick(...args),
    showInputBox: (...args: unknown[]) => showInputBox(...args),
    showTextDocument: vi.fn(),
  },
  env: { openExternal: vi.fn() },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  commands: { executeCommand: vi.fn() },
  workspace: {
    getConfiguration: () => ({ get: configGet, update: configUpdate }),
    openTextDocument: vi.fn(),
  },
}));

// ─── Imports (the contract's names are imported DIRECTLY, so a missing export
//     fails loudly today rather than passing vacuously) ─────────────────────

import {
  RULESET_DOCS_URL,
  REPO_CREATE_DOCS_URL,
  probeOwnerCandidates,
  createGitHubRepo,
  isPlanLimited,
  isSafeRepoSegment,
} from '../src/lib/ruleset-advisor';
import type {
  CommandResult,
  CommandRunner,
  RepoOwnerCandidate,
  CreateRepoResult,
} from '../src/lib/ruleset-advisor';
import { offerRulesetAdvisory, initCommand, initRefreshCommand } from '../src/commands/init';
import type { RemoteDestination } from '../src/commands/init';
import { scaffold, generateHarnessFiles } from '../src/lib/scaffold';

// ─── Toast action labels (literals, as the sibling suite uses) ───────────────

/** The MUTATING action. This click IS the consent (INV-2, DR-050). */
const REPO_CREATE_ACTION = 'Create GitHub repo';
/**
 * The retry offered when a create FAILS (C6). A name collision is the failure
 * this path hits most — the box is seeded with the folder basename and does no
 * existence check — so the remedy has to lead back to the name box rather than
 * end the flow.
 */
const REPO_RETRY_ACTION = 'Try another name';
const DECLINE_ACTION = 'Not now';
const LEARN_MORE_ACTION = 'Learn more';
const DOCS_ACTION = 'View GitHub docs';
const RULESET_CREATE_ACTION = 'Create ruleset';
const RULESET_ADD_ACTION = 'Add checks';

// ─── Local shapes for the injected seams ─────────────────────────────────────

/** The signature `deps.createRepo` must satisfy, so the fakes below are typed. */
type RulesetAdvisoryDepsCreateRepo = (
  folder: string,
  owner: string | null,
  name: string,
  visibility: 'private' | 'public',
  run: CommandRunner,
) => Promise<CreateRepoResult>;

/**
 * What the owner probe reports: the rows AND whether the org read succeeded.
 *
 * Declared here rather than imported so the C4 test can assert the shape without
 * the whole file failing to load on the day the export does not exist yet.
 */
interface OrgProbeShape {
  candidates: RepoOwnerCandidate[];
  orgsRead: boolean;
}

// ─── Scriptable command runner (the house factory) ───────────────────────────

type Reply = CommandResult | { throws: string };

function ok(stdout: string): CommandResult {
  return { code: 0, stdout, stderr: '' };
}
function fail(code: number, stderr: string): CommandResult {
  return { code, stdout: '', stderr };
}

function makeRunner(
  match: (cmd: string, args: string[]) => Reply | undefined,
): { run: CommandRunner; calls: Array<{ cmd: string; args: string[]; stdin?: string }> } {
  const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = [];
  const run: CommandRunner = async (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin });
    const reply = match(cmd, args);
    if (reply === undefined) {
      throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
    }
    if ('throws' in reply) throw new Error(reply.throws);
    return reply;
  };
  return { run, calls };
}

/** First arg after `api` for `gh api <path>`, leading slash normalised away. */
function apiPath(args: string[]): string | undefined {
  const i = args.indexOf('api');
  if (i < 0) return undefined;
  const raw = args.slice(i + 1).find((a) => !a.startsWith('-'));
  return raw?.replace(/^\//, '');
}

/** `gh api repos/...` (read or write) — the repo-scoped surface. */
function isRepoApiCall(args: string[]): boolean {
  return apiPath(args)?.startsWith('repos/') ?? false;
}

/** The org-membership read this feature adds. INV-3 keys every bound on it. */
function isMembershipsRead(args: string[]): boolean {
  return args.includes('api') && (apiPath(args)?.startsWith('user/memberships/orgs') ?? false);
}

/** The identity read that supplies the personal login. */
function isIdentityRead(args: string[]): boolean {
  return args.includes('api') && apiPath(args) === 'user';
}

/**
 * ANY route that could create a repository. Deliberately wider than the one the
 * brief names (`gh repo create`), so "no repo was created" is airtight even if
 * the implementation reaches for `gh api -X POST /user/repos` instead.
 */
function isRepoCreateMutation(cmd: string, args: string[]): boolean {
  if (cmd !== 'gh') return false;
  if (args[0] === 'repo' && args[1] === 'create') return true;
  const p = apiPath(args) ?? '';
  const posts = args.includes('POST');
  return posts && (p === 'user/repos' || /^orgs\/[^/]+\/repos$/.test(p));
}

/** The exact form the brief specifies, for POSITIVE assertions. */
function isGhRepoCreate(cmd: string, args: string[]): boolean {
  return cmd === 'gh' && args[0] === 'repo' && args[1] === 'create';
}

// ─── Rendered-string capture (INV-6 deny-list; INV-4 picker witness) ─────────

/** Every QuickPick invocation, with its items already resolved. */
const quickPickCalls: Array<{ items: unknown[]; options: unknown }> = [];

/** Deep-collect every string a value renders (labels, descriptions, details). */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
  return out;
}

/**
 * Every string the flow put in front of the user: toasts, picks, inputs — and
 * WARNINGS, which F7 added as the surface a consented-but-aborted flow speaks
 * through. A deny-list that scanned only the happy toasts would let a false claim
 * ship in the sentence a user sees when something went wrong.
 */
function renderedStrings(): string[] {
  return [
    ...collectStrings(showInformationMessage.mock.calls),
    ...collectStrings(showWarningMessage.mock.calls),
    ...collectStrings(quickPickCalls),
    ...collectStrings(showInputBox.mock.calls),
  ];
}

// ─── Toast answering, dispatched by ACTION SET rather than call order ────────
// Order-insensitive on purpose: the create path fires a fire-and-forget success
// toast between the two offers, and a queue-based chain would silently
// mis-align if that toast is added or removed.

interface ToastAnswers {
  repoOffer?: string;
  rulesetOffer?: string;
  /** Answer to the create-FAILURE toast, which carries the retry (C6). */
  createFailure?: string;
  docs?: string;
}

function answerToasts(answers: ToastAnswers): void {
  showInformationMessage.mockImplementation(async (_message: string, ...actions: string[]) => {
    if (actions.includes(REPO_CREATE_ACTION)) return answers.repoOffer;
    if (actions.includes(RULESET_CREATE_ACTION) || actions.includes(RULESET_ADD_ACTION)) {
      return answers.rulesetOffer;
    }
    // BEFORE the docs branch: the create-failure toast carries the docs action
    // too, so dispatching on `DOCS_ACTION` first would swallow every retry.
    if (actions.includes(REPO_RETRY_ACTION)) return answers.createFailure;
    if (actions.includes(DOCS_ACTION)) return answers.docs;
    return undefined;
  });
}

/** The toast that offered to create a repo, if it fired. */
function repoOfferCall(): unknown[] | undefined {
  return showInformationMessage.mock.calls.find((c: unknown[]) =>
    c.slice(1).includes(REPO_CREATE_ACTION),
  );
}

/** The docs-link toast, if it fired. */
function docsToastCall(): unknown[] | undefined {
  return showInformationMessage.mock.calls.find((c: unknown[]) => c.slice(1).includes(DOCS_ACTION));
}

/** The toast that offered to create a RULESET, if it fired. */
function rulesetOfferCall(): unknown[] | undefined {
  return showInformationMessage.mock.calls.find(
    (c: unknown[]) => c.slice(1).includes(RULESET_CREATE_ACTION) || c.slice(1).includes(RULESET_ADD_ACTION),
  );
}

/** The create-FAILURE toast (the one carrying the retry), if it fired. */
function createFailureToastCall(): unknown[] | undefined {
  return showInformationMessage.mock.calls.find((c: unknown[]) =>
    c.slice(1).includes(REPO_RETRY_ACTION),
  );
}

/** Everything the flow said, joined — for "this sentence was never uttered" assertions. */
function everythingSaid(): string {
  return collectStrings(showInformationMessage.mock.calls).join(' ');
}

// ─── Telling the two QuickPicks apart ────────────────────────────────────────
// Identified by CONTENT, not by call order: the visibility pick is the one
// offering both private and public, and the owner pick is the other. Keying on
// order would silently mis-identify them the moment a pick is added, reordered,
// or skipped — and "the owner pick was skipped" is exactly the regression these
// helpers exist to catch.

interface PickCall {
  items: unknown[];
  options: unknown;
}

function visibilityPickCall(): PickCall | undefined {
  return quickPickCalls.find((c) => {
    const text = collectStrings(c.items).join(' ');
    return /private/i.test(text) && /public/i.test(text);
  });
}

/** The OWNER pick, or `undefined` when the flow never opened one. */
function ownerPickCall(): PickCall | undefined {
  const visibility = visibilityPickCall();
  return quickPickCalls.find((c) => c !== visibility);
}

/** `{ label, description }` of every row the owner picker offered. */
function ownerPickRows(): Array<{ label: string; description: string }> {
  const rows = (ownerPickCall()?.items ?? []) as Array<{ label?: unknown; description?: unknown }>;
  return rows.map((r) => ({ label: String(r.label ?? ''), description: String(r.description ?? '') }));
}

/**
 * Drive both QuickPicks: private for visibility, and the OWNER row whose label
 * is `wantedOwner`.
 *
 * `wantedOwner` is deliberately answered by LABEL rather than by index, so a
 * test can ask for a row that is NOT the default pick. That is the only way to
 * observe that the picker's return value is used at all: with the default
 * accepted every time, `await pickOwner(candidates)` and `candidates[0]` are
 * indistinguishable.
 *
 * A missing row returns `undefined` (the Escape path), which shows up as "no
 * repository was created" rather than as a swallowed exception — the advisory
 * catches everything, so a throw in here would vanish.
 */
function answerPickers(wantedOwner: string): void {
  showQuickPick.mockImplementation(async (items: unknown, options?: unknown) => {
    const resolved = (await items) as Array<{ label?: unknown }>;
    quickPickCalls.push({ items: resolved, options });
    const text = collectStrings(resolved).join(' ');
    if (/private/i.test(text) && /public/i.test(text)) return resolved[0];
    return resolved.find((row) => String(row.label ?? '') === wantedOwner);
  });
}

// ─── Membership fixtures (the GitHub API shape) ──────────────────────────────

function membership(
  login: string,
  role: 'admin' | 'member',
  state: 'active' | 'pending' = 'active',
): Record<string, unknown> {
  return { state, role, organization: { login } };
}

/**
 * The account `gh` is signed in as.
 *
 * MinSpec NEVER READS THIS. It appears here only in what `gh` REPORTS BACK from
 * a create issued with no owner prefix — which is the whole reason the personal
 * account needs no identity read, and why the personal candidate carries
 * `login: null` rather than a name. Any test that expects this string to appear
 * in an ARGUMENT is asserting the wrong thing.
 */
const PERSONAL_LOGIN = 'octocat';

/**
 * A runner for the NO-REMOTE branch. `memberships` is the raw JSON body of the
 * `/user/memberships/orgs` read unless `membershipsReply` overrides it.
 */
function noRemoteRunner(
  opts: {
    memberships?: Array<Record<string, unknown>>;
    membershipsReply?: Reply;
    createReply?: Reply;
    createdSlug?: string;
    /**
     * What `git remote get-url origin` answers AFTER the create ran — the ONE
     * local read that settles whether `gh repo create --source` got as far as
     * wiring the remote (C2).
     *
     * Unset ⇒ the honest default: the created repository's URL once a create has
     * succeeded, and git's "no such remote" before that (this branch is reached
     * precisely because the project has NO remotes). `null` ⇒ never wired, even
     * after a successful create. A string ⇒ that URL verbatim.
     */
    originAfterCreate?: string | null;
    /**
     * What EVERY `git config --get <key>` answers, whatever the key.
     *
     * This is the shape a value in `GIT_CONFIG_GLOBAL` (or `/etc/gitconfig`)
     * produces: `git -C <folder> config --get <key>` with no `--local` reads
     * global and system config too, so a stray machine-wide value answers for a
     * repository whose own `.git/config` is empty. D1 asserts that no such value
     * can reach the offer, because the offer reads no key at all.
     *
     * Deliberately key-agnostic: naming the key here would re-encode the very
     * flag D1 deletes, and the test would then only prove that ONE spelling is
     * gone.
     */
    configGetAnswer?: string;
  } = {},
) {
  const createdSlug = opts.createdSlug ?? 'acme/my-app';
  let created = false;
  /**
   * The project's `.git/config`, as far as this runner is concerned: what a
   * `git config <key> <value>` wrote, readable by a later `git config --get
   * <key>`.
   *
   * It exists so a test can drive the SAME runner through two inits and observe
   * whether the first one left something behind that silences the second — which
   * is precisely the state a per-repo suppression flag creates, and which a fresh
   * runner per pass can never show.
   */
  const configStore = new Map<string, string>();
  return makeRunner((cmd, args) => {
    // Local git plumbing (remote wiring) — never the network.
    if (cmd === 'git') {
      if (args.includes('get-url')) {
        if (opts.originAfterCreate === null) return fail(2, "error: No such remote 'origin'");
        if (typeof opts.originAfterCreate === 'string') return ok(`${opts.originAfterCreate}\n`);
        return created
          ? ok(`https://github.com/${createdSlug}.git\n`)
          : fail(2, "error: No such remote 'origin'");
      }
      // `git config --get <key>`: git exits 1 printing nothing when the key is
      // unset. Answered here so that a flow which DOES read a key is visible —
      // the shipped flow reads none, and D1 asserts exactly that.
      if (args.includes('--get')) {
        const key = args[args.length - 1];
        if (opts.configGetAnswer !== undefined) return ok(`${opts.configGetAnswer}\n`);
        // A value THIS runner was asked to write earlier is readable afterwards,
        // exactly as `.git/config` is across two inits of the same project. Without
        // it a two-run test uses a fresh, amnesiac config each time and cannot see a
        // suppression flag at all.
        const stored = configStore.get(key);
        return stored === undefined ? fail(1, '') : ok(`${stored}\n`);
      }
      // `git config <key> <value>` — a WRITE (two non-flag arguments after
      // `config`). Remembered so the read above can answer it.
      const at = args.indexOf('config');
      if (at >= 0) {
        const rest = args.slice(at + 1);
        if (rest.length === 2 && rest.every((a) => !a.startsWith('-'))) {
          configStore.set(rest[0], rest[1]);
        }
      }
      return ok('');
    }
    if (args[0] === '--version') return ok('gh version 2.62.0');
    if (args[0] === 'auth') return ok('Logged in to github.com');
    if (isGhRepoCreate(cmd, args)) {
      if (opts.createReply) {
        // A scripted failure leaves `created` false unless the test overrode the
        // origin read — which is exactly how "failed AFTER the repo existed" is
        // expressed here.
        return opts.createReply;
      }
      created = true;
      return args.includes('--json')
        ? ok(JSON.stringify({ name: createdSlug.split('/')[1], nameWithOwner: createdSlug, url: `https://github.com/${createdSlug}` }))
        : ok(`https://github.com/${createdSlug}\n`);
    }
    // NO branch for `gh api user`: nothing may issue it, so scripting a reply
    // would hide a regression instead of exposing it. An identity read here
    // falls through to `unexpected command`, and the `isIdentityRead` assertions
    // below name it outright.
    if (isMembershipsRead(args)) {
      return opts.membershipsReply ?? ok(JSON.stringify(opts.memberships ?? []));
    }
    // Fall-through into the EXISTING ruleset advisory once a repo exists.
    const p = apiPath(args) ?? '';
    if (/^repos\/[^/]+\/[^/]+\/rulesets$/.test(p) && !args.includes('POST')) return ok('[]');
    if (/^repos\/[^/]+\/[^/]+\/actions\/secrets$/.test(p)) return ok('[]');
    return undefined;
  });
}

// ─── Shared advisory deps ────────────────────────────────────────────────────

const resolveRepo = vi.fn(async (_folder: string): Promise<string | null> => 'o/r');
const openExternal = vi.fn();
const isRepo = () => true;

function deps(run: CommandRunner, requiredChecks: readonly string[] = ['lint', 'test']) {
  return { run, resolveRepo, openExternal, isRepo, requiredChecks };
}

beforeEach(() => {
  vi.clearAllMocks();
  quickPickCalls.length = 0;
  resolveRepo.mockReset();
  resolveRepo.mockResolvedValue('o/r');
  configGet.mockReturnValue(undefined);
  // Default picker behaviour: the user accepts whatever is offered FIRST, i.e.
  // the default pick. Recorded so tests can assert what was actually offered.
  showQuickPick.mockImplementation(async (items: unknown, options?: unknown) => {
    const resolved = (await items) as unknown[];
    quickPickCalls.push({ items: resolved, options });
    return resolved[0];
  });
  // Accept the prefilled repo name (VS Code seeds `value`).
  showInputBox.mockImplementation(async (options?: { value?: string }) => options?.value ?? 'my-app');
  showInformationMessage.mockResolvedValue(undefined);
});

// =============================================================================
// probeOwnerCandidates() — owner defaulting, INV-5 fail-safe, INV-4 no writes
// =============================================================================

describe('probeOwnerCandidates() — owner defaulting (DR-050 Amendment 2026-08-25)', () => {
  function orgsRunner(memberships: Array<Record<string, unknown>>) {
    return makeRunner((cmd, args) => {
      if (cmd !== 'gh') return undefined;
      // Deliberately NO branch for `gh api user`. DR-050's 2026-08-25 amendment
      // enumerates exactly one account endpoint, so an identity read is a
      // boundary widening, not a convenience — scripting a reply for it would
      // let one land silently.
      if (isMembershipsRead(args)) return ok(JSON.stringify(memberships));
      return undefined;
    });
  }

  /**
   * `login` per candidate. `null` is the PERSONAL account — a positive
   * instruction to omit the owner prefix, not a missing value.
   */
  const logins = (c: RepoOwnerCandidate[]): Array<string | null> => c.map((x) => x.login);

  it('exactly ONE active admin org → that org is the DEFAULT pick (index 0), personal still selectable', async () => {
    const { run, calls } = orgsRunner([
      membership('acme', 'admin'),
      membership('bystander', 'member'),
    ]);

    const { candidates } = await probeOwnerCandidates(run);

    // The default pick IS the head of the list.
    expect(candidates[0]).toEqual({ login: 'acme', kind: 'org', canAdminister: true });
    // The personal account remains offered (never silently replaced) — and it is
    // identified by KIND, because it carries no login: `login: null` is the
    // instruction to omit the owner prefix, which is how `gh repo create <name>`
    // already creates under the signed-in account. MinSpec therefore never issues
    // the `gh api user` read that would be needed to put a name on this row.
    const personal = candidates.find((c) => c.kind === 'user');
    expect(personal).toBeDefined();
    expect(personal!.login).toBeNull();
    expect(calls.filter((c) => isIdentityRead(c.args))).toHaveLength(0);
    // A member-only org is LISTED but never defaulted.
    const bystander = candidates.find((c) => c.login === 'bystander');
    expect(bystander?.kind).toBe('org');
    expect(bystander?.canAdminister).toBeFalsy();
  });

  it('TWO active admin orgs → NO auto-pick: the personal account leads, both admin orgs precede member-only ones', async () => {
    const { run } = orgsRunner([
      membership('acme', 'admin'),
      membership('zeta', 'admin'),
      membership('bystander', 'member'),
    ]);

    const { candidates } = await probeOwnerCandidates(run);

    expect(candidates[0]).toEqual({ login: null, kind: 'user' });
    // Ambiguity is not resolved by guessing: no org may take the default slot.
    expect(candidates.filter((c) => c.canAdminister).map((c) => c.login).sort()).toEqual(['acme', 'zeta']);
    const order = logins(candidates);
    expect(order.indexOf('acme')).toBeLessThan(order.indexOf('bystander'));
    expect(order.indexOf('zeta')).toBeLessThan(order.indexOf('bystander'));
  });

  it('a member-only org is LISTED but never defaulted (personal leads)', async () => {
    const { run } = orgsRunner([membership('bystander', 'member')]);

    const { candidates } = await probeOwnerCandidates(run);

    expect(candidates[0]).toEqual({ login: null, kind: 'user' });
    expect(logins(candidates)).toContain('bystander');
    expect(candidates.find((c) => c.login === 'bystander')?.canAdminister).toBeFalsy();
  });

  it('a non-active membership is filtered out ENTIRELY (never listed, never defaulted)', async () => {
    const { run } = orgsRunner([
      membership('ghost', 'admin', 'pending'),
      membership('acme', 'admin'),
    ]);

    const { candidates } = await probeOwnerCandidates(run);

    expect(logins(candidates)).not.toContain('ghost');
    // ...and with `ghost` gone, `acme` is the SOLE admin org → the default pick.
    expect(candidates[0].login).toBe('acme');
  });

  it('a pending-only org leaves the personal account as the only candidate', async () => {
    const { run } = orgsRunner([membership('ghost', 'admin', 'pending')]);

    const { candidates } = await probeOwnerCandidates(run);

    expect(candidates).toEqual([{ login: null, kind: 'user' }]);
  });

  it('an org login failing the charset guard is DROPPED, never offered as a destination', async () => {
    // The login arrives from the network and is interpolated straight into a
    // `gh repo create <owner>/<name>` argument, so it is filtered with the SAME
    // predicate the CLI boundary re-asserts. A dropped row is the only safe
    // outcome: keeping it would put a traversal- or flag-shaped destination in
    // front of the user as if it were a real org.
    const { run } = orgsRunner([
      { state: 'active', role: 'admin', organization: { login: '../../etc' } },
      { state: 'active', role: 'admin', organization: { login: '-rf' } },
      { state: 'active', role: 'admin', organization: { login: 'acme/evil' } },
      { state: 'active', role: 'admin', organization: { login: 42 } },
      { state: 'active', role: 'admin', organization: {} },
      membership('acme', 'admin'),
    ]);

    const { candidates } = await probeOwnerCandidates(run);

    // Only the legitimate org survived — and BECAUSE it is now the sole admin
    // org, it takes the default slot. That second half is what makes this test
    // able to tell "dropped" from "kept but sorted late": five extra admin orgs
    // would push the personal account into the lead.
    expect(logins(candidates)).toEqual(['acme', null]);
    expect(candidates[0]).toEqual({ login: 'acme', kind: 'org', canAdminister: true });
  });

  it('the SAME org listed twice yields ONE row, and is still the sole admin org', async () => {
    // De-duplication is not cosmetic: a duplicate would read as two admin orgs,
    // which is the AMBIGUOUS case, so the ranking rule would stop defaulting to
    // the one org the user actually has — a duplicate row silently changing
    // where the repository goes.
    const { run } = orgsRunner([membership('acme', 'admin'), membership('acme', 'admin')]);

    const { candidates } = await probeOwnerCandidates(run);

    expect(logins(candidates).filter((l) => l === 'acme')).toHaveLength(1);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({ login: 'acme', kind: 'org', canAdminister: true });
  });

  it('INV-4: the probe reads only — no POST/PUT/PATCH, no settings write, nothing on disk', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-probe-'));
    const before = fs.readdirSync(tmp);
    const { run, calls } = orgsRunner([membership('acme', 'admin')]);

    try {
      await probeOwnerCandidates(run);

      // Reads only, all through the injected runner, all shelling `gh`.
      expect(calls.every((c) => c.cmd === 'gh')).toBe(true);
      expect(calls.some((c) => c.args.includes('POST') || c.args.includes('PUT') || c.args.includes('PATCH'))).toBe(false);
      // No VS Code settings write.
      expect(configUpdate).not.toHaveBeenCalled();
      // No cache file, no `.minspec/` write.
      expect(fs.readdirSync(tmp)).toEqual(before);
      expect(fs.existsSync(path.join(tmp, '.minspec'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// INV-5 — fail-safe: every probe failure degrades, none throws
// =============================================================================

describe('probeOwnerCandidates() — INV-5 fail-safe', () => {
  /**
   * The shared degradation assertion. Both readings of the contract are
   * satisfiable — `[]` ("returns [] on ANY failure") and `[personal]`
   * ("degrades to offering the personal account only") — so this pins the
   * property that actually matters and that both readings share: NO org may
   * leak out of a failed read, and the call never rejects. Which of the two the
   * implementation picks is settled by the WIRED test below, which asserts the
   * offer still fires and can still create under the personal account.
   *
   * It also pins the OTHER half (C4): every case in this block is a read that
   * did not complete, so the probe must SAY it did not. A degraded list that
   * cannot be told from a successful empty one is what let the offer quietly
   * withhold an org the user actually had.
   */
  function expectDegraded(probe: OrgProbeShape): void {
    const candidates = probe.candidates;
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.some((c) => c.kind === 'org')).toBe(false);
    expect(candidates.length).toBeLessThanOrEqual(1);
    for (const c of candidates) expect(c.kind).toBe('user');
    expect(probe.orgsRead).toBe(false);
  }

  function runnerWithMemberships(reply: Reply) {
    return makeRunner((cmd, args) => {
      if (cmd !== 'gh') return undefined;
      if (isMembershipsRead(args)) return reply;
      return undefined;
    });
  }

  it('NON-ZERO EXIT (missing read:org scope) → degrades, never throws', async () => {
    const { run } = runnerWithMemberships(
      fail(1, 'gh: Resource not accessible by integration (HTTP 403)'),
    );
    await expect(probeOwnerCandidates(run)).resolves.toBeDefined();
    expectDegraded(await probeOwnerCandidates(run));
  });

  it('SPAWN REJECTION → degrades, never throws (the runner MAY reject; callers treat it as unavailable)', async () => {
    const { run } = runnerWithMemberships({ throws: 'ENOENT' });
    await expect(probeOwnerCandidates(run)).resolves.toBeDefined();
    expectDegraded(await probeOwnerCandidates(run));
  });

  it('MALFORMED JSON → degrades, never throws', async () => {
    const { run } = runnerWithMemberships(ok('not json{'));
    expectDegraded(await probeOwnerCandidates(run));
  });

  it('VALID JSON of the wrong SHAPE (an error object, not an array) → degrades, never throws', async () => {
    const { run } = runnerWithMemberships(ok('{"message":"Requires authentication"}'));
    expectDegraded(await probeOwnerCandidates(run));
  });

  it('RATE LIMIT (403 with a body) → degrades, never throws', async () => {
    const { run } = runnerWithMemberships(fail(1, 'gh: API rate limit exceeded (HTTP 403)'));
    expectDegraded(await probeOwnerCandidates(run));
  });

  it('an UNAUTHED gh (every read refused) → still resolves, still no orgs, still no throw', async () => {
    const { run, calls } = makeRunner((cmd, args) => {
      if (cmd !== 'gh') return undefined;
      if (isMembershipsRead(args)) return fail(4, 'gh: authentication required');
      return undefined;
    });
    await expect(probeOwnerCandidates(run)).resolves.toBeDefined();
    expectDegraded(await probeOwnerCandidates(run));
    // The degradation is reached WITHOUT falling back to an identity read: the
    // personal row needs no successful read at all, because `gh repo create
    // <name>` addresses the signed-in account by omitting the owner prefix.
    expect(calls.filter((c) => isIdentityRead(c.args))).toHaveLength(0);
  });

  it('a runner that rejects on EVERY call → resolves, never rejects', async () => {
    const run: CommandRunner = async () => {
      throw new Error('catastrophic');
    };
    await expect(probeOwnerCandidates(run)).resolves.toBeDefined();
    expectDegraded(await probeOwnerCandidates(run));
  });
});

// =============================================================================
// createGitHubRepo() — the MUTATION: argv shape, honesty, charset assertion
// =============================================================================

describe('createGitHubRepo() — the mutation', () => {
  it('shells the user`s gh with owner/name and the chosen visibility, returning the slug', async () => {
    const { run, calls } = makeRunner((cmd, args) => {
      if (cmd === 'git') return ok('');
      if (isGhRepoCreate(cmd, args)) {
        return args.includes('--json')
          ? ok(JSON.stringify({ nameWithOwner: 'acme/my-app', url: 'https://github.com/acme/my-app' }))
          : ok('https://github.com/acme/my-app\n');
      }
      return undefined;
    });

    const result: CreateRepoResult = await createGitHubRepo(
      '/ws/my-app',
      'acme',
      'my-app',
      'private',
      run,
    );

    expect(result.ok).toBe(true);
    expect(result.slug).toBe('acme/my-app');
    // INV-1: the user's own gh (and local git), nothing else.
    expect(calls.every((c) => c.cmd === 'gh' || c.cmd === 'git')).toBe(true);
    const create = calls.find((c) => isGhRepoCreate(c.cmd, c.args));
    expect(create).toBeDefined();
    expect(create!.args).toContain('acme/my-app');
    expect(create!.args).toContain('--private');
    // A private choice must NEVER widen to public.
    expect(create!.args).not.toContain('--public');
  });

  it('honours a public choice explicitly (no silent private-only path)', async () => {
    const { run, calls } = makeRunner((cmd, args) => {
      if (cmd === 'git') return ok('');
      if (isGhRepoCreate(cmd, args)) return ok('https://github.com/octocat/my-app\n');
      return undefined;
    });

    await createGitHubRepo('/ws/my-app', 'octocat', 'my-app', 'public', run);

    const create = calls.find((c) => isGhRepoCreate(c.cmd, c.args))!;
    expect(create.args).toContain('--public');
    expect(create.args).not.toContain('--private');
  });

  it('WIRES THE REMOTE: `--source <folder> --remote origin`, and never `--push`', async () => {
    // "Create it, set the remote" is the whole promise — a repository created
    // but not wired leaves the user exactly where the dead end left them, with
    // an extra empty repo on GitHub. Asserted as ORDERED PAIRS, because a
    // `--source` pointing at a different folder, or a `--remote` naming
    // something other than `origin`, passes a bare `toContain` unchanged.
    const { run, calls } = makeRunner((cmd, args) => {
      if (cmd === 'git') return ok('');
      if (isGhRepoCreate(cmd, args)) return ok('https://github.com/acme/my-app\n');
      return undefined;
    });

    await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run);

    const args = calls.find((c) => isGhRepoCreate(c.cmd, c.args))!.args;
    expect(args).toContain('--source');
    expect(args).toContain('--remote');
    expect(args[args.indexOf('--source') + 1]).toBe('/ws/my-app');
    expect(args[args.indexOf('--remote') + 1]).toBe('origin');
    // The repository is created EMPTY on purpose. Pushing the user's code to a
    // remote they have just named is a separate decision nobody asked them
    // about, and it is not undoable in the way that matters.
    expect(args).not.toContain('--push');
  });

  it('VISIBILITY FAILS CLOSED: anything but an explicit `public` yields `--private`', async () => {
    // The flag is derived from a value that crosses a `deps.pickVisibility` seam,
    // so an off-contract value is reachable without anyone editing this function.
    // The failure directions are not symmetric: a repository created private by
    // mistake is renamed in a click, and one created public by mistake was
    // public for a while. So every unrecognised value must land on `--private`.
    for (const offContract of ['private', 'PRIVATE', 'Public', 'PUBLIC', 'pub', '', undefined, null]) {
      const { run, calls } = makeRunner((cmd, args) => {
        if (cmd === 'git') return ok('');
        if (isGhRepoCreate(cmd, args)) return ok('https://github.com/acme/my-app\n');
        return undefined;
      });

      await createGitHubRepo(
        '/ws/my-app',
        'acme',
        'my-app',
        offContract as unknown as 'private',
        run,
      );

      const args = calls.find((c) => isGhRepoCreate(c.cmd, c.args))!.args;
      const label = JSON.stringify(offContract);
      expect(args, `visibility ${label} did not yield --private`).toContain('--private');
      expect(args, `visibility ${label} WIDENED to public`).not.toContain('--public');
    }
  });

  it('a `folder` that gh would misread never reaches the CLI at all', async () => {
    // `folder` is editor-supplied rather than user text, so it is checked only
    // for the two things that would break the call — but it IS checked, because
    // `--source ''` and `--source -rf` are both a `gh` invocation doing
    // something other than what the caller asked for.
    for (const folder of ['', '   ', '-rf', '--source', undefined, null]) {
      const { run, calls } = makeRunner(() => ok(''));

      const result = await createGitHubRepo(
        folder as unknown as string,
        'acme',
        'my-app',
        'private',
        run,
      );

      const label = JSON.stringify(folder);
      expect(result.ok, `folder ${label} was accepted`).toBe(false);
      expect(result.error ?? '').toMatch(/source folder/i);
      // NO command at all — the refusal is made before anything is spawned.
      expect(calls, `folder ${label} reached the CLI`).toHaveLength(0);
    }
  });

  it('a failed create reports GitHub`s OWN message and never throws', async () => {
    const { run } = makeRunner((cmd, args) => {
      if (cmd === 'git') return ok('');
      if (isGhRepoCreate(cmd, args)) return fail(1, 'GraphQL: Name already exists on this account (createRepository)');
      return undefined;
    });

    const result = await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run);

    expect(result.ok).toBe(false);
    expect(result.slug).toBeUndefined();
    // Quotes what GitHub said rather than inventing a cause (never-wrong).
    expect(result.error ?? '').toMatch(/name already exists/i);
  });

  it('a spawn rejection is reported as a failure, not propagated', async () => {
    const run: CommandRunner = async () => {
      throw new Error('ENOENT');
    };
    await expect(createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run)).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
  });

  it('DEFENSE-IN-DEPTH: a malformed owner/name never reaches gh (the REPO_SLUG_RE charset assertion, applied where the value reaches the CLI)', async () => {
    // Each row names WHICH half is expected to be refused, so the assertion is
    // "it refused for this reason" rather than the much weaker "it refused".
    // `ok: false` alone is equally satisfied by a create that ran and failed
    // for something unrelated — which is exactly what a removed guard looks
    // like when the CLI happens to reject the value too.
    const cases: Array<{ owner: string; name: string; refused: 'owner' | 'name'; value: string }> = [
      { owner: 'acme', name: '../../etc/passwd', refused: 'name', value: '../../etc/passwd' },
      { owner: 'acme/evil', name: 'my-app', refused: 'owner', value: 'acme/evil' },
      { owner: 'acme', name: 'my app', refused: 'name', value: 'my app' },
      { owner: 'acme', name: '', refused: 'name', value: '' },
      { owner: '', name: 'my-app', refused: 'owner', value: '' },
      { owner: 'acme', name: '--flag', refused: 'name', value: '--flag' },
      { owner: 'acme', name: '..', refused: 'name', value: '..' },
      { owner: '..', name: 'my-app', refused: 'owner', value: '..' },
    ];

    for (const { owner, name, refused, value } of cases) {
      const { run, calls } = makeRunner(() => ok(''));

      const result = await createGitHubRepo('/ws/my-app', owner, name, 'private', run);

      const label = JSON.stringify([owner, name]);
      const expected =
        refused === 'owner' ? /not a usable GitHub owner name/i : /not a usable repository name/i;
      expect(result.ok, `${label} was accepted`).toBe(false);
      expect(result.error ?? '', `${label} refused for the wrong reason`).toMatch(expected);
      // ...and it quotes the value it refused, so the message names the thing
      // the user has to change.
      expect(result.error ?? '').toContain(JSON.stringify(value));
      expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
      // Nothing at all was spawned: the refusal is made before the CLI.
      expect(calls, `${label} reached the CLI`).toHaveLength(0);
    }
  });
});

// =============================================================================
// The slug is PARSED out of gh's output — never echoed back from the request
// =============================================================================
//
// Every fixture here makes gh REPORT a name DIFFERENT from the one requested
// (`my-app` → `renamed-app`). That difference is the whole point: with the two
// equal, a function that parses gh's output and one that simply echoes the
// request back are indistinguishable, and the parser is dead weight nobody can
// break. GitHub really does normalise names at creation time, and the slug is
// fed straight into `gh api repos/{owner}/{repo}/...`, so echoing the request
// would aim the fall-through probe at a repository that does not exist.

describe('createGitHubRepo() — the created slug is read from gh, not assumed', () => {
  /** Run a create whose `gh` prints exactly `stdout`. */
  async function createReporting(
    stdout: string,
    owner: string | null = 'acme',
  ): Promise<CreateRepoResult> {
    const { run } = makeRunner((cmd, args) => {
      if (cmd === 'git') return ok('');
      if (isGhRepoCreate(cmd, args)) return ok(stdout);
      return undefined;
    });
    return createGitHubRepo('/ws/my-app', owner, 'my-app', 'private', run);
  }

  it('reads the TTY form — `✓ Created repository OWNER/NAME on GitHub`', async () => {
    // gh's interactive output, verbatim: the tick is its own decoration and the
    // second line's URL is NOT alone on its line, so this shape is the only
    // thing that can answer here.
    const result = await createReporting(
      '✓ Created repository acme/renamed-app on GitHub\n' +
        '✓ Added remote https://github.com/acme/renamed-app.git\n',
    );

    expect(result.ok).toBe(true);
    expect(result.slug).toBe('acme/renamed-app');
  });

  it('reads the non-TTY form — a line that is NOTHING BUT the repository URL', async () => {
    const result = await createReporting('https://github.com/acme/renamed-app\n');

    expect(result.ok).toBe(true);
    expect(result.slug).toBe('acme/renamed-app');
  });

  it('STRIPS a `.git` suffix — the clone URL carries it and the API path must not', async () => {
    // `repos/acme/renamed-app.git/rulesets` 404s, and the 404 is then blamed on
    // the ruleset rather than on the name we built the path out of.
    const result = await createReporting('https://github.com/acme/renamed-app.git\n');

    expect(result.slug).toBe('acme/renamed-app');
    expect(result.slug).not.toContain('.git');
  });

  it('IGNORES a URL that is only part of a sentence — gh`s upgrade notice is not a repository', async () => {
    // The regression this shape exists for: a scan that took the first URL
    // ANYWHERE in stdout returned `cli/cli` from gh's own release notice, and
    // that slug went straight into the fall-through ruleset probe.
    const result = await createReporting(
      'A new release of gh is available: 2.62.0 → 2.63.0\n' +
        'https://github.com/cli/cli/releases/tag/v2.63.0\n' +
        'https://github.com/acme/renamed-app\n',
    );

    expect(result.slug).toBe('acme/renamed-app');
    expect(result.slug).not.toBe('cli/cli');
  });

  it('REFUSES TO GUESS between two candidate URLs — it falls back to what it requested', async () => {
    // Two equally-well-formed answers is not a reason to pick one: the next
    // call after this is a repo-scoped API path, and picking wrong aims it at
    // somebody else's repository. The requested slug is the honest fallback —
    // it is the only name this function actually knows.
    const result = await createReporting(
      'https://github.com/acme/one\nhttps://github.com/acme/two\n',
    );

    expect(result.ok).toBe(true);
    expect(result.slug).toBe('acme/my-app');
  });

  it('falls back to the REQUESTED slug when gh printed nothing recognisable (owner path)', async () => {
    const result = await createReporting('Repository created.\n');

    expect(result.ok).toBe(true);
    expect(result.slug).toBe('acme/my-app');
  });

  it('on the PERSONAL path an unrecognisable output yields ok WITHOUT a slug — never a false failure', async () => {
    // `owner: null` means there is no requested slug to fall back on: the owner
    // half would have to be invented. The repository EXISTS, so reporting a
    // failure would be the false claim; reporting it unnamed is the true one.
    const result = await createReporting('Repository created.\n', null);

    expect(result.ok).toBe(true);
    expect(result.slug).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

// =============================================================================
// isSafeRepoSegment() — the guard between a hostile string and the `gh` argv
// =============================================================================

describe('isSafeRepoSegment() — the CLI-boundary charset guard', () => {
  it('accepts the segments GitHub accepts', () => {
    for (const value of ['my-app', 'my_app', 'my.app', 'v1.0.0', 'MinSpecPro', 'a', '_x', '.hidden']) {
      expect(isSafeRepoSegment(value), `rejected the legitimate name ${value}`).toBe(true);
    }
  });

  it('rejects a DOTS-ONLY segment — path traversal wearing a legal charset', () => {
    // Every character in `..` is inside the charset, and it does not start with
    // `-`, so this one rule is the whole of what stops `gh repo create ../..`.
    for (const value of ['.', '..', '...', '....']) {
      expect(isSafeRepoSegment(value), `accepted the traversal segment ${value}`).toBe(false);
    }
    // Control: dots are otherwise perfectly legal, so the rule must not be
    // "reject anything containing a dot".
    expect(isSafeRepoSegment('v1.0.0')).toBe(true);
  });

  it('rejects a segment longer than GitHub would take, and accepts one exactly at the limit', () => {
    // The ceiling rejects only what GitHub rejects anyway; it exists so a
    // pathological string never reaches `gh` at all. The at-the-limit case is
    // the control that keeps it from drifting into an off-by-one that refuses
    // legitimate names.
    expect(isSafeRepoSegment('a'.repeat(100))).toBe(true);
    expect(isSafeRepoSegment('a'.repeat(101))).toBe(false);
    expect(isSafeRepoSegment('a'.repeat(5000))).toBe(false);
    expect(isSafeRepoSegment('')).toBe(false);
  });

  it('rejects a NON-STRING by RETURNING FALSE — it must never throw at the boundary', () => {
    // The type guard is the first line for a reason: every check after it calls
    // a string method. Without it `null.length` throws, and the throw escapes
    // into a caller whose contract is "never throws" — so the property under
    // test is BOTH halves, the false and the not-throwing.
    for (const value of [null, undefined, 42, 0, true, {}, ['ok'], () => 'ok', Symbol('x')]) {
      let answer: unknown = 'never assigned';
      expect(
        () => {
          answer = isSafeRepoSegment(value as unknown);
        },
        `threw on ${String(value)}`,
      ).not.toThrow();
      expect(answer, `accepted the non-string ${String(value)}`).toBe(false);
    }
  });

  it('rejects a LEADING DASH — `gh` would read it as a flag, and the charset alone accepts it', () => {
    for (const value of ['-rf', '--public', '-']) {
      expect(isSafeRepoSegment(value), `accepted the flag-shaped segment ${value}`).toBe(false);
    }
  });

  it('rejects anything outside the charset — slashes, spaces, quotes, shell metacharacters', () => {
    for (const value of [
      'a/b',
      '../../etc/passwd',
      'my app',
      'a\tb',
      'a\nb',
      'a"b',
      "a'b",
      'a;b',
      'a$b',
      'a`b',
      'a|b',
      'a&b',
      '..%2f..',
      'café',
    ]) {
      expect(isSafeRepoSegment(value), `accepted ${JSON.stringify(value)}`).toBe(false);
    }
  });
});

// =============================================================================
// INV-3 — the org probe is BRANCH-SCOPED
// =============================================================================

describe('offerRulesetAdvisory() — INV-3: the org probe is branch-scoped', () => {
  it('a repo that RESOLVES a GitHub remote NEVER triggers the memberships read (nor a create)', async () => {
    resolveRepo.mockResolvedValue('o/r');
    const { run, calls } = makeRunner((cmd, args) => {
      if (cmd !== 'gh') return undefined;
      if (args[0] === '--version') return ok('gh version 2.62.0');
      if (args[0] === 'auth') return ok('Logged in');
      const p = apiPath(args) ?? '';
      if (p === 'repos/o/r/rulesets' && !args.includes('POST')) return ok('[]');
      return undefined;
    });
    answerToasts({ rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // POSITIVE anchor: the flow really ran the normal path (this is what keeps
    // the negatives below from passing vacuously on an early exception).
    expect(calls.some((c) => apiPath(c.args) === 'repos/o/r/rulesets')).toBe(true);
    expect(showInformationMessage.mock.calls.some((c: unknown[]) => c.slice(1).includes(RULESET_CREATE_ACTION))).toBe(true);
    // The bound itself.
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(0);
    expect(calls.filter((c) => isIdentityRead(c.args))).toHaveLength(0);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    // And no repo-create offer was ever put to the user.
    expect(repoOfferCall()).toBeUndefined();
  });

  it('NO GitHub remote + gh READY → the memberships read fires EXACTLY ONCE, before the offer', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(1);
    // The offer fired, with the contract's three actions, positive action first.
    const offer = repoOfferCall();
    expect(offer).toBeDefined();
    expect(offer!.slice(1)).toEqual([REPO_CREATE_ACTION, DECLINE_ACTION, LEARN_MORE_ACTION]);
    // Ordering: the read PRECEDED the offer — DR-050's whole stated reason for
    // permitting it is that the offer can name the destination up front.
    const membershipIndex = calls.findIndex((c) => isMembershipsRead(c.args));
    expect(membershipIndex).toBeGreaterThanOrEqual(0);
    expect(String(offer![0])).toContain('acme');
  });

  it('a MALFORMED slug is an EXISTING remote: docs link, NO account read, no create', async () => {
    // A remote resolved; the slug it produced merely fails the `^owner/repo$`
    // charset assertion. Resolution PRODUCING something is itself proof that a
    // remote exists, so this classifies as `other-remote` and never as "no
    // remote" — and DR-050's 2026-08-25 amendment authorises the account read
    // only where the ABSENCE of remotes was positively established.
    resolveRepo.mockResolvedValue('o/../../etc');
    const { run, calls } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: DECLINE_ACTION, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // POSITIVE ANCHOR FIRST. Every other assertion here is a negative, and the
    // advisory swallows exceptions — so without something the flow had to DO,
    // this test would pass identically for a branch that threw on entry.
    expect(docsToastCall(), 'the docs-link toast never fired').toBeDefined();
    expect(String(docsToastCall()![0])).toMatch(/does not name a GitHub repository/i);
    expect(openExternal).toHaveBeenCalledWith(RULESET_DOCS_URL);
    // ...and now the bounds.
    expect(calls.every((c) => !isRepoApiCall(c.args))).toBe(true);
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(0);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(repoOfferCall()).toBeUndefined();
  });

  // ── The bound's actual shape: `no usable slug` is FOUR states, and only one
  //    of them may reach the account read. `resolveRepo`'s `null` cannot tell
  //    them apart, so the classification is injected here and each state is
  //    exercised on its own — including the `none` control, without which
  //    "nothing fired" would be satisfied by a branch that never runs at all.

  /** Drive the no-usable-slug branch with an INJECTED remote classification. */
  async function runWithDestination(destination: RemoteDestination) {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    const classifyRemotes = vi.fn(async () => destination);
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), classifyRemotes });

    return { calls, classifyRemotes };
  }

  /** Every non-`none` state lands on the same zero-network dead end. */
  function expectDocsLinkAndNoAccountRead(
    calls: ReturnType<typeof makeRunner>['calls'],
    sentence: RegExp,
  ): void {
    // Anchor: the flow reached the docs link, and its sentence names what was
    // actually observed rather than the old, false "this project has no GitHub
    // repo" that was printed for all four states alike.
    expect(docsToastCall(), 'the docs-link toast never fired').toBeDefined();
    expect(String(docsToastCall()![0])).toMatch(sentence);
    expect(openExternal).toHaveBeenCalledWith(RULESET_DOCS_URL);
    // The bound: no offer, no account read, no mutation, no repo-scoped call.
    expect(repoOfferCall()).toBeUndefined();
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(0);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(calls.every((c) => !isRepoApiCall(c.args))).toBe(true);
  }

  it('AMBIGUOUS remotes (several, none named `origin`, naming different repos) → docs link, no account read', async () => {
    const { calls, classifyRemotes } = await runWithDestination({ kind: 'ambiguous', githubRepos: 2 });

    expect(classifyRemotes).toHaveBeenCalledTimes(1);
    expectDocsLinkAndNoAccountRead(calls, /several git remotes/i);
  });

  it('a remote on ANOTHER HOST → docs link, no account read', async () => {
    const { calls, classifyRemotes } = await runWithDestination({ kind: 'other-remote' });

    expect(classifyRemotes).toHaveBeenCalledTimes(1);
    expectDocsLinkAndNoAccountRead(calls, /does not name a GitHub repository/i);
  });

  it('remotes that could not be READ → docs link, no account read (an unanswered question, not an absence)', async () => {
    // The state the amendment's bound turns on. "We could not read the remotes"
    // is not an observation that there are none, so it must fail CLOSED: acting
    // on it would fire the account read — and offer to create a repository — in
    // a project that may well already have one.
    const { calls, classifyRemotes } = await runWithDestination({ kind: 'unreadable' });

    expect(classifyRemotes).toHaveBeenCalledTimes(1);
    expectDocsLinkAndNoAccountRead(calls, /could not read/i);
  });

  it('POSITIVELY no remotes → the account read fires and the offer is made (the control for the three above)', async () => {
    // Without this, all three tests above are satisfied by a branch that never
    // runs — "nothing fired" is not evidence of a bound when nothing was
    // reachable in the first place.
    const { calls, classifyRemotes } = await runWithDestination({ kind: 'none' });

    expect(classifyRemotes).toHaveBeenCalledTimes(1);
    expect(repoOfferCall()).toBeDefined();
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(1);
    expect(calls.filter((c) => isGhRepoCreate(c.cmd, c.args))).toHaveLength(1);
  });
});

// =============================================================================
// INV-7 + INV-1 — the zero-network fallback survives
// =============================================================================

describe('offerRulesetAdvisory() — INV-7: zero-network fallback', () => {
  it('gh MISSING → zero `gh api`, zero memberships read, and the docs link still fires', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = makeRunner((_cmd, args) =>
      args[0] === '--version' ? { throws: 'ENOENT' } : ok(''),
    );
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['--version']);
    expect(calls.filter((c) => c.args.includes('api'))).toHaveLength(0);
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(0);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(openExternal).toHaveBeenCalledWith(RULESET_DOCS_URL);
    // No offer that the user cannot possibly complete.
    expect(repoOfferCall()).toBeUndefined();
  });

  it('gh UNAUTHED → zero `gh api`, docs link still fires, no repo created', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = makeRunner((_cmd, args) => {
      if (args[0] === '--version') return ok('gh version 2.62.0');
      if (args[0] === 'auth') return fail(1, 'You are not logged into any GitHub hosts');
      return undefined;
    });
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(calls.map((c) => c.args[0])).toEqual(['--version', 'auth']);
    expect(calls.filter((c) => c.args.includes('api'))).toHaveLength(0);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(openExternal).toHaveBeenCalledWith(RULESET_DOCS_URL);
  });

  it('a non-repo folder returns before probing gh at all (zero process, zero toast)', async () => {
    const { run, calls } = makeRunner(() => ok(''));

    await offerRulesetAdvisory('/ws/my-app', { run, resolveRepo, openExternal, isRepo: () => false });

    expect(calls).toHaveLength(0);
    expect(showInformationMessage).not.toHaveBeenCalled();
    expect(showQuickPick).not.toHaveBeenCalled();

    // CONTROL, in the same test: the identical call with `isRepo: () => true`
    // DOES spawn. Without it every assertion above is satisfied by an advisory
    // that never runs at all — and "it did nothing" would be indistinguishable
    // from "it is broken".
    const second = makeRunner(() => ok(''));
    await offerRulesetAdvisory('/ws/my-app', {
      run: second.run,
      resolveRepo,
      openExternal,
      isRepo: () => true,
    });
    expect(second.calls.length, 'the isRepo=true control never probed gh').toBeGreaterThan(0);
    expect(second.calls[0].args).toEqual(['--version']);
  });
});

// =============================================================================
// INV-2 — the mutation fires ONLY on the explicit click
// =============================================================================

describe('offerRulesetAdvisory() — INV-2: creation is consent-gated', () => {
  it('"Create GitHub repo" → exactly ONE `gh repo create`, and the flow STOPS there (the new repo is empty)', async () => {
    resolveRepo.mockResolvedValueOnce(null).mockResolvedValue('acme/my-app');
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const creates = calls.filter((c) => isGhRepoCreate(c.cmd, c.args));
    expect(creates).toHaveLength(1);
    // Created under the DEFAULT owner (the sole admin org) at private visibility.
    expect(creates[0].args.join(' ')).toContain('acme/my-app');
    expect(creates[0].args).toContain('--private');
    // The pickers actually ran — not swallowed by the advisory's catch (the
    // vacuous-pass trap: a picker missing from the vscode mock throws a
    // TypeError that `catch {}` eats, and every other assertion still passes).
    expect(showQuickPick).toHaveBeenCalled();
    // ...and it stopped: the repository it just created has no commits, so there
    // is nothing a ruleset could require of it yet (see the C1 block). What the
    // user gets instead is the created name and the next step.
    expect(calls.filter((c) => isRepoApiCall(c.args))).toHaveLength(0);
    expect(everythingSaid()).toMatch(/created acme\/my-app/i);
    expect(everythingSaid()).toMatch(/push your first commit/i);
    // INV-1: every command was the user's own gh (or local git). No socket.
    expect(calls.every((c) => c.cmd === 'gh' || c.cmd === 'git')).toBe(true);
  });

  it('"Not now" → ZERO create commands (the offer was made and refused)', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // POSITIVE anchor first: the decision point was genuinely reached.
    expect(repoOfferCall()).toBeDefined();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('DISMISSED (Escape) → ZERO create commands', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(repoOfferCall()).toBeDefined();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('"Learn more" → the docs link, ZERO create commands', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: LEARN_MORE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // The page about CREATING a repository — this offer fired because there is
    // none (R7). The original purpose of this test is unchanged: "Learn more"
    // opens documentation and creates nothing.
    expect(openExternal).toHaveBeenCalledWith(REPO_CREATE_DOCS_URL);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
  });

  it('cancelling the VISIBILITY/OWNER pick after the click still creates NOTHING', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    showQuickPick.mockImplementation(async (items: unknown, options?: unknown) => {
      quickPickCalls.push({ items: (await items) as unknown[], options });
      return undefined; // user pressed Escape in the picker
    });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(showQuickPick).toHaveBeenCalled();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
  });

  it('private is the DEFAULT visibility: the private option is offered FIRST', async () => {
    resolveRepo.mockResolvedValueOnce(null).mockResolvedValue('acme/my-app');
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const visibilityPick = quickPickCalls.find((c) => {
      const text = collectStrings(c.items).join(' ');
      return /private/i.test(text) && /public/i.test(text);
    });
    expect(visibilityPick).toBeDefined();
    expect(collectStrings(visibilityPick!.items[0]).join(' ')).toMatch(/private/i);
  });

  it('INV-5 WIRED: the memberships read failing still produces a working, personal-only offer', async () => {
    resolveRepo.mockResolvedValueOnce(null).mockResolvedValue('octocat/my-app');
    const { run, calls } = noRemoteRunner({
      membershipsReply: fail(1, 'gh: Resource not accessible (HTTP 403)'),
      createdSlug: 'octocat/my-app',
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // The offer still fired, still carries the docs escape hatch...
    const offer = repoOfferCall();
    expect(offer).toBeDefined();
    expect(offer!.slice(1)).toContain(LEARN_MORE_ACTION);
    // ...and the create still worked, under the personal account — addressed by
    // the BARE NAME with no owner prefix. That is the property that makes the
    // identity read unnecessary: `gh repo create my-app` creates under whichever
    // account `gh` is signed in as, so a failed memberships read costs the user
    // nothing but the org rows.
    const creates = calls.filter((c) => isGhRepoCreate(c.cmd, c.args));
    expect(creates).toHaveLength(1);
    expect(creates[0].args[2]).toBe('my-app');
    // The login appears NOWHERE in the argv — MinSpec does not know it.
    expect(creates[0].args.join(' ')).not.toContain(PERSONAL_LOGIN);
    expect(calls.filter((c) => isIdentityRead(c.args))).toHaveLength(0);
    // The slug still RESOLVES — from what gh REPORTED back, not from anything
    // MinSpec knew — so the created repository can be NAMED in the toast.
    expect(everythingSaid()).toMatch(new RegExp(`created ${PERSONAL_LOGIN}/my-app`, 'i'));
    // ...and the failed read is DISCLOSED rather than shown as "no orgs" (C4).
    expect(String(repoOfferCall()![0])).toMatch(/could not read your organisations/i);
    // No org was invented out of a failed read.
    expect(collectStrings(quickPickCalls).join(' ')).not.toMatch(/\bacme\b/);
  });

  it('INV-4 WIRED: the whole flow writes nothing to settings and nothing into the workspace folder', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-repo-create-'));
    const before = fs.readdirSync(tmp);
    resolveRepo.mockResolvedValueOnce(null).mockResolvedValue('acme/my-app');
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    try {
      await offerRulesetAdvisory(tmp, deps(run));

      // Anchor: the flow really reached the mutation (without this the assertions
      // below hold trivially today, when the dead end returns before creating).
      expect(calls.filter((c) => isGhRepoCreate(c.cmd, c.args))).toHaveLength(1);
      expect(configUpdate).not.toHaveBeenCalled();
      expect(fs.readdirSync(tmp)).toEqual(before);
      expect(fs.existsSync(path.join(tmp, '.minspec'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ── "Never fails the init" is three different claims, and a runner that
  //    explodes on EVERY call only tests the first of them: it dies at the gh
  //    availability probe and never reaches this feature at all. Each of the
  //    three carries an anchor naming what the flow actually got to do, because
  //    `resolves.toBeUndefined()` on its own is satisfied by a function that
  //    returned before doing anything.

  it('a runner that explodes on EVERY call degrades at the gh probe — the docs link, no throw', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = makeRunner(() => ({ throws: 'catastrophic' }));
    answerToasts({ docs: DOCS_ACTION });

    await expect(offerRulesetAdvisory('/ws/my-app', deps(run))).resolves.toBeUndefined();

    // Anchor: it got as far as asking whether `gh` exists, and no further.
    expect(calls[0].args).toEqual(['--version']);
    expect(openExternal).toHaveBeenCalledWith(RULESET_DOCS_URL);
    expect(repoOfferCall()).toBeUndefined();
  });

  it('a REJECTING account probe inside the no-remote branch is swallowed', async () => {
    // `probeOwnerCandidates` promises never to throw, but it is an injectable
    // seam, so the caller must survive one that does — the advisory is
    // best-effort and may never fail the init it is advising about.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({});
    const probeOwners = vi.fn(async (): Promise<OrgProbeShape> => {
      throw new Error('catastrophic');
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, docs: DOCS_ACTION });

    await expect(
      offerRulesetAdvisory('/ws/my-app', { ...deps(run), probeOwners }),
    ).resolves.toBeUndefined();

    // Anchor: the throw came from INSIDE the branch under test.
    expect(probeOwners).toHaveBeenCalledTimes(1);
  });

  it('a REJECTING create — after the user consented — is swallowed', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    const createRepo = vi.fn(async (): Promise<CreateRepoResult> => {
      throw new Error('gh exploded mid-create');
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, docs: DOCS_ACTION });

    await expect(
      offerRulesetAdvisory('/ws/my-app', { ...deps(run), createRepo }),
    ).resolves.toBeUndefined();

    // Anchors: the offer was made, accepted, and driven all the way to the
    // mutation — so the silence above is a swallowed throw, not an early exit.
    expect(repoOfferCall()).toBeDefined();
    expect(visibilityPickCall()).toBeDefined();
    expect(createRepo).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// The OWNER PICKER — the payload of the whole change
// =============================================================================
//
// DR-050's 2026-08-25 amendment crosses the repo→account boundary for exactly
// one reason: so the user can be OFFERED a choice of destination. If the flow
// silently used `candidates[0]` and never consulted the picker, the read would
// be buying nothing and the amendment's justification would be void. So the
// picker's RETURN VALUE — not merely the fact that a picker opened — is what
// these tests pin.

describe('offerRulesetAdvisory() — the owner picker decides where the repo goes', () => {
  it('creates under the owner the USER chose, not under the default candidate', async () => {
    // TWO admin orgs ⇒ the ranking rule refuses to auto-pick ⇒ `candidates[0]`
    // is the PERSONAL account and BOTH orgs are non-default rows. Choosing
    // `zeta` is therefore an outcome the default could not have produced, which
    // is what makes this test able to tell `await pickOwner(...)` apart from
    // `candidates[0]`.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({
      memberships: [membership('acme', 'admin'), membership('zeta', 'admin')],
      createdSlug: 'zeta/my-app',
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });
    answerPickers('zeta');

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // The picker really ran, and really offered a non-default row.
    expect(ownerPickCall(), 'the owner picker never opened').toBeDefined();
    expect(ownerPickRows().map((r) => r.label)).toContain('zeta');
    // The create targeted the CHOSEN owner...
    const creates = calls.filter((c) => isGhRepoCreate(c.cmd, c.args));
    expect(creates).toHaveLength(1);
    expect(creates[0].args[2]).toBe('zeta/my-app');
    // ...and the chosen repository is what the flow REPORTS, so the choice
    // survives the whole flow rather than only the create call. (It is reported
    // rather than probed: the new repository is empty, so the flow stops before
    // the ruleset offer — see the C1 block.)
    expect(everythingSaid()).toMatch(/created zeta\/my-app/i);
  });

  it('choosing the PERSONAL row over a defaulted org sends the bare name, with no owner prefix', async () => {
    // The mirror image: here ONE admin org leads, so `candidates[0]` is `acme`
    // and the personal account is the non-default row. Picking it must produce
    // `gh repo create my-app` — never `acme/my-app`, and never a login MinSpec
    // would have to read to spell.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({
      memberships: [membership('acme', 'admin')],
      createdSlug: `${PERSONAL_LOGIN}/my-app`,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });
    answerPickers('Your personal account');

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const creates = calls.filter((c) => isGhRepoCreate(c.cmd, c.args));
    expect(creates).toHaveLength(1);
    expect(creates[0].args[2]).toBe('my-app');
    expect(creates[0].args.join(' ')).not.toContain('acme');
    expect(calls.filter((c) => isIdentityRead(c.args))).toHaveLength(0);
    // The slug comes back from what gh REPORTED (and from the `origin` it wired),
    // never from a login MinSpec knows — so the personal account can still be
    // NAMED in what the flow says, without an identity read.
    expect(everythingSaid()).toMatch(new RegExp(`created ${PERSONAL_LOGIN}/my-app`, 'i'));
  });

  it('escaping the OWNER pick (after accepting visibility) creates nothing', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({
      memberships: [membership('acme', 'admin'), membership('zeta', 'admin')],
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });
    answerPickers('a-row-that-does-not-exist'); // → the picker returns undefined

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // Anchor: visibility WAS answered, so this is the owner pick being escaped
    // rather than the flow never starting.
    expect(visibilityPickCall()).toBeDefined();
    expect(ownerPickCall()).toBeDefined();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
  });

  it('the picker RENDERS every candidate, each described in installability terms (INV-6 coverage is pinned here, not left to chance)', async () => {
    // INV-6's deny-list can only scan strings the flow actually rendered. The
    // org descriptions exist ONLY inside the owner picker, so if the picker is
    // ever skipped the deny-list silently stops covering them and still passes.
    // This test makes the picker's rows a first-class assertion.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [membership('acme', 'admin'), membership('bystander', 'member')],
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });
    answerPickers('acme');

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const rows = ownerPickRows();
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.label)).toEqual(['acme', 'Your personal account', 'bystander']);
    // The personal row is named by what it IS — MinSpec never reads the login.
    expect(rows.map((r) => r.label)).not.toContain(PERSONAL_LOGIN);
    // Every row carries a description, and the org ones state the ROLE that was
    // actually read — the honest proxy, never an install claim.
    expect(rows.every((r) => r.description.length > 0)).toBe(true);
    expect(rows.find((r) => r.label === 'acme')!.description).toMatch(/membership role is owner/i);
    expect(rows.find((r) => r.label === 'bystander')!.description).toMatch(/membership role is member/i);
  });

  it('a SINGLE candidate skips the picker, and the toast promises only what it opens', async () => {
    // The copy and the behaviour are driven by one condition on purpose: a toast
    // promising "you pick the owner" in front of a flow that never asks is a
    // small lie told at the moment the user decides.
    //
    // The fixture is a SUCCESSFUL read that found no orgs (C4). It used to be a
    // FAILED one, which pinned the wrong thing as correct: "the read did not
    // complete" and "you belong to no organisations" produce the same one-row
    // list, and only the first of them is withholding a destination the user may
    // have wanted. That case now has its own test, and it does NOT look like this
    // one — see the C4 block.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(ownerPickCall()).toBeUndefined();
    expect(String(repoOfferCall()![0])).toContain('you pick the visibility and name next');
    expect(String(repoOfferCall()![0])).not.toContain('owner');
    // A successful read that found nothing says nothing about a failed one.
    expect(String(repoOfferCall()![0])).not.toMatch(/could not read/i);
  });

  it('MORE THAN ONE candidate opens the picker, and the toast says so', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });
    answerPickers('acme');

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(ownerPickCall()).toBeDefined();
    expect(String(repoOfferCall()![0])).toContain('you pick the visibility, owner and name next');
  });
});

// =============================================================================
// The offer's own guards: an unusable owner, and no destination at all
// =============================================================================

describe('offerRulesetAdvisory() — the offer refuses rather than retargets', () => {
  /**
   * Run the whole no-remote flow with an INJECTED candidate list and a spy in
   * place of the real create, so "did the guard stop it" can be told apart from
   * "did `createGitHubRepo` stop it". Both refuse — that is defense in depth —
   * but only the spy shows WHICH one fired.
   */
  async function runWithCandidates(candidates: RepoOwnerCandidate[]) {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({});
    const createRepo = vi.fn(
      async (): Promise<CreateRepoResult> => ({ ok: true, remoteWired: true, slug: 'acme/my-app' }),
    );
    const probeOwners = vi.fn(async () => ({ candidates, orgsRead: true }));
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), probeOwners, createRepo });

    return { calls, createRepo, probeOwners };
  }

  it('an owner login failing the charset assertion never reaches the create at all', async () => {
    const { calls, createRepo, probeOwners } = await runWithCandidates([
      { login: '../../etc', kind: 'org', canAdminister: true },
    ]);

    // Anchors: the offer ran, was accepted, and got as far as the visibility pick.
    expect(probeOwners).toHaveBeenCalledTimes(1);
    expect(repoOfferCall()).toBeDefined();
    expect(visibilityPickCall()).toBeDefined();
    // The guard fired HERE — not downstream in createGitHubRepo's own re-check.
    expect(createRepo).not.toHaveBeenCalled();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
  });

  it('an EMPTY owner login is a bug, never consent to fall back to the personal account', async () => {
    // Only `null` means "personal account". Rewriting `''` into the bare-name
    // form would silently create the repository somewhere the user never chose,
    // which is the exact retarget the assertion exists to stop.
    const { calls, createRepo } = await runWithCandidates([
      { login: '' as unknown as string, kind: 'user' },
    ]);

    expect(visibilityPickCall()).toBeDefined();
    expect(createRepo).not.toHaveBeenCalled();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
  });

  it('a NULL owner login IS the personal account — the control that proves the guard above is not just refusing everything', async () => {
    const { createRepo } = await runWithCandidates([{ login: null, kind: 'user' }]);

    expect(createRepo).toHaveBeenCalledTimes(1);
    expect(createRepo.mock.calls[0][1]).toBeNull();
  });

  it('NO destination at all → no create button is ever shown, and the docs link fires instead', async () => {
    // "We never offer a button we already know cannot work." The shipped probe
    // cannot return `[]` any more (the personal row needs no successful read),
    // so this covers an injected probe — and the fail-safe must still hold, or
    // the flow walks into `candidates[0]` on an empty list.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({});
    const probeOwners = vi.fn(async () => ({ candidates: [] as RepoOwnerCandidate[], orgsRead: true }));
    const createRepo = vi.fn(
      async (): Promise<CreateRepoResult> => ({ ok: true, remoteWired: true, slug: 'x/y' }),
    );
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), probeOwners, createRepo });

    // Anchor: the offer function really ran and really consulted the probe.
    expect(probeOwners).toHaveBeenCalledTimes(1);
    // The user is told something actionable rather than being handed a dead end
    // OR a button with nowhere to point — and the page is about creating a
    // repository, since that is what this user does not have (R7).
    expect(docsToastCall()).toBeDefined();
    expect(openExternal).toHaveBeenCalledWith(REPO_CREATE_DOCS_URL);
    // ...and no create button, no picker, no mutation.
    expect(repoOfferCall()).toBeUndefined();
    expect(showQuickPick).not.toHaveBeenCalled();
    expect(createRepo).not.toHaveBeenCalled();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
  });
});

// =============================================================================
// The seams either side of the create: the name box, and the slug it returns
// =============================================================================

describe('offerRulesetAdvisory() — the name box is SEEDED, and the returned slug is RE-CHECKED', () => {
  /** Run the accepted flow with a spy standing in for the name box. */
  async function seedFor(folder: string): Promise<string | undefined> {
    let seeded: string | undefined;
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });
    answerPickers('acme');
    const promptRepoName = vi.fn(async (defaultName: string) => {
      seeded = defaultName;
      return 'my-app';
    });

    await offerRulesetAdvisory(folder, { ...deps(run), promptRepoName });

    expect(promptRepoName, `the name box never opened for ${folder}`).toHaveBeenCalledTimes(1);
    return seeded;
  }

  it('a folder name gh would refuse is SANITISED before it seeds the box', async () => {
    // Runs of out-of-charset characters collapse to a single `-`. Handing the
    // raw basename to the box pre-fills a value the box's own validator would
    // then reject, so the user is shown an error about a name they did not type.
    expect(await seedFor('/ws/my app!')).toBe('my-app');
  });

  it('a LEADING DASH is stripped — `gh` would read `-rf` as a flag, not a name', async () => {
    expect(await seedFor('/ws/-rf')).toBe('rf');
  });

  it('a folder with nothing usable left seeds the box EMPTY rather than a value that cannot work', async () => {
    // `...` survives the charset pass (dots are legal characters) and is caught
    // only by the dots-only rule. The box then opens empty and the user types.
    expect(await seedFor('/ws/...')).toBe('');
  });

  it('an ordinary folder name passes through untouched', async () => {
    expect(await seedFor('/ws/my-app')).toBe('my-app');
  });

  it('a MALFORMED slug returned by the create is never echoed as a name — it is re-checked, not trusted', async () => {
    // The slug a create reports is parsed out of `gh`'s stdout. Trusting it would
    // let a traversal-shaped value be repeated back to the user as the repository
    // that now exists, so the caller re-asserts the charset on the way back rather
    // than only on the way in, and falls back to the name the user typed.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({});
    const createRepo = vi.fn(
      async (): Promise<CreateRepoResult> => ({ ok: true, remoteWired: true, slug: 'o/../../etc' }),
    );
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), createRepo });

    // Anchor: the create really ran, so what follows is the RE-CHECK refusing
    // rather than the flow never getting here.
    expect(createRepo).toHaveBeenCalledTimes(1);
    // The malformed value is never repeated back...
    expect(everythingSaid()).not.toContain('o/../../etc');
    // ...and the user is still told the repository exists, under the name they
    // typed — a refusal to name it is not a licence to report a failed create.
    expect(everythingSaid()).toMatch(/created my-app/i);
    expect(calls.filter((c) => isRepoApiCall(c.args))).toHaveLength(0);
  });

  it('a WELL-FORMED slug returned by the create is NAMED — the control for the re-check above', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({});
    const createRepo = vi.fn(
      async (): Promise<CreateRepoResult> => ({ ok: true, remoteWired: true, slug: 'acme/my-app' }),
    );
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), createRepo });

    expect(createRepo).toHaveBeenCalledTimes(1);
    // NAMED, not probed: a well-formed slug is what the success toast says out
    // loud. The repository is empty, so nothing repo-scoped may follow it.
    expect(everythingSaid()).toMatch(/created acme\/my-app/i);
    expect(calls.filter((c) => isRepoApiCall(c.args))).toHaveLength(0);
  });

  it('a create that SUCCEEDED but could not be named reports the truth and stops before the probe', async () => {
    // `ok: true` with no slug is not a failure: the repository exists. Aiming
    // the ruleset probe at a guessed `owner/name` would 404 and blame the wrong
    // thing, so the flow says what happened and stops.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({});
    const createRepo = vi.fn(async (): Promise<CreateRepoResult> => ({ ok: true, remoteWired: true }));
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), createRepo });

    expect(createRepo).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => isRepoApiCall(c.args))).toHaveLength(0);
    // The user is told the repository EXISTS — never that the create failed.
    const said = collectStrings(showInformationMessage.mock.calls).join(' ');
    expect(said).toMatch(/created my-app/i);
    expect(said).not.toMatch(/could not create/i);
  });
});

// =============================================================================
// INV-6 — never claim App-install detection (deny-list over RENDERED strings)
// =============================================================================

describe('offerRulesetAdvisory() — INV-6: no App-install detection claim', () => {
  /**
   * MinSpec CANNOT detect App installations from a Tier-0 extension: with a gh
   * OAuth token, /user/installations returns 403 and both
   * /orgs/{org}/installation and /repos/{owner}/{repo}/installation return 401
   * (tested 2026-08-25, DR-050 Amendment). `role: admin` is therefore a PROXY
   * for "where you could create/install" — so no rendered string may use the
   * completed forms "installed"/"installation", and none may claim detection.
   * There is no true sentence in this flow that needs those words.
   */
  const DENIED: RegExp[] = [
    /\binstalled\b/i,
    /\binstallation\b/i,
    /\bdetect(?:ed|s|ing)?\b[^.]{0,40}\bapp\b/i,
    /\bapp\b[^.]{0,40}\bdetect(?:ed|s|ing)?\b/i,
    /minspec is (?:already )?(?:set ?up|active|enabled) (?:in|on|for)\b/i,
    /\bwhere minspec (?:is|runs)\b/i,
  ];

  /**
   * The whole offer, driven to a successful create.
   *
   * NO SECOND `resolveRepo` ANSWER, and no `rulesetOffer` answer (F10, 2026-08-29).
   * Both were setup for a fall-through into the ruleset advisory that the shipped
   * code deliberately does not perform — see the C1 block — so they were dead
   * fixture describing behaviour that does not exist. Dead setup is worse than
   * none here: it tells the next reader the flow continues, which is the exact
   * claim the file's own header used to get wrong.
   */
  async function runFullOffer(): Promise<string[]> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [membership('acme', 'admin'), membership('bystander', 'member')],
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    await offerRulesetAdvisory('/ws/my-app', deps(run));
    return renderedStrings();
  }

  it('no rendered string claims MinSpec detected an App installation', async () => {
    const strings = await runFullOffer();

    // Anchor: the flow really rendered something (an empty deny-list scan over
    // zero strings is the vacuous pass this guards against).
    expect(strings.length).toBeGreaterThan(0);
    expect(repoOfferCall()).toBeDefined();
    expect(showQuickPick).toHaveBeenCalled();

    for (const text of strings) {
      for (const pattern of DENIED) {
        expect(
          pattern.test(text),
          `rendered string claims install detection MinSpec cannot perform: ${JSON.stringify(text)} matched ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it('the same deny-list holds on the DECLINED path (the offer copy itself)', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const strings = renderedStrings();
    // Anchor: the repo-create offer is what this deny-list is scanning. Without
    // it the scan holds trivially over the old dead-end toast.
    expect(repoOfferCall()).toBeDefined();
    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) {
      for (const pattern of DENIED) expect(pattern.test(text)).toBe(false);
    }
  });

  it('the deny-list is not inert — it catches the exact false claim it exists to stop', async () => {
    // Control: without this, a deny-list whose patterns never match ANYTHING
    // (a typo, an over-escaped regex) reads identical to a clean flow.
    const falseClaims = [
      'MinSpec: the MinSpec App is installed on acme.',
      'MinSpec detected the App on 2 organisations.',
      'MinSpec: found an installation in acme.',
    ];
    for (const claim of falseClaims) {
      expect(DENIED.some((p) => p.test(claim)), `deny-list missed: ${claim}`).toBe(true);
    }
    // ...and it must NOT fire on the honest proxy framing the amendment requires.
    const honest = [
      'MinSpec: create a GitHub repo for this project? acme (you are an owner there) · private by default.',
      'You can create repositories in acme.',
    ];
    for (const text of honest) {
      expect(DENIED.some((p) => p.test(text)), `deny-list false-positived on: ${text}`).toBe(false);
    }
  });
});

// =============================================================================
// INV-1 — Tier-0: no socket, no new network import, one sanctioned spawn point
// =============================================================================

describe('INV-1: Tier-0 boundary (static)', () => {
  const SRC_ROOTS = [
    path.resolve(__dirname, '..', 'src'),
    path.resolve(__dirname, '..', '..', 'shared', 'src'),
  ];
  const ADVISOR = path.resolve(__dirname, '..', 'src', 'lib', 'ruleset-advisor.ts');
  const INIT = path.resolve(__dirname, '..', 'src', 'commands', 'init.ts');

  function collectTsFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectTsFiles(full, out);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  /** Direct-socket modules AND the HTTP client libraries the brief names. */
  const BANNED_IMPORT =
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:http|https|net|tls|dgram|node-fetch|axios|got|undici)['"]/;
  const CHILD_PROCESS_IMPORT = /(?:from\s+|require\s*\(\s*)['"](?:node:)?child_process['"]/;

  it('no source file in packages/minspec or packages/shared imports a network module', () => {
    const offenders: string[] = [];
    const scanned: string[] = [];
    for (const root of SRC_ROOTS) {
      for (const file of collectTsFiles(root)) {
        if (file.includes(`${path.sep}test${path.sep}`) || file.includes('__benchmarks__')) continue;
        scanned.push(file);
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (BANNED_IMPORT.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
    // ANTI-VACUITY. An empty offender list means nothing until the scan is
    // known to have looked at the right files with a pattern that can fire — a
    // renamed directory or an over-escaped regex reads exactly like a clean
    // tree.
    expect(scanned.length).toBeGreaterThan(10);
    expect(scanned).toContain(ADVISOR);
    expect(scanned).toContain(INIT);
    for (const line of [
      "import * as https from 'node:https';",
      "import fetch from 'node-fetch';",
      "const axios = require('axios');",
      "await import('undici');",
    ]) {
      expect(BANNED_IMPORT.test(line), `the network-import scan missed: ${line}`).toBe(true);
    }
  });

  it('the feature`s two files open no socket of their own (no fetch/axios/http call)', () => {
    for (const file of [ADVISOR, INIT]) {
      const src = fs.readFileSync(file, 'utf8');
      expect(BANNED_IMPORT.test(src), `${file} imports a network module`).toBe(false);
      expect(/\bfetch\s*\(/.test(src), `${file} calls fetch()`).toBe(false);
      expect(/\bhttps?\.(?:get|request)\s*\(/.test(src), `${file} calls http(s).request`).toBe(false);
    }
  });

  it('commands/init.ts imports NO child_process — every spawn goes through the injected runner', () => {
    expect(CHILD_PROCESS_IMPORT.test(fs.readFileSync(INIT, 'utf8'))).toBe(false);
  });

  it('lib/ruleset-advisor.ts keeps exactly ONE spawn call site (defaultCommandRunner)', () => {
    const src = fs.readFileSync(ADVISOR, 'utf8');
    expect(CHILD_PROCESS_IMPORT.test(src)).toBe(true); // the sanctioned allowlist entry
    // Assert the BINDINGS, not the names: a bare-name scan for `exec(` matches
    // `RegExp.prototype.exec` (githubReason uses it twice) and would be a false
    // gate. What actually matters is which primitives are imported at all.
    const imported = /import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/.exec(src);
    expect(imported).not.toBeNull();
    expect(
      imported![1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ).toEqual(['execFile']);
    // ...and exactly one call site uses it: defaultCommandRunner.
    expect((src.match(/\bexecFile\s*\(/g) ?? []).length).toBe(1);
  });

  /**
   * Source with whole-line comments removed, so the scan below reads CODE.
   *
   * Only lines that are ENTIRELY comment are dropped (`//…`, `/*…`, a `*`
   * continuation, and everything inside a block comment) — never a trailing
   * comment, which would mean editing a line that also holds code. Prose that
   * merely NAMES a banned API is not a persistence path: init.ts documents one
   * of its guards as "workspaceState-free", and a scan that cannot tell that
   * sentence from a call is a gate nobody can keep green honestly.
   */
  function codeOnly(file: string): string {
    const kept: string[] = [];
    let inBlock = false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (inBlock) {
        if (trimmed.includes('*/')) inBlock = false;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlock = true;
        continue;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      kept.push(line);
    }
    return kept.join('\n');
  }

  /**
   * Persistence PRIMITIVES — deliberately a SUPERSET of what INV-4 forbids, and
   * the scan below is named for that rather than for the invariant (R10).
   *
   * INV-4 forbids persisting THE ORG LIST. This scan forbids every one of these
   * primitives in either file, for any purpose whatever, because a static regex
   * cannot tell WHICH value a `writeFileSync` is writing — and a scan that tried
   * to would be a gate nobody could keep green honestly. Today neither file
   * writes anything at all, so the superset costs nothing; the day one of them
   * legitimately needs to write, this list is not the thing to loosen — the
   * write is what needs justifying, and INV-4 needs its own witness.
   *
   * THREE THINGS IT CANNOT SEE, stated rather than implied:
   *   1. RUNNER-MEDIATED writes. `await run('git', [… 'config', key, value])`
   *      persists a value in the repository and matches nothing here. That is
   *      not an oversight to close with another regex — the runner is an
   *      injected seam, so what it writes is decided at runtime. The org-list
   *      half of INV-4 is therefore carried by the BEHAVIOURAL witness below,
   *      which watches the argv instead of the source.
   *   2. ASYNC fs (`fs.promises.writeFile`, `createWriteStream`). Neither file
   *      imports them today; the anti-vacuity test pins that the patterns fire
   *      on what they do cover, not that coverage is complete.
   *   3. TRAILING COMMENTS. {@link codeOnly} drops WHOLE-LINE comments only, so
   *      prose sitting after code on the same line is still scanned. Stripping
   *      trailing `//` correctly would need a real tokenizer: both files hold
   *      `https://…` URL literals, and the naive rule truncates them mid-string.
   *      So the gap stays open in the safe direction — a trailing comment that
   *      merely NAMES `workspaceState` fails this scan, and the fix is to move
   *      the sentence onto its own line, never to weaken the pattern.
   */
  const PERSISTENCE = [
    /workspaceState/,
    /globalState/,
    /writeFileSync/,
    /appendFileSync/,
    /\bhomedir\s*\(/,
    /\.update\s*\(/,
  ];

  it('INV-4 (static, SUPERSET): neither feature file uses a persistence primitive at all', () => {
    // BOTH files, not just the lib. The org candidates are READ in
    // ruleset-advisor.ts but they are HELD in init.ts — passed through
    // `offerRepoCreation` into the picker and its labels — so a scan of the lib
    // alone leaves the half of the flow that actually carries the list
    // unguarded. "The org list is not written to settings, cache, or workspace
    // state" is a condition of DR-050's 2026-08-25 amendment, and it has to be
    // checked where the list lives.
    for (const file of [ADVISOR, INIT]) {
      const src = codeOnly(file);
      for (const banned of PERSISTENCE) {
        expect(
          banned.test(src),
          `${banned} appeared in ${path.basename(file)} — a persistence primitive in a file ` +
            'that must not persist anything (superset guard for INV-4: no org list)',
        ).toBe(false);
      }
    }
  });

  it('INV-4 (static): the scan is not inert — it still sees code, and it still fires on a real write', () => {
    // Two ways the test above goes quietly green while checking nothing: the
    // comment-stripper eats the file, or the patterns match nothing anywhere.
    for (const file of [ADVISOR, INIT]) {
      const src = codeOnly(file);
      expect(src.length, `${path.basename(file)} was stripped to nothing`).toBeGreaterThan(2000);
      expect(src, `${path.basename(file)} lost its code`).toContain('export async function');
    }
    // ...and the patterns really do catch what they are there to catch.
    const wouldPersist = [
      'context.workspaceState.update("orgs", candidates);',
      'context.globalState.update("orgs", candidates);',
      'fs.writeFileSync(cache, JSON.stringify(candidates));',
      'fs.appendFileSync(log, candidates.join());',
      'const p = path.join(homedir(), ".minspec-orgs");',
      'vscode.workspace.getConfiguration().update("minspec.orgs", candidates);',
    ];
    for (const line of wouldPersist) {
      expect(
        PERSISTENCE.some((banned) => banned.test(line)),
        `INV-4 scan missed a persistence path: ${line}`,
      ).toBe(true);
    }
  });

  it('INV-4 (static): the scan CANNOT see a runner-mediated write — gap #1, demonstrated', () => {
    // R10. Stated as an executable fact rather than a footnote, so nobody reads
    // the green scan above as "nothing in this flow persists anything". The very
    // next test watches that channel directly.
    const throughTheRunner = "await run('git', ['-C', folder, 'config', 'minspec.orgs', names]);";
    expect(PERSISTENCE.some((banned) => banned.test(throughTheRunner))).toBe(false);
  });

  it('INV-4 (behavioural): this flow persists NOTHING — not the org list, not anything else', async () => {
    // The channel the static scan is blind to, watched where it actually
    // happens: the argv the runner was handed. Two orgs are in the picker, and
    // NEITHER may reach a command line on the declined path — the list exists to
    // populate a menu and is then dropped (DR-050 Amendment 2026-08-25, bound 2).
    //
    // The write count is now ZERO rather than one. It was one while a decline
    // flag existed, and `git config <key> <value>` could just as easily have
    // stashed a comma-joined org list there with nothing static to see it — so
    // the assertion stayed on the WRITE CHANNEL after D1 deleted the flag, and
    // simply got stricter (see the D1 block for why the flag went).
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({
      memberships: [membership('acme', 'admin'), membership('bystander', 'member')],
    });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // Anchor: the offer really ran, and the org list really was in front of the
    // user — without this the argv assertions hold for a flow that did nothing.
    expect(repoOfferCall(), 'the create offer never fired').toBeDefined();
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(1);

    // A WRITE is `config <key> <value>` — two non-flag arguments. `--get-regexp`
    // (remote resolution) is a read and must not be counted as one.
    const writes = calls.filter((c) => {
      if (c.cmd !== 'git') return false;
      const at = c.args.indexOf('config');
      if (at < 0) return false;
      const rest = c.args.slice(at + 1);
      return rest.length === 2 && rest.every((a) => !a.startsWith('-'));
    });
    expect(writes, 'the flow wrote something to git config').toHaveLength(0);

    const argv = calls.map((c) => `${c.cmd} ${c.args.join(' ')}`).join('\n');
    expect(argv).not.toMatch(/\bacme\b/);
    expect(argv).not.toMatch(/\bbystander\b/);
    expect(configUpdate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// REPRODUCED DEFECTS — correctness review of #1694 (2026-08-28)
// =============================================================================
//
// Five defects reproduced by driving `offerRulesetAdvisory` with scripted
// runners. Every one of them is reachable THROUGH the green suite above, so each
// gets its own test here as well as a fix: a defect a passing suite cannot see is
// a defect the suite will let back in.

describe('C1: the repository MinSpec just created is EMPTY — no ruleset may be offered against it', () => {
  /**
   * A workspace shaped like a real one: npm scripts CI could run, and the
   * scaffolded workflow files. This is the LOCAL tree `resolveWantedChecks`
   * reads — a sound proxy for a CLONE of an existing repo, and false for a
   * repository MinSpec has just created empty.
   */
  function localTreeThatLooksProducible(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-empty-repo-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'my-app', scripts: { lint: 'eslint .', test: 'vitest run', build: 'tsc' } }),
    );
    const workflows = path.join(tmp, '.github', 'workflows');
    fs.mkdirSync(workflows, { recursive: true });
    for (const f of ['minspec-validate.yml', 'ai-review.yml', 'ready-to-merge.yml']) {
      fs.writeFileSync(path.join(workflows, f), 'name: ci\n');
    }
    return tmp;
  }

  it('offers NO ruleset after the create — the wanted checks come from the LOCAL tree, and the new repo has never run a workflow', async () => {
    // `gh repo create` is issued deliberately WITHOUT `--push`, so the new
    // repository has zero commits, zero refs and zero workflow files. Falling
    // through into the ruleset advisory derives the required checks from the
    // local package.json + .github/workflows — and a ruleset requiring status
    // checks on a repository that has never run one blocks the user's very first
    // push. That is #559's permanent-pending deadlock, re-opened by the one path
    // that creates an empty repository.
    const tmp = localTreeThatLooksProducible();
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    // No `requiredChecks` override: the REAL resolver runs, exactly as it does
    // in production, so this test sees the local-tree proxy it is about.
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: RULESET_CREATE_ACTION });

    try {
      await offerRulesetAdvisory(tmp, { run, resolveRepo, openExternal, isRepo });

      // ANCHOR: the create really happened, so the silence below is a refusal to
      // offer rather than a flow that never got here.
      expect(calls.filter((c) => isGhRepoCreate(c.cmd, c.args))).toHaveLength(1);
      // The defect itself.
      expect(
        rulesetOfferCall(),
        `a ruleset was offered on a repository MinSpec had just created EMPTY: ${String(rulesetOfferCall()?.[0])}`,
      ).toBeUndefined();
      // ...and nothing repo-scoped was even probed, so no POST could follow.
      expect(calls.filter((c) => isRepoApiCall(c.args))).toHaveLength(0);
      // The user is not left wondering: the success toast names the next step —
      // the PUSH, and nothing past it.
      //
      // It used to name a second step, "then re-run MinSpec: Initialize SDD
      // Structure to set up branch protection", and that is now forbidden here as
      // well as asserted in the F1 block. Stopping the fall-through guards exactly
      // ONE invocation; the re-run walks the user into the very offer this test
      // exists to prevent, one command later, because the Tier-B checks are still
      // inferred from this same local tree (#1711).
      expect(everythingSaid()).toMatch(/push/i);
      expect(everythingSaid()).not.toMatch(/re-run/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the ruleset advisory is UNCHANGED for a repo that already has a remote — the control', async () => {
    // The fix must land on the just-created path ONLY. A repo that resolves a
    // GitHub remote is a clone of something that exists, has refs, and is
    // exactly what the ruleset advisory was built for.
    resolveRepo.mockResolvedValue('o/r');
    const { run, calls } = makeRunner((cmd, args) => {
      if (cmd !== 'gh') return undefined;
      if (args[0] === '--version') return ok('gh version 2.62.0');
      if (args[0] === 'auth') return ok('Logged in');
      if (apiPath(args) === 'repos/o/r/rulesets' && !args.includes('POST')) return ok('[]');
      return undefined;
    });
    answerToasts({ rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(rulesetOfferCall()).toBeDefined();
    expect(calls.some((c) => apiPath(c.args) === 'repos/o/r/rulesets')).toBe(true);
  });
});

describe('C2: a create is reported from what was OBSERVED, never from the exit code alone', () => {
  it('a create killed AFTER the repository exists reports the repository as EXISTING', async () => {
    // `gh repo create --source` creates the repository via the API and THEN runs
    // `git remote add`. `defaultCommandRunner` gives it 15s; on the SIGTERM kill
    // Node sets `err.code = null`, the runner rejects, and `runSafe` normalises
    // that to `{ code: 127 }`. Reading `ok` off the exit code alone then tells
    // the user the create failed when the repository is sitting on GitHub — and
    // the remedy it prints ("create it yourself") answers "Name already exists".
    const { run } = makeRunner((cmd, args) => {
      if (isGhRepoCreate(cmd, args)) return { throws: 'spawn gh ETIMEDOUT' };
      if (cmd === 'git' && args.includes('get-url')) return ok('https://github.com/acme/my-app.git\n');
      return undefined;
    });

    const result = await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run);

    expect(result.ok).toBe(true);
    expect(result.remoteWired).toBe(true);
    // ...and `origin` names the repository authoritatively, so it can be said out loud.
    expect(result.slug).toBe('acme/my-app');
  });

  it('an exit-0 create whose remote is NOT wired never claims the remote half', async () => {
    const { run } = makeRunner((cmd, args) => {
      if (isGhRepoCreate(cmd, args)) return ok('https://github.com/acme/my-app\n');
      if (cmd === 'git' && args.includes('get-url')) return fail(2, "error: No such remote 'origin'");
      return undefined;
    });

    const result = await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run);

    expect(result.ok).toBe(true);
    expect(result.remoteWired).toBe(false);
  });

  it('an `origin` naming a DIFFERENT repository is not evidence that THIS create succeeded', async () => {
    // The witness has to be a witness to the right event. A pre-existing remote
    // pointing somewhere else would otherwise be read as "created", which is the
    // same false claim in the opposite direction.
    const { run } = makeRunner((cmd, args) => {
      if (isGhRepoCreate(cmd, args)) return fail(1, 'gh: something went wrong');
      if (cmd === 'git' && args.includes('get-url')) return ok('https://github.com/someone/else.git\n');
      return undefined;
    });

    const result = await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run);

    expect(result.ok).toBe(false);
    expect(result.remoteWired).toBe(false);
    expect(result.slug).toBeUndefined();
  });

  it('a create that never ran (the charset guard refused) is distinguishable from one that failed', async () => {
    const { run, calls } = makeRunner(() => ok(''));

    const result = await createGitHubRepo('/ws/my-app', '../../etc', 'my-app', 'private', run);

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('not-attempted');
    expect(calls).toHaveLength(0);
  });

  it('FLOW: a create that failed after the repository existed is never reported as "could not create"', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      createReply: { throws: 'spawn gh ETIMEDOUT' },
      originAfterCreate: 'https://github.com/acme/my-app.git',
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(everythingSaid()).toMatch(/acme\/my-app/);
    expect(everythingSaid()).not.toMatch(/could not create the repository/i);
    expect(everythingSaid()).not.toMatch(/Create it on GitHub yourself/i);
  });

  it('FLOW: the success toast claims `origin` ONLY when the local read observed it', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({});
    const createRepo = vi.fn(async () => ({ ok: true, slug: 'acme/my-app', remoteWired: false }));
    answerToasts({ repoOffer: REPO_CREATE_ACTION, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      createRepo: createRepo as unknown as RulesetAdvisoryDepsCreateRepo,
    });

    expect(createRepo).toHaveBeenCalledTimes(1);
    expect(everythingSaid()).toMatch(/created acme\/my-app/i);
    expect(everythingSaid()).not.toMatch(/set it as this project/i);
    expect(everythingSaid()).toMatch(/could not confirm/i);
  });
});

describe('C3: the `ambiguous` sentence states what was SEEN about GitHub, not what was assumed', () => {
  /** A checkout with several remotes and none named `origin`. */
  function multiRemoteRunner(remotes: Array<[string, string]>) {
    return makeRunner((cmd, args) => {
      if (cmd === 'git') {
        if (args.includes('--get-regexp')) {
          return ok(remotes.map(([n, u]) => `remote.${n}.url ${u}`).join('\n'));
        }
        if (args[args.length - 1] === 'remote') return ok(remotes.map(([n]) => n).join('\n'));
        return ok('');
      }
      if (args[0] === '--version') return ok('gh version 2.62.0');
      if (args[0] === 'auth') return ok('Logged in');
      return undefined;
    });
  }

  it('several remotes and NONE of them on GitHub → never claims they name different GitHub repositories', async () => {
    // `githubSlug` declines whenever `slugs.size !== 1` — which includes ZERO.
    // A GitLab + Bitbucket checkout therefore reaches the `ambiguous` sentence,
    // which asserts a GitHub fact never observed, and hands over a remedy
    // ("name the right one `origin`") that only reaches `other-remote` next run.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = multiRemoteRunner([
      ['gl', 'https://gitlab.com/acme/my-app.git'],
      ['bb', 'https://bitbucket.org/acme/my-app.git'],
    ]);
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const said = String(docsToastCall()![0]);
    expect(said).not.toMatch(/different GitHub repositories/i);
    expect(said).toMatch(/none of them/i);
    // The remedy has to be reachable: there is no GitHub remote to rename.
    expect(said).toMatch(/add a GitHub remote/i);
    // The branch bound is untouched — this is still not a create-offer state.
    expect(repoOfferCall()).toBeUndefined();
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(0);
  });

  it('several remotes naming DIFFERENT GitHub repositories keeps the sentence it earned — the control', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = multiRemoteRunner([
      ['a', 'https://github.com/acme/one.git'],
      ['b', 'https://github.com/acme/two.git'],
    ]);
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(String(docsToastCall()![0])).toMatch(/different GitHub repositories/i);
  });
});

describe('C4: a FAILED organisation read is not "you have no organisations"', () => {
  it('the probe reports WHETHER the read succeeded, not only what it returned', async () => {
    const failing = makeRunner((cmd, args) =>
      cmd === 'gh' && isMembershipsRead(args) ? fail(1, 'gh: Resource not accessible (HTTP 403)') : undefined,
    );
    const empty = makeRunner((cmd, args) =>
      cmd === 'gh' && isMembershipsRead(args) ? ok('[]') : undefined,
    );

    const onFailure = (await probeOwnerCandidates(failing.run)) as unknown as OrgProbeShape;
    const onEmpty = (await probeOwnerCandidates(empty.run)) as unknown as OrgProbeShape;

    // Both yield the personal account alone — the fail-safe is unchanged...
    expect(onFailure.candidates).toEqual([{ login: null, kind: 'user' }]);
    expect(onEmpty.candidates).toEqual([{ login: null, kind: 'user' }]);
    // ...but they are no longer the same answer.
    expect(onFailure.orgsRead).toBe(false);
    expect(onEmpty.orgsRead).toBe(true);
  });

  it('FLOW: a failed read is DISCLOSED in the offer — the org choice is not removed silently', async () => {
    // The reproduction: a user who owns `acme` but whose token lacks `read:org`
    // (or who has an inherited `GITHUB_TOKEN`, which `gh` prefers) gets the repo
    // created under their personal account, never shown the org they intended,
    // with no indication anything was read and failed.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ membershipsReply: fail(1, 'gh: Resource not accessible (HTTP 403)') });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const offer = String(repoOfferCall()![0]);
    expect(offer).toMatch(/could not read your organisations/i);
    // ...and it names the keystroke that fixes it.
    expect(offer).toMatch(/read:org/);
  });

  it('FLOW: a SUCCESSFUL read that found no orgs says nothing of the kind — the control', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const offer = String(repoOfferCall()![0]);
    expect(offer).not.toMatch(/could not read/i);
    expect(offer).toContain('you pick the visibility and name next');
  });
});

describe('C6: the create-failure remedy matches the reason, and leads back to the name box', () => {
  const COLLISION = 'GraphQL: Name already exists on this account (createRepository)';

  it('a NAME COLLISION never advises "create it on GitHub yourself" — the reason it just quoted forbids it', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ createReply: fail(1, COLLISION) });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const failure = createFailureToastCall();
    expect(failure, 'no create-failure toast offered a way forward').toBeDefined();
    expect(String(failure![0])).toMatch(/name already exists/i);
    expect(String(failure![0])).not.toMatch(/Create it on GitHub yourself/i);
    // The way back into the flow, rather than "re-run the whole command".
    expect(failure!.slice(1)).toContain(REPO_RETRY_ACTION);
  });

  it('the retry re-opens the NAME box and creates under the new name — owner and visibility are kept', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({});
    const names = ['my-app', 'my-app-2'];
    const promptRepoName = vi.fn(async () => names.shift());
    const createRepo = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, remoteWired: false, failure: 'name-taken', error: 'Name already exists on this account' })
      .mockResolvedValueOnce({ ok: true, remoteWired: true, slug: 'acme/my-app-2' });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: REPO_RETRY_ACTION, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      promptRepoName,
      createRepo: createRepo as unknown as RulesetAdvisoryDepsCreateRepo,
    });

    expect(promptRepoName).toHaveBeenCalledTimes(2);
    expect(createRepo).toHaveBeenCalledTimes(2);
    expect(createRepo.mock.calls[0][2]).toBe('my-app');
    expect(createRepo.mock.calls[1][2]).toBe('my-app-2');
    // The owner and visibility chosen ONCE are carried into the retry.
    expect(createRepo.mock.calls[1][1]).toEqual(createRepo.mock.calls[0][1]);
    expect(createRepo.mock.calls[1][3]).toBe(createRepo.mock.calls[0][3]);
    expect(everythingSaid()).toMatch(/created acme\/my-app-2/i);
  });

  it('retrying is BOUNDED — the offer stops rather than looping forever', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ createReply: fail(1, COLLISION) });
    let n = 0;
    const promptRepoName = vi.fn(async () => `my-app-${++n}`);
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: REPO_RETRY_ACTION, docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), promptRepoName });

    const creates = calls.filter((c) => isGhRepoCreate(c.cmd, c.args));
    expect(creates.length).toBeGreaterThan(1);
    expect(creates.length).toBeLessThanOrEqual(3);
    // The LAST thing said no longer dangles a retry the flow will not honour.
    const last = showInformationMessage.mock.calls[showInformationMessage.mock.calls.length - 1];
    expect(last.slice(1)).not.toContain(REPO_RETRY_ACTION);
  });
});

// =============================================================================
// REMAINING FINDINGS — correctness review of #1694 (2026-08-28, second pass)
// =============================================================================
//
// Seven findings, all reachable through the green suite above. Each gets a test
// that FAILS on the code as it stands, because a defect a passing suite cannot
// see is a defect the suite will let back in.

describe('R5: private is the default — so the private option must DISCLOSE the plan limit it walks into', () => {
  /** Rows of the visibility picker, as `{ label, description }`. */
  async function visibilityRows(): Promise<Array<{ label: string; description: string }>> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const pick = visibilityPickCall();
    expect(pick, 'the visibility picker never opened').toBeDefined();
    return (pick!.items as Array<{ label?: unknown; description?: unknown }>).map((r) => ({
      label: String(r.label ?? ''),
      description: String(r.description ?? ''),
    }));
  }

  it('the PRIVATE row says branch rulesets on a private repository need a paid plan', async () => {
    // THE SIGNAL IS ALREADY COMPUTED IN THIS CODEBASE. `isPlanLimited` exists
    // because GitHub answers a ruleset write on a private free-plan repository
    // with a 403 whose body is exactly this sentence — so MinSpec can PREDICT
    // the failure its own private-by-default walks the user into, and saying
    // nothing is choosing not to.
    expect(
      isPlanLimited('Upgrade to GitHub Pro or make this repository public to enable this feature.'),
    ).toBe(true);

    const rows = await visibilityRows();
    const priv = rows.find((r) => /private/i.test(r.label));
    expect(priv, 'no private row in the visibility picker').toBeDefined();
    expect(priv!.description).toMatch(/ruleset/i);
    expect(priv!.description).toMatch(/paid/i);
  });

  it('the PUBLIC row is the control — no warning there, because there is nothing to warn about', async () => {
    const rows = await visibilityRows();
    const pub = rows.find((r) => /public/i.test(r.label));
    expect(pub, 'no public row in the visibility picker').toBeDefined();
    expect(pub!.description).not.toMatch(/paid/i);
    expect(pub!.description).toMatch(/free plan/i);
  });

  it('private is STILL the pre-selected row — the disclosure does not flip the safe default', async () => {
    // Fail-closed stays fail-closed: a repository created public by an accidental
    // Enter is not undoable in the way that matters.
    const rows = await visibilityRows();
    expect(rows[0].label).toMatch(/private/i);
  });
});

describe('R7: the create-flow docs links point at CREATING A REPOSITORY, not at branch rulesets', () => {
  /** The docs page a user with no repository actually needs. */
  const CREATE_DOCS = /creating-a-new-repository/;

  it("the create offer's 'Learn more' does not open the branch-rulesets page", async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: LEARN_MORE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // Anchor: this is the create offer, not some other toast.
    expect(repoOfferCall(), 'the create offer never fired').toBeDefined();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(String(openExternal.mock.calls[0][0])).toMatch(CREATE_DOCS);
    expect(openExternal).not.toHaveBeenCalledWith(RULESET_DOCS_URL);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
  });

  it("the create-FAILURE toast's 'View GitHub docs' opens the same repository-creation page", async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      createReply: fail(1, 'GraphQL: Name already exists on this account (createRepository)'),
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(createFailureToastCall(), 'the create-failure toast never fired').toBeDefined();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(String(openExternal.mock.calls[0][0])).toMatch(CREATE_DOCS);
    expect(openExternal).not.toHaveBeenCalledWith(RULESET_DOCS_URL);
  });

  it('CONTROL: a dead end about an EXISTING remote still opens the branch-rulesets page', async () => {
    // The ruleset docs are the right page whenever the user HAS a repository —
    // which is every state but this feature's. Without this control, "point the
    // create links elsewhere" could be satisfied by repointing all of them.
    resolveRepo.mockResolvedValue('o/../../etc');
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(docsToastCall()).toBeDefined();
    expect(openExternal).toHaveBeenCalledWith(RULESET_DOCS_URL);
  });
});

describe('R9: an unknown RemoteDestination kind never borrows a sentence it did not earn', () => {
  /**
   * The COMPILE-TIME half of this fix — a `never`-typed arm, so a kind added to
   * `RemoteDestination` fails `npm run typecheck` rather than rendering the
   * wrong copy — cannot be observed from a test: `packages/minspec/tsconfig.json`
   * includes `src/**` only, so nothing here is typechecked. The static assertion
   * below therefore checks only that the arm has not been DELETED, and the
   * runtime behaviour is pinned separately: the fallback must state what is true
   * of every state rather than assert an observation nobody made.
   */
  const INIT_SRC = path.resolve(__dirname, '..', 'src', 'commands', 'init.ts');

  async function sentenceFor(destination: RemoteDestination): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    const classifyRemotes = vi.fn(async () => destination);
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), classifyRemotes });

    expect(docsToastCall(), 'the docs-link toast never fired').toBeDefined();
    return String(docsToastCall()![0]);
  }

  it('a kind the copy does not know is NOT rendered as "could not read this project\'s git remotes"', async () => {
    // The defect: `default:` catches every future kind and asserts a failed git
    // read — an observation nobody made. A kind like "the default branch has no
    // commits" reads its remotes perfectly well.
    const said = await sentenceFor({ kind: 'a-state-invented-later' } as unknown as RemoteDestination);

    expect(said).not.toMatch(/could not read this project's git remotes/i);
    expect(said).toMatch(/could not determine which GitHub repository/i);
  });

  it("CONTROL: `unreadable` still says the git read failed — that one DID earn the sentence", async () => {
    const said = await sentenceFor({ kind: 'unreadable' });

    expect(said).toMatch(/could not read this project's git remotes/i);
  });

  it('the exhaustiveness arm is present in source, so the union and the copy fail together', () => {
    const src = fs.readFileSync(INIT_SRC, 'utf8');
    const ARM = /const\s+_?\w*:\s*never\s*=\s*destination/;
    expect(ARM.test(src), 'describeUnusableRemote lost its `never`-typed exhaustiveness arm').toBe(
      true,
    );
    // Not inert: the pattern must not match a switch that simply has a default.
    expect(ARM.test('default:\n  return UNREADABLE_COPY;')).toBe(false);
  });
});

describe('R-New2: the no-destination message never advises `gh auth login` — auth already passed', () => {
  it('it states the situation `isGhReady` actually established, and names a remedy that exists', async () => {
    // Reachable only through an injected probe (the shipped one always yields the
    // personal row), which is exactly why the copy went unread: it is the one
    // sentence in this flow no real user reaches, and it contradicted the check
    // immediately upstream of it.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({});
    const probeOwners = vi.fn(async () => ({ candidates: [] as RepoOwnerCandidate[], orgsRead: true }));
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), probeOwners });

    // Anchor: `gh` was probed and PASSED — that is what makes the old advice false.
    expect(calls.some((c) => c.args[0] === '--version')).toBe(true);
    expect(calls.some((c) => c.args[0] === 'auth')).toBe(true);
    expect(probeOwners).toHaveBeenCalledTimes(1);

    const said = String(docsToastCall()![0]);
    expect(said).not.toMatch(/gh auth login/i);
    // ...and it still hands over something to do.
    expect(said).toMatch(/create .{0,40}repository/i);
    expect(said).toMatch(/origin/);
  });
});

describe('R-PROSE: the child_process allowlist must not present a PROPOSED amendment as ratified', () => {
  const DR_050 = path.resolve(__dirname, '..', '..', '..', 'docs', 'decisions', 'DR-050.md');
  const INVARIANTS = path.resolve(__dirname, 'invariants.test.ts');

  /** The `## Amendment (2026-08-25)` section of DR-050, heading to next heading. */
  function amendmentSection(): string {
    const text = fs.readFileSync(DR_050, 'utf8');
    const start = text.indexOf('## Amendment (2026-08-25)');
    expect(start, 'DR-050 has no 2026-08-25 amendment section').toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 3);
    const end = rest.indexOf('\n## ');
    return end < 0 ? rest : rest.slice(0, end);
  }

  /**
   * The run of whole-line `//` comments immediately above the
   * `'lib/ruleset-advisor.ts'` allowlist entry — the prose under review.
   */
  function allowlistComment(): string {
    const lines = fs.readFileSync(INVARIANTS, 'utf8').split('\n');
    const at = lines.findIndex((l) => l.trim() === "'lib/ruleset-advisor.ts',");
    expect(at, "invariants.test.ts has no 'lib/ruleset-advisor.ts' allowlist entry").toBeGreaterThan(
      0,
    );
    const block: string[] = [];
    for (let i = at - 1; i >= 0 && lines[i].trim().startsWith('//'); i--) block.unshift(lines[i]);
    return block.join('\n');
  }

  /** Does this prose mark the 2026-08-25 carve-out as not-yet-accepted? */
  function marksAmendmentProposed(prose: string): boolean {
    return /2026-08-25/.test(prose) && /\bproposed\b/i.test(prose);
  }

  it('DR-050 is accepted, but its 2026-08-25 amendment is NOT — the observation this rests on', () => {
    const section = amendmentSection();
    expect(section).toMatch(/proposed/i);
    expect(/Status:\s*`?accepted`?/i.test(section), 'the amendment now says accepted').toBe(false);
  });

  it('the allowlist comment says so, in the same breath as it lists the read that amendment sanctions', () => {
    const prose = allowlistComment();
    // Anchors: the right block, and one with something in it.
    expect(prose.length, 'no comment block above the allowlist entry').toBeGreaterThan(200);
    expect(prose).toMatch(/user\/memberships\/orgs/);

    expect(
      marksAmendmentProposed(prose),
      'the comment lists the memberships read without saying its amendment is still proposed',
    ).toBe(true);
  });

  it('the check is not inert — prose that merely NAMES the amendment does not satisfy it', () => {
    const decoy =
      '// `gh api user/memberships/orgs` GET (Amendment 2026-08-25, #1694) — the ONLY\n' +
      '// probe whose subject is the account. DR-050 is ACCEPTED.';
    expect(marksAmendmentProposed(decoy)).toBe(false);
  });
});

// =============================================================================
// THIRD CORRECTNESS REVIEW (2026-08-28) — one deletion and five fixes
// =============================================================================
//
// Every item below was REPRODUCED by driving `offerRulesetAdvisory` with scripted
// runners against real `git` and `gh` 2.98.0, and every one of them is reachable
// THROUGH the green suite above. A defect a passing suite cannot see is a defect
// the suite will let back in, so each gets a test as well as a fix.

// -----------------------------------------------------------------------------
// D1 — the decline memory is DELETED, not repaired
// -----------------------------------------------------------------------------
//
// A `minspec.repoCreateDeclined` git-config marker was added so "Not now" would
// stop nagging. It was never part of #1694, and it caused three separate defects:
//
//   1. The decline was permanent, total and silent. After one click the whole
//      branch rendered NOTHING — not the offer, and not the zero-network docs
//      link that always showed pre-#1694 — from a button labelled "Not now",
//      which promises a later ask that never came. Nothing named the flag, so
//      the only way back (`git config --unset minspec.repoCreateDeclined`) could
//      not be learned from inside the product.
//   2. The READ was machine-wide and the WRITE was repo-local. `git -C <folder>
//      config --get <key>` with no `--local` reads global and system config
//      (measured: a value in `GIT_CONFIG_GLOBAL` answers `true` against an empty
//      `.git/config`), while the write landed only in `.git/config`. One stray
//      global value disabled the offer in every repository on the machine, and
//      MinSpec could neither produce nor clear it — adjacent to constitution
//      invariant 3, which is about blast radius.
//   3. Shipped prose claimed the flag "travels with the repository". `git config
//      --local` is never transferred by `git clone` (measured: exit 1 in the
//      clone).
//
// Re-offering on each init is the pre-#1694 behaviour and is acceptable. If the
// nag is worth solving it is its own issue, not a rider on this one.

describe('D1: the create offer has no permanent off switch — nothing remembers a decline', () => {
  /**
   * Every `git config` WRITE the flow issued.
   *
   * A write is `config <key> <value>` — two arguments, neither a flag. Keyed that
   * way rather than on "not `--get`", because the flow also issues `config
   * --get-regexp ^remote\..*\.url$` (remote resolution), and a
   * `!args.includes('--get')` filter counts that READ as a write.
   */
  function configWrites(calls: ReturnType<typeof makeRunner>['calls']) {
    return calls.filter((c) => {
      if (c.cmd !== 'git') return false;
      const at = c.args.indexOf('config');
      if (at < 0) return false;
      const rest = c.args.slice(at + 1);
      return rest.length === 2 && rest.every((a) => !a.startsWith('-'));
    });
  }

  it('an explicit decline writes NOTHING — there is no flag to record', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // Anchor: the offer really fired and really was declined.
    expect(repoOfferCall(), 'the create offer never fired').toBeDefined();
    expect(configWrites(calls), 'a decline was recorded somewhere').toHaveLength(0);
  });

  it('reads NO git-config key at all, so a machine-wide value cannot disable the feature', async () => {
    // `configGetAnswer` answers `true` to EVERY `git config --get`, whatever the
    // key — the shape a stray value in GIT_CONFIG_GLOBAL produces for a repo whose
    // own .git/config is empty. The offer must be untouched by it, and the only
    // way to be untouched is to read no key.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({
      memberships: [membership('acme', 'admin')],
      configGetAnswer: 'true',
    });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(repoOfferCall(), 'a machine-wide git-config value suppressed the offer').toBeDefined();
    expect(
      calls.filter((c) => c.cmd === 'git' && c.args.includes('--get')),
      'the flow still reads a git-config key, so a global value can still reach it',
    ).toHaveLength(0);
  });

  it('declining TWICE offers twice — one click never removes the feature forever', async () => {
    // ONE runner across both inits, so anything the first pass wrote to git
    // config is readable by the second. That is the whole point: a fresh runner
    // per pass has an amnesiac `.git/config` and would pass whether or not a
    // suppression flag exists.
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });

    for (const pass of ['first init', 'second init']) {
      showInformationMessage.mockClear();
      answerToasts({ repoOffer: DECLINE_ACTION });

      await offerRulesetAdvisory('/ws/my-app', deps(run));

      expect(repoOfferCall(), `no offer on the ${pass}`).toBeDefined();
    }
    // Both passes read the account, because both passes made the offer. A
    // suppressed second init shows up here as 1.
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(2);
  });

  it('D1 (static): no orphan reference to the deleted flag survives in either source file', () => {
    const sources = [
      path.join(__dirname, '..', 'src', 'commands', 'init.ts'),
      path.join(__dirname, '..', 'src', 'lib', 'ruleset-advisor.ts'),
    ];

    /** The file with every comment line dropped — i.e. what actually executes. */
    function code(text: string): string {
      return text
        .split('\n')
        .filter((l) => {
          const t = l.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
    }

    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      // Anchor: the file was really read, and the comment stripper really left
      // something behind — an empty string satisfies every assertion below.
      expect(text.length, `${file} is empty`).toBeGreaterThan(1000);
      expect(code(text).length, `${file} stripped to nothing`).toBeGreaterThan(500);

      // The const, the reader and the writer are pure code identifiers, so they
      // are banned OUTRIGHT — including inside a `{@link ...}`, because a link to
      // a deleted symbol is a signpost pointing at nothing, which in a
      // never-wrong product is its own defect.
      for (const symbol of [
        /REPO_CREATE_DECLINED/,
        /hasDeclinedRepoCreate/,
        /recordRepoCreateDeclined/,
      ]) {
        expect(symbol.test(text), `${file} still references ${symbol}`).toBe(false);
      }

      // The git-config key may be NAMED in prose — a tombstone saying what was
      // deleted and why is what stops it being re-added — but nothing executable
      // may mention it, because reading or writing it is the defect.
      expect(
        /repoCreateDeclined/.test(code(text)),
        `${file} still reads or writes the decline flag`,
      ).toBe(false);
    }
  });
});

// -----------------------------------------------------------------------------
// F1 — the success toast must not route into a pre-existing deadlock (#1711)
// -----------------------------------------------------------------------------

describe('F1: the success toast does not send the user into an unsatisfiable ruleset (#1711)', () => {
  /**
   * Drive a create through to success and return THE SUCCESS TOAST — not the
   * whole transcript.
   *
   * The scoping matters. The OFFER in front of it legitimately says "Create one
   * so CI status checks and branch protection can be set up?", which is the true
   * reason the offer exists; a deny-list over `everythingSaid()` would flag that
   * sentence and force it out of copy it belongs in. What is under test is the
   * sentence the user reads AFTER the repository exists — the one that used to
   * hand them a next step that does not work.
   */
  async function successToast(): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [], createdSlug: 'octocat/my-app' });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    await offerRulesetAdvisory('/ws/my-app', deps(run));
    const call = showInformationMessage.mock.calls.find((c: unknown[]) =>
      /^MinSpec: created /.test(String(c[0])),
    );
    return String(call?.[0] ?? '');
  }

  it('never tells the user to re-run a MinSpec command to set up branch protection', async () => {
    const said = await successToast();

    // Anchor: a create really succeeded and really was announced.
    expect(said, 'the success toast never fired').toMatch(/created octocat\/my-app/i);

    // The instruction that was there: "push your first commit, then re-run
    // MinSpec: Initialize SDD Structure to set up branch protection". On that
    // re-run the ruleset offer asks for `MinSpec SDD validation + lint + test +
    // build`, of which only the first is reported by anything MinSpec scaffolds
    // (#1711) — so accepting pends every PR forever.
    expect(said, 'the success toast still instructs a re-run').not.toMatch(/re-run/i);
    expect(said, 'the success toast still promises branch protection').not.toMatch(
      /branch protection/i,
    );
    expect(said).not.toMatch(/branch ruleset/i);
  });

  it('still says what was created and that the remote was wired — the truth is not thrown out with the bad advice', async () => {
    const said = await successToast();
    expect(said).toMatch(/\(private\)/);
    expect(said).toMatch(/origin/);
    // ...and the one next step that IS true of an empty repository.
    expect(said).toMatch(/no commits/i);
    expect(said).toMatch(/push/i);
  });

  it('the code names the issue that owns the coupling, so the reason survives the diff', () => {
    const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'init.ts'), 'utf8');
    expect(text).toMatch(/#1711/);
  });
});

// -----------------------------------------------------------------------------
// F4 — the org-read remedy cannot fix the causes the code itself enumerates
// -----------------------------------------------------------------------------

describe('F4: the failed-org-read note never prescribes a remedy its own causes contradict', () => {
  /** The create offer's message, with the org read scripted to fail. */
  async function offerWithFailedOrgRead(): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      membershipsReply: fail(1, 'gh: Resource not accessible by integration (HTTP 403)'),
    });
    answerToasts({ repoOffer: DECLINE_ACTION });
    await offerRulesetAdvisory('/ws/my-app', deps(run));
    return String(repoOfferCall()?.[0] ?? '');
  }

  it('does not prescribe `gh auth refresh` — an inherited GITHUB_TOKEN makes it inert', async () => {
    const message = await offerWithFailedOrgRead();

    // Anchor: the offer fired and DID disclose the failed read.
    expect(message).toMatch(/could not read your organisations/i);

    // Measured against gh 2.98.0:
    //   $ GITHUB_TOKEN=... gh auth refresh -h github.com -s read:org
    //   The value of the GITHUB_TOKEN environment variable is being used for
    //   authentication. To refresh credentials stored in GitHub CLI, first clear
    //   the value from the environment.
    // The implementation's own comments enumerate at least four other causes —
    // an unauthed gh, a rate limit, malformed output, a token without read:org —
    // and the clause was unconditional. Same remedy-contradicts-reason defect an
    // earlier round already fixed for name collisions.
    expect(message, 'the offer still prescribes `gh auth refresh`').not.toMatch(/auth refresh/i);
  });

  it('names a diagnostic this code has already OBSERVED to work, rather than guessing a fix', async () => {
    const message = await offerWithFailedOrgRead();
    // `isGhReady` exited 0 on `gh auth status` moments earlier, so this one
    // command is known to answer — and it reports both the token SOURCE (which
    // exposes an inherited GITHUB_TOKEN) and its scopes (which exposes a missing
    // `read:org`). It is derived from an observation, not from a guess.
    expect(message).toMatch(/gh auth status/);
  });

  it('CONTROL: a SUCCESSFUL read renders no note at all', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const message = String(repoOfferCall()?.[0] ?? '');
    expect(message).toMatch(/acme\/my-app/);
    expect(message).not.toMatch(/could not read your organisations/i);
    expect(message).not.toMatch(/gh auth status/);
  });
});

// -----------------------------------------------------------------------------
// F5 — `not-attempted` offers a remedy that cannot apply, and loops on it
// -----------------------------------------------------------------------------

describe('F5: a create that never ran offers no remedy that cannot apply, and does not loop', () => {
  /** The failure toast, found by its SENTENCE — the retry action is what is under test. */
  function notAttemptedToast(): unknown[] | undefined {
    return showInformationMessage.mock.calls.find((c: unknown[]) =>
      /did not run the create/i.test(String(c[0])),
    );
  }

  /**
   * A folder `gh` would misread as a flag. Name and owner are pre-validated by
   * the caller before the create is called at all, so on the shipped path this is
   * the ONLY way to reach `not-attempted` — reproduced with
   * `offerRulesetAdvisory('-ws', ...)`.
   */
  async function createFromUnusableFolder(): Promise<void> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: REPO_RETRY_ACTION, docs: undefined });
    await offerRulesetAdvisory('-ws', deps(run));
  }

  it('never offers "Try another name" — a different name cannot fix an unusable folder', async () => {
    await createFromUnusableFolder();

    const toast = notAttemptedToast();
    // Anchor: the failure really was reported, and it really was this one.
    expect(toast, 'the not-attempted failure was never reported').toBeDefined();
    expect(String(toast?.[0])).toMatch(/not a usable source folder/);

    expect(
      (toast ?? []).slice(1),
      'the toast still offers a retry that cannot change the cause',
    ).not.toContain(REPO_RETRY_ACTION);
    expect(String(toast?.[0])).not.toMatch(/try another name/i);
  });

  it('asks for a name ONCE — no loop over a cause a retry cannot change', async () => {
    await createFromUnusableFolder();

    // Reproduced before the fix: "Try another name" was offered TWICE across
    // three cycles, each one re-opening the name box for a folder that had not
    // changed.
    expect(showInputBox, 'the name box re-opened for a cause a name cannot fix').toHaveBeenCalledTimes(1);
  });

  it('the remedy matches the cause: create it yourself, because the guard refused before anything ran', async () => {
    await createFromUnusableFolder();
    const message = String(notAttemptedToast()?.[0]);
    expect(message).toMatch(/nothing was created/i);
    expect(message).toMatch(/create the repository on GitHub yourself/i);
  });

  it('CONTROL: a NAME COLLISION still offers the retry — the remedy that CAN work there', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [],
      createReply: fail(1, 'GraphQL: Name already exists on this account (createRepository)'),
      originAfterCreate: null,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(createFailureToastCall(), 'the retry disappeared from the failure it CAN fix').toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// F6 — the copy names the command the user actually ran
// -----------------------------------------------------------------------------

describe('F6: the copy names the invoking command, not always the init one', () => {
  /**
   * The two palette titles that reach this advisory. Spelled as LITERALS rather
   * than imported: they must match what the Command Palette shows, and a shared
   * constant would let both the code and the test drift together.
   */
  const INIT_TITLE = 'MinSpec: Initialize SDD Structure';
  const REFRESH_TITLE = 'MinSpec: Refresh Harness Files';

  /**
   * Drive the create into a REFUSAL, which is where the re-run advice lives.
   *
   * It used to be the name collision. That sentence lost its re-run clause in the
   * fifth review (#1711's coupling: it told the user to add an `origin` first,
   * which is exactly what makes the NEXT run's ruleset offer unsatisfiable), so
   * the fixture moved to the failure where a re-run is genuinely the remedy —
   * nothing was added to the project, so re-running re-opens THIS offer and the
   * user picks a different account. See the G5 block for the drop itself.
   */
  const ORG_REFUSAL = 'GraphQL: acme has repository creation disabled for members (createRepository)';

  async function refusedCreate(invokedBy?: string): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [],
      createReply: fail(1, ORG_REFUSAL),
      originAfterCreate: null,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, docs: undefined });
    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), invokedBy });
    return everythingSaid();
  }

  /**
   * The refusal toast, found by its sentence — it deliberately carries no retry,
   * so it cannot be found by an action the way the other toasts are.
   *
   * Matched on `GitHub refused` rather than on the whole phrase it once used:
   * the sixth review split `refused` into three members with three sentences,
   * and an anchor keyed to one exact wording turns a copy edit into a broken
   * ANCHOR — which fails loudly here, but would pass vacuously in any test that
   * used the same idiom to assert something is ABSENT.
   */
  function refusalToast(): unknown[] | undefined {
    return showInformationMessage.mock.calls.find((c: unknown[]) =>
      /GitHub refused/i.test(String(c[0])),
    );
  }

  it('arriving from Refresh Harness Files is never told to re-run Initialize SDD Structure', async () => {
    const said = await refusedCreate(REFRESH_TITLE);

    // Anchor: the failure toast really fired, so the sentence really was rendered.
    expect(refusalToast(), 'the failure toast never fired').toBeDefined();
    expect(said).toMatch(/re-run/i);

    expect(said, 'a Refresh Harness Files user is told to re-run the INIT command').not.toContain(
      INIT_TITLE,
    );
    expect(said).toContain(REFRESH_TITLE);
  });

  it('CONTROL: arriving from Initialize SDD Structure names that one', async () => {
    const said = await refusedCreate(INIT_TITLE);
    expect(said).toContain(INIT_TITLE);
    expect(said).not.toContain(REFRESH_TITLE);
  });

  it('with no invoking command named, the copy is true from BOTH entry points', async () => {
    const said = await refusedCreate(undefined);
    expect(said).toContain(INIT_TITLE);
    expect(said).toContain(REFRESH_TITLE);
  });

  it('the no-destination dead end names NEITHER command — it no longer sends anyone back', async () => {
    // It used to name the invoking one, and that was the right fix for the wrong
    // sentence: the step it advised ADDS an `origin`, so the re-run it asked for
    // walks into #1711's unsatisfiable ruleset. The clause is gone, so there is
    // no command left to name — and naming one again would be the regression.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      invokedBy: REFRESH_TITLE,
      probeOwners: async () => ({ candidates: [], orgsRead: true }),
    });

    const said = everythingSaid();
    expect(docsToastCall(), 'the no-destination docs link never fired').toBeDefined();
    expect(said).toContain('origin');
    expect(said).not.toContain(REFRESH_TITLE);
    expect(said).not.toContain(INIT_TITLE);
  });

  // ── WIRED at the command level: each entry point supplies its OWN title ────
  // Asserted by driving the real commands, not by reading the source: a
  // `invokedBy` a caller forgets to pass is exactly the regression here, and only
  // an end-to-end call can see it.

  /** A scaffolded project on disk, ready for either command. */
  function projectDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-invokedby-'));
    scaffold(dir);
    generateHarnessFiles(dir);
    return dir;
  }

  /** A committer stub, so the commit offer never shells a real `git`. */
  const noCommitter = {
    makeCommitter: async () => ({
      isRepo: async () => false,
      add: async () => {},
      commit: async () => {},
      dirty: async () => [] as string[],
    }),
  };

  it('WIRED: initRefreshCommand names Refresh Harness Files', async () => {
    const dir = projectDir();
    try {
      resolveRepo.mockResolvedValue(null);
      const { run } = noRemoteRunner({
        memberships: [],
        createReply: fail(1, ORG_REFUSAL),
        originAfterCreate: null,
      });
      answerToasts({ repoOffer: REPO_CREATE_ACTION, docs: undefined });

      await initRefreshCommand(dir, {
        ...noCommitter,
        remoteRename: { isRepo: () => false },
        ruleset: { ...deps(run), isRepo: () => true },
      });

      expect(refusalToast(), 'the advisory never reached its failure toast').toBeDefined();
      expect(everythingSaid()).toContain(REFRESH_TITLE);
      expect(everythingSaid()).not.toContain(INIT_TITLE);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('WIRED: initCommand names Initialize SDD Structure — the control', async () => {
    const dir = projectDir();
    try {
      resolveRepo.mockResolvedValue(null);
      const { run } = noRemoteRunner({
        memberships: [],
        createReply: fail(1, ORG_REFUSAL),
        originAfterCreate: null,
      });
      answerToasts({ repoOffer: REPO_CREATE_ACTION, docs: undefined });

      await initCommand(dir, {
        ...noCommitter,
        remoteRename: { isRepo: () => false },
        githubPrExt: { isInstalled: () => true },
        ruleset: { ...deps(run), isRepo: () => true },
      });

      expect(refusalToast(), 'the advisory never reached its failure toast').toBeDefined();
      expect(everythingSaid()).toContain(INIT_TITLE);
      expect(everythingSaid()).not.toContain(REFRESH_TITLE);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// F7 — a consented mutation never aborts in silence (constitution invariant 2)
// -----------------------------------------------------------------------------

describe('F7: after an explicit "Create GitHub repo" click, nothing aborts silently', () => {
  it('a THROW mid-flow is reported, not swallowed by the outer catch', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    // The live swallow: any throw out of showQuickPick/showInputBox after the
    // consent click reached `offerRulesetAdvisory`'s outer `catch {}` and left a
    // user who clicked "Create GitHub repo" with total silence — indistinguishable
    // from pressing Escape. A swallowed error after a consented mutation is a
    // silent gate (constitution invariant 2).
    showQuickPick.mockRejectedValue(new Error('quick pick exploded'));

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    // Anchor: consent really was given, and nothing was created.
    expect(repoOfferCall(), 'the create offer never fired').toBeDefined();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);

    expect(showWarningMessage, 'the consented flow aborted in silence').toHaveBeenCalled();
    const said = collectStrings(showWarningMessage.mock.calls).join(' ');
    expect(said).toMatch(/quick pick exploded/);
  });

  it('an owner login the charset guard refuses SAYS SO rather than returning silently', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      // A candidate that never passes the CLI-boundary guard. Unreachable through
      // the shipped picker (the probe filters logins) — which is exactly why it
      // must not be the one path that ends in nothing at all.
      probeOwners: async () => ({
        candidates: [{ login: 'acme/evil', kind: 'org' as const, canAdminister: true }],
        orgsRead: true,
      }),
    });

    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(showWarningMessage, 'the owner guard returned in silence').toHaveBeenCalled();
  });

  it('a repository name the charset guard refuses SAYS SO rather than returning silently', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    // A box that returns a value its own validator would have rejected — the
    // injectable seam, and the guard behind it.
    showInputBox.mockResolvedValue('not a name/at all');

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(showWarningMessage, 'the name guard returned in silence').toHaveBeenCalled();
  });

  it('CONTROL: ESCAPING a picker stays silent — escape is an answer, not a failure', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    showQuickPick.mockResolvedValue(undefined);

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(repoOfferCall()).toBeDefined();
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(showWarningMessage, 'Escape was reported as a failure').not.toHaveBeenCalled();
  });

  it('CONTROL: escaping the NAME box stays silent too', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    showInputBox.mockResolvedValue(undefined);

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(showWarningMessage).not.toHaveBeenCalled();
  });
});

// =============================================================================
// THE BRANCH-GRANULARITY RULE (fifth correctness review, 2026-08-29)
// =============================================================================
//
// Four review rounds each fixed the reported sentences and introduced new ones
// IN THE SAME PLACE. The fifth named the GENERATOR rather than the instances:
//
//   Every defect was in a string chosen by a `switch` or ternary whose BRANCHES
//   WERE COARSER THAN THE PREDICATE THEY EXPLAIN.
//
// `CreateRepoFailure` had three members for failures with five shapes;
// `isSafeRepoSegment` had five rejections and one sentence; `unreadable` had two
// causes and one sentence. The rule that closes all of them at once is ONE
// MESSAGE PER REJECTION REASON, NOT PER OUTCOME TYPE — so these tests are
// written against the RULE, exercising every member of each widened union rather
// than the two members that happened to be reported.
//
// Each block below states the observation that made its defect real, because a
// test whose only justification is "the reviewer said so" cannot tell a later
// reader which half of the sentence is load-bearing.

/** Namespace view, so a NOT-YET-EXISTING export fails ONE test rather than the file. */
import * as advisor from '../src/lib/ruleset-advisor';

describe('G1: a refusal at the DESTINATION is its own failure — one create, no retry', () => {
  /**
   * REPRODUCED with a member-only org picked and the create failing. Both of
   * these fired THREE identical `gh repo create` calls and offered "Try another
   * name" twice, because `CreateRepoFailure` had no member for "the destination
   * refused the request" and everything that was not `name-taken` or
   * `not-attempted` fell into `unconfirmed`, which gets a retry.
   *
   * Neither stderr is fixed by a different NAME: one is about the org's
   * member-creation policy and the other about SSO enrolment. The owner picker
   * PREDICTED the first one step earlier ("your membership role is member, so
   * creating here may be refused") and then handed it a remedy that cannot
   * address it.
   */
  const MEMBER_POLICY = 'GraphQL: acme has repository creation disabled for members (createRepository)';
  const SAML_403 = 'gh: Resource protected by organization SAML enforcement (HTTP 403)';
  const PLAN_LIMIT = 'GraphQL: Upgrade to GitHub Team to create private repositories in acme (createRepository)';
  const COLLISION = 'GraphQL: Name already exists on this account (createRepository)';

  /** Drive the whole offer into an org the create then refuses. */
  async function createIntoOrg(stderr: string) {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = noRemoteRunner({
      memberships: [membership('acme', 'member')],
      createReply: fail(1, stderr),
      originAfterCreate: null,
    });
    answerPickers('acme');
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: REPO_RETRY_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return { creates: calls.filter((c) => isGhRepoCreate(c.cmd, c.args)) };
  }

  /** The failure toast, whatever sentence it carries — the LAST info toast that is not the offer. */
  function failureToast(): unknown[] | undefined {
    return showInformationMessage.mock.calls
      .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
      .pop();
  }

  it('an ORG POLICY refusal issues ONE create, never three at a target it was told it cannot write to', async () => {
    const { creates } = await createIntoOrg(MEMBER_POLICY);

    // Anchor: the create really was attempted, so "one" is not "none".
    expect(creates.length, 'the create never ran at all').toBeGreaterThan(0);
    expect(creates.length, 'the same argv was fired again after GitHub refused it').toBe(1);
    // ...and the identical argv is what made three of them indefensible.
    expect(showInputBox, 'the name box re-opened for a cause a name cannot fix').toHaveBeenCalledTimes(1);
  });

  it('a SAML/SSO 403 issues ONE create, never three', async () => {
    const { creates } = await createIntoOrg(SAML_403);

    expect(creates.length).toBeGreaterThan(0);
    expect(creates.length).toBe(1);
    expect(showInputBox).toHaveBeenCalledTimes(1);
  });

  it('a PLAN LIMIT issues ONE create, and is not reported as a permission problem', async () => {
    const { creates } = await createIntoOrg(PLAN_LIMIT);

    expect(creates.length).toBe(1);
    const said = String(failureToast()?.[0]);
    // The remedy that CAN work: public, or a paid plan. Never "a different name".
    expect(said).toMatch(/public|plan/i);
    expect(said).not.toMatch(/try another name/i);
  });

  it('the refusal toast WITHHOLDS "Try another name" — the remedy cannot apply', async () => {
    await createIntoOrg(MEMBER_POLICY);

    // Anchor first: the refusal WAS reported, so "no retry" is not "no toast".
    expect(failureToast(), 'the refusal was never reported at all').toBeDefined();
    // ...and NOT ONE toast in the whole flow carried the retry. Checking only the
    // last one passes vacuously on the defect: after three attempts the final
    // toast withholds the retry because the ATTEMPT CAP ran out, not because the
    // remedy was judged inapplicable.
    expect(
      createFailureToastCall(),
      'a toast dangled a retry that cannot change the refusal',
    ).toBeUndefined();
  });

  it('the refusal names a remedy that MATCHES it: the destination, not the name', async () => {
    await createIntoOrg(MEMBER_POLICY);

    const said = String(failureToast()?.[0]);
    // GitHub's own words are quoted...
    expect(said).toMatch(/repository creation disabled for members/i);
    // ...and the remedy addresses WHERE the repository would go.
    expect(said).toMatch(/account|owner|organisation|organization/i);
    expect(said).not.toMatch(/try another name/i);
  });

  it('CONTROL: an UNCONFIRMED failure still offers the retry — a new name CAN change that one', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [],
      createReply: fail(1, 'error: connection reset by peer'),
      originAfterCreate: null,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(createFailureToastCall(), 'the retry vanished from a failure it CAN fix').toBeDefined();
  });

  it('CONTROL: a NAME COLLISION still offers the retry', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [],
      createReply: fail(1, COLLISION),
      originAfterCreate: null,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(createFailureToastCall()).toBeDefined();
  });

  it('createGitHubRepo classifies each refusal shape as ITS OWN member of the union', async () => {
    const classify = async (stderr: string): Promise<string | undefined> => {
      const { run } = makeRunner((cmd, args) => {
        if (cmd === 'git') return fail(2, "error: No such remote 'origin'");
        if (isGhRepoCreate(cmd, args)) return fail(1, stderr);
        return undefined;
      });
      const res = await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run);
      return res.failure;
    };

    // ONE MEMBER PER REJECTION REASON: the two refusals reproduced above have
    // different remedies (an owner lifts a policy; only the token's SSO
    // authorisation lifts a SAML block), so they may not share a member — see G8.
    expect(await classify(MEMBER_POLICY)).toBe('refused-policy');
    expect(await classify(SAML_403)).toBe('refused-sso');
    expect(await classify(PLAN_LIMIT)).toBe('plan-limited');
    expect(await classify(COLLISION)).toBe('name-taken');
    expect(await classify('error: connection reset by peer')).toBe('unconfirmed');
  });
});

describe('G2: the name box explains the rule it actually rejected', () => {
  /**
   * CAPTURED from the live `validateInput`, which answered all five rejections
   * with one sentence — "Use letters, numbers, dots, dashes or underscores — no
   * spaces or slashes." — false for three of them:
   *
   *   ""            letters and dashes are not the problem; emptiness is
   *   "-lead"       letters + a dash only, and the message permits both
   *   ".."          dots only, and the message permits dots
   *   "a" x101      letters only; the length cap is never mentioned
   *   "has space"   correct, and the only one it was true of
   *
   * The docstrings were right that the box and the CLI boundary share one
   * PREDICATE. The EXPLANATION was a third artifact matching neither.
   */
  const REJECTIONS: Record<string, string> = {
    empty: '',
    leadingDash: '-lead',
    dotsOnly: '..',
    tooLong: 'a'.repeat(101),
    charset: 'has space',
  };

  /** The validator the shipped box installs — captured, never re-implemented. */
  async function nameBoxValidator(): Promise<(v: string) => string | undefined> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const options = showInputBox.mock.calls[0]?.[0] as
      | { validateInput?: (v: string) => string | undefined }
      | undefined;
    expect(options?.validateInput, 'the name box installed no validator').toBeTypeOf('function');
    return options!.validateInput!;
  }

  it('gives a DIFFERENT sentence to each of the five rejections', async () => {
    const validate = await nameBoxValidator();
    const said = Object.fromEntries(
      Object.entries(REJECTIONS).map(([k, v]) => [k, String(validate(v))]),
    );

    expect(
      new Set(Object.values(said)).size,
      `five rejections shared a sentence: ${JSON.stringify(said, null, 2)}`,
    ).toBe(5);
  });

  it('never permits the very thing it just rejected', async () => {
    const validate = await nameBoxValidator();

    // The old literal listed dashes and dots as allowed, and was printed for the
    // leading-dash and dots-only rejections. Whatever the wording, a message may
    // not enumerate as permitted the character class that caused the rejection.
    expect(String(validate(REJECTIONS.leadingDash))).not.toMatch(/dots, dashes/i);
    expect(String(validate(REJECTIONS.dotsOnly))).not.toMatch(/dots, dashes/i);
    expect(String(validate(REJECTIONS.tooLong))).not.toMatch(/dots, dashes/i);
  });

  it('names the rule it applied — position, dots, length, charset, emptiness', async () => {
    const validate = await nameBoxValidator();

    expect(String(validate(REJECTIONS.empty))).toMatch(/empty/i);
    expect(String(validate(REJECTIONS.leadingDash))).toMatch(/dash/i);
    expect(String(validate(REJECTIONS.dotsOnly))).toMatch(/dots/i);
    expect(String(validate(REJECTIONS.tooLong))).toMatch(/100/);
    expect(String(validate(REJECTIONS.charset))).toMatch(/spaces|slashes/i);
  });

  it('the SHARED-PREDICATE property survives: the box accepts exactly what the CLI boundary does', async () => {
    const validate = await nameBoxValidator();
    const corpus = [
      'my-app', 'a', 'a'.repeat(100), 'dots.in.name', 'under_score', 'MiXeD-99',
      '', ' ', '..', '.', '-lead', 'has space', 'a/b', 'a"b', "a'b", 'a;b', '$(x)',
      'a'.repeat(101), 'trailing-',
    ];
    for (const value of corpus) {
      expect(
        validate(value) === undefined,
        `box and CLI boundary disagree about ${JSON.stringify(value)}`,
      ).toBe(isSafeRepoSegment(value));
    }
  });

  it('the WARNING toast for a refused name carries the same per-rule explanation', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: REPO_CREATE_ACTION });
    // A box that returns a value its own validator would have rejected — the
    // seam the guard behind it exists for.
    showInputBox.mockResolvedValue('..');

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const said = collectStrings(showWarningMessage.mock.calls).join(' ');
    expect(said, 'the name guard returned in silence').not.toBe('');
    expect(said).toMatch(/dots/i);
    expect(said, 'the warning repeats the literal that permits what it rejected').not.toMatch(
      /dots, dashes/i,
    );
  });

  it('checkRepoSegment answers WHICH rule rejected, one member per rejection', () => {
    const check = (
      advisor as unknown as { checkRepoSegment?: (v: unknown) => string | null }
    ).checkRepoSegment;
    expect(check, 'no per-rejection predicate is exported').toBeTypeOf('function');

    expect(check!('my-app')).toBeNull();
    expect(check!(123)).toBe('not-text');
    expect(check!('')).toBe('empty');
    expect(check!('a'.repeat(101))).toBe('too-long');
    expect(check!('has space')).toBe('charset');
    expect(check!('-lead')).toBe('leading-dash');
    expect(check!('..')).toBe('dots-only');
  });
});

describe('G3: `unreadable` no longer covers a read that SUCCEEDED', () => {
  /**
   * REPRODUCED against real git with a hand-edited `.git/config` carrying
   * `[remote "foo"]` with a `fetch` line and an EMPTY `url`:
   *
   *   git remote                                -> code=0  out="foo\n"
   *   git config --get-regexp ^remote\..*\.url$ -> code=0  out="remote.foo.url \n"
   *
   * BOTH reads succeeded. `parseRemoteConfig` drops the blank URL, `resolveRemotes`
   * answers `none`, the confirming `git remote` prints a name — and the copy said
   * "could not read this project's git remotes", asserting a failure that did not
   * happen. Same for a remote with `fetch` and no `url` key at all.
   */
  function classifyRunner(opts: { urlConfig: Reply; remoteList: Reply }) {
    return makeRunner((cmd, args) => {
      if (cmd === 'gh') {
        if (args[0] === '--version') return ok('gh version 2.62.0');
        if (args[0] === 'auth') return ok('Logged in to github.com');
        if (isMembershipsRead(args)) return ok('[]');
        return undefined;
      }
      if (cmd === 'git') {
        if (args.includes('--get-regexp')) return opts.urlConfig;
        if (args[args.length - 1] === 'remote') return opts.remoteList;
        return ok('');
      }
      return undefined;
    });
  }

  async function sentenceFrom(opts: { urlConfig: Reply; remoteList: Reply }) {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = classifyRunner(opts);
    answerToasts({ repoOffer: DECLINE_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return { said: String(docsToastCall()?.[0] ?? ''), calls };
  }

  it('a remote whose URL is BLANK is reported as a remote without a URL, not as a failed read', async () => {
    const { said, calls } = await sentenceFrom({
      urlConfig: ok('remote.foo.url \n'),
      remoteList: ok('foo\n'),
    });

    expect(docsToastCall(), 'the docs-link toast never fired').toBeDefined();
    expect(
      said,
      'the sentence asserts a read failure when both reads exited 0',
    ).not.toMatch(/could not read this project's git remotes/i);
    expect(said).toMatch(/remote/i);
    expect(said).toMatch(/url/i);
    // Still fails CLOSED: a remote EXISTS, so no account read and no offer.
    expect(repoOfferCall()).toBeUndefined();
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(0);
  });

  it('a remote with NO url key at all reads the same way — git exits 1 with nothing, which is an answer', async () => {
    const { said } = await sentenceFrom({
      urlConfig: fail(1, ''),
      remoteList: ok('foo\n'),
    });

    expect(said).not.toMatch(/could not read this project's git remotes/i);
    expect(said).toMatch(/url/i);
  });

  it('COUNTS what it saw rather than assuming one', async () => {
    const { said } = await sentenceFrom({
      urlConfig: ok(''),
      remoteList: ok('foo\nbar\n'),
    });

    expect(said).toMatch(/\b2\b/);
    expect(said).toMatch(/remotes/i);
  });

  it('a URL read that genuinely FAILED says so — and names the read that failed', async () => {
    const { said } = await sentenceFrom({
      urlConfig: fail(128, 'fatal: unable to read config file'),
      remoteList: ok('foo\n'),
    });

    // Distinct from both siblings: the listing worked, the URL read did not.
    expect(said).toMatch(/get-regexp|url/i);
    expect(said).toMatch(/could not read/i);
  });

  it('CONTROL: the LISTING failing still says the git read failed — that one earned the sentence', async () => {
    const { said } = await sentenceFrom({
      urlConfig: ok(''),
      remoteList: fail(128, 'fatal: not a git repository'),
    });

    expect(said).toMatch(/could not read this project's git remotes/i);
  });

  it('CONTROL: zero remotes still reaches the create offer — the bound is unchanged', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = classifyRunner({ urlConfig: ok(''), remoteList: ok('') });
    answerToasts({ repoOffer: DECLINE_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(repoOfferCall(), 'the positively-empty case stopped offering').toBeDefined();
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(1);
  });
});

describe('G4: an UNCONFIRMED create never hands the same name back', () => {
  /**
   * The whole point of `unconfirmed` is that the repository MAY ALREADY EXIST
   * under exactly the name just attempted — `gh repo create --source` creates
   * through the API and only then wires the remote, so a non-zero exit is not
   * evidence the repository is absent. Seeding the retry box with that same name
   * therefore steers the user straight into the collision the first failure may
   * already have created.
   */
  async function seedsOnRetry(failure: string): Promise<string[]> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    const createRepo = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, remoteWired: false, failure, error: 'gh reported no detail' })
      .mockResolvedValueOnce({ ok: true, remoteWired: true, slug: 'octocat/whatever' });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: REPO_RETRY_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      createRepo: createRepo as unknown as RulesetAdvisoryDepsCreateRepo,
    });

    return showInputBox.mock.calls.map((c: unknown[]) => String((c[0] as { value?: string })?.value ?? ''));
  }

  it('seeds the retry with a DIFFERENT name than the one that may already exist', async () => {
    const seeds = await seedsOnRetry('unconfirmed');

    expect(seeds.length, 'the retry never re-opened the box').toBe(2);
    expect(seeds[0]).toBe('my-app');
    expect(
      seeds[1],
      'the retry re-offers the very name the failure may have created',
    ).not.toBe('my-app');
    // ...and whatever it offers must be a name the create would accept.
    expect(isSafeRepoSegment(seeds[1])).toBe(true);
  });

  it('CONTROL: a NAME COLLISION still seeds the attempted name — one keystroke from fixed', async () => {
    const seeds = await seedsOnRetry('name-taken');

    expect(seeds.length).toBe(2);
    expect(seeds[1]).toBe('my-app');
  });
});

describe('G5: the sibling strings no longer send the user back into an unsatisfiable ruleset', () => {
  /**
   * #1711's coupling, applied where it was still missing. The success toast
   * dropped "then re-run <command> to set up branch protection" because the
   * re-run walks into a ruleset requiring checks the repository cannot produce.
   * Two siblings kept saying it, and each ends with the user having ADDED an
   * `origin` — which is precisely the state that makes the next run fire the
   * ruleset offer.
   */
  const REFRESH_TITLE = 'MinSpec: Refresh Harness Files';

  it('the NAME-COLLISION remedy no longer ends in "re-run <command>"', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [],
      createReply: fail(1, 'GraphQL: Name already exists on this account (createRepository)'),
      originAfterCreate: null,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), invokedBy: REFRESH_TITLE });

    const said = String(createFailureToastCall()?.[0] ?? '');
    expect(said, 'the collision toast never fired').not.toBe('');
    // It still says what to do about the collision...
    expect(said).toMatch(/name already exists/i);
    // ...and stops before the step that walks into #1711.
    expect(said).not.toMatch(/re-run/i);
  });

  it('the NO-DESTINATION dead end no longer ends in "re-run <command>" either', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      invokedBy: REFRESH_TITLE,
      probeOwners: async () => ({ candidates: [], orgsRead: true }),
    });

    const said = String(docsToastCall()?.[0] ?? '');
    expect(said, 'the dead-end toast never fired').not.toBe('');
    expect(said).toMatch(/create .{0,40}repository/i);
    expect(said).not.toMatch(/re-run/i);
  });

  it('CONTROL: a REFUSAL still names the invoking command — re-running it adds no remote', async () => {
    // The distinction #1711 actually draws: a re-run is harmful only where the
    // user has been told to ADD AN `origin` first, because that is what makes the
    // next run fire the ruleset offer. After a refusal nothing was added, so the
    // re-run re-opens THIS offer — where a different owner is chosen — and is the
    // only remedy that can work.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [membership('acme', 'member')],
      createReply: fail(1, 'GraphQL: acme has repository creation disabled for members (createRepository)'),
      originAfterCreate: null,
    });
    answerPickers('acme');
    answerToasts({ repoOffer: REPO_CREATE_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), invokedBy: REFRESH_TITLE });

    const said = everythingSaid();
    expect(said).toContain(REFRESH_TITLE);
    expect(said).not.toContain('MinSpec: Initialize SDD Structure');
  });
});

describe('G6: the offer names the steps in the order it opens them, and never a placeholder', () => {
  it('lists visibility, owner, name — the order the flow actually asks', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [membership('acme', 'admin')] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const said = String(repoOfferCall()?.[0] ?? '');
    expect(said, 'the offer never fired').not.toBe('');
    expect(said).toContain('you pick the visibility, owner and name next');
    expect(said).not.toContain('you pick the owner, name and visibility next');
  });

  it('an unusable folder basename never renders the literal placeholder `<name>`', async () => {
    // `---` survives the charset pass and is stripped to nothing, so
    // `defaultRepoName` answers '' — and the copy interpolated it into
    // "Default: <name> under your personal account", printing the placeholder.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/---', deps(run));

    const said = String(repoOfferCall()?.[0] ?? '');
    expect(said).not.toBe('');
    expect(said, 'the offer rendered its own placeholder token').not.toContain('<name>');
    expect(said).toMatch(/personal account/i);
  });

  it('a default owner login failing the charset guard is never interpolated into the offer', async () => {
    // `probeOwnerCandidates` filters logins, but the probe is injectable and the
    // offer interpolates `candidates[0].login` with no guard of its own — the
    // same value the flow REFUSES to hand to `gh` one step later.
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    answerToasts({ repoOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      probeOwners: async () => ({
        candidates: [
          { login: 'acme/evil', kind: 'org' as const, canAdminister: true },
          { login: null, kind: 'user' as const, canAdminister: true },
        ],
        orgsRead: true,
      }),
    });

    const said = String(repoOfferCall()?.[0] ?? '');
    expect(said).not.toBe('');
    expect(said, 'an unguarded login was rendered as the destination').not.toContain('acme/evil');
  });
});

describe('G7: `gh` unavailable and `gh` signed out are two observations, not one', () => {
  /**
   * `isGhReady` collapsed both into `false`, and the one sentence behind it told
   * every user to "Install/authenticate the `gh` CLI" — half of it inapplicable
   * in each case. The remedies are entirely different commands.
   */
  async function ghFallbackSentence(opts: { version: Reply; auth: Reply }): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = makeRunner((cmd, args) => {
      if (cmd !== 'gh') return ok('');
      if (args[0] === '--version') return opts.version;
      if (args[0] === 'auth') return opts.auth;
      return undefined;
    });
    answerToasts({ docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return String(docsToastCall()?.[0] ?? '');
  }

  it('gh MISSING is told to install it, and never to sign in', async () => {
    const said = await ghFallbackSentence({ version: { throws: 'ENOENT' }, auth: ok('') });

    expect(said, 'the docs toast never fired').not.toBe('');
    expect(said).toMatch(/install/i);
    expect(said).not.toMatch(/gh auth login/i);
  });

  it('gh INSTALLED BUT SIGNED OUT is told to sign in, and never to install it', async () => {
    const said = await ghFallbackSentence({
      version: ok('gh version 2.62.0'),
      auth: fail(1, 'You are not logged into any GitHub hosts.'),
    });

    expect(said).not.toBe('');
    expect(said).toMatch(/gh auth login/i);
    expect(said).not.toMatch(/install/i);
  });
});

// =============================================================================
// SIXTH CORRECTNESS REVIEW (2026-08-30) — THE SAME GENERATOR, ONE LEVEL IN.
//
// The fifth review named the rule: ONE MESSAGE PER REJECTION REASON, NOT PER
// OUTCOME TYPE. Applying that rule to the code the fifth review WROTE finds
// three more sites where the branch set is coarser than the predicate behind it
// — two of them created by the fifth review's own fix:
//
//   G8  `isCreateRefused` matches FIVE shapes and `CreateRepoFailure` answers
//       with ONE member, whose sentence prescribes a permission remedy. A SAML
//       block is not lifted by asking an owner for repository-creation rights.
//   G9  `classifyForbidden` folds "a 403 was stated" and "the word forbidden,
//       with no status code" into `status-403`, and the sentence asserts
//       "(HTTP 403)" for both.
//   G10 `describeCreateFailure`'s `where` has THREE destinations (an org, the
//       personal account, an unspellable login) and TWO arms — so a refusal on
//       the user's OWN account advises them to ask its owner for permission.
//
// Each block states the observation that made its defect real.
// =============================================================================

describe('G8: a DESTINATION refusal says WHICH refusal it was — the remedies differ', () => {
  /**
   * The two shapes the fifth review reproduced, plus the third its predicate
   * already matched and never told apart.
   *
   * `isCreateRefused` is true of all three. Their remedies share nothing:
   *   - the org POLICY is lifted by an owner of the org (or another account);
   *   - the SAML block is lifted by AUTHORISING the token for that org's SSO —
   *     an owner granting creation rights changes nothing, and the token the
   *     user already holds is the thing that has to change;
   *   - a bare permission 403 establishes neither, so it may claim neither.
   */
  const MEMBER_POLICY = 'GraphQL: acme has repository creation disabled for members (createRepository)';
  const SAML_403 = 'gh: Resource protected by organization SAML enforcement (HTTP 403)';
  const PERMISSION_403 = 'gh: HTTP 403: Resource not accessible by personal access token';

  /** Drive the whole offer into `acme` and return the failure sentence. */
  async function refusalSentence(stderr: string): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [membership('acme', 'member')],
      createReply: fail(1, stderr),
      originAfterCreate: null,
    });
    answerPickers('acme');
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return String(
      showInformationMessage.mock.calls
        .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
        .pop()?.[0] ?? '',
    );
  }

  /** Classify a create failure straight through the library, with no UI. */
  async function classify(stderr: string): Promise<string | undefined> {
    const { run } = makeRunner((cmd, args) => {
      if (cmd === 'git') return fail(2, "error: No such remote 'origin'");
      if (isGhRepoCreate(cmd, args)) return fail(1, stderr);
      return undefined;
    });
    return (await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run)).failure;
  }

  it('gives each refusal shape its OWN member of the union, never one for all three', async () => {
    const policy = await classify(MEMBER_POLICY);
    const sso = await classify(SAML_403);
    const permission = await classify(PERMISSION_403);

    // Anchor: all three ARE refusals — the split must not lose any of them back
    // into `unconfirmed`, which is the member that offers a retry.
    for (const member of [policy, sso, permission]) {
      expect(member, 'a refusal fell back to a retryable member').not.toBe('unconfirmed');
      expect(member).toBeDefined();
    }
    // ...and they are THREE members, not one worn by three observations.
    expect(new Set([policy, sso, permission]).size, 'three refusals share one member').toBe(3);
  });

  it('a SAML/SSO refusal is never answered with a permission remedy', async () => {
    const said = await refusalSentence(SAML_403);

    expect(said, 'the refusal was never reported').not.toBe('');
    // GitHub's own words survive.
    expect(said).toMatch(/SAML/i);
    // The remedy that CAN work names the token's SSO authorisation...
    expect(said).toMatch(/single sign-on|authoris|authoriz/i);
    // ...and the one that cannot is absent: an owner granting creation rights
    // does not enrol a token in SSO.
    expect(
      said,
      'a SAML block was answered with "ask an owner for repository-creation rights"',
    ).not.toMatch(/repository-creation rights/i);
  });

  it('an ORG-POLICY refusal names the policy remedy, and never claims SSO', async () => {
    const said = await refusalSentence(MEMBER_POLICY);

    expect(said).toMatch(/repository creation disabled for members/i);
    expect(said).toMatch(/repository-creation rights/i);
    // Nothing here observed single sign-on, so nothing here may mention it.
    expect(said, 'an org policy was reported as an SSO problem').not.toMatch(/single sign-on|SAML/i);
  });

  it('a BARE permission 403 claims neither the policy nor SSO — it observed neither', async () => {
    const said = await refusalSentence(PERMISSION_403);

    expect(said).not.toBe('');
    expect(said, 'an unexplained 403 was reported as an org policy').not.toMatch(
      /disabled for members|creation policy/i,
    );
    expect(said, 'an unexplained 403 was reported as an SSO problem').not.toMatch(
      /single sign-on|SAML/i,
    );
  });

  it('CONTROL: all three still WITHHOLD "Try another name" — the split changes copy, not consent', async () => {
    for (const stderr of [MEMBER_POLICY, SAML_403, PERMISSION_403]) {
      vi.clearAllMocks();
      quickPickCalls.length = 0;
      showInputBox.mockImplementation(async (o?: { value?: string }) => o?.value ?? 'my-app');
      const said = await refusalSentence(stderr);
      expect(said, 'the refusal was never reported').not.toBe('');
      expect(createFailureToastCall(), `a retry was dangled at ${stderr}`).toBeUndefined();
    }
  });

  it('the SHARED-PREDICATE property survives: the bit accepts exactly what the classifier names', () => {
    const shapes = [MEMBER_POLICY, SAML_403, PERMISSION_403, 'gh: you are not authorized'];
    for (const s of shapes) {
      expect(advisor.classifyCreateRefusal(s), `${s} lost its shape`).not.toBeNull();
      expect(advisor.isCreateRefused(s), `${s} stopped counting as a refusal`).toBe(true);
    }
    // ...and the set did not widen: a plain network failure is still not a refusal.
    expect(advisor.classifyCreateRefusal('error: connection reset by peer')).toBeNull();
    expect(advisor.isCreateRefused('error: connection reset by peer')).toBe(false);
  });
});

describe('G9: "(HTTP 403)" is claimed only where a 403 was actually stated', () => {
  /**
   * `classifyForbidden` reaches `status-403` from TWO different observations —
   * `/\b403\b/` and `/forbidden/i` — and the sentence downstream asserts the
   * status code for both:
   *
   *     the request was refused (HTTP 403) and GitHub gave no reason MinSpec
   *     could quote
   *
   * A body of `{"error":"Forbidden"}` carries no status code anywhere, and
   * `githubReason` finds nothing quotable in it (no `message` key, no `gh:`
   * line), so it lands on exactly that arm. The refusal was observed; the 403
   * was not.
   */
  const WORDED = '{"error":"Forbidden"}';
  const STATED = '{"documentation_url":"https://docs.github.com/rest","status":"403"}';

  /**
   * Drive the ruleset-CREATE path to its failure sentence.
   *
   * The POST is matched on `POST` rather than on {@link apiPath}, because
   * `gh api -X POST repos/o/r/rulesets` puts `-X` before the path and `apiPath`
   * therefore answers `POST` for it. Matching on the path alone left the POST
   * unscripted, the runner threw `unexpected command`, and the sentence under
   * test became "the request failed" — a test that passes without ever reaching
   * the branch it names.
   */
  async function rulesetFailureSentence(body: string): Promise<{ said: string; posted: boolean }> {
    resolveRepo.mockResolvedValue('o/r');
    const { run, calls } = makeRunner((cmd, args) => {
      if (cmd !== 'gh') return undefined;
      if (args[0] === '--version') return ok('gh version 2.62.0');
      if (args[0] === 'auth') return ok('Logged in');
      if (args.includes('POST')) return { code: 1, stdout: body, stderr: '' };
      if (apiPath(args) === 'repos/o/r/rulesets') return ok('[]');
      return undefined;
    });
    answerToasts({ rulesetOffer: RULESET_CREATE_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return {
      said: String(docsToastCall()?.[0] ?? ''),
      posted: calls.some((c) => c.args.includes('POST')),
    };
  }

  it('tells a STATED 403 apart from a refusal that merely says "forbidden"', () => {
    const worded = advisor.classifyForbidden(WORDED);
    const stated = advisor.classifyForbidden(STATED);

    // Both are refusals — the split must not drop either out of the union.
    expect(worded).not.toBeNull();
    expect(stated).not.toBeNull();
    // ...and they are two shapes, because only one of them stated a status code.
    expect(worded, 'a refusal with no status code still answers "status-403"').not.toBe(stated);
  });

  it('never asserts "(HTTP 403)" about output that never mentioned one', async () => {
    const { said, posted } = await rulesetFailureSentence(WORDED);

    // ANCHORS, so a mis-scripted runner cannot pass this vacuously: the POST
    // really was issued, and its failure really was reported.
    expect(posted, 'the ruleset POST never fired').toBe(true);
    expect(said, 'the failure was never reported').not.toBe('');
    expect(said).toMatch(/could not create the ruleset/i);
    // ...and the refusal is stated without the status code nobody observed.
    expect(said).toMatch(/refused/i);
    expect(said, 'a status code nobody observed was reported as fact').not.toMatch(/HTTP 403/);
  });

  it('CONTROL: a STATED 403 keeps the status code it earned', async () => {
    const { said, posted } = await rulesetFailureSentence(STATED);

    expect(posted).toBe(true);
    expect(said).toMatch(/could not create the ruleset/i);
    expect(said).toMatch(/HTTP 403/);
  });

  it('CONTROL: the split does not change WHAT COUNTS as forbidden', async () => {
    const outcome = async (body: string) => {
      const { run } = makeRunner(() => ({ code: 1, stdout: body, stderr: '' }));
      return advisor.createRequiredChecksRuleset('o', 'r', run);
    };

    expect((await outcome(WORDED)).forbidden).toBe(true);
    expect((await outcome(STATED)).forbidden).toBe(true);
    expect((await outcome('{"message":"Not Found","status":"404"}')).forbidden).toBe(false);
  });
});

describe('G10: the refusal remedy fits the DESTINATION — your own account has no owner to ask', () => {
  /**
   * `where` is a two-armed ternary over `owner !== null && isSafeRepoSegment(owner)`
   * and the destinations are THREE: a nameable org, the PERSONAL account
   * (`login: null`, the value the personal row deliberately carries), and a
   * login the guard refuses. The last two collapse into "that account", and the
   * sentence built on it reads:
   *
   *     Ask an owner of that account for repository-creation rights
   *
   * On the personal path that is advice to ask yourself — the same
   * remedy-contradicts-reason defect the fifth review fixed one member up, in
   * the member the fifth review added.
   */
  const PERMISSION_403 = 'gh: HTTP 403: Resource not accessible by personal access token';
  const PLAN_LIMIT = 'GraphQL: Upgrade to GitHub Pro to create private repositories (createRepository)';

  /** Drive the offer with NO orgs, so the personal account is the only destination. */
  async function personalFailureSentence(stderr: string): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [],
      createReply: fail(1, stderr),
      originAfterCreate: null,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return String(
      showInformationMessage.mock.calls
        .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
        .pop()?.[0] ?? '',
    );
  }

  it('never tells the user to ask the owner of their OWN account for permission', async () => {
    const said = await personalFailureSentence(PERMISSION_403);

    expect(said, 'the refusal was never reported').not.toBe('');
    expect(said, 'the user was told to ask themselves for permission').not.toMatch(
      /ask an owner/i,
    );
  });

  it('names the destination it actually had, rather than the placeholder for one it could not spell', async () => {
    const said = await personalFailureSentence(PERMISSION_403);

    // The personal account is always nameable — it is named by WHAT IT IS.
    expect(said).toMatch(/your personal account/i);
    expect(said, '"that account" is the arm for a login MinSpec cannot spell').not.toMatch(
      /that account/i,
    );
  });

  it('a PLAN limit on the personal account names that account too', async () => {
    const said = await personalFailureSentence(PLAN_LIMIT);

    expect(said).toMatch(/plan/i);
    expect(said).toMatch(/your personal account/i);
    expect(said).not.toMatch(/that account/i);
  });

  it('CONTROL: an ORG refusal still names the org and the owner to ask', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [membership('acme', 'member')],
      createReply: fail(1, 'GraphQL: acme has repository creation disabled for members (createRepository)'),
      originAfterCreate: null,
    });
    answerPickers('acme');
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const said = String(
      showInformationMessage.mock.calls
        .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
        .pop()?.[0] ?? '',
    );
    expect(said).toMatch(/`acme`/);
    expect(said).toMatch(/ask an owner/i);
  });
});

describe('G11: the create-failure exhaustiveness guard must be able to fail', () => {
  /**
   * `describeCreateFailure` ends on
   *
   *     const _unhandled: never = result.failure as never;
   *
   * and the cast is the whole problem: `as never` succeeds for EVERY type, so a
   * member added to {@link CreateRepoFailure} without a sentence of its own
   * compiles cleanly and silently inherits the generic arm. The comment beside
   * it promises the opposite ("a new member narrows to something other than
   * `never` and fails typecheck"), which makes the guard's own documentation the
   * thing that hides its inertness.
   *
   * The cast was added for a real reason — `result.failure` is
   * `CreateRepoFailure | undefined`, so `undefined` reaches the default arm and
   * a bare `never` assignment would not compile. That is one more instance of
   * the rule this review applies: `undefined` (a success arrived at a failure
   * toast) and "a member nobody has taught this function" are two DIFFERENT
   * observations sharing one arm. Give `undefined` its own arm and the guard can
   * be real again.
   */
  const SRC = path.resolve(__dirname, '..', 'src', 'commands', 'init.ts');

  it('asserts `never` on the value itself, not on a cast that can never fail', () => {
    const src = fs.readFileSync(SRC, 'utf8');

    expect(
      /never\s*=\s*result\.failure\s+as\s+never/.test(src),
      'the `as never` cast makes the exhaustiveness guard unable to fail',
    ).toBe(false);
    expect(
      /const\s+_?\w*:\s*never\s*=\s*result\.failure\s*;/.test(src),
      'describeCreateFailure lost its `never`-typed exhaustiveness arm',
    ).toBe(true);
    // Not inert: a plain default arm does not satisfy the pattern.
    expect(/const\s+_?\w*:\s*never\s*=\s*result\.failure\s*;/.test('default:\n  return X;')).toBe(
      false,
    );
  });

  it('a success reaching the failure toast has an arm of its own', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    const fn = src.slice(src.indexOf('function describeCreateFailure'));

    expect(
      /case\s+undefined\s*:/.test(fn.slice(0, fn.indexOf('\n}\n'))),
      '`undefined` still shares the arm meant for members nobody has taught this function',
    ).toBe(true);
  });
});

describe('G12: a plan limit does not rule out the remedy that actually works', () => {
  /**
   * The `plan-limited` sentence asserts:
   *
   *     Neither a different name nor a different account changes that.
   *
   * The first half is true and the second is not. A plan is a property OF AN
   * ACCOUNT — "Upgrade to GitHub Pro to create private repositories" is a limit
   * on the account that was picked, and creating under an organisation on a paid
   * plan is precisely the thing that lifts it. The flow even offers that choice:
   * the owner picker is one re-run away.
   *
   * Not a branch-coarseness defect — one predicate, one member, one sentence —
   * but the same failure downstream of it: a remedy claim MinSpec had not
   * established, ruling out the option most likely to work.
   */
  const PLAN_LIMIT = 'GraphQL: Upgrade to GitHub Pro to create private repositories (createRepository)';

  async function planSentence(memberships: Array<Record<string, unknown>>): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships,
      createReply: fail(1, PLAN_LIMIT),
      originAfterCreate: null,
    });
    if (memberships.length > 0) answerPickers('acme');
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return String(
      showInformationMessage.mock.calls
        .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
        .pop()?.[0] ?? '',
    );
  }

  it('never claims a different ACCOUNT cannot lift it — a plan belongs to an account', async () => {
    const said = await planSentence([]);

    expect(said, 'the plan limit was never reported').not.toBe('');
    expect(said).toMatch(/plan/i);
    expect(
      said,
      'the sentence rules out picking an account whose plan allows it — which is what works',
    ).not.toMatch(/nor a different account/i);
  });

  it('keeps the half that IS true: a different name cannot change a plan limit', async () => {
    const said = await planSentence([]);

    expect(said).toMatch(/different name cannot change/i);
    // ...and the retry stays withheld, because that half is unchanged.
    expect(createFailureToastCall()).toBeUndefined();
  });

  it('offers the account choice as a remedy, from either destination', async () => {
    expect(await planSentence([])).toMatch(/pick an account/i);
    vi.clearAllMocks();
    quickPickCalls.length = 0;
    showInputBox.mockImplementation(async (o?: { value?: string }) => o?.value ?? 'my-app');
    expect(await planSentence([membership('acme', 'member')])).toMatch(/pick an account/i);
  });
});

describe('G13: the SSO sentence names the sign-on GitHub named, not an org it assumed', () => {
  /**
   * The `refused-sso` arm is the one member whose remedy is about the TOKEN, and
   * its sentence said "authorised for that organisation's SAML single sign-on".
   * `describeCreateFailure` is reachable with `owner === null` — the personal
   * account — where there is no organisation in the sentence at all, so the
   * phrase points at a noun the sentence never introduced.
   *
   * The fix is to quote the observation instead of naming a destination kind:
   * GitHub said single sign-on, so the sentence says the single sign-on GitHub
   * named.
   */
  const SAML_403 = 'gh: Resource protected by organization SAML enforcement (HTTP 403)';

  it('does not assert an ORGANISATION on a create aimed at the personal account', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [],
      createReply: fail(1, SAML_403),
      originAfterCreate: null,
    });
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    const said = String(
      showInformationMessage.mock.calls
        .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
        .pop()?.[0] ?? '',
    );
    // Anchors: it IS the SSO sentence, aimed at the personal account.
    expect(said).toMatch(/single sign-on/i);
    expect(said).toMatch(/your personal account/i);
    // ...and it does not introduce an organisation MinSpec never had.
    expect(
      said,
      "the SSO remedy names \"that organisation's\" on a personal-account create",
    ).not.toMatch(/that organisation/i);
  });
});

// =============================================================================
// SEVENTH CORRECTNESS REVIEW (2026-08-30) — THE GATE, APPLIED AS A RULE.
//
// Five rounds each fixed the sentences that were reported and created new ones
// at the site they had just touched. The rule that closes the class:
//
//   For every branch-selected user-facing string, the branch discriminant must
//   be the SAME VALUE THE PREDICATE PRODUCED, never a projection of it.
//
// `describeForbiddenShape` (commands/init.ts) is the working model — a real
// union, one arm per shape, a `never` default. Each block below names the
// projection that replaced one, and the observation that made it false.
//
//   H1  a BIT (`isForbidden`) where a union (`classifyForbidden`) was already
//       computed: five refusal shapes, one member, one owner-grant remedy.
//   H2  a two-armed ternary over a seven-member union, and the arms inverted:
//       the failure GitHub NAMED is the one handed its own name back.
//   H3  a remedy chosen from a projection that drops `willPickOwner`, so it
//       prescribes a screen the flow has already decided not to open.
//   H4  two reads under one `try`, so the second one's rejection is reported as
//       the first one's failure.
//   H5  two arms for three states, so the one the type documents as unnameable
//       is named from the request.
//   H6  a branch that never consults the remote state, so `gh`-unready plus no
//       repository re-creates the dead end #1694 exists to delete.
// =============================================================================

describe('H1: five refusal shapes, one member — and one of them no owner can grant', () => {
  /**
   * `classifyCreateRefusal`'s third arm is `/\bnot authorized\b/ || isForbidden`,
   * and `isForbidden` is the BIT form of `classifyForbidden` — a FOUR-member
   * union computed and thrown away one line before the decision. So five
   * observations arrive at the caller wearing `refused-permission`, whose
   * sentence prescribes "Ask an owner of `acme` for repository-creation rights".
   *
   * REPRODUCED with an org destination and the shape an inherited `GITHUB_TOKEN`
   * produces — the token `gh` PREFERS over its stored credentials, as this same
   * file documents:
   *
   *     gh: Resource not accessible by integration (HTTP 403)
   *
   * No owner grant lifts that. The thing that has to change is the TOKEN.
   */
  const TOKEN_403 = 'gh: Resource not accessible by integration (HTTP 403)';
  const NOT_ADMIN = 'gh: HTTP 403: Must have admin rights to Repository.';
  const BARE_403 = 'gh: HTTP 403';
  const WORDED = 'gh: {"error":"Forbidden"}';
  const NOT_AUTHORIZED = 'gh: you are not authorized to perform this action';
  const MEMBER_POLICY =
    'GraphQL: acme has repository creation disabled for members (createRepository)';

  /** Drive the whole offer into `acme` and return the failure sentence. */
  async function refusalSentence(stderr: string): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships: [membership('acme', 'member')],
      createReply: fail(1, stderr),
      originAfterCreate: null,
    });
    answerPickers('acme');
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return String(
      showInformationMessage.mock.calls
        .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
        .pop()?.[0] ?? '',
    );
  }

  /** Classify a create failure straight through the library, with no UI. */
  async function classify(stderr: string): Promise<string | undefined> {
    const { run } = makeRunner((cmd, args) => {
      if (cmd === 'git') return fail(2, "error: No such remote 'origin'");
      if (isGhRepoCreate(cmd, args)) return fail(1, stderr);
      return undefined;
    });
    return (await createGitHubRepo('/ws/my-app', 'acme', 'my-app', 'private', run)).failure;
  }

  it('a TOKEN refusal is never answered with a remedy no owner can grant', async () => {
    const said = await refusalSentence(TOKEN_403);

    expect(said, 'the refusal was never reported').not.toBe('');
    // GitHub's own words survive.
    expect(said).toMatch(/not accessible/i);
    // The remedy that CANNOT work is absent: an owner granting repository-creation
    // rights does not change which token `gh` is holding.
    expect(
      said,
      'a token refusal was answered with "ask an owner for repository-creation rights"',
    ).not.toMatch(/repository-creation rights/i);
    // ...and the thing that actually has to change is named.
    expect(said).toMatch(/token/i);
  });

  it('a ROLE refusal keeps the owner grant — it is the one the role admits', async () => {
    const said = await refusalSentence(NOT_ADMIN);

    expect(said).not.toBe('');
    expect(said).toMatch(/admin/i);
    // A role IS grantable, so the owner remedy belongs here...
    expect(said).toMatch(/owner of `acme`/i);
    // ...and the sentence must not call a role a policy, which nothing observed.
    expect(said, 'a role refusal was reported as an org policy').not.toMatch(
      /policy on the destination/i,
    );
  });

  it('classifyCreateRefusal answers with the shape, not with a bit', () => {
    const shapes = [
      advisor.classifyCreateRefusal(MEMBER_POLICY),
      advisor.classifyCreateRefusal(TOKEN_403),
      advisor.classifyCreateRefusal(NOT_ADMIN),
      advisor.classifyCreateRefusal(NOT_AUTHORIZED),
    ];
    // Four observations whose remedies differ; the classifier may not answer any
    // two of them with the same name.
    expect(new Set(shapes).size, 'refusal shapes collapsed into one another').toBe(4);
    for (const shape of shapes) expect(shape).not.toBeNull();
  });

  it('createGitHubRepo carries the token refusal as its OWN member of the union', async () => {
    const token = await classify(TOKEN_403);
    const role = await classify(NOT_ADMIN);
    const vague = await classify(BARE_403);

    expect(token, 'the token refusal shares a member with the vague one').not.toBe(vague);
    expect(role, 'the role refusal shares a member with the vague one').not.toBe(vague);
    expect(token).not.toBe(role);
    // ...and none of them fell back to the member that offers a retry.
    for (const member of [token, role, vague]) expect(member).not.toBe('unconfirmed');
  });

  it('CONTROL: an ORG POLICY still prescribes the owner grant — that one earned it', async () => {
    const said = await refusalSentence(MEMBER_POLICY);
    expect(said).toMatch(/repository-creation rights/i);
  });

  it('CONTROL: the accepted SET is unchanged — the split reports finer, it does not widen', () => {
    for (const s of [MEMBER_POLICY, TOKEN_403, NOT_ADMIN, BARE_403, WORDED, NOT_AUTHORIZED]) {
      expect(advisor.classifyCreateRefusal(s), `${s} stopped being a refusal`).not.toBeNull();
      expect(advisor.isCreateRefused(s), `${s} stopped counting as a refusal`).toBe(true);
    }
    expect(advisor.classifyCreateRefusal('error: connection reset by peer')).toBeNull();
    expect(advisor.isCreateRefused('error: connection reset by peer')).toBe(false);
  });
});

describe('H2: the retry seed is decided per failure, and the certainty is not inverted', () => {
  /**
   * REPRODUCED by accepting each seed (the Enter-key path on a pre-filled box):
   *
   *     name-taken:  seeds = ["X","X","X"]   createArgv = 3x identical `repo create X`
   *     unconfirmed: seeds = ["X","X-2","X-3"]
   *
   * `name-taken` is GitHub naming the name outright and gets the name back;
   * `unconfirmed`, where a collision is only POSSIBLE, gets the nudge. Same
   * "N identical creates at a destination GitHub already refused" the round was
   * opened to remove, surviving on the one failure GitHub explained.
   */
  async function retryRun(failure: string): Promise<{ seeds: string[]; names: string[] }> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({ memberships: [] });
    const createRepo = vi.fn(
      async (_f: string, _o: string | null, _name: string): Promise<CreateRepoResult> => ({
        ok: false,
        remoteWired: false,
        failure: failure as CreateRepoResult['failure'],
        error: 'GraphQL: Name already exists on this account (createRepository)',
      }),
    );
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: REPO_RETRY_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', {
      ...deps(run),
      createRepo: createRepo as unknown as RulesetAdvisoryDepsCreateRepo,
    });

    return {
      seeds: showInputBox.mock.calls.map((c: unknown[]) =>
        String((c[0] as { value?: string })?.value ?? ''),
      ),
      names: createRepo.mock.calls.map((c) => String(c[2])),
    };
  }

  it('a name GitHub CERTIFIED as taken is never handed back — no two creates are identical', async () => {
    const { seeds, names } = await retryRun('name-taken');

    // Anchor: the retry really looped to the cap, so the seeds below are real.
    expect(names.length, 'the retry never re-opened the box').toBe(3);
    expect(
      new Set(names).size,
      'the retry fired identical creates at a name GitHub said was taken',
    ).toBe(3);
    expect(seeds[1]).not.toBe(seeds[0]);
    for (const seed of seeds) expect(isSafeRepoSegment(seed)).toBe(true);
  });

  it('CONTROL: an UNCONFIRMED create still nudges — the arm that was already right', async () => {
    const { names } = await retryRun('unconfirmed');

    expect(names.length).toBe(3);
    expect(new Set(names).size).toBe(3);
  });
});

describe('H3: the account remedy is chosen from the value that decides whether the picker opens', () => {
  /**
   * REPRODUCED with a personal-only candidate set (no orgs, OR the org read
   * failed):
   *
   *     quickPicks opened = 1: ["Visibility for the new repository"]
   *     failToast: "...or re-run MinSpec: Initialize SDD Structure and pick a
   *                 different account"
   *     the prescribed re-run, executed: still no account choice on run 2.
   *
   * `willPickOwner` (`candidates.length > 1`) is computed one step earlier and
   * decides whether the owner picker opens at all. The remedy is chosen from a
   * projection that drops it.
   */
  const TOKEN_403 = 'gh: Resource not accessible by integration (HTTP 403)';
  const SAML_403 = 'gh: Resource protected by organization SAML enforcement (HTTP 403)';
  const PLAN_LIMIT =
    'GraphQL: Upgrade to GitHub Pro to create private repositories (createRepository)';

  async function failureSentence(
    stderr: string,
    memberships: Array<Record<string, unknown>>,
  ): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({
      memberships,
      createReply: fail(1, stderr),
      originAfterCreate: null,
    });
    if (memberships.length > 0) answerPickers('acme');
    answerToasts({ repoOffer: REPO_CREATE_ACTION, createFailure: undefined, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), invokedBy: 'MinSpec: Initialize SDD Structure' });

    return String(
      showInformationMessage.mock.calls
        .filter((c: unknown[]) => !c.slice(1).includes(REPO_CREATE_ACTION))
        .pop()?.[0] ?? '',
    );
  }

  it('a personal-only run never prescribes a picker the re-run will not open', async () => {
    const said = await failureSentence(TOKEN_403, []);

    expect(said, 'the refusal was never reported').not.toBe('');
    // THE OBSERVATION: one QuickPick opened this run, and it was the visibility
    // one — so nothing here offered a choice of account, and a re-run opens the
    // same single-candidate flow.
    expect(quickPickCalls.length, 'an owner picker opened after all').toBe(1);
    expect(ownerPickCall()).toBeUndefined();
    expect(
      said,
      'the remedy prescribes an account picker this flow does not open',
    ).not.toMatch(/pick a different account|pick an account/i);
    // ...and it names the check that CAN change the destination set.
    expect(said).toMatch(/gh auth status/i);
  });

  it('the SSO remedy does not prescribe it either', async () => {
    const said = await failureSentence(SAML_403, []);

    expect(said).toMatch(/single sign-on/i);
    expect(said).not.toMatch(/pick a different account|pick an account/i);
  });

  it('the PLAN remedy does not prescribe it either', async () => {
    const said = await failureSentence(PLAN_LIMIT, []);

    expect(said).toMatch(/plan/i);
    expect(said).not.toMatch(/pick a different account|pick an account/i);
    // The half that IS true survives: a plan belongs to an account, so another
    // account remains the remedy — it is just not reached through a picker.
    expect(said).toMatch(/different account|another account/i);
  });

  it('CONTROL: with more than one candidate the picker DOES open, and the remedy names it', async () => {
    const said = await failureSentence(TOKEN_403, [membership('acme', 'member')]);

    expect(ownerPickCall(), 'the owner picker never opened').toBeDefined();
    expect(said).toMatch(/pick a different account/i);
    expect(said).toContain('MinSpec: Initialize SDD Structure');
  });
});

describe('H4: one `try` for two reads attributes the second read`s failure to the first', () => {
  /**
   * REPRODUCED against a `.git/config` carrying `[remote "foo"]` with a `fetch`
   * line and no `url`:
   *
   *     git config --get-regexp ^remote\..*\.url$  -> code=1, no output (an ANSWER)
   *     git remote                                 -> code=0, "foo\n"   (ANSWERED)
   *     git config --get-regexp ^remote\..*\.url$  -> REJECTED
   *
   * The names WERE read. The toast said "could not read this project's git
   * remotes" — the sentence the fifth review split out as false for exactly this
   * state, reached again because both reads sit under one `catch`.
   */
  function urlReadRunner(secondUrlRead: Reply, remoteList: Reply) {
    let urlReads = 0;
    return makeRunner((cmd, args) => {
      if (cmd === 'gh') {
        if (args[0] === '--version') return ok('gh version 2.62.0');
        if (args[0] === 'auth') return ok('Logged in to github.com');
        if (isMembershipsRead(args)) return ok('[]');
        return undefined;
      }
      if (cmd === 'git') {
        if (args.includes('--get-regexp')) {
          urlReads += 1;
          // The FIRST is `resolveRemotes`, which answers "no url key" — exit 1
          // printing nothing, which is git's answer, not a failure.
          return urlReads === 1 ? fail(1, '') : secondUrlRead;
        }
        if (args[args.length - 1] === 'remote') return remoteList;
        return ok('');
      }
      return undefined;
    });
  }

  async function sentenceFrom(secondUrlRead: Reply, remoteList: Reply): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = urlReadRunner(secondUrlRead, remoteList);
    answerToasts({ repoOffer: DECLINE_ACTION, docs: undefined });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return String(docsToastCall()?.[0] ?? '');
  }

  it('a URL read that REJECTS after the names were listed never says the names could not be read', async () => {
    const said = await sentenceFrom({ throws: 'EAGAIN' }, ok('foo\n'));

    expect(said, 'the docs-link toast never fired').not.toBe('');
    expect(
      said,
      "a rejected URL read was reported as a failure to read the project's remotes",
    ).not.toMatch(/could not read this project's git remotes/i);
    // What was actually observed: one remote was NAMED, and its URL was not read.
    expect(said).toMatch(/\b1 git remote\b/);
    expect(said).toMatch(/could not read their URLs/i);
  });

  it('CONTROL: a URL read that FAILS with a status still lands on the same sentence', async () => {
    const said = await sentenceFrom(fail(128, 'fatal: unable to read config file'), ok('foo\n'));
    expect(said).toMatch(/\b1 git remote\b/);
    expect(said).toMatch(/could not read their URLs/i);
  });

  it('CONTROL: a LISTING that rejects still earns the failed-read sentence', async () => {
    const said = await sentenceFrom(ok(''), { throws: 'EAGAIN' });
    expect(said).toMatch(/could not read this project's git remotes/i);
  });
});

describe('H5: the success toast names a repository only in the state that has a name', () => {
  /**
   * REPRODUCED on the personal path where `gh` exits 0 printing an upgrade notice
   * plus the repository URL, so `parseCreatedSlug` correctly refuses to guess:
   *
   *     { ok: true, remoteWired: false }   (no slug)
   *     toast: "MinSpec: created my-app (private) ..."
   *
   * `CreateRepoResult.slug` documents `ok: true` with no slug as "the repository
   * exists, and MinSpec cannot name it", and `parseCreatedSlug`'s docstring says
   * echoing the request back "would then name a repository that does not exist"
   * because GitHub may normalise at creation time. The toast has two arms for
   * three states.
   */
  async function successToast(result: CreateRepoResult): Promise<string> {
    resolveRepo.mockResolvedValue(null);
    const { run } = noRemoteRunner({});
    const createRepo = vi.fn(async (): Promise<CreateRepoResult> => result);
    answerToasts({ repoOffer: REPO_CREATE_ACTION, rulesetOffer: DECLINE_ACTION });

    await offerRulesetAdvisory('/ws/my-app', { ...deps(run), createRepo });

    expect(createRepo, 'the create never ran').toHaveBeenCalledTimes(1);
    return everythingSaid();
  }

  it('an UNNAMEABLE success never names the repository from the request', async () => {
    const said = await successToast({ ok: true, remoteWired: false });

    expect(
      said,
      'the toast named a repository the result documents as unnameable',
    ).not.toMatch(/created\s+`?my-app/i);
    // It still says the repository EXISTS — declining to name it is not a licence
    // to report a failed create.
    expect(said).toMatch(/created the repository/i);
    expect(said).not.toMatch(/could not create/i);
    // ...and it says WHY it cannot name it, so the sentence is an observation.
    expect(said).toMatch(/no name|could not read/i);
  });

  it('a slug that FAILS the charset re-check is not swapped for the request either', async () => {
    const said = await successToast({ ok: true, remoteWired: true, slug: 'o/../../etc' });

    expect(said).not.toContain('o/../../etc');
    expect(said, 'an unspellable slug fell back to naming the request').not.toMatch(
      /created\s+`?my-app/i,
    );
    expect(said).toMatch(/created the repository/i);
  });

  it('CONTROL: an OBSERVED slug is still named out loud', async () => {
    const said = await successToast({ ok: true, remoteWired: true, slug: 'acme/my-app' });
    expect(said).toMatch(/created acme\/my-app/i);
  });
});

describe('H6: `gh` unready and no repository are two observations, and the dead end belongs to neither', () => {
  /**
   * REPRODUCED with no `gh` binary AND no remote: the toast advises protecting a
   * default branch with a ruleset and the docs button opens the RULESETS page —
   * the exact dead end #1694 was written to delete, and the reason
   * `REPO_CREATE_DOCS_URL` exists. `probeGhReadiness` runs before
   * `classifyRemotes`, so the remote state is never consulted: one message and
   * one URL for the cross product {not-installed, not-signed-in} x {has repo, no
   * repo}.
   */
  function unreadyRunner(opts: { version: Reply; auth: Reply; remotes: 'none' | 'one' }) {
    return makeRunner((cmd, args) => {
      if (cmd === 'gh') {
        if (args[0] === '--version') return opts.version;
        if (args[0] === 'auth') return opts.auth;
        return undefined;
      }
      if (cmd === 'git') {
        if (opts.remotes === 'none') return args.includes('--get-regexp') ? fail(1, '') : ok('');
        return args.includes('--get-regexp')
          ? ok('remote.origin.url https://github.com/o/r.git\n')
          : ok('origin\n');
      }
      return undefined;
    });
  }

  async function unreadyAdvisory(opts: {
    version: Reply;
    auth: Reply;
    remotes: 'none' | 'one';
  }): Promise<string> {
    resolveRepo.mockResolvedValue(opts.remotes === 'none' ? null : 'o/r');
    const { run } = unreadyRunner(opts);
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    return String(docsToastCall()?.[0] ?? '');
  }

  it('gh MISSING in a project with NO repository does not open the branch-rulesets page', async () => {
    const said = await unreadyAdvisory({
      version: { throws: 'ENOENT' },
      auth: ok(''),
      remotes: 'none',
    });

    expect(said, 'the docs toast never fired').not.toBe('');
    // The dead end itself: a ruleset is something you put ON a repository.
    expect(
      said,
      'a project with no repository was advised to protect a default branch',
    ).not.toMatch(/protect your default branch/i);
    expect(said).toMatch(/no git remote|no GitHub repository/i);
    // The remedy that IS true here survives.
    expect(said).toMatch(/install/i);
    expect(openExternal).toHaveBeenCalledWith(REPO_CREATE_DOCS_URL);
    expect(openExternal).not.toHaveBeenCalledWith(RULESET_DOCS_URL);
  });

  it('gh SIGNED OUT in a project with NO repository says the same thing about the repository', async () => {
    const said = await unreadyAdvisory({
      version: ok('gh version 2.62.0'),
      auth: fail(1, 'You are not logged into any GitHub hosts'),
      remotes: 'none',
    });

    expect(said).not.toMatch(/protect your default branch/i);
    expect(said).toMatch(/gh auth login/i);
    expect(said).not.toMatch(/install/i);
    expect(openExternal).toHaveBeenCalledWith(REPO_CREATE_DOCS_URL);
  });

  it('CONTROL: gh MISSING in a project that HAS a repository keeps the ruleset advisory', async () => {
    const said = await unreadyAdvisory({
      version: { throws: 'ENOENT' },
      auth: ok(''),
      remotes: 'one',
    });

    expect(said).toMatch(/protect your default branch/i);
    expect(openExternal).toHaveBeenCalledWith(RULESET_DOCS_URL);
  });

  it('CONTROL: neither unready branch ever creates anything or reads the account', async () => {
    resolveRepo.mockResolvedValue(null);
    const { run, calls } = unreadyRunner({
      version: { throws: 'ENOENT' },
      auth: ok(''),
      remotes: 'none',
    });
    answerToasts({ docs: DOCS_ACTION });

    await offerRulesetAdvisory('/ws/my-app', deps(run));

    expect(calls.filter((c) => c.cmd === 'gh' && c.args.includes('api'))).toHaveLength(0);
    expect(calls.filter((c) => isMembershipsRead(c.args))).toHaveLength(0);
    expect(calls.filter((c) => isRepoCreateMutation(c.cmd, c.args))).toHaveLength(0);
    expect(repoOfferCall()).toBeUndefined();
  });
});
