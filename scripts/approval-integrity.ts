/**
 * `approval-integrity` — the deterministic, offline gate that stands in for
 * `ai-review` on an approval-record PR (DR-081 §4, #1376).
 *
 * WHY THIS EXISTS
 * An approval-record PR carries a generated sidecar plus a `status:` flip: no prose
 * and no logic, so `ai-review` has nothing to review and cannot honestly go green.
 * In practice those PRs merged via `--admin` (observed on #1365: created 02:47:41,
 * merged 02:47:55, with `lint`, `MinSpec SDD validation` and `ready-to-merge` all
 * failing and `ai-review` never reporting). A bypass used on every approval is
 * indistinguishable from no gate, which is the shape constitution invariant 2 names.
 *
 * This check replaces the reviewer's judgement with three mechanical facts.
 *
 * SEQUENCING — READ BEFORE MAKING THIS REQUIRED
 * DR-081 is explicit that the check must exist and run ADVISORY before the `ai-review`
 * self-exemption (§3) ships, "or approval PRs go from 'red and bypassed' to 'green and
 * unchecked', which is strictly worse". This file is step one. It is deliberately NOT
 * wired into the branch ruleset, and the §3 exemption is deliberately NOT implemented
 * here. Shipping §3 first would be a security regression.
 *
 * SCOPE BOUNDARY (DR-081 §5, load-bearing)
 * This exempts the RECORD, never the APPROVABLE. The spec/DR/epic still gets a full
 * `ai-review` verdict on its own content PR before it can be approved. DR-047's
 * substance gate — written because approvals were being rubber-stamped and an audit
 * found 7 live defects — is untouched. An implementation that weakens it is wrong even
 * if it satisfies every assertion below.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'node:url';

import { specHash } from '../packages/shared/src/canonical';
import { checkApprover, parseAgentIdentities } from '../packages/minspec/src/lib/approval';

const APPROVALS_PREFIX = '.minspec/approvals/';

/** One human-readable reason the gate refused. */
export interface Failure {
  readonly check: string;
  readonly detail: string;
}

/** Exit non-zero with every reason, so one run reports all of them (not just the first). */
function fail(failures: readonly Failure[]): never {
  process.stderr.write('\napproval-integrity: REFUSED\n\n');
  for (const f of failures) process.stderr.write(`  [${f.check}] ${f.detail}\n`);
  process.stderr.write(
    '\nThis gate gives an approval-record PR an honest green without an LLM review.\n' +
      'It is deterministic: fix the cause above and it passes. It never needs --admin.\n',
  );
  process.exit(1);
}

function pass(message: string): never {
  process.stdout.write(`approval-integrity: PASS — ${message}\n`);
  process.exit(0);
}

/**
 * Files changed between the merge base and what would land. Read from git rather than
 * a GitHub payload so the check is runnable locally and in CI with identical semantics.
 */
function changedFiles(baseRef: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    encoding: 'utf-8',
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * The permitted-approver allowlist, from committed `.minspec/config.json`.
 *
 * Why an ALLOWLIST and not the lib's `checkApprover` denylist alone: `checkApprover`
 * is correct where it runs, because `approveSpec` CAPTURES the identity from local git
 * config — the approver cannot choose it. Here the identity arrives as a field in a
 * JSON file on a pushed branch, i.e. fully attacker-controlled data. A denylist passes
 * every identity it has not heard of, so re-running it server-side would assert nothing.
 * DR-081 §4 asks that `approvedBy` be "in the permitted human-approver set"; that is an
 * allowlist, and one did not exist in this repo before this check.
 *
 * Why a COMMITTED file is a safe place for it: the file-set assertion below limits the
 * PR to the sidecar and its approvable, so `.minspec/config.json` can never be modified
 * by the same PR this gate is judging. Widening the allowlist is therefore always a
 * separate, reviewed change that gets a real `ai-review`. The two checks compose; neither
 * is sufficient alone.
 *
 * Absent or empty → refuse. Deny-by-default: an unconfigured allowlist must not mean
 * "anyone", and it must not silently pass (invariant 2).
 */
function permittedApprovers(rootDir: string): string[] {
  // Never throws. `evaluateApprovalIntegrity` is documented to return a structured
  // Failure[] rather than raise for a POLICY problem, and a missing or unreadable
  // config is a policy problem: it means no allowlist is configured, which must
  // deny-by-default through the normal path. Raising here would still fail closed via
  // the CLI's outer catch, but a library caller would get an exception instead of the
  // deny it asked for — two different behaviours for one condition.
  try {
    const raw = fs.readFileSync(path.join(rootDir, '.minspec', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { approvers?: unknown };
    if (!Array.isArray(parsed.approvers)) return [];
    return parsed.approvers
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read a path as it exists on the MERGE BASE, or null when it is not there.
 * Injected rather than called directly so the decision stays a pure function of its
 * inputs and the T0 suite can drive the base side without building git history.
 */
export type ReadBase = (relPath: string) => string | null;

/** The approvable a sidecar is the record FOR, derived from its path (never its contents). */
function approvableFor(sidecarPath: string): string {
  return sidecarPath.slice(APPROVALS_PREFIX.length).replace(/\.json$/, '');
}

/**
 * Every check that is scoped to ONE approval record. Returns [] to mean this record is
 * sound. Split out so a batch carrying several sign-offs is judged record-by-record, with
 * each failure naming the spec it belongs to.
 */
function checkOneRecord(
  rootDir: string,
  sidecarPath: string,
  changed: readonly string[],
  readBase: ReadBase,
): Failure[] {
  const derivedSpecPath = approvableFor(sidecarPath);
  const at = (d: string): string => `${derivedSpecPath}: ${d}`;

  // Shape guard on the derived path. Not exploitable from the CLI, because
  // `git diff --name-only` emits repo-normalized paths and every operation here is a read
  // — but this function is exported, and a caller feeding it a non-git-sourced list must
  // not be able to walk out of the repo.
  if (derivedSpecPath.split('/').includes('..') || path.isAbsolute(derivedSpecPath)) {
    return [{ check: 'path-shape', detail: at('derived approvable path escapes the repo') }];
  }

  let record: { specHash?: unknown; approvedBy?: unknown; specPath?: unknown };
  try {
    record = JSON.parse(fs.readFileSync(path.join(rootDir, sidecarPath), 'utf-8'));
  } catch (err) {
    return [{ check: 'record-readable', detail: at(`${sidecarPath} is not readable JSON: ${String(err)}`) }];
  }

  const failures: Failure[] = [];

  // The record's self-declared path must agree with where it is filed.
  if (typeof record.specPath === 'string' && record.specPath !== derivedSpecPath) {
    failures.push({
      check: 'path-agreement',
      detail: at(`record says specPath="${record.specPath}" but it is filed as the record for "${derivedSpecPath}"`),
    });
  }

  // The hash binds the record to the content AT THIS COMMIT.
  const approvableAbs = path.join(rootDir, derivedSpecPath);
  if (!fs.existsSync(approvableAbs)) {
    failures.push({ check: 'hash-binding', detail: at('the approvable does not exist at this commit') });
  } else if (typeof record.specHash !== 'string') {
    failures.push({ check: 'hash-binding', detail: at('record has no string specHash') });
  } else {
    const computed = specHash(fs.readFileSync(approvableAbs, 'utf-8'));
    if (computed !== record.specHash) {
      failures.push({
        check: 'hash-binding',
        detail: at(`record specHash=${record.specHash} but the file canonicalizes to ${computed} here — the approval was given to different bytes than the ones landing`),
      });
    }
  }

  // THE SCOPE BOUNDARY, ENFORCED (DR-081 §5). Everything above is self-referential: the
  // record and the approvable both arrive in the same PR, so a matching hash proves only
  // that the pusher was consistent with themselves, not that the content was reviewed.
  // The approvable's CANONICAL hash must be identical on the merge base and at head —
  // a status:/phases: flip is stripped by canonicalization and passes; a substantive edit
  // does not. An approvable absent from the base has no reviewed version to attest to.
  if (changed.includes(derivedSpecPath)) {
    const baseContent = readBase(derivedSpecPath);
    if (baseContent === null) {
      failures.push({
        check: 'approvable-unreviewed',
        detail: at('does not exist on the merge base, so this PR both introduces the approvable and approves it (DR-081 §5)'),
      });
    } else if (fs.existsSync(approvableAbs)) {
      const baseHash = specHash(baseContent);
      const headHash = specHash(fs.readFileSync(approvableAbs, 'utf-8'));
      if (baseHash !== headHash) {
        failures.push({
          check: 'approvable-unreviewed',
          detail: at(`canonicalizes to ${baseHash} on the merge base but ${headHash} here — an approval PR may flip status:/phases: (hash-neutral) and nothing else (DR-081 §5)`),
        });
      }
    }
  }

  // The approver is a permitted human, re-checked here because a local
  // `assertHumanApprover` proves nothing about a pushed branch (DR-081 §4). Per-record,
  // because `approvedBy` is per-record: a batch does not get to inherit one identity.
  const approvedBy = typeof record.approvedBy === 'string' ? record.approvedBy : '';
  const allowlist = permittedApprovers(rootDir);
  if (allowlist.length === 0) {
    failures.push({
      check: 'approver-allowlist',
      detail: at('no permitted-approver allowlist is configured. Add `"approvers": ["you@example.com"]` to .minspec/config.json. Refusing rather than defaulting to "anyone"'),
    });
  } else if (!allowlist.includes(approvedBy.trim().toLowerCase())) {
    failures.push({
      check: 'approver-allowlist',
      detail: at(`approvedBy="${approvedBy}" is not in the permitted-approver allowlist`),
    });
  }

  // The agent denylist still applies on top, so an identity that is somehow both
  // allowlisted and a known agent identity is still refused (DR-056).
  const agentCheck = checkApprover(approvedBy, parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES));
  if (!agentCheck.ok) failures.push({ check: 'approver-not-agent', detail: at(agentCheck.reason) });

  return failures;
}

/**
 * The whole decision, as a pure input-to-output mapping over (repo root, changed files).
 * Exported so the security-critical logic is exhaustively unit-testable without spawning a
 * process or building a git history — the discipline `checkApprover` already follows.
 *
 * Returns [] to mean PASS. Never throws for a POLICY failure; a thrown error means the
 * check itself broke, and the CLI shell turns that into a refusal (invariant 2).
 */
export function evaluateApprovalIntegrity(
  rootDir: string,
  changed: readonly string[],
  readBase: ReadBase,
): Failure[] {
  if (changed.length === 0) return [];

  const sidecars = changed.filter((f) => f.startsWith(APPROVALS_PREFIX) && f.endsWith('.json'));

  // Not an approval-record PR. This gate is scoped to one PR shape and says nothing about
  // any other — `ai-review` judges those. Passing here is correct, and is what makes the
  // check safe to mark REQUIRED on every PR later.
  if (sidecars.length === 0) return [];

  // A BATCH IS LEGITIMATE. An earlier cut refused any PR carrying more than one record,
  // reasoning that several human acts in one exempt PR could not be attributed per record.
  // That reasoning was wrong, and real data disproved it: the founder's own flow signs off
  // several specs in one sitting and lands them atomically (f38c83ec carried SPEC-066,
  // SPEC-067 and SPEC-070, six files, every record independently valid). Attribution is
  // per-record by construction — each sidecar carries its own `approvedBy`, `approvedAt`
  // and `specHash` — so the rule blocked a correct workflow while protecting nothing.
  //
  // The property that actually matters survives unchanged, and is enforced below: every
  // changed file belongs to some (sidecar, approvable) pair, and EVERY record passes every
  // check on its own. One bad record fails the batch.
  const allowed = new Set<string>();
  for (const sidecarPath of sidecars) {
    allowed.add(sidecarPath);
    allowed.add(approvableFor(sidecarPath));
  }

  const failures: Failure[] = [];

  const strays = changed.filter((f) => !allowed.has(f));
  if (strays.length > 0) {
    failures.push({
      check: 'file-set',
      detail:
        `an approval-record PR may change only approval sidecars and the approvables they point at. ` +
        `Also changed: ${strays.join(', ')}`,
    });
  }

  for (const sidecarPath of sidecars) {
    failures.push(...checkOneRecord(rootDir, sidecarPath, changed, readBase));
  }

  return failures;
}

function main(): void {
  const baseRef = process.argv[2] ?? 'origin/main';
  const rootDir = process.cwd();

  const changed = changedFiles(baseRef);
  const readBase: ReadBase = (relPath) => {
    try {
      return execFileSync('git', ['show', `${baseRef}:${relPath}`], { encoding: 'utf-8' });
    } catch {
      return null; // absent on the base
    }
  };
  const failures = evaluateApprovalIntegrity(rootDir, changed, readBase);

  if (failures.length > 0) fail(failures);
  if (changed.length === 0) pass('no files changed against the base');
  if (!changed.some((f) => f.startsWith(APPROVALS_PREFIX) && f.endsWith('.json'))) {
    pass('not an approval-record PR (no approval sidecar changed)');
  }
  pass("the approval record is bound to this commit's content, approved by a permitted human, and the PR changes nothing else");
}

// Only run when invoked as a script. Importing this module (the T0 suite imports
// `evaluateApprovalIntegrity` directly) must not execute the CLI or call process.exit.
//
// A broken guard here would silently turn the gate into a no-op that exits 0, which is
// the fail-open this whole file exists to prevent — so the guard is not trusted on its
// own: the suite's git-wiring test runs the real CLI and asserts it still exits 1.
//
// Deliberately NOT wrapped in try/catch. A swallow here would return `false`, `main()`
// would never run, and the process would exit 0 — the gate silently passing, which is
// the fail-open DR-066 clause 1 exists to forbid and the exact failure this whole file
// is built to prevent. If the entrypoint cannot be determined that is an infrastructure
// failure: let it throw, so the CLI exits non-zero and a test shows a visible error.
//
// (`scripts/check-swallowed-gate-signal.ts` would have flagged this, but it scans
// `path.endsWith('.sh')` only, so no TypeScript is covered — see the follow-up issue.)
const invokedDirectly = (() => {
  const entry = process.argv[1];
  return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  // Fail closed: any unexpected throw is a REFUSAL, never a silent pass (invariant 2).
  try {
    main();
  } catch (err) {
    process.stderr.write(`\napproval-integrity: REFUSED — the check itself errored: ${String(err)}\n`);
    process.stderr.write('A witness that cannot run is not a witness that passed.\n');
    process.exit(1);
  }
}
