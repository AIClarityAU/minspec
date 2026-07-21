// Unit tests for the ai-review label-integrity decision logic.
// Runs on plain Node (no deps): `node --test .github/scripts/ai-review-guard.test.js`.
// Wired into CI's lint job so the security-critical decisions stay enforced.

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
  decideStatus,
  shouldAwaitApproval,
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
