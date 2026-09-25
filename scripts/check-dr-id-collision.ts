#!/usr/bin/env -S npx tsx
/**
 * check-dr-id-collision.ts — the network half of the DR-id uniqueness gate (#1226).
 *
 * A duplicate `DR-NNN` must be impossible to MERGE, not merely impossible to keep.
 * The local validator rule (`checkDeclaredDrIds`, wired into
 * scripts/validate-frontmatter.ts) catches a duplicate that is already in one tree;
 * it cannot see work in flight. This does — and it is the only place that looks at
 * the network, because MinSpec itself is offline and Tier-0 (constitution invariant
 * 1, DR-004). Nothing under `packages/` imports this or the module it decides with.
 *
 *   npx tsx scripts/check-dr-id-collision.ts --repo OWNER/NAME --pr 1209 --base main
 *
 * Exit 0 = every DR id this PR adds is free AND no decision record it edits has had
 * its identity swapped. Exit 1 = either defect, OR the check could not establish that
 * there wasn't one.
 *
 * ── Two failure shapes, not one (#1757) ──────────────────────────────────────
 * The id half asks "is this number already taken?". It keys on the paths a PR
 * INTRODUCES, because a claim on a number is what it was built to catch.
 *
 * That left in-place REPURPOSING invisible: PR #1756 wrote a different decision over
 * an existing `DR-088.md` while the original was merged and in force, and every gate
 * passed it. A `modified` file claims nothing, so it was filtered out before any
 * content was read. The consequences differ — a claim collision makes a DUPLICATE,
 * which is noisy and recoverable; repurposing makes a DELETION, which is silent and
 * recoverable only from history — so the second half compares the identity-bearing
 * frontmatter of every modified decision record across base and head.
 *
 * ── FAIL CLOSED (DR-066, constitution invariant 2) ───────────────────────────
 * Every failure path here is a RED, never a green:
 *   • `gh` absent, unauthenticated, rate-limited, or erroring       → exit 1
 *   • output that is not the JSON shape this reads                  → exit 1
 *   • a base listing that came back EMPTY while the local checkout  → exit 1
 *     holds decision files this PR does not add (the "witness
 *     returned nothing because it could not look" case — a second,
 *     independent witness, per DR-066 clause 3)
 * There is deliberately no branch that exits 0 without a comparison having been
 * made. A gate that is "green because it didn't run" is the #811 always-green bug.
 *
 * ── Why it runs on EVERY pull request ────────────────────────────────────────
 * A `paths:` filter on the workflow would leave the check unreported on any PR
 * touching no decision — and an unreported required check is unsatisfiable, which
 * is the #560 silent-gate class this repo has already been bitten by. So the
 * workflow is unfiltered and a PR that adds no DR passes here in one API call.
 *
 * All decision logic lives in the pure, unit-tested `lib/dr-id-collision.ts`. This
 * file is IO only: read `gh`, hand the shapes over, print, set the exit code.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  claimedPathsFromPrFiles,
  decideDrIdCollision,
  decideDrRepurposing,
  DR_IDENTITY_ACK_LABEL,
  drNumberFromPath,
  formatDrId,
  modifiedDecisionPaths,
  type DrIdCollisionInput,
  type DrRevision,
  type PrClaims,
  type PrFileEntry,
} from './lib/dr-id-collision';

const ROOT = process.cwd();

/** Anything that means "this check could not do its job" — always a red. */
class GateError extends Error {}

// ─── Args ────────────────────────────────────────────────────────────────────

interface Args {
  repo: string;
  pr: number;
  base: string;
}

function parseArgs(argv: string[]): Args {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new GateError(`unexpected argument: ${key}`);
    const value = argv[i + 1];
    if (value === undefined) throw new GateError(`--${key.slice(2)} needs a value`);
    raw[key.slice(2)] = value;
  }
  const missing = ['repo', 'pr', 'base'].filter((k) => !raw[k]?.trim());
  if (missing.length > 0) {
    throw new GateError(
      `missing required argument(s): ${missing.map((m) => `--${m}`).join(', ')}. ` +
        'Usage: check-dr-id-collision.ts --repo OWNER/NAME --pr N --base main',
    );
  }
  const pr = Number.parseInt(raw.pr, 10);
  if (!Number.isFinite(pr) || pr <= 0) throw new GateError(`--pr must be a positive number, got "${raw.pr}"`);
  return { repo: raw.repo.trim(), pr, base: raw.base.trim() };
}

// ─── gh ──────────────────────────────────────────────────────────────────────

interface GhResult {
  stdout: string;
  /** stderr, kept so a 404 can be told apart from a real failure. */
  stderr: string;
  failed: boolean;
}

/**
 * The `gh` binary to run. `DR_ID_GH_BIN` is a TEST SEAM — it lets the unit tests
 * point at a deterministic stub (and at a path that does not exist, to prove the
 * ENOENT path fails closed) without PATH surgery, so no test ever reaches the real
 * GitHub API. It adds no attack surface: this script already resolves `gh` through
 * PATH, which is equally settable, and CI never sets it.
 */
const GH_BIN = process.env.DR_ID_GH_BIN?.trim() || 'gh';

/** Run `gh`. Never throws for a non-zero exit — the caller decides what it means. */
function gh(args: string[]): GhResult {
  try {
    const stdout = execFileSync(GH_BIN, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr: '', failed: false };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: string; message?: string };
    // ENOENT (gh not installed) has no stderr of its own — surface the cause.
    const stderr = err.stderr || err.message || String(e);
    return { stdout: err.stdout ?? '', stderr, failed: true };
  }
}

/** Run `gh` and fail the gate on any non-zero exit. */
function ghOrFail(args: string[], what: string): string {
  const r = gh(args);
  if (r.failed) {
    throw new GateError(
      `could not ${what} — \`${GH_BIN} ${args.join(' ')}\` failed:\n${r.stderr.trim()}`,
    );
  }
  return r.stdout;
}

/**
 * Parse `gh api --paginate --slurp` output. That flag returns an array whose
 * elements are the per-page responses, so an array endpoint arrives as an array of
 * arrays; a caller that did not paginate sends a flat array. Both are accepted and
 * flattened. Anything else is a shape this does not understand — a red, not a
 * best-effort empty list.
 */
function parseJsonRows(text: string, what: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GateError(
      `could not parse the ${what} response as JSON. First 200 chars:\n${text.slice(0, 200)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new GateError(`the ${what} response was not a JSON array (got ${typeof parsed}).`);
  }
  const rows: Record<string, unknown>[] = [];
  for (const element of parsed) {
    if (Array.isArray(element)) {
      for (const row of element) {
        if (row && typeof row === 'object') rows.push(row as Record<string, unknown>);
        else throw new GateError(`the ${what} response contained a non-object row.`);
      }
    } else if (element && typeof element === 'object') {
      rows.push(element as Record<string, unknown>);
    } else {
      throw new GateError(`the ${what} response contained a non-object row.`);
    }
  }
  return rows;
}

// ─── Repo reads ──────────────────────────────────────────────────────────────

/** Decisions dir, repo-relative, from `.minspec/config.json` (default `docs/decisions`). */
function resolveDecisionsDirRel(): string {
  const configPath = join(ROOT, '.minspec', 'config.json');
  try {
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { decisionsDir?: string };
      if (typeof cfg.decisionsDir === 'string' && cfg.decisionsDir.trim()) {
        return cfg.decisionsDir.trim().replace(/^\.\//, '').replace(/\/+$/, '');
      }
    }
  } catch {
    // Malformed config — fall back to the default rather than guessing.
  }
  return 'docs/decisions';
}

/** Every file a pull request touches, with its status. One API call. */
function prFileEntries(repo: string, pr: number): PrFileEntry[] {
  const out = ghOrFail(
    ['api', `repos/${repo}/pulls/${pr}/files`, '--paginate', '--slurp'],
    `list the files changed by PR #${pr}`,
  );
  return parseJsonRows(out, `PR #${pr} file list`).map((r) => ({
    filename: String(r.filename ?? ''),
    status: String(r.status ?? ''),
    ...(typeof r.previous_filename === 'string' ? { previous_filename: r.previous_filename } : {}),
  }));
}

/** The decision paths a pull request ADDS (added / renamed / copied), repo-relative. */
function prClaims(repo: string, pr: number, decisionsDir: string): PrClaims {
  return { pr, paths: claimedPathsFromPrFiles(prFileEntries(repo, pr), decisionsDir) };
}

/**
 * The PR's labels, for the `dr-identity-change` acknowledgement (#1982).
 *
 * Read ONLY when a decision record was actually modified, so a PR that touches no DR
 * still costs exactly the calls it did before. An unreadable label list is a red rather
 * than an assumed-absent one: reading "cannot tell" as "not acknowledged" would block a
 * legitimately-labelled PR with a message telling the author to add a label they already
 * added, which is the most confusing failure this could have.
 */
function prLabels(repo: string, pr: number): string[] {
  const out = ghOrFail(
    ['api', `repos/${repo}/pulls/${pr}`, '--jq', '[.labels[].name] | join("\n")'],
    `read the labels of PR #${pr}`,
  );
  return out.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/** The PR head commit, so the repurposing half reads what the PR PROPOSES. */
function prHeadSha(repo: string, pr: number): string {
  const sha = ghOrFail(
    ['api', `repos/${repo}/pulls/${pr}`, '--jq', '.head.sha'],
    `read the head commit of PR #${pr}`,
  ).trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new GateError(`the head commit of PR #${pr} did not look like a sha (got "${sha.slice(0, 40)}").`);
  }
  return sha;
}

/**
 * One file's full text at a ref.
 *
 * Fails closed on an unreadable or empty body rather than treating it as "no
 * frontmatter, therefore nothing to protect". GitHub's contents API returns an EMPTY
 * `content` for a file it declines to inline (over 1 MB, `encoding: "none"`), which
 * is indistinguishable from a genuinely empty record — and reading either as "this
 * DR declares no identity" would turn the check green over exactly the state it
 * exists to reject (DR-066).
 */
function fileAtRef(repo: string, filePath: string, ref: string, what: string): string {
  const endpoint = `repos/${repo}/contents/${encodeURI(filePath)}?ref=${encodeURIComponent(ref)}`;
  const raw = ghOrFail(['api', endpoint, '--jq', '.content'], `read ${filePath} at ${what}`).trim();
  if (raw.length === 0 || raw === 'null') {
    throw new GateError(
      `${filePath} at ${what} came back with no readable content. The decisions API ` +
        'returns an empty body for a file it will not inline, which is indistinguishable ' +
        'from an empty record — failing closed rather than reading it as "declares nothing".',
    );
  }
  return Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf-8');
}

/**
 * Base-and-head pairs for every decision record this PR modifies IN PLACE.
 *
 * Costs two content reads per modified decision file and nothing at all on a PR that
 * modifies none — which is almost every PR, so the common path is unchanged.
 */
function modifiedDrRevisions(
  repo: string,
  pr: number,
  base: string,
  entries: PrFileEntry[],
  decisionsDir: string,
): DrRevision[] {
  const paths = modifiedDecisionPaths(entries, decisionsDir);
  if (paths.length === 0) return [];
  const head = prHeadSha(repo, pr);
  return paths.map((file) => ({
    file,
    base: fileAtRef(repo, file, base, base),
    head: fileAtRef(repo, file, head, `PR #${pr} head`),
  }));
}

/**
 * Every decision file on the base branch's CURRENT tip.
 *
 * The tip, not the merge base, on purpose: the failure being closed is that a
 * blocked PR's number DECAYS as other DRs land, and a merge-base comparison calls
 * that "fine" right up until the merge overwrites an accepted record.
 *
 * A 404 means the directory does not exist on base — legitimate for the PR that
 * creates the register. `assertBaseListingPlausible` is the second witness that
 * keeps that from becoming a fail-open hole.
 */
function basePaths(repo: string, base: string, decisionsDir: string): string[] {
  const endpoint = `repos/${repo}/contents/${decisionsDir}?ref=${encodeURIComponent(base)}`;
  const r = gh(['api', endpoint, '--paginate', '--slurp']);
  if (r.failed) {
    if (/HTTP 404|Not Found/i.test(r.stderr)) return [];
    throw new GateError(
      `could not list ${decisionsDir} on ${base} — \`${GH_BIN} api ${endpoint}\` failed:\n${r.stderr.trim()}`,
    );
  }
  return parseJsonRows(r.stdout, `${decisionsDir}@${base} listing`)
    .filter((row) => row.type === 'file')
    .map((row) => String(row.path ?? ''))
    .filter((p) => p.length > 0);
}

/** Every open pull request number in the repo. */
function openPrNumbers(repo: string): number[] {
  const out = ghOrFail(
    ['pr', 'list', '--repo', repo, '--state', 'open', '--json', 'number', '--limit', '500'],
    'list the open pull requests',
  );
  return parseJsonRows(out, 'open-PR list')
    .map((row) => Number(row.number))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Canonical DR ids present in the LOCAL checkout's decisions dir. */
function localDrIds(decisionsDir: string): string[] {
  const dir = join(ROOT, decisionsDir);
  if (!existsSync(dir)) return [];
  const ids = new Set<string>();
  for (const entry of readdirSync(dir)) {
    const num = drNumberFromPath(entry);
    if (num !== undefined) ids.add(formatDrId(num));
  }
  return [...ids].sort();
}

/**
 * Second witness (DR-066 clause 3 — no single disableable producer).
 *
 * If the base listing came back EMPTY while this checkout holds decision files the
 * PR does not add, the two witnesses contradict each other: those files came from
 * somewhere, and the only somewhere is the base branch. An empty listing is then
 * evidence the API could not look — a permission gap, a renamed directory, a
 * misconfigured `decisionsDir` — not evidence that the register is empty. Reading
 * it as "no ids are taken" would turn this gate green over the exact state it
 * exists to reject, so it is a red.
 */
function assertBaseListingPlausible(
  base: string,
  decisionsDir: string,
  found: string[],
  subject: PrClaims,
): void {
  if (found.length > 0) return;
  const claimed = new Set(
    subject.paths
      .map((p) => drNumberFromPath(p))
      .filter((n): n is number => n !== undefined)
      .map(formatDrId),
  );
  const unexplained = localDrIds(decisionsDir).filter((id) => !claimed.has(id));
  if (unexplained.length === 0) return;
  throw new GateError(
    `the ${decisionsDir} listing for ${base} came back EMPTY, but this checkout holds ` +
      `${unexplained.length} decision file(s) that PR #${subject.pr} does not add ` +
      `(${unexplained.slice(0, 5).join(', ')}${unexplained.length > 5 ? ', …' : ''}). ` +
      'Those records exist on the base branch, so the empty listing means the check could ' +
      'not look — a permission gap, a moved decisions directory, or a wrong --base. ' +
      'Failing closed rather than reporting every id as free (DR-066).',
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const decisionsDir = resolveDecisionsDirRel();

  // One file listing for the subject, read by BOTH halves: the paths it claims and
  // the records it edits in place are two views of the same payload.
  const entries = prFileEntries(args.repo, args.pr);
  const subject: PrClaims = { pr: args.pr, paths: claimedPathsFromPrFiles(entries, decisionsDir) };
  const base = basePaths(args.repo, args.base, decisionsDir);
  assertBaseListingPlausible(args.base, decisionsDir, base, subject);

  const others = openPrNumbers(args.repo)
    .filter((n) => n !== args.pr)
    .map((n) => prClaims(args.repo, n, decisionsDir));

  const input: DrIdCollisionInput = {
    decisionsDir,
    baseRef: args.base,
    basePaths: base,
    subject,
    otherPrs: others,
  };
  const verdict = decideDrIdCollision(input);

  // Both halves always run and both always report. Returning early on the first
  // failure would hide the second defect until the first was fixed and the run
  // repeated — the drip-feed that makes a gate feel like an obstacle course.
  const revisions = modifiedDrRevisions(args.repo, args.pr, args.base, entries, decisionsDir);
  const repurposing = decideDrRepurposing(revisions, {
    // Only ask for labels when a decision record actually changed.
    labels: revisions.length > 0 ? prLabels(args.repo, args.pr) : [],
  });

  if (verdict.ok) {
    console.log(verdict.message);
  } else {
    console.error(verdict.message);
    if (process.env.GITHUB_ACTIONS) {
      const ids = verdict.findings.map((f) => f.id).join(', ');
      console.error(
        `::error title=DR id collision::${ids} already claimed — renumber to ${verdict.nextFreeId}`,
      );
    }
  }

  if (repurposing.ok) {
    console.log(repurposing.message);
    if (repurposing.acknowledgedBy && process.env.GITHUB_ACTIONS) {
      // A notice, not an error: the run is green, but the act belongs in the log summary
      // where a reviewer scanning annotations will see it without opening the step.
      const files = [...new Set(repurposing.findings.map((f) => f.file))].join(', ');
      console.error(
        `::notice title=DR identity change acknowledged::${files} — passed by the ` +
          `\`${repurposing.acknowledgedBy}\` label, not by being unchanged`,
      );
    }
  } else {
    console.error(repurposing.message);
    if (process.env.GITHUB_ACTIONS) {
      const files = [...new Set(repurposing.findings.map((f) => f.file))].join(', ');
      console.error(
        `::error title=DR repurposing::${files} rewrites an in-force decision record — ` +
          `give the new decision its own id, or label the PR \`${DR_IDENTITY_ACK_LABEL}\``,
      );
    }
  }

  if (!verdict.ok || !repurposing.ok) process.exitCode = 1;
}

try {
  main();
} catch (e) {
  const why = e instanceof GateError ? e.message : `unexpected error: ${(e as Error).message}`;
  console.error(`DR id collision check FAILED CLOSED — ${why}`);
  if (process.env.GITHUB_ACTIONS) {
    console.error('::error title=DR id check could not run::failing closed (DR-066) — see the log');
  }
  process.exit(1);
}
