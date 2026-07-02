'use strict';

// ---------------------------------------------------------------------------
// ai-review label-integrity guard — pure decision helpers + orchestration.
//
// Consumed by .github/workflows/ai-review-guard.yml via actions/github-script.
// Kept as a separate, unit-tested module (see ai-review-guard.test.js, run with
// `node --test .github/scripts/`) so the deployed decision logic IS the tested
// logic — there is no inline copy in the workflow that could drift out of sync.
// A drifted security gate is exactly the "the signpost lies" failure mode this
// guard exists to prevent.
//
// SECURITY: every value that originates from the webhook payload (label name,
// sender login, PR title / branch) is handled ONLY as JS data and passed to the
// REST API as parameters. Nothing here is ever interpolated into a shell.
// ---------------------------------------------------------------------------

const PASS_LABEL = 'ai-review:pass';
const CHANGES_LABEL = 'ai-review:changes';
const STATUS_CONTEXT = 'ready-to-merge';

// The built-in GitHub Actions identity. When the reviewer automation applies the
// pass label from a workflow that uses GITHUB_TOKEN, the webhook `sender.login`
// is this. Always trusted by default; owners extend the allowlist for a
// dedicated reviewer App whose sender.login is `<app-slug>[bot]`.
const DEFAULT_REVIEWER_LOGIN = 'github-actions[bot]';

/**
 * Parse the `AI_REVIEW_BOT_LOGINS` repo-variable string into a lowercased Set of
 * authorized reviewer logins. Accepts comma / whitespace / newline separators.
 * The built-in Actions identity is always included so the common case
 * (reviewer posts via GITHUB_TOKEN) needs zero configuration.
 *
 * @param {string|undefined|null} raw
 * @returns {Set<string>}
 */
function parseAllowlist(raw) {
  const set = new Set([DEFAULT_REVIEWER_LOGIN]);
  if (typeof raw === 'string') {
    for (const token of raw.split(/[\s,]+/)) {
      const login = token.trim().toLowerCase();
      if (login) set.add(login);
    }
  }
  return set;
}

/**
 * Provenance decision (#397): was the just-applied pass label applied by an
 * authorized reviewer identity? Pure — no I/O.
 *
 * @param {{ labelName: string, senderLogin: string, allowlist: Set<string> }} p
 * @returns {{ revert: boolean, reason: string }}
 */
function evaluateProvenance({ labelName, senderLogin, allowlist }) {
  if (labelName !== PASS_LABEL) {
    return { revert: false, reason: 'label-not-guarded' };
  }
  const login = String(senderLogin || '').toLowerCase();
  if (allowlist.has(login)) {
    return { revert: false, reason: 'authorized-reviewer' };
  }
  return { revert: true, reason: 'unauthorized-actor' };
}

/**
 * Staleness decision (#359): on a new-commit (synchronize) event, must the
 * existing pass label be stripped? Pure. True iff the PR currently carries it —
 * a greenlight earned on an older head must not survive unreviewed new commits.
 *
 * @param {{ labelNames: string[] }} p
 * @returns {{ strip: boolean, reason: string }}
 */
function evaluateStaleness({ labelNames }) {
  const has = Array.isArray(labelNames) && labelNames.includes(PASS_LABEL);
  return has
    ? { strip: true, reason: 'stale-pass-on-new-head' }
    : { strip: false, reason: 'no-pass-label' };
}

/**
 * Remove the pass label, re-post `ready-to-merge` as failing, and leave an audit
 * comment. Shared by the provenance-revert and staleness-strip paths.
 *
 * Removing the label with GITHUB_TOKEN does NOT retrigger ready-to-merge.yml
 * (events authored by the built-in token do not start new workflow runs), so the
 * guard must set the status failing itself rather than rely on a re-run.
 */
async function stripPassAndFail(
  { github, context, core },
  { headSha, prNumber, commentBody, logLine },
) {
  const { owner, repo } = context.repo;

  // 1) Revert the label. Tolerate a 404 (already removed by a racing event).
  try {
    await github.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: prNumber,
      name: PASS_LABEL,
    });
  } catch (err) {
    if (!err || err.status !== 404) throw err;
  }

  // 2) Re-post ready-to-merge = failure on the PR HEAD sha.
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state: 'failure',
    context: STATUS_CONTEXT,
    description: 'ai-review:pass reverted by label-guard',
  });

  // 3) Audit trail.
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: commentBody,
  });

  core.warning(logLine);
}

/**
 * Orchestrate the guard for a single `pull_request` event. `env` is injected for
 * testability; the workflow calls run({ github, context, core }) and it defaults
 * to process.env.
 *
 * @param {{ github: any, context: any, core: any, env?: NodeJS.ProcessEnv }} p
 */
async function run({ github, context, core, env = process.env }) {
  const action = context.payload.action;
  const pr = context.payload.pull_request;
  if (!pr) {
    core.info('ai-review-guard: no pull_request in payload; nothing to guard.');
    return;
  }
  const prNumber = pr.number;
  const headSha = pr.head.sha;

  if (action === 'labeled') {
    const labelName = context.payload.label && context.payload.label.name;
    const senderLogin = context.payload.sender && context.payload.sender.login;
    const allowlist = parseAllowlist(env.AI_REVIEW_BOT_LOGINS);
    const { revert, reason } = evaluateProvenance({ labelName, senderLogin, allowlist });

    if (!revert) {
      core.info(
        `ai-review-guard: provenance ok (${reason}) — label='${labelName}' sender='${senderLogin}'.`,
      );
      return;
    }

    const trusted = [...allowlist].join(', ');
    const commentBody =
      `### 🔒 ai-review label-guard reverted \`${PASS_LABEL}\`\n\n` +
      `\`${PASS_LABEL}\` was applied by @${senderLogin}, who is **not** an ` +
      `authorized reviewer identity — the label has been removed and ` +
      `\`ready-to-merge\` set to failing.\n\n` +
      `Presence of \`${PASS_LABEL}\` must mean a real independent review ran ` +
      `(#397). Only the reviewer automation may apply it.\n\n` +
      `Authorized reviewer logins: ${trusted}\n` +
      `_Owners extend this via the \`AI_REVIEW_BOT_LOGINS\` repo variable._`;

    await stripPassAndFail(
      { github, context, core },
      {
        headSha,
        prNumber,
        commentBody,
        logLine: `Reverted forged ${PASS_LABEL} on PR #${prNumber} applied by ${senderLogin} (unauthorized).`,
      },
    );
    return;
  }

  if (action === 'synchronize') {
    const labelNames = (pr.labels || []).map((l) => l.name);
    const { strip, reason } = evaluateStaleness({ labelNames });
    if (!strip) {
      core.info(`ai-review-guard: no stale pass label to strip (${reason}) on PR #${prNumber}.`);
      return;
    }

    const commentBody =
      `### ♻️ ai-review label-guard stripped \`${PASS_LABEL}\` (new commits)\n\n` +
      `New commits were pushed after the AI review passed, so the stale ` +
      `greenlight was removed and \`ready-to-merge\` set to failing. A fresh ` +
      `independent review must pass again on the new head (#359).`;

    await stripPassAndFail(
      { github, context, core },
      {
        headSha,
        prNumber,
        commentBody,
        logLine: `Stripped stale ${PASS_LABEL} on PR #${prNumber} after new commits.`,
      },
    );
    return;
  }

  core.info(`ai-review-guard: no action for event action='${action}'.`);
}

module.exports = {
  PASS_LABEL,
  CHANGES_LABEL,
  STATUS_CONTEXT,
  DEFAULT_REVIEWER_LOGIN,
  parseAllowlist,
  evaluateProvenance,
  evaluateStaleness,
  stripPassAndFail,
  run,
};
