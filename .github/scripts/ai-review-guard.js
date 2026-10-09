// ai-review-guard — pure decision logic for the ai-review label-integrity gate.
//
// This module is deliberately I/O-free: no network, no `github`/octokit, no
// `fs`, no process access. Every function is a pure input→output mapping so the
// security-critical decisions (revert-or-not, strip-or-not, verified-or-not,
// green-or-not) can be unit-tested exhaustively (see ai-review-guard.test.js beside
// this file - AIClarityAU/minspec#871 made that suite a parity-managed file, so it
// ships with this guard and is byte-synced to it; `node --test
// .github/scripts/ai-review-guard.test.js` works wherever this file lives, though
// only MinSpec's own CI runs it automatically so far - AIClarityAU/minspec#2059)
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
// The name of the honest verdict CHECK-RUN posted by decideReviewCheck (below).
// Declared here, with the other wire-format constants, because #810 made it a
// SECOND load-bearing head witness read by verifyHeadPassCheckRun — producer
// (decideReviewCheck) and verifier (verifyHeadPassCheckRun) must bind the SAME
// constant so the two can never drift apart (#822).
const CHECK_NAME = 'ai-review';
// The reviewer could NOT run to a verdict for a TRANSIENT, non-code reason —
// almost always the Claude subscription's session quota being exhausted, but also
// a rate-limit / overload / auth blip. This is NOT a review of the PR: it must be
// visibly distinct from `ai-review:changes` (which means "the reviewer read your
// code and wants changes"), and it is safe to RETRY once the window resets. See
// isQuotaExhaustion() and the ai-review-retry workflow.
const BLOCKED = 'ai-review:blocked';

// ── The verdict channel (DR-079, #1157/#1165) ────────────────────────────────
//
// The verdict used to be TEXT the reviewer typed, parsed back out of its prose.
// That made every token the pipeline keys on a token an honest reviewer might
// legitimately write — and a review of THIS file writes all of them. Eight
// consumers could be flipped by a bare mention, and `BEGIN_COUNT != 1` caught
// ambiguity but never forgery: a lone injected block decided `pass`.
//
// Now the verdict is a VALUE the reviewer returns (`claude -p --json-schema` →
// `.structured_output`), and the block below is rendered by the PARENT from
// validated fields. Two properties follow, and they are the whole point:
//   • exactly one block exists, because we write it — the count guard can no
//     longer be tripped by prose;
//   • a quoted marker arrives as a JSON string VALUE, and a value cannot become
//     structure.
//
// No `maxLength`, `maxItems` or `format` here, deliberately: a cap that makes the
// model fail to produce `structured_output` would recreate #1157 as an
// intermittent self-block correlated with THOROUGH reviews — the worst possible
// correlation. Length is bounded at render time, where it can shorten display
// text but can never withhold a verdict.
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'blocking', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes'] },
    blocking: { type: 'integer', minimum: 0 },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'location', 'problem'],
        properties: {
          severity: { type: 'string' },
          location: { type: 'string' },
          problem: { type: 'string' },
        },
      },
    },
  },
};

// Neutralise every protocol token inside model-authored TEXT before it is
// rendered between real delimiters. Without this the fix would be cosmetic: a
// summary containing `REVIEW_VERDICT_BEGIN` would mint a second marker in the
// block we just wrote, reproducing #1157 through the new channel. Mirrors the
// diff-defanging in review-branch.sh, and leaves a visible marker so a reader
// can still see that the text was there.
function defangProtocolTokens(text) {
  return String(text == null ? '' : text)
    .replace(/\r/g, '')
    // The replacement must NOT contain the token it replaces. review-decide.sh:41
    // matches REVIEW_UNAVAILABLE as a BARE SUBSTRING, so a marker like
    // "[defanged: REVIEW_UNAVAILABLE]" would still trip it — the defang would look
    // applied and change nothing. Hyphens keep the text readable while breaking the
    // literal the consumers grep for.
    .replace(/REVIEW_VERDICT_(BEGIN|END)/g, (_m, k) => `[defanged marker: REVIEW-VERDICT-${k}]`)
    .replace(
      /REVIEW_UNAVAILABLE(_BEGIN|_END)?/g,
      (_m, k) => `[defanged marker: REVIEW-UNAVAILABLE${k ? k.replace('_', '-') : ''}]`,
    )
    // Only the line-anchored form is load-bearing downstream (review-decide.sh
    // greps `^[[:space:]]*ESCALATE:`), so neutralise it there and leave prose
    // mentions mid-sentence readable.
    .replace(/^(\s*)ESCALATE:/gm, '$1[defanged: ESCALATE]:');
}

// Bound a single rendered line. Applied to DISPLAY text only — never to the
// verdict or blocking fields, so truncation can never change a decision.
const MAX_FIELD = 500;
function clampField(text) {
  const s = defangProtocolTokens(text).replace(/\n+/g, ' ').trim();
  return s.length <= MAX_FIELD ? s : `${s.slice(0, MAX_FIELD - 1)}…`;
}

/**
 * Render the ONE canonical verdict block from a validated structured object.
 * Returns '' for anything unusable, which downstream reads as "no verdict" and
 * fails closed to ai-review:changes — never a spurious pass.
 */
function renderVerdictBlock(structured) {
  const o = structured;
  if (!o || typeof o !== 'object' || Array.isArray(o)) return '';
  const verdict = String(o.verdict ?? '').trim().toLowerCase();
  if (verdict !== 'pass' && verdict !== 'changes') return '';
  if (!Number.isInteger(o.blocking) || o.blocking < 0) return '';

  const lines = [
    'REVIEW_VERDICT_BEGIN',
    `verdict: ${verdict}`,
    `blocking: ${o.blocking}`,
    `summary: ${clampField(o.summary) || '(no summary provided)'}`,
  ];
  const findings = Array.isArray(o.findings) ? o.findings : [];
  if (findings.length > 0) {
    lines.push('findings:');
    for (const f of findings) {
      if (!f || typeof f !== 'object') continue;
      const sev = clampField(f.severity) || 'note';
      const loc = clampField(f.location) || '(unspecified)';
      const prob = clampField(f.problem) || '(no detail)';
      lines.push(`- ${sev} ${loc} — ${prob}`);
    }
  }
  lines.push('REVIEW_VERDICT_END');
  return `${lines.join('\n')}\n`;
}

/**
 * Extract the verdict block from `claude -p --output-format json` stdout.
 * Fails closed ('') on anything unexpected: non-JSON, an error result, or a
 * missing/!object `structured_output`. The agent cannot reach this function's
 * input except through the schema-validated channel.
 */
function parseCliVerdict(stdoutText) {
  let env;
  try {
    env = JSON.parse(String(stdoutText == null ? '' : stdoutText));
  } catch {
    return '';
  }
  if (!env || typeof env !== 'object') return '';
  if (env.is_error === true) return '';
  return renderVerdictBlock(env.structured_output);
}

// DR-063 (materialised as SPEC-031 INV-8 / FR-9a) — the single positive "your turn"
// queue signal. Present
// on a PR whose independent AI review has PASSED (the `ready-to-merge` gate is
// green) and whose ONLY remaining gate is a human keystroke. It is the canonical
// "my turn" filter, replacing the ambiguous read of `ai-review:pass` plus a
// negative label — and it never coexists with `ai-review:changes` (a failing gate
// removes it). Owned by ONE applier (ready-to-merge.yml), driven by shouldAwaitApproval().
const AWAITING_APPROVAL = 'awaiting-approval';

// #1247 — the NEGATIVE counterpart to AWAITING_APPROVAL: this PR declares a
// dependency on something that is still open, so it is nobody's turn yet.
//
// Deliberately NOT named `blocked`: `ai-review:blocked` above already means
// something entirely different (the reviewer could not RUN, a transient quota
// condition). Two labels a human scans in the same list must not read as
// variants of one another when they mean unrelated things.
const BLOCKED_BY = 'blocked-by';

// Declarations of a blocking dependency in a PR body, e.g.
//
//   Blocked by #1225
//   Blocked by: #1225, #1179
//   - **Blocked by** #1225
//
// STRICT BY DESIGN. The pattern anchors to the start of a line (after optional
// markdown decoration) so ordinary prose — "this was blocked by a stale cache",
// "#1225 blocked by design" — can never mint the label. A false `blocked-by`
// parks a mergeable PR indefinitely, which is worse than not having the signal:
// the whole point is that the queue tells the truth.
//
// Only `Blocked by` is recognised, NOT `Depends on`. PR bodies say "depends on"
// loosely all the time ("depends on the seam landing first" as narrative), while
// "Blocked by" reads as a declaration in every corpus I checked. One unambiguous
// form beats two fuzzy ones — a second form can be added if a real body wants it.
//
// LEADING-DECORATION PATTERN — catastrophic-backtracking history (minspec#2134).
// PR bodies are untrusted, attacker-controlled input, and this repo is public, so
// this class has been through three rounds of hardening; all are recorded here so
// a future edit does not casually reintroduce any of them.
//
// Round 1: the leading class `[\s>*_-]*` and the adjacent `\**` both included `*` —
// two greedy quantifiers ranging over an OVERLAPPING alphabet, which gave the
// backtracking engine O(n^2) work to discover a line of leading asterisks does not
// match (measured ~4s at 40K asterisks). The round-1 fix dropped `*` from the
// leading class, leaving `\**` as its sole owner — but left a SECOND, identically-
// shaped overlap in place: `[\s>_-]*` includes `\s`, and the `\s*` right after
// `\**` also matches `\s`, with only the nullable `\**` between them. Whenever
// `\**` matched zero (the common case — most declarations have no bold marker),
// those two `\s`-matching quantifiers became adjacent, reproducing the exact same
// class of bug on plain whitespace instead of asterisks (measured ~1.5s at 40K
// spaces or tabs). Caught in review of the round-1 PR, not by the round-1 test —
// which used an asterisk-only fixture and could not have distinguished "ReDoS
// closed" from "one of two ReDoS vectors closed" (the transferable lesson: vary
// the INPUT ALPHABET, not just the code, or a passing test gives false assurance).
//
// Root cause of both: this module never re-derives "is this a fresh overlap" by
// inspection — there is no lint rule or CI check for regex catastrophic-backtracking
// shapes in this repo, so the only backstop is deliberately-varied timing tests
// (see ai-review-guard.test.js) plus this comment's inventory for the next reviewer.
//
// Round 2 fix — collapse ALL leading decoration into ONE bounded quantifier:
// `[\s>*_-]{0,64}`. One quantifier over a union alphabet cannot have a split-point
// ambiguity with itself (there is only one way to decide how many characters it
// consumed), which closes the asterisk and whitespace axes outright. The `{0,64}`
// bound closes a THIRD, distinct mechanism found while fixing the second: `\s`
// matches line terminators, and the `m` flag makes `^` succeed after every one of
// them — so an all-newline body gives the engine O(n) valid anchor points, each
// doing O(remaining length) work with an UNBOUNDED quantifier, which is O(n^2)
// even with zero ambiguity inside any single attempt (measured ~1.7s at 40K
// newlines with the round-2 class left unbounded). Bounding the quantifier caps
// each anchor's work at O(64) regardless of body size, making the total O(64n) —
// linear (measured ~14ms at 40K newlines, ~57ms at 160K, confirmed linear not
// quadratic).
//
// Round 3: rounds 1-2 closed this shape before "blocked by"; the identical shape
// still existed after it. `\**\s*:?\s*` has TWO `\s`-matching quantifiers — the
// `\s*` right before `:?` and the `\s*` right after it — with only the nullable
// `:?` between them, exactly round 2's "two same-alphabet quantifiers, nullable
// separator" bug, one region over. `\**` itself does not add a fourth overlap: it
// shares no alphabet with `\s`, so an all-asterisk or all-space run in this region
// resolves in one attempt as soon as `(.+)` finds a non-`\n` character to grab —
// the same reason rounds 1-2 needed an all-NEWLINE fixture, not all-whitespace, to
// force the exhaustive backtrack (`.` matches space/tab/`*`, never `\n`). Found by
// the ai-review panel's security voter reviewing the round-2 PR: round 1 and 2's
// own regression tests varied the alphabet BEFORE "blocked by" — applying their
// own lesson — but not after it, so this fourth vector passed unnoticed a second
// time. `"blocked by" + "\n" x 40K` reproduces it (measured ~2000ms unfixed).
//
// Round 3 fix — same medicine as round 2, applied to the region after "blocked
// by": collapse `\s*:?\s*` into ONE bounded quantifier over the union alphabet,
// `[\s:]{0,64}`. Caps this region's worst case at O(64) too (measured ~15ms at
// 40K newlines, matching round 2's linear result).
//
// HONESTY CHECK on what this changes vs the ORIGINAL (pre-#2134) pattern: this is
// a near-superset, not a strict one. Every realistic decoration still matches
// identically — `* `, `  * `, `> `, `**`, `> **`, `-`, `_`, `blocked by: #1`,
// `blocked by #1`, `blocked by:#1` — and even the round-1-broken combinations like
// `*>Blocked by` / `*-Blocked by` (restored, since `*` is back in the same class
// as `>`/`-`). Two input classes stop matching, neither of which any human writes
// nor relied on as a feature — both only "worked" before as a side effect of
// unbounded quantifiers: a leading decoration run longer than 64 characters (round
// 2 — e.g. 100 nested blockquote markers), and a post-"blocked by" separator run
// longer than 64 characters OR containing more than one `:` (round 3 — e.g.
// `blocked by::: #1`, where the extra colons now get consumed as separator instead
// of spilling into the captured reference text). Acceptable because
// parseBlockedBy's output feeds only the advisory `blocked-by` dependency label:
// it is author-self-declared prose, not a security boundary, and it gates nothing
// a human is not already looking at.
const BLOCKED_BY_LINE_RE = /^[\s>*_-]{0,64}blocked\s+by\b\**[\s:]{0,64}(.+)$/gim;

// Only the LEADING run of refs on a declaring line counts: `#N`, separated by
// commas/`and`/whitespace. Scanning stops at the first token that is not one of
// those, so a trailing explanation cannot smuggle in a second blocker.
//
// Found by using it: the first real declaration written against this parser read
//   Blocked by #1225 — … (DR-078, merged as `proposed` in #1246, awaiting Accept)
// and a whole-line scan returned [1225, 1246]. #1246 was already closed so nothing
// broke, but the declaration was wrong, and a closed ref today is an open one
// tomorrow. An explanation after the refs is the natural way to write this, so the
// grammar has to expect it rather than the author having to remember.
const BLOCKED_BY_REFS_RE = /^(?:\s*(?:,|and\b)?\s*#\d+)+/i;
const ISSUE_REF_RE = /#(\d+)\b/g;

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

// STRICT variant for text that may be the AGENT's own prose rather than the harness's
// diagnostics (#1131). The loose predicate above matches a bare `quota` anywhere, which
// is correct for the CLI's stderr — that text is the harness talking — but wrong for
// anything the model wrote: a review that DISCUSSES quota handling is not evidence of a
// quota outage, and reading it as one loops a genuine crash forever as retry-able
// `blocked` instead of failing closed to a human.
//
// So this keeps only phrasings that read as the CLI's own SENTENCES and drops every
// bare topic word a reviewer would naturally use while describing the code — `quota`,
// `overloaded`, `insufficient credit`, and also `rate limit`, which is exactly what a
// review of the rate-limit handling says.
//
// Honest limit: classifying model-authored prose by content is unreliable in principle,
// and this narrows the failure rather than eliminating it. It is acceptable because it
// is a LAST-RESORT path — reached only when the CLI failed while writing nothing at all
// to stderr — and because the residual error now falls toward failing closed to a human
// rather than looping forever as retry-able.
function isQuotaExhaustionStrict(text) {
  const s = String(text == null ? '' : text);
  return /usage limit reached|limit reached|reached your (usage )?limit|weekly limit|session limit|5-?hour limit/i.test(s)
    || /\b(too many requests|429)\b/i.test(s)
    || /\bresets? (at|in)\b/i.test(s);
}

// ─── Reset-instant extraction (#1204) ───────────────────────────────────────
//
// The quota detectors above only ask WHETHER the text looks like a quota block.
// The reset time the CLI states — "resets 8:40am (UTC)", "resets 12:50am
// (Australia/Sydney)" — was matched as a pattern and then thrown away, so the
// retry had nothing to schedule against and polled blindly. On PR #1602 that cost
// six attempts across 4h21m, five of which were futile at the moment they fired.
//
// Returns an ISO-8601 instant (string) or null. Null means "no reset time stated",
// which callers MUST treat as "retry on the normal cadence" — never as "never
// retry". Failing to parse must not strand a PR.
//
// `nowMs` is injected rather than read from the clock so this is a pure function
// and its tests are deterministic across DST boundaries.

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. */
function tzOffsetMs(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asIfUtc - utcMs;
}

/** Wall-clock y/m/d h:m in `tz` → UTC ms. Iterated twice to settle DST shifts. */
function zonedWallClockToUtc(y, mo, d, h, mi, tz) {
  let utc = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) utc = Date.UTC(y, mo - 1, d, h, mi) - tzOffsetMs(utc, tz);
  return utc;
}

/** The y/m/d currently showing in `tz` at instant `utcMs`. */
function calendarDateIn(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return { y: +p.year, mo: +p.month, d: +p.day };
}

function parseResetInstant(text, nowMs) {
  const s = String(text == null ? '' : text);
  if (!Number.isFinite(nowMs)) return null;

  // Relative first — "resets in 25 minutes", "try again in 2 hours". Unambiguous,
  // and needs no timezone reasoning at all.
  const rel = s.match(/\b(?:resets?|try again)\s+in\s+(\d{1,3})\s*(second|minute|min|hour|hr)s?\b/i);
  if (rel) {
    const n = +rel[1];
    const unit = rel[2].toLowerCase();
    const mult = unit.startsWith('sec') ? 1e3 : unit.startsWith('h') ? 3.6e6 : 6e4;
    return new Date(nowMs + n * mult).toISOString();
  }

  // Absolute wall-clock — "resets 8:40am (UTC)", "resets at 12:50 am (Australia/Sydney)".
  // The zone is optional; without one there is no defensible instant, so we bail
  // rather than guess the runner's local zone (which is UTC on Actions but not
  // necessarily where the quota window is anchored).
  const abs = s.match(
    /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\))?/i,
  );
  if (!abs) return null;
  const tz = abs[4];
  if (!tz) return null;

  let h = +abs[1];
  const mi = abs[2] == null ? 0 : +abs[2];
  const mer = abs[3] ? abs[3].toLowerCase() : null;
  if (h > 23 || mi > 59) return null;
  if (mer === 'pm' && h < 12) h += 12;
  if (mer === 'am' && h === 12) h = 0;

  let cand;
  try {
    const today = calendarDateIn(nowMs, tz);
    cand = zonedWallClockToUtc(today.y, today.mo, today.d, h, mi, tz);
    // A stated reset is always in the FUTURE — "resets 12:50am" seen at 20:32 means
    // tomorrow's 12:50am, not one that already passed sixteen hours ago.
    if (cand <= nowMs) {
      const t = calendarDateIn(nowMs + 864e5, tz);
      cand = zonedWallClockToUtc(t.y, t.mo, t.d, h, mi, tz);
    }
  } catch {
    return null; // unknown/invalid IANA zone — treat as "not stated"
  }
  if (!Number.isFinite(cand)) return null;
  return new Date(cand).toISOString();
}

// ─── Patch-fingerprint recording (#1728) ─────────────────────────────────────
//
// WHAT THIS SECTION IS. The ai-review workflow embeds a `patch-fingerprint:` marker -
// a hash of the three-dot diff - in the verdict check-run's output. It is a
// MEASUREMENT record: `scripts/review-churn-report.sh` reads it back to count how often
// a round re-reviewed a patch an earlier round had already passed.
//
// WHAT READS IT TO SKIP A REVIEW: nothing. `findReattestableVerdict` below is
// implemented, tested and exported, has no production caller, and is kept because the
// churn instrument mirrors its strictness. The proposal to wire it, #1840, was closed.
//
// The skip that DOES exist is the verdict carry further down (#1688, `planVerdictCarry`).
// It does not key on this marker. It keys on its own `review-round:` record, which
// binds more than the diff - the approval facts the voters are shown, and the reviewer
// itself - and which, unlike this function, takes the LATEST round on the previous
// head rather than any earlier passing one. Read that section for what it claims.
//
// WHY THE MARKER IS RECORDED. Under `strict` branch protection every merge puts every
// other open PR BEHIND, and the branch update re-triggers a full four-voter review —
// of a patch that did not change. The reviewer reads the THREE-DOT patch
// (`base...head`), and a forward-merge leaves that patch byte-identical.
//
// WHAT NO CONSUMER MAY DO: reuse an old witness. The SHA-binding in
// verifyHeadPassCheckRun (#466/#810) is load-bearing — a witness must correspond to
// the CURRENT head. Carrying a verdict therefore means posting a FRESH check-run on
// the new SHA. The claim changes from "four voters reviewed this SHA" to "four voters
// reviewed this input, and this SHA has that input" — still true, and stated rather
// than implied.
//
// HONEST LIMIT: an identical patch can produce a DIFFERENT merge result, because the
// base moved. That is the #1394 semantic-conflict class. `strict` narrows it (the
// branch must be current) but does not remove it.

const PATCH_FINGERPRINT_PREFIX = 'patch-fingerprint:';

/**
 * Stable fingerprint of a three-dot patch. Normalises line endings, and strips the
 * whitespace run at the very END of the patch — the whole string, no `/m` flag, so
 * interior lines keep their own trailing whitespace — meaning a cosmetic re-render
 * that differs only in a final newline is not read as a new patch. Nothing else is
 * normalised: any real content change must produce a different digest.
 */
function patchFingerprint(diffText) {
  const norm = String(diffText == null ? '' : diffText).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (norm === '') return null; // an empty patch is never re-attestable (see #1680)
  return require('crypto').createHash('sha256').update(norm, 'utf8').digest('hex');
}

/** Render the marker embedded in a check-run's output so a later run can read it. */
function renderPatchFingerprint(fp) {
  return fp ? `${PATCH_FINGERPRINT_PREFIX}${fp}` : '';
}

/** Read the fingerprint back out of a check-run's output text. */
function parsePatchFingerprint(text) {
  const m = String(text == null ? '' : text).match(/patch-fingerprint:([0-9a-f]{64})\b/);
  return m ? m[1] : null;
}

// The review protocol's control tokens. Named here so this module has ONE definition
// instead of two, and so a cross-file test can pin them against the other sites that
// hardcode the same literals - scripts/review-decide.sh, scripts/review-branch.sh and
// .github/workflows/ai-review.yml. They cannot be IMPORTED there (two of the three are
// bash), so a shared constant cannot be the mechanism; the test is (#2163 review).
const VERDICT_BEGIN_TOKEN = 'REVIEW_VERDICT_BEGIN';
const VERDICT_END_TOKEN = 'REVIEW_VERDICT_END';
const UNAVAILABLE_TOKEN = 'REVIEW_UNAVAILABLE';

const VOTER_RECORD_PREFIX = 'voter-record:';

/**
 * Is `text` STRUCTURALLY a single unambiguous verdict block?
 *
 * Structure only, on purpose. review-decide.sh is the single definition of what a
 * verdict MEANS (pass vs changes); re-deciding that here would create a second copy
 * free to drift from it. This answers the narrower question the record layer needs:
 * "is this a verdict at all, or is it prose?"
 *
 * WHY IT IS NEEDED. ai-review.yml substitutes a human sentence when a voter emits
 * nothing — `(reviewer emitted no verdict block — fail-closed to changes)`. That is
 * non-empty, so the empty-block rail passes it, and reuse would then pin a
 * placeholder as a verdict for as long as the patch is unchanged: the voter that
 * never ran would never run again. Same for a REVIEW_UNAVAILABLE marker, which says
 * the review could not RUN.
 *
 * The AMBIGUITY count is a BARE SUBSTRING count, matching review-decide.sh:157
 * rather than the anchored extractor. That asymmetry is deliberate and must stay:
 * a decorated marker (`**REVIEW_VERDICT_BEGIN**`, a trailing word) is invisible to an
 * anchored count but visible to that gate, so an anchored count here could record
 * something the gate will later distrust. Anything review-decide.sh would refuse must
 * never become a survivor. Being broader than needed costs a re-run; being narrower
 * costs a placeholder pinned in place of a review.
 */
function isStructuralVerdictBlock(text) {
  const s = String(text == null ? '' : text).replace(/\r/g, '');
  const count = (needle) => s.split(needle).length - 1;
  if (count(VERDICT_BEGIN_TOKEN) !== 1) return false;
  if (count(VERDICT_END_TOKEN) !== 1) return false;
  // A could-not-run marker is not a verdict, however well-formed.
  if (s.includes(UNAVAILABLE_TOKEN)) return false;
  // ORDER, over line-anchored markers — a prose mention is not a delimiter, and the
  // closing marker cannot precede the opening one. Leading indentation is allowed,
  // as it is everywhere else in this protocol (review-decide.sh's `^[[:space:]]*`).
  const lines = s.split('\n');
  const begin = lines.findIndex((ln) => ln.trim() === VERDICT_BEGIN_TOKEN);
  const end = lines.findIndex((ln) => ln.trim() === VERDICT_END_TOKEN);
  if (begin < 0 || end < 0) return false;
  return begin < end;
}

/**
 * Render one voter's verdict block for storage on the ai-review check-run output.
 *
 * Shape: `voter-record:<role>:<sha256 of block>:<base64 of block>`. The digest is not
 * security - provenance comes from the check-run's `app.slug` - it is a TRUNCATION
 * detector. Check-run output has a hard size limit, four voter blocks can approach it,
 * and a half-written record must be unusable rather than silently short. Base64 keeps
 * newlines and markdown fences out of the surrounding markdown, and contains no `:`,
 * so the field separator stays unambiguous.
 */
function renderVoterRecord(role, block) {
  const r = String(role == null ? '' : role);
  if (!/^[a-z][a-z0-9-]*$/.test(r)) return '';
  const body = String(block == null ? '' : block);
  if (body.trim() === '') return ''; // a silent voter is never a survivor
  // ...and neither is a voter whose "block" is the fail-closed placeholder, an
  // unavailable marker, or prose. See isStructuralVerdictBlock for why non-empty
  // is not enough.
  if (!isStructuralVerdictBlock(body)) return '';
  const crypto = require('crypto');
  const digest = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  return `${VOTER_RECORD_PREFIX}${r}:${digest}:${Buffer.from(body, 'utf8').toString('base64')}`;
}

/**
 * Read voter records back out of check-run output text.
 *
 * A record whose payload does not hash to its own digest is DROPPED, not repaired: that
 * is the truncated-output case, and a partially-recovered verdict block is exactly the
 * kind of plausible-but-wrong artifact this repo keeps getting bitten by. First record
 * for a role wins, so callers pass check-runs newest-first.
 */
function parseVoterRecords(text) {
  const out = {};
  const re = new RegExp(`${VOTER_RECORD_PREFIX}([a-z][a-z0-9-]*):([0-9a-f]{64}):([A-Za-z0-9+/=]+)`, 'g');
  const src = String(text == null ? '' : text);
  const crypto = require('crypto');
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, role, digest, b64] = m;
    if (Object.prototype.hasOwnProperty.call(out, role)) continue;
    let decoded;
    try {
      decoded = Buffer.from(b64, 'base64').toString('utf8');
    } catch (_) {
      continue;
    }
    if (decoded.trim() === '') continue;
    if (crypto.createHash('sha256').update(decoded, 'utf8').digest('hex') !== digest) continue;
    out[role] = decoded;
  }
  return out;
}

/**
 * Which voters must run, and which may reuse a verdict already produced for this exact
 * patch (#2142).
 *
 * DELIBERATELY DOES NOT require the prior check-run to be `completed` + `success`, which
 * is where this parts company with findReattestableVerdict below. That function reuses a
 * whole PASS, so success is the point. Here the prior run FAILED overall - one voter went
 * silent and the panel fail-closed to `changes` - and that is precisely the run whose
 * survivors are worth keeping. Requiring success would disable reuse exactly when it is
 * needed.
 *
 * What it does require, and why each one:
 *   - an allowlisted `app.slug`: a verdict record in a PUBLIC repo is forgeable, so the
 *     server-attested producer identity is the only thing making it trustworthy;
 *   - the SAME patch fingerprint: the voter must have been looking at this input;
 *   - a record that round-trips its digest: see parseVoterRecords.
 *
 * It CANNOT upgrade a verdict, because it copies the block verbatim and the caller
 * re-combines; a reused `changes` stays `changes`. And a voter with no usable record is
 * never a survivor, so silence always costs a re-run rather than being inherited.
 *
 * SHA-BOUND, and `headSha` is REQUIRED. Without it nothing is reused at all.
 *
 * This was WRONG when first written, and the wrongness is worth keeping on the record
 * because it is the exact failure this repo keeps paying for. The comment here claimed
 * reuse happened "within ONE head SHA" while the code compared only the patch
 * fingerprint and never looked at `head_sha` - so it reused across commits whenever the
 * diff matched, which IS the base-moved case #1840 was closed over, justified by a
 * sentence saying it was not. Three voters caught it; the diff's own test reused across
 * two SHAs and proved it.
 *
 * The fix narrows the CODE to the claim rather than widening the claim to the code,
 * because the claim is what makes the feature safe and the narrowing costs nothing:
 * #2142's case is a voter dying and the SAME head being re-reviewed, so same-SHA reuse
 * keeps the whole benefit. Cross-SHA reuse would buy the repeats #1840 measured - every
 * one of which was a base move - and buy the #1394 semantic-conflict risk with them.
 *
 * WHY `headSha` IS REQUIRED HERE AND OPTIONAL IN verifyHeadPassCheckRun. There it is
 * belt-and-braces: the workflow already queries BY the head ref, so the SHA match
 * re-checks something upstream established. Here it IS the safety property, so leaving
 * it optional would make the docblock above false again in the default path.
 *
 * Among candidates on that SHA, the MOST RECENT wins, by `checkRunTime` - the same
 * ordering verifyHeadPassCheckRun uses, so a re-run's fresher record supersedes an
 * earlier one. Caller array order is deliberately NOT load-bearing: it was, and the
 * test asserting recency passed only because the fixture happened to be ordered.
 */
function selectVotersToRun({ roles, checkRuns, patchHash, allowlist, headSha } = {}) {
  const wanted = Array.isArray(roles) ? roles.slice() : [];
  const notes = [];
  const reuse = {};

  if (!patchHash) {
    notes.push('no patch fingerprint for this head, so every voter runs');
    return { run: wanted, reuse, notes };
  }
  // The SHA binding is the safety property, not a nicety - see the docblock. A caller
  // that does not say which head it is reviewing gets no reuse.
  if (!headSha) {
    notes.push('no head SHA to bind reuse to, so every voter runs');
    return { run: wanted, reuse, notes };
  }
  const allowed = Array.isArray(allowlist) ? allowlist.filter(Boolean) : [];
  if (allowed.length === 0) {
    notes.push('empty reviewer allowlist, so nothing is reused');
    return { run: wanted, reuse, notes };
  }
  // MOST RECENT FIRST, so the newest record for a role wins the first-wins loop below.
  // Sorted here rather than trusted from the caller: the recency guarantee has to come
  // from this function, or the note it prints ("verdict recorded on X") is the only
  // thing tying a reused verdict to a run, and it would name whichever one the caller
  // happened to list first.
  const runs = (Array.isArray(checkRuns) ? checkRuns : [])
    .slice()
    .sort((a, b) => checkRunTime(b) - checkRunTime(a));

  for (const c of runs) {
    if (!c || c.name !== CHECK_NAME) continue;
    // Same SHA only. A prior run on a DIFFERENT commit reviewed a different merge
    // result even when the diff text is byte-identical (#1394).
    if (c.head_sha !== headSha) continue;
    const slug = c.app && c.app.slug;
    const identities = [slug, slug ? `${slug}[bot]` : null].filter(Boolean);
    // isAuthorizedReviewer, not a raw `includes` - it lower-cases the login, so this
    // cannot become a SECOND, stricter door than the one verifyHeadPassCheckRun uses.
    // Harmless today because every caller passes parseAllowlist output, which is already
    // lower-cased; the divergence is the defect, not a present miss (#2163 review).
    if (!identities.some((i) => isAuthorizedReviewer(i, allowed))) continue;
    const text = [c.output && c.output.title, c.output && c.output.summary, c.output && c.output.text]
      .filter(Boolean)
      .join('\n');
    if (parsePatchFingerprint(text) !== patchHash) continue;
    const records = parseVoterRecords(text);
    for (const role of wanted) {
      if (Object.prototype.hasOwnProperty.call(reuse, role)) continue;
      if (!Object.prototype.hasOwnProperty.call(records, role)) continue;
      reuse[role] = records[role];
      notes.push(
        `reusing ${role}: same patch and same head ${String(c.head_sha).slice(0, 8)}`,
      );
    }
  }

  const run = wanted.filter((r) => !Object.prototype.hasOwnProperty.call(reuse, r));
  for (const role of run) {
    notes.push(`running ${role}: no usable prior verdict for this patch`);
  }
  return { run, reuse, notes };
}

/**
 * Is there a prior, provenance-verified PASS for this exact patch?
 *
 * Deliberately reuses the SAME strictness as verifyHeadPassCheckRun — completed +
 * success + an allowlisted App slug — because a weaker check here would be a second,
 * softer door into the same gate. The only thing it does NOT require is head_sha
 * equality, which is precisely what makes it a re-attestation rather than a witness.
 */
function findReattestableVerdict({ checkRuns, patchHash, allowlist } = {}) {
  if (!patchHash) return { ok: false, reason: 'no patch fingerprint (empty or unreadable diff)' };
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    return { ok: false, reason: 'no prior check-runs to re-attest from' };
  }
  const allowed = Array.isArray(allowlist) ? allowlist : [];
  if (allowed.length === 0) return { ok: false, reason: 'empty reviewer allowlist — refusing to re-attest' };

  for (const c of checkRuns) {
    if (!c || c.name !== CHECK_NAME) continue;
    if (c.status !== 'completed' || c.conclusion !== 'success') continue;
    const slug = c.app && c.app.slug;
    const identities = [slug, slug ? `${slug}[bot]` : null].filter(Boolean);
    if (!identities.some((i) => allowed.includes(i))) continue;
    const text = [c.output && c.output.title, c.output && c.output.summary, c.output && c.output.text]
      .filter(Boolean)
      .join('\n');
    if (parsePatchFingerprint(text) === patchHash) {
      return { ok: true, sourceSha: c.head_sha, reason: `patch unchanged since ${String(c.head_sha).slice(0, 8)}` };
    }
  }
  return { ok: false, reason: 'no prior passing review of this exact patch' };
}

// ─── Verdict carry (#1688) ───────────────────────────────────────────────────
//
// WHAT IT DOES. Before the voters run for a head H, one question is asked: did this
// push change anything a reviewer would be given? If it did not, and the previous head
// P carries a completed pass, the voters are skipped and P's verdict is carried to H -
// VISIBLY. The comment, the `ai-review:carried` label and the check-run on H all say
// the verdict was carried, from which commit, and why. Anything else runs the full
// panel exactly as before.
//
// WHY. Under `strict` a pull request must be current with its base before it can
// merge, so a branch update pushes a merge commit, the #359 staleness guard voids the
// verdict, and four voters re-read text that did not change. Measured over 154 rounds
// in four repositories (#2588 sections 4 and 5): 25 rounds - 14.7 percent of the
// panel's cost - re-reviewed a pull request whose own change was line-for-line the
// same, and all 25 followed a pass with another pass.
//
// IS IT LIVE? Only once the ai-review workflow calls `planVerdictCarry`. That call is
// a workflow edit, which the review App cannot push (it holds no `workflows`
// permission), so it lands by a human hand. It also has to land AFTER this module is
// on the base branch, because the workflow loads this file from the trusted base: the
// "seam first, caller second" order recorded on verdictLabelFault below (#1468).
// Do not take either state from this comment: search ai-review.yml for
// `planVerdictCarry`. No caller means every push is still reviewed in full.
//
// WHAT "NOTHING CHANGED" MEANS. Two hashes. Both are recorded on the check-run of the
// round that produced the verdict, and both are recomputed for H by the trusted base
// checkout from git objects:
//
//   input  the reviewable input - `scripts/review-branch.sh <base> <head>
//          --print-input`, the exact block of the prompt that depends on the change:
//          the three-dot diff as the voters see it, plus the approval facts
//          `approval-provenance.py` derives for it. The diff alone is NOT enough: a
//          pull request that changes only an approval sidecar keeps a byte-identical
//          diff while the base edits the approved spec underneath it, and the facts
//          then read MISMATCH where they read MATCHES. Hashing what is shown, rather
//          than what was pushed, is what catches that.
//   panel  the reviewer itself - the blobs of PANEL_KEY_PATHS at the BASE commit plus
//          the coverage mode. The review scripts and role prompts come from the base,
//          and a base merge is precisely the push that moves the base. If it moved the
//          reviewer, the earlier verdict came from a different one.
//
// The hash is over bytes. Not `git patch-id`, which ignores whitespace: indentation
// is content in Python, YAML and Makefiles. And nothing here is told what KIND of
// push this was - no commit count, no subject, no actor, no "this was a branch
// update" flag. A merge commit with the stock subject that also edits a file hashes
// differently and is reviewed; a force-push of the same change onto a new base hashes
// the same and is not.
//
// WHAT IS CARRIED. A completed `ai-review:pass`, and nothing else. A pass means every
// required voter returned a valid pass, so it is a complete round by construction.
// `ai-review:changes` is not carried, because a voter that crashed without a verdict
// also fails closed to `changes` and a carry would make that outage stick; and
// `ai-review:blocked` is the review NOT running, which is no verdict at all. Neither
// can therefore be turned into a pass without the voters running, and neither can be
// made permanent by a re-push.
//
// WHICH EARLIER ROUND. The LATEST `ai-review` check-run on the previous head, and only
// that one - the same most-recent-wins rule verifyHeadPassCheckRun applies, so a later
// `changes` on that commit beats an earlier pass. If that round is missing, unreadable,
// still running, not from the allowlisted reviewer App, or anything but a recorded
// pass, the full panel runs. Every refusal carries a reason for the run log.
//
// "Latest" is only chosen from a listing shown to be WHOLE (wholeCheckRunListing).
// GitHub pages check-runs, so the newest run on one page of several is not the latest
// round, and trusting it would carry a pass that a round on an unread page had already
// overturned. One page that is short, or full, or has lost its count is a refusal.
//
// THE WAY OUT. Re-running the workflow run always reviews. It is the escape hatch for
// a human who wants fresh eyes on an unchanged diff, and it is what ai-review-retry
// does to a blocked round.
//
// THIS REVERSES #1840, AND THE COST IS REAL. #1840 proposed this and was closed: what
// it measured (3 repeats in 41 runs, all on one pull request) was too small to buy the
// risk it carried. #2588 measured 25 in 154 across four repositories, and the trade was
// taken on that. The risk did not change. The voters can open files outside the diff,
// and those move with the base, so a carried pass says nothing about a new interaction
// between this change and what the base gained - the #1394 semantic-conflict class.
// Re-review after an update from main changed no verdict in 26 measured rounds, which
// is too few to rule out a miss rate below about one in ten. The required build and
// tests on the updated commit remain the check for that class; the panel no longer is.
// The decision, what it changes in DR-097 (per-voter reuse), and what would reverse
// it are recorded in docs/decisions/DR-104.md.
//
// NOT BOUND, AND SAID SO: project context the reviewer CLI loads by convention
// (CLAUDE.md and the like) and every other file in the base checkout. They are the
// same class as "the base moved" above. PANEL_KEY_PATHS is the review machinery the
// scripts name explicitly, and a test pins it to what review-branch.sh reads.

/** The disclosure label a carried verdict wears. NOT a verdict label (see VERDICT_LABELS). */
const CARRIED = 'ai-review:carried';

const ROUND_RECORD_PREFIX = 'review-round:';
const ROUND_RECORD_VERSION = 'v1';
// Verdict slug → label. One entry on purpose: only a pass is ever recorded.
const ROUND_VERDICTS = { pass: PASS };

/**
 * The reviewer's own files, read at the BASE commit. Changing any of them changes who
 * the reviewer is, so a verdict from before the change is not carried across it.
 *
 * `.github/workflows/ai-review.yml` is here for two things nothing else records: which
 * voters run and how their votes combine, and the pinned reviewer CLI version (and so
 * the model). The guard is here because it holds the verdict schema and this logic.
 */
const PANEL_KEY_PATHS = [
  '.github/workflows/ai-review.yml',
  '.github/scripts/ai-review-guard.js',
  'scripts/review-branch.sh',
  'scripts/review-decide.sh',
  'scripts/lib/agent-context.sh',
  'scripts/approval-provenance.py',
  'scripts/hooks/canonical.py',
  'scripts/roles/reviewer.md',
  'scripts/roles/security.md',
  'scripts/roles/architect.md',
  'scripts/roles/skeptic.md',
];
/**
 * The two helpers review-branch.sh guards with a file test before it calls them, so
 * they may legitimately be absent. Every other path is required: a listing without it
 * is a listing that failed, not a reviewer without that file.
 */
const PANEL_KEY_OPTIONAL_PATHS = ['scripts/approval-provenance.py', 'scripts/hooks/canonical.py'];

function isHex64(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
}

/** A git commit name: SHA-1 or SHA-256. All zeros is git's "no such commit". */
function isCommitSha(s) {
  return typeof s === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s) && !/^0+$/.test(s);
}

function sha256Hex(text) {
  return require('crypto').createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Fingerprint of the reviewer, from `git ls-tree <base> -- <PANEL_KEY_PATHS>` output
 * and the raw coverage setting. Null - so nothing carries - when a required file is
 * not listed: an empty or partial listing is what a failed `git` call looks like, and
 * it must not hash to something two failed calls would agree on.
 *
 * The coverage value is taken RAW, not normalised the way the workflow normalises it.
 * A second copy of that rule here could drift from the first; the price of not having
 * one is a single needless review when an unset variable is spelled out.
 */
function reviewPanelKey({ lsTree, coverage } = {}) {
  const listed = new Map();
  for (const line of String(lsTree == null ? '' : lsTree).split('\n')) {
    const m = /^(\d{6}) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/.exec(line);
    if (m) listed.set(m[3], `${m[1]} ${m[2]}`);
  }
  const optional = new Set(PANEL_KEY_OPTIONAL_PATHS);
  const lines = ['panel-key/v1'];
  for (const p of PANEL_KEY_PATHS) {
    const entry = listed.get(p);
    if (!entry && !optional.has(p)) return null;
    lines.push(`${p}\t${entry || 'absent'}`);
  }
  lines.push(`coverage\t${String(coverage == null ? '' : coverage).trim()}`);
  return sha256Hex(`${lines.join('\n')}\n`);
}

/**
 * The record a completed round leaves on its check-run, so the next round can tell
 * whether anything changed: `review-round:v1:pass:<input>:<panel>:<reviewed sha>`.
 *
 * `reviewedSha` is the commit the voters actually ran on. For a fresh round that is
 * the round's own head; a carried round copies it from its source, so a chain of
 * branch updates keeps pointing at the one real review.
 *
 * Returns '' for anything that is not a pass with both hashes and a real commit. No
 * record is how a round says "do not carry from me".
 */
function renderRoundRecord({ label, inputHash, panelKey, reviewedSha } = {}) {
  const slug = Object.keys(ROUND_VERDICTS).find((k) => ROUND_VERDICTS[k] === label);
  if (!slug) return '';
  if (!isHex64(inputHash) || !isHex64(panelKey) || !isCommitSha(reviewedSha)) return '';
  return `${ROUND_RECORD_PREFIX}${ROUND_RECORD_VERSION}:${slug}:${inputHash}:${panelKey}:${reviewedSha}`;
}

/**
 * Read a round record back out of check-run output text. Null unless there is EXACTLY
 * one, complete and well-formed: two records are an ambiguity, and a half-written one
 * is the truncated-output case - neither is repaired, both mean "no record".
 */
function parseRoundRecord(text) {
  const src = String(text == null ? '' : text);
  if (src.split(ROUND_RECORD_PREFIX).length - 1 !== 1) return null;
  const re = new RegExp(
    `${ROUND_RECORD_PREFIX}${ROUND_RECORD_VERSION}:([a-z]+):([0-9a-f]{64}):([0-9a-f]{64}):([0-9a-f]{64}|[0-9a-f]{40})(?![0-9a-f])`,
  );
  const m = re.exec(src);
  if (!m) return null;
  if (!Object.prototype.hasOwnProperty.call(ROUND_VERDICTS, m[1])) return null;
  if (!isCommitSha(m[4])) return null;
  return { label: ROUND_VERDICTS[m[1]], inputHash: m[2], panelKey: m[3], reviewedSha: m[4] };
}

// The most check-runs GitHub returns for one request, and the `per_page` both callers
// ask for. A response holding this many is a FULL page, and a full page is never proof
// that there is no next one.
const CHECK_RUNS_PAGE_SIZE = 100;

/**
 * A check-runs API response, accepted only when it is provably the WHOLE list.
 *
 * "The latest round on this commit" is only knowable from every round on it. GitHub
 * returns them one page at a time, and a commit can collect more than a page holds:
 * ai-review-retry re-runs a blocked round on a schedule and each re-run posts another
 * check. Picking the latest from one page of several would let the newest run ON THAT
 * PAGE decide while the real latest sat unread on another - a pass carried forward
 * after a later round had overturned it. So this does not paginate and does not guess.
 * It takes GitHub's response exactly as returned, `{ total_count, check_runs }`, and
 * refuses unless two independent signs both say nothing is missing:
 *
 *   1. the count - `total_count` is there, is a count, and equals what was returned;
 *   2. the page - fewer than a full page came back.
 *
 * Either alone would catch a short page today. Both are checked because each rests on
 * something the other does not: the first on GitHub's count being right, the second on
 * the caller having asked for a full-size page (CHECK_RUNS_PAGE_SIZE).
 *
 * A bare array is refused: it is the same list with the count thrown away. A refusal
 * is reported as a listing problem, never as "no round", and it costs one thing: on a
 * commit with a page or more of rounds the verdict is never carried and the panel runs.
 */
function wholeCheckRunListing(listing, short) {
  const no = (reason) => ({ ok: false, checkRuns: null, reason });
  const where = short ? ` for ${short}` : '';
  if (!listing || typeof listing !== 'object' || Array.isArray(listing) || !Array.isArray(listing.check_runs)) {
    return no('the check-runs for that commit could not be read');
  }
  const runs = listing.check_runs;
  const total = listing.total_count;
  if (!Number.isInteger(total) || total < 0) {
    return no(`the check-runs listing${where} does not say how many check runs exist, so it cannot be shown to be the whole list`);
  }
  if (runs.length !== total) {
    return no(`the check-runs listing${where} is not the whole list (${runs.length} of ${total}), so the latest round cannot be known`);
  }
  if (runs.length >= CHECK_RUNS_PAGE_SIZE) {
    return no(`the check-runs listing${where} is a full page (${runs.length}), which cannot be shown to be the last one, so the latest round cannot be known`);
  }
  return { ok: true, checkRuns: runs, reason: '' };
}

/**
 * The latest `ai-review` round on one commit, and whether it is a completed pass.
 *
 * Two callers, one rule: the carry asks it about the PREVIOUS head ("is there a pass
 * to carry?"), and the staleness guard asks it about the CURRENT head ("has the
 * reviewer already recorded a pass for this exact commit?").
 *
 * Mirrors verifyHeadPassCheckRun on purpose - same name filter, same SHA filter, same
 * most-recent-wins, same allowlist door - so this cannot become a second, softer way
 * in. The latest run decides even when it is not the reviewer's: a newer check of the
 * same name from another app makes the round unusable rather than being skipped over.
 *
 * `listing` is the check-runs API response for that commit, passed through unread:
 * `{ total_count, check_runs }`. It goes through wholeCheckRunListing first, so "latest"
 * is only ever chosen from a list shown to be whole. A listing that could not be read,
 * or cannot be shown to be whole, is reported as that and never as "no round" - and
 * both leave `complete` false, which every caller treats as "review in full" (the
 * carry) or "strip as before" (the staleness guard).
 */
function latestHeadRound({ listing, allowlist, headSha } = {}) {
  const none = (reason) => ({ found: false, complete: false, reason });
  if (!isCommitSha(headSha)) return none('there is no commit to look for a review round on');
  const short = headSha.slice(0, 8);
  const whole = wholeCheckRunListing(listing, short);
  if (!whole.ok) return none(whole.reason);
  const checkRuns = whole.checkRuns;
  const allowed = Array.isArray(allowlist) ? allowlist.filter(Boolean) : [];
  if (allowed.length === 0) {
    return none('the reviewer allowlist (AI_REVIEW_BOT_LOGINS) is empty, so no round can be attributed to the reviewer');
  }
  const ours = checkRuns.filter((c) => c && c.name === CHECK_NAME && c.head_sha === headSha);
  if (ours.length === 0) return none(`no ${CHECK_NAME} round is recorded on ${short}`);

  const latest = ours.reduce((a, b) => (checkRunTime(b) >= checkRunTime(a) ? b : a));
  const found = {
    found: true,
    complete: false,
    headSha,
    url: typeof latest.html_url === 'string' ? latest.html_url : '',
  };
  const slug = latest.app && latest.app.slug;
  const identities = [slug, slug ? `${slug}[bot]` : null].filter(Boolean);
  if (!identities.some((id) => isAuthorizedReviewer(id, allowed))) {
    return { ...found, reason: `the latest ${CHECK_NAME} check on ${short} was not posted by an allowlisted reviewer` };
  }
  if (latest.status !== 'completed') {
    return { ...found, reason: `the review round on ${short} has not completed` };
  }
  const out = latest.output || {};
  const rec = parseRoundRecord([out.title, out.summary, out.text].filter(Boolean).join('\n'));
  if (!rec) {
    return {
      ...found,
      reason: `the review round on ${short} left no readable pass record (it did not pass, could not run, or predates round records)`,
    };
  }
  // The record says pass; the check must agree. `neutral` is a machinery pull request,
  // where the conclusion is an exemption and says nothing about the verdict.
  if (latest.conclusion !== 'success' && latest.conclusion !== 'neutral') {
    return {
      ...found,
      reason: `the review round on ${short} records a pass but its check concluded '${sanitizeLogin(latest.conclusion)}'`,
    };
  }
  return {
    ...found,
    complete: true,
    label: rec.label,
    inputHash: rec.inputHash,
    panelKey: rec.panelKey,
    reviewedSha: rec.reviewedSha,
    reason: `completed ${rec.label} round on ${short}`,
  };
}

/**
 * May the verdict on the previous head be carried to this one? (#1688)
 *
 * Deny by default: every path that is not the one carry returns `{ carry: false,
 * reason }` with NO label, so a caller cannot apply a verdict from a refusal.
 *
 * Reads exactly these inputs and nothing else. In particular it is given no commit
 * count, subject, actor or "this was a branch update" hint, and would ignore one.
 *
 * @param {object} o
 * @param {string} o.action       the pull_request event action; only `synchronize` carries
 * @param {string|number} o.runAttempt  `github.run_attempt`; only the first attempt carries
 * @param {string} o.headSha      the head under review
 * @param {string} o.beforeSha    the head before this push (`github.event.before`)
 * @param {string|null} o.inputHash  fingerprint of the reviewable input at `headSha`
 * @param {string|null} o.panelKey   fingerprint of the reviewer at this round's base
 * @param {object|null} o.listing  the check-runs API response for `beforeSha`, exactly as
 *                                 GitHub returned it (`{ total_count, check_runs }`); one
 *                                 that is unreadable or not provably whole is a refusal
 * @param {string[]} o.allowlist  parsed AI_REVIEW_BOT_LOGINS
 */
function decideVerdictCarry({ action, runAttempt, headSha, beforeSha, inputHash, panelKey, listing, allowlist } = {}) {
  const no = (reason) => ({ carry: false, reason });
  if (action !== 'synchronize') {
    return no('only a push to an open pull request can carry a verdict; a newly opened or reopened one is always reviewed');
  }
  if (String(runAttempt).trim() !== '1') {
    return no('this is a re-run of the workflow, which always gets a fresh review');
  }
  if (!isCommitSha(headSha)) return no('the head commit under review is not known');
  if (!isCommitSha(beforeSha)) return no('the push reports no previous head commit');
  if (beforeSha === headSha) return no('the previous head is the head under review');
  if (!isHex64(inputHash)) {
    return no('the reviewable input at this head could not be fingerprinted (an empty or unreadable diff)');
  }
  if (!isHex64(panelKey)) {
    return no("the reviewer's own files at the base commit could not be read, so the reviewer cannot be shown to be unchanged");
  }
  const prior = latestHeadRound({ listing, allowlist, headSha: beforeSha });
  if (!prior.complete) return no(prior.reason);
  const short = beforeSha.slice(0, 8);
  if (prior.inputHash !== inputHash) {
    return no(`what the reviewers would be given has changed since ${short} was reviewed`);
  }
  if (prior.panelKey !== panelKey) {
    return no(`the reviewer itself has changed since ${short} was reviewed (role prompts, review scripts, workflow or coverage)`);
  }
  return {
    carry: true,
    label: prior.label,
    fromSha: beforeSha,
    reviewedSha: prior.reviewedSha,
    fromUrl: prior.url,
    reason: `what the reviewers are given, and the reviewer, are unchanged since ${short}`,
  };
}

/**
 * The comment posted for a carried verdict. It has one job the fresh comment does not:
 * make sure nobody reads it as a review. So the heading says carried, the first line
 * says NOT a fresh review, and it names the commit the voters actually ran on.
 *
 * Returns '' unless this is a pass with a real source - a carried comment is never
 * rendered for anything else.
 *
 * Contains no verdict block, deliberately: the shepherd takes its findings from the
 * LAST verdict block on the thread, and this must not shadow the real review's.
 */
function renderCarriedComment({ label, headSha, fromSha, reviewedSha, fromUrl } = {}) {
  if (label !== PASS) return '';
  if (!isCommitSha(headSha) || !isCommitSha(fromSha) || !isCommitSha(reviewedSha)) return '';
  // The URL is GitHub's own `html_url`, but it is interpolated into markdown, so it is
  // shape-checked rather than trusted - and by what it MAY contain, not by what it may
  // not: host, optional port, and a path of plain URL characters. That is every
  // check-run and job URL GitHub issues, and it leaves out everything markdown or HTML
  // gives a meaning to (backtick, quote, star, bracket, pipe, query, fragment). A URL
  // that does not fit is dropped and the comment simply has no link.
  const url = /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/[A-Za-z0-9._~%\/-]*)?$/.test(String(fromUrl == null ? '' : fromUrl))
    ? String(fromUrl)
    : '';
  const where =
    reviewedSha === fromSha
      ? `the voters ran on that commit. Their findings are in the AI review comment posted for it${url ? ` ([its check](${url}))` : ''}.`
      : `that round was itself carried: the voters last ran on commit ${reviewedSha}. Their findings are in the AI review comment posted for that commit${url ? ` ([the round this was carried from](${url}))` : ''}.`;
  return [
    `## 🤖 AI review — \`${label}\` (carried forward: the voters did not run on this commit)`,
    '',
    `> ♻️ **This is NOT a fresh review.** The verdict is carried forward from the review round on commit ${fromSha}.`,
    '>',
    '> **Why:** this push changed nothing a reviewer is given. What the voters are shown for this commit - the pull request\'s own diff against its merge base, plus the approval facts derived from it - is byte-for-byte identical to what was reviewed there, and the reviewer itself (role prompts, review scripts, workflow, coverage) is unchanged. A push that only merges the base branch in, or pushes the same change again, is the usual cause.',
    '>',
    `> **Where the review is:** ${where}`,
    '>',
    '> **What a carried verdict does not cover:** the reviewers can open files outside the diff, and those may have changed with the base branch. A carried pass says nothing about a new interaction between this change and what the base gained since. The required build and tests on this commit are the check for that.',
    '>',
    '> **To get a fresh review of this commit:** re-run this workflow run. A re-run never carries.',
    '',
    '_Carried by the review bot from CI; decided by `planVerdictCarry` in `.github/scripts/ai-review-guard.js`. Only a completed `ai-review:pass` is ever carried - a `changes` or `blocked` round always re-runs the voters. The merge gates are unchanged: `ready-to-merge` still needs its witness on this commit, and a pull request that changes the review machinery still needs a human._',
    '',
    `<!-- ai-review-carried: from=${fromSha} reviewed=${reviewedSha} -->`,
    '',
  ].join('\n');
}

/**
 * Is the disclosure label telling the truth? Null when it is, else the fault in words.
 *
 * The workflow re-reads the pull request's labels after writing them and fails the
 * step on a fault, the way `verdictLabelFault` does for the verdict itself (#1468). A
 * carried verdict that lost its label would be mistaken for a review; a fresh verdict
 * still wearing one would be mistaken for a carry. Neither may be silent.
 */
function carriedLabelFault({ current = [], carried } = {}) {
  const has = Array.isArray(current) && current.includes(CARRIED);
  if (carried === true && !has) {
    return `\`${CARRIED}\` is missing: the verdict on this commit was carried forward, and the label that says so is not on the pull request`;
  }
  if (carried !== true && has) {
    return `\`${CARRIED}\` is still on the pull request, but the verdict on this commit came from a fresh review`;
  }
  return null;
}

/**
 * The single seam the workflow calls (#1688): raw text in, one decision out.
 *
 * Everything the workflow step can get wrong by hand - parsing the API response,
 * hashing, comparing, wording the comment - happens here, where it is tested. The step
 * runs three commands and passes their output through unread:
 *
 *   inputText      `scripts/review-branch.sh <base> <head> --print-input`
 *   lsTree         `git ls-tree <base> -- <PANEL_KEY_PATHS>`
 *   checkRunsJson  the check-runs API response for the previous head, as GitHub
 *                  returned it: ONE request, `per_page` = CHECK_RUNS_PAGE_SIZE, and no
 *                  `--jq` that unwraps it. The `total_count` in it is how a second page
 *                  is noticed (wholeCheckRunListing), so a caller that strips it gets a
 *                  refusal, not a guess.
 *
 * A failed command arrives as empty text, and empty text is always a refusal.
 *
 * The hashes are returned on a refusal too: the round that then runs needs them for
 * its own record, and computing them a second time elsewhere would be a second
 * definition.
 */
function planVerdictCarry(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const inputHash = patchFingerprint(o.inputText);
  const panelKey = reviewPanelKey({ lsTree: o.lsTree, coverage: o.coverage });

  // The response is handed on WHOLE - count and all - and never unwrapped to its
  // `check_runs` here: the count is what lets wholeCheckRunListing tell one page of
  // several from the whole list. null = unparseable, which is reported as unreadable.
  let listing = null;
  try {
    listing = JSON.parse(String(o.checkRunsJson == null ? '' : o.checkRunsJson));
  } catch (_) {
    listing = null;
  }

  const d = decideVerdictCarry({
    action: o.action,
    runAttempt: o.runAttempt,
    headSha: o.headSha,
    beforeSha: o.beforeSha,
    inputHash,
    panelKey,
    listing,
    allowlist: parseAllowlist(o.allowlistRaw),
  });
  const comment = d.carry
    ? renderCarriedComment({
        label: d.label,
        headSha: o.headSha,
        fromSha: d.fromSha,
        reviewedSha: d.reviewedSha,
        fromUrl: d.fromUrl,
      })
    : '';
  // A carry with nothing to post would be an invisible one, so it is not a carry.
  const carry = d.carry === true && comment !== '';
  return {
    carry,
    reason: d.carry && !carry ? 'the carried-verdict comment could not be rendered, so the verdict is not carried' : d.reason,
    label: carry ? d.label : '',
    fromSha: carry ? d.fromSha : '',
    reviewedSha: carry ? d.reviewedSha : '',
    inputHash: inputHash || '',
    panelKey: panelKey || '',
    comment: carry ? comment : '',
  };
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
//
// #1688 — with ONE exception, and it is narrow. `labels` here is the label set at the
// moment of the push, so "there was a pass" is a fact about the OLD head. The strip
// itself runs later, against the LIVE pull request, and removes whatever
// `ai-review:pass` is there by then. That gap never mattered while a review took
// minutes. A carried verdict lands in seconds, so the push-time strip can now arrive
// AFTER the fresh label and remove it - leaving a reviewed head with no verdict label
// and nothing left to put one back.
//
// So the caller may pass `headRound`: latestHeadRound() for the CURRENT head. When it
// is a completed pass recorded by the allowlisted reviewer on this exact commit, the
// label on the pull request is this head's own and is not stripped. In every other
// case - no `headRound` (every caller before #1688), no round on this head yet, a round
// still running, anything but a recorded pass - the strip is exactly what it was. A
// real change therefore still voids the verdict: its new head has no completed round
// until the full panel has finished.
function decideStalenessStrip({ action, labels, headRound } = {}) {
  if (action !== 'synchronize') return { strip: false };
  const set = new Set(Array.isArray(labels) ? labels : []);
  if (!set.has(PASS)) return { strip: false };
  if (headRound && headRound.complete === true && headRound.label === PASS) {
    return {
      strip: false,
      reason: 'the reviewer has already recorded a completed ai-review:pass round for this exact head, so the label is not stale',
    };
  }
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

// #810 — the SECOND head-bound witness: the `ai-review` CHECK-RUN.
//
// WHY THIS EXISTS. #466 made the `ai-review/pass` commit status the SOLE witness
// the gate would accept, and ai-review.yml posts it BEST-EFFORT (`|| true`). That
// POST was returning `403 Resource not accessible by integration` — the reviewer
// App installation lacks `statuses: write` — so the witness was never written on
// ANY commit while the `ai-review:pass` label still landed. `ready-to-merge` was
// therefore unsatisfiable repo-wide and every merge became an `--admin` bypass,
// which skips the entire required gate (the #466/#776 SHA-binding included).
//
// The `ai-review` check-run is posted by the SAME App (via `checks: write`, which
// it does have) on the SAME head SHA, and is an equally strong witness:
//   • SHA-bound INTRINSICALLY — a check-run carries `head_sha`; unlike a status it
//     cannot be re-pointed after the fact. We additionally assert it equals the
//     head we were asked about (defence in depth against a caller querying by the
//     wrong ref).
//   • PROVENANCE is server-attested — `app.slug` is assigned by GitHub, not
//     claimable by the poster. A PR-authored workflow can post a check-run named
//     `ai-review`, but it posts as `github-actions`, which the SAME configured
//     AI_REVIEW_BOT_LOGINS allowlist rejects. (We deliberately match against that
//     existing allowlist rather than pinning an App *id* — a wrong App-id pin is
//     precisely the unsatisfiable-required-check failure #560 fixed.)
//
// STRICTNESS. Only `status: 'completed'` + `conclusion: 'success'` is a pass
// witness. `neutral` (decideReviewCheck's machinery self-exemption) is NOT — a
// machinery PR is exempt from the CHECK, never certified as reviewed — and
// `failure` / `action_required` / anything else is not. Deny-by-default
// throughout: empty allowlist, unknown app, missing fields ⇒ not verified.
const PASS_CHECK_NAME = CHECK_NAME;
function verifyHeadPassCheckRun({ checkRuns, allowlist, headSha } = {}) {
  const list = Array.isArray(allowlist) ? allowlist : [];
  if (list.length === 0) {
    return {
      verified: false,
      reason:
        'reviewer-bot allowlist (AI_REVIEW_BOT_LOGINS) is unset — check-run provenance cannot be verified',
    };
  }
  const ours = (Array.isArray(checkRuns) ? checkRuns : []).filter(
    (c) =>
      c &&
      c.name === PASS_CHECK_NAME &&
      // Only enforce the SHA match when the caller told us which head to expect;
      // the workflow queries BY the head ref, so this is a belt-and-braces check.
      (headSha === undefined || c.head_sha === headSha),
  );
  if (ours.length === 0) {
    return {
      verified: false,
      reason: `no \`${PASS_CHECK_NAME}\` check-run on the current head commit — the greenlight does not correspond to this SHA (#810)`,
    };
  }
  // Most-recent wins, so a re-review that later FAILS supersedes an earlier pass.
  const latest = ours.reduce((a, b) => (checkRunTime(b) >= checkRunTime(a) ? b : a));
  if (latest.status !== 'completed') {
    return {
      verified: false,
      reason: `\`${PASS_CHECK_NAME}\` on the current head is still '${sanitizeLogin(latest.status)}', not completed`,
    };
  }
  if (latest.conclusion !== 'success') {
    return {
      verified: false,
      reason: `\`${PASS_CHECK_NAME}\` on the current head concluded '${sanitizeLogin(latest.conclusion)}', not success`,
    };
  }
  const app = latest.app || {};
  // A GitHub App's check-run identity is its `slug`; the allowlist is written in
  // login form (`minspec-sdd[bot]`), so accept either spelling of the same App.
  const identities = [app.slug, app.slug ? `${app.slug}[bot]` : null].filter(Boolean);
  if (!identities.some((id) => isAuthorizedReviewer(id, list))) {
    return {
      verified: false,
      reason: `\`${PASS_CHECK_NAME}\` on the current head was posted by \`${sanitizeLogin(app.slug)}\`, not an allowlisted reviewer`,
    };
  }
  return {
    verified: true,
    reason: `\`${PASS_CHECK_NAME}\`=success on the current head SHA, from an allowlisted reviewer App`,
  };
}

// Sort key for check-runs: completion time, falling back to start time so an
// unfinished run still orders sensibly. Unparseable ⇒ -Infinity (never "latest").
function checkRunTime(c) {
  const t = Date.parse((c && (c.completed_at || c.started_at)) || '');
  return Number.isFinite(t) ? t : -Infinity;
}

// #810 — the head-bound pass witness, from EITHER channel.
//
// The gate needs ONE proof that THIS head SHA was the reviewed one. Two
// independent channels can carry it, each SHA-bound and each provenance-checked
// against the same allowlist: the #466 `ai-review/pass` commit status, and the
// `ai-review` check-run. Requiring BOTH would keep the gate hostage to whichever
// App permission is missing (that is the bug); accepting EITHER removes the
// single point of failure without weakening anything — a forged, stale, machinery
// -exempt, or absent pass fails BOTH channels and the gate stays red.
function verifyHeadPassWitness({ statuses, checkRuns, allowlist, headSha } = {}) {
  const viaStatus = verifyHeadPassStatus({ statuses, allowlist });
  if (viaStatus.verified) return viaStatus;
  const viaCheck = verifyHeadPassCheckRun({ checkRuns, allowlist, headSha });
  if (viaCheck.verified) return viaCheck;
  return {
    verified: false,
    // Lead with the check-run reason: with `statuses: write` missing it is the
    // channel an operator can actually act on, and decideStatus truncates to 140.
    reason: `not bound to this head — ${viaCheck.reason}; and ${viaStatus.reason}`,
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
// #1870 — a `hold:*` label is the maintainer's explicit "no automation lands this"
// (DR-072 §3: "no approval lifts it"). docs-lane already refuses to ARM auto-merge on
// one, but that made docs-lane the SOLE witness: if that job does not run — a
// permissions gap, a triggering change, a cancelled run, or simply removing the
// `docs-lane` label, which makes its own `if:` guard false — an arming a previous run
// already made still stands and the PR lands held. Constitution invariant 2 asks for an
// independent second witness for exactly this shape, and `ready-to-merge` is it: a
// different workflow, required by branch protection, evaluated on every PR event.
//
// Anchored, like docs-lane's `^hold:`, so a label merely CONTAINING "hold"
// (`household-docs`) does not gate.
const HOLD_RE = /^hold:/;  // exported — pinned lock-step to docs-lane.yml's `hold_pattern`

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
  // A hold is decisive and independent of the review: it is red no matter how green
  // the review is, and no amount of re-reviewing clears it.
  const held = [...eff].filter((l) => HOLD_RE.test(l));
  const isGreen = passVerified && headVerified && !eff.has(CHANGES) && held.length === 0;

  let description;
  // Hold is reported FIRST, ahead of the staleness/provenance outcomes, even though
  // those describe actions actually taken. The reader of a red `ready-to-merge` needs
  // the fact that CANNOT be cleared by acting: told "stale pass stripped — re-review
  // required" on a held PR, they would re-review and still be red, with no hint why.
  // The strip/revert remain visible in the job log and the audit comment, so naming
  // the hold here costs no audit trail.
  if (held.length) {
    // Deliberately says nothing about whether the hold can be LIFTED. DR-072 §3's
    // table is per-value — `tier` is liftable ("human review is the designed remedy"),
    // `human` is not ("no keystroke transfers authorship") — so one universal sentence
    // would miscite the very section it points at. This states only what this gate
    // does, which is true for every hold value, and defers the rest to the DR.
    // Reason first, labels last: truncate() cuts the TAIL, so an unbounded pile of
    // hold labels can only cost label names, never the reason.
    description = truncate(
      `held — this gate stays red while a hold:* label is present (DR-072 §3): ${held.join(', ')}`,
    );
  } else if (stalenessStrip) {
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

// DR-063 / SPEC-031 FR-9a — should the `awaiting-approval` "your turn" signal be
// PRESENT on this PR? Pure and side-effect-free so it is unit-testable; ready-to-merge.yml
// applies/removes the label from this boolean on every PR event. Both conditions
// required:
//   - statusState === 'success' — the ready-to-merge gate (decideStatus, the sole
//     authority) is GREEN: a verified, fresh, un-reverted pass with no outstanding
//     `ai-review:changes`. Every stale-strip / forged-revert / changes-flip already
//     drives this to 'failure', so the label is removed with NO extra mirror site.
//   - !autoMergeArmed — the PR will NOT merge itself. A PR with native auto-merge
//     armed (DR-061) merges the instant the gate greens, so it is the ROBOT's turn,
//     never a human's — it must never enter the "my turn" queue.
//   - openBlockers is empty — nothing this PR declared `Blocked by` is still open.
//     A PR waiting on another PR/issue is not a human's turn: pressing merge would
//     land it out of order. #1224 is the case that prompted this (#1247): it read
//     `ai-review:pass` + `awaiting-approval` while genuinely blocked on #1225, so
//     the "my turn" queue was lying about a PR nobody could act on.
//   - !isDraft — a draft cannot be merged at all, so it can never be a human's turn
//     to merge it. Previously drafts entered the queue purely because the gate was
//     green, which is how #1224 showed up there twice over.
//
// Both new conditions fail toward NOT-your-turn. That is the correct direction for
// a positive signal: a missing "your turn" costs a glance at the queue, a false one
// costs a merge nobody should have made.
function shouldAwaitApproval({ statusState, autoMergeArmed, openBlockers, isDraft } = {}) {
  if (isDraft) return false;
  if (Array.isArray(openBlockers) && openBlockers.length > 0) return false;
  return statusState === 'success' && !autoMergeArmed;
}

// #1247 — extract every declared blocking dependency from a PR body. Pure:
// text in → sorted, de-duplicated array of issue/PR NUMBERS out. Empty array for
// null/undefined/no-declaration, so callers need no special-casing.
//
// Returns numbers (not `#N` strings) because the caller's next move is an API
// lookup keyed by number; formatting back to `#N` is a display concern.
function parseBlockedBy(body) {
  const text = String(body == null ? '' : body);
  const found = new Set();
  BLOCKED_BY_LINE_RE.lastIndex = 0;
  let line;
  while ((line = BLOCKED_BY_LINE_RE.exec(text)) !== null) {
    // Only the remainder of the declaring line is scanned for refs, so a `#N`
    // three paragraphs later is never swept into an unrelated declaration — and
    // only its LEADING ref run, so a trailing explanation on the same line
    // cannot either.
    const refRun = BLOCKED_BY_REFS_RE.exec(line[1]);
    if (!refRun) continue;
    const rest = refRun[0];
    ISSUE_REF_RE.lastIndex = 0;
    let ref;
    while ((ref = ISSUE_REF_RE.exec(rest)) !== null) found.add(Number(ref[1]));
  }
  return [...found].sort((a, b) => a - b);
}

// #1247 — should the `blocked-by` label be PRESENT? True iff at least one declared
// blocker is still open. Pure, and the exact complement of the openBlockers arm of
// shouldAwaitApproval, so the two labels can never both be present: one function
// decides, the applier mirrors it.
function shouldMarkBlockedBy({ openBlockers } = {}) {
  return Array.isArray(openBlockers) && openBlockers.length > 0;
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
//
// The check's NAME is the shared `CHECK_NAME` constant declared at the top of
// this module — verifyHeadPassCheckRun (#810) reads check-runs by that same
// constant, so the producer and the verifier cannot drift apart (#822).
//
// #1688 — `carried` ({ fromSha, reviewedSha }) is passed when the verdict on this head
// was carried forward rather than produced by the voters. It changes the WORDS only:
// the title and summary say carried, from which commit, and where the voters last ran.
// The conclusion is computed before `carried` is looked at and is never touched by it,
// and the note is refused on anything that is not a pass with a real source, so it
// cannot dress a `changes` or a `blocked` as something else.
function decideReviewCheck(label, isMachineryPr, carried) {
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

  if (label === PASS && carried && isCommitSha(carried.fromSha) && isCommitSha(carried.reviewedSha)) {
    const { fromSha, reviewedSha } = carried;
    title = `${title} (verdict carried forward from ${fromSha.slice(0, 8)}, voters did not run)`;
    summary =
      '**Carried forward - the voters did not run on this commit.** This push changed ' +
      'nothing a reviewer is given, so the `ai-review:pass` recorded on commit ' +
      `${fromSha} is carried to this one rather than re-reviewed. ` +
      (reviewedSha === fromSha
        ? 'The voters ran on that commit. '
        : `That round was itself carried: the voters last ran on commit ${reviewedSha}. `) +
      'Re-run the workflow run to get a fresh review; a re-run never carries.\n\n' +
      summary;
  }

  return { name: CHECK_NAME, conclusion, title, summary };
}

// #816 — the "summon a human" decision for the ai-review Post step.
//
// `needs-human-review` must mean exactly ONE thing: a human is GENUINELY the next
// actor — NOT merely "AI review has not passed (yet)". That keeps `awaiting-approval`
// (DR-063) the unambiguous positive "my turn" filter, and stops the human queue
// being polluted by PRs the pipeline will remediate on its own.
//
// A human is the next actor at review-time in exactly one case: a MACHINERY PR
// (changed paths match `.github/`/`scripts/`, the SELF_EDIT_KIND==="machinery"
// predicate). A gate cannot certify a change to itself, so such a PR can NEVER
// auto-remediate to a green `ready-to-merge` — a human must clear it (this pairs
// with the `machinery-review-required` check, #596). That holds whether the
// machinery PR's honest code verdict is `ai-review:pass` or `ai-review:changes`.
//
// It is NOT the next actor — so we do NOT summon one — for:
//   • a NORMAL (non-machinery) `ai-review:changes`, BUT ONLY where the
//     remediation lane exists: `remediate-pr.sh` auto-remediates it (bounded
//     attempts) and applies `needs-human-review` ITSELF only at exhaustion
//     (cap / escalate / quarantine / conflict). Flagging it here at t=0 is
//     premature — the #816 retirement. Where that script is ABSENT (a repo that
//     has not adopted the dispatch lane) the retirement would delegate to
//     nothing, so the eager summon is kept. Deny-by-default: the caller must
//     prove the lane exists via `remediationAvailable: true`.
//   • ANY `ai-review:blocked` (machinery or not): the reviewer could not RUN
//     (quota / rate-limit / overload) — retry-able, NOT a verdict on the code; the
//     ai-review-retry workflow re-runs it. Never a human-review situation.
//   • a passing NON-machinery PR: it belongs in `awaiting-approval`, not here.
//
// This governs only the ADVISORY `needs-human-review` label; the load-bearing merge
// hold is `ready-to-merge` (decideStatus), which stays red independently for every
// un-passed / machinery PR — so retiring the eager label can never let anything
// merge early. Pure and side-effect-free (mirrors shouldAwaitApproval /
// decideReviewCheck) so ai-review.yml decides via this SAME tested seam: bash and
// JS cannot drift. Deny-by-default: a missing/unknown label with isMachinery unset
// returns false (advisory not applied; the gate still holds red).
function shouldSummonHumanReview({ label, isMachinery, remediationAvailable } = {}) {
  if (label === BLOCKED) return false; // retry-able — ai-review-retry re-runs it, never a human
  if (isMachinery === true) return true; // a gate cannot certify a change to itself

  // The #816 retirement is only safe where the delegate it names actually
  // exists. It hands a normal `ai-review:changes` to `remediate-pr.sh`, which
  // applies `needs-human-review` ITSELF at exhaustion. A consuming repo that
  // has not adopted the dispatch lane has no such delegate, so retiring the
  // eager summon there routes a flagged PR to nobody: not auto-remediated, not
  // escalated, just quietly abandoned. Merge safety is unaffected either way
  // (`ready-to-merge` holds red independently) — what is lost is liveness.
  //
  // Deny-by-default: summon unless the caller can PROVE the lane exists.
  // `undefined` therefore keeps the eager behaviour, so a caller that does not
  // pass the flag fails safe rather than silently dropping the backstop.
  if (label === CHANGES && remediationAvailable !== true) return true;

  return false;
}

// Is a label-removal API failure safe to ignore? ONLY a 404 (the label is
// already gone — e.g. a concurrent removal). Any other status (rate limit, 5xx,
// 403) means the forged/stale `ai-review:pass` may STILL be present, so the
// caller must NOT swallow it — it must fail the run so the removal is retried
// rather than left silently in place (the fail-open hole this closes).
function isBenignRemovalError(status) {
  return status === 404;
}

/** Every label this workflow uses to assert a verdict. Exactly one may survive. */
const PENDING = 'ai-review:pending';
const VERDICT_LABELS = [PASS, CHANGES, BLOCKED, PENDING];

/**
 * Which verdict labels must go, and what the PR must look like afterwards (#1468).
 *
 * WIRED — ai-review.yml's Post-verdict step calls this to decide its removals, inside
 * the `verdict-label-coherence` block (#1468 step 2).
 *
 * That step used to add the new label and best-effort-remove the others, discarding
 * both the error and the result. When one removal silently failed, the PR carried
 * `ai-review:pass` AND `ai-review:changes` at once, and `ready-to-merge` read the
 * contradiction as "not passed" — a legitimately-passing PR that could never merge,
 * with nothing on its surface explaining why. Observed on #1430.
 *
 * Pure so the rule is testable without a live PR: the caller does the I/O and then
 * checks its own post-state against `expected`.
 *
 * @param {{current?: string[], verdict: string}} o - `current` = labels on the PR now.
 * @returns {{expected: string[], remove: string[], add: string[]}}
 *   `expected` is the FULL verdict-label set that must be present when done — always
 *   exactly the one verdict. Non-verdict labels (docs-lane, needs-human-review, …) are
 *   never touched and never appear here.
 */
function decideVerdictLabels({ current = [], verdict } = {}) {
  if (!VERDICT_LABELS.includes(verdict)) {
    throw new Error(`decideVerdictLabels: unknown verdict "${verdict}"`);
  }
  const present = new Set(current.filter((l) => VERDICT_LABELS.includes(l)));
  return {
    expected: [verdict],
    remove: VERDICT_LABELS.filter((l) => l !== verdict && present.has(l)),
    add: present.has(verdict) ? [] : [verdict],
  };
}

/**
 * Did the post-state land? Returns null when correct, else a human-readable fault.
 *
 * WIRED — ai-review.yml's Post-verdict step re-reads the PR's labels after
 * reconciling them and fails the step when this returns non-null, so a contradictory
 * post-state is loud instead of a silent merge wedge (#1468 step 2). The returned
 * string is surfaced verbatim in the `::error` annotation, which is why it names the
 * labels it actually saw.
 *
 * The two-step split was forced: ai-review.yml loads control scripts from the TRUSTED
 * BASE, so a workflow calling this before it was on main died with
 * `TypeError: g.verdictLabelFault is not a function` (observed on #1472's first
 * attempt). Seam first, caller second.
 */
function verdictLabelFault({ current = [], verdict } = {}) {
  const got = current.filter((l) => VERDICT_LABELS.includes(l)).sort();
  if (got.length === 1 && got[0] === verdict) return null;
  if (got.length === 0) return `no verdict label present; expected exactly [${verdict}]`;
  if (got.length > 1) {
    return `contradictory verdict labels [${got.join(', ')}]; expected exactly [${verdict}]`;
  }
  return `verdict label is [${got[0]}]; expected exactly [${verdict}]`;
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
  BLOCKED_BY,
  shouldAwaitApproval,
  parseBlockedBy,
  shouldMarkBlockedBy,
  shouldSummonHumanReview,
  isQuotaExhaustion,
  isQuotaExhaustionStrict,
  patchFingerprint,
  renderPatchFingerprint,
  parsePatchFingerprint,
  findReattestableVerdict,
  PATCH_FINGERPRINT_PREFIX,
  VOTER_RECORD_PREFIX,
  renderVoterRecord,
  isStructuralVerdictBlock,
  VERDICT_BEGIN_TOKEN,
  VERDICT_END_TOKEN,
  UNAVAILABLE_TOKEN,
  parseVoterRecords,
  selectVotersToRun,
  CARRIED,
  ROUND_RECORD_PREFIX,
  PANEL_KEY_PATHS,
  PANEL_KEY_OPTIONAL_PATHS,
  reviewPanelKey,
  renderRoundRecord,
  parseRoundRecord,
  CHECK_RUNS_PAGE_SIZE,
  wholeCheckRunListing,
  latestHeadRound,
  decideVerdictCarry,
  renderCarriedComment,
  carriedLabelFault,
  planVerdictCarry,
  parseResetInstant,
  VERDICT_SCHEMA,
  defangProtocolTokens,
  renderVerdictBlock,
  parseCliVerdict,
  parseAllowlist,
  isAuthorizedReviewer,
  decideProvenanceRevert,
  decideStalenessStrip,
  verifyPassProvenance,
  verifyHeadPassStatus,
  verifyHeadPassCheckRun,
  verifyHeadPassWitness,
  PASS_STATUS_CONTEXT,
  CHECK_NAME,
  HOLD_RE,
  decideStatus,
  decideReviewCheck,
  isBenignRemovalError,
  sanitizeLogin,
  PENDING,
  VERDICT_LABELS,
  decideVerdictLabels,
  verdictLabelFault,
};
