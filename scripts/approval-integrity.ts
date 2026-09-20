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

  // Exactly one sidecar. Two approvals in one PR means one `ai-review`-exempt PR carrying
  // two distinct human acts, which cannot be attributed per record.
  if (sidecars.length > 1) {
    return [
      {
        check: 'one-record',
        detail: `a PR may carry exactly one approval record; this one changes ${sidecars.length}: ${sidecars.join(', ')}`,
      },
    ];
  }

  const failures: Failure[] = [];
  const sidecarPath = sidecars[0];

  // The sidecar's LOCATION encodes which approvable it is for. Deriving the approvable
  // from the path rather than trusting the record's own `specPath` is what stops a record
  // being filed under one approvable while claiming another.
  const derivedSpecPath = sidecarPath.slice(APPROVALS_PREFIX.length).replace(/\.json$/, '');

  // Shape guard on the derived path. Not exploitable from the CLI, because
  // `git diff --name-only` emits repo-normalized paths with no `..` segments and every
  // operation here is a read — but this function is exported, and a future caller that
  // feeds it a non-git-sourced list should not be able to walk out of the repo.
  if (derivedSpecPath.split('/').includes('..') || path.isAbsolute(derivedSpecPath)) {
    return [
      {
        check: 'path-shape',
        detail: `refusing a sidecar whose derived approvable path escapes the repo: "${derivedSpecPath}"`,
      },
    ];
  }

  let record: { specHash?: unknown; approvedBy?: unknown; specPath?: unknown };
  try {
    record = JSON.parse(fs.readFileSync(path.join(rootDir, sidecarPath), 'utf-8'));
  } catch (err) {
    return [{ check: 'record-readable', detail: `${sidecarPath} is not readable JSON: ${String(err)}` }];
  }

  // 1. The file set is exactly the approval pair — nothing rides along inside a PR that is
  //    exempt from review. The sidecar is required; the approvable is optional because the
  //    `status:` mirror flip is hash-neutral and may land separately.
  const allowed = new Set([sidecarPath, derivedSpecPath]);
  const strays = changed.filter((f) => !allowed.has(f));
  if (strays.length > 0) {
    failures.push({
      check: 'file-set',
      detail:
        `an approval-record PR may change only the sidecar and the approvable it points at ` +
        `(${sidecarPath}, ${derivedSpecPath}). Also changed: ${strays.join(', ')}`,
    });
  }

  // 2. The record's self-declared path must agree with where it is filed.
  if (typeof record.specPath === 'string' && record.specPath !== derivedSpecPath) {
    failures.push({
      check: 'path-agreement',
      detail: `record says specPath="${record.specPath}" but it is filed at ${sidecarPath}, which is the record for "${derivedSpecPath}"`,
    });
  }

  // 3. The hash binds the record to the content AT THIS COMMIT. CI checks out the merge
  //    ref, so the working tree is what would land — which is the thing that must be
  //    approved, not whatever the branch looked like when the record was minted.
  const approvableAbs = path.join(rootDir, derivedSpecPath);
  if (!fs.existsSync(approvableAbs)) {
    failures.push({
      check: 'hash-binding',
      detail: `the approvable ${derivedSpecPath} does not exist at this commit, so the record points at content that is not here`,
    });
  } else if (typeof record.specHash !== 'string') {
    failures.push({ check: 'hash-binding', detail: 'record has no string specHash' });
  } else {
    const computed = specHash(fs.readFileSync(approvableAbs, 'utf-8'));
    if (computed !== record.specHash) {
      failures.push({
        check: 'hash-binding',
        detail:
          `record specHash=${record.specHash} but ${derivedSpecPath} canonicalizes to ${computed} at this commit. ` +
          `The approval was given to different bytes than the ones landing.`,
      });
    }
  }

  // 3b. THE SCOPE BOUNDARY, ENFORCED (DR-081 §5). Everything above is self-referential:
  //     the record and the approvable both arrive in the same PR, so "the hash matches"
  //     only proves the pusher was consistent with themselves. It does NOT prove the
  //     content was ever reviewed.
  //
  //     The attack it leaves open, which a panel reviewer caught on this PR before it
  //     merged: rewrite a spec's body to anything you like, mint a sidecar whose
  //     specHash matches the NEW bytes, and every check above passes. Once §3's
  //     `ai-review` exemption ships, that content merges unreviewed — which is exactly
  //     the boundary DR-081 §5 calls load-bearing, previously asserted only in prose.
  //
  //     The rule that closes it: the approvable's CANONICAL hash must be identical on
  //     the merge base and at head. A `status:`/`phases:` mirror flip is stripped by
  //     canonicalization, so the legitimate approve flow still passes; any substantive
  //     edit changes the hash and is refused. A brand-new approvable has no reviewed
  //     base version at all, so approving it in the same PR is refused too.
  if (changed.includes(derivedSpecPath)) {
    const baseContent = readBase(derivedSpecPath);
    if (baseContent === null) {
      failures.push({
        check: 'approvable-unreviewed',
        detail:
          `${derivedSpecPath} does not exist on the merge base, so this PR both introduces the ` +
          `approvable and approves it. The content must land and be reviewed on its own PR first (DR-081 §5).`,
      });
    } else if (fs.existsSync(path.join(rootDir, derivedSpecPath))) {
      const baseHash = specHash(baseContent);
      const headHash = specHash(fs.readFileSync(path.join(rootDir, derivedSpecPath), 'utf-8'));
      if (baseHash !== headHash) {
        failures.push({
          check: 'approvable-unreviewed',
          detail:
            `${derivedSpecPath} canonicalizes to ${baseHash} on the merge base but ${headHash} here, so this PR ` +
            `changes the approvable's substance, not just its approval record. An approval PR may flip ` +
            `status:/phases: (hash-neutral) and nothing else — the content itself is reviewed on its own PR (DR-081 §5).`,
        });
      }
    }
  }

  // 4. The approver is a permitted human, re-checked here because a local
  //    `assertHumanApprover` proves nothing about a pushed branch (DR-081 section 4).
  const approvedBy = typeof record.approvedBy === 'string' ? record.approvedBy : '';
  const allowlist = permittedApprovers(rootDir);
  if (allowlist.length === 0) {
    failures.push({
      check: 'approver-allowlist',
      detail:
        'no permitted-approver allowlist is configured. Add `"approvers": ["you@example.com"]` to ' +
        '.minspec/config.json. Refusing rather than defaulting to "anyone" — an unconfigured ' +
        'allowlist must not mean an open one.',
    });
  } else if (!allowlist.includes(approvedBy.trim().toLowerCase())) {
    failures.push({
      check: 'approver-allowlist',
      detail: `approvedBy="${approvedBy}" is not in the permitted-approver allowlist in .minspec/config.json`,
    });
  }

  // 5. The agent denylist still applies on top, so an identity that is somehow both
  //    allowlisted and a known agent identity is still refused. The two lists answer
  //    different questions ("is this a permitted person?" / "is this an automation
  //    identity?"), and an allowlist edit must not be able to re-open DR-056's
  //    agent-self-approval hole.
  const agentCheck = checkApprover(approvedBy, parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES));
  if (!agentCheck.ok) failures.push({ check: 'approver-not-agent', detail: agentCheck.reason });

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
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1];
    return Boolean(entry) && path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
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
