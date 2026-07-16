// ai-review-guard — pure decision logic for the ai-review label-integrity gate.
//
// This module is deliberately I/O-free: no network, no `github`/octokit, no
// `fs`, no process access. Every function is a pure input→output mapping so the
// security-critical decisions (revert-or-not, strip-or-not, verified-or-not,
// green-or-not) can be unit-tested exhaustively (see ai-review-guard.test.js)
// and the workflow that requires it stays a thin, auditable I/O shell.
//
// Threats this closes (see the header of ready-to-merge.yml for the full note):
//   #359 staleness  — a greenlight from an old head must not survive new commits.
//   #397 provenance — an `ai-review:pass` applied by anyone other than the
//                     configured reviewer identity must not count as a review.
//
// NEVER TRUST BARE PRESENCE. The active guards below (revert at add-time, strip
// at push-time) are best-effort *cleanup*; they can transiently fail (rate
// limit / 5xx), leaving a forged or stale `ai-review:pass` on the PR. So the
// authoritative gate (`decideStatus`) does NOT green on label presence alone:
// a surviving pass counts only if `verifyPassProvenance` confirmed — from the
// PR's own event timeline — that it was LAST APPLIED BY an allowlisted reviewer
// identity AND AFTER the current head commit. Anything unverifiable ⇒ not green.
//
// SECURITY: callers pass label names / actor logins / timestamps in here as
// plain JS data. Nothing in this module (or the workflow) may forward that
// untrusted data to a shell — it is only ever compared as data or handed to the
// REST API as JSON.

'use strict';

const PASS = 'ai-review:pass';
const CHANGES = 'ai-review:changes';
// #466 — the SHA-bound pass witness. The ai-review workflow posts this commit
// status (success/failure) on the EXACT head SHA it evaluated, BEFORE it applies
// the `ai-review:pass` label. Because a commit status is bound to its SHA, its
// presence on the CURRENT head is an exact proof that THIS commit was reviewed —
// unlike the timestamp proxy in `verifyPassProvenance`.
const PASS_STATUS_CONTEXT = 'ai-review/pass';
// The reviewer could NOT run to a verdict for a TRANSIENT, non-code reason —
// almost always the Claude subscription's session quota being exhausted, but also
// a rate-limit / overload / auth blip. This is NOT a review of the PR: it must be
// visibly distinct from `ai-review:changes` (which means "the reviewer read your
// code and wants changes"), and it is safe to RETRY once the window resets. See
// isQuotaExhaustion() and the ai-review-retry workflow.
const BLOCKED = 'ai-review:blocked';

// SPEC-031 INV-8 / FR-9a — the single positive "your turn" queue signal. Present
// on a PR whose independent AI review has PASSED (the `ready-to-merge` gate is
// green) and whose ONLY remaining gate is a human keystroke. It is the canonical
// "my turn" filter, replacing the ambiguous read of `ai-review:pass` plus a
// negative label — and it never coexists with `ai-review:changes` (a failing gate
// removes it). Owned by ONE applier (ready-to-merge.yml), driven by shouldAwaitApproval().
const AWAITING_APPROVAL = 'awaiting-approval';

// Detect, from a failed `claude -p` reviewer invocation's combined output, whether
// the cause is an exhausted subscription quota / rate-limit / overload (a transient,
// retry-able, NOT-your-code condition) versus a genuine crash. review-branch.sh
// pipes the captured failure text here (via `node -e`) so the SAME tested pattern
// governs bash and JS — no drift. Pure: text in → boolean out. Conservative by
// design: it only claims "quota/transient" on a clear signal; anything else stays a
// hard failure (which fails closed to ai-review:changes, never a spurious pass).
function isQuotaExhaustion(text) {
  const s = String(text == null ? '' : text);
  // Kept deliberately TIGHT: over-matching would loop a genuine (non-transient)
  // crash forever as `ai-review:blocked` instead of failing closed to `changes`
  // for a human. Only clear quota / rate-limit / overload / retry signals count.
  return /\b(usage limit|rate.?limit(ed)?|quota|too many requests|overloaded|resets? (at|in)|try again (later|in)|429|insufficient (quota|credit))\b/i
    .test(s)
    // Claude CLI's subscription-limit phrasing: "Claude AI usage limit reached",
    // "5-hour limit reached", "You've reached your usage limit", "weekly limit".
    || /usage limit reached|limit reached|reached your (usage )?limit|weekly limit|session limit|5-?hour limit/i.test(s);
}

// GitHub truncates commit-status descriptions at 140 chars; keep ours within it
// even when a description carries a (potentially long) provenance reason.
const MAX_DESCRIPTION = 140;
function truncate(s, n = MAX_DESCRIPTION) {
  const str = String(s == null ? '' : s);
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`;
}

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

// #359 + #397 (durable) — provenance-recency verification of a *surviving* pass.
//
// The revert/strip guards above are add-time / push-time *cleanup* and can fail
// transiently, leaving a forged or stale `ai-review:pass` present. So on every
// event the gate must independently re-verify any present pass rather than trust
// its bare presence:
//   • `labelActor`      — who LAST applied `ai-review:pass` (from the PR timeline,
//                         or, on the `labeled` event itself, the GitHub-signed
//                         sender). Must be an allowlisted reviewer identity.
//   • `labelAppliedAt`  — when it was applied (ISO 8601). Must be AT/AFTER…
//   • `headCommittedAt` — …the current head commit's timestamp, else the pass
//                         reviewed an older head and is stale.
//   • `allowlist`       — parsed AI_REVIEW_BOT_LOGINS.
//
// Deny-by-default: an empty allowlist, an unknown applier, or missing/unparseable
// timestamps all return { verified:false } so the gate stays red. This also closes
// the "pass already present before this guard was deployed / on a stale head"
// transition gap — such a pass has no allowlisted, post-head-commit application
// on record, so it never verifies.
//
// NOTE on the recency reference: `headCommittedAt` is the head commit's own
// committer date, which a committer can backdate. That residual (narrow) window
// is covered defence-in-depth by the `synchronize` staleness strip (which now
// fails the run if it cannot remove the label) and by the allowlist check a
// forger cannot satisfy; the primary trust anchor here is the applier identity.
function verifyPassProvenance({ labelActor, labelAppliedAt, headCommittedAt, allowlist } = {}) {
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (list.length === 0) {
    return {
      verified: false,
      reason:
        'reviewer-bot allowlist (AI_REVIEW_BOT_LOGINS) is unset — pass provenance cannot be verified',
    };
  }
  if (!labelActor) {
    return {
      verified: false,
      reason: 'no record of who applied ai-review:pass — provenance unverifiable',
    };
  }
  if (!isAuthorizedReviewer(labelActor, list)) {
    return {
      verified: false,
      reason: `ai-review:pass last applied by \`${sanitizeLogin(labelActor)}\`, not an allowlisted reviewer identity`,
    };
  }
  const applied = Date.parse(labelAppliedAt);
  const committed = Date.parse(headCommittedAt);
  if (!Number.isFinite(applied) || !Number.isFinite(committed)) {
    return {
      verified: false,
      reason: 'missing or unparseable timestamps — cannot confirm ai-review:pass is fresh',
    };
  }
  if (applied < committed) {
    return {
      verified: false,
      reason: 'ai-review:pass predates the current head commit — the greenlight is stale',
    };
  }
  return { verified: true, reason: 'applied by an allowlisted reviewer after the head commit' };
}

// #466 — SHA-bound recency (closes the TOCTOU the timestamp proxy leaves open).
// `verifyPassProvenance` compares the label-application TIME to the head-commit
// TIME; a same-second push, clock skew, or a cancelled `synchronize` strip can slip
// a stale pass through. A commit STATUS is bound to the exact SHA it was posted on,
// so requiring `ai-review/pass`=success on the CURRENT head SHA is an EXACT witness
// that this very commit was reviewed. `statuses` is the commit-status list for the
// current head SHA; `verified` iff it carries `ai-review/pass`=success from an
// allowlisted creator. Absence ⇒ the pass is for a different/older commit ⇒ red.
function verifyHeadPassStatus({ statuses, allowlist } = {}) {
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (list.length === 0) {
    return {
      verified: false,
      reason:
        'reviewer-bot allowlist (AI_REVIEW_BOT_LOGINS) is unset — head-status provenance cannot be verified',
    };
  }
  const ours = (Array.isArray(statuses) ? statuses : []).filter(
    (s) => s && s.context === PASS_STATUS_CONTEXT,
  );
  if (ours.length === 0) {
    return {
      verified: false,
      reason: `no \`${PASS_STATUS_CONTEXT}\` status on the current head commit — the greenlight does not correspond to this SHA (#466)`,
    };
  }
  // Most-recent by created_at (the API returns newest-first, but be explicit).
  const latest = ours.reduce((a, b) =>
    Date.parse(b.created_at) >= Date.parse(a.created_at) ? b : a,
  );
  if (latest.state !== 'success') {
    return {
      verified: false,
      reason: `\`${PASS_STATUS_CONTEXT}\` on the current head is '${sanitizeLogin(latest.state)}', not success`,
    };
  }
  const creator = latest.creator && latest.creator.login;
  if (!creator || !isAuthorizedReviewer(creator, list)) {
    return {
      verified: false,
      reason: `\`${PASS_STATUS_CONTEXT}\` on the current head was posted by \`${sanitizeLogin(creator)}\`, not an allowlisted reviewer`,
    };
  }
  return {
    verified: true,
    reason: `\`${PASS_STATUS_CONTEXT}\`=success on the current head SHA, from an allowlisted reviewer`,
  };
}

// Compute the `ready-to-merge` commit status. The status is the authoritative
// gate, so it is derived from the *decided* effective label set (pass removed if
// it was reverted or stripped) AND from the provenance-recency verification of
// any surviving pass — independent of whether the best-effort label mutation
// later succeeds. Green iff a *verified* pass survives and no changes flag.
//
// Bare label presence is never trusted: a present `ai-review:pass` with absent
// or unverified `passProvenance` yields a red status (deny-by-default).
function decideStatus({ labels, provenanceRevert, stalenessStrip, passProvenance, headStatus } = {}) {
  const eff = new Set(Array.isArray(labels) ? labels : []);
  if (provenanceRevert || stalenessStrip) eff.delete(PASS);

  const passPresent = eff.has(PASS);
  // A surviving pass counts only if its provenance was verified upstream.
  const passVerified = passPresent && !!(passProvenance && passProvenance.verified);
  // #466 — the SHA-bound witness must ALSO confirm THIS head was the reviewed one.
  // `headStatus` is OPTIONAL: when omitted (a caller/base guard that predates #466,
  // during rollout) it is NOT required — behaviour is unchanged. When supplied it
  // gates: an unverified head status blocks green even with a provenance-verified
  // label (that is exactly the stale-pass-on-a-new-head case #466 closes).
  const headVerified = headStatus === undefined ? true : !!(headStatus && headStatus.verified);
  const isGreen = passVerified && headVerified && !eff.has(CHANGES);

  let description;
  if (stalenessStrip) {
    description = 'stale ai-review:pass stripped on new commits — re-review required';
  } else if (provenanceRevert) {
    description = 'ai-review:pass reverted — not from an allowlisted reviewer';
  } else if (passPresent && !passVerified) {
    // Present but not trusted (unverified applier / stale / allowlist unset).
    description = truncate(
      `ai-review:pass not trusted — ${
        (passProvenance && passProvenance.reason) || 'provenance unverified'
      }`,
    );
  } else if (passPresent && passVerified && !headVerified) {
    // #466 — the label is trustworthy but is not bound to THIS commit's review.
    description = truncate(
      `ai-review:pass not bound to this commit — ${
        (headStatus && headStatus.reason) || 'no ai-review/pass status on the current head SHA'
      }`,
    );
  } else if (isGreen) {
    description = 'AI review passed';
  } else {
    description = 'needs ai-review:pass';
  }

  return {
    state: isGreen ? 'success' : 'failure',
    description, // already within GitHub's 140-char commit-status limit.
    effectiveLabels: [...eff],
  };
}

// SPEC-031 FR-9a — should the `awaiting-approval` "your turn" signal be PRESENT on
// this PR? Pure and side-effect-free so it is unit-testable; ready-to-merge.yml
// applies/removes the label from this boolean on every PR event. Both conditions
// required:
//   - statusState === 'success' — the ready-to-merge gate (decideStatus, the sole
//     authority) is GREEN: a verified, fresh, un-reverted pass with no outstanding
//     `ai-review:changes`. Every stale-strip / forged-revert / changes-flip already
//     drives this to 'failure', so the label is removed with NO extra mirror site.
//   - !autoMergeArmed — the PR will NOT merge itself. A PR with native auto-merge
//     armed (DR-061) merges the instant the gate greens, so it is the ROBOT's turn,
//     never a human's — it must never enter the "my turn" queue.
function shouldAwaitApproval({ statusState, autoMergeArmed } = {}) {
  return statusState === 'success' && !autoMergeArmed;
}

// Map the reviewer's FINAL verdict label — plus whether the PR touches the
// review machinery — to the `ai-review` check-run's conclusion + human-
// readable title/summary.
//
// #480 (this fix, built on #469's verdict-mirroring fix): a 3-way conclusion
// so `ai-review` can be an ALWAYS-ON REQUIRED ruleset check that still
// self-exempts machinery PRs. GitHub required check-runs treat `neutral`/
// `skipped` as PASSING; only `failure`/`pending` BLOCK. That semantics gives
// us, from one check, both a real gate AND a self-exemption with no bypass
// actor and no path-based ruleset exemption (which GitHub doesn't support):
//
//   isMachineryPr === true       → neutral   (EXEMPT. Wins regardless of
//                                   `label` — precedence, checked first. A
//                                   gate cannot certify a change to itself
//                                   (`.github/`/`scripts/`, #476/#477/…), so
//                                   these are neutral and a human reviews.)
//   label === 'ai-review:pass'   → success   (genuinely passed independent
//                                   review)
//   anything else (changes,
//   empty/errored, unrecognised) → failure   (BLOCKS the required check —
//                                   this is the actual gate. Changed from
//                                   #469's `neutral`, which a required check
//                                   reads as passing and therefore never
//                                   gated a normal `changes` verdict.)
//
// `isMachineryPr` MUST be computed from the SAME predicate the workflow's
// anti-self-cert override already uses — changed-file paths matching
// `^(\.github/|scripts/)` (ai-review.yml's `SELF_EDIT_KIND === "machinery"`),
// never a second, divergent definition. It deliberately EXCLUDES the
// "indeterminate" case (the changed-file diff itself could not be computed):
// that case must stay fail-closed to `failure`, not `neutral` — otherwise a
// PR could win the exemption simply by making the diff computation error.
const CHECK_NAME = 'ai-review';
function decideReviewCheck(label, isMachineryPr) {
  const machinery = isMachineryPr === true;
  const pass = !machinery && label === PASS;

  let conclusion;
  let title;
  let summary;
  if (machinery) {
    conclusion = 'neutral';
    title = 'AI review: machinery PR — exempt, human review required';
    summary =
      'This PR touches the AI-review machinery (`.github/` or `scripts/`). ' +
      'A gate cannot certify a change to itself, so the reviewer force-labels ' +
      'these `ai-review:changes` regardless of the agent\'s verdict. This check ' +
      'is deliberately **neutral** — GitHub treats `neutral` as passing a ' +
      'required check, so a machinery PR is not permanently blocked by its own ' +
      'gate — but a human must still review and approve it before merging.';
  } else if (pass) {
    conclusion = 'success';
    title = 'AI review: passed';
    summary =
      'The independent AI reviewer approved this PR (`ai-review:pass`). ' +
      'See the AI review comment for the findings behind the verdict.';
  } else if (label === BLOCKED) {
    // The reviewer could not run (quota/rate-limit/transient) — NOT a verdict on
    // the code. `action_required` blocks merge (un-reviewed code must not land)
    // while reading as "needs action: re-run", never "changes requested" or a
    // broken-CI failure. The ai-review-retry workflow re-runs it automatically
    // when the quota window resets.
    conclusion = 'action_required';
    title = 'AI review could not run — quota/transient (auto-retries)';
    summary =
      'The independent AI reviewer could **not** complete — almost always the ' +
      'Claude subscription session-quota being exhausted (also rate-limit / ' +
      'overload). **This is not a review of your code.** It blocks merge only ' +
      'because un-reviewed code must not land. It re-runs automatically when the ' +
      'quota window resets (see the ai-review-retry workflow); to unblock sooner, ' +
      'wait for the reset or enable PAYG-API failover (`ANTHROPIC_API_KEY`). See ' +
      'the AI review comment for the reset time and options.';
  } else {
    conclusion = 'failure';
    title = 'AI review: changes requested — this check blocks merge';
    summary =
      'The independent AI reviewer did **not** pass this PR ' +
      '(`ai-review:changes`), the review could not complete, or the verdict ' +
      'was empty/unrecognised. This check is deliberately **failure**: when ' +
      '`ai-review` is required in the branch ruleset, this blocks merge until ' +
      'a human resolves it. See the AI review comment for details.';
  }

  return { name: CHECK_NAME, conclusion, title, summary };
}

// Is a label-removal API failure safe to ignore? ONLY a 404 (the label is
// already gone — e.g. a concurrent removal). Any other status (rate limit, 5xx,
// 403) means the forged/stale `ai-review:pass` may STILL be present, so the
// caller must NOT swallow it — it must fail the run so the removal is retried
// rather than left silently in place (the fail-open hole this closes).
function isBenignRemovalError(status) {
  return status === 404;
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
  BLOCKED,
  AWAITING_APPROVAL,
  shouldAwaitApproval,
  isQuotaExhaustion,
  parseAllowlist,
  isAuthorizedReviewer,
  decideProvenanceRevert,
  decideStalenessStrip,
  verifyPassProvenance,
  verifyHeadPassStatus,
  PASS_STATUS_CONTEXT,
  decideStatus,
  decideReviewCheck,
  isBenignRemovalError,
  sanitizeLogin,
};
