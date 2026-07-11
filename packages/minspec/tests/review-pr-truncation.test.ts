/**
 * T3 — review-pr.sh truncation backstop (#427 regression).
 *
 * The reviewer agent gets a NOTE asking it to treat a truncated diff as
 * blocking, but review-decide.sh (the deterministic gate) never sees a
 * truncation signal — only the model's verdict block. A model that ignores
 * the note and emits `verdict: pass` / `blocking: 0` would previously sail
 * through the gate and green a diff it never fully saw: the one place a
 * false-green depended solely on LLM obedience.
 *
 * Fix: review-pr.sh now computes the label in two steps — GATE_LABEL (from
 * review-decide.sh, as before) and then a deterministic override,
 * `truncation_backstop_label()`, that forces `ai-review:changes` whenever the
 * diff was truncated, regardless of GATE_LABEL. That function is extracted
 * from the live script text below (not re-typed here) so a regression in the
 * shipped file is what this test actually catches, not a drifted copy.
 *
 * Why a pure-function test and not a full gh/claude-stubbed end-to-end run:
 * DIFF_CAP is 180000 bytes. Historically the truncated diff was embedded as a
 * SINGLE argv element in `claude -p "$USER_CONTENT"`, and Linux caps any single
 * execve() argument at MAX_ARG_STRLEN (32 pages = 131072 bytes) — confirmed
 * empirically here (a 131072-byte arg fails with E2BIG; 131000 succeeds). Since
 * 180000 > 131072, the `claude` call in the truncated-diff branch would fail with
 * "Argument list too long" before the reviewer ever ran (#477 / #624). That is
 * now fixed: the prompt reaches claude via a temp file on STDIN (no ARG_MAX
 * bound), so the truncated path executes and this backstop is what forces
 * `ai-review:changes`. This remains a pure-function test of that backstop rather
 * than a claude-stubbed end-to-end run — testing the decision function directly
 * is more reliable and exercises exactly the new logic. A lightweight end-to-end
 * run covers the untruncated path to prove the call site is wired correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const REVIEW_PR = path.resolve(__dirname, '../../../scripts/review-pr.sh');
const REVIEW_PR_SRC = fs.readFileSync(REVIEW_PR, 'utf-8');

// Extract the `truncation_backstop_label()` function body verbatim from the
// live script (between its `truncation_backstop_label() {` line and the
// matching closing `}` at column 0), so this test runs the SHIPPED code, not
// a reimplementation that could silently drift from it.
function extractFunction(name: string): string {
  const lines = REVIEW_PR_SRC.split('\n');
  const startIdx = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (startIdx === -1) {
    throw new Error(`extractFunction: ${name}() not found in ${REVIEW_PR}`);
  }
  const endIdx = lines.findIndex((l, i) => i > startIdx && l === '}');
  if (endIdx === -1) {
    throw new Error(`extractFunction: closing brace for ${name}() not found`);
  }
  return lines.slice(startIdx, endIdx + 1).join('\n');
}

function truncationBackstopLabel(diffNote: string, gateLabel: string): string {
  const fnSrc = extractFunction('truncation_backstop_label');
  return execFileSync(
    'bash',
    ['-c', `${fnSrc}\ntruncation_backstop_label "$1" "$2"`, '_', diffNote, gateLabel],
    { encoding: 'utf-8' },
  ).trim();
}

describe('truncation_backstop_label() — pure decision function (#427)', () => {
  it('untruncated (empty note) → passes GATE_LABEL through unchanged (pass)', () => {
    expect(truncationBackstopLabel('', 'ai-review:pass')).toBe('ai-review:pass');
  });

  it('untruncated (empty note) → passes GATE_LABEL through unchanged (changes)', () => {
    expect(truncationBackstopLabel('', 'ai-review:changes')).toBe('ai-review:changes');
  });

  it('truncated + gate says pass → forced to ai-review:changes (the #427 bug)', () => {
    // This is the exact scenario #427 describes: a model that ignored the
    // truncation note and emitted a clean pass. The override must win
    // regardless of what the (untrusted, possibly-noncompliant) model said.
    expect(truncationBackstopLabel('[NOTE: diff truncated...]', 'ai-review:pass')).toBe(
      'ai-review:changes',
    );
  });

  it('truncated + gate already says changes → stays ai-review:changes', () => {
    expect(truncationBackstopLabel('[NOTE: diff truncated...]', 'ai-review:changes')).toBe(
      'ai-review:changes',
    );
  });
});

// --- Lightweight end-to-end sanity check (untruncated path only) ---------
//
// Confirms the call site actually wires GATE_LABEL through
// truncation_backstop_label() and that a small (well under DIFF_CAP) diff's
// clean pass verdict still reaches `gh pr edit --add-label` as
// `ai-review:pass` — i.e. the fix didn't regress the normal, non-truncated
// path. Stubs `gh` and `claude` on PATH; does not attempt the truncated path
// (see file header for why that can't run as a real subprocess here).

const FAKE_GH = `#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "pr view")
    cat "$FAKE_PR_VIEW_JSON_FILE"
    ;;
  "pr diff")
    cat "$FAKE_DIFF_FILE"
    ;;
  "pr checks")
    echo "lint pass 0s"
    ;;
  "pr comment")
    prev=""
    for arg in "$@"; do
      if [[ "$prev" == "--body" ]]; then
        printf '%s' "$arg" > "$FAKE_COMMENT_BODY_FILE"
      fi
      prev="$arg"
    done
    ;;
  "pr edit")
    printf '%s\\n' "$*" >> "$FAKE_EDIT_LOG_FILE"
    ;;
  *)
    echo "fake-gh: unhandled subcommand: $*" >&2
    exit 1
    ;;
esac
`;

const FAKE_CLAUDE = `#!/usr/bin/env bash
cat "$FAKE_CLAUDE_OUTPUT_FILE"
`;

const CLEAN_PASS_VERDICT = [
  'REVIEW_VERDICT_BEGIN',
  'verdict: pass',
  'blocking: 0',
  'summary: nothing found',
  'REVIEW_VERDICT_END',
  '',
].join('\n');

let scratch: string;
let binDir: string;

function writeExecutable(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
}

function addedLabel(editLog: string): string | undefined {
  const line = editLog
    .split('\n')
    .reverse()
    .find((l) => l.includes('--add-label'));
  return line?.trim().split(/\s+/).pop();
}

describe('review-pr.sh — end-to-end sanity (untruncated path unaffected)', () => {
  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'review-pr-scratch-'));
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-pr-bin-'));
    writeExecutable(path.join(binDir, 'gh'), FAKE_GH);
    writeExecutable(path.join(binDir, 'claude'), FAKE_CLAUDE);
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it('small diff + clean pass verdict → ai-review:pass, no truncation notice', () => {
    const prViewFile = path.join(scratch, 'pr-view.json');
    const diffFile = path.join(scratch, 'pr.diff');
    const claudeOutFile = path.join(scratch, 'claude-output.txt');
    const commentBodyFile = path.join(scratch, 'comment-body.txt');
    const editLogFile = path.join(scratch, 'edit-calls.log');

    fs.writeFileSync(
      prViewFile,
      JSON.stringify({
        title: 'Test PR',
        body: 'test body',
        files: [{ path: 'scripts/review-pr.sh' }],
        headRefName: 'test-branch',
        state: 'OPEN',
      }),
    );
    fs.writeFileSync(diffFile, 'diff --git a/x b/x\n+small change\n');
    fs.writeFileSync(claudeOutFile, CLEAN_PASS_VERDICT);
    fs.writeFileSync(commentBodyFile, '');
    fs.writeFileSync(editLogFile, '');

    execFileSync('bash', [REVIEW_PR, '999', '--repo', 'fake/repo'], {
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        FAKE_PR_VIEW_JSON_FILE: prViewFile,
        FAKE_DIFF_FILE: diffFile,
        FAKE_CLAUDE_OUTPUT_FILE: claudeOutFile,
        FAKE_COMMENT_BODY_FILE: commentBodyFile,
        FAKE_EDIT_LOG_FILE: editLogFile,
      },
      encoding: 'utf-8',
    });

    const editLog = fs.readFileSync(editLogFile, 'utf-8');
    const commentBody = fs.readFileSync(commentBodyFile, 'utf-8');

    expect(addedLabel(editLog)).toBe('ai-review:pass');
    expect(commentBody).not.toContain('Diff truncated');
  });
});
