/**
 * T0/T3 — #1847: the docs-lane must not arm auto-merge on a PR a human has HELD,
 * nor on a governance status transition.
 *
 * Root cause (pre-fix): `.github/workflows/docs-lane.yml` gated arming on the docs
 * corpus and the outward-facing denylist alone, and never read the PR's labels. A
 * `hold:*` label — documented as "no approval lifts it" (DR-072 §3) — was enforced on
 * the ISSUE-dispatch side and nowhere on the MERGE side. Measured on #1741:
 * `hold:human` at 22:09:26, this lane armed auto-merge at 22:09:34. Eight seconds.
 * Only an unrelated `ai-review:changes` stopped a DR ratification landing with no
 * human act (#1816).
 *
 * The second gate exists because the first only fires when somebody REMEMBERED to
 * apply a label. Every human-act artefact here is markdown, so a DR acceptance is
 * docs-only BY CONSTRUCTION and reads as "inward" to the outward denylist — the lane
 * with the weakest gate is the one every ratification travels down (DR-029, DR-086 §2).
 *
 * These tests run the workflow's ACTUAL `run:` block under bash against a stubbed
 * `gh`, rather than asserting on its source text — a source-text assertion goes green
 * whenever the prose survives, including when the logic around it has been inverted.
 * What the stub does NOT cover is the `-q` jq expressions (it emits the shaped output
 * directly); those are pinned by the workflow running for real.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts')) && fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo root from ' + __dirname);
}

const root = findRepoRoot();
const docsLanePath = path.join(root, '.github', 'workflows', 'docs-lane.yml');

/** The workflow's real shell body, as GitHub Actions would run it. */
let laneScript: string;

/**
 * Pull the `run: |` block out textually rather than via a YAML parser: `js-yaml` is only
 * a transitive dependency here, so importing it would make this test vanish on an
 * unrelated dependency bump — the failure mode being that the gate stops being tested
 * while the suite stays green.
 */
function extractRunBlock(yamlText: string): string {
  const lines = yamlText.split('\n');
  const start = lines.findIndex((l) => /^\s*run:\s*\|\s*$/.test(l));
  if (start === -1) throw new Error('docs-lane.yml has no `run: |` block');
  const indent = (lines[start + 1].match(/^\s*/) ?? [''])[0].length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && (line.match(/^\s*/) ?? [''])[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

beforeAll(() => {
  laneScript = extractRunBlock(fs.readFileSync(docsLanePath, 'utf8'));
  // Guard the EXTRACTOR only: if it silently grabbed the wrong region, every
  // behavioural assertion below would pass vacuously against an empty script.
  // Deliberately does NOT assert the fix is present — that would turn "the gate was
  // removed" into 14 SKIPPED tests instead of 14 failures, and a skip is a much
  // weaker signal than a red in a suite nobody reads line by line.
  expect(laneScript, 'extracted block must be the arming step').toContain('--auto');
  expect(laneScript, 'extractor must capture the whole step').toContain('outward=');
});

interface Fixture {
  /** `filename \t base64(patch)` rows the stub returns for `pulls/N/files`. */
  files: Array<{ filename: string; patch?: string }>;
  labels: string[];
  /** ISO timestamp when auto-merge is already armed; '' when not. */
  armed?: string;
  /** Make `gh pr merge --disable-auto` fail, to prove the failure is not swallowed. */
  disarmFails?: boolean;
  /** Make one of the gate's own witness fetches fail, to prove it fails CLOSED. */
  failApi?: 'labels' | 'filenames' | 'patches' | 'armed';
}

interface Result {
  status: number;
  stdout: string;
  stderr: string;
  /** Every `gh` invocation, one per line, as the stub saw it. */
  calls: string[];
}

function runLane(fx: Fixture): Result {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-lane-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);

  // The workflow makes TWO different `.../files` calls: one for filenames only, one
  // for filename+patch as TSV. The stub must answer them SEPARATELY — serving the TSV
  // to both made `README.md\t<base64>` fail the corpus regex and trip the non-docs
  // branch, so the outward-facing regression test passed through the wrong gate.
  const rows = fx.files
    .map((f) => `${f.filename}\t${Buffer.from(f.patch ?? '').toString('base64')}`)
    .join('\n');
  fs.writeFileSync(path.join(dir, 'files.tsv'), rows + (rows ? '\n' : ''));
  const names = fx.files.map((f) => f.filename).join('\n');
  fs.writeFileSync(path.join(dir, 'filenames.txt'), names + (names ? '\n' : ''));
  fs.writeFileSync(path.join(dir, 'labels.txt'), fx.labels.join('\n') + (fx.labels.length ? '\n' : ''));
  fs.writeFileSync(path.join(dir, 'armed.txt'), fx.armed ?? '');

  // A `gh` that records every call and serves the fixture. Nothing reaches the network.
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FIXDIR/calls.log"
case "$*" in
  *"@tsv"*)                ${fx.failApi === 'patches' ? 'exit 1' : 'cat "$FIXDIR/files.tsv"'} ;;
  *"/files"*)              ${fx.failApi === 'filenames' ? 'exit 1' : 'cat "$FIXDIR/filenames.txt"'} ;;
  *".labels[].name"*)      ${fx.failApi === 'labels' ? 'exit 1' : 'cat "$FIXDIR/labels.txt"'} ;;
  *autoMergeRequest*)      ${fx.failApi === 'armed' ? 'exit 1' : 'cat "$FIXDIR/armed.txt"'} ;;
  *"--disable-auto"*)      ${fx.disarmFails ? 'exit 1' : 'exit 0'} ;;
  *) exit 0 ;;
esac
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FIXDIR: dir,
    GH_TOKEN: 'stub',
    PR: '1741',
    REPO: 'AIClarityAU/minspec',
  };

  let status = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('bash', ['-c', laneScript], { env, encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    status = e.status ?? 1;
    stdout = e.stdout?.toString() ?? '';
    stderr = e.stderr?.toString() ?? '';
  }
  const logPath = path.join(dir, 'calls.log');
  const calls = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
    : [];
  return { status, stdout, stderr, calls };
}

const armed = (r: Result) => r.calls.some((c) => c.includes('--auto') && !c.includes('--disable-auto'));
const disarmed = (r: Result) => r.calls.some((c) => c.includes('--disable-auto'));

const DR_TYPO_PATCH = '@@ -1,3 +1,3 @@\n-a speling mistake\n+a spelling mistake\n';
const DR_STATUS_PATCH = '@@ -1,5 +1,5 @@\n-status: proposed\n+status: accepted\n';

describe('#1847 — docs-lane must not arm auto-merge on a held PR', () => {
  it('refuses, and does not arm, when hold:human is present', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:human'],
    });
    expect(armed(r), 'must NOT arm auto-merge on a held PR').toBe(false);
    expect(r.status, 'a held PR must fail the lane visibly, not pass quietly').toBe(1);
  });

  it('holds on any hold:* label, not just hold:human', () => {
    const r = runLane({
      files: [{ filename: 'docs/guide.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:legal'],
    });
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('revokes an arming a previous run already made (the #1741 sequence)', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:human'],
      armed: '2026-09-05T22:09:34Z',
    });
    expect(disarmed(r), 'arming is sticky — refusing to re-arm is not enough').toBe(true);
    expect(r.status).toBe(1);
  });

  it('does not attempt a disarm when auto-merge was never armed', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:human'],
      armed: '',
    });
    expect(disarmed(r), '"nothing to disarm" must not be reported as a failure').toBe(false);
  });

  it('surfaces a failed disarm instead of swallowing it (invariant 2 — no silent gate)', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:human'],
      armed: '2026-09-05T22:09:34Z',
      disarmFails: true,
    });
    expect(r.stdout + r.stderr).toMatch(/STILL ARMED/);
    expect(r.status).toBe(1);
  });

  it('a label merely containing "hold" does not hold the lane', () => {
    const r = runLane({
      files: [{ filename: 'docs/guide.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'household-docs'],
    });
    expect(armed(r), 'hold_pattern is anchored — this must still ride the lane').toBe(true);
    expect(r.status).toBe(0);
  });
});

describe('#1847 — docs-lane must not arm auto-merge on a governance status transition', () => {
  it('refuses when a DR status: line changes', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_STATUS_PATCH }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'DR acceptance is a human act (DR-029, DR-086 §2)').toBe(false);
    expect(r.status).toBe(1);
  });

  it('refuses when a spec status: line changes', () => {
    const r = runLane({
      files: [{ filename: 'specs/minspec/SPEC-044-x/requirements.md', patch: DR_STATUS_PATCH }],
      labels: ['docs-lane'],
    });
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('still arms for a governance file whose BODY changed but whose status did not', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'the inward docs-lane (DR-051/#575) must not regress').toBe(true);
    expect(r.status).toBe(0);
  });

  it('ignores a status: line changed OUTSIDE the governance corpus', () => {
    const r = runLane({
      files: [{ filename: 'docs/guide.md', patch: DR_STATUS_PATCH }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'the gate is scoped to docs/decisions/** and specs/**').toBe(true);
    expect(r.status).toBe(0);
  });

  it('refuses the whole PR when one of several files carries the transition', () => {
    const r = runLane({
      files: [
        { filename: 'docs/guide.md', patch: DR_TYPO_PATCH },
        { filename: 'docs/decisions/DR-050.md', patch: DR_STATUS_PATCH },
      ],
      labels: ['docs-lane'],
    });
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });
});

describe('#1847 — no regression in the pre-existing refusals', () => {
  it('still refuses a non-docs path', () => {
    const r = runLane({
      files: [{ filename: 'packages/minspec/src/lib/foo.ts', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
    });
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('still refuses an outward-facing doc (#1001)', () => {
    const r = runLane({ files: [{ filename: 'README.md', patch: DR_TYPO_PATCH }], labels: ['docs-lane'] });
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('still arms an ordinary inward docs-only PR', () => {
    const r = runLane({
      files: [{ filename: 'docs/epics/EP-1.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
    });
    expect(armed(r)).toBe(true);
    expect(r.status).toBe(0);
  });
});

describe('#1847 — an errored gate witness must fail CLOSED (constitution invariant 2)', () => {
  /**
   * The blocking review finding on the first round of this PR: the gates originally read
   * their witnesses through `mapfile -t x < <(gh api ...)`. Under `set -euo pipefail` a
   * failure INSIDE a process substitution is not caught — `mapfile`/`while` still return
   * 0 — so a transient or rate-limited `gh api` produced an empty array, the hold was
   * silently not detected, and the lane armed a held PR. That is the #1741 failure
   * reintroduced by its own fix, which is why these tests exist rather than a comment.
   */
  it('refuses when the labels call fails, instead of assuming the PR is unheld', () => {
    const r = runLane({
      files: [{ filename: 'docs/epics/EP-1.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:human'],
      failApi: 'labels',
    });
    expect(armed(r), 'an unreadable label witness must never read as "not held"').toBe(false);
    expect(r.status).toBe(1);
  });

  it('refuses when the patch call fails, instead of assuming no status transition', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_STATUS_PATCH }],
      labels: ['docs-lane'],
      failApi: 'patches',
    });
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('refuses when the filenames call fails', () => {
    const r = runLane({
      files: [{ filename: 'docs/epics/EP-1.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
      failApi: 'filenames',
    });
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('treats a governance file with NO patch as a transition, not as a clean file', () => {
    // GitHub omits `.patch` for very large diffs. Absent is UNKNOWN, not "no".
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: '' }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'a status change buried in an oversized diff must not reach the lane').toBe(false);
    expect(r.status).toBe(1);
  });

  it('a NON-governance file with no patch still rides the lane', () => {
    const r = runLane({ files: [{ filename: 'docs/epics/EP-1.md', patch: '' }], labels: ['docs-lane'] });
    expect(armed(r), 'the unknown-patch refusal is scoped to the governance corpus').toBe(true);
    expect(r.status).toBe(0);
  });

  it('attempts a disarm when the auto-merge state itself cannot be read', () => {
    // The last witness that was not capture-then-checked. Exiting before the disarm
    // would leave a previously-armed hold armed, so unknown must mean "try anyway".
    const r = runLane({
      files: [{ filename: 'docs/epics/EP-1.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:human'],
      failApi: 'armed',
    });
    expect(armed(r), 'must never arm a held PR').toBe(false);
    expect(disarmed(r), 'unknown state must trigger a precautionary disarm').toBe(true);
    expect(r.status).toBe(1);
  });
});

describe('#1847 — every refusal path revokes an arming an earlier run already made', () => {
  /**
   * Round-3 review finding: the two PRE-EXISTING refusals (non-docs path, outward-facing
   * doc) exited without disarming, while the two new ones disarmed. Same asymmetry one
   * layer down — a PR armed while docs-only can acquire a non-docs path on a later
   * `synchronize`, hit those branches, and keep its arming. "Arming is sticky" has to
   * hold for every refusal or it holds for none.
   */
  it('disarms when a non-docs path appears after an earlier arming', () => {
    const r = runLane({
      files: [{ filename: 'packages/minspec/src/lib/foo.ts', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
      armed: '2026-09-05T22:09:34Z',
    });
    expect(disarmed(r), 'the non-docs refusal must revoke a prior arming').toBe(true);
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('disarms when an outward-facing doc appears after an earlier arming', () => {
    const r = runLane({
      files: [{ filename: 'README.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
      armed: '2026-09-05T22:09:34Z',
    });
    expect(disarmed(r), 'the outward-facing refusal must revoke a prior arming').toBe(true);
    expect(armed(r)).toBe(false);
    expect(r.status).toBe(1);
  });

  it('does not claim something was disarmed when the state was never readable', () => {
    // "never wrong": an unknown state plus a successful precautionary disarm must not be
    // reported as "auto-merge was already enabled and has been disarmed" — it may not
    // have been enabled at all.
    const r = runLane({
      files: [{ filename: 'docs/epics/EP-1.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane', 'hold:human'],
      failApi: 'armed',
    });
    const comment = r.calls.find((c) => c.startsWith('pr comment')) ?? '';
    expect(comment).not.toMatch(/was already enabled and has been/);
    expect(comment, 'the note must say the state could not be read').toMatch(/could not be read/);
  });
});

describe('#1847 — the status detector must not fail open on a large patch', () => {
  /**
   * Round-4 blocking review finding. `base64 -d | grep -qE` under `set -o pipefail`:
   * grep exits 0 at the first match and closes the pipe, base64 is still writing so it
   * takes SIGPIPE (141), and pipefail reports the pipeline as FAILED even though grep
   * matched. The transition is dropped and the PR arms — a fail-open reachable only
   * once the decoded patch exceeds the pipe buffer, which is why every earlier round's
   * small fixtures passed straight over it.
   */
  const BIG_STATUS_PATCH =
    '@@ -1,5 +1,5 @@\n-status: proposed\n+status: accepted\n' +
    Array.from({ length: 4000 }, (_, i) => ` context line ${i} ${'x'.repeat(40)}`).join('\n') +
    '\n';

  it('detects a status transition in a patch far larger than the pipe buffer', () => {
    expect(BIG_STATUS_PATCH.length, 'fixture must exceed the ~64KiB pipe buffer').toBeGreaterThan(
      64 * 1024,
    );
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: BIG_STATUS_PATCH }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'a transition buried in a large patch must not reach the lane').toBe(false);
    expect(r.status).toBe(1);
  });

  it('still arms on a large governance patch with no status transition', () => {
    const bigNoStatus = BIG_STATUS_PATCH.replace(
      '-status: proposed\n+status: accepted\n',
      '-a speling mistake\n+a spelling mistake\n',
    );
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: bigNoStatus }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'size alone must not trip the gate').toBe(true);
    expect(r.status).toBe(0);
  });
});

/**
 * #2124 — the predicate is checked against a scan DELIBERATELY BROADER than itself.
 *
 * This block used to be titled "matches any status: line, not only frontmatter" and had
 * two fixtures: `status:` inside a fenced block, and a line merely containing `status:`.
 * Both preserved the two properties that actually defeated the old `^[+-]status:` anchor
 * — column-0 position and lowercase — so it asserted the general claim while exercising
 * only the variant that was never at risk.
 *
 * The first replacement for it was no better: its corpus scan filtered on the
 * predicate's OWN prefix class, so it structurally could not enumerate a form the
 * predicate could not match. A guard whose discovery filter is the thing under test
 * proves nothing.
 *
 * So the scan below accepts ANY non-alphanumeric run before the word `Status`. That is
 * wider than the gate on purpose: the gap between what the scan finds and what the
 * predicate matches is where the next #2124 lives, and this test makes that gap explicit
 * instead of invisible. A form that is neither matched nor listed in KNOWN_UNCOVERED
 * fails the suite and names itself.
 */
describe('#2124 — the status predicate vs a deliberately broader corpus scan', () => {
  /**
   * Shapes the scan finds that the predicate does NOT match, each with why. These are
   * real and tracked on #2124; they are listed rather than silently skipped so that
   * widening the gate to cover one produces a failure telling you to update this list.
   *
   * Neither can be caught by ANY line-wise predicate: in both, the line that changes
   * when the disposition changes contains no status token at all.
   */
  const KNOWN_UNCOVERED: { shape: RegExp; why: string }[] = [
    { shape: /^#{1,6} +Status/, why: '`## Status` SECTION heading — the ruling lives in the body beneath it (#2124)' },
  ];

  /** The gate's literal predicate, read from the workflow so the two cannot drift. */
  function statusPredicate(): RegExp {
    const yml = fs.readFileSync(path.join(root, '.github/workflows/docs-lane.yml'), 'utf8');
    // Anchored on `<<<"$decoded"` (unique in the workflow) and NOT on the pattern's own
    // text — an extractor that assumes the value it extracts is the #2124 bug again.
    const m = yml.match(/grep -qE '([^']*)' <<<"\$decoded"/);
    if (!m) throw new Error('could not read the status predicate out of docs-lane.yml');
    return new RegExp(m[1]);
  }

  /**
   * Every distinct shape of line that mentions `Status` at the START of a line, under
   * any non-alphanumeric decoration. Deliberately broader than the predicate.
   */
  function corpusStatusShapes(): { shape: string; line: string; indented: boolean }[] {
    const out = new Map<string, { shape: string; line: string; indented: boolean }>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.md')) {
          for (const raw of fs.readFileSync(full, 'utf8').split('\n')) {
            // A DECLARATION, not a mention: `Status` at line start under any
            // non-alphanumeric decoration, immediately followed by `:` or end of line.
            // Backtick is excluded from the prefix so prose like `` `status:` `` and
            // table cells like `| Status |` do not flood the scan. Still strictly wider
            // than the predicate on the PREFIX axis, which is where #2124 lived.
            if (!/^[^A-Za-z0-9`]{0,8}[Ss]tatus(:|$)/.test(raw)) continue;
            const shape = raw.replace(/^([^A-Za-z0-9`]{0,8}[Ss]tatus:?).*$/, '$1');
            if (!out.has(shape)) out.set(shape, { shape, line: raw, indented: /^[ \t]/.test(raw) });
          }
        }
      }
    };
    for (const d of ['docs/decisions', 'specs']) {
      const full = path.join(root, d);
      // Fail CLOSED: a corpus root that has moved must break this test loudly, not
      // quietly shrink what it covers (constitution invariant 2).
      if (!fs.existsSync(full)) throw new Error(`corpus root is missing: ${d} — this test cannot certify coverage`);
      walk(full);
    }
    return [...out.values()];
  }

  it('every non-indented corpus shape is either matched or a NAMED known gap', () => {
    const re = statusPredicate();
    const shapes = corpusStatusShapes().filter((f) => !f.indented);
    expect(shapes.length, 'the corpus scan found almost nothing — the walk is broken').toBeGreaterThan(3);

    const unexplained = shapes.filter(
      (f) => !re.test('+' + f.line) && !KNOWN_UNCOVERED.some((k) => k.shape.test(f.line)),
    );
    expect(
      unexplained.map((f) => f.shape),
      'a status notation exists that the gate neither matches nor names as a known gap (#2124)',
    ).toEqual([]);
  });

  it('the known gaps are still gaps — widening the gate must update the list', () => {
    const re = statusPredicate();
    const shapes = corpusStatusShapes();
    for (const k of KNOWN_UNCOVERED) {
      const hits = shapes.filter((f) => k.shape.test(f.line));
      expect(hits.length, `KNOWN_UNCOVERED entry matches nothing in the corpus: ${k.why}`).toBeGreaterThan(0);
      for (const h of hits) {
        expect(re.test('+' + h.line), `now covered — remove from KNOWN_UNCOVERED: ${k.why}`).toBe(false);
      }
    }
  });

  it('INDENTED corpus lines are rejected — those are code inside fenced blocks', () => {
    const re = statusPredicate();
    const indented = corpusStatusShapes().filter((f) => f.indented);
    expect(indented.length, 'expected the fenced-block literals to still exist').toBeGreaterThan(0);
    for (const f of indented) {
      expect(re.test('+' + f.line), `indented literal must not trip the gate: ${f.line.trim()}`).toBe(false);
    }
  });

  it('refuses the DR-050 amendment form end-to-end — an amendment has no frontmatter', () => {
    // The pre-#2124 predicate could not see this at all. Counterfactually it is what
    // let #1741's shape through; the gate itself postdates that PR (see docs-lane.yml).
    const amendment =
      '@@ -263,7 +263,7 @@\n context\n-**Status: `proposed`.** Unlike the two preceding amendments\n' +
      '+**Status: `accepted` 2026-08-30.** Unlike the two preceding amendments\n context\n';
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: amendment }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'an amendment status flip must NOT ride the lane').toBe(false);
    expect(r.status).toBe(1);
  });

  it('refuses the blockquoted supersession banner — DR-018 and DR-022 use it', () => {
    const banner =
      '@@ -11,5 +11,5 @@\n context\n-> **Status: superseded for code licensing by [DR-083](DR-083.md), 2026-08-12.**\n' +
      '+> **Status: accepted 2026-09-25, supersession reversed.**\n context\n';
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-018.md', patch: banner }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'a blockquoted status flip must NOT ride the lane').toBe(false);
    expect(r.status).toBe(1);
  });

  it('refuses a status: line changed inside a fenced code block', () => {
    const fenced =
      '@@ -10,7 +10,7 @@\n context\n ```yaml\n-status: proposed\n+status: accepted\n ```\n context\n';
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: fenced }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'over-refusing is the safe direction for this gate').toBe(false);
    expect(r.status).toBe(1);
  });

  it('does not refuse a line merely CONTAINING status:', () => {
    const inline =
      '@@ -1,3 +1,3 @@\n-the status: field is explained below\n+the status: field is described below\n';
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: inline }],
      labels: ['docs-lane'],
    });
    expect(armed(r), 'the pattern is anchored — mid-line matches must not trip it').toBe(true);
    expect(r.status).toBe(0);
  });
});

describe('#1968 — a witness-failure refusal also revokes a prior arming', () => {
  /**
   * The block above pinned the two CONTENT refusals (non-docs path, outward-facing doc).
   * It left the three WITNESS-failure exits unpinned, and they were the ones that
   * regressed: each prints "refusing to arm" and exits, which is correct only for a PR
   * that was never armed. On an armed PR it is a no-op, so the arming survives a refusal
   * — the same stickiness the #1741 note at the top of this file is about.
   *
   * The existing witness-failure tests asserted the WEAKER half of the property: they
   * set no prior arming and checked only that the lane did not arm. The fixture already
   * supported `armed`; nothing asked for it. That is how the hole shipped — not an
   * unexercised path, an under-asserted one.
   *
   * Pinned behaviourally rather than by asserting a trap is present in the source: a
   * textual assertion passes whenever the trap survives, including after someone moves
   * it below the first refusal, where it no longer covers anything.
   */
  const ARMED = '2026-09-05T22:09:34Z';

  it('disarms when the filenames witness fails on an armed PR', () => {
    const r = runLane({
      files: [{ filename: 'docs/epics/EP-1.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
      armed: ARMED,
      failApi: 'filenames',
    });
    expect(disarmed(r), 'an unreadable file list must not leave an arming standing').toBe(true);
    expect(r.status).toBe(1);
  });

  it('disarms when the labels witness fails on an armed PR', () => {
    const r = runLane({
      files: [{ filename: 'docs/epics/EP-1.md', patch: DR_TYPO_PATCH }],
      labels: ['docs-lane'],
      armed: ARMED,
      failApi: 'labels',
    });
    expect(disarmed(r), 'an unreadable hold witness must not leave an arming standing').toBe(true);
    expect(r.status).toBe(1);
  });

  it('disarms when the patch witness fails on an armed PR', () => {
    const r = runLane({
      files: [{ filename: 'docs/decisions/DR-050.md', patch: DR_STATUS_PATCH }],
      labels: ['docs-lane'],
      armed: ARMED,
      failApi: 'patches',
    });
    expect(disarmed(r), 'an unreadable patch witness must not leave an arming standing').toBe(true);
    expect(r.status).toBe(1);
  });
});
