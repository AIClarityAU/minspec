// Unit tests for the ai-review label-integrity decision logic.
// Runs on plain Node (no deps): `node --test .github/scripts/ai-review-guard.test.js`.
// Wired into CI's lint job so the security-critical decisions stay enforced.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PASS,
  CHANGES,
  parseAllowlist,
  isAuthorizedReviewer,
  decideProvenanceRevert,
  decideStalenessStrip,
  verifyPassProvenance,
  decideStatus,
  isBenignRemovalError,
  sanitizeLogin,
} = require('./ai-review-guard.js');

// Shared timestamps for the recency tests: a pass applied AFTER the head commit
// is fresh; a pass applied BEFORE it reviewed an older head and is stale.
const HEAD_AT = '2026-07-02T12:00:00Z';
const AFTER_HEAD = '2026-07-02T12:05:00Z';
const BEFORE_HEAD = '2026-07-02T11:55:00Z';
const BOT_ALLOWLIST = parseAllowlist('minspec-review-bot, my-review-app[bot]');

// A verified provenance object, as the workflow would compute for a fresh,
// allowlisted pass — used where a status test needs the gate to be able to green.
const VERIFIED = { verified: true };

// ── parseAllowlist ───────────────────────────────────────────────────────────
test('parseAllowlist: comma/space/newline separated, lowercased, empties dropped', () => {
  assert.deepEqual(parseAllowlist('Review-Bot, my-app[bot]\n  Other '), [
    'review-bot',
    'my-app[bot]',
    'other',
  ]);
});

test('parseAllowlist: unset/empty yields an empty list (authorizes nobody)', () => {
  assert.deepEqual(parseAllowlist(undefined), []);
  assert.deepEqual(parseAllowlist(''), []);
  assert.deepEqual(parseAllowlist('   , \n '), []);
});

// ── isAuthorizedReviewer ─────────────────────────────────────────────────────
test('isAuthorizedReviewer: case-insensitive membership', () => {
  const list = parseAllowlist('review-bot, my-app[bot]');
  assert.equal(isAuthorizedReviewer('Review-Bot', list), true);
  assert.equal(isAuthorizedReviewer('my-app[bot]', list), true);
  assert.equal(isAuthorizedReviewer('some-human', list), false);
});

test('isAuthorizedReviewer: empty allowlist and empty login authorize nobody', () => {
  assert.equal(isAuthorizedReviewer('review-bot', []), false);
  assert.equal(isAuthorizedReviewer('', ['review-bot']), false);
  assert.equal(isAuthorizedReviewer(undefined, ['review-bot']), false);
});

// ── decideProvenanceRevert (#397) ────────────────────────────────────────────
test('provenance: pass added by a human (not allowlisted) is reverted — the #200 incident', () => {
  const d = decideProvenanceRevert({
    action: 'labeled',
    labelName: PASS,
    senderLogin: 'harvest316',
    allowlist: parseAllowlist('review-bot'),
  });
  assert.equal(d.revert, true);
  assert.match(d.reason, /not an allowlisted reviewer/);
});

test('provenance: pass added by the allowlisted reviewer bot is kept', () => {
  const d = decideProvenanceRevert({
    action: 'labeled',
    labelName: PASS,
    senderLogin: 'Review-Bot',
    allowlist: parseAllowlist('review-bot, my-app[bot]'),
  });
  assert.equal(d.revert, false);
});

test('provenance: unset allowlist means an unverifiable pass is reverted (fail closed)', () => {
  const d = decideProvenanceRevert({
    action: 'labeled',
    labelName: PASS,
    senderLogin: 'review-bot',
    allowlist: [],
  });
  assert.equal(d.revert, true);
  assert.match(d.reason, /AI_REVIEW_BOT_LOGINS/);
});

test('provenance: only ai-review:pass is guarded (a forged :changes is fail-safe)', () => {
  assert.equal(
    decideProvenanceRevert({
      action: 'labeled',
      labelName: CHANGES,
      senderLogin: 'harvest316',
      allowlist: [],
    }).revert,
    false,
  );
});

test('provenance: non-labeled events never revert', () => {
  for (const action of ['synchronize', 'opened', 'reopened', 'unlabeled']) {
    assert.equal(
      decideProvenanceRevert({ action, labelName: PASS, senderLogin: 'x', allowlist: [] }).revert,
      false,
    );
  }
});

// ── decideStalenessStrip (#359) ──────────────────────────────────────────────
test('staleness: synchronize strips an existing pass', () => {
  const d = decideStalenessStrip({ action: 'synchronize', labels: [PASS, 'feat'] });
  assert.equal(d.strip, true);
});

test('staleness: synchronize with no pass is a no-op', () => {
  assert.equal(decideStalenessStrip({ action: 'synchronize', labels: ['feat'] }).strip, false);
});

test('staleness: non-synchronize events never strip', () => {
  for (const action of ['labeled', 'opened', 'reopened', 'unlabeled']) {
    assert.equal(decideStalenessStrip({ action, labels: [PASS] }).strip, false);
  }
});

// ── verifyPassProvenance (#359 + #397 durable — never trust bare presence) ────
test('provenance-recency: pass applied by an allowlisted bot AFTER the head commit is verified (green)', () => {
  const v = verifyPassProvenance({
    labelActor: 'minspec-review-bot',
    labelAppliedAt: AFTER_HEAD,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  assert.equal(v.verified, true);
});

test('provenance-recency: a pass applied at the exact head-commit time is verified (boundary, still fresh)', () => {
  const v = verifyPassProvenance({
    labelActor: 'my-review-app[bot]',
    labelAppliedAt: HEAD_AT,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  assert.equal(v.verified, true);
});

test('provenance-recency: pass last applied by a non-allowlisted actor is NOT verified', () => {
  const v = verifyPassProvenance({
    labelActor: 'harvest316', // a human maintainer, not the reviewer identity
    labelAppliedAt: AFTER_HEAD,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  assert.equal(v.verified, false);
  assert.match(v.reason, /not an allowlisted reviewer/);
});

test('provenance-recency: pass applied BEFORE the current head commit (stale) is NOT verified', () => {
  const v = verifyPassProvenance({
    labelActor: 'minspec-review-bot',
    labelAppliedAt: BEFORE_HEAD,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  assert.equal(v.verified, false);
  assert.match(v.reason, /stale|predates/);
});

test('provenance-recency: an empty allowlist verifies nothing — even a real bot (fail closed)', () => {
  const v = verifyPassProvenance({
    labelActor: 'minspec-review-bot',
    labelAppliedAt: AFTER_HEAD,
    headCommittedAt: HEAD_AT,
    allowlist: [],
  });
  assert.equal(v.verified, false);
  assert.match(v.reason, /AI_REVIEW_BOT_LOGINS/);
});

test('provenance-recency: no record of who applied the pass is NOT verified (deny by default)', () => {
  const v = verifyPassProvenance({
    labelActor: null, // e.g. pass already present before the guard was deployed
    labelAppliedAt: AFTER_HEAD,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  assert.equal(v.verified, false);
  assert.match(v.reason, /no record/);
});

test('provenance-recency: missing/unparseable timestamps are NOT verified (cannot confirm freshness)', () => {
  const v = verifyPassProvenance({
    labelActor: 'minspec-review-bot',
    labelAppliedAt: undefined,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  assert.equal(v.verified, false);
  assert.match(v.reason, /timestamp/);
});

// ── decideStatus + verifyPassProvenance end-to-end (the fail-open regressions) ─
test('regression: a forged pass that survived a failed revert does NOT re-green on a later unrelated event', () => {
  // Later `labeled: feat` event; ai-review:pass still present because an earlier
  // revert failed. Timeline shows it was last applied by a human → not verified.
  const provenance = verifyPassProvenance({
    labelActor: 'harvest316',
    labelAppliedAt: AFTER_HEAD,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  const s = decideStatus({ labels: [PASS, 'feat'], passProvenance: provenance });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /not trusted/);
});

test('regression: a stale pass that survived a failed strip does NOT re-green on a later event', () => {
  // New head commit exists; pass was applied by the bot but BEFORE it → stale.
  const provenance = verifyPassProvenance({
    labelActor: 'minspec-review-bot',
    labelAppliedAt: BEFORE_HEAD,
    headCommittedAt: HEAD_AT,
    allowlist: BOT_ALLOWLIST,
  });
  const s = decideStatus({ labels: [PASS], passProvenance: provenance });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /not trusted/);
});

// ── isBenignRemovalError (fail-safe label removal — no silent fail-open) ───────
test('removal: only a 404 (already gone) is a benign, ignorable failure', () => {
  assert.equal(isBenignRemovalError(404), true);
});

test('removal: any non-404 failure is NOT benign — the caller must throw (run goes red)', () => {
  for (const status of [500, 502, 503, 403, 422, 0, undefined, null]) {
    assert.equal(isBenignRemovalError(status), false);
  }
});

// ── decideStatus (single writer of the ready-to-merge status) ─────────────────
test('status: pass and no changes, with verified provenance, is green', () => {
  const s = decideStatus({ labels: [PASS, 'feat'], passProvenance: VERIFIED });
  assert.equal(s.state, 'success');
  assert.equal(s.description, 'AI review passed');
});

test('status: pass present but provenance unverified/absent is red (bare presence is never trusted)', () => {
  // No passProvenance supplied ⇒ the label is present but not trusted ⇒ red.
  const s = decideStatus({ labels: [PASS, 'feat'] });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /not trusted/);
  // Even an explicit unverified verdict keeps it red, and surfaces the reason.
  const s2 = decideStatus({
    labels: [PASS],
    passProvenance: { verified: false, reason: 'stale' },
  });
  assert.equal(s2.state, 'failure');
  assert.match(s2.description, /stale/);
});

test('status: pass plus changes is red', () => {
  assert.equal(decideStatus({ labels: [PASS, CHANGES] }).state, 'failure');
});

test('status: no pass is red', () => {
  const s = decideStatus({ labels: ['feat'] });
  assert.equal(s.state, 'failure');
  assert.equal(s.description, 'needs ai-review:pass');
});

test('status: a reverted pass is dropped from the effective set (red), even though the label is still present in the payload', () => {
  const s = decideStatus({ labels: [PASS], provenanceRevert: true });
  assert.equal(s.state, 'failure');
  assert.deepEqual(s.effectiveLabels, []);
  assert.match(s.description, /reverted/);
});

test('status: a stripped (stale) pass is dropped from the effective set (red)', () => {
  const s = decideStatus({ labels: [PASS, 'feat'], stalenessStrip: true });
  assert.equal(s.state, 'failure');
  assert.deepEqual(s.effectiveLabels, ['feat']);
  assert.match(s.description, /stale/);
});

test('status: description never exceeds the 140-char commit-status limit', () => {
  const cases = [
    { labels: [PASS] },
    { labels: [PASS, CHANGES] },
    { labels: [] },
    { labels: [PASS], provenanceRevert: true },
    { labels: [PASS], stalenessStrip: true },
  ];
  for (const c of cases) {
    assert.ok(decideStatus(c).description.length <= 140);
  }
});

// ── sanitizeLogin ────────────────────────────────────────────────────────────
test('sanitizeLogin: strips backticks so a value cannot escape a markdown code span', () => {
  assert.equal(sanitizeLogin('ev`il'), 'evil');
  assert.equal(sanitizeLogin(undefined), '');
});
