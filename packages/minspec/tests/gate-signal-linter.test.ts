/**
 * SPEC-054 gate-signal linter tests — one describe block per task.
 * Tests key on line content, never on line numbers.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import * as advisor from '../src/lib/ruleset-advisor';
import type { RulesetFull } from '../src/lib/ruleset-advisor';

import {
  GATE_LABEL_PATTERNS,
  GATE_MANIFEST,
} from '../../../scripts/lib/gate-manifest';
import {
  ScanError,
  SURFACING_FORMS,
  extractWorkflowUnits,
  isGateSignalWrite,
  makeJsUnit,
  makeShellUnit,
  renderReport,
  runCheck,
  scanJsUnit,
  scanShellUnit,
  scanSource,
  shellUnitFromScript,
  type WriteSite,
} from '../../../scripts/check-gate-signals';
import {
  SELF_CONTEXTS,
  evaluateWitnesses,
  readRequiredContexts,
  runAudit,
} from '../../../scripts/audit-gate-witnesses';
import type { GateEntry } from '../../../scripts/lib/gate-manifest';
import type { CommandResult } from '../src/lib/ruleset-advisor';

const REPO = join(__dirname, '../../..');
const GUARD = '.github/scripts/ai-review-guard.js';

/** Group-5 jobs that do not exist yet; exempt only while absent from the workflow. */
const PENDING_JOBS = new Set(['gate-witnesses']);

const matchesSet = (label: string) => GATE_LABEL_PATTERNS.some((p) => p.test(label));

/** Body of `function name(...) { ... }` by brace matching. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

/** Sample label for a `/^literal.../` regex: literal prefix plus one char. */
function sampleFromRegexSource(src: string): string {
  const body = src.replace(/^\^/, '');
  const m = /^[A-Za-z0-9:_-]*/.exec(body);
  return `${m ? m[0] : ''}x`;
}

/** Labels (sample strings) that `decideStatus` reads, derived from `source`. */
function labelsReadByDecideStatus(source: string): string[] {
  const body = functionBody(source, 'decideStatus');
  const out: string[] = [];
  const idents = new Set(body.match(/\b[A-Z][A-Z0-9_]*\b/g) ?? []);
  for (const id of idents) {
    const str = new RegExp(`^const ${id} = '([^']+)';`, 'm').exec(source);
    if (str && !str[1].includes('/')) out.push(str[1]);
    const re = new RegExp(`^const ${id} = /(.+)/[a-z]*;`, 'm').exec(source);
    if (re && id.endsWith('_RE')) out.push(sampleFromRegexSource(re[1]));
  }
  return out;
}

describe('FR-5 manifest', () => {
  const entry = (ctx: string) => {
    const e = GATE_MANIFEST.find((g) => g.context === ctx);
    if (!e) throw new Error(`no manifest entry for ${ctx}`);
    return e;
  };

  it('has the seven entries of the design', () => {
    expect(GATE_MANIFEST.map((g) => g.context).sort()).toEqual(
      ['MinSpec SDD validation', 'ai-review', 'build', 'gate-witnesses', 'lint', 'ready-to-merge', 'test'].sort(),
    );
  });

  it('ready-to-merge has two witnesses of different mechanisms with distinct signals', () => {
    const w = entry('ready-to-merge').witnesses;
    expect(w).toHaveLength(2);
    expect(new Set(w.map((x) => x.mechanism)).size).toBe(2);
    const status = w.find((x) => x.mechanism === 'status');
    const check = w.find((x) => x.mechanism === 'check-run');
    expect(status?.signal).toBe('ai-review/pass');
    expect(check?.signal).toBe('ai-review');
    for (const x of w) expect(x.signal).not.toBe('ready-to-merge');
  });

  it('every entry has at least one witness', () => {
    for (const g of GATE_MANIFEST) expect(g.witnesses.length, g.context).toBeGreaterThan(0);
  });

  it('every failClosed has a non-empty reason and an evidence path that exists', () => {
    for (const g of GATE_MANIFEST) {
      if (!g.failClosed) continue;
      expect(g.failClosed.reason.trim().length, g.context).toBeGreaterThan(0);
      expect(g.failClosed.evidence.trim().length, g.context).toBeGreaterThan(0);
      expect(existsSync(join(REPO, g.failClosed.evidence)), `${g.context}: ${g.failClosed.evidence}`).toBe(true);
    }
  });

  it('freshness: each witness workflow exists and holds its job (and step) name', () => {
    for (const g of GATE_MANIFEST) {
      for (const w of g.witnesses) {
        const path = join(REPO, w.workflow);
        expect(existsSync(path), `${g.context}: ${w.workflow}`).toBe(true);
        const text = readFileSync(path, 'utf8');
        const hasJob = new RegExp(`^  ${w.job}:\\s*$`, 'm').test(text);
        if (PENDING_JOBS.has(w.job) && !hasJob) continue;
        expect(hasJob, `${g.context}: job ${w.job} in ${w.workflow}`).toBe(true);
        if (w.step) {
          expect(text.includes(`- name: ${w.step}`), `${g.context}: step "${w.step}"`).toBe(true);
        }
      }
    }
  });

  it('GATE_LABEL_PATTERNS matches the gate labels and not the advisory ones', () => {
    for (const l of ['ai-review:pass', 'ai-review:carried', 'ready-to-merge', 'awaiting-approval', 'blocked-by', 'hold:tier']) {
      expect(matchesSet(l), l).toBe(true);
    }
    for (const l of ['agent-ready', 'needs-human-review']) {
      expect(matchesSet(l), l).toBe(false);
    }
  });

  it('derived-from: every label decideStatus reads matches some pattern', () => {
    const labels = labelsReadByDecideStatus(readFileSync(join(REPO, GUARD), 'utf8'));
    expect(labels).toEqual(expect.arrayContaining(['ai-review:pass', 'ai-review:changes']));
    expect(labels.some((l) => l.startsWith('hold:'))).toBe(true);
    for (const l of labels) expect(matchesSet(l), l).toBe(true);
  });

  it('derived-from fails when decideStatus reads a label the set lacks (planted FOO_RE)', () => {
    const real = readFileSync(join(REPO, GUARD), 'utf8');
    const planted = real
      .replace('const HOLD_RE =', 'const FOO_RE = /^foo:/;\nconst HOLD_RE =')
      .replace('const held = [...eff]', 'const foo = [...eff].filter((l) => FOO_RE.test(l));\n  const held = [...eff]');
    expect(planted).not.toBe(real);
    const labels = labelsReadByDecideStatus(planted);
    expect(labels.filter((l) => !matchesSet(l))).toEqual(['foo:x']);
  });
});

describe('INV-4 exports', () => {
  const guarding = {
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'test' }, { context: 'lint' }, { context: '' }],
        },
      },
    ],
  };
  const allRef = {
    conditions: { ref_name: { include: ['~ALL'] } },
    rules: [
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'build' }] },
      },
    ],
  };
  const noChecksRule = {
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
    rules: [{ type: 'deletion' }],
  };

  it('exports both helpers as functions', () => {
    expect(typeof advisor.rulesetGuardsDefaultBranchChecks).toBe('function');
    expect(typeof advisor.extractRequiredContexts).toBe('function');
  });

  it('rulesetGuardsDefaultBranchChecks: guarding ruleset → true', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(guarding)).toBe(true);
  });

  it('rulesetGuardsDefaultBranchChecks: ~ALL ruleset → true', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(allRef)).toBe(true);
  });

  it('rulesetGuardsDefaultBranchChecks: no required_status_checks rule → false', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(noChecksRule)).toBe(false);
  });

  it('rulesetGuardsDefaultBranchChecks: null → false', () => {
    expect(advisor.rulesetGuardsDefaultBranchChecks(null)).toBe(false);
  });

  it('extractRequiredContexts: guarding ruleset → non-empty contexts only', () => {
    expect(advisor.extractRequiredContexts(guarding as RulesetFull)).toEqual(['test', 'lint']);
  });

  it('extractRequiredContexts: ~ALL ruleset → its contexts', () => {
    expect(advisor.extractRequiredContexts(allRef as RulesetFull)).toEqual(['build']);
  });

  it('extractRequiredContexts: no required_status_checks rule → []', () => {
    expect(advisor.extractRequiredContexts(noChecksRule as RulesetFull)).toEqual([]);
  });

  it('extractRequiredContexts: null → throws as today (callers guard first)', () => {
    expect(() => advisor.extractRequiredContexts(null as unknown as RulesetFull)).toThrow();
  });
});

// ── Group 2/3 helpers ────────────────────────────────────────────────────────

type Opts = { errexit: boolean; pipefail: boolean };
const RUN: Opts = { errexit: true, pipefail: false };

const shell = (body: string, opts: Opts = RUN, firstLine = 1): WriteSite[] =>
  scanShellUnit(makeShellUnit('t.yml', body, firstLine, opts));

/** The verdict of the one write whose source line contains `needle`. */
function verdictOf(sites: readonly WriteSite[], needle: string): string {
  const hits = sites.filter((s) => s.text.includes(needle));
  if (hits.length !== 1) throw new Error(`expected one write containing ${needle}, got ${hits.length}`);
  return hits[0].verdict;
}

const lineOf = (source: string, needle: string): number => {
  const i = source.split('\n').findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`no line contains ${needle}`);
  return i + 1;
};

const STATUS_W = 'gh api "repos/$REPO/statuses/$SHA" -f state=success -f context="ai-review/pass"';
const LABEL_W = 'gh pr edit "$PR" --add-label ready-to-merge';

/** A one-job workflow whose single step runs `body` (indented for a `run: |` block). */
function workflow(body: string, extra = ''): string {
  const indented = body
    .split('\n')
    .map((l) => (l ? `          ${l}` : l))
    .join('\n');
  return [
    'name: fixture',
    'on: pull_request',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: post',
    extra ? `        ${extra}` : '',
    '        run: |',
    indented,
    '',
  ]
    .filter((l, i) => !(i === 7 && l === ''))
    .join('\n');
}

describe('FR-1 write predicate', () => {
  it('matches a commit-status post', () => {
    expect(isGateSignalWrite(STATUS_W)).toBe(true);
  });
  it('matches check-run writes by -X POST, -X PATCH, --method and fields', () => {
    expect(isGateSignalWrite('gh api -X POST "repos/$REPO/check-runs" --input "$BODY"')).toBe(true);
    expect(isGateSignalWrite('gh api -X PATCH "repos/$REPO/check-runs/$ID"')).toBe(true);
    expect(isGateSignalWrite('gh api --method POST repos/o/r/check-runs')).toBe(true);
    expect(isGateSignalWrite('gh api repos/o/r/check-runs -f name=ai-review -f head_sha=x')).toBe(true);
    expect(isGateSignalWrite('gh api repos/o/r/check-runs -F conclusion=success')).toBe(true);
    expect(isGateSignalWrite('gh api repos/o/r/check-runs --input body.json')).toBe(true);
  });
  it('does not match a check-runs GET read', () => {
    expect(
      isGateSignalWrite('gh api "repos/$REPO/commits/$SHA/check-runs?check_name=ai-review&filter=all"'),
    ).toBe(false);
  });
  it('matches gate label writes on pr and issue edit', () => {
    expect(isGateSignalWrite(LABEL_W)).toBe(true);
    expect(isGateSignalWrite('gh issue edit 5 --remove-label "ai-review:pass"')).toBe(true);
    expect(isGateSignalWrite('gh pr edit 5 --add-label=hold:tier')).toBe(true);
    expect(isGateSignalWrite('GH_TOKEN="$T" gh pr edit 5 --add-label "blocked-by"')).toBe(true);
  });
  it('does not match label creation (DQ-7 narrower predicate)', () => {
    expect(isGateSignalWrite('gh label create "ai-review:pass" --color 0e8a16')).toBe(false);
  });
  it('does not match a non-gate label write', () => {
    expect(isGateSignalWrite('gh issue edit 5 --remove-label agent-ready')).toBe(false);
    expect(isGateSignalWrite('gh pr edit 5 --add-label "needs-human-review"')).toBe(false);
  });
  it('treats a variable label as gate-relevant', () => {
    expect(isGateSignalWrite('gh pr edit 5 --add-label "$LABEL"')).toBe(true);
    expect(isGateSignalWrite('gh pr edit 5 --remove-label "$_other"')).toBe(true);
  });
  it('matches when any label of a comma list is a gate label', () => {
    expect(isGateSignalWrite('gh pr edit 5 --add-label "agent-ready,ready-to-merge"')).toBe(true);
  });
});

describe('FR-1 shell model', () => {
  it('AC-1: a status post with || true is unobserved', () => {
    expect(verdictOf(shell(`${STATUS_W} || true`), 'statuses/')).toBe('unobserved');
  });

  it('AC-2: tested and warned is ok; tested with an empty or plain failure branch is unsurfaced', () => {
    const warned = `if ! ${STATUS_W} >/dev/null 2>&1; then\n  echo "::warning title=x::status not posted"\nfi`;
    expect(verdictOf(shell(warned), 'statuses/')).toBe('ok');
    const plain = `if ! ${STATUS_W} >/dev/null 2>&1; then\n  echo "status not posted"\nfi`;
    expect(verdictOf(shell(plain), 'statuses/')).toBe('unsurfaced');
    const empty = `if ${STATUS_W} >/dev/null 2>&1; then\n  echo posted\nfi`;
    expect(verdictOf(shell(empty), 'statuses/')).toBe('unsurfaced');
    const elseWarn = `if ${STATUS_W}; then\n  echo posted\nelse\n  echo "::error::not posted"\nfi`;
    expect(verdictOf(shell(elseWarn), 'statuses/')).toBe('ok');
  });

  it('a bare write after set -uo pipefail in a run: unit is ok (inherited -e)', () => {
    expect(verdictOf(shell(`set -uo pipefail\n${LABEL_W}`), '--add-label')).toBe('ok');
  });

  it('the same after set +e is unobserved', () => {
    expect(verdictOf(shell(`set -uo pipefail\nset +e\n${LABEL_W}`), '--add-label')).toBe('unobserved');
    expect(verdictOf(shell(`set +o errexit\n${LABEL_W}`), '--add-label')).toBe('unobserved');
    expect(verdictOf(shell(`set +e\nset -e\n${LABEL_W}`), '--add-label')).toBe('ok');
  });

  it('a .sh unit with no set -e and a bare write is unobserved; with set -e it is ok', () => {
    const bare = shellUnitFromScript('x.sh', `#!/usr/bin/env bash\n${LABEL_W}\n`);
    expect(verdictOf(scanShellUnit(bare), '--add-label')).toBe('unobserved');
    const strict = shellUnitFromScript('x.sh', `#!/usr/bin/env bash\nset -euo pipefail\n${LABEL_W}\n`);
    expect(verdictOf(scanShellUnit(strict), '--add-label')).toBe('ok');
    const shebang = shellUnitFromScript('x.sh', `#!/bin/bash -e\n${LABEL_W}\n`);
    expect(verdictOf(scanShellUnit(shebang), '--add-label')).toBe('ok');
  });

  it('|| : and ; true are unobserved', () => {
    expect(verdictOf(shell(`${LABEL_W} || :`), '--add-label')).toBe('unobserved');
    expect(verdictOf(shell(`${LABEL_W}; true`), '--add-label')).toBe('unobserved');
    expect(verdictOf(shell(`${LABEL_W} 2>/dev/null || true`), '--add-label')).toBe('unobserved');
  });

  it('local x=$(write) is unobserved; plain x=$(write) under -e is ok', () => {
    const local = `f() {\n  local x=$(${STATUS_W})\n}`;
    expect(verdictOf(shell(local), 'statuses/')).toBe('unobserved');
    expect(verdictOf(shell(`x=$(${STATUS_W})`), 'statuses/')).toBe('ok');
    expect(verdictOf(shell(`echo "$(${STATUS_W})"`), 'statuses/')).toBe('unobserved');
    expect(verdictOf(shell(`x=$(${STATUS_W})`, { errexit: false, pipefail: false }), 'statuses/')).toBe(
      'unobserved',
    );
  });

  it('W || { echo "::error ..."; exit 1; } is ok; an exit 0 branch is unsurfaced', () => {
    expect(verdictOf(shell(`${LABEL_W} || { echo "::error::label failed"; exit 1; }`), '--add-label')).toBe('ok');
    expect(verdictOf(shell(`${LABEL_W} || { echo "label failed"; exit 1; }`), '--add-label')).toBe('ok');
    expect(verdictOf(shell(`${LABEL_W} || { echo "label failed"; exit 0; }`), '--add-label')).toBe('unsurfaced');
    expect(verdictOf(shell(`${LABEL_W} || echo plain`), '--add-label')).toBe('unsurfaced');
  });

  it('a $GITHUB_STEP_SUMMARY branch is ok', () => {
    const body = `if ! ${LABEL_W}; then\n  echo "label not applied" >> "$GITHUB_STEP_SUMMARY"\nfi`;
    expect(verdictOf(shell(body), '--add-label')).toBe('ok');
    const unquoted = `${LABEL_W} || echo "label not applied" >>$GITHUB_STEP_SUMMARY`;
    expect(verdictOf(shell(unquoted), '--add-label')).toBe('ok');
  });

  it('a write split by \\ continuations reports its first line', () => {
    const body = `echo before\ngh api \\\n  "repos/$REPO/statuses/$SHA" \\\n  -f state=success || true`;
    const sites = shell(body, RUN, 10);
    expect(sites).toHaveLength(1);
    expect(sites[0].line).toBe(11);
    expect(sites[0].verdict).toBe('unobserved');
  });

  it('pipeline: unobserved without pipefail, ok with set -o pipefail or shell: bash', () => {
    const piped = `${STATUS_W} | jq .`;
    expect(verdictOf(shell(piped), 'statuses/')).toBe('unobserved');
    expect(verdictOf(shell(`set -o pipefail\n${piped}`), 'statuses/')).toBe('ok');
    expect(verdictOf(shell(piped, { errexit: true, pipefail: true }), 'statuses/')).toBe('ok');
    expect(verdictOf(shell(`echo x | ${LABEL_W}`), '--add-label')).toBe('ok');
  });

  it('&& lists: a non-final write is unobserved, a final write follows errexit', () => {
    expect(verdictOf(shell('gh pr edit 1 --add-label ready-to-merge && echo done'), '--add-label')).toBe(
      'unobserved',
    );
    expect(verdictOf(shell('echo go && gh pr edit 1 --add-label ready-to-merge'), '--add-label')).toBe('ok');
    expect(
      verdictOf(shell('gh pr edit 1 --add-label ready-to-merge && echo done || echo "::warning::x"'), '--add-label'),
    ).toBe('ok');
  });

  it('a write in a single-quoted string or heredoc is not a write', () => {
    expect(shell(`node -e '\n  ${LABEL_W} || true\n'`)).toEqual([]);
    expect(shell(`cat <<EOF\n${LABEL_W} || true\nEOF\necho after`)).toEqual([]);
    expect(shell(`# ${LABEL_W} || true`)).toEqual([]);
  });

  it('a negated write as a plain statement is unobserved', () => {
    expect(verdictOf(shell(`! ${LABEL_W}`), '--add-label')).toBe('unobserved');
  });

  it('a write in a while condition with no surfaced exit is unsurfaced', () => {
    expect(verdictOf(shell(`while ${LABEL_W}; do\n  sleep 1\ndone`), '--add-label')).toBe('unsurfaced');
  });

  it('a backgrounded write is unobserved', () => {
    expect(verdictOf(shell(`${LABEL_W} &\nwait`), '--add-label')).toBe('unobserved');
  });

  it('the surfacing forms are one exported constant', () => {
    expect(SURFACING_FORMS.shell.some((r) => r.test('echo "::warning::x"'))).toBe(true);
    expect(SURFACING_FORMS.shell.some((r) => r.test('echo "::error::x"'))).toBe(true);
    expect(SURFACING_FORMS.shell.some((r) => r.test("echo x >> '$GITHUB_STEP_SUMMARY'"))).toBe(true);
    expect(SURFACING_FORMS.javascript).toEqual(
      expect.arrayContaining(['core.warning', 'core.error', 'core.setFailed', 'core.summary']),
    );
  });
});

const EXTRACT_FIXTURE = [
  'name: extract',
  'on: push',
  'jobs:',
  '  a:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - name: literal',
  '        run: |',
  '          echo one',
  '          gh api "repos/$R/statuses/$S" -f state=success || true',
  '      - name: strip',
  '        run: |-',
  '          gh pr edit 1 --add-label "ai-review:pass" || true',
  '      - name: folded',
  '        run: >',
  '          echo folded-one',
  '',
  '          gh pr edit 2',
  '          --add-label "ai-review:changes" || true',
  '      - name: oneline',
  '        run: gh pr edit 3 --add-label "ready-to-merge" || true',
  '      - name: custom',
  '        shell: bash {0}',
  '        run: |',
  '          gh pr edit 4 --add-label "hold:tier"',
  '      - name: bash',
  '        run: |',
  '          gh pr edit 5 --add-label "blocked-by" | cat',
  '        shell: bash',
  '      - uses: actions/github-script@v7',
  '        with:',
  '          script: |',
  '            github.rest.issues.addLabels({ owner: o, repo: r, issue_number: 1, labels: ["awaiting-approval"] });',
  '',
].join('\n');

describe('FR-1 workflow extraction', () => {
  const units = extractWorkflowUnits('w.yml', EXTRACT_FIXTURE);
  const sites = [...units.shell.flatMap((u) => scanShellUnit(u)), ...units.js.flatMap((u) => scanJsUnit(u))];
  const at = (needle: string) => {
    const s = sites.find((x) => x.line === lineOf(EXTRACT_FIXTURE, needle));
    if (!s) throw new Error(`no write reported at the line holding ${needle}`);
    return s;
  };

  it('extracts every run: and github-script block', () => {
    expect(units.shell).toHaveLength(6);
    expect(units.js).toHaveLength(1);
  });

  it('literal, strip-literal, folded and one-line forms map back to their source lines', () => {
    expect(at('statuses/$S').verdict).toBe('unobserved');
    expect(at('gh pr edit 1').verdict).toBe('unobserved');
    expect(at('gh pr edit 2').verdict).toBe('unobserved');
    expect(at('gh pr edit 3').verdict).toBe('unobserved');
  });

  it('shell: bash {0} clears errexit; shell: bash keeps it and adds pipefail', () => {
    expect(at('gh pr edit 4').verdict).toBe('unobserved');
    expect(at('gh pr edit 5').verdict).toBe('ok');
  });

  it('a github-script block maps back to its source line', () => {
    expect(at('awaiting-approval').verdict).toBe('unobserved');
  });

  it('an unrecognised block shape throws the could-not-run error', () => {
    const multiPlain = EXTRACT_FIXTURE.replace(
      '        run: gh pr edit 3 --add-label "ready-to-merge" || true',
      '        run: echo a\n          gh pr edit 9 --add-label ready-to-merge',
    );
    expect(() => extractWorkflowUnits('w.yml', multiPlain)).toThrow(ScanError);
    const badHeader = EXTRACT_FIXTURE.replace('        run: |-', '        run: |x');
    expect(() => extractWorkflowUnits('w.yml', badHeader)).toThrow(ScanError);
    expect(() => extractWorkflowUnits('w.yml', EXTRACT_FIXTURE.replace('shell: bash {0}', 'shell: pwsh'))).toThrow(
      ScanError,
    );
  });

  it('a job-level defaults.run.shell applies to its steps', () => {
    const src = [
      'on: push',
      'jobs:',
      '  a:',
      '    defaults:',
      '      run:',
      '        shell: bash {0}',
      '    steps:',
      '      - run: gh pr edit 1 --add-label ready-to-merge',
      '',
    ].join('\n');
    const u = extractWorkflowUnits('d.yml', src).shell;
    expect(u).toHaveLength(1);
    expect(scanShellUnit(u[0])[0].verdict).toBe('unobserved');
  });
});

describe('FR-1 javascript model', () => {
  const js = (code: string) => scanJsUnit(makeJsUnit('t.js', code, 1, true));
  const STATUS = "github.rest.repos.createCommitStatus({ owner, repo, sha, state: 'success', context: 'x' })";
  const REMOVE = "github.rest.issues.removeLabel({ owner, repo, issue_number: 1, name: 'ai-review:pass' })";

  it('awaited and not caught is ok', () => {
    expect(verdictOf(js(`await ${STATUS};`), 'createCommitStatus')).toBe('ok');
    expect(verdictOf(js(`return ${STATUS};`), 'createCommitStatus')).toBe('ok');
  });
  it('a floating promise is unobserved', () => {
    expect(verdictOf(js(`${STATUS};`), 'createCommitStatus')).toBe('unobserved');
  });
  it('.catch(() => {}) is unsurfaced', () => {
    expect(verdictOf(js(`await ${REMOVE}.catch(() => {});`), 'removeLabel')).toBe('unsurfaced');
  });
  it('.catch with core.warning is ok', () => {
    expect(verdictOf(js(`await ${REMOVE}.catch((e) => core.warning(String(e)));`), 'removeLabel')).toBe('ok');
  });
  it('catch (e) { core.warning(...) } is ok', () => {
    expect(verdictOf(js(`try {\n  await ${STATUS};\n} catch (e) {\n  core.warning(String(e));\n}`), 'createCommitStatus')).toBe('ok');
  });
  it('catch (e) { if (!isBenign(e)) throw e; } is ok', () => {
    expect(verdictOf(js(`try {\n  await ${REMOVE};\n} catch (e) {\n  if (!isBenign(e)) throw e;\n}`), 'removeLabel')).toBe('ok');
  });
  it('catch (e) { console.log(e) } is unsurfaced', () => {
    expect(verdictOf(js(`try {\n  await ${REMOVE};\n} catch (e) {\n  console.log(e);\n}`), 'removeLabel')).toBe('unsurfaced');
  });
  it('follows one level into a same-block helper', () => {
    const code = `function warn(e) {\n  core.warning(String(e));\n}\ntry {\n  await ${REMOVE};\n} catch (e) {\n  warn(e);\n}`;
    expect(verdictOf(js(code), 'removeLabel')).toBe('ok');
    const deep = `function deeper(e) { core.warning(String(e)); }\nfunction warn(e) { deeper(e); }\ntry {\n  await ${REMOVE};\n} catch (e) {\n  warn(e);\n}`;
    expect(verdictOf(js(deep), 'removeLabel')).toBe('unsurfaced');
  });
  it('issues.createLabel is not a write; a non-gate literal label is not a write', () => {
    expect(js("await github.rest.issues.createLabel({ owner, repo, name: 'ai-review:pass' });")).toEqual([]);
    expect(js("await github.rest.issues.addLabels({ owner, repo, issue_number: 1, labels: ['needs-human-review'] });")).toEqual([]);
  });
  it('check-run create and update are writes', () => {
    expect(verdictOf(js("github.rest.checks.create({ owner, repo, name: 'ai-review' });"), 'checks.create')).toBe('unobserved');
    expect(verdictOf(js('await github.rest.checks.update({ owner, repo, check_run_id: 1 });'), 'checks.update')).toBe('ok');
  });
  it('a write inside a returned arrow follows its awaited caller', () => {
    const code = `try {\n  await withRetry('x', () => ${STATUS});\n} catch (e) {\n  console.log(e);\n}`;
    expect(verdictOf(js(code), 'createCommitStatus')).toBe('unsurfaced');
    expect(verdictOf(js(`await withRetry('x', () => ${STATUS});`), 'createCommitStatus')).toBe('ok');
  });
});

describe('FR-2 annotations', () => {
  const AC1 = `${STATUS_W} || true`;
  const REASON = 'cosmetic mirror; the ai-review check-run is the witness';

  it('AC-3: a reasoned annotation waives the write, and the summary names file, line and reason', () => {
    const src = workflow(`# gate-signal-allow: ${REASON}\n${AC1}`);
    const r = scanSource('w.yml', src);
    expect(r.findings).toEqual([]);
    expect(r.waivers).toHaveLength(1);
    const report = renderReport(r.findings, r.waivers);
    expect(report).toContain(`w.yml:${lineOf(src, 'statuses/')}`);
    expect(report).toContain(REASON);
    expect(report).toContain('1 waiver honoured');
  });

  it('the waiver summary always renders, including 0 waivers honoured', () => {
    const r = scanSource('w.yml', workflow('echo nothing'));
    expect(renderReport(r.findings, r.waivers)).toContain('0 waivers honoured');
  });

  it('an annotation two lines above does not waive (and is an orphan)', () => {
    const src = workflow(`# gate-signal-allow: ${REASON}\necho between\n${AC1}`);
    const kinds = scanSource('w.yml', src).findings.map((f) => f.kind).sort();
    expect(kinds).toEqual(['orphan annotation', 'unobserved']);
  });

  it('a bare annotation is a finding and does not waive', () => {
    const src = workflow(`# gate-signal-allow:\n${AC1}`);
    const kinds = scanSource('w.yml', src).findings.map((f) => f.kind).sort();
    expect(kinds).toEqual(['bare annotation', 'unobserved']);
  });

  it('an annotation above a non-write is an orphan finding', () => {
    const src = workflow(`# gate-signal-allow: ${REASON}\necho hello`);
    const f = scanSource('w.yml', src).findings;
    expect(f.map((x) => x.kind)).toEqual(['orphan annotation']);
    expect(f[0].line).toBe(lineOf(src, 'gate-signal-allow'));
  });

  it('a // annotation waives a JavaScript write', () => {
    const src = `// gate-signal-allow: ${REASON}\ngithub.rest.repos.createCommitStatus({ owner, repo, sha });\n`;
    const r = scanSource('.github/scripts/x.js', src);
    expect(r.findings).toEqual([]);
    expect(r.waivers.map((w) => w.reason)).toEqual([REASON]);
  });

  it('an annotation above an ok write is neither a finding nor a waiver', () => {
    const src = workflow(`# gate-signal-allow: ${REASON}\n${LABEL_W}`);
    const r = scanSource('w.yml', src);
    expect(r.findings).toEqual([]);
    expect(r.waivers).toEqual([]);
  });
});

describe('FR-1 entry', () => {
  const roots: string[] = [];
  const makeRoot = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'gate-signals-'));
    roots.push(root);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  };
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
  };
  const AC1_WORKFLOW = workflow(`${STATUS_W} || true`);

  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('AC-1: a fixture root holding the AC-1 workflow exits 1 and prints the line', () => {
    const root = makeRoot({ '.github/workflows/ac1.yml': AC1_WORKFLOW });
    const c = capture();
    expect(runCheck(['--root', root], c.io)).toBe(1);
    const text = c.out.join('\n');
    expect(text).toContain(`.github/workflows/ac1.yml:${lineOf(AC1_WORKFLOW, 'statuses/')}`);
    expect(text).toContain('unobserved');
    expect(text).toContain('0 waivers honoured');
  });

  it('scans scripts/ shell and JavaScript, and .github/scripts, but not tests', () => {
    const root = makeRoot({
      '.github/workflows/ok.yml': workflow('echo fine'),
      'scripts/a.sh': `#!/usr/bin/env bash\n${LABEL_W}\n`,
      'scripts/lib/b.ts': "void github.rest.issues.removeLabel({ name: 'ai-review:pass' });\n",
      '.github/scripts/c.js': "github.rest.checks.create({ name: 'x' });\n",
      '.github/scripts/c.test.js': "github.rest.checks.create({ name: 'x' });\n",
      'scripts/tests/d.sh': `${LABEL_W}\n`,
      'scripts/e.test.ts': "github.rest.checks.create({ name: 'x' });\n",
    });
    const c = capture();
    expect(runCheck(['--root', root], c.io)).toBe(1);
    const text = c.out.join('\n');
    expect(text).toContain('scripts/a.sh:2');
    expect(text).toContain('scripts/lib/b.ts:1');
    expect(text).toContain('.github/scripts/c.js:1');
    expect(text).not.toContain('c.test.js');
    expect(text).not.toContain('scripts/tests/d.sh');
    expect(text).not.toContain('e.test.ts');
  });

  it('a clean fixture root exits 0', () => {
    const root = makeRoot({ '.github/workflows/ok.yml': workflow('echo fine') });
    expect(runCheck(['--root', root], capture().io)).toBe(0);
  });

  it('an empty workflows directory exits 2', () => {
    const root = makeRoot({ '.github/workflows/.keep': '' });
    const c = capture();
    expect(runCheck(['--root', root], c.io)).toBe(2);
    expect(c.err.join('\n')).toMatch(/no workflow/i);
  });

  it('an unreadable file exits 2 naming it (a dangling symlink cannot be read)', () => {
    const root = makeRoot({ '.github/workflows/ok.yml': workflow('echo fine') });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    symlinkSync(join(root, 'nowhere.sh'), join(root, 'scripts/broken.sh'));
    const c = capture();
    expect(runCheck(['--root', root], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('scripts/broken.sh');
  });

  it('a missing root exits 2', () => {
    expect(runCheck(['--root', join(tmpdir(), 'gate-signals-does-not-exist-xyz')], capture().io)).toBe(2);
  });

  it('a block shape the extractor does not recognise exits 2 naming the file', () => {
    const root = makeRoot({ '.github/workflows/bad.yml': AC1_WORKFLOW.replace('run: |', 'run: |x') });
    const c = capture();
    expect(runCheck(['--root', root], c.io)).toBe(2);
    expect(c.err.join('\n')).toContain('bad.yml');
  });

  it('the main guard runs the CLI when executed directly (exit 1 on the AC-1 root)', () => {
    const root = makeRoot({ '.github/workflows/ac1.yml': AC1_WORKFLOW });
    let status = 0;
    let stdout = '';
    try {
      execFileSync('npx', ['tsx', 'scripts/check-gate-signals.ts', '--root', root], { cwd: REPO, encoding: 'utf8' });
    } catch (e) {
      status = (e as { status: number }).status;
      stdout = (e as { stdout: string }).stdout;
    }
    expect(status).toBe(1);
    expect(stdout).toContain('ac1.yml');
  }, 60_000);

  it('AC-8: the scanner and manifest import nothing networked', () => {
    for (const rel of ['scripts/check-gate-signals.ts', 'scripts/lib/gate-manifest.ts']) {
      const text = readFileSync(join(REPO, rel), 'utf8');
      for (const banned of [/child_process/, /node:https?/, /\bfetch\(/, /octokit/i]) {
        expect(banned.test(text), `${rel} mentions ${banned}`).toBe(false);
      }
    }
  });

  it('package.json carries the check:gate-signals script', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:gate-signals']).toBe('npx tsx scripts/check-gate-signals.ts');
  });
});

describe('AC-4 #810 regression', () => {
  const PRE_854 = [
    'gh api "repos/$REPO/statuses/$PR_HEAD_SHA" \\',
    '  -f state="$PASS_STATE" \\',
    '  -f context="ai-review/pass" \\',
    '  -f description="$PASS_DESC" >/dev/null 2>&1 || true',
  ].join('\n');

  it('the pre-#854 status line is a finding', () => {
    const src = workflow(PRE_854);
    const f = scanSource('ai-review.yml', src).findings;
    expect(f.map((x) => [x.line, x.kind])).toEqual([[lineOf(src, 'statuses/$PR_HEAD_SHA'), 'unobserved']]);
  });

  it('the real ai-review.yml: no finding on the status post or either check-run POST', () => {
    const path = '.github/workflows/ai-review.yml';
    const src = readFileSync(join(REPO, path), 'utf8');
    const r = scanSource(path, src);
    const lines = src.split('\n');
    const statusLines = lines.flatMap((l, i) => (l.includes('statuses/$PR_HEAD_SHA') ? [i + 1] : []));
    const checkLines = lines.flatMap((l, i) => (l.includes('-X POST "repos/$REPO/check-runs"') ? [i + 1] : []));
    expect(statusLines).toHaveLength(1);
    expect(checkLines).toHaveLength(2);
    const findingLines = new Set(r.findings.map((f) => f.line));
    for (const n of [...statusLines, ...checkLines]) {
      // Not vacuous: the scanner saw each one as a write and judged it ok.
      expect(r.sites.find((s) => s.line === n)?.verdict, `line ${n}`).toBe('ok');
      expect(findingLines.has(n), `line ${n}`).toBe(false);
    }
  });
});

// ── FR-3 ─────────────────────────────────────────────────────────────────────

const witness = (mechanism: 'status' | 'check-run' | 'label', signal = 'x') => ({
  workflow: '.github/workflows/ci.yml',
  job: 'j',
  mechanism,
  signal,
  permission: 'checks:write' as const,
  app: 'github-actions[bot]',
});

describe('FR-3 evaluate', () => {
  it('SELF_CONTEXTS is lint and gate-witnesses', () => {
    expect([...SELF_CONTEXTS]).toEqual(['lint', 'gate-witnesses']);
  });

  it('AC-5: a required context with one witness and no failClosed is a finding', () => {
    const manifest: GateEntry[] = [{ context: 'solo', witnesses: [witness('check-run')] }];
    const r = evaluateWitnesses(['solo'], manifest, []);
    expect(r.findings).toEqual([expect.objectContaining({ context: 'solo', kind: 'single witness (AC-5)' })]);
  });

  it('AC-6: ready-to-merge passes against the real GATE_MANIFEST', () => {
    const r = evaluateWitnesses(['ready-to-merge'], GATE_MANIFEST, []);
    expect(r.findings).toEqual([]);
    expect(r.honoured).toEqual([]);
  });

  it('two witnesses of the same mechanism fail', () => {
    const manifest: GateEntry[] = [
      { context: 'twin', witnesses: [witness('check-run', 'a'), witness('check-run', 'b')] },
    ];
    expect(evaluateWitnesses(['twin'], manifest, []).findings.map((f) => f.kind)).toEqual(['single witness (AC-5)']);
  });

  it('a required context missing from the manifest is a finding', () => {
    const r = evaluateWitnesses(['ghost'], GATE_MANIFEST, []);
    expect(r.findings).toEqual([expect.objectContaining({ context: 'ghost', kind: 'no manifest entry' })]);
  });

  it('a single witness with a valid failClosed is honoured and reported', () => {
    const r = evaluateWitnesses(['ai-review'], GATE_MANIFEST, []);
    expect(r.findings).toEqual([]);
    expect(r.honoured.map((h) => h.context)).toEqual(['ai-review']);
  });

  it('a failClosed with an empty reason or evidence is an invalid annotation', () => {
    const manifest: GateEntry[] = [
      { context: 'a', witnesses: [witness('check-run')], failClosed: { reason: ' ', evidence: 'ci.yml' } },
      { context: 'b', witnesses: [witness('check-run')], failClosed: { reason: 'r', evidence: '' } },
    ];
    expect(evaluateWitnesses(['a', 'b'], manifest, []).findings.map((f) => f.kind)).toEqual([
      'invalid fail-closed annotation',
      'invalid fail-closed annotation',
    ]);
  });

  it('AC-10: required lacking gate-witnesses yields not a required context, listing every observed context', () => {
    const observed = ['lint', 'test', 'MinSpec SDD validation', 'ai-review', 'ready-to-merge', 'build'];
    const r = evaluateWitnesses(observed, GATE_MANIFEST, SELF_CONTEXTS);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toEqual(expect.objectContaining({ context: 'gate-witnesses', kind: 'not a required context' }));
    for (const c of observed) expect(r.findings[0].detail).toContain(c);
  });

  it('an unrequired manifest entry is a notice, not a finding', () => {
    const r = evaluateWitnesses(['ready-to-merge'], GATE_MANIFEST, []);
    expect(r.findings).toEqual([]);
    expect(r.notices.some((n) => n.includes('gate-witnesses'))).toBe(true);
    expect(r.notices.some((n) => n.includes('ready-to-merge'))).toBe(false);
  });
});

/** A fake `gh` that answers by the joined argument string. */
function fakeRunner(table: Record<string, CommandResult | (() => never)>) {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<CommandResult> => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    const hit = Object.entries(table).find(([k]) => key.endsWith(k));
    if (!hit) return { code: 1, stdout: '', stderr: `unexpected call: ${key}` };
    const v = hit[1];
    return typeof v === 'function' ? v() : v;
  };
  return { run, calls };
}

const okJson = (v: unknown): CommandResult => ({ code: 0, stdout: JSON.stringify(v), stderr: '' });
const guardingRuleset = (contexts: string[]) => ({
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
  rules: [{ type: 'required_status_checks', parameters: { required_status_checks: contexts.map((context) => ({ context })) } }],
});
const LIST = '/rulesets';

describe('FR-3 read', () => {
  const audit = async (table: Parameters<typeof fakeRunner>[0]) => {
    const { run, calls } = fakeRunner(table);
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAudit(['--repo', 'o/r'], {
      env: {},
      run,
      io: { out: (s) => out.push(s), err: (s) => err.push(s) },
    });
    return { code, out: out.join('\n'), err: err.join('\n'), calls };
  };

  it('the list call exits non-zero: exit 2 with gh stderr printed', async () => {
    const r = await audit({ [LIST]: { code: 1, stdout: '', stderr: 'HTTP 403: Resource not accessible' } });
    expect(r.code).toBe(2);
    expect(r.err).toContain('HTTP 403: Resource not accessible');
  });

  it('the list call cannot be spawned: exit 2', async () => {
    const r = await audit({
      [LIST]: () => {
        throw new Error('spawn gh ENOENT');
      },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain('ENOENT');
  });

  it('the list is not JSON: exit 2', async () => {
    expect((await audit({ [LIST]: { code: 0, stdout: '<html>', stderr: '' } })).code).toBe(2);
  });

  it('the list is JSON but not an array: exit 2', async () => {
    expect((await audit({ [LIST]: okJson({ message: 'nope' }) })).code).toBe(2);
  });

  it('one candidate detail GET fails: exit 2, not skipped', async () => {
    const r = await audit({
      [LIST]: okJson([
        { id: 1, target: 'branch', enforcement: 'active' },
        { id: 2, target: 'branch', enforcement: 'active' },
      ]),
      '/rulesets/1': okJson(guardingRuleset(['lint', 'gate-witnesses'])),
      '/rulesets/2': { code: 1, stdout: '', stderr: 'HTTP 502' },
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain('HTTP 502');
  });

  it('one detail is not JSON: exit 2', async () => {
    const r = await audit({
      [LIST]: okJson([{ id: 1, target: 'branch', enforcement: 'active' }]),
      '/rulesets/1': { code: 0, stdout: '{', stderr: '' },
    });
    expect(r.code).toBe(2);
  });

  it('no guarding ruleset: a finding distinct from a read failure', async () => {
    const r = await audit({
      [LIST]: okJson([{ id: 1, target: 'branch', enforcement: 'active' }]),
      '/rulesets/1': okJson({ ...guardingRuleset([]), rules: [{ type: 'deletion' }] }),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('no active branch ruleset requires status checks');
  });

  it('a guarding ruleset with zero contexts: a finding', async () => {
    const r = await audit({
      [LIST]: okJson([{ id: 1, target: 'branch', enforcement: 'active' }]),
      '/rulesets/1': okJson(guardingRuleset([])),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('requires zero status-check contexts');
  });

  it('two guarding rulesets: contexts are unioned', async () => {
    const { run } = fakeRunner({
      [LIST]: okJson([
        { id: 1, target: 'branch', enforcement: 'active' },
        { id: 2, target: 'branch', enforcement: 'evaluate' },
      ]),
      '/rulesets/1': okJson(guardingRuleset(['lint', 'test'])),
      '/rulesets/2': okJson(guardingRuleset(['test', 'build'])),
    });
    const r = await readRequiredContexts('o', 'r', run);
    expect(r).toEqual({ ok: true, contexts: ['lint', 'test', 'build'] });
  });

  it('a disabled ruleset, a tag ruleset and a non-numeric id are skipped (never fetched)', async () => {
    const { run, calls } = fakeRunner({
      [LIST]: okJson([
        { id: 1, target: 'branch', enforcement: 'active' },
        { id: 2, target: 'branch', enforcement: 'disabled' },
        { id: 3, target: 'tag', enforcement: 'active' },
        { id: '4', target: 'branch', enforcement: 'active' },
      ]),
      '/rulesets/1': okJson(guardingRuleset(['lint'])),
    });
    expect(await readRequiredContexts('o', 'r', run)).toEqual({ ok: true, contexts: ['lint'] });
    expect(calls.filter((c) => /rulesets\/\d/.test(c))).toEqual(['gh api repos/o/r/rulesets/1']);
  });

  it('paginated output (concatenated pages) is read in full', async () => {
    const page1 = JSON.stringify([{ id: 1, target: 'branch', enforcement: 'active' }]);
    const page2 = JSON.stringify([{ id: 2, target: 'branch', enforcement: 'active' }]);
    const { run } = fakeRunner({
      [LIST]: { code: 0, stdout: `${page1}\n${page2}`, stderr: '' },
      '/rulesets/1': okJson(guardingRuleset(['lint'])),
      '/rulesets/2': okJson(guardingRuleset(['build'])),
    });
    expect(await readRequiredContexts('o', 'r', run)).toEqual({ ok: true, contexts: ['lint', 'build'] });
  });

  it('a full passing run exits 0 and prints the required list and honoured fail-closed entries', async () => {
    const all = ['lint', 'test', 'MinSpec SDD validation', 'ai-review', 'ready-to-merge', 'build', 'gate-witnesses'];
    const r = await audit({
      [LIST]: okJson([{ id: 1, target: 'branch', enforcement: 'active' }]),
      '/rulesets/1': okJson(guardingRuleset(all)),
    });
    expect(r.code).toBe(0);
    for (const c of all) expect(r.out).toContain(c);
    expect(r.out).toMatch(/fail-closed entr(y|ies) honoured/);
    expect(r.out).toContain('MinSpec SDD validation');
  });

  it('a read that succeeds with gate-witnesses not required exits 1 and prints the observed list (AC-9/AC-10 first run)', async () => {
    const today = ['lint', 'test', 'MinSpec SDD validation', 'ai-review', 'ready-to-merge', 'build'];
    const r = await audit({
      [LIST]: okJson([{ id: 1, target: 'branch', enforcement: 'active' }]),
      '/rulesets/1': okJson(guardingRuleset(today)),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('gate-witnesses: not a required context');
    expect(r.err).toBe('');
  });

  it('the file imports both helpers from ruleset-advisor and has no ruleset rule-type literal of its own', () => {
    const text = readFileSync(join(REPO, 'scripts/audit-gate-witnesses.ts'), 'utf8');
    expect(text).toMatch(/import\s*\{[^}]*\brulesetGuardsDefaultBranchChecks\b[^}]*\}\s*from\s*'[^']*ruleset-advisor'/);
    expect(text).toMatch(/import\s*\{[^}]*\bextractRequiredContexts\b[^}]*\}\s*from\s*'[^']*ruleset-advisor'/);
    expect(text).not.toContain('required_status_checks');
  });
});

describe('FR-7 separation', () => {
  it('no lint, pretest or check:* script reaches audit-gate-witnesses', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const [name, body] of Object.entries(pkg.scripts)) {
      if (name === 'lint' || name === 'pretest' || name.startsWith('check:')) {
        expect(body, name).not.toContain('audit-gate-witnesses');
      }
    }
    expect(pkg.scripts['audit:gate-witnesses']).toBe('npx tsx scripts/audit-gate-witnesses.ts');
  });

  it('with neither --repo nor GITHUB_REPOSITORY the entry exits 2', async () => {
    const err: string[] = [];
    const { run, calls } = fakeRunner({});
    const code = await runAudit([], { env: {}, run, io: { out: () => {}, err: (s) => err.push(s) } });
    expect(code).toBe(2);
    expect(calls).toEqual([]);
    expect(err.join('\n')).toMatch(/GITHUB_REPOSITORY/);
  });

  it('GITHUB_REPOSITORY is used when --repo is absent; a malformed repo exits 2', async () => {
    const { run, calls } = fakeRunner({ [LIST]: { code: 1, stdout: '', stderr: 'x' } });
    await runAudit([], { env: { GITHUB_REPOSITORY: 'own/name' }, run, io: { out: () => {}, err: () => {} } });
    expect(calls[0]).toContain('repos/own/name/rulesets');
    const bad = await runAudit(['--repo', 'noslash'], { env: {}, run, io: { out: () => {}, err: () => {} } });
    expect(bad).toBe(2);
  });
});
