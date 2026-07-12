/**
 * T1 — egress-scan.sh: pre-publish exfil/secret guard (#358).
 *
 * The dev agent runs over an UNTRUSTED issue body and, though credential-free, can
 * WRITE into the material the parent publishes (the committed diff, .agent-summary.md,
 * .review-signals.json). This scanner is the fail-closed egress guard the parent runs
 * BEFORE any push/PR/comment. A false CLEAN is the worst outcome (it publishes the
 * secret), so:
 *   • it MUST block on sk-ant / AWS key / high-entropy blob / PEM private-key content,
 *   • it MUST fail CLOSED on unreadable / no input, and
 *   • it MUST NOT false-block the high-entropy strings this repo legitimately commits
 *     (sha256/git hashes, npm-lock integrity), else every approval/dependency PR jams.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCAN = path.resolve(__dirname, '../../../scripts/egress-scan.sh');

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-scan-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Write a fixture file and return its absolute path. */
function fixture(name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

/** Run the scanner over paths; return { blocked, out } (blocked = non-zero exit). */
function scan(...paths: string[]): { blocked: boolean; out: string } {
  try {
    const out = execFileSync('bash', [SCAN, ...paths], { encoding: 'utf-8' });
    return { blocked: false, out: out.trim() };
  } catch (e: any) {
    return { blocked: true, out: (e.stdout ?? '').toString().trim() };
  }
}

describe('egress-scan.sh — blocks secret/exfil markers (#358)', () => {
  it('BLOCKS an Anthropic key (sk-ant-…)', () => {
    const r = scan(fixture('a.diff', '+  const key = "sk-ant-api03-AbCdEf0123456789abcdefABCDEF01";\n'));
    expect(r.blocked).toBe(true);
    expect(r.out).toMatch(/BLOCK/);
    // The reason is redacted — the raw key value never appears in the output.
    expect(r.out).not.toContain('AbCdEf0123456789abcdefABCDEF01');
  });

  it('BLOCKS an AWS access key id (AKIA…)', () => {
    const r = scan(fixture('b.diff', 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE\n'));
    expect(r.blocked).toBe(true);
  });

  it('BLOCKS a PEM private-key header (RSA/OPENSSH/generic)', () => {
    for (const kind of ['RSA ', 'OPENSSH ', 'EC ', '']) {
      const r = scan(fixture('pk.txt', `-----BEGIN ${kind}PRIVATE KEY-----\nMIIxxx\n`));
      expect(r.blocked, `kind=${kind}`).toBe(true);
    }
  });

  it('BLOCKS a generic high-entropy base64 blob (>=32 chars)', () => {
    const r = scan(fixture('c.diff', '+  const blob = "aGVsbG8gd29ybGQtc2VjcmV0LXZhbHVlLTEyMzQ1Njc4OTA=";\n'));
    expect(r.blocked).toBe(true);
    expect(r.out).toContain('<redacted-high-entropy>');
  });

  it('BLOCKS a high-entropy mixed-class token (upper+lower+digit, no separators)', () => {
    const r = scan(fixture('d.diff', '+token=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789\n'));
    expect(r.blocked).toBe(true);
  });

  it('BLOCKS a GitHub token (ghp_…)', () => {
    const r = scan(fixture('e.diff', 'GH_TOKEN=ghp_0123456789abcdefABCDEF0123456789abcdef\n'));
    expect(r.blocked).toBe(true);
  });

  it('BLOCKS the aws_secret_access_key credential-file marker', () => {
    const r = scan(fixture('f.ini', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n'));
    expect(r.blocked).toBe(true);
  });

  it('reports every offending input when several are passed', () => {
    const clean = fixture('clean.diff', '+  const x = doThing();\n');
    const dirty = fixture('dirty.diff', '+  key = "sk-ant-api03-ZZZ0123456789abcdefGHIJ";\n');
    const r = scan(clean, dirty);
    expect(r.blocked).toBe(true);
    expect(r.out).toContain('dirty.diff');
  });
});

describe('egress-scan.sh — fail CLOSED on bad input (#358)', () => {
  it('a missing/unreadable path → BLOCK (never clean)', () => {
    const r = scan(path.join(dir, 'does-not-exist.txt'));
    expect(r.blocked).toBe(true);
    expect(r.out).toMatch(/unreadable|failing closed/i);
  });

  it('no paths at all → BLOCK (cannot prove anything clean)', () => {
    const r = scan();
    expect(r.blocked).toBe(true);
  });

  it('a clean input mixed with a missing one still BLOCKS (any hit blocks)', () => {
    const clean = fixture('ok.diff', '+  return 42;\n');
    const r = scan(clean, path.join(dir, 'nope.txt'));
    expect(r.blocked).toBe(true);
  });
});

describe('egress-scan.sh — PASSES clean material, no false positives (#358)', () => {
  it('ordinary code + a sha256/git hash + a UUID → CLEAN', () => {
    const r = scan(
      fixture('clean.diff',
        '+  const result = computeThing(input);\n' +
        '+  export function foo(): string { return bar; }\n' +
        '+  // hash: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n' +
        '+  id: "550e8400-e29b-41d4-a716-446655440000"\n'),
    );
    expect(r.blocked).toBe(false);
    expect(r.out).toBe('');
  });

  it('an approvals sidecar hash (64-hex, quoted) → CLEAN (not a secret)', () => {
    const r = scan(fixture('approval.json',
      '{ "specHash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }\n'));
    expect(r.blocked).toBe(false);
  });

  it('an npm-lock integrity (sha512-…base64==) → CLEAN (not a secret)', () => {
    const r = scan(fixture('lock.diff',
      '+      "integrity": "sha512-AbCdEf0123456789+/gHiJkLmNoPqRsTuVwXyZ0123456789ABCDEFabcdef==",\n'));
    expect(r.blocked).toBe(false);
  });

  it('a normal prose summary → CLEAN', () => {
    const r = scan(fixture('.agent-summary.md',
      '# Summary\n\nFixed the off-by-one in the tier classifier and added a T3 regression test.\n'));
    expect(r.blocked).toBe(false);
  });
});

describe('egress-scan.sh — commit messages are in scope (#479 review, MAJOR)', () => {
  // run_egress_guard now dumps `git log origin/main..HEAD --format=%B` and scans it,
  // because commit messages are published by `git push` and shown on the PR — a
  // prompt-injected agent could exfiltrate via `git commit -m "<secret>"`. The
  // scanner is content-agnostic, so a secret in a commit-message dump blocks exactly
  // like one in the diff.
  it('BLOCKS a secret smuggled into a commit-message body', () => {
    const r = scan(fixture('commit-messages.txt',
      'fix: legitimate subject line\n\nexfil sk-ant-api03-QwErTy0123456789abcdefZZ via the message\n'));
    expect(r.blocked).toBe(true);
    expect(r.out).not.toContain('QwErTy0123456789abcdefZZ');
  });

  it('a clean commit message → CLEAN', () => {
    const r = scan(fixture('commit-messages.txt',
      'fix(#302): reject nullish folder arg in the classify gate\n\nRoot cause: ...\n'));
    expect(r.blocked).toBe(false);
  });
});

describe('egress-scan.sh — slash-paths are not secrets (#479 review, MAJOR false-positive)', () => {
  // The base64 heuristic used to flag any >=32-char token containing `/`. The
  // tokenizer runs a file path into one long token, so a realistic diff (headers
  // + deep-path imports) false-quarantined nearly every PR. Fixed by triggering on
  // base64 `+`/`=` (which paths never carry), not on `/`.
  it('a realistic `diff --git` dump with deep paths + imports → CLEAN', () => {
    const r = scan(fixture('real.diff',
      'diff --git a/packages/minspec/tests/dispatch-ready-check.test.ts b/packages/minspec/tests/dispatch-ready-check.test.ts\n' +
      'index 0000000..1111111 100644\n' +
      '--- a/packages/minspec/tests/dispatch-ready-check.test.ts\n' +
      '+++ b/packages/minspec/tests/dispatch-ready-check.test.ts\n' +
      '@@ -1,3 +1,4 @@\n' +
      "+import { scanTestSource } from '../packages/minspec/src/lib/test-scanner';\n" +
      '+  const p = path.resolve(__dirname, "../../../scripts/egress-scan.sh");\n'));
    expect(r.blocked).toBe(false);
    expect(r.out).toBe('');
  });

  it('a long slash-path token alone → CLEAN', () => {
    const r = scan(fixture('p.txt', 'b/packages/minspec/src/lib/consequence-analyzers\n'));
    expect(r.blocked).toBe(false);
  });

  it('still BLOCKS a base64 blob that carries a slash AND padding', () => {
    const r = scan(fixture('b64.diff', '+  const key = "AbCd/EfGh+IjKlMnOpQrStUvWxYz0123456789==";\n'));
    expect(r.blocked).toBe(true);
  });
});

describe('egress-scan.sh — documented false-positive is safe-direction (#479 review, LOW)', () => {
  // The mixed-class high-entropy rule (upper+lower+digit, >=32 chars) can flag a long
  // camelCase identifier that happens to contain a digit. This is a KNOWN false
  // positive: it fails in the SAFE direction (quarantine → human review, never a
  // silent publish) and matches the documented posture. Covered here so the behavior
  // is intentional and regression-guarded rather than surprising.
  it('a >=32-char camelCase identifier with a digit is flagged (safe direction)', () => {
    const r = scan(fixture('g.diff',
      '+  const someVeryLongDescriptiveVariableName2Value = compute();\n'));
    expect(r.blocked).toBe(true);
  });

  it('a short/ordinary identifier with a digit is NOT flagged', () => {
    const r = scan(fixture('h.diff', '+  const user2 = getUser();\n'));
    expect(r.blocked).toBe(false);
  });
});

describe("egress-scan.sh — MinSpec's own artifact paths (SPEC-/DR-/EPIC-NNN) are not secrets (#616)", () => {
  // The mixed-class rule (upper+lower+digit, >=32 chars) flagged MinSpec's OWN
  // artifact paths: `specs/minspec/SPEC-028-forgotten-merge-inbox/requirements`
  // has SPEC (upper) + words (lower) + 028 (digit), so the whole >=32 token read
  // as "mixed-class" and false-quarantined nearly every MinSpec PR (the 41-PR
  // backlog). A path's longest CONTIGUOUS alnum run is a short word; a secret's is
  // one unbroken >=32 run. The heuristic now gates on that contiguous run.
  it('a diff touching a SPEC-NNN spec path → CLEAN', () => {
    const r = scan(fixture('spec.diff',
      'diff --git a/specs/minspec/SPEC-028-forgotten-merge-inbox/requirements.md b/specs/minspec/SPEC-028-forgotten-merge-inbox/requirements.md\n' +
      "+  const SPEC_REL = 'specs/minspec/SPEC-028-forgotten-merge-inbox/requirements.md';\n"));
    expect(r.blocked).toBe(false);
    expect(r.out).toBe('');
  });

  it('DR-/EPIC- paths and a cross-project ref (MS-SPEC-019) → CLEAN', () => {
    const r = scan(fixture('dr.diff',
      '+  docs/decisions/DR-053-cross-project-reference-prefixes.md\n' +
      '+  docs/epics/EPIC-010-reviewer-all-approvables/EPIC-010.md\n' +
      '+  // see MS-SPEC-019 and SC-DR-007 for the cross-project convention\n'));
    expect(r.blocked).toBe(false);
    expect(r.out).toBe('');
  });

  it('still BLOCKS a contiguous secret even when adjacent to a path', () => {
    const r = scan(fixture('mix.diff',
      '+  fetch("/api/specs/SPEC-028", { headers: { auth: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789" }});\n'));
    expect(r.blocked).toBe(true);
  });

  it('still BLOCKS a secret WRAPPED in path separators (>=32 run survives — no bypass)', () => {
    const r = scan(fixture('wrap.diff',
      '+  path = "foo/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/bar";\n'));
    expect(r.blocked).toBe(true);
  });
});

describe('egress-scan.sh — punctuation-only runs (comment dividers) are not secrets (#652)', () => {
  // The base64 rule fired on any >=32 token containing `+` or `=`. A comment
  // divider — a long run of `=` (or `+`) — has the padding char but NO base64
  // payload, so it false-quarantined the PR. This re-quarantined #526/#561 after
  // the #616 fix. A real base64 blob always carries alnum payload; a divider does not.
  it('a long `// ====…` comment divider → CLEAN', () => {
    const r = scan(fixture('div.diff',
      '+// =============================================================================\n' +
      '+// Section header\n' +
      '+// =============================================================================\n'));
    expect(r.blocked).toBe(false);
    expect(r.out).toBe('');
  });

  it('a long `+++++`/`-----` rule → CLEAN', () => {
    const r = scan(fixture('rule.diff',
      '+// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++\n' +
      '+// -------------------------------------------------------------\n'));
    expect(r.blocked).toBe(false);
  });

  it('still BLOCKS a real padded base64 blob (payload + `==`) — no weakening', () => {
    const r = scan(fixture('b64.diff',
      '+  const k = "aGVsbG8gd29ybGQtc2VjcmV0LXZhbHVlLTEyMzQ1Njc4OTA=";\n'));
    expect(r.blocked).toBe(true);
    expect(r.out).toContain('<redacted-high-entropy>');
  });
});
