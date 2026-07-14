/**
 * Direct (non-PR) push audit for `main` (#688 harden).
 *
 * #575/DR-051 wired the docs-push exemption by setting the `main` ruleset's
 * Admin `bypass_mode` to `always` so approvable content (specs/DRs/epics/
 * approvals) can be pushed straight to `main` outside a PR. Rulesets are
 * REF-scoped, not PATH-scoped — the bypass grants an admin the ability to
 * direct-push ANYTHING to `main`, skipping all 5 required checks (lint, test,
 * MinSpec SDD validation, ai-review, ready-to-merge). The docs-only scope is
 * a convention enforced by nothing but actor trust.
 *
 * This module is the PURE decision core of the missing backstop: given the
 * commits a `push` event landed on `main` (each with its associated pull
 * requests and changed files, already fetched/parsed by the caller), it
 * classifies each commit as direct-vs-PR-merge and flags any DIRECT commit
 * that touches a file outside the docs-only allowlist. All I/O (`gh api`,
 * `git diff-tree`, filing/commenting the alert issue) lives in the CLI
 * wrapper (`scripts/direct-push-audit.ts`); this file takes only already-
 * parsed inputs so the decision logic is unit-testable without a network call
 * or a real repo — same split as `ruleset-integration-audit.ts` (#560).
 *
 * This is an ADVISORY backstop, not a gate: the audited push has already
 * landed on `main` by the time this runs, so a violation can only be flagged
 * loudly (an issue), never blocked.
 */

/**
 * The docs-only corpus a direct push is allowed to touch, per this issue's
 * scope. Deliberately a superset of DR-051's "approvable corpus"
 * (`specs/**`, `docs/decisions/**`, `docs/epics/**`, `docs/domain/**`) — it
 * also allows `.minspec/approvals/**` (approval records) and top-level
 * `*.md` (e.g. README.md, CLAUDE.md), which legitimately land the same way.
 */
export const DIRECT_PUSH_ALLOWED_PREFIXES: readonly string[] = [
  'specs/',
  'docs/decisions/',
  'docs/domain/',
  'docs/epics/',
  '.minspec/approvals/',
];

/**
 * Is `path` inside the docs-only allowlist a direct push may touch?
 * Matches any of `DIRECT_PUSH_ALLOWED_PREFIXES`, or a top-level `*.md` file
 * (no `/` in the path, i.e. not nested under a subdirectory).
 */
export function isAllowedDirectPushPath(path: string): boolean {
  if (DIRECT_PUSH_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return !path.includes('/') && path.endsWith('.md');
}

/** Of `files`, which are OUTSIDE the docs-only allowlist? Sorted for a stable report. */
export function classifyOffendingFiles(files: readonly string[]): string[] {
  return files.filter((f) => !isAllowedDirectPushPath(f)).sort();
}

/**
 * A single pull request as GitHub's `commits/{sha}/pulls` API returns it —
 * only the fields this module cares about.
 */
export interface AssociatedPull {
  number?: number;
  merged_at?: string | null;
}

/**
 * Is this commit a DIRECT push (no associated MERGED pull request)?
 * `pulls` is the parsed `commits/{sha}/pulls` response body. Tolerant of
 * malformed/unexpected shapes — same defensive-parsing convention as
 * `extractRequiredCheckPins` (#560): a response that isn't the expected
 * array is treated as "cannot classify as direct" (`false`) rather than
 * flagged, so an API/tooling glitch degrades into silence, not a false
 * alarm (this audit is advisory-only; false positives are the costlier
 * failure mode here — see the workflow's fail-open requirement).
 */
export function isDirectPush(pulls: unknown): boolean {
  if (!Array.isArray(pulls)) return false;
  const hasMergedPull = pulls.some(
    (p) => typeof p === 'object' && p !== null && typeof (p as AssociatedPull).merged_at === 'string',
  );
  return !hasMergedPull;
}

/** One commit landed on `main` by a push event, with its pulls + changed files already fetched. */
export interface PushedCommitInput {
  sha: string;
  author?: string;
  /** Parsed `commits/{sha}/pulls` response body — see `isDirectPush`. */
  pulls: unknown;
  /** Files this commit changed, repo-relative, no leading `./` or `/`. */
  files: readonly string[];
}

export interface DirectPushFinding {
  sha: string;
  author?: string;
  direct: boolean;
  offendingFiles: string[];
  violation: boolean;
}

/**
 * The audit core: classify each pushed commit and flag any DIRECT commit
 * that touches a file outside the docs-only allowlist. PR-merge commits are
 * always exempt (already reviewed) regardless of what they touch. Pure — no
 * network, no `gh`, no `git`. Order of `commits` is preserved in the output.
 */
export function auditPushedCommits(commits: readonly PushedCommitInput[]): DirectPushFinding[] {
  return commits.map((commit) => {
    const direct = isDirectPush(commit.pulls);
    const offendingFiles = direct ? classifyOffendingFiles(commit.files) : [];
    return {
      sha: commit.sha,
      author: commit.author,
      direct,
      offendingFiles,
      violation: direct && offendingFiles.length > 0,
    };
  });
}

/** Do any findings carry a violation — a direct push that touched non-docs paths? */
export function hasDirectPushViolation(findings: readonly DirectPushFinding[]): boolean {
  return findings.some((f) => f.violation);
}
