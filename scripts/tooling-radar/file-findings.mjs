#!/usr/bin/env node
// file-findings.mjs — stage 2 of the weekly tooling radar: turn scan findings
// into bot-attributed GitHub issues.
//
// WHY THIS IS A SEPARATE STAGE, AND WHY IT CONTAINS NO MODEL
// ---------------------------------------------------------
// Stage 1 (`run-radar.sh` → `claude -p`) reads the open web, which is untrusted
// input by definition. Global rule (DR-345, FiverrGigmeister DR-002): never grant
// filesystem or shell tools to a model reading untrusted documents — in `-p` mode
// the Read tool resolves absolute paths outside cwd, so "cwd is the sandbox" is
// false and prompt hygiene is not a control. Stage 1 therefore gets web tools only
// and emits JSON.
//
// This stage holds the credential and does the writing, and there is no model in
// it at all. That split is the whole security story: a hostile page can influence
// the TEXT of an issue, because text is what stage 1 produces, but it cannot reach
// a shell, cannot choose a repository, and cannot promote a watch item into a
// filed one. Every dangerous decision is made here, from a fixed table:
//
//   • the repo is looked up from a category enum — never read from model output;
//   • `gh` is invoked with an argv array via execFileSync, never a shell string,
//     so no amount of quoting inside a title can become a command;
//   • the issue body arrives on stdin, not on the command line;
//   • labels are constants;
//   • every field is length-clamped and stripped of control characters.
//
// FAIL CLOSED, VISIBLY (constitution invariant 2)
// -----------------------------------------------
// Any validation failure, token failure, or `gh` failure exits non-zero with the
// reason on stderr. Nothing here is best-effort and nothing is swallowed with
// `|| true`. A radar that quietly files nothing is indistinguishable from a quiet
// week — that collapse is exactly the silent-gate failure the constitution forbids.
//
// Usage:
//   node file-findings.mjs <findings.json>              # file for real
//   node file-findings.mjs <findings.json> --dry-run    # print, touch nothing
//
// Env:
//   RADAR_MAX_ISSUES   cap per run (default 3). Overflow is REPORTED, never silent.
//   RADAR_TOKEN_CMD    App-token minter (default ~/.claude/scripts/gh-app-token.sh)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Category → repository. This table is the trust boundary: a finding names a
 * category from a closed enum and this map turns it into a repo. Model output
 * never supplies a repository name, so a compromised scan cannot redirect issues
 * into a repo nobody watches — or into somebody else's, which would breach the
 * constitution's third invariant (MinSpec's blast radius is the project that
 * opted in).
 */
export const CATEGORY_REPO = {
  minspec: 'AIClarityAU/minspec',
  scrooge: 'AIClarityAU/scroogellm',
  sealbox: 'AIClarityAU/sealbox',
};

const ALLOWED_TYPES = new Set(['research', 'measure', 'feat', 'fix', 'chore']);
const LABELS = 'idea,inbox';
const KEY_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const MAX_TITLE = 80;
const MAX_BODY = 8000;
const MAX_URL = 500;

/** Marker line embedded in every filed body; the dedupe search keys on it. */
export const markerFor = (key) => `radar-key: ${key}`;

/**
 * Strip control characters, and for single-line fields collapse whitespace so a
 * title cannot span lines. Controls are stripped rather than escaped because
 * nothing downstream has a legitimate use for them.
 */
export function clean(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  // Newline and tab survive the strip in BOTH modes. In a multiline body they are
  // content; in a single-line field they must reach the whitespace collapse below,
  // so that "a\nb" becomes "a b" rather than "ab" — stripping them outright glues
  // two words together and silently rewrites the meaning of a title.
  const stripped = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return multiline ? stripped.trim() : stripped.replace(/\s+/g, ' ').trim();
}

/**
 * The adoption checklist appended to every filed issue.
 *
 * A tool that was installed but never configured, never triggered, and never
 * monitored is worse than one that was skipped: it still costs review attention
 * and it looks like coverage. So the issue cannot be closed on "installed" — it
 * has to account for the whole path, including the honest exit of deciding not to
 * adopt. That negative result is a real deliverable: recorded, it stops the radar
 * from re-proposing the same tool every quarter.
 */
export const ADOPTION_CHECKLIST = [
  '## Adoption checklist',
  '',
  'Installing a tool is not adopting it. Do not close this on "installed" — tick',
  'every line or say why it does not apply:',
  '',
  '- [ ] **Evaluated** — measured on our own workload, not the vendor benchmark.',
  '- [ ] **Configured** — settings committed somewhere versioned, not left on',
  "      defaults in one machine's home directory.",
  '- [ ] **Triggered** — something actually invokes it on a schedule or an event,',
  '      and that trigger is named here.',
  '- [ ] **Monitored** — a failure is visible without anyone thinking to look.',
  '      Name the surface (unit status, health file, CI check, session-start line).',
  '- [ ] **Verified live** — observed doing its job at least once after install,',
  '      with the evidence linked.',
  '- [ ] **Reversible** — the removal path is one command, and it is written down.',
  '',
  'If the answer turns out to be "not adopting", close with the negative result',
  'recorded so the radar stops re-proposing it.',
].join('\n');

/**
 * Validate one finding into a filing plan, or throw.
 *
 * Throwing rather than skipping is deliberate for structural problems: a scan that
 * emits an unknown category is a scan whose contract drifted, and silently dropping
 * the item would hide that. Items the scan marked `act: false` are filtered out
 * before this point — they are watch items, not failures.
 */
export function planFinding(finding, index) {
  const where = `findings[${index}]`;
  if (!finding || typeof finding !== 'object') throw new Error(`${where}: not an object`);

  const key = clean(finding.key).toLowerCase();
  if (!KEY_RE.test(key)) {
    throw new Error(`${where}: key ${JSON.stringify(finding.key)} fails ${KEY_RE}`);
  }

  const repo = CATEGORY_REPO[clean(finding.category).toLowerCase()];
  if (!repo) {
    throw new Error(
      `${where}: unknown category ${JSON.stringify(finding.category)} ` +
        `(expected one of ${Object.keys(CATEGORY_REPO).join(', ')})`,
    );
  }

  const type = clean(finding.type).toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${where}: unknown type ${JSON.stringify(finding.type)}`);
  }

  const rawTitle = clean(finding.title);
  if (!rawTitle) throw new Error(`${where}: empty title`);
  // The type prefix also guarantees the title never begins with a dash. That does
  // not matter for execFileSync, which takes an argv array, but it makes the
  // property structural rather than a fact about one call site.
  const title = `${type}: ${rawTitle.slice(0, MAX_TITLE)}`;

  const url = clean(finding.url).slice(0, MAX_URL);
  if (!/^https:\/\/\S+$/.test(url)) {
    throw new Error(`${where}: url must be https, got ${JSON.stringify(finding.url)}`);
  }

  const bodyText = clean(finding.body_markdown, { multiline: true }).slice(0, MAX_BODY);
  if (!bodyText) throw new Error(`${where}: empty body_markdown`);

  const dated = clean(finding.dated);
  const body = [
    bodyText,
    '',
    ADOPTION_CHECKLIST,
    '',
    '---',
    `Source: ${url}${dated ? ` (dated ${dated})` : ''}`,
    '',
    'Filed automatically by the weekly tooling radar (`scripts/tooling-radar/`).',
    'The scan stage had web access only and no shell or filesystem tools, so the',
    'text above originates from untrusted pages: verify any number before acting on',
    'it. Routing, labels, and this footer come from the filer, not from the model.',
    '',
    markerFor(key),
  ].join('\n');

  return { key, repo, title, body };
}

/** Mint an App installation token so the issue is authored by the bot, not a human. */
export function mintToken(tokenCmd) {
  try {
    return execFileSync(tokenCmd, { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(
      `could not mint an App installation token via ${tokenCmd}: ${error.message}. ` +
        'Refusing to fall back to the ambient gh credential — that would file agent ' +
        'work under the human account and make the audit trail lie.',
    );
  }
}

/**
 * Has this key been filed before? Searches open AND closed issues, so a finding
 * that was filed and rejected months ago does not return every Monday.
 */
export function alreadyFiled(repo, key, run) {
  const out = run('gh', [
    'issue', 'list',
    '--repo', repo,
    '--state', 'all',
    '--search', `"${markerFor(key)}" in:body`,
    '--json', 'number',
    '--limit', '5',
  ]);
  const hits = JSON.parse(out || '[]');
  return Array.isArray(hits) && hits.length > 0 ? hits[0].number : null;
}

export function main(argv, deps = {}) {
  const {
    log = console.log,
    warn = console.error,
    readFile = (p) => readFileSync(p, 'utf8'),
    tokenCmd = process.env.RADAR_TOKEN_CMD ||
      path.join(homedir(), '.claude', 'scripts', 'gh-app-token.sh'),
    maxIssues = Number(process.env.RADAR_MAX_ISSUES || 3),
  } = deps;

  const dryRun = argv.includes('--dry-run');
  const file = argv.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('usage: file-findings.mjs <findings.json> [--dry-run]');

  const parsed = JSON.parse(readFile(file));
  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const actionable = findings.filter((f) => f && f.act === true);

  log(
    `radar: ${findings.length} finding(s), ${actionable.length} actionable, ` +
      `verdict=${clean(parsed.verdict) || 'unstated'}`,
  );

  if (actionable.length === 0) {
    log('radar: nothing actionable — a quiet week is a valid result, filing nothing.');
    return 0;
  }

  // Plan everything BEFORE filing anything, so a malformed item nine entries down
  // fails the run instead of leaving eight issues filed and the rest dropped.
  const plans = actionable.map((f, i) => planFinding(f, i));

  // Cap, but never silently: an unreported truncation reads as "that was all there
  // was", which is the same lie as a silent gate.
  const filing = plans.slice(0, maxIssues);
  const dropped = plans.slice(maxIssues);
  if (dropped.length > 0) {
    warn(
      `radar: CAP HIT — filing ${filing.length} of ${plans.length}; deferred to a later ` +
        `run: ${dropped.map((p) => p.key).join(', ')} (raise RADAR_MAX_ISSUES to file more)`,
    );
  }

  let run = deps.run;
  if (!run) {
    const token = dryRun ? null : mintToken(tokenCmd);
    run = (cmd, args, opts = {}) =>
      execFileSync(cmd, args, {
        encoding: 'utf8',
        input: opts.input,
        env: token ? { ...process.env, GH_TOKEN: token } : process.env,
      });
  }

  let filed = 0;
  for (const plan of filing) {
    const existing = alreadyFiled(plan.repo, plan.key, run);
    if (existing) {
      log(`radar: skip ${plan.key} — already tracked as ${plan.repo}#${existing}`);
      continue;
    }
    if (dryRun) {
      log(`radar: [dry-run] would file ${plan.repo}: ${plan.title}`);
      continue;
    }
    const url = run(
      'gh',
      ['issue', 'create', '--repo', plan.repo, '--label', LABELS, '--title', plan.title,
        '--body-file', '-'],
      { input: plan.body },
    );
    log(`radar: filed ${plan.key} → ${clean(url)}`);
    filed += 1;
  }

  log(`radar: done, ${filed} issue(s) filed`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`radar: FAILED — ${error.message}`);
    process.exit(1);
  }
}
