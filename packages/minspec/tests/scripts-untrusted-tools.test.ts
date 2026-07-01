/**
 * T0 — Invariant: no `claude -p` call-site grants a filesystem/network tool over
 * UNTRUSTED issue content.
 *
 * Enforces the global `claude -p` Subprocess Usage Rule #1 (DR-345 /
 * FiverrGigmeister DR-002) inside MinSpec's own dev-time dispatch scripts:
 * granting a filesystem/network tool (Read/Write/Edit/Glob/Grep/WebFetch) to a
 * `claude -p` invocation whose prompt embeds an untrusted issue body is an
 * arbitrary-file-read / credential-exfiltration hole — `claude -p` resolves
 * absolute paths OUTSIDE cwd, so cwd is not a sandbox boundary and the prose
 * "treat as untrusted" mitigation is soft and bypassable. The tool must be
 * ELIMINATED, not justified.
 *
 * This gate makes that bad state un-committable: it scans every `scripts/*.sh`
 * for a `claude -p` invocation that (a) embeds untrusted content AND (b) grants
 * any filesystem/network tool, and FAILS if such a call-site exists outside an
 * explicit, documented allowlist.
 *
 * It went RED on the pre-fix `scripts/triage-inbox.sh` (issue harvest316/minspec#344),
 * which ran `claude -p "$USER_CONTENT" --allowedTools "Read"` with $USER_CONTENT
 * embedding the untrusted ${ISSUE_BODY}. The fix removes that tool grant.
 *
 * KNOWN, SEPARATELY-TRACKED EXCEPTION (issue #344 contract item 4):
 * `scripts/dispatch-issue.sh` also embeds the untrusted issue body and grants
 * Read/Edit/Write/Glob/Grep to the dev agent. Its threat model differs (the
 * agent holds NO credentials, runs in an isolated worktree, and the parent does
 * all credentialed/network ops — see the long comment block in that script), so
 * whether/how to tighten it is a SEPARATE decision, not part of this fix. It is
 * therefore allowlisted here. Any NEW call-site is a fresh violation and must
 * either eliminate the tool or be deliberately added with its own rationale.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Locate scripts/ from the repo root (works in a linked worktree too). ──────
// Walk up from this test file until we find a directory containing both
// `scripts/` and `package.json` — that is the repo (or worktree) root.
function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

// Filesystem / network tools that grant data access. Granting ANY of these to a
// `claude -p` call over untrusted input is the forbidden pattern.
const FORBIDDEN_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch'];

// A call-site embeds untrusted content if its script wraps user-supplied issue
// text in the agreed marker OR derives the prompt from a fetched issue body.
const UNTRUSTED_MARKERS = [
  /<untrusted_issue_body>/,
  /\bISSUE_BODY\b/,
  /gh issue view/,
];

// Scripts whose `claude -p` + tool-grant is a SEPARATE, deliberately-tracked
// decision (NOT in scope for the triage fix). See the file header + issue #344
// contract item 4. Adding a script here must be a conscious security decision.
const ALLOWLISTED_SCRIPTS = new Set<string>([
  'dispatch-issue.sh',
]);

interface CallSite {
  script: string;
  grantedForbiddenTools: string[];
  toolFlagLine: string;
}

/**
 * Scan one shell script for a `claude -p`/`claude --print` invocation that BOTH
 * embeds untrusted content AND grants a filesystem/network tool. Returns the
 * violating call-site, or null if the script is clean.
 *
 * Detection is line-oriented and tolerant of backslash-continued invocations:
 * once a `claude -p` line is seen, we inspect the surrounding window (the whole
 * script, since these scripts are small) for a `--tools`/`--allowedTools`/
 * `--allowed-tools` flag whose value names a forbidden tool. Untrusted-content
 * embedding is judged at the whole-script level (the prompt variable is built
 * earlier in the same script).
 */
function scanScript(filePath: string): CallSite | null {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Strip full-line comments so a `#`-commented example can't trip the gate,
  // but keep code. (Inline trailing comments are rare in these flag lines and
  // harmless to keep.)
  const codeLines = content
    .split('\n')
    .filter((l) => !/^\s*#/.test(l));
  const code = codeLines.join('\n');

  // (1) Does this script invoke `claude -p` / `claude --print`?
  const invokesClaudeP = /\bclaude\s+(-p|--print)\b/.test(code);
  if (!invokesClaudeP) return null;

  // (2) Does it embed untrusted issue content?
  const embedsUntrusted = UNTRUSTED_MARKERS.some((re) => re.test(code));
  if (!embedsUntrusted) return null;

  // (3) Does it grant a filesystem/network tool via a tool flag?
  //     Match --tools / --allowedTools / --allowed-tools and capture the value
  //     up to end-of-line (covers quoted comma/space lists and $VARs assigned
  //     elsewhere — for $VAR values we also scan the variable's definition).
  const grantedForbidden = new Set<string>();
  let toolFlagLine = '';

  const flagRe = /--(?:tools|allowed-?[Tt]ools)\s+("([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = flagRe.exec(code)) !== null) {
    const rawValue = m[2] ?? m[3] ?? m[4] ?? '';
    // The value may be a literal tool list OR a shell variable ($ALLOWED_TOOLS).
    // Resolve a referenced variable to its assigned literal(s) in the script.
    let effectiveValue = rawValue;
    const varRef = rawValue.match(/^\$\{?(\w+)\}?$/);
    if (varRef) {
      const varName = varRef[1];
      const assignRe = new RegExp(`\\b${varName}=(?:"([^"]*)"|'([^']*)'|(\\S+))`);
      const a = code.match(assignRe);
      if (a) effectiveValue = a[1] ?? a[2] ?? a[3] ?? '';
    }
    for (const tool of FORBIDDEN_TOOLS) {
      // Word-boundary match so "Read" matches "Read" / "Read,Edit" but a tool
      // like "Bash(npm test)" does not spuriously match.
      const toolRe = new RegExp(`\\b${tool}\\b`);
      if (toolRe.test(effectiveValue)) grantedForbidden.add(tool);
    }
    if (grantedForbidden.size > 0 && !toolFlagLine) {
      toolFlagLine = m[0];
    }
  }

  if (grantedForbidden.size === 0) return null;

  return {
    script: path.basename(filePath),
    grantedForbiddenTools: [...grantedForbidden].sort(),
    toolFlagLine,
  };
}

describe('Invariant: no `claude -p` call-site grants a filesystem/network tool over untrusted input', () => {
  const scriptsDir = findScriptsDir();

  function findAllViolations(): CallSite[] {
    const files = fs
      .readdirSync(scriptsDir)
      .filter((f) => f.endsWith('.sh'))
      .map((f) => path.join(scriptsDir, f));

    const violations: CallSite[] = [];
    for (const file of files) {
      const v = scanScript(file);
      if (v) violations.push(v);
    }
    return violations;
  }

  it('scripts/ exists and contains shell scripts to scan', () => {
    const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.sh'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('no non-allowlisted scripts/*.sh grants a filesystem/network tool to a `claude -p` over untrusted issue content', () => {
    const all = findAllViolations();

    // Report EVERY raw finding (including allowlisted ones) so a regression in
    // the allowlisted set is at least visible in test output.
    if (all.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        'claude -p untrusted-input tool grants found:\n' +
          all
            .map(
              (v) =>
                `  ${v.script}: grants [${v.grantedForbiddenTools.join(', ')}]` +
                (ALLOWLISTED_SCRIPTS.has(v.script) ? ' (ALLOWLISTED — separate decision)' : ''),
            )
            .join('\n'),
      );
    }

    const enforced = all.filter((v) => !ALLOWLISTED_SCRIPTS.has(v.script));

    expect(
      enforced,
      enforced.length > 0
        ? `These scripts grant a filesystem/network tool (${enforced
            .map((v) => v.grantedForbiddenTools.join('/'))
            .join('; ')}) to a \`claude -p\` over untrusted issue content. ` +
            'Per the global `claude -p` Subprocess Rule #1, ELIMINATE the tool — do not rely on anti-injection prose. ' +
            `Offending scripts: ${enforced.map((v) => v.script).join(', ')}.`
        : 'no violations',
    ).toEqual([]);
  });
});
