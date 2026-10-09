// Unit tests for the ai-review label-integrity decision logic.
// Runs on plain Node (no deps): `node --test .github/scripts/ai-review-guard.test.js`.
//
// This suite is a PARITY-MANAGED file (AIClarityAU/minspec#871): it ships alongside
// ai-review-guard.js and is byte-synced to it by the same machinery, so the guard's
// own "see ai-review-guard.test.js" resolves wherever the guard lands. In MinSpec's
// own repo CI's lint job runs it on every PR; in a repo that scaffolded this stack
// nothing runs it automatically yet (AIClarityAU/minspec#2059) - until that lands,
// run the command above by hand.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PASS,
  CHANGES,
  BLOCKED,
  isQuotaExhaustion,
  parseAllowlist,
  isAuthorizedReviewer,
  decideProvenanceRevert,
  decideStalenessStrip,
  verifyPassProvenance,
  verifyHeadPassStatus,
  verifyHeadPassCheckRun,
  verifyHeadPassWitness,
  PASS_STATUS_CONTEXT,
  HOLD_RE,
  decideStatus,
  shouldAwaitApproval,
  BLOCKED_BY,
  parseBlockedBy,
  shouldMarkBlockedBy,
  shouldSummonHumanReview,
  AWAITING_APPROVAL,
  decideReviewCheck,
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
    { labels: [PASS, 'hold:human'], passProvenance: VERIFIED },
    // A pathological pile of long hold labels must still fit the 140-char limit.
    {
      labels: [PASS, ...Array.from({ length: 12 }, (_, i) => `hold:${'x'.repeat(20)}${i}`)],
      passProvenance: VERIFIED,
    },
  ];
  for (const c of cases) {
    assert.ok(decideStatus(c).description.length <= 140);
  }
});

// ── decideReviewCheck (honest, 3-way `ai-review` check-run conclusion) ────────
// #480: `ai-review` must be safe as an ALWAYS-ON REQUIRED ruleset check —
// machinery PRs self-exempt (neutral, GitHub treats neutral as passing a
// required check), a genuine pass is success, and everything else (changes /
// empty / errored) is now FAILURE so the required check actually blocks
// (the #469 behaviour of neutral-for-changes never gated anything).

// -- machinery precedence: ALWAYS neutral, regardless of label --
test('review-check: machinery PR + pass verdict is still NEUTRAL (machinery wins over label)', () => {
  const c = decideReviewCheck(PASS, true);
  assert.equal(c.name, 'ai-review');
  assert.equal(c.conclusion, 'neutral');
  assert.match(c.title, /machinery/i);
});

test('review-check: machinery PR + changes verdict is NEUTRAL (self-exempt)', () => {
  const c = decideReviewCheck(CHANGES, true);
  assert.equal(c.conclusion, 'neutral');
  assert.match(c.title, /machinery/i);
});

test('review-check: machinery PR + empty/errored verdict is NEUTRAL (machinery always neutral)', () => {
  for (const label of ['', undefined, null, 'garbage']) {
    const c = decideReviewCheck(label, true);
    assert.equal(c.conclusion, 'neutral', `expected neutral for ${JSON.stringify(label)}`);
  }
});

// -- normal (non-machinery) PRs: the actual gate --
test('review-check: normal PR + ai-review:pass verdict maps to a green (success) check', () => {
  const c = decideReviewCheck(PASS, false);
  assert.equal(c.name, 'ai-review');
  assert.equal(c.conclusion, 'success');
  assert.match(c.title, /passed/i);
});

test('review-check: normal PR + ai-review:changes verdict maps to FAILURE — blocks a required check', () => {
  const c = decideReviewCheck(CHANGES, false);
  assert.equal(c.name, 'ai-review');
  assert.equal(c.conclusion, 'failure');
  assert.notEqual(c.conclusion, 'neutral');
  assert.match(c.title, /changes requested|blocks merge/i);
});

test('review-check: normal PR fail-closed — an empty/absent verdict (review errored) is FAILURE, not neutral or green', () => {
  for (const label of ['', undefined, null, 'ai-review:pending', 'garbage']) {
    const c = decideReviewCheck(label, false);
    assert.equal(c.conclusion, 'failure', `expected failure for ${JSON.stringify(label)}`);
    assert.notEqual(c.conclusion, 'success');
  }
});

test('review-check: isMachineryPr omitted defaults to the normal (non-machinery) path', () => {
  assert.equal(decideReviewCheck(PASS).conclusion, 'success');
  assert.equal(decideReviewCheck(CHANGES).conclusion, 'failure');
});

// ── ai-review:blocked (reviewer could not run — quota/transient) ──────────────
test('review-check: blocked maps to action_required — blocks merge but is NOT failure/changes/green', () => {
  const c = decideReviewCheck(BLOCKED, false);
  assert.equal(c.name, 'ai-review');
  assert.equal(c.conclusion, 'action_required');
  assert.notEqual(c.conclusion, 'success');   // never a green
  assert.notEqual(c.conclusion, 'failure');   // not a "changes requested" red
  assert.match(c.title, /could not run|quota|retr/i);
  assert.match(c.summary, /not a review of your code/i);
});

test('review-check: a machinery PR that is also blocked still resolves as machinery (neutral) — self-edit wins', () => {
  // A machinery verdict needs no working reviewer, so blocked yields to it.
  assert.equal(decideReviewCheck(BLOCKED, true).conclusion, 'neutral');
});

// ── isQuotaExhaustion (single source of truth shared with review-branch.sh) ───
test('isQuotaExhaustion: TRUE for real subscription/limit/transient signatures', () => {
  for (const s of [
    'Claude AI usage limit reached',
    "You've reached your usage limit",
    '5-hour limit reached, resets at 3:00 PM',
    'weekly limit reached',
    'Error: rate limit exceeded',
    'HTTP 429 Too Many Requests',
    'overloaded_error: the service is overloaded',
    'insufficient quota',
    'try again later',
  ]) {
    assert.equal(isQuotaExhaustion(s), true, `expected quota=true for: ${s}`);
  }
});

test('isQuotaExhaustion: FALSE for a normal review / crash / empty (fail closed to changes, not blocked)', () => {
  for (const s of [
    '',
    null,
    undefined,
    'REVIEW_VERDICT_BEGIN\nverdict: changes\nblocking: 1\nREVIEW_VERDICT_END',
    'TypeError: Cannot read properties of undefined',
    '+ const someLongVariableName = compute();',
    'the reviewer found a limitation in error handling', // "limit" substring must NOT trip it
  ]) {
    assert.equal(isQuotaExhaustion(s), false, `expected quota=false for: ${JSON.stringify(s)}`);
  }
});

test('review-check: ONLY an exact ai-review:pass on a normal PR is ever green (no near-miss passes)', () => {
  assert.equal(decideReviewCheck('ai-review:pass ', false).conclusion, 'failure'); // trailing space
  assert.equal(decideReviewCheck('AI-REVIEW:PASS', false).conclusion, 'failure'); // wrong case
  assert.equal(decideReviewCheck('pass', false).conclusion, 'failure'); // unqualified
  assert.equal(decideReviewCheck(PASS, false).conclusion, 'success'); // the only green
});

// ── sanitizeLogin ────────────────────────────────────────────────────────────
test('sanitizeLogin: strips backticks so a value cannot escape a markdown code span', () => {
  assert.equal(sanitizeLogin('ev`il'), 'evil');
  assert.equal(sanitizeLogin(undefined), '');
});

// ── #466 verifyHeadPassStatus — SHA-bound pass witness ───────────────────────
const BOTS = ['minspec-sdd[bot]'];
const okStatus = (over = {}) => ({
  context: PASS_STATUS_CONTEXT,
  state: 'success',
  created_at: '2026-07-14T10:00:00Z',
  creator: { login: 'minspec-sdd[bot]' },
  ...over,
});

test('verifyHeadPassStatus: ai-review/pass=success from an allowlisted bot on the head → verified', () => {
  assert.equal(verifyHeadPassStatus({ statuses: [okStatus()], allowlist: BOTS }).verified, true);
});

test('verifyHeadPassStatus: NO ai-review/pass status on the head → not verified (#466 — stale label on a new head)', () => {
  const r = verifyHeadPassStatus({
    statuses: [{ context: 'other', state: 'success', created_at: '2026-07-14T10:00:00Z' }],
    allowlist: BOTS,
  });
  assert.equal(r.verified, false);
  assert.match(r.reason, /does not correspond to this SHA|no .*status/i);
});

test('verifyHeadPassStatus: status present but state=failure → not verified', () => {
  assert.equal(verifyHeadPassStatus({ statuses: [okStatus({ state: 'failure' })], allowlist: BOTS }).verified, false);
});

test('verifyHeadPassStatus: success but from a non-allowlisted creator → not verified (forged status)', () => {
  assert.equal(
    verifyHeadPassStatus({ statuses: [okStatus({ creator: { login: 'some-human' } })], allowlist: BOTS }).verified,
    false,
  );
});

test('verifyHeadPassStatus: allowlist unset → not verified (cannot bind provenance)', () => {
  assert.equal(verifyHeadPassStatus({ statuses: [okStatus()], allowlist: [] }).verified, false);
});

test('verifyHeadPassStatus: uses the MOST RECENT ai-review/pass (a later failure supersedes an earlier success, either array order)', () => {
  const older = okStatus({ state: 'success', created_at: '2026-07-14T10:00:00Z' });
  const newer = okStatus({ state: 'failure', created_at: '2026-07-14T11:00:00Z' });
  assert.equal(verifyHeadPassStatus({ statuses: [older, newer], allowlist: BOTS }).verified, false);
  assert.equal(verifyHeadPassStatus({ statuses: [newer, older], allowlist: BOTS }).verified, false);
});

// ── #466 decideStatus gates on the SHA-bound head status when supplied ────────
const VERIFIED_PROV = { verified: true, reason: 'ok' };

test('decideStatus: verified label + VERIFIED head status → green', () => {
  const s = decideStatus({ labels: [PASS, 'feat'], passProvenance: VERIFIED_PROV, headStatus: { verified: true } });
  assert.equal(s.state, 'success');
});

test('decideStatus: verified label but UNVERIFIED head status → red (the #466 stale-pass-on-new-head case)', () => {
  const s = decideStatus({
    labels: [PASS, 'feat'],
    passProvenance: VERIFIED_PROV,
    headStatus: { verified: false, reason: 'no ai-review/pass on this SHA' },
  });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /not bound to this commit/i);
});

test('decideStatus: headStatus OMITTED → not required (rollout / base-guard-predates-#466 compat)', () => {
  const s = decideStatus({ labels: [PASS, 'feat'], passProvenance: VERIFIED_PROV });
  assert.equal(s.state, 'success');
});

// ── #810 verifyHeadPassCheckRun / verifyHeadPassWitness — the SECOND witness ──
// #466's `ai-review/pass` commit status was the SOLE witness the gate would
// accept. Its post is best-effort (`|| true`) and was returning HTTP 403
// ("Resource not accessible by integration" — the App lacks `statuses: write`),
// so the witness was NEVER written while the `ai-review:pass` label still landed:
// `ready-to-merge` was unsatisfiable repo-wide and every merge became an --admin
// bypass. The `ai-review` CHECK-RUN is posted successfully by the same App on the
// same head SHA and is an equally strong witness — intrinsically SHA-bound
// (`head_sha`) and carrying a server-attested App identity — so the gate accepts
// EITHER. Neither witness is weakened: absence of both is still red.
const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER_SHA = '0000000000000000000000000000000000000000';
const okCheckRun = (over = {}) => ({
  name: 'ai-review',
  head_sha: HEAD_SHA,
  status: 'completed',
  conclusion: 'success',
  completed_at: '2026-07-14T10:00:00Z',
  app: { slug: 'minspec-sdd' },
  ...over,
});

// ── T0 (#810) — the headline invariant this bug violated ─────────────────────
test('#810 T0: verified fresh ai-review:pass bound to head via the check-run (no ai-review/pass status) → gate greens + awaiting-approval', () => {
  const witness = verifyHeadPassWitness({
    statuses: [], // the 403'd best-effort status never landed — the bug
    checkRuns: [okCheckRun()],
    allowlist: BOTS,
    headSha: HEAD_SHA,
  });
  assert.equal(witness.verified, true);

  const s = decideStatus({ labels: [PASS], passProvenance: VERIFIED_PROV, headStatus: witness });
  assert.equal(s.state, 'success');
  // DR-063 / #817 — the "my turn" signal must start working off this green.
  assert.equal(shouldAwaitApproval({ statusState: s.state, autoMergeArmed: false }), true);
});

test('#810: the ai-review/pass STATUS alone still verifies (the #466 witness is unchanged)', () => {
  const w = verifyHeadPassWitness({
    statuses: [okStatus()],
    checkRuns: [],
    allowlist: BOTS,
    headSha: HEAD_SHA,
  });
  assert.equal(w.verified, true);
});

test('#810: NEITHER witness on head → not verified (stale/absent pass stays red — #466 hole not reopened)', () => {
  const w = verifyHeadPassWitness({ statuses: [], checkRuns: [], allowlist: BOTS, headSha: HEAD_SHA });
  assert.equal(w.verified, false);
  assert.match(w.reason, /not bound|no .*witness|does not correspond/i);
});

test('#810: check-run on a DIFFERENT head_sha → not verified (SHA-binding, #466/#776)', () => {
  assert.equal(
    verifyHeadPassCheckRun({ checkRuns: [okCheckRun({ head_sha: OTHER_SHA })], allowlist: BOTS, headSha: HEAD_SHA })
      .verified,
    false,
  );
});

test('#810: check-run conclusion=neutral (machinery self-exemption) is NOT a pass witness', () => {
  assert.equal(
    verifyHeadPassCheckRun({ checkRuns: [okCheckRun({ conclusion: 'neutral' })], allowlist: BOTS, headSha: HEAD_SHA })
      .verified,
    false,
  );
});

test('#810: check-run conclusion=failure/action_required is NOT a pass witness', () => {
  for (const conclusion of ['failure', 'action_required', 'cancelled', null]) {
    assert.equal(
      verifyHeadPassCheckRun({ checkRuns: [okCheckRun({ conclusion })], allowlist: BOTS, headSha: HEAD_SHA }).verified,
      false,
      `conclusion=${conclusion} must not verify`,
    );
  }
});

test('#810: check-run still in progress (status!=completed) is NOT a pass witness', () => {
  assert.equal(
    verifyHeadPassCheckRun({
      checkRuns: [okCheckRun({ status: 'in_progress', conclusion: null })],
      allowlist: BOTS,
      headSha: HEAD_SHA,
    }).verified,
    false,
  );
});

test('#810: check-run from a NON-allowlisted App → not verified (forged by another app/workflow, #397)', () => {
  // A PR-authored workflow can post a check-run named `ai-review`, but its App
  // identity is `github-actions`, never the reviewer App — provenance rejects it.
  assert.equal(
    verifyHeadPassCheckRun({
      checkRuns: [okCheckRun({ app: { slug: 'github-actions' } })],
      allowlist: BOTS,
      headSha: HEAD_SHA,
    }).verified,
    false,
  );
});

test('#810: a check-run with some OTHER name is not the ai-review witness', () => {
  assert.equal(
    verifyHeadPassCheckRun({ checkRuns: [okCheckRun({ name: 'build' })], allowlist: BOTS, headSha: HEAD_SHA })
      .verified,
    false,
  );
});

test('#810: allowlist unset → neither witness verifies (deny-by-default)', () => {
  assert.equal(verifyHeadPassCheckRun({ checkRuns: [okCheckRun()], allowlist: [], headSha: HEAD_SHA }).verified, false);
  assert.equal(
    verifyHeadPassWitness({ statuses: [okStatus()], checkRuns: [okCheckRun()], allowlist: [], headSha: HEAD_SHA })
      .verified,
    false,
  );
});

test('#810: uses the MOST RECENT ai-review check-run (a later failure supersedes an earlier success, either order)', () => {
  const older = okCheckRun({ conclusion: 'success', completed_at: '2026-07-14T10:00:00Z' });
  const newer = okCheckRun({ conclusion: 'failure', completed_at: '2026-07-14T11:00:00Z' });
  assert.equal(verifyHeadPassCheckRun({ checkRuns: [older, newer], allowlist: BOTS, headSha: HEAD_SHA }).verified, false);
  assert.equal(verifyHeadPassCheckRun({ checkRuns: [newer, older], allowlist: BOTS, headSha: HEAD_SHA }).verified, false);
});

test('#810: a FAILING ai-review/pass status does not veto a genuine passing check-run (either witness suffices)', () => {
  const w = verifyHeadPassWitness({
    statuses: [okStatus({ state: 'failure' })],
    checkRuns: [okCheckRun()],
    allowlist: BOTS,
    headSha: HEAD_SHA,
  });
  assert.equal(w.verified, true);
});

test('#810: headSha omitted → the check-run head_sha is not second-guessed (caller already queried by head ref)', () => {
  assert.equal(verifyHeadPassCheckRun({ checkRuns: [okCheckRun()], allowlist: BOTS }).verified, true);
});

// ── DR-063 / SPEC-031 FR-9a — awaiting-approval "your turn" queue signal ──────
test('shouldAwaitApproval: green gate + no auto-merge → your turn (label present)', () => {
  assert.equal(shouldAwaitApproval({ statusState: 'success', autoMergeArmed: false }), true);
});

test('shouldAwaitApproval: green gate but auto-merge armed → robot merges it, NOT your turn', () => {
  assert.equal(shouldAwaitApproval({ statusState: 'success', autoMergeArmed: true }), false);
});

test('shouldAwaitApproval: failing gate → never your turn (any auto-merge state)', () => {
  assert.equal(shouldAwaitApproval({ statusState: 'failure', autoMergeArmed: false }), false);
  assert.equal(shouldAwaitApproval({ statusState: 'failure', autoMergeArmed: true }), false);
});

test('shouldAwaitApproval: only literal success counts (pending/error/undefined → false, fail-closed)', () => {
  assert.equal(shouldAwaitApproval({ statusState: 'pending', autoMergeArmed: false }), false);
  assert.equal(shouldAwaitApproval({ statusState: 'error', autoMergeArmed: false }), false);
  assert.equal(shouldAwaitApproval({ statusState: undefined, autoMergeArmed: false }), false);
  assert.equal(shouldAwaitApproval({}), false);
  assert.equal(shouldAwaitApproval(), false);
});

test('shouldAwaitApproval: a stripped/reverted pass drives decideStatus→failure→label removed (integration with the sole owner)', () => {
  // A stale-strip makes decideStatus red; shouldAwaitApproval then returns false,
  // so ready-to-merge.yml removes the label with NO extra mirror site (FR-9a).
  const red = decideStatus({ labels: [PASS], stalenessStrip: true, passProvenance: VERIFIED_PROV });
  assert.equal(red.state, 'failure');
  assert.equal(shouldAwaitApproval({ statusState: red.state, autoMergeArmed: false }), false);
});

test('AWAITING_APPROVAL: is the canonical label string', () => {
  assert.equal(AWAITING_APPROVAL, 'awaiting-approval');
});

// ── #816 — needs-human-review means "a human is genuinely the next actor" ─────
// The Post step summons a human via this seam. The retirement: a NORMAL
// (non-machinery) `ai-review:changes` no longer summons a human at t=0
// (remediate-pr.sh does so only at exhaustion); a MACHINERY PR still does.
test('shouldSummonHumanReview: MACHINERY ai-review:changes → summon a human (kept)', () => {
  assert.equal(shouldSummonHumanReview({ label: CHANGES, isMachinery: true }), true);
});

test('shouldSummonHumanReview: MACHINERY ai-review:pass → summon a human (gate cannot certify itself, #596)', () => {
  assert.equal(shouldSummonHumanReview({ label: PASS, isMachinery: true }), true);
});

test('shouldSummonHumanReview: NORMAL (non-machinery) ai-review:changes → NO summon at t=0 (#816 retirement)', () => {
  // The core of #816: a normal changes verdict is auto-remediated by remediate-pr.sh
  // (bounded attempts) BEFORE a human is needed, so it must NOT be flagged here.
  // Only valid where that lane EXISTS — the caller proves it.
  assert.equal(
    shouldSummonHumanReview({ label: CHANGES, isMachinery: false, remediationAvailable: true }),
    false,
  );
});

test('shouldSummonHumanReview: NORMAL ai-review:changes with NO remediation lane → summon (the retirement has no delegate)', () => {
  // The #816 retirement delegates to remediate-pr.sh. A consuming repo that has
  // not adopted the dispatch lane has no such script, so retiring the eager
  // summon there routes a flagged PR to NOBODY — not remediated, not escalated.
  // Merge safety is unaffected (ready-to-merge holds red independently); the
  // loss is liveness, and a silently abandoned PR is exactly what this prevents.
  assert.equal(
    shouldSummonHumanReview({ label: CHANGES, isMachinery: false, remediationAvailable: false }),
    true,
  );
});

test('shouldSummonHumanReview: remediation availability is deny-by-default (unproven ⇒ summon)', () => {
  // A caller that does not pass the flag must fail SAFE — keeping the human
  // backstop — rather than silently inheriting the retirement. Anything that is
  // not an explicit `true` counts as unproven.
  assert.equal(shouldSummonHumanReview({ label: CHANGES, isMachinery: false }), true);
  assert.equal(
    shouldSummonHumanReview({ label: CHANGES, isMachinery: false, remediationAvailable: undefined }),
    true,
  );
  assert.equal(
    shouldSummonHumanReview({ label: CHANGES, isMachinery: false, remediationAvailable: 'true' }),
    true,
  );
});

test('shouldSummonHumanReview: remediation availability never overrides the blocked rule', () => {
  // A blocked verdict is retry-able regardless of whether the lane exists.
  assert.equal(
    shouldSummonHumanReview({ label: BLOCKED, isMachinery: false, remediationAvailable: false }),
    false,
  );
});

test('shouldSummonHumanReview: a passing PR never summons, lane or no lane', () => {
  assert.equal(
    shouldSummonHumanReview({ label: PASS, isMachinery: false, remediationAvailable: false }),
    false,
  );
});

test('shouldSummonHumanReview: NORMAL passing PR → NO summon (belongs in awaiting-approval)', () => {
  assert.equal(shouldSummonHumanReview({ label: PASS, isMachinery: false }), false);
});

test('shouldSummonHumanReview: ai-review:blocked → NEVER summon (retry-able quota, both machinery states)', () => {
  // A blocked verdict means the reviewer could not RUN — retry-able, not a code
  // verdict; ai-review-retry re-runs it. It must never pull in a human, even for
  // a machinery PR (whose merge is still held by machinery-review-required).
  assert.equal(shouldSummonHumanReview({ label: BLOCKED, isMachinery: false }), false);
  assert.equal(shouldSummonHumanReview({ label: BLOCKED, isMachinery: true }), false);
});

test('shouldSummonHumanReview: deny-by-default on missing/garbage input (advisory not applied; gate still holds)', () => {
  assert.equal(shouldSummonHumanReview({}), false);
  assert.equal(shouldSummonHumanReview(), false);
  assert.equal(shouldSummonHumanReview({ label: 'nonsense', isMachinery: false }), false);
});

// Invariant (SPEC-031 INV-8 spirit): `awaiting-approval` and `needs-human-review`
// are mutually exclusive BY CONSTRUCTION. A passing non-machinery PR is the human's
// turn via awaiting-approval and is NOT summoned here; a machinery pass is summoned
// here and — its ready-to-merge held red (no SHA-bound witness) — never awaits.
test('#816 invariant: passing non-machinery PR → awaiting-approval, NOT needs-human-review', () => {
  const green = decideStatus({ labels: [PASS], passProvenance: VERIFIED_PROV });
  assert.equal(green.state, 'success');
  assert.equal(shouldAwaitApproval({ statusState: green.state, autoMergeArmed: false }), true);
  assert.equal(shouldSummonHumanReview({ label: PASS, isMachinery: false }), false);
});

test('#816 invariant: machinery pass → needs-human-review, and ready-to-merge held red so NOT awaiting-approval', () => {
  // A machinery PR posts no SHA-bound pass witness (#596), so decideStatus stays red
  // even with a provenance-verified label → shouldAwaitApproval is false, while the
  // human IS summoned. The two signals never coexist.
  const held = decideStatus({
    labels: [PASS],
    passProvenance: VERIFIED_PROV,
    headStatus: { verified: false, reason: 'machinery PR posts no ai-review/pass witness' },
  });
  assert.equal(held.state, 'failure');
  assert.equal(shouldAwaitApproval({ statusState: held.state, autoMergeArmed: false }), false);
  assert.equal(shouldSummonHumanReview({ label: PASS, isMachinery: true }), true);
});

// ─── #1247 — blocked-by: a PR waiting on an open dependency is nobody's turn ───

test('parseBlockedBy: recognises the plain declaration', () => {
  assert.deepEqual(parseBlockedBy('Blocked by #1225'), [1225]);
});

test('parseBlockedBy: colon, several refs on one line, and markdown decoration', () => {
  assert.deepEqual(parseBlockedBy('Blocked by: #1225, #1179'), [1179, 1225]);
  assert.deepEqual(parseBlockedBy('- **Blocked by** #1225'), [1225]);
  assert.deepEqual(parseBlockedBy('> blocked by #7'), [7]);
});

test('parseBlockedBy: de-duplicates and sorts numerically, not lexically', () => {
  // Lexical sort would give [1225, 7, 90]; the numeric order is the readable one.
  assert.deepEqual(parseBlockedBy('Blocked by #90\nBlocked by #7, #1225, #90'), [7, 90, 1225]);
});

test('parseBlockedBy: empty for no declaration, null, undefined, or empty body', () => {
  assert.deepEqual(parseBlockedBy('Just an ordinary PR body mentioning #1225.'), []);
  assert.deepEqual(parseBlockedBy(null), []);
  assert.deepEqual(parseBlockedBy(undefined), []);
  assert.deepEqual(parseBlockedBy(''), []);
});

test('parseBlockedBy: PROSE never mints the label (the false-positive that would park a mergeable PR)', () => {
  // Each of these contains both the words and a #ref, but none is a declaration.
  assert.deepEqual(parseBlockedBy('The deploy was blocked by a stale cache; see #1225.'), []);
  assert.deepEqual(parseBlockedBy('#1225 was blocked by design.'), []);
  assert.deepEqual(parseBlockedBy('Previously this got blocked by CI (#99) but no longer.'), []);
});

test('parseBlockedBy: a ref on a LATER line is not swept into an earlier declaration', () => {
  assert.deepEqual(parseBlockedBy('Blocked by #1225\n\nAlso relates to #4242.'), [1225]);
});

// minspec#2134 — BLOCKED_BY_LINE_RE catastrophic backtracking. FOUR distinct
// mechanisms were found across three rounds of hardening (see the full writeup on
// BLOCKED_BY_LINE_RE's definition in ai-review-guard.js — this comment only
// carries the input shapes and budgets):
//   1. `*` overlapped BOTH the leading class `[\s>*_-]*` and the adjacent `\**`.
//   2. Round 1's fix left `\s` overlapping the leading class and the `\s*` right
//      after `\**` — found in review of round 1, NOT by round 1's own test, which
//      exercised only the asterisk alphabet and could not have told "closed" apart
//      from "one of two vectors closed".
//   3. Found while fixing #2: `\s` matches line terminators, and the `m` flag
//      makes `^` succeed after every one — so an all-newline body gives the engine
//      O(n) valid anchor points, each doing unbounded work.
//   4. Found in review of round 2 (by the ai-review panel's security voter, not by
//      rounds 1-2's own tests, which varied the alphabet before "blocked by" but
//      not after it): the SAME shape as mechanism 2, one region over — `\s*:?\s*`
//      right after "blocked by" has two `\s`-matching quantifiers with only the
//      nullable `:?` between them.
//
// All four get their own test below for exactly the reason #2 exists at all:
// `parseBlockedBy` returns the identical CORRECT answer ([]) under every
// vulnerable variant and the final fix — the bug is purely a wall-clock hazard,
// so a correctness-only assertion is not evidence of anything. Each budget is set
// with a wide margin on both sides so a loaded CI runner cannot make it flaky: the
// fixed pattern measures well under 1ms on every one of these inputs, while the
// pattern committed for the PREVIOUS round of this fix (mutation-tested by
// temporarily restoring it) measured multiple SECONDS on every one of them —
// orders of magnitude past the budget, not a coin-flip 2x that noise could erase.
function timeParseBlockedBy(body) {
  const start = process.hrtime.bigint();
  const result = parseBlockedBy(body);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, elapsedMs };
}

test('parseBlockedBy: a pathological run of leading asterisks does not cause catastrophic backtracking (ReDoS, minspec#2134, mechanism 1)', () => {
  const n = 40000; // ~40KB — comfortably inside GitHub's ~65KB PR body cap
  const body = `Normal preamble line.\n${'*'.repeat(n)}`;
  const budgetMs = 300; // fixed: <1ms measured. Previous-round pattern: ~4000ms measured.

  const { result, elapsedMs } = timeParseBlockedBy(body);
  // No declaration in this body, so the correct answer is the empty array either
  // way — it is the TIMING assertion below that distinguishes fixed from vulnerable.
  assert.deepEqual(result, []);
  assert.ok(
    elapsedMs < budgetMs,
    `parseBlockedBy took ${elapsedMs.toFixed(1)}ms on a crafted input (budget ${budgetMs}ms) — ` +
      'this is the catastrophic-backtracking signature of BLOCKED_BY_LINE_RE regressing to ' +
      'minspec#2134 mechanism 1 (`*` overlapping the leading class and `\\**`), not a slow CI runner',
  );
});

test('parseBlockedBy: a pathological run of leading whitespace does not cause catastrophic backtracking (ReDoS, minspec#2134, mechanism 2)', () => {
  const n = 60000; // ~60KB — comfortably inside GitHub's ~65KB PR body cap
  // Mixed spaces/tabs, not a single repeated character, so the fixture can't be
  // read as accidentally exercising mechanism 1 instead.
  const whitespace = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? ' ' : '\t')).join('');
  const body = `Normal preamble line.\n${whitespace}`;
  const budgetMs = 300; // fixed: <1ms measured. Round-1 pattern: ~4050ms measured.

  const { result, elapsedMs } = timeParseBlockedBy(body);
  assert.deepEqual(result, []);
  assert.ok(
    elapsedMs < budgetMs,
    `parseBlockedBy took ${elapsedMs.toFixed(1)}ms on a crafted input (budget ${budgetMs}ms) — ` +
      'this is the catastrophic-backtracking signature of BLOCKED_BY_LINE_RE regressing to ' +
      'minspec#2134 mechanism 2 (`\\s` overlapping the leading class and the `\\s*` after `\\**`), ' +
      'not a slow CI runner',
  );
});

test('parseBlockedBy: a pathological run of leading newlines does not cause catastrophic backtracking (ReDoS, minspec#2134, mechanism 3)', () => {
  // Far fewer repeats needed here: every repeat is BOTH a matchable character
  // AND a fresh `^` anchor point under the `m` flag, so the round-1 pattern's
  // blowup compounds much faster per byte than mechanisms 1 or 2 did.
  const n = 2000;
  const body = `Normal preamble line.\n${'\n'.repeat(n)}`;
  const budgetMs = 300; // fixed: <1ms measured. Round-1 pattern: ~3000ms measured at this SAME n.

  const { result, elapsedMs } = timeParseBlockedBy(body);
  assert.deepEqual(result, []);
  assert.ok(
    elapsedMs < budgetMs,
    `parseBlockedBy took ${elapsedMs.toFixed(1)}ms on a crafted input (budget ${budgetMs}ms) — ` +
      'this is the catastrophic-backtracking signature of BLOCKED_BY_LINE_RE regressing to ' +
      'minspec#2134 mechanism 3 (an unbounded quantifier re-attempted at every multiline anchor), ' +
      'not a slow CI runner',
  );
});

test('parseBlockedBy: a pathological run of newlines AFTER "blocked by" does not cause catastrophic backtracking (ReDoS, minspec#2134, mechanism 4)', () => {
  // Unlike mechanisms 1-3, the vulnerable region here is only reachable once the
  // engine is PAST a literal "blocked by" match, so the fixture must contain that
  // literal text — decoration alone (as mechanisms 1-3 used) cannot reach it.
  const n = 40000; // ~40KB — comfortably inside GitHub's ~65KB PR body cap
  const body = `Normal preamble line.\nblocked by${'\n'.repeat(n)}`;
  const budgetMs = 300; // fixed: ~15ms measured. Round-2 pattern: ~2000ms measured.

  const { result, elapsedMs } = timeParseBlockedBy(body);
  // No ref follows the newline run, so the correct answer is the empty array
  // either way — the TIMING assertion below is what distinguishes fixed from
  // vulnerable, exactly as for mechanisms 1-3.
  assert.deepEqual(result, []);
  assert.ok(
    elapsedMs < budgetMs,
    `parseBlockedBy took ${elapsedMs.toFixed(1)}ms on a crafted input (budget ${budgetMs}ms) — ` +
      'this is the catastrophic-backtracking signature of BLOCKED_BY_LINE_RE regressing to ' +
      'minspec#2134 mechanism 4 (`\\s` overlapping across the nullable `:?` right after ' +
      '"blocked by"), not a slow CI runner',
  );
});

test('shouldMarkBlockedBy: true only when a blocker is still open', () => {
  assert.equal(shouldMarkBlockedBy({ openBlockers: [1225] }), true);
  assert.equal(shouldMarkBlockedBy({ openBlockers: [] }), false);
  assert.equal(shouldMarkBlockedBy({}), false);
  assert.equal(shouldMarkBlockedBy(), false);
});

test('#1247: an open blocker beats a green gate — NOT your turn', () => {
  assert.equal(
    shouldAwaitApproval({ statusState: 'success', autoMergeArmed: false, openBlockers: [1225] }),
    false,
  );
});

test('#1247: a CLOSED blocker restores the your-turn signal', () => {
  // The workflow passes only the still-open subset, so a resolved blocker is simply absent.
  assert.equal(
    shouldAwaitApproval({ statusState: 'success', autoMergeArmed: false, openBlockers: [] }),
    true,
  );
});

test('#1247: a draft is never your turn to merge, however green the gate', () => {
  assert.equal(
    shouldAwaitApproval({ statusState: 'success', autoMergeArmed: false, isDraft: true }),
    false,
  );
});

test('#1247: the two labels are mutually exclusive by construction', () => {
  // One decision function drives both, so no PR can ever carry blocked-by AND
  // awaiting-approval — the contradiction the queue must never show.
  for (const openBlockers of [[], [1225], [1225, 1179]]) {
    const args = { statusState: 'success', autoMergeArmed: false, openBlockers };
    assert.equal(shouldAwaitApproval(args) && shouldMarkBlockedBy(args), false);
  }
});

test('#1247: existing callers that pass neither new field keep their old behaviour', () => {
  // Back-compat guard — ready-to-merge.yml is not the only reader over time.
  assert.equal(shouldAwaitApproval({ statusState: 'success', autoMergeArmed: false }), true);
  assert.equal(shouldAwaitApproval({ statusState: 'failure', autoMergeArmed: false }), false);
});

test('#1247: BLOCKED_BY is distinct from the reviewer-transient ai-review:blocked', () => {
  assert.notEqual(BLOCKED_BY, BLOCKED);
  assert.equal(BLOCKED_BY, 'blocked-by');
  assert.equal(BLOCKED, 'ai-review:blocked');
});

test('parseBlockedBy: a trailing explanation on the SAME line cannot smuggle in a ref', () => {
  // The exact line that exposed this — written by hand against the first revision,
  // which returned [1225, 1246] because it scanned the whole line.
  const body =
    'Blocked by #1225 — FR-8 cannot be implemented until the standing-consent store ' +
    'is settled (DR-078, merged as `proposed` in #1246, awaiting *Accept ADR*).';
  assert.deepEqual(parseBlockedBy(body), [1225]);
});

test('parseBlockedBy: multiple refs still work before an explanation', () => {
  assert.deepEqual(parseBlockedBy('Blocked by #7, #9 and #11 — see the thread on #4242.'), [7, 9, 11]);
  assert.deepEqual(parseBlockedBy('Blocked by: #7, #9'), [7, 9]);
});

test('parseBlockedBy: a declaration with NO leading ref yields nothing', () => {
  // "Blocked by the release freeze (see #1225)" is prose, not a declaration.
  assert.deepEqual(parseBlockedBy('Blocked by the release freeze (see #1225).'), []);
});

// ── verdict-label coherence (#1468) ──────────────────────────────────────────
// The PR's label set is the merge gate's INPUT, so the property that matters is
// not "the removal calls were issued" but "the PR now asserts exactly one
// verdict". #1430 carried ai-review:pass AND ai-review:changes at once and
// ready-to-merge withheld forever, with nothing on the PR explaining why.
const guard = require('./ai-review-guard.js');

test('decideVerdictLabels: changes → pass removes the stale opposite verdict', () => {
  // The exact #1430 shape: round 1 left `changes`, round 2 decided `pass`.
  const d = guard.decideVerdictLabels({
    current: ['ai-review:changes', 'docs-lane'],
    verdict: 'ai-review:pass',
  });
  assert.deepEqual(d.remove, ['ai-review:changes']);
  assert.deepEqual(d.add, ['ai-review:pass']);
  assert.deepEqual(d.expected, ['ai-review:pass']);
});

test('decideVerdictLabels: clears pending too, and never touches other labels', () => {
  const d = guard.decideVerdictLabels({
    current: ['ai-review:pending', 'ai-review:blocked', 'docs-lane', 'needs-human-review'],
    verdict: 'ai-review:changes',
  });
  assert.deepEqual(d.remove.sort(), ['ai-review:blocked', 'ai-review:pending']);
  // Non-verdict labels are outside this function's remit entirely.
  assert.ok(!JSON.stringify(d).includes('docs-lane'));
  assert.ok(!JSON.stringify(d).includes('needs-human-review'));
});

test('decideVerdictLabels: re-running on an already-correct PR is a no-op', () => {
  const d = guard.decideVerdictLabels({ current: ['ai-review:pass'], verdict: 'ai-review:pass' });
  assert.deepEqual(d.remove, []);
  assert.deepEqual(d.add, []);
});

test('decideVerdictLabels: an unknown verdict throws rather than guessing', () => {
  assert.throws(() => guard.decideVerdictLabels({ current: [], verdict: 'ai-review:maybe' }));
});

test('verdictLabelFault: contradictory labels are a fault, and it names both', () => {
  const f = guard.verdictLabelFault({
    current: ['ai-review:pass', 'ai-review:changes', 'docs-lane'],
    verdict: 'ai-review:pass',
  });
  assert.ok(f, 'two verdicts at once must be reported');
  assert.match(f, /ai-review:changes/);
  assert.match(f, /ai-review:pass/);
});

test('verdictLabelFault: a missing verdict label is a fault', () => {
  const f = guard.verdictLabelFault({ current: ['docs-lane'], verdict: 'ai-review:pass' });
  assert.match(f, /no verdict label/);
});

test('verdictLabelFault: the WRONG single verdict is a fault', () => {
  const f = guard.verdictLabelFault({ current: ['ai-review:changes'], verdict: 'ai-review:pass' });
  assert.ok(f);
});

test('verdictLabelFault: exactly the decided verdict is clean', () => {
  assert.equal(
    guard.verdictLabelFault({
      current: ['ai-review:pass', 'docs-lane', 'needs-human-review'],
      verdict: 'ai-review:pass',
    }),
    null,
  );
});

// ─── #1204: the stated reset time must be extracted, not discarded ───────────
// The retry polled blindly because nothing parsed "resets <time>". On PR #1602
// that cost six attempts over 4h21m, five futile. `nowMs` is injected so these
// are deterministic across DST.
{
  const { parseResetInstant } = require('./ai-review-guard.js');

  // 2026-08-19T10:32:32Z — the real instant #1602 was blocked at.
  const BLOCKED_AT = Date.parse('2026-08-19T10:32:32Z');

  test('parseResetInstant: the real #1602 string resolves to the NEXT 12:50am Sydney', () => {
    const out = parseResetInstant(
      "You've hit your session limit · resets 12:50am (Australia/Sydney)",
      BLOCKED_AT,
    );
    // 12:50am Sydney on 2026-08-20 is 14:50Z on 2026-08-19 (UTC+10, no DST in August).
    assert.equal(out, '2026-08-19T14:50:00.000Z');
    assert.ok(Date.parse(out) > BLOCKED_AT, 'a stated reset is always in the future');
  });

  test('parseResetInstant: UTC form from the #1190 evidence', () => {
    const out = parseResetInstant('quota exhausted, resets 8:40am (UTC)', Date.parse('2026-08-05T08:25:00Z'));
    assert.equal(out, '2026-08-05T08:40:00.000Z');
  });

  test('parseResetInstant: a time already past today rolls to tomorrow', () => {
    // 08:40 UTC seen at 20:00 UTC must mean tomorrow, not 11h ago.
    const out = parseResetInstant('resets 8:40am (UTC)', Date.parse('2026-08-05T20:00:00Z'));
    assert.equal(out, '2026-08-06T08:40:00.000Z');
  });

  test('parseResetInstant: relative form needs no timezone', () => {
    const out = parseResetInstant('rate limited, try again in 25 minutes', Date.parse('2026-08-05T10:00:00Z'));
    assert.equal(out, '2026-08-05T10:25:00.000Z');
  });

  test('parseResetInstant: 12-hour meridiem edges', () => {
    assert.equal(parseResetInstant('resets 12:00am (UTC)', Date.parse('2026-08-05T10:00:00Z')),
      '2026-08-06T00:00:00.000Z');
    assert.equal(parseResetInstant('resets 12:30pm (UTC)', Date.parse('2026-08-05T10:00:00Z')),
      '2026-08-05T12:30:00.000Z');
  });

  test('parseResetInstant: no zone stated → null, never a guess', () => {
    // Guessing the runner's zone would silently anchor the window to the wrong
    // place; null means "retry on the normal cadence", which is safe.
    assert.equal(parseResetInstant('resets 8:40am', BLOCKED_AT), null);
  });

  test('parseResetInstant: unparseable / absent / bad zone → null, never throws', () => {
    assert.equal(parseResetInstant('some unrelated failure', BLOCKED_AT), null);
    assert.equal(parseResetInstant('', BLOCKED_AT), null);
    assert.equal(parseResetInstant(null, BLOCKED_AT), null);
    assert.equal(parseResetInstant('resets 8:40am (Not/AZone)', BLOCKED_AT), null);
    assert.equal(parseResetInstant('resets 99:99am (UTC)', BLOCKED_AT), null);
  });

  test('parseResetInstant: a non-finite now is refused rather than producing garbage', () => {
    assert.equal(parseResetInstant('resets 8:40am (UTC)', NaN), null);
  });
}

// ─── #1728: patch-fingerprint re-attestation ────────────────────────────────
// Under `strict` a forward-merge leaves the three-dot patch byte-identical but
// re-triggers a full four-voter review. These pin that a re-attestation is only
// ever offered under the SAME provenance strictness as the witness itself.
{
  const {
    patchFingerprint, renderPatchFingerprint, parsePatchFingerprint,
    findReattestableVerdict, CHECK_NAME,
  } = require('./ai-review-guard.js');

  const ALLOW = ['minspec-sdd', 'minspec-sdd[bot]'];
  const PATCH = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
  const fp = patchFingerprint(PATCH);
  const run = (o = {}) => ({
    name: CHECK_NAME, status: 'completed', conclusion: 'success',
    head_sha: 'aaaaaaaaaaaa', app: { slug: 'minspec-sdd' },
    output: { title: 'ok', summary: renderPatchFingerprint(fp) }, ...o,
  });

  test('patchFingerprint: stable, and ignores only cosmetic trailing whitespace', () => {
    assert.equal(patchFingerprint(PATCH), patchFingerprint(PATCH.replace(/\n$/, '\n\n')));
    assert.equal(patchFingerprint(PATCH), patchFingerprint(PATCH.replace(/\n/g, '\r\n')));
  });

  test('patchFingerprint: any real content change changes the digest', () => {
    assert.notEqual(patchFingerprint(PATCH), patchFingerprint(PATCH.replace('+b', '+c')));
  });

  test('patchFingerprint: an EMPTY patch is never fingerprinted (never re-attestable)', () => {
    // An empty diff is #1680's case and must go nowhere near this path.
    assert.equal(patchFingerprint(''), null);
    assert.equal(patchFingerprint(null), null);
    assert.equal(findReattestableVerdict({ checkRuns: [run()], patchHash: null, allowlist: ALLOW }).ok, false);
  });

  test('THE #1728 CASE: an unchanged patch re-attests from the prior SHA', () => {
    const r = findReattestableVerdict({ checkRuns: [run()], patchHash: fp, allowlist: ALLOW });
    assert.equal(r.ok, true);
    assert.equal(r.sourceSha, 'aaaaaaaaaaaa');
  });

  test('a DIFFERENT patch never re-attests', () => {
    const other = patchFingerprint(PATCH.replace('+b', '+c'));
    assert.equal(findReattestableVerdict({ checkRuns: [run()], patchHash: other, allowlist: ALLOW }).ok, false);
  });

  // Provenance: the same strictness as the witness. A softer door here would be a
  // second, weaker entrance to the same gate.
  test('refuses a non-success, non-completed, or wrong-named prior run', () => {
    for (const bad of [{ conclusion: 'failure' }, { conclusion: 'neutral' }, { status: 'in_progress' }, { name: 'other' }]) {
      assert.equal(findReattestableVerdict({ checkRuns: [run(bad)], patchHash: fp, allowlist: ALLOW }).ok, false);
    }
  });

  test('refuses a run posted by an app OUTSIDE the allowlist', () => {
    const impostor = run({ app: { slug: 'somebody-else' } });
    assert.equal(findReattestableVerdict({ checkRuns: [impostor], patchHash: fp, allowlist: ALLOW }).ok, false);
  });

  test('refuses when the allowlist is empty — never re-attest with no trusted producer', () => {
    assert.equal(findReattestableVerdict({ checkRuns: [run()], patchHash: fp, allowlist: [] }).ok, false);
    assert.equal(findReattestableVerdict({ checkRuns: [run()], patchHash: fp }).ok, false);
  });

  test('fails safe on missing/garbage input rather than throwing', () => {
    for (const bad of [undefined, {}, { checkRuns: null, patchHash: fp, allowlist: ALLOW }, { checkRuns: [null], patchHash: fp, allowlist: ALLOW }]) {
      assert.equal(findReattestableVerdict(bad).ok, false);
    }
  });

  test('the fingerprint round-trips through the check-run output text', () => {
    assert.equal(parsePatchFingerprint(renderPatchFingerprint(fp)), fp);
    assert.equal(parsePatchFingerprint('no marker here'), null);
    assert.equal(parsePatchFingerprint('patch-fingerprint:short'), null);
  });
}

// ─── #1839 / #1925: the check-run step must survive an OLDER base guard ─────
// The `ai-review` check-run step runs from the PR HEAD (`on: pull_request`) but
// requires ai-review-guard.js from the BASE checkout. So a PR that adds a guard
// export AND calls it from the workflow runs its new YAML against the OLD module.
// #1839 called `g.patchFingerprint` unguarded: against main's guard it threw
// `TypeError: g.patchFingerprint is not a function`, the step's
// `if ! node …; then exit 0` swallowed it, the job went green, and the REQUIRED
// check-run was never posted. The fingerprint marker is optional; the check-run
// is not.
//
// These EXECUTE the step's shipped `run:` block, lifted out of the YAML rather
// than re-typed here, so the rule under test is the shipped seam. `gh` is a PATH
// stub that records what would be POSTed; `bash`, `node`, `git` and the guard's
// decideReviewCheck are real. The guard at $GITHUB_WORKSPACE is a stub so each
// case can model a different base.
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');

  const WORKFLOW = path.join(__dirname, '..', 'workflows', 'ai-review.yml');
  const REAL_GUARD = path.join(__dirname, 'ai-review-guard.js');
  const real = require('./ai-review-guard.js');
  const STEP_NAME = '- name: Post honest `ai-review` verdict check-run as minspec-sdd[bot]';
  const NOT_POSTED = 'title=ai-review check not posted';

  // Every export #1728 added. A base that predates #1728 has none of them.
  const ADDED_BY_1728 = [
    'patchFingerprint', 'renderPatchFingerprint', 'parsePatchFingerprint',
    'findReattestableVerdict', 'PATCH_FINGERPRINT_PREFIX',
  ];

  const indentOf = (l) => l.length - l.trimStart().length;

  /** The check-run step's `run: |` block scalar, dedented exactly as Actions runs it. */
  function stepRunBlock() {
    const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
    const nameAt = lines.findIndex((l) => l.trim() === STEP_NAME);
    if (nameAt < 0) {
      throw new Error(`step "${STEP_NAME}" is missing from ${WORKFLOW}; the block this test guards was renamed or removed, so its behaviour is unverified`);
    }
    const stepIndent = indentOf(lines[nameAt]);
    let runAt = -1;
    for (let i = nameAt + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue;
      if (indentOf(lines[i]) <= stepIndent) break; // reached the next step
      if (lines[i].trim() === 'run: |') { runAt = i; break; }
    }
    if (runAt < 0) throw new Error('the check-run step has no `run: |` block');
    const keyIndent = indentOf(lines[runAt]);
    const body = [];
    let blockIndent = -1;
    for (let i = runAt + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') { body.push(''); continue; }
      if (indentOf(l) <= keyIndent) break;
      if (blockIndent < 0) blockIndent = indentOf(l);
      body.push(l.slice(blockIndent));
    }
    while (body.length && body[body.length - 1] === '') body.pop(); // `|` clips trailing blanks
    const script = `${body.join('\n')}\n`;
    // This harness runs the block as plain bash, so an Actions expression would reach
    // it unevaluated. Fail loudly rather than test something the runner never runs.
    if (script.includes('${{')) throw new Error('the check-run run block now contains an Actions expression; extend this harness to substitute it');
    if (!script.includes('check-runs')) throw new Error('extracted run block does not post a check-run; the extractor picked up the wrong block');
    return script;
  }

  /** Records every call, and keeps a copy of any `--input` file (the POSTed body). */
  const GH_STUB = `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$GH_STUB_DIR/calls.log"
prev=""
for a in "$@"; do
  if [ "$prev" = "--input" ]; then cp "$a" "$GH_STUB_DIR/posted.json"; fi
  prev="$a"
done
exit 0
`;

  /**
   * Run the step once. `guardSource` becomes $GITHUB_WORKSPACE/.github/scripts/ai-review-guard.js.
   * The workspace is a real git repo with a base and a head commit, so the step's own
   * `git diff base...head` produces a real, non-empty three-dot patch.
   */
  function runStep(guardSource, { verdict = 'ai-review:pass', machinery = 'false' } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-checkrun-'));
    try {
      const ws = path.join(tmp, 'ws');
      const bin = path.join(tmp, 'bin');
      const ghDir = path.join(tmp, 'gh');
      const runnerTemp = path.join(tmp, 'runner');
      for (const d of [ws, bin, ghDir, runnerTemp]) fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });

      // HOME points into tmp so no user/system git config leaks into the fixture.
      const baseEnv = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: tmp, GIT_CONFIG_NOSYSTEM: '1' };
      const git = (...args) => {
        const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: ws, env: baseEnv, encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
        return r.stdout;
      };
      git('init', '-q');
      fs.writeFileSync(path.join(ws, 'x.txt'), 'a\n');
      git('add', 'x.txt');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD').trim();
      fs.writeFileSync(path.join(ws, 'x.txt'), 'b\n');
      git('commit', '-q', '-am', 'head');
      const head = git('rev-parse', 'HEAD').trim();
      const patch = git('diff', `${base}...${head}`);
      assert.ok(patch.includes('+b'), 'fixture must yield a non-empty three-dot patch');

      // Untracked, so it cannot change the commit-to-commit diff above.
      fs.mkdirSync(path.join(ws, '.github', 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(ws, '.github', 'scripts', 'ai-review-guard.js'), guardSource);

      const stepFile = path.join(tmp, 'step.sh');
      fs.writeFileSync(stepFile, stepRunBlock());
      // `bash -e {0}` is what Actions runs a `run:` with no `shell:` under.
      const r = spawnSync('bash', ['-e', stepFile], {
        cwd: ws,
        encoding: 'utf8',
        env: {
          ...baseEnv,
          GH_STUB_DIR: ghDir,
          GITHUB_WORKSPACE: ws,
          RUNNER_TEMP: runnerTemp,
          GH_TOKEN: 'stub-token',
          REPO: 'o/r',
          HEAD_SHA: head,
          VERDICT_LABEL: verdict,
          IS_MACHINERY: machinery,
          PR_BASE_SHA: base,
          PR_HEAD_SHA: head,
        },
      });
      const postedFile = path.join(ghDir, 'posted.json');
      const callsFile = path.join(ghDir, 'calls.log');
      return {
        status: r.status,
        stdout: r.stdout,
        stderr: r.stderr,
        head,
        patch,
        calls: fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8') : '',
        posted: fs.existsSync(postedFile) ? JSON.parse(fs.readFileSync(postedFile, 'utf8')) : null,
      };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  const reexport = (body) => `'use strict';\nconst real = require(${JSON.stringify(REAL_GUARD)});\n${body}\n`;
  const PRE_1728_GUARD = reexport(`const m = { ...real };\nfor (const k of ${JSON.stringify(ADDED_BY_1728)}) delete m[k];\nmodule.exports = m;`);
  const CURRENT_GUARD = reexport('module.exports = real;');

  /** The step posted exactly one check-run, carrying decideReviewCheck's verdict. */
  function assertPosted(res, verdict, machinery) {
    const c = real.decideReviewCheck(verdict, machinery === 'true');
    assert.equal(res.status, 0, `step exited ${res.status}: ${res.stderr}`);
    assert.ok(!res.stdout.includes(NOT_POSTED), `the check-run was not posted:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.calls, /^api -X POST repos\/o\/r\/check-runs --input /m, 'gh was never asked to POST the check-run');
    assert.ok(res.posted, 'no check-run body reached gh');
    assert.equal(res.posted.name, c.name);
    assert.equal(res.posted.head_sha, res.head);
    assert.equal(res.posted.status, 'completed');
    assert.equal(res.posted.conclusion, c.conclusion);
    assert.equal(res.posted.output.title, c.title);
    return c;
  }

  /** Evaluate a stub guard source in-process, to check what it exports. */
  function stubExports(source) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-stub-'));
    try {
      const file = path.join(dir, 'ai-review-guard.js');
      fs.writeFileSync(file, source);
      return Object.keys(require(file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('T3 #1925: a base guard that predates #1728 still gets the check-run POSTED, just without the marker', () => {
    // Sanity: the stub models main's guard. It keeps decideReviewCheck and everything
    // else, and lacks every export #1728 added (each of which the real guard has).
    const keys = stubExports(PRE_1728_GUARD);
    assert.ok(keys.includes('decideReviewCheck'));
    for (const k of ADDED_BY_1728) {
      assert.ok(k in real, `${k} is no longer exported by the guard; update ADDED_BY_1728`);
      assert.ok(!keys.includes(k), `the pre-#1728 stub still exports ${k}`);
    }
    for (const [verdict, machinery] of [['ai-review:pass', 'false'], ['ai-review:changes', 'false'], ['ai-review:pass', 'true']]) {
      const res = runStep(PRE_1728_GUARD, { verdict, machinery });
      const c = assertPosted(res, verdict, machinery);
      // The marker is simply absent: the summary is decideReviewCheck's, byte for byte.
      assert.equal(res.posted.output.summary, c.summary);
      assert.ok(!res.posted.output.summary.includes('patch-fingerprint:'));
      // Detected up front, not discovered by calling a non-function and catching it.
      assert.doesNotMatch(res.stderr, /TypeError/);
    }
  });

  test('#1728 invariant: a base guard WITH the helpers still records the marker exactly as intended', () => {
    const res = runStep(CURRENT_GUARD);
    const c = assertPosted(res, 'ai-review:pass', 'false');
    const fp = real.patchFingerprint(res.patch);
    assert.ok(fp, 'the fixture patch must fingerprint');
    assert.equal(res.posted.output.summary, `${c.summary}\n\n${real.renderPatchFingerprint(fp)}`);
    assert.equal(real.parsePatchFingerprint(res.posted.output.summary), fp);
  });

  test('#1925: a half-present pair (patchFingerprint without renderPatchFingerprint) posts without a marker', () => {
    const half = reexport('const m = { ...real };\ndelete m.renderPatchFingerprint;\nmodule.exports = m;');
    const res = runStep(half);
    const c = assertPosted(res, 'ai-review:pass', 'false');
    assert.equal(res.posted.output.summary, c.summary);
    // BOTH helpers are feature-detected; the missing one is never called and caught.
    assert.doesNotMatch(res.stderr, /TypeError/);
  });

  test('#1925: a fingerprint helper that THROWS degrades to no marker, never to no check-run', () => {
    const throwing = reexport('module.exports = { ...real, patchFingerprint() { throw new Error("boom"); } };');
    const res = runStep(throwing, { verdict: 'ai-review:changes' });
    const c = assertPosted(res, 'ai-review:changes', 'false');
    assert.equal(res.posted.output.summary, c.summary);
  });
}

// ── #1870 — a `hold:*` label is an INDEPENDENT second witness for the human hold ──
// docs-lane refuses to arm auto-merge on a hold, but it was the only thing doing so:
// if that job does not run (permissions gap, cancelled run, or the `docs-lane` label
// removed, which makes its own `if:` guard false) an earlier arming still stands.
// `ready-to-merge` is a different workflow, required by branch protection, evaluated
// on every PR event — constitution invariant 2's "independent second witness".

test('decideStatus: hold:human turns an otherwise-green gate RED', () => {
  const green = decideStatus({ labels: [PASS, 'feat'], passProvenance: VERIFIED });
  assert.equal(green.state, 'success', 'control: same PR without a hold is green');

  const s = decideStatus({ labels: [PASS, 'feat', 'hold:human'], passProvenance: VERIFIED });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /hold:human/);
});

test('decideStatus: ANY hold:* holds, not just hold:human', () => {
  const s = decideStatus({ labels: [PASS, 'hold:legal'], passProvenance: VERIFIED });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /hold:legal/);
});

test('decideStatus: the hold predicate is ANCHORED — a label containing "hold:" mid-string does not gate', () => {
  // `household-docs` alone does NOT bind the anchor: it has no `hold:` substring, so an
  // unanchored /hold:/ would pass that test too and the mutation would survive. These
  // labels DO contain `hold:` and must still be ignored, which only an anchored
  // pattern achieves.
  for (const label of ['not-hold:human', 'xhold:legal', 'was-hold:tier', 'household-docs']) {
    const s = decideStatus({ labels: [PASS, label], passProvenance: VERIFIED });
    assert.equal(s.state, 'success', `${label} must not gate`);
  }
});

test('HOLD_RE stays lock-step with docs-lane.yml\'s hold_pattern (two gates, one predicate)', () => {
  // #1870 deliberately puts the same predicate in a SECOND gate — that is the point
  // (an independent witness). Two copies drift, so pin them to each other, the way
  // OUTWARD_DOC_PATTERN is pinned between the lane and auto-merge-gate.ts.
  const fs = require('node:fs');
  const path = require('node:path');
  const lane = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'docs-lane.yml'), 'utf8');
  const m = lane.match(/hold_pattern='([^']+)'/);
  assert.ok(m, 'docs-lane.yml must still define hold_pattern');
  assert.equal(
    HOLD_RE.source,
    m[1],
    'ready-to-merge and docs-lane must agree on what counts as a hold',
  );
});

test('decideStatus: a held PR leaves the awaiting-approval "your turn" queue', () => {
  // A hold drives statusState to 'failure', and shouldAwaitApproval keys off that, so
  // the held PR drops out of the human merge queue. That is correct and matches the
  // existing isDraft case — a PR nobody may merge is not anyone's turn to merge — but
  // it is an interaction between two functions, so pin it rather than infer it.
  const held = decideStatus({ labels: [PASS, 'hold:human'], passProvenance: VERIFIED });
  assert.equal(held.state, 'failure');
  assert.equal(
    shouldAwaitApproval({ statusState: held.state, autoMergeArmed: false, openBlockers: [], isDraft: false }),
    false,
  );

  const free = decideStatus({ labels: [PASS], passProvenance: VERIFIED });
  assert.equal(free.state, 'success', 'control: without the hold it IS the human\'s turn');
  assert.equal(
    shouldAwaitApproval({ statusState: free.state, autoMergeArmed: false, openBlockers: [], isDraft: false }),
    true,
  );
});

test('decideStatus: hold is reported ahead of a staleness strip (the unactionable-description case)', () => {
  // Both make it red. The strip says "re-review required", which a held PR can never
  // satisfy — so the hold, which is what actually blocks, must be the reported reason.
  const s = decideStatus({ labels: [PASS, 'hold:human'], stalenessStrip: true });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /hold:human/);
  assert.doesNotMatch(s.description, /re-review required/);
});

test('decideStatus: hold reported ahead of a provenance revert too', () => {
  const s = decideStatus({ labels: [PASS, 'hold:human'], provenanceRevert: true });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /hold:human/);
});

test('decideStatus: a hold holds even with NO pass at all (it is not a pass-modifier)', () => {
  const s = decideStatus({ labels: ['hold:human'] });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /hold:human/);
});

test('decideStatus: multiple holds are all named', () => {
  const s = decideStatus({ labels: [PASS, 'hold:human', 'hold:legal'], passProvenance: VERIFIED });
  assert.equal(s.state, 'failure');
  assert.match(s.description, /hold:human/);
  assert.match(s.description, /hold:legal/);
});

test('decideStatus: hold does not alter effectiveLabels (it gates, it does not strip)', () => {
  const s = decideStatus({ labels: [PASS, 'hold:human'], passProvenance: VERIFIED });
  assert.ok(s.effectiveLabels.includes('hold:human'));
  assert.ok(s.effectiveLabels.includes(PASS), 'a hold must not strip the pass label');
});

test('decideStatus: no hold present → behaviour is byte-identical to before #1870', () => {
  for (const c of [
    { labels: [PASS, 'feat'], passProvenance: VERIFIED },
    { labels: [PASS, CHANGES], passProvenance: VERIFIED },
    { labels: ['feat'] },
    { labels: [PASS], stalenessStrip: true },
    { labels: [PASS], provenanceRevert: true },
  ]) {
    const s = decideStatus(c);
    assert.doesNotMatch(s.description, /hold/, 'no hold label ⇒ no hold wording');
  }
});

// ─── #1688 — carry the last completed verdict when nothing reviewable changed ───
//
// A push that only merges the base branch in (or re-pushes the same change) leaves the
// text the voters are given byte-identical, and the panel used to re-run on it anyway.
// Measured on #2588: 25 of 154 rounds, 14.7 percent of the panel's cost, every one of
// them a pass followed by a pass.
//
// THE SEVEN INVARIANTS, each with a block below. They were written before the code:
//   1. a base-merge-only push skips the voters and carries the verdict;
//   2. ANY change in the reviewable input runs the full panel;
//   3. an earlier verdict that is missing, unreadable or from an incomplete round runs
//      the full panel (fail closed - constitution invariant 2, no silent gate);
//   4. a carried verdict is never upgraded - `changes` and `blocked` are never a source,
//      so neither can become a pass without the voters running;
//   5. identity is CONTENT - a hash of what the voters are given - never "no new
//      commits", a commit subject, the actor or the event's say-so;
//   6. the skip is visible: comment, label and check-run all say carried, from where, why;
//   7. the #359 staleness guard still voids a verdict on a real change.
//
// These are the pure decisions. The same invariants are driven against real git objects
// (a real base merge, a real force-push, a real one-line edit) in MinSpec's own
// packages/minspec/tests/ai-review-verdict-carry.test.ts, which this parity-managed file
// cannot do: it ships to repos that do not carry that suite.
{
  const g = require('./ai-review-guard.js');
  const {
    CARRIED,
    VERDICT_LABELS,
    PANEL_KEY_PATHS,
    PANEL_KEY_OPTIONAL_PATHS,
    reviewPanelKey,
    renderRoundRecord,
    parseRoundRecord,
    latestHeadRound,
    decideVerdictCarry,
    renderCarriedComment,
    planVerdictCarry,
    carriedLabelFault,
    patchFingerprint,
    VERDICT_BEGIN_TOKEN,
  } = g;

  const ALLOW = parseAllowlist('minspec-sdd[bot]');
  const P = 'a1'.repeat(20); // the previous head: where the last round ran
  const H = 'b2'.repeat(20); // the head under review now
  const P0 = 'c3'.repeat(20); // an older head, where the voters last actually ran
  const IN_A = 'a'.repeat(64);
  const IN_B = 'b'.repeat(64);
  const KEY_A = 'c'.repeat(64);
  const KEY_B = 'd'.repeat(64);

  const record = (o = {}) =>
    renderRoundRecord({ label: PASS, inputHash: IN_A, panelKey: KEY_A, reviewedSha: P, ...o });

  /** A check-run as the API returns it for a completed, passing round on P. */
  const round = (o = {}) => ({
    name: 'ai-review',
    status: 'completed',
    conclusion: 'success',
    head_sha: P,
    app: { slug: 'minspec-sdd' },
    started_at: '2026-10-01T00:00:00Z',
    completed_at: '2026-10-01T00:05:00Z',
    html_url: 'https://github.example/checks/1',
    output: { title: 'AI review: passed', summary: `The reviewer approved.\n\n${record()}`, text: '' },
    ...o,
  });

  /** The API response for a commit whose rounds are exactly `runs`: the WHOLE list. */
  const whole = (runs) => ({ total_count: runs.length, check_runs: runs });

  // `checkRuns` is shorthand for "these are ALL the rounds on the previous head". A
  // test about a listing that is short, countless or unreadable passes `listing`
  // itself, which is what the guard is actually given.
  const decide = (o = {}) => {
    const { checkRuns, ...rest } = o;
    return decideVerdictCarry({
      action: 'synchronize',
      runAttempt: '1',
      headSha: H,
      beforeSha: P,
      inputHash: IN_A,
      panelKey: KEY_A,
      listing: whole(checkRuns === undefined ? [round()] : checkRuns),
      allowlist: ALLOW,
      ...rest,
    });
  };

  test('#1688 fixture sanity: the record helper renders something, so a refusal below is never vacuous', () => {
    assert.match(record(), /^review-round:v1:pass:a{64}:c{64}:(a1){20}$/);
  });

  // ── invariant 1 ──
  test('#1688 inv 1: identical reviewable input on the previous head carries its pass, voters skipped', () => {
    const d = decide();
    assert.equal(d.carry, true, d.reason);
    assert.equal(d.label, PASS);
    assert.equal(d.fromSha, P);
    assert.equal(d.reviewedSha, P);
    assert.match(d.reason, /unchanged/);
  });

  test('#1688 inv 1: a carry chain keeps naming the commit the voters actually ran on', () => {
    // P itself was a carried round: its record says the voters ran on P0.
    const carriedRound = round({ output: { title: 't', summary: record({ reviewedSha: P0 }) } });
    const d = decide({ checkRuns: [carriedRound] });
    assert.equal(d.carry, true, d.reason);
    assert.equal(d.fromSha, P, 'carried FROM the previous head');
    assert.equal(d.reviewedSha, P0, 'but the review itself is still the one on P0');
  });

  test('#1688 inv 1: a machinery round (neutral check, pass recorded) carries its honest code verdict', () => {
    // decideReviewCheck makes every machinery round `neutral`, so the conclusion cannot
    // say what the verdict was. The record can, which is why it exists.
    const d = decide({ checkRuns: [round({ conclusion: 'neutral' })] });
    assert.equal(d.carry, true, d.reason);
    assert.equal(d.label, PASS);
  });

  // ── invariant 2 ──
  test('#1688 inv 2: ANY change in the reviewable input runs the full panel', () => {
    const d = decide({ inputHash: IN_B });
    assert.equal(d.carry, false);
    assert.equal(d.label, undefined);
    assert.match(d.reason, /changed/);
  });

  test('#1688 inv 2: a one-character edit changes the fingerprint the decision keys on', () => {
    const before = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
    const recorded = patchFingerprint(before);
    const src = round({ output: { title: 't', summary: record({ inputHash: recorded }) } });
    assert.equal(decide({ checkRuns: [src], inputHash: patchFingerprint(before) }).carry, true);
    assert.equal(decide({ checkRuns: [src], inputHash: patchFingerprint(before.replace('+b', '+B')) }).carry, false);
    // Whitespace INSIDE a line is content (Python, YAML, Makefiles). It must not be
    // normalised away, which is why the key is not `git patch-id`.
    assert.equal(decide({ checkRuns: [src], inputHash: patchFingerprint(before.replace('+b', '+ b')) }).carry, false);
  });

  test('#1688 inv 2: the reviewer changing underneath the diff also runs the full panel', () => {
    // Same diff, but the base moved the role prompts / scripts / coverage. The earlier
    // verdict came from a different reviewer.
    const d = decide({ panelKey: KEY_B });
    assert.equal(d.carry, false);
    assert.match(d.reason, /reviewer/);
  });

  // ── invariant 3 ──
  test('#1688 inv 3: no earlier round at all runs the full panel', () => {
    assert.equal(decide({ checkRuns: [] }).carry, false);
    // A round on some OTHER commit is not this pull request's previous round.
    assert.equal(decide({ checkRuns: [round({ head_sha: P0 })] }).carry, false);
  });

  test('#1688 inv 3: check-runs that could not be READ are not "no rounds" - and still run the full panel', () => {
    for (const unreadable of [
      null,
      undefined,
      'not-an-object',
      {},
      { message: 'Bad credentials' },
      { total_count: 1 }, // a count with no list
      { total_count: 1, check_runs: 'nope' },
      [round()], // a bare array: the list with its count thrown away
    ]) {
      const d = decide({ listing: unreadable });
      assert.equal(d.carry, false);
      assert.match(d.reason, /could not be read/, 'an API failure must not be reported as an absent round');
    }
    // Control: the same round in a readable listing carries, so the loop above is
    // refusing the listings and not the round.
    assert.equal(decide({ listing: whole([round()]) }).carry, true);
    // The old parameter name is not a second way in: a caller still passing a bare
    // `checkRuns` is given nothing to carry from.
    const old = decideVerdictCarry({
      action: 'synchronize',
      runAttempt: '1',
      headSha: H,
      beforeSha: P,
      inputHash: IN_A,
      panelKey: KEY_A,
      checkRuns: [round()],
      allowlist: ALLOW,
    });
    assert.equal(old.carry, false);
    assert.match(old.reason, /could not be read/);
  });

  test('#1688 inv 3: an incomplete earlier round runs the full panel', () => {
    for (const bad of [
      { status: 'in_progress', conclusion: null },
      { status: 'queued', conclusion: null },
      { conclusion: 'cancelled' },
      { conclusion: 'timed_out' },
      { conclusion: 'action_required' }, // ai-review:blocked - the reviewer could not run
      { conclusion: 'skipped' },
      { conclusion: 'stale' },
    ]) {
      const d = decide({ checkRuns: [round(bad)] });
      assert.equal(d.carry, false, `${JSON.stringify(bad)} must not be a carry source`);
    }
  });

  test('#1688 inv 3: an unreadable, truncated, duplicated or older-format record runs the full panel', () => {
    const rec = record();
    for (const summary of [
      'The reviewer approved.', // older format: no record at all
      `patch-fingerprint:${IN_A}`, // the #1728 marker alone is not a round record
      rec.slice(0, rec.length - 5), // truncated mid-SHA
      rec.replace(':v1:', ':v2:'), // a version this guard does not understand
      rec.replace(IN_A, 'z'.repeat(64)), // not hex
      `${rec}\n\n${rec}`, // two records: ambiguous
      `${rec}\n\n${record({ inputHash: IN_B })}`, // two records that disagree
      '',
    ]) {
      const d = decide({ checkRuns: [round({ output: { title: 't', summary } })] });
      assert.equal(d.carry, false, `summary ${JSON.stringify(summary.slice(0, 40))} must not carry`);
    }
    assert.equal(decide({ checkRuns: [round({ output: null })] }).carry, false);
    assert.equal(decide({ checkRuns: [round({ output: undefined })] }).carry, false);
  });

  test('#1688 inv 3: only the allowlisted reviewer App can be a carry source', () => {
    assert.equal(decide({ checkRuns: [round({ app: { slug: 'github-actions' } })] }).carry, false);
    assert.equal(decide({ checkRuns: [round({ app: null })] }).carry, false);
    assert.equal(decide({ allowlist: [] }).carry, false, 'an empty allowlist authorises nobody');
    assert.equal(decide({ allowlist: undefined }).carry, false);
    // ...and the refusal NAMES the variable. An unset allowlist makes the carry quietly
    // do nothing forever while looking wired; the run log has to say which knob it is,
    // not blame the check-run for being posted by the wrong app.
    assert.match(decide({ allowlist: [] }).reason, /AI_REVIEW_BOT_LOGINS/);
    assert.doesNotMatch(decide({ checkRuns: [round({ app: { slug: 'github-actions' } })] }).reason, /AI_REVIEW_BOT_LOGINS/);
    // Case-insensitive, like every other door into this gate (the #1840 hardening note).
    assert.equal(decide({ checkRuns: [round({ app: { slug: 'MinSpec-SDD' } })] }).carry, true);
  });

  test('#1688 inv 3: the LATEST round on the previous head decides - a later non-pass supersedes an earlier pass', () => {
    const earlierPass = round({ completed_at: '2026-10-01T00:05:00Z' });
    const laterFail = round({
      conclusion: 'failure',
      completed_at: '2026-10-01T01:00:00Z',
      output: { title: 'AI review: changes requested', summary: 'changes' },
    });
    // Order in the array must not matter: recency comes from the timestamps.
    assert.equal(decide({ checkRuns: [earlierPass, laterFail] }).carry, false);
    assert.equal(decide({ checkRuns: [laterFail, earlierPass] }).carry, false);
    // ...and the other way round: an earlier failure followed by a later pass carries.
    const earlierFail = { ...laterFail, completed_at: '2026-10-01T00:01:00Z' };
    assert.equal(decide({ checkRuns: [earlierFail, earlierPass] }).carry, true);
    assert.equal(decide({ checkRuns: [earlierPass, earlierFail] }).carry, true);
  });

  test('#1688 inv 3: a newer `ai-review` check from a NON-allowlisted app vetoes, exactly as it does for the witness', () => {
    const impostor = round({ app: { slug: 'github-actions' }, completed_at: '2026-10-01T02:00:00Z' });
    assert.equal(decide({ checkRuns: [round(), impostor] }).carry, false);
    assert.equal(decide({ checkRuns: [impostor, round()] }).carry, false);
  });

  test('#1688 inv 3: missing fingerprints or SHAs run the full panel', () => {
    for (const bad of [
      { inputHash: null },
      { inputHash: '' },
      { inputHash: 'abc' },
      { panelKey: null },
      { panelKey: '' },
      { headSha: '' },
      { headSha: 'not-a-sha' },
      { beforeSha: '' },
      { beforeSha: undefined },
      { beforeSha: '0'.repeat(40) }, // GitHub's "no previous commit" value
      { beforeSha: H }, // the previous head cannot be the head under review
    ]) {
      assert.equal(decide(bad).carry, false, `${JSON.stringify(bad)} must not carry`);
    }
    assert.equal(decideVerdictCarry().carry, false);
    assert.equal(decideVerdictCarry({}).carry, false);
    // Each refusal above must hold for its OWN reason, not because a later check
    // happens to catch it. So give each one a source that would otherwise carry.
    // A head cannot be carried from itself, even with a matching pass sitting on it:
    const onHead = round({ head_sha: H });
    assert.equal(decide({ checkRuns: [onHead] }).carry, false, 'control: a round on H is not the previous head P');
    assert.equal(decide({ beforeSha: H, checkRuns: [onHead] }).carry, false, 'previous head == head under review');
    // A missing fingerprint must not "match" a record that is also missing one. No
    // record can be, because none renders without both - which is the property:
    assert.equal(renderRoundRecord({ label: PASS, inputHash: '', panelKey: KEY_A, reviewedSha: P }), '');
    assert.equal(renderRoundRecord({ label: PASS, inputHash: IN_A, panelKey: '', reviewedSha: P }), '');
  });

  test('#1688 inv 3: only a first-attempt push can carry - opened, reopened and re-runs always review', () => {
    for (const action of ['opened', 'reopened', 'labeled', '', undefined]) {
      assert.equal(decide({ action }).carry, false, `action=${action}`);
    }
    // A re-run is somebody asking for a fresh review; it is also what ai-review-retry
    // does to a blocked round. It must never be answered with the old verdict.
    for (const runAttempt of ['2', 2, '10', '', undefined, null, 'abc', '0', '1.5', '01']) {
      assert.equal(decide({ runAttempt }).carry, false, `runAttempt=${JSON.stringify(runAttempt)}`);
    }
    assert.equal(decide({ runAttempt: 1 }).carry, true, 'numeric 1 is still a first attempt');
  });

  // ── invariant 4 ──
  test('#1688 inv 4: `changes` and `blocked` rounds are never a carry source, so a carry can never upgrade one', () => {
    const changes = round({
      conclusion: 'failure',
      output: { title: 'AI review: changes requested - this check blocks merge', summary: 'changes' },
    });
    const blocked = round({
      conclusion: 'action_required',
      output: { title: 'AI review could not run', summary: 'blocked' },
    });
    for (const src of [changes, blocked]) {
      const d = decide({ checkRuns: [src] });
      assert.equal(d.carry, false);
      assert.equal(d.label, undefined);
    }
    // Even a record that CLAIMS pass cannot ride on a check that did not conclude one.
    for (const conclusion of ['failure', 'action_required']) {
      const d = decide({ checkRuns: [round({ conclusion })] });
      assert.equal(d.carry, false, `a pass record on a '${conclusion}' check must not carry`);
    }
  });

  test('#1688 inv 4: only a pass can be RECORDED, and only a pass can be read back', () => {
    for (const label of [CHANGES, BLOCKED, 'ai-review:pending', '', undefined, 'pass']) {
      assert.equal(
        renderRoundRecord({ label, inputHash: IN_A, panelKey: KEY_A, reviewedSha: P }),
        '',
        `${label} must not produce a round record`,
      );
    }
    // A hand-made record naming any other verdict is not understood, so it is not a source.
    for (const slug of ['changes', 'blocked', 'PASS', 'pass2', '']) {
      const forged = `review-round:v1:${slug}:${IN_A}:${KEY_A}:${P}`;
      assert.equal(parseRoundRecord(forged), null, `verdict slug "${slug}" must not parse`);
      assert.equal(decide({ checkRuns: [round({ output: { title: 't', summary: forged } })] }).carry, false);
    }
  });

  test('#1688 inv 4: every carry there is returns exactly the recorded label', () => {
    // Property over the fixture space used above: no input makes a carry say anything
    // but the label the source round recorded, and a refusal names no label at all.
    const sources = [
      round(),
      round({ conclusion: 'neutral' }),
      round({ conclusion: 'failure' }),
      round({ conclusion: 'action_required' }),
      round({ status: 'in_progress' }),
      round({ output: { title: 't', summary: 'no record' } }),
    ];
    let carries = 0;
    for (const src of sources) {
      const d = decide({ checkRuns: [src] });
      if (d.carry) {
        carries += 1;
        const rec = parseRoundRecord(src.output.summary);
        assert.ok(rec, 'a carry with no parseable record behind it');
        assert.equal(d.label, rec.label);
        assert.equal(d.label, PASS);
      } else {
        assert.equal(d.label, undefined, 'a refusal must not name a label a caller could apply');
      }
    }
    assert.equal(carries, 2, 'exactly the success and the neutral source carry');
  });

  // ── invariant 5 ──
  test('#1688 inv 5: identity is content - unrelated SHAs with the same input carry (a force-push)', () => {
    // Nothing here says the new head descends from the old one, and nothing needs to.
    const d = decide({ headSha: 'e5'.repeat(20) });
    assert.equal(d.carry, true, d.reason);
  });

  test('#1688 inv 5: the decision reads no commit count, subject, actor or branch-update flag', () => {
    // Offer every "this was just a base merge" hint a caller might be tempted to trust,
    // alongside a CHANGED input. None of them may produce a carry.
    const d = decide({
      inputHash: IN_B,
      newCommits: 0,
      commitSubject: "Merge branch 'main' into feature",
      actor: 'minspec-sdd[bot]',
      isBaseMerge: true,
      updateBranch: true,
    });
    assert.equal(d.carry, false);
    // And with an UNCHANGED input, hints claiming the opposite do not stop one.
    const e = decide({ newCommits: 12, commitSubject: 'feat: rewrite everything', isBaseMerge: false });
    assert.equal(e.carry, true);
  });

  // ── invariant 6 ──
  test('#1688 inv 6: the carried comment says carried, from which commit, why, and how to get a fresh review', () => {
    const body = renderCarriedComment({ label: PASS, headSha: H, fromSha: P, reviewedSha: P0, fromUrl: 'https://github.example/checks/1' });
    const heading = body.split('\n')[0];
    assert.match(heading, /^## 🤖 AI review — `ai-review:pass`/, 'keeps the heading prefix readers and tools key on');
    assert.match(heading, /carried forward/i, 'the HEADING itself says carried');
    assert.match(heading, /did not run/i);
    assert.match(body, /not a fresh review/i);
    assert.ok(body.includes(P), 'names the commit the verdict was carried from');
    assert.ok(body.includes(P0), 'names the commit the voters actually ran on');
    assert.ok(body.includes('https://github.example/checks/1'));
    assert.match(body, /identical/i, 'says WHY');
    assert.match(body, /does not cover/i, 'says what a carried verdict is not');
    assert.match(body, /re-run/i, 'says how to force a fresh review');
    assert.match(body, /<!-- ai-review-carried: from=(a1){20} reviewed=(c3){20} -->/);
    // The shepherd reads the LAST verdict block on the thread for its findings. A carried
    // comment must not contain one, or it would shadow the real review's block.
    assert.ok(!body.includes(VERDICT_BEGIN_TOKEN));
  });

  test('#1688 inv 6: a carried comment is only ever rendered for a pass with a real source', () => {
    for (const bad of [
      { label: CHANGES, headSha: H, fromSha: P, reviewedSha: P },
      { label: BLOCKED, headSha: H, fromSha: P, reviewedSha: P },
      { label: PASS, headSha: H, fromSha: '', reviewedSha: P },
      { label: PASS, headSha: H, fromSha: P, reviewedSha: '' },
      { label: PASS, headSha: '', fromSha: P, reviewedSha: P },
      undefined,
    ]) {
      assert.equal(renderCarriedComment(bad), '', `${JSON.stringify(bad)} must render nothing`);
    }
  });

  test('#1688 inv 6: the check-run on the new head says carried in its title and summary, conclusion untouched', () => {
    const fresh = decideReviewCheck(PASS, false);
    const carried = decideReviewCheck(PASS, false, { fromSha: P, reviewedSha: P0 });
    assert.equal(carried.conclusion, fresh.conclusion, 'a carry never changes what the check concludes');
    assert.equal(carried.name, fresh.name);
    assert.notEqual(carried.title, fresh.title);
    assert.match(carried.title, /carried/i);
    assert.ok(carried.title.includes(P.slice(0, 8)));
    assert.match(carried.summary, /did not run/i);
    assert.ok(carried.summary.includes(P));
    assert.ok(carried.summary.includes(P0));
    // Machinery stays neutral and stays a human gate; the carry only labels it.
    const machinery = decideReviewCheck(PASS, true, { fromSha: P, reviewedSha: P });
    assert.equal(machinery.conclusion, 'neutral');
    assert.match(machinery.title, /carried/i);
    assert.match(machinery.title, /human review required/);
  });

  test('#1688 inv 6: a carry note is refused on anything that is not a pass, or has no source', () => {
    for (const label of [CHANGES, BLOCKED, '']) {
      assert.deepEqual(
        decideReviewCheck(label, false, { fromSha: P, reviewedSha: P }),
        decideReviewCheck(label, false),
        `${label}: a carried note must never decorate a non-pass`,
      );
    }
    assert.deepEqual(decideReviewCheck(PASS, false, { fromSha: 'nope', reviewedSha: P }), decideReviewCheck(PASS, false));
    assert.deepEqual(decideReviewCheck(PASS, false, { fromSha: P }), decideReviewCheck(PASS, false));
    assert.deepEqual(decideReviewCheck(PASS, false, {}), decideReviewCheck(PASS, false));
    assert.deepEqual(decideReviewCheck(PASS, false, null), decideReviewCheck(PASS, false));
  });

  test('#1688 inv 6: `ai-review:carried` is a disclosure label, never a verdict label', () => {
    assert.equal(CARRIED, 'ai-review:carried');
    // If it were a verdict label, the post step would strip it as a contradiction (#1468).
    assert.ok(!VERDICT_LABELS.includes(CARRIED));
    assert.equal(g.verdictLabelFault({ current: [PASS, CARRIED], verdict: PASS }), null);
    assert.deepEqual(
      g.decideVerdictLabels({ current: [PASS, CARRIED, 'ai-review:pending'], verdict: PASS }).remove,
      ['ai-review:pending'],
    );
    // ...and it neither greens nor reds the gate by itself.
    assert.equal(decideStatus({ labels: [PASS, CARRIED], passProvenance: VERIFIED }).state, 'success');
    assert.equal(decideStatus({ labels: [CARRIED] }).state, 'failure');
  });

  test('#1688 inv 6: a missing or stale disclosure label is a FAULT, never silence', () => {
    assert.equal(carriedLabelFault({ current: [PASS, CARRIED], carried: true }), null);
    assert.equal(carriedLabelFault({ current: [PASS], carried: false }), null);
    assert.match(carriedLabelFault({ current: [PASS], carried: true }), /missing/);
    assert.match(carriedLabelFault({ current: [PASS, CARRIED], carried: false }), /still/);
    assert.match(carriedLabelFault({ carried: true }), /missing/);
    assert.equal(carriedLabelFault(), null);
  });

  // ── invariant 7 ──
  test('#1688 inv 7: the staleness guard still strips a pass on a push when the new head has no completed pass round', () => {
    const real = decideStalenessStrip({ action: 'synchronize', labels: [PASS] });
    assert.equal(real.strip, true);
    for (const headRound of [
      undefined,
      null,
      {},
      { found: false, complete: false },
      { found: true, complete: false }, // the panel is still running on the new head
      { found: true, complete: false, label: PASS }, // a label on an incomplete round is not a verdict
      { found: true, complete: true, label: CHANGES },
      { found: true, complete: true }, // no label
      { found: true, complete: 'yes', label: PASS }, // truthy is not true
    ]) {
      const s = decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound });
      assert.equal(s.strip, true, `${JSON.stringify(headRound)} must still strip`);
      assert.equal(s.reason, real.reason);
    }
  });

  test('#1688 inv 7: it stands down ONLY when the reviewer has already recorded a completed pass for this exact head', () => {
    // A carried round finishes in seconds, so the push-time strip can now arrive AFTER
    // the fresh label. Stripping it then would leave a reviewed head with no verdict.
    const headRound = latestHeadRound({ listing: whole([round({ head_sha: H })]), allowlist: ALLOW, headSha: H });
    assert.equal(headRound.complete, true);
    assert.equal(headRound.label, PASS);
    const s = decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound });
    assert.equal(s.strip, false);
    assert.match(s.reason, /already/);
    // A round on a DIFFERENT commit says nothing about this head.
    const elsewhere = latestHeadRound({ listing: whole([round({ head_sha: P })]), allowlist: ALLOW, headSha: H });
    assert.equal(elsewhere.complete, false);
    assert.equal(decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound: elsewhere }).strip, true);
    // Other events never stripped, and still do not.
    assert.equal(decideStalenessStrip({ action: 'labeled', labels: [PASS], headRound }).strip, false);
    assert.equal(decideStalenessStrip({ action: 'synchronize', labels: [], headRound }).strip, false);
  });

  test('#1688 inv 7: a real change is still voided end to end - no carry AND the strip stands', () => {
    // The new head has a different input, so no carry; and until the full panel has
    // finished there is no completed round on it, so the push-time strip still fires.
    assert.equal(decide({ inputHash: IN_B }).carry, false);
    const stillRunning = latestHeadRound({
      listing: whole([round({ head_sha: H, status: 'in_progress', conclusion: null })]),
      allowlist: ALLOW,
      headSha: H,
    });
    assert.equal(stillRunning.complete, false);
    assert.equal(decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound: stillRunning }).strip, true);
    const none = latestHeadRound({ listing: whole([]), allowlist: ALLOW, headSha: H });
    assert.equal(decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound: none }).strip, true);
  });

  // ── the round record ──
  test('#1688 round record: round-trips, and is refused unless every field is well-formed', () => {
    const rec = record({ reviewedSha: P0 });
    assert.deepEqual(parseRoundRecord(`summary text\n\n${rec}\n`), {
      label: PASS,
      inputHash: IN_A,
      panelKey: KEY_A,
      reviewedSha: P0,
    });
    for (const bad of [
      { inputHash: 'short' },
      { inputHash: null },
      { panelKey: 'G'.repeat(64) },
      { panelKey: undefined },
      { reviewedSha: 'abc' },
      { reviewedSha: '0'.repeat(40) },
      { reviewedSha: undefined },
    ]) {
      assert.equal(record(bad), '', `${JSON.stringify(bad)} must not render`);
    }
    assert.equal(renderRoundRecord(), '');
    assert.equal(parseRoundRecord(null), null);
    assert.equal(parseRoundRecord(undefined), null);
  });

  // ── the panel key ──
  const TREE = (overrides = {}) =>
    `${[...PANEL_KEY_PATHS]
      .map((p, i) => ({ p, sha: (overrides[p] === undefined ? String(i % 10) : overrides[p]) }))
      .filter(({ sha }) => sha !== null)
      .map(({ p, sha }) => `100644 blob ${sha.padEnd(40, 'f').slice(0, 40)}\t${p}`)
      .join('\n')}\n`;

  test('#1688 panel key: stable for the same reviewer, different when ANY reviewer file or the coverage changes', () => {
    const base = reviewPanelKey({ lsTree: TREE(), coverage: '' });
    assert.match(base, /^[0-9a-f]{64}$/);
    assert.equal(reviewPanelKey({ lsTree: TREE(), coverage: '' }), base);
    // Line order from git is not load-bearing.
    assert.equal(reviewPanelKey({ lsTree: TREE().trim().split('\n').reverse().join('\n'), coverage: '' }), base);
    for (const p of PANEL_KEY_PATHS) {
      const moved = reviewPanelKey({ lsTree: TREE({ [p]: 'abcdef' }), coverage: '' });
      assert.notEqual(moved, base, `a change to ${p} must change the key`);
    }
    assert.notEqual(reviewPanelKey({ lsTree: TREE(), coverage: 'single' }), base);
    // A mode flip (the executable bit) is a change too.
    assert.notEqual(reviewPanelKey({ lsTree: TREE().replace('100644', '100755'), coverage: '' }), base);
  });

  test('#1688 panel key: an unreadable or incomplete listing yields NO key, so nothing carries', () => {
    assert.equal(reviewPanelKey({ lsTree: '', coverage: '' }), null);
    assert.equal(reviewPanelKey({ lsTree: null, coverage: '' }), null);
    assert.equal(reviewPanelKey(), null);
    const optional = new Set(PANEL_KEY_OPTIONAL_PATHS);
    assert.ok(optional.size > 0 && optional.size < PANEL_KEY_PATHS.length);
    for (const p of PANEL_KEY_PATHS) {
      const without = reviewPanelKey({ lsTree: TREE({ [p]: null }), coverage: '' });
      if (optional.has(p)) {
        // An optional helper may legitimately be absent - and absent is itself a state
        // the key tells apart from present.
        assert.match(without, /^[0-9a-f]{64}$/, `${p} is optional`);
        assert.notEqual(without, reviewPanelKey({ lsTree: TREE(), coverage: '' }));
      } else {
        assert.equal(without, null, `${p} is required: without it the listing cannot be trusted`);
      }
    }
    // The reviewer's own definition is in the key: the workflow (voter set, CLI pin),
    // the guard (verdict schema, this logic), the scripts and the four role prompts.
    for (const p of [
      '.github/workflows/ai-review.yml',
      '.github/scripts/ai-review-guard.js',
      'scripts/review-branch.sh',
      'scripts/review-decide.sh',
      'scripts/roles/reviewer.md',
      'scripts/roles/security.md',
      'scripts/roles/architect.md',
      'scripts/roles/skeptic.md',
    ]) {
      assert.ok(PANEL_KEY_PATHS.includes(p), `${p} must be part of the reviewer's identity`);
      assert.ok(!optional.has(p), `${p} must be required`);
    }
    for (const p of optional) assert.ok(PANEL_KEY_PATHS.includes(p), `${p} is optional but not listed`);
  });

  // ── the single seam the workflow calls ──
  const INPUT = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
  const rawPlan = (o = {}) => {
    const inputHash = patchFingerprint(INPUT);
    const panelKey = reviewPanelKey({ lsTree: TREE(), coverage: '' });
    const src = round({ output: { title: 't', summary: record({ inputHash, panelKey }) } });
    return {
      action: 'synchronize',
      runAttempt: '1',
      headSha: H,
      beforeSha: P,
      inputText: INPUT,
      lsTree: TREE(),
      coverage: '',
      allowlistRaw: 'minspec-sdd[bot]',
      checkRunsJson: JSON.stringify({ total_count: 1, check_runs: [src] }),
      ...o,
    };
  };

  test('#1688 planVerdictCarry: raw text in, one decision out - and the hashes come back for the record', () => {
    const p = planVerdictCarry(rawPlan());
    assert.equal(p.carry, true, p.reason);
    assert.equal(p.label, PASS);
    assert.equal(p.fromSha, P);
    assert.equal(p.reviewedSha, P);
    assert.equal(p.inputHash, patchFingerprint(INPUT));
    assert.equal(p.panelKey, reviewPanelKey({ lsTree: TREE(), coverage: '' }));
    assert.match(p.comment, /carried forward/i);
    assert.ok(p.comment.includes(P));
  });

  test('#1688 planVerdictCarry: a refusal still returns the hashes, an empty label and NO comment', () => {
    const p = planVerdictCarry(rawPlan({ inputText: INPUT.replace('+b', '+c') }));
    assert.equal(p.carry, false);
    assert.equal(p.label, '');
    assert.equal(p.comment, '');
    assert.equal(p.fromSha, '');
    assert.equal(p.reviewedSha, '');
    assert.match(p.inputHash, /^[0-9a-f]{64}$/, 'the fresh round still needs its own fingerprint recorded');
    assert.match(p.panelKey, /^[0-9a-f]{64}$/);
    assert.ok(p.reason.length > 0);
  });

  test('#1688 planVerdictCarry: garbage in is a refusal with a reason, never a throw and never a carry', () => {
    for (const bad of [
      { checkRunsJson: '' },
      { checkRunsJson: 'not json' },
      { checkRunsJson: '{"message":"Not Found"}' },
      { checkRunsJson: 'null' },
      { checkRunsJson: undefined },
      { inputText: '' },
      { inputText: null },
      { lsTree: '' },
      { allowlistRaw: '' },
      { headSha: '' },
      { coverage: 'single' }, // recorded under the default coverage, asked under another
    ]) {
      const p = planVerdictCarry(rawPlan(bad));
      assert.equal(p.carry, false, `${JSON.stringify(bad)} must not carry`);
      assert.equal(p.label, '');
      assert.equal(p.comment, '');
      assert.ok(typeof p.reason === 'string' && p.reason.length > 0);
    }
    assert.equal(planVerdictCarry().carry, false);
    assert.equal(planVerdictCarry(null).carry, false);
  });

  // ── invariant 3, continued: a listing that is not the WHOLE list ──
  //
  // GitHub returns check-runs one page at a time, 100 at most. "The latest round" can
  // only be known from all of them. A commit can collect more rounds than one page
  // holds (ai-review-retry re-runs a blocked round on a schedule, and every re-run posts
  // another check), and then the true latest can sit on a page nobody fetched while the
  // newest run on the page that WAS fetched decides in its place. That would carry a
  // pass a later round had already overturned, so a listing that cannot be shown to be
  // whole is treated exactly like one that could not be read: the full panel runs.
  const planPass = () => JSON.parse(rawPlan().checkRunsJson).check_runs[0];
  const at = (minutes) => new Date(Date.UTC(2026, 9, 1, 0, minutes)).toISOString();
  const changesRun = (minutes) =>
    round({
      conclusion: 'failure',
      started_at: at(minutes),
      completed_at: at(minutes),
      output: { title: 'AI review: changes requested', summary: 'changes' },
    });
  const listingJson = (total, runs) => JSON.stringify({ total_count: total, check_runs: runs });
  /** `n` runs whose newest is a pass that would carry if the list were whole. */
  const newestIsPass = (n) => [
    { ...planPass(), started_at: at(5000), completed_at: at(5000) },
    ...Array.from({ length: n - 1 }, (_, i) => changesRun(i)),
  ];

  test('#1688 inv 3: page one of two never decides the latest round - the real latest was on the page not read', () => {
    // 101 rounds on the previous head. Page one holds 100 of them: 99 old `changes`
    // rounds and one pass, which is the newest thing ON THAT PAGE. Page two holds the
    // real latest round, a `changes`.
    const pageOne = newestIsPass(100);
    const pageTwo = [changesRun(9000)];
    assert.equal(pageOne.length + pageTwo.length, 101);
    // Control: that same pass, as the whole list, IS a carry. So what stops it below is
    // the missing page and nothing else about the fixture.
    assert.equal(planVerdictCarry(rawPlan({ checkRunsJson: listingJson(1, [pageOne[0]]) })).carry, true);

    const p = planVerdictCarry(rawPlan({ checkRunsJson: listingJson(101, pageOne) }));
    assert.equal(p.carry, false, 'page one of two must never carry');
    assert.equal(p.label, '', 'and names no label a caller could apply');
    assert.equal(p.comment, '');
    assert.match(p.reason, /100 of 101/, 'the run log says how short the listing was');
    // The order GitHub happens to return a page in must not matter.
    assert.equal(planVerdictCarry(rawPlan({ checkRunsJson: listingJson(101, [...pageOne].reverse()) })).carry, false);
    // The refusal is about the listing, so it holds for the other page too.
    assert.equal(planVerdictCarry(rawPlan({ checkRunsJson: listingJson(101, pageTwo) })).carry, false);
  });

  test('#1688 inv 3: each sign of a short listing refuses ON ITS OWN - the count, and a full page', () => {
    // 1. The count. GitHub says more exist than it returned - even when what it did
    //    return is far short of a page, so this cannot be the full-page rule firing.
    for (const [returned, total] of [[1, 2], [2, 3], [1, 101], [50, 1000]]) {
      const p = planVerdictCarry(rawPlan({ checkRunsJson: listingJson(total, newestIsPass(returned)) }));
      assert.equal(p.carry, false, `${returned} of ${total} must not carry`);
      assert.match(p.reason, new RegExp(`${returned} of ${total}`));
    }
    // 2. A full page, even when the count AGREES with it. 100 is the most one request
    //    can return, so a full page is never proof that there is no next one.
    assert.equal(g.CHECK_RUNS_PAGE_SIZE, 100);
    const full = planVerdictCarry(rawPlan({ checkRunsJson: listingJson(100, newestIsPass(100)) }));
    assert.equal(full.carry, false, 'a full page must not carry, whatever the count says');
    assert.match(full.reason, /full page/);
    //    Control: one fewer is a whole list and carries, so rule 2 is not simply
    //    refusing every long listing.
    assert.equal(planVerdictCarry(rawPlan({ checkRunsJson: listingJson(99, newestIsPass(99)) })).carry, true);
    // 3. A count that disagrees the other way is not a listing to trust either.
    assert.equal(planVerdictCarry(rawPlan({ checkRunsJson: listingJson(1, newestIsPass(2)) })).carry, false);
  });

  test('#1688 inv 3: a listing that does not say how many check runs exist cannot be shown to be whole', () => {
    const pass = planPass();
    for (const total of [undefined, null, '1', 1.5, -1, true, [1], {}]) {
      const json = JSON.stringify({ total_count: total, check_runs: [pass] });
      const p = planVerdictCarry(rawPlan({ checkRunsJson: json }));
      assert.equal(p.carry, false, `total_count=${JSON.stringify(total)} must not carry`);
      assert.match(p.reason, /how many/);
    }
    // A bare array (`gh api --jq .check_runs`) has thrown the count away. It used to be
    // accepted; it is exactly the shape that hides a second page.
    const bare = planVerdictCarry(rawPlan({ checkRunsJson: JSON.stringify([pass]) }));
    assert.equal(bare.carry, false, 'a bare array must not carry');
    assert.match(bare.reason, /could not be read/);
    // Control: the same run, in a listing that says it is the only one, carries.
    assert.equal(planVerdictCarry(rawPlan({ checkRunsJson: listingJson(1, [pass]) })).carry, true);
  });

  test('#1688 inv 7: a short listing on the CURRENT head does not stand the staleness guard down', () => {
    // The staleness guard asks the same question about the head being pushed. If it
    // cannot see every round there, it cannot know the reviewer's latest word is a pass,
    // so the push-time strip stays exactly what it was.
    const passOnHead = round({ head_sha: H });
    const all = latestHeadRound({ listing: { total_count: 1, check_runs: [passOnHead] }, allowlist: ALLOW, headSha: H });
    assert.equal(all.complete, true, 'control: the whole list, with a pass, stands the guard down');
    assert.equal(decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound: all }).strip, false);
    for (const listing of [
      { total_count: 2, check_runs: [passOnHead] }, // one of two
      { check_runs: [passOnHead] }, // no count
      [passOnHead], // a bare array
      { total_count: 100, check_runs: Array.from({ length: 100 }, () => passOnHead) }, // a full page
    ]) {
      const short = latestHeadRound({ listing, allowlist: ALLOW, headSha: H });
      assert.equal(short.complete, false);
      assert.equal(short.found, false, 'a short listing is not "a round was found"');
      assert.equal(decideStalenessStrip({ action: 'synchronize', labels: [PASS], headRound: short }).strip, true);
    }
  });
}
