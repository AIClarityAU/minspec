/**
 * T0 — INVARIANT: the ai-review workflow never leaves a contradictory verdict-label
 * set behind, and never leaves one behind SILENTLY (#1468, step 2).
 *
 * Constitution invariant 2: "no load-bearing gate signal is written with a swallowed
 * error." The Post-verdict step's removals were exactly that — `2>/dev/null || true`
 * with both the error and the result discarded. One failed removal left the PR
 * carrying `ai-review:pass` AND `ai-review:changes` at once; `ready-to-merge` reads a
 * contradictory set as "not passed", so a legitimately-passing PR wedged with nothing
 * on its surface explaining why (observed on #1430).
 *
 * These tests EXECUTE the shipped block verbatim out of the workflow rather than
 * asserting on its source text — the convention from ai-review-coverage-disclosure.
 * A grep for `verdictLabelFault` passes against a block that computes the fault and
 * throws it away; running it cannot. #1472's own review caught a docstring that
 * merely *implied* the fix was live, which is the same class of defect one level up:
 * a claim of wiring is not wiring.
 *
 * The block is delimited in `.github/workflows/ai-review.yml` by
 * `# >>> verdict-label-coherence` / `# <<< verdict-label-coherence`, and the
 * extractor fails loudly if those go missing. `gh` and `sleep` are PATH stubs;
 * `node` and the guard module are REAL, so the rule under test is the shipped seam
 * and not a re-implementation of it.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { useShellTimeout } from './helpers/shell-timeout';

// #1285: every case spawns real bash + node children. Enforced by
// shell-timeout-coverage.test.ts.
useShellTimeout();

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/ai-review.yml');
const wf = fs.readFileSync(WORKFLOW, 'utf-8');

const BEGIN = '# >>> verdict-label-coherence';
const END = '# <<< verdict-label-coherence';
const BACKSTOP_BEGIN = '# >>> backstop-verdict-clear';
const BACKSTOP_END = '# <<< backstop-verdict-clear';

/** A shipped block, lifted verbatim — not a re-implementation of it. */
function block(begin: string, end: string): string {
  const b = wf.indexOf(begin);
  const e = wf.indexOf(end);
  if (b < 0 || e < b) {
    throw new Error(
      `${begin} / ${end} markers missing from ${WORKFLOW} — the block this test guards ` +
        `was moved or deleted, so its behaviour is unverified.`,
    );
  }
  // Start at the line AFTER the marker: the marker line is a bare comment.
  return wf.slice(wf.indexOf('\n', b) + 1, e);
}

const coherenceBlock = () => block(BEGIN, END);
const backstopBlock = () => block(BACKSTOP_BEGIN, BACKSTOP_END);

/** A `gh` that models the ONE failure mode this block exists for: a removal that
 *  reports failure and leaves the label in place. */
const GH_STUB = `#!/usr/bin/env bash
set -u
S="$GH_STUB_STATE"
printf '%s\\n' "$*" >> "$S/calls.log"

# The label read.
if [ "$1" = "api" ]; then
  if [ -f "$S/read_fails" ]; then
    echo "gh: HTTP 502 Bad Gateway" >&2
    exit 1
  fi
  cat "$S/labels"
  exit 0
fi

if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then
  add=""; rem=""; prev=""
  for a in "$@"; do
    case "$prev" in
      --add-label) add="$a" ;;
      --remove-label) rem="$a" ;;
    esac
    prev="$a"
  done
  if [ -n "$add" ]; then
    grep -qxF "$add" "$S/labels" || printf '%s\\n' "$add" >> "$S/labels"
    exit 0
  fi
  if [ -n "$rem" ]; then
    key="$S/refused-$(printf '%s' "$rem" | tr -c 'a-zA-Z0-9' '-')"
    if [ -f "$S/sticky_forever" ] && grep -qxF "$rem" "$S/sticky_forever"; then
      exit 1
    fi
    if [ -f "$S/sticky_once" ] && grep -qxF "$rem" "$S/sticky_once" && [ ! -f "$key" ]; then
      : > "$key"
      exit 1
    fi
    grep -vxF "$rem" "$S/labels" > "$S/labels.tmp" || true
    mv "$S/labels.tmp" "$S/labels"
    exit 0
  fi
fi
exit 0
`;

type Opts = {
  /** Labels on the PR before the block runs. */
  labels: string[];
  /** The verdict the review decided. */
  label?: string;
  /** Removals that fail once, then succeed — a transient label-API blip. */
  stickyOnce?: string[];
  /** Removals that always report failure and leave the label — the #1430 wedge. */
  stickyForever?: string[];
  /** The label READ fails (API error), so the post-state is unverifiable. */
  readFails?: boolean;
};

type Result = { ok: boolean; out: string; labels: string[]; calls: string[] };

/** Run a shipped block against the stubbed world and report what it did. */
function exec(
  body: string,
  preamble: string[],
  opts: Pick<Opts, 'labels' | 'stickyOnce' | 'stickyForever' | 'readFails'>,
  workspace: string,
): Result {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-coherence-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
    // Keep the retry's backoff out of the wall clock without adding a test-only
    // seam to the workflow.
    fs.writeFileSync(path.join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

    fs.writeFileSync(path.join(dir, 'labels'), `${opts.labels.join('\n')}\n`);
    fs.writeFileSync(path.join(dir, 'calls.log'), '');
    if (opts.stickyOnce) fs.writeFileSync(path.join(dir, 'sticky_once'), `${opts.stickyOnce.join('\n')}\n`);
    if (opts.stickyForever) {
      fs.writeFileSync(path.join(dir, 'sticky_forever'), `${opts.stickyForever.join('\n')}\n`);
    }
    if (opts.readFails) fs.writeFileSync(path.join(dir, 'read_fails'), '');

    const r = spawnSync('bash', ['-c', [...preamble, body].join('\n')], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_STUB_STATE: dir,
        GITHUB_WORKSPACE: workspace,
      },
    });

    return {
      ok: r.status === 0,
      out: `${r.stdout || ''}${r.stderr || ''}`,
      labels: fs.readFileSync(path.join(dir, 'labels'), 'utf-8').split('\n').filter(Boolean),
      calls: fs.readFileSync(path.join(dir, 'calls.log'), 'utf-8').split('\n').filter(Boolean),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The Post-verdict coherence block. Preamble mirrors that step's own options. */
function run(opts: Opts): Result {
  return exec(
    coherenceBlock(),
    ['set -euo pipefail', `LABEL=${opts.label ?? 'ai-review:pass'}`, 'PR_NUMBER=1', 'REPO=OWNER/REPO'],
    opts,
    REPO_ROOT,
  );
}

/**
 * The fail-closed backstop's clear loop. Its step runs `set -uo pipefail` — NO `-e`,
 * deliberately, because nothing there may pre-empt the honest `exit 1` at the end.
 * The preamble reproduces that exactly; running it under `-e` would test a step that
 * does not ship.
 */
function runBackstop(
  labels: string[],
  o: { workspace: string; stickyForever?: string[] },
): Result {
  return exec(
    backstopBlock(),
    ['set -uo pipefail', 'PR_NUMBER=1', 'REPO=OWNER/REPO'],
    { labels, stickyForever: o.stickyForever },
    o.workspace,
  );
}

describe('ai-review verdict labels: exactly one survives, or the step fails loudly', () => {
  it('applies the verdict, clears pending, and leaves unrelated labels alone', () => {
    const r = run({ labels: ['ai-review:pending', 'docs-lane'], label: 'ai-review:pass' });
    expect(r.ok, r.out).toBe(true);
    expect(r.labels.sort()).toEqual(['ai-review:pass', 'docs-lane']);
    // Non-vacuity: it did the removal rather than passing because nothing was wrong.
    expect(r.calls.join('\n')).toContain('--remove-label ai-review:pending');
  });

  it('clears the OPPOSITE verdict when a re-review flips it', () => {
    const r = run({
      labels: ['ai-review:changes', 'needs-human-review'],
      label: 'ai-review:pass',
    });
    expect(r.ok, r.out).toBe(true);
    expect(r.labels.sort()).toEqual(['ai-review:pass', 'needs-human-review']);
  });

  it('is a no-op on an already-correct PR', () => {
    const r = run({ labels: ['ai-review:pass'], label: 'ai-review:pass' });
    expect(r.ok, r.out).toBe(true);
    expect(r.labels).toEqual(['ai-review:pass']);
    expect(r.calls.join('\n')).not.toContain('--remove-label');
  });

  it('self-heals a removal that fails once — a blip must not red the run', () => {
    // The retry is the difference between "red on every GitHub hiccup" and "red only
    // when genuinely stuck". If the loop were decorative this case would fail.
    const r = run({
      labels: ['ai-review:changes'],
      label: 'ai-review:pass',
      stickyOnce: ['ai-review:changes'],
    });
    expect(r.ok, `a transient removal failure must self-heal:\n${r.out}`).toBe(true);
    expect(r.labels).toEqual(['ai-review:pass']);
  });

  it('FAILS when the contradiction survives, and names both labels', () => {
    // The #1430 wedge: the PR would otherwise sit on pass+changes forever, with
    // ready-to-merge red and nothing on the PR explaining why.
    const r = run({
      labels: ['ai-review:changes'],
      label: 'ai-review:pass',
      stickyForever: ['ai-review:changes'],
    });
    expect(r.ok, `a surviving contradiction must not exit 0:\n${r.out}`).toBe(false);
    expect(r.out).toContain('contradictory verdict labels');
    expect(r.out).toContain('ai-review:pass');
    expect(r.out).toContain('ai-review:changes');
    // The annotation is the whole point — a bare non-zero exit is still silent.
    expect(r.out).toContain('::error');
  });

  it('FAILS when a stale `ai-review:pending` survives alongside the verdict', () => {
    // pending is a verdict label too: pass+pending is the same contradiction, and
    // was previously removed with the loosest `|| true` of the three.
    const r = run({
      labels: ['ai-review:pending'],
      label: 'ai-review:pass',
      stickyForever: ['ai-review:pending'],
    });
    expect(r.ok, r.out).toBe(false);
    expect(r.out).toContain('ai-review:pending');
  });

  it('fails CLOSED on an unreadable label list — and does not call it "missing"', () => {
    // An API error is not "no verdict label present". Reporting it that way would
    // misattribute the failure and send the reader to the wrong knob — the same
    // defect class as #1471's pre-commit gate blaming a commit for HEAD's breakage.
    const r = run({ labels: ['ai-review:pass'], label: 'ai-review:pass', readFails: true });
    expect(r.ok, 'an unverifiable post-state must not read as verified').toBe(false);
    expect(r.out).toContain('could not be read');
    expect(r.out).toContain('unverifiable');
    expect(r.out).not.toContain('no verdict label present');
  });
});

describe('ai-review verdict labels: still wired into the shipped step', () => {
  it('lives inside the Post-verdict step, not orphaned elsewhere in the file', () => {
    const step = wf.indexOf('- name: Post verdict + apply label');
    const begin = wf.indexOf(BEGIN);
    const nextStep = wf.indexOf('\n      - name:', begin);
    expect(step).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(step);
    expect(wf.indexOf(END)).toBeLessThan(nextStep);
  });

  it('the guard no longer claims the seam is unwired', () => {
    // #1472 shipped these helpers with "NOT YET WIRED" docstrings, which were true
    // then and are false now. A stale one is a signpost that lies.
    const guard = fs.readFileSync(path.join(REPO_ROOT, '.github/scripts/ai-review-guard.js'), 'utf-8');
    expect(guard).not.toContain('NOT YET WIRED');
  });

  it('lives inside the fail-closed backstop step', () => {
    const step = wf.indexOf('- name: Fail closed');
    const begin = wf.indexOf(BACKSTOP_BEGIN);
    expect(step).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(step);
  });
});

/**
 * Same defect, SECOND location. The backstop cleared pass + pending but not
 * `ai-review:blocked`, so a PR sitting on blocked when the workflow errored kept it
 * alongside the new `ai-review:changes` — the wedge, reintroduced by the path that
 * exists to escape it.
 *
 * #1515's own review flagged the first version of this test: it asserted only that
 * the source text mentions `VERDICT_LABELS.filter`, which passes against a loop that
 * computes the list and never removes anything. Its name promised runtime clearing.
 * Same class of defect as the `NOT YET WIRED` docstring one level up, so it gets the
 * same treatment — run the block, don't grep it.
 */
describe('ai-review fail-closed backstop: clears every other verdict label', () => {
  it('clears pass, blocked AND pending, and leaves unrelated labels alone', () => {
    const r = runBackstop(
      ['ai-review:pass', 'ai-review:blocked', 'ai-review:pending', 'ai-review:changes', 'docs-lane'],
      { workspace: REPO_ROOT },
    );
    expect(r.ok, r.out).toBe(true);
    expect(r.labels.sort()).toEqual(['ai-review:changes', 'docs-lane']);
  });

  it('still clears all three when the base checkout is what failed', () => {
    // The literal fallback. If the checkout step is what errored there is no guard
    // module to read the list from, and the backstop must still leave one verdict.
    const r = runBackstop(['ai-review:blocked', 'ai-review:changes'], {
      workspace: '/nonexistent-workspace',
    });
    expect(r.ok, r.out).toBe(true);
    expect(r.labels).toEqual(['ai-review:changes']);
  });

  it('never fails the step itself — the honest `exit 1` below is the load-bearing part', () => {
    // Every call here is best-effort by design: a label API that refuses must not
    // pre-empt the backstop's own red exit.
    //
    // EVERY removal refuses, not just one. With a single sticky label this case was
    // VACUOUS: the loop's exit status is its LAST iteration's, the sticky label was
    // not last, and dropping `|| true` from the shipped loop still passed. Caught by
    // mutation, not by reading it.
    const r = runBackstop(['ai-review:pass', 'ai-review:blocked', 'ai-review:pending', 'ai-review:changes'], {
      workspace: REPO_ROOT,
      stickyForever: ['ai-review:pass', 'ai-review:blocked', 'ai-review:pending'],
    });
    expect(r.ok, `a refused removal must not abort the backstop:\n${r.out}`).toBe(true);
  });
});
