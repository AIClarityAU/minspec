/**
 * T0/T2 — specify-only dispatch for T3/T4 (#1169, implementing DR-076).
 *
 * DR-076 keeps exactly ONE review-shaped human moment: reading a T3/T4 spec before
 * anything is built from it. Triage used to spend a DIFFERENT one first — the human
 * had to read the RAW ISSUE (`needs-review`, hold `tier`) before an agent could even
 * write that spec, and then read the spec anyway at the approval gate. Two human
 * reads where the accepted decision funds one, and the raw-issue read is the lower
 * leverage of the two: an unrefined issue body is exactly the artifact the Specify
 * phase exists to turn into something worth human attention.
 *
 * So an auto-buildable T3/T4 now dispatches for the SPECIFY PHASE ONLY. The safety
 * property that replaces "a human read the issue first" is that the dispatch cannot
 * IMPLEMENT anything — and that is enforced deterministically here, not by asking the
 * model nicely (constitution: enforce, don't trust the model):
 *
 *   • the gate (dispatch-ready-check.sh) reports the mode as `ready-specify`;
 *   • the dispatcher selects a specify-only prompt on that signal alone;
 *   • a pre-publish SCOPE GUARD refuses to push a branch whose diff leaves the
 *     spec/decision corpus, so a prompt-injected or merely disobedient agent cannot
 *     turn a specify dispatch into an implement dispatch.
 *
 * The scope-guard assertions below run the real seam (`--specify-scope-stray`) rather
 * than grepping for its source text, so a guard that exists but does not classify
 * cannot pass them. The wiring assertions are text-level, matching the sibling
 * `dispatch-*.test.ts` style — there is no `claude -p` or `gh` invocation in CI.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

function findScriptsDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts');
    if (fs.existsSync(candidate) && fs.existsSync(path.join(dir, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repo-root scripts/ directory from ' + __dirname);
}

const scriptsDir = findScriptsDir();
const read = (f: string) => fs.readFileSync(path.join(scriptsDir, f), 'utf-8');

/** Source with comment-only lines stripped, so a prose mention can never satisfy a wiring assertion. */
const stripComments = (s: string) =>
  s
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

const DISPATCH = path.join(scriptsDir, 'dispatch-issue.sh');
const dispatchCode = stripComments(read('dispatch-issue.sh'));
const triageInboxCode = stripComments(read('triage-inbox.sh'));
const drainCode = stripComments(read('drain-inbox.sh'));
const triageRole = read('roles/triage.md');

/** Run the dispatcher's pure scope seam over a newline-separated path list. */
function scopeStray(paths: string[]): { violation: boolean; out: string } {
  try {
    const out = execFileSync('bash', [DISPATCH, '--specify-scope-stray'], {
      input: paths.join('\n') + '\n',
      encoding: 'utf-8',
    });
    return { violation: true, out: out.trim() };
  } catch (e: any) {
    return { violation: false, out: ((e.stdout ?? '') as string).toString().trim() };
  }
}

describe('dispatch-issue.sh — the specify-only scope guard actually classifies (#1169)', () => {
  it('a spec-only diff is in scope', () => {
    const r = scopeStray(['specs/minspec/SPEC-050-thing/requirements.md']);
    expect(r.violation).toBe(false);
    expect(r.out).toBe('');
  });

  it('a spec + decision-record diff is in scope (a spec may need its DR)', () => {
    const r = scopeStray([
      'specs/minspec/SPEC-050-thing/requirements.md',
      'docs/decisions/DR-077.md',
      'docs/decisions/INDEX.md',
    ]);
    expect(r.violation).toBe(false);
  });

  it('ANY source file in the diff is a violation, and the guard names it', () => {
    const r = scopeStray(['specs/minspec/SPEC-050-thing/requirements.md', 'packages/minspec/src/lib/thing.ts']);
    expect(r.violation).toBe(true);
    expect(r.out).toContain('packages/minspec/src/lib/thing.ts');
    // Only the stray is reported — the in-scope path is not noise in the refusal.
    expect(r.out).not.toContain('requirements.md');
  });

  it.each([
    ['packages/minspec/src/extension.ts'],
    ['packages/minspec/tests/thing.test.ts'],
    ['scripts/dispatch-issue.sh'],
    ['.github/workflows/ai-review.yml'],
    ['.minspec/config.json'],
    ['package.json'],
    ['README.md'],
    ['sites/minspec.dev/index.html'],
  ])('%s is out of scope for a specify-only dispatch', (p) => {
    expect(scopeStray([p]).violation).toBe(true);
  });

  it('a path that merely CONTAINS "specs/" is not in scope (anchored match)', () => {
    // `packages/minspec/tests/specs/x.md` is source, not the spec corpus.
    expect(scopeStray(['packages/minspec/tests/specs/x.md']).violation).toBe(true);
  });

  it('an empty diff is a violation — a specify dispatch that produced nothing must not publish', () => {
    // "Could not tell" and "nothing to say" both fail closed: the branch is not
    // pushed and the issue is surfaced, rather than an empty PR arriving as if the
    // spec had been written.
    expect(scopeStray([]).violation).toBe(true);
  });
});

describe('dispatch-issue.sh — the mode comes from the gate, and drives the prompt (#1169)', () => {
  it('reads the gate stdout to set specify-only mode (never re-derives it from the label)', () => {
    // #983: the label is a stamp of a verdict, never the verdict. The dispatcher
    // must take the mode from the gate that read the RECORD.
    expect(dispatchCode).toMatch(/READY_REASON.*ready-specify|ready-specify.*SPECIFY_ONLY/s);
    expect(dispatchCode).toMatch(/SPECIFY_ONLY=1/);
  });

  it('selects a prompt that forbids implementation and names the spec as the deliverable', () => {
    expect(dispatchCode).toMatch(/SPECIFY_ONLY/);
    const full = read('dispatch-issue.sh');
    expect(full).toMatch(/IMPLEMENTATION IS FORBIDDEN/);
    expect(full).toMatch(/spec PR is the deliverable/i);
    // The human's single read is the spec approval, and the prompt must say so —
    // an agent that thinks it is unblocking itself will keep going.
    expect(full).toMatch(/spec-approval gate|approves the spec/i);
  });

  it('the specify-only mandate overrides the role prompt where they conflict', () => {
    // The role file is the SYSTEM prompt (#912 context-slim), and `dev.md` tells its
    // agent to implement. Without an explicit override the two instructions collide.
    expect(read('dispatch-issue.sh')).toMatch(/overrides?[^\n]*role/i);
  });

  it('clears BOTH ready labels when the build starts (a stale one countermands the next verdict)', () => {
    const removeBlock = dispatchCode.match(/--remove-label "agent-ready[^"]*"/g) ?? [];
    expect(removeBlock.join(' ')).toContain('agent-ready-specify');
  });

  it('the scope guard is wired into the publish path, not merely defined', () => {
    // Defined-but-uncalled is the classic vacuous gate. It must sit between the
    // egress guard and the push, so a violation publishes NOTHING.
    expect(dispatchCode).toMatch(/specify_scope_report|specify_scope_stray/);
    expect(dispatchCode).toMatch(/run_egress_guard[\s\S]{0,600}specify_scope_report/);
  });
});

describe('triage-inbox.sh — the new label is minted and supersedes cleanly (#1169)', () => {
  it('creates the agent-ready-specify label before applying it', () => {
    // `gh issue edit --add-label` FAILS on a label the repo does not have, and this
    // script runs under `set -euo pipefail` — an uncreated label would abort the
    // whole drain, not just skip one issue.
    expect(triageInboxCode).toMatch(/gh label create "agent-ready-specify"/);
  });

  it('every non-specify verdict clears agent-ready-specify (and vice versa)', () => {
    const sup = triageInboxCode.match(/SUPERSEDED="[^"]*"/g) ?? [];
    expect(sup.length).toBeGreaterThanOrEqual(4);
    const specifyCase = sup.find((s) => s.includes('agent-ready-specify') && s.includes('agent-ready,'));
    // The specify verdict must clear plain agent-ready…
    expect(specifyCase, 'no SUPERSEDED entry clears plain agent-ready').toBeTruthy();
    // …and needs-review / needs-info must clear agent-ready-specify.
    const clearsSpecify = sup.filter((s) => s.includes('agent-ready-specify'));
    expect(clearsSpecify.length).toBeGreaterThanOrEqual(3);
  });

  it('still writes the verdict RECORD before any label (#983 ordering is untouched)', () => {
    const recordIdx = triageInboxCode.indexOf('gh issue comment');
    const labelIdx = triageInboxCode.indexOf('--add-label "role:');
    expect(recordIdx).toBeGreaterThan(-1);
    expect(labelIdx).toBeGreaterThan(recordIdx);
  });
});

describe('drain-inbox.sh — specify-ready work is actually enumerated (#1169)', () => {
  it('lists agent-ready-specify issues as well as agent-ready', () => {
    // `gh issue list --label A --label B` is an AND, so the two sets must be
    // enumerated separately. A verdict nothing dispatches is a queue, not a gate.
    expect(drainCode).toContain('agent-ready-specify');
    const listCalls = drainCode.match(/--label "agent-ready-specify"/g) ?? [];
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('scripts/roles/triage.md — the routing rule the agent reads (#1169)', () => {
  it('no longer tells the agent to send every T3/T4 to needs-review', () => {
    expect(triageRole).not.toMatch(/T3-T4\s*→\s*`?decision:\s*needs-review/);
  });

  it('routes auto-buildable T3/T4 to the affirmative decision, gate-converted to specify-only', () => {
    expect(triageRole).toMatch(/specify/i);
    expect(triageRole).toMatch(/DR-076|#1169/);
  });

  it('keeps the human-only filter absolute and fail-closed', () => {
    expect(triageRole).toMatch(/human-only/i);
    expect(triageRole).toMatch(/fails? CLOSED/i);
    expect(triageRole).toMatch(/NEVER\s+`?agent-ready/);
  });

  it('the agent still emits only the three original decision tokens', () => {
    // The specify class is DERIVED by the gate from `tier`. If the agent could
    // assert it, an injected issue body could request it.
    expect(triageRole).toMatch(/decision:\s*agent-ready \| needs-review \| needs-info/);
  });
});
