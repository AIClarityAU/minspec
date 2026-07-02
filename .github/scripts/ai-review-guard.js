// ai-review-guard — pure decision logic for the ai-review label-integrity gate.
//
// This module is deliberately I/O-free: no network, no `github`/octokit, no
// `fs`, no process access. Every function is a pure input→output mapping so the
// security-critical decisions (revert-or-not, strip-or-not, green-or-not) can be
// unit-tested exhaustively (see ai-review-guard.test.js) and the workflow that
// requires it stays a thin, auditable I/O shell.
//
// Threats this closes (see the header of ready-to-merge.yml for the full note):
//   #359 staleness  — a greenlight from an old head must not survive new commits.
//   #397 provenance — an `ai-review:pass` applied by anyone other than the
//                     configured reviewer identity must not count as a review.
//
// SECURITY: callers pass label names / actor logins in here as plain JS data.
// Nothing in this module (or the workflow) may forward that untrusted data to a
// shell — it is only ever compared as data or handed to the REST API as JSON.

'use strict';

const PASS = 'ai-review:pass';
const CHANGES = 'ai-review:changes';

// Parse the reviewer-bot allowlist from a raw env string.
// Accepts comma / whitespace / newline separated logins; case-insensitive.
// Entries may be a user login (`review-bot`) or an app/bot login (`my-app[bot]`).
function parseAllowlist(raw) {
  return String(raw == null ? '' : raw)
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Is `login` one of the configured reviewer identities?
// An empty allowlist authorizes nobody — provenance cannot be verified until the
// owner configures AI_REVIEW_BOT_LOGINS, so the gate must fail closed.
function isAuthorizedReviewer(login, allowlist) {
  if (!login) return false;
  return allowlist.includes(String(login).toLowerCase());
}

// #397 — provenance. On a `labeled` event that added `ai-review:pass`, decide
// whether that label must be reverted because it did not come from an allowlisted
// reviewer identity. Only `ai-review:pass` is guarded: a forged `ai-review:changes`
// can only make the gate stricter (fail), never falsely green, so it is fail-safe.
function decideProvenanceRevert({ action, labelName, senderLogin, allowlist } = {}) {
  if (action !== 'labeled') return { revert: false };
  if (labelName !== PASS) return { revert: false };
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (isAuthorizedReviewer(senderLogin, list)) return { revert: false };
  return {
    revert: true,
    reason:
      list.length === 0
        ? 'the reviewer-bot allowlist is unset (repo/org variable AI_REVIEW_BOT_LOGINS) — ' +
          'pass provenance cannot be verified'
        : `applied by \`${sanitizeLogin(senderLogin)}\`, which is not an allowlisted reviewer identity`,
  };
}

// #359 — staleness. On a `synchronize` event (new commits pushed) any existing
// `ai-review:pass` reviewed an older head and is now stale; it must be stripped.
function decideStalenessStrip({ action, labels } = {}) {
  if (action !== 'synchronize') return { strip: false };
  const set = new Set(Array.isArray(labels) ? labels : []);
  if (!set.has(PASS)) return { strip: false };
  return {
    strip: true,
    reason: 'new commits were pushed after ai-review:pass — the greenlight is stale',
  };
}

// Compute the `ready-to-merge` commit status. The status is the authoritative
// gate, so it is derived from the *decided* effective label set (pass removed if
// it was reverted or stripped) — independent of whether the best-effort label
// mutation later succeeds. Green iff a trusted pass survives and no changes flag.
function decideStatus({ labels, provenanceRevert, stalenessStrip } = {}) {
  const eff = new Set(Array.isArray(labels) ? labels : []);
  if (provenanceRevert || stalenessStrip) eff.delete(PASS);

  const isGreen = eff.has(PASS) && !eff.has(CHANGES);

  let description;
  if (stalenessStrip) {
    description = 'stale ai-review:pass stripped on new commits — re-review required';
  } else if (provenanceRevert) {
    description = 'ai-review:pass reverted — not from an allowlisted reviewer';
  } else if (isGreen) {
    description = 'AI review passed';
  } else {
    description = 'needs ai-review:pass';
  }

  return {
    state: isGreen ? 'success' : 'failure',
    description, // GitHub truncates commit-status descriptions at 140 chars.
    effectiveLabels: [...eff],
  };
}

// Defensive: GitHub logins are [A-Za-z0-9-] (apps add a `[bot]` suffix), so they
// can never contain markdown/backtick metacharacters — but strip backticks anyway
// so a malformed value can never break out of the code span in an audit comment.
function sanitizeLogin(login) {
  return String(login == null ? '' : login).replace(/`/g, '');
}

module.exports = {
  PASS,
  CHANGES,
  parseAllowlist,
  isAuthorizedReviewer,
  decideProvenanceRevert,
  decideStalenessStrip,
  decideStatus,
  sanitizeLogin,
};
