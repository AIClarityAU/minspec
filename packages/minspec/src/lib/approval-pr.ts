/**
 * approval-pr — the ONE place MinSpec opens a GitHub pull request (SPEC-050 FR-4).
 *
 * Partly extracted from `commands/push-docs-lane.ts` (SPEC-039) in SPEC-050 Slice 1
 * (the seam), with SPEC-039's command as its first caller. SEVEN symbols moved here
 * byte-for-byte — `ExecRun`, `defaultExecRun`, `isEnoent`, `describeError`,
 * `isNetworkError`, `isAuthError`, `slugFromOriginUrl`. Everything else is NET-NEW
 * in SPEC-050 and must be read as new code, not skimmed as a move: `DOCS_LANE_LABEL`,
 * the `OpenPr*` types, `buildPrCreateArgs`, `laneLabelsFor`, `branchChangedPaths`,
 * `buildApprovalPrBody`, `resolveHeadSha`, `findOpenPrForHead`, `urlFromAlreadyExists`
 * and `openPullRequest`.
 *
 * (An earlier revision of this header claimed "every symbol below arrived here
 * byte-for-byte". That was false and actively harmful — a reviewer who believes it
 * skims exactly the FR-6 adoption logic, the INV-2 label predicate and the body
 * builder, which are the three places a bug would actually be. Corrected in the
 * #1224 review.)
 *
 * The reason the moved symbols had to MOVE rather than be
 * imported in place is the Tier-0 layer rule — `eslint.config.mjs`'s
 * NO_UI_LAYER_FROM_LIB forbids `lib/** -> commands/**` at severity `error` with
 * `noInlineConfig: true` (pinned by `tests/import-boundaries.test.ts`), so a
 * `lib/` seam can never reach back into the command that used to own the runner.
 * Both callers therefore depend on this module, and neither depends on the other.
 *
 * FR-4's load-bearing consequence: there is exactly ONE `gh pr create` invocation
 * in the codebase — {@link openPullRequest}. One place where timeout, ENOENT,
 * auth and offline classification are correct; one place a future fix lands.
 *
 * TIER-0 POSTURE (load-bearing):
 *   - NO `vscode` import, not even a type one. Every user-facing surface — toast,
 *     modal, status suffix — stays in `commands/`, so this module is unit-testable
 *     against a stub runner with no editor host. `tests/import-boundaries.test.ts`
 *     asserts the vscode-warn set is EXACTLY the seven pre-existing lib files, so
 *     adding an import here would fail that gate rather than drift past it.
 *   - It DOES import `child_process`, which is why `lib/approval-pr.ts` is listed
 *     in `tests/invariants.test.ts`'s CHILD_PROCESS_ALLOWLIST. That entry rests on
 *     the CONSENT clause of constitution invariant #1, not on a "local git only"
 *     claim: `gh pr create` is a network act, performed by the USER's own
 *     authenticated CLI, and it is unreachable unless a consented push already
 *     succeeded (SPEC-050 INV-1). MinSpec opens no socket itself — the same
 *     Tier-1 local-tool-delegation posture (DR-004) as `lib/approve-push.ts`.
 *   - The only in-repo dependency is `./docs-corpus`, a pure predicate that does
 *     zero I/O, so {@link laneLabelsFor} is decidable offline.
 *
 * NEVER-WRONG invariants this module owns (SPEC-050 INV-2/INV-4/INV-5):
 *   INV-2 (never a non-docs PR). {@link laneLabelsFor} mints the `docs-lane` label
 *     only when EVERY supplied path is in the corpus. Empty OR `undefined` input
 *     yields no label — an unproven absolute fails closed (constitution invariant
 *     #2), never "probably docs".
 *
 *     TWO THINGS THIS DOES NOT CLAIM, both corrected in the #1224 review:
 *
 *     (a) It is NOT the only place the label is minted. `push-docs-lane.ts` passes
 *         `labels: [DOCS_LANE_LABEL]` as a literal, having filtered its own file
 *         list through `isDocsCorpusPath` first. That path is safe, but it is safe
 *         by habit at the call site rather than by this predicate — so do not read
 *         a chokepoint guarantee here that the code does not provide. Folding that
 *         caller onto {@link laneLabelsFor} would make the guarantee real; it is
 *         out of SPEC-050's approved scope and is tracked rather than smuggled in.
 *
 *     (b) The predicate is only as good as the paths it is HANDED. Callers opening
 *         a PR from a branch must pass {@link branchChangedPaths}' output — what
 *         the PR really changes — not the paths of one commit on it. The first
 *         revision passed the latter, which is how a docs-only label could have
 *         landed on a PR that changed code.
 *   INV-4 (never mints or edits an approval record). Nothing here writes to disk.
 *     {@link buildApprovalPrBody} PRESENTS a record `MinSpec: Approve Spec`
 *     already wrote; the body is never authoritative (DR-012, #1025).
 *   INV-5 (never throws). {@link openPullRequest} resolves a typed
 *     {@link OpenPrResult} for every failure — missing binary, unauthenticated,
 *     offline, hook rejection, timeout, or a non-`Error` throw. An approval must
 *     never be lost or obscured by a PR-opening failure.
 *
 * ASYNC + bounded: `gh`/`git` run off the extension-host thread (async execFile)
 * with a per-call timeout, so a hung network cannot freeze the UI.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { isDocsCorpusPath } from './docs-corpus';
import type { ApprovalRecord } from './approval';

const execFileAsync = promisify(execFile);

/** Max time (ms) any single git/gh invocation may run — bounds a hung hook/network. */
const GIT_TIMEOUT_MS = 30_000;

/**
 * The label `.github/workflows/docs-lane.yml:30` gates on. Minted in exactly one
 * place ({@link laneLabelsFor}) so INV-2 is a property of the code, not a habit.
 */
export const DOCS_LANE_LABEL = 'docs-lane';

/**
 * Minimal git/gh surface, injectable so tests drive a stub instead of spawning a
 * real subprocess. Resolves `{ stdout, stderr }` and REJECTS on a non-zero exit
 * (matching `execFile`), which each step's try/catch classifies. A missing binary
 * rejects with `code: 'ENOENT'`.
 */
export type ExecRun = (
  file: 'git' | 'gh',
  args: readonly string[],
  opts?: { cwd?: string; env?: Record<string, string> },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Default git/gh runner. GIT_LITERAL_PATHSPECS=1 disables glob/magic pathspec
 * interpretation for every git invocation (so a `[`/`*`/`?` in a docs path can
 * never match a foreign sibling), mirroring `approve-commit.ts`. stdout+stderr
 * are captured so a hook/auth/network failure carries its reason into the result.
 */
export function defaultExecRun(): ExecRun {
  return async (file, args, opts) => {
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      cwd: opts?.cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', ...opts?.env },
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  };
}

/** True when the error is a missing-executable ENOENT (the binary is not installed). */
export function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'ENOENT';
}

/** Human-readable error, preferring the git/gh stderr when present. */
export function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; message?: unknown };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    if (stderr) return stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

/** Does an error message look like a network/DNS/connection failure (→ 'offline')? */
export function isNetworkError(message: string): boolean {
  return /could ?n'?t? resolve host|resolve host|network is unreachable|temporary failure in name resolution|failed to connect|could not connect|connection (refused|reset|timed out)|unable to access|operation timed out|timed out|no route to host|dial tcp|proxy|ssl|tls/i.test(
    message,
  );
}

/** Does a `gh` error look like an authentication failure (→ 'gh-unauthenticated')? */
export function isAuthError(message: string): boolean {
  return /not logged (in|into)|authentication|auth status|gh auth login|requires? authentication|no such host.*api|401|403|bad credentials|token/i.test(
    message,
  );
}

/**
 * Derive `owner/repo` from an `origin` remote URL (ssh or https), stripping a
 * trailing `.git`. Returns undefined when the URL isn't a recognizable GitHub
 * remote — the caller then lets `gh` infer the repo from the worktree's remote.
 */
export function slugFromOriginUrl(url: string): string | undefined {
  const u = url.trim().replace(/\.git$/, '');
  // git@github.com:OWNER/REPO  |  ssh://git@github.com/OWNER/REPO
  // https://github.com/OWNER/REPO  |  https://x@github.com/OWNER/REPO
  const m = u.match(/[/:]([^/:]+\/[^/]+)$/);
  return m ? m[1] : undefined;
}

// ─── The seam: open (or adopt) a pull request ────────────────────────────────

/**
 * Outcome of one {@link openPullRequest} attempt. Never an exception (INV-5) —
 * always exactly one of these.
 *
 * `created` and `adopted` are BOTH successes and deliberately distinct: FR-6
 * (idempotency) needs the caller to be able to say "already open" rather than
 * claim it opened a second PR, and a never-wrong product must not report a
 * creation that did not happen.
 */
export type OpenPrOutcome =
  | 'created' //             a new PR was opened (url set)
  | 'adopted' //             an open PR already existed for this head (url set) — FR-6
  | 'gh-absent' //           the `gh` CLI is not installed (ENOENT)
  | 'gh-unauthenticated' //  `gh` is installed but not logged in
  | 'offline' //             a network step could not reach GitHub
  | 'failed'; //             any other gh error

export interface OpenPrRequest {
  /** Injected git/gh runner — production passes {@link defaultExecRun}. */
  readonly run: ExecRun;
  /** Directory `gh` runs in; it infers the base repo from this tree's `origin`. */
  readonly cwd: string;
  /** The already-pushed head branch. This seam NEVER pushes — see INV-1/INV-3. */
  readonly head: string;
  readonly title: string;
  readonly body: string;
  /**
   * Labels to apply. New callers should pass {@link laneLabelsFor}'s output rather
   * than a literal, so the corpus decision is made by the predicate instead of at
   * the call site. (`push-docs-lane.ts` predates that and still passes a literal
   * after filtering its own list — safe, but not the same guarantee. See the INV-2
   * note in this module's header.) An empty array emits no `--label`.
   */
  readonly labels: readonly string[];
  /** Base branch. Omitted → `gh` uses the base repo's own default branch. */
  readonly base?: string;
  /** `owner/repo`. Omitted → `gh` infers it from `cwd`'s `origin` remote. */
  readonly slug?: string;
  /**
   * FR-6. When true, probe for an existing open PR on `head` first and adopt it
   * instead of creating a second one, and treat a create-time "already exists"
   * as an adoption (which closes the probe→create race).
   *
   * DEFAULT false, deliberately: SPEC-039's command never made that probe, and
   * Slice 1 is a pure refactor (R3/AC-10). Only SPEC-050's approval path opts in.
   */
  readonly adoptExisting?: boolean;
}

export interface OpenPrResult {
  readonly outcome: OpenPrOutcome;
  /** The PR URL (present on 'created' and 'adopted'). */
  readonly url?: string;
  /** Error detail incl. gh stderr (present on 'offline'/'failed'/'gh-unauthenticated'). */
  readonly error?: string;
}

/**
 * Build the `gh pr create` argv. PURE — no I/O, no spawning — so the exact flags
 * MinSpec would send are assertable without a subprocess (AC-2/AC-10).
 *
 * The order below reproduces SPEC-039's original literal array exactly, so the
 * extraction is provably byte-identical for `{ slug, base: 'main', labels:
 * ['docs-lane'] }`. `--repo` and `--base` are omitted when absent rather than
 * passed empty: `gh` then resolves the base repo and ITS default branch from
 * `cwd`'s origin, which is correct in a repo whose default branch is not `main`.
 */
export function buildPrCreateArgs(
  req: Omit<OpenPrRequest, 'run' | 'cwd' | 'adoptExisting'>,
): string[] {
  return [
    'pr',
    'create',
    ...(req.slug ? ['--repo', req.slug] : []),
    ...(req.base ? ['--base', req.base] : []),
    '--head',
    req.head,
    '--title',
    req.title,
    ...req.labels.flatMap((label) => ['--label', label]),
    '--body',
    req.body,
  ];
}

/**
 * INV-2 predicate: decides `docs-lane` from evidence. (NOT the only place the label
 * is minted — `push-docs-lane.ts` passes a literal; see the header's INV-2 note.)
 *
 * Returns `[DOCS_LANE_LABEL]` iff `paths` is non-empty AND every entry is in the
 * docs corpus; `[]` otherwise — including for `undefined`, which means the caller
 * could not determine the PR's real changed set. The non-empty requirement is not a formality — an
 * empty list would make `every` vacuously true, which is precisely the
 * unproven-absolute / silent-gate class constitution invariant #2 forbids. A
 * caller that cannot enumerate what it committed has not PROVEN the change is
 * docs-only, so it does not get the label that skips a human merge keystroke.
 *
 * `.github/workflows/docs-lane.yml:33/:52-54` independently re-verifies the paths
 * server-side and refuses loudly on a mismatch — two witnesses, so a bug here
 * cannot land code on an auto-merge lane.
 */
export function laneLabelsFor(paths: readonly string[] | undefined): string[] {
  // `undefined` means the caller COULD NOT DETERMINE the PR's real changed paths
  // (see branchChangedPaths). Unproven is not the same as docs-only, and the
  // fail-closed answer is no label — mirroring the constitution's "unmeasured
  // blast = high blast" and invariant #2's refusal to let a missing witness pass.
  if (!Array.isArray(paths) || paths.length === 0) return [];
  return paths.every((p) => isDocsCorpusPath(p)) ? [DOCS_LANE_LABEL] : [];
}

/** Inputs for {@link buildApprovalPrBody}. Every field but `paths` may be absent. */
export interface ApprovalPrBodyInput {
  /** Repo-relative paths carried by the approval commit. */
  readonly paths: readonly string[];
  /**
   * The sidecar record `MinSpec: Approve Spec` already wrote, READ ONLY (INV-4).
   * Undefined on the ADR/epic accept paths, which write no sidecar — the body
   * then omits those lines rather than inventing them.
   */
  readonly record?: ApprovalRecord;
  /** The approval commit SHA, when it could be resolved. */
  readonly sha?: string;
  /**
   * The labels the PR is actually being opened with — {@link laneLabelsFor}'s
   * output, not an intention. The opening line claims docs-lane membership ONLY
   * when `DOCS_LANE_LABEL` is really among them; otherwise it says the PR needs
   * a human merge. Omitted (undefined) means "don't claim either way".
   *
   * Load-bearing, not cosmetic: an unlabelled PR whose body announces it rides
   * the auto-merge lane is a false statement in the artifact a reviewer reads —
   * the same never-wrong defect class as a body that looks like a signed record
   * and is not one (#1025). The body must describe the PR that exists.
   */
  readonly labels?: readonly string[];
}

/**
 * SPEC-050 OQ-2: the PR body carries the provenance facts a reviewer cannot
 * derive from the diff — approved artifact, tier, approver email, `specHash`,
 * and the approval commit — so a human skimming the merge queue can confirm WHO
 * SIGNED WHAT without opening the files. (#1025: the AI panel demonstrably
 * cannot infer this, and called two legitimate human approvals forged.)
 *
 * Two disciplines, both load-bearing:
 *   - **Omit, never invent.** Any datum whose source is absent produces no line
 *     at all — never `undefined`, never an empty value that reads as a fact.
 *   - **Presentation, never authority (INV-4).** The closing disclaimer says so
 *     in the artifact itself, because a body that LOOKS authoritative is exactly
 *     how a forged-sign-off would be smuggled past a skimming reviewer. The
 *     sidecar under `.minspec/approvals/` remains the only source of truth
 *     (DR-012); nothing here writes it.
 */
export function buildApprovalPrBody(input: ApprovalPrBodyInput): string {
  const { record, sha, labels } = input;
  const lane =
    labels === undefined
      ? 'MinSpec approval record.'
      : labels.includes(DOCS_LANE_LABEL)
        ? 'MinSpec approval record, labelled for the **docs-lane**.'
        : 'MinSpec approval record. NOT labelled for the docs-lane — these paths are ' +
          'not docs-only, so this PR needs a human merge.';
  const lines: string[] = [lane, ''];

  const artifact = record?.specPath ?? input.paths[0];
  if (artifact) lines.push(`- **Approved artifact:** \`${artifact}\``);
  if (record?.tier) lines.push(`- **Tier:** ${record.tier}`);
  if (record?.approvedBy) lines.push(`- **Approved by:** ${record.approvedBy}`);
  if (record?.approvedAt) lines.push(`- **Approved at:** ${record.approvedAt}`);
  if (record?.specHash) lines.push(`- **specHash:** \`${record.specHash}\``);
  if (sha) lines.push(`- **Approval commit:** \`${sha}\``);

  if (input.paths.length > 0) {
    lines.push('', 'Files:');
    for (const p of input.paths) lines.push(`- \`${p}\``);
  }

  lines.push(
    '',
    '_This body presents the approval record for review convenience; it is never ' +
      'authoritative. The sidecar under `.minspec/approvals/` is the only source of ' +
      'approval state (DR-012)._',
  );
  return lines.join('\n');
}

/**
 * Read `HEAD` in `cwd` — a local, read-only probe (INV-3: no `checkout`/`switch`/
 * `merge`/`rebase`/`reset` anywhere in this module). Returns undefined on ANY
 * failure, and never throws, so a missing SHA degrades one body line rather than
 * the PR.
 *
 * Note the honest semantics: this is HEAD **at read time**, not a SHA captured
 * when the approval was committed. It is the approval commit for SPEC-050's
 * caller because `approve-push.ts` branches at HEAD, never moves the checkout,
 * and deletes only its local throwaway ref — all within the same synchronous
 * flow. A future caller that does move HEAD in between must pass its own SHA.
 */
export async function resolveHeadSha(run: ExecRun, cwd: string): Promise<string | undefined> {
  try {
    const sha = (await run('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim();
    return sha || undefined;
  } catch {
    return undefined;
  }
}

/**
 * INV-2 EVIDENCE — every path the PR would actually change, as
 * `git diff --name-only <base>...<head>` (three dots: merge-base to head).
 *
 * WHY THIS EXISTS. The first revision labelled from the APPROVAL COMMIT's paths.
 * That is not the same set: the branch is created at the developer's local HEAD,
 * so its real diff against the base is `merge-base(base, head)..head` and can
 * carry earlier local commits touching anything at all. Labelling `docs-lane`
 * from the narrower set meant a PR could be labelled docs-only while genuinely
 * changing code — the exact thing INV-2 forbids. Caught in review on #1224.
 *
 * FAILS CLOSED, and that direction is load-bearing: any failure (git absent,
 * unknown base, detached state, unreadable output) returns `undefined`, and
 * {@link laneLabelsFor} treats `undefined` as "cannot prove docs-only" → NO
 * label → no auto-merge → a human merges it. The costly error here is a
 * non-docs PR riding an auto-merge lane; an unlabelled docs PR costs one
 * keystroke.
 *
 * `-z` + NUL split so a path containing a newline cannot forge an extra entry.
 */
export async function branchChangedPaths(
  run: ExecRun,
  cwd: string,
  base: string,
  head: string,
): Promise<string[] | undefined> {
  try {
    const { stdout } = await run('git', ['diff', '--name-only', '-z', `${base}...${head}`], { cwd });
    const paths = stdout.split('\0').filter((p) => p.length > 0);
    // An EMPTY diff is not evidence of docs-only — it means the range resolved to
    // nothing, which on a branch we just pushed is a sign the range was wrong.
    // Treat it as unprovable rather than vacuously-all-docs (`[].every()` is true).
    return paths.length > 0 ? paths : undefined;
  } catch {
    return undefined;
  }
}

/**
 * FR-6 probe: the URL of an already-open PR for `head`, or undefined.
 *
 * Every failure — `gh` absent, unauthenticated, offline, empty stdout, malformed
 * JSON, an unexpected shape — returns undefined so the caller falls through to
 * the create path and gets that path's classification. A probe must never be the
 * thing that decides the outcome; it can only save a redundant create.
 */
async function findOpenPrForHead(
  run: ExecRun,
  cwd: string,
  head: string,
  slug?: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await run(
      'gh',
      [
        'pr',
        'list',
        ...(slug ? ['--repo', slug] : []),
        '--head',
        head,
        '--state',
        'open',
        '--json',
        'url',
        '--limit',
        '1',
      ],
      { cwd },
    );
    const text = stdout.trim();
    if (!text) return undefined;
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const url = (parsed[0] as { url?: unknown }).url;
    return typeof url === 'string' && url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * FR-6 second arm: `gh pr create` lost the race and reports the PR that already
 * exists. Its message carries the URL, so this is an adoption, not a failure —
 * reporting `failed` here would be wrong twice over (the PR IS open, and the
 * developer would be sent to open a duplicate).
 *
 * Trailing punctuation is trimmed because the URL can appear mid-sentence.
 */
function urlFromAlreadyExists(message: string): string | undefined {
  if (!/already exists/i.test(message)) return undefined;
  const m = message.match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[.,;:)\]]+$/, '') : undefined;
}

/**
 * Open a pull request for an ALREADY-PUSHED branch (or adopt the open one).
 *
 * The single `gh pr create` in the codebase (FR-4). It never pushes, never
 * fetches, and never moves a checkout — the branch it names must already exist
 * on the remote, which both callers guarantee before getting here (SPEC-039
 * pushes from its throwaway worktree; SPEC-050 only runs on a successful
 * `pushed-branch`). That is what keeps constitution invariant #1 intact: the
 * network boundary was crossed by the consented push, not by this call.
 *
 * NEVER rejects (INV-5). The classification order below — ENOENT, then auth,
 * then network, then everything else — is byte-identical to SPEC-039's original
 * create-path arm, and must stay so: `push-docs-lane.test.ts` pins it and AC-10
 * forbids editing that test.
 *
 * Deliberately NOT folded in: SPEC-039's `gh auth status` PREFLIGHT. It runs far
 * earlier in that command — before the fetch, the worktree and the commit —
 * precisely so an unauthenticated CLI leaves nothing to clean up
 * (`push-docs-lane.test.ts` asserts no git mutation occurred). Moving it here
 * would run it AFTER every mutation and break that guarantee. Its classifier
 * also differs — its else-arm is `gh-unauthenticated`, where the create path's
 * else-arm is `failed`. The two must not be unified.
 * Callers that skip the preflight lose nothing: the create path still yields
 * `gh-absent` / `gh-unauthenticated` / `offline` on its own.
 */
export async function openPullRequest(req: OpenPrRequest): Promise<OpenPrResult> {
  const { run, cwd, adoptExisting = false } = req;
  try {
    if (adoptExisting) {
      const existing = await findOpenPrForHead(run, cwd, req.head, req.slug);
      if (existing) return { outcome: 'adopted', url: existing };
    }

    try {
      const { stdout } = await run('gh', buildPrCreateArgs(req), { cwd });
      return { outcome: 'created', url: stdout.trim() };
    } catch (err) {
      if (isEnoent(err)) return { outcome: 'gh-absent' };
      const msg = describeError(err);
      // Checked BEFORE the auth/network arms so an "already exists" reply can
      // never be misread as one of them — but only when the caller asked for
      // idempotency, so SPEC-039's classification is untouched (R3/AC-10).
      if (adoptExisting) {
        const adopted = urlFromAlreadyExists(msg);
        if (adopted) return { outcome: 'adopted', url: adopted };
      }
      if (isAuthError(msg)) return { outcome: 'gh-unauthenticated', error: msg };
      if (isNetworkError(msg)) return { outcome: 'offline', error: msg };
      return { outcome: 'failed', error: msg };
    }
  } catch (err) {
    // INV-5 backstop. Reached when the runner throws a NON-Error (`throw 'boom'`),
    // or synchronously before returning a promise — cases the inner catch's
    // classification would still handle, but which must not escape even if a
    // future edit moves work outside it. An approval is never lost to this.
    return { outcome: 'failed', error: describeError(err) };
  }
}
