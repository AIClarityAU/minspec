/**
 * #1645 — one defect fixture per corpus rule in scripts/validate-frontmatter.ts.
 *
 * A rule that silently stops matching looks exactly like a clean corpus. This suite
 * builds a GOLDEN corpus that lints to zero findings, then for each rule copies it,
 * applies ONE targeted mutation, and asserts both halves:
 *
 *   - clean-on-golden (catches an inert guard: a fixture that never reaches the rule), and
 *   - fires-on-mutant (catches a dead rule), with that rule's finding the ONLY finding
 *     (modulo a stated, per-mutant `alsoTrips` list for genuine rule overlap).
 *
 * Mutants are generated from the golden tree at test time — nothing but this file is
 * committed — so there is no fixture drift to maintain.
 *
 * THE LANDING TRAP. A non-global replace can hit the wrong duplicate line, or none at
 * all, and the "survivor" is then a no-op edit that proves nothing. Every textual
 * mutation goes through `replaceOnce`, which THROWS unless the needle occurs exactly
 * once, so a mutation that did not land where meant fails the suite loudly.
 *
 * DATE OVERRIDE. The issue asks for a `MINSPEC_TODAY`-style override for any
 * date-dependent rule. No rule in the script reads the clock (grep `Date` in
 * validate-frontmatter.ts: none), so none is added; the golden dates are fixed literals.
 *
 * LEDGER. Every `Rule N` the script names must be either mutated here or listed in
 * `EXEMPT` with a reason, so a newly added rule cannot ship without a decision.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runTsxCli, REPO_ROOT } from './helpers/run-tsx-cli';

const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'validate-frontmatter.ts');

type Files = Record<string, string>;

// ---- Golden corpus ---------------------------------------------------------

const DR_BODY = (title: string): string =>
  `## Context\n\nWhy ${title}.\n\n## Decision\n\nDo it.\n\n## In plain terms\n\nPlain.\n`;

function drFile(id: string, title: string, status = 'accepted'): string {
  return `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\ndate: 2026-01-01\n---\n\n${DR_BODY(title)}`;
}

function indexEntry(id: string, title: string, status: string): string {
  return `## [${id} — ${title}](${id}.md)\n\n*Status: ${status} · Date: 2026-01-01*\n`;
}

const GOLDEN: Files = {
  'docs/domain/term.md': '---\ntype: domain\n---\n\n# Term\n\nA definition.\n',
  'docs/epics/EPIC-001-core.md': '---\nid: EPIC-001\nslug: core\ntitle: Core\n---\n\n# Core\n',
  'docs/decisions/DR-001.md': drFile('DR-001', 'First', 'accepted'),
  'docs/decisions/DR-002.md': drFile('DR-002', 'Second', 'proposed'),
  'docs/decisions/INDEX.md':
    '<!-- minspec:dr-index:start -->\n# Decision Register\n\n' +
    indexEntry('DR-001', 'First', 'accepted') +
    '\n' +
    indexEntry('DR-002', 'Second', 'proposed') +
    '<!-- minspec:dr-index:end -->\n',
  'specs/demo/SPEC-001-alpha/requirements.md':
    '---\nid: SPEC-001\ntype: requirements\nstatus: new\ntier: T1\nepic: EPIC-001\n---\n\n' +
    '# Alpha\n\n**Status:** New\n\nBody.\n',
  'specs/demo/SPEC-002-beta/requirements.md':
    '---\nid: SPEC-002\ntype: requirements\nstatus: new\ntier: T1\nepic: EPIC-001\n---\n\n' +
    '# Beta\n\n**Status:** New\n\nBody.\n',
  'packages/demo/src/limit.ts': '// This is a known limit of the demo (#12).\nexport const x = 1;\n',
  // Rule 25 only runs when this file exists, so the golden control must carry it.
  '.minspec/delegations.json': JSON.stringify({
    delegations: [{ id: 'DLG-001', covers: ['spec-approval', 'engineering-dr-acceptance'] }],
  }),
};

function writeTree(dir: string, files: Files): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
}

/** Replace `from` with `to` in `files[rel]`, throwing unless `from` occurs EXACTLY once. */
function replaceOnce(files: Files, rel: string, from: string, to: string): void {
  const src = files[rel];
  if (src === undefined) throw new Error(`mutation target missing from golden corpus: ${rel}`);
  const count = src.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`mutation did not land: ${JSON.stringify(from)} occurs ${count}x in ${rel} (need exactly 1)`);
  }
  files[rel] = src.replace(from, to);
}

// ---- Running ---------------------------------------------------------------

interface Findings {
  status: number | null;
  fails: string[];
  warns: string[];
  output: string;
}

function lint(files: Files): Findings {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-rule-mutants-'));
  try {
    writeTree(dir, files);
    const { status, output } = runTsxCli(SCRIPT_PATH, [], { cwd: dir });
    const lines = output.split('\n');
    return {
      status,
      output,
      fails: lines.filter((l) => l.startsWith('FAIL ')),
      warns: lines.filter((l) => l.startsWith('WARN ')),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- Mutants ---------------------------------------------------------------

interface Mutant {
  /** Rule numbers this mutant proves alive. */
  rules: string[];
  name: string;
  severity: 'FAIL' | 'WARN';
  /** Must match at least one finding line of `severity`. */
  expect: RegExp;
  /** Findings of other rules that this mutation legitimately also trips. */
  alsoTrips?: RegExp[];
  mutate: (f: Files) => void;
}

const SPEC1 = 'specs/demo/SPEC-001-alpha/requirements.md';
const SPEC2 = 'specs/demo/SPEC-002-beta/requirements.md';

const MUTANTS: Mutant[] = [
  {
    rules: ['1'],
    name: 'domain doc without `type: domain`',
    severity: 'FAIL',
    expect: /missing `type: domain`/,
    mutate: (f) => replaceOnce(f, 'docs/domain/term.md', 'type: domain', 'type: note'),
  },
  {
    rules: ['3'],
    name: 'domain doc carrying a task checklist',
    severity: 'FAIL',
    expect: /task checklists/,
    mutate: (f) => replaceOnce(f, 'docs/domain/term.md', 'A definition.', '- [ ] a task'),
  },
  {
    rules: ['4'],
    name: 'domain doc carrying acceptance criteria',
    severity: 'FAIL',
    expect: /acceptance criteria not allowed/,
    mutate: (f) => replaceOnce(f, 'docs/domain/term.md', 'A definition.', 'Acceptance criteria: none.'),
  },
  {
    rules: ['2'],
    name: 'spec with an invalid id',
    severity: 'FAIL',
    expect: /missing or invalid `id: SPEC-NNN`/,
    // Rule 18 also reads the same declared id.
    alsoTrips: [/Spec id /],
    mutate: (f) => replaceOnce(f, SPEC1, 'id: SPEC-001', 'id: not-an-id'),
  },
  {
    rules: ['5'],
    name: 'spec epic that resolves to no registered epic',
    severity: 'FAIL',
    expect: /does not match any registered epic/,
    mutate: (f) => replaceOnce(f, SPEC1, 'epic: EPIC-001', 'epic: EPIC-999'),
  },
  {
    rules: ['8'],
    name: 'DR INDEX status drifts from the DR frontmatter',
    severity: 'FAIL',
    expect: /DR-index status drift/,
    mutate: (f) =>
      replaceOnce(f, 'docs/decisions/INDEX.md', '*Status: proposed · Date', '*Status: accepted · Date'),
  },
  {
    rules: ['11'],
    name: 'spec body status line disagrees with frontmatter',
    severity: 'FAIL',
    expect: /status parity/,
    mutate: (f) => replaceOnce(f, SPEC1, '**Status:** New', '**Status:** Done'),
  },
  {
    rules: ['11'],
    name: 'second status claim in a DR disagrees with frontmatter',
    severity: 'FAIL',
    expect: /status parity/,
    mutate: (f) =>
      replaceOnce(f, 'docs/decisions/DR-001.md', '## Decision', '## Status\n\nproposed\n\n## Decision'),
  },
  {
    rules: ['13'],
    name: 'T3 spec with no acceptance criteria',
    severity: 'FAIL',
    expect: /acceptance criteria/i,
    // A T3 directory holding only requirements.md also trips Rule 7 (split coverage).
    alsoTrips: [/split-coverage/],
    mutate: (f) => replaceOnce(f, SPEC1, 'tier: T1', 'tier: T3'),
  },
  {
    rules: ['16'],
    name: 'accepted DR amends a DR that never mentions it',
    severity: 'FAIL',
    expect: /DR amendment not carried out/,
    mutate: (f) => {
      replaceOnce(f, 'docs/decisions/DR-002.md', 'status: proposed', 'status: accepted');
      replaceOnce(f, 'docs/decisions/DR-002.md', 'Do it.', 'This amends DR-001.');
      replaceOnce(f, 'docs/decisions/INDEX.md', '*Status: proposed · Date', '*Status: accepted · Date');
    },
  },
  {
    rules: ['16'],
    name: 'proposed DR amends a DR that never mentions it (advisory twin)',
    severity: 'WARN',
    expect: /DR amendment pending/,
    mutate: (f) => replaceOnce(f, 'docs/decisions/DR-002.md', 'Do it.', 'This amends DR-001.'),
  },
  {
    rules: ['17'],
    name: 'two DR files declaring one id',
    severity: 'FAIL',
    expect: /DR id /,
    // The renamed id also drifts from its own filename, and Rule 6 warns on the duplicate.
    alsoTrips: [/DR id /, /DR-sequence/],
    mutate: (f) => replaceOnce(f, 'docs/decisions/DR-002.md', 'id: DR-002', 'id: DR-001'),
  },
  {
    rules: ['6'],
    name: 'DR file whose number is under-padded',
    severity: 'WARN',
    expect: /DR-sequence: .*not zero-padded/,
    // The unpadded name no longer matches its declared id (Rule 17), and the INDEX loses it (Rule 8).
    alsoTrips: [/DR id /, /DR-index status drift/, /doubled-frontmatter/],
    mutate: (f) => {
      f['docs/decisions/DR-3.md'] = drFile('DR-3', 'Third');
    },
  },
  {
    rules: ['18'],
    name: 'two spec directories declaring one id',
    severity: 'FAIL',
    expect: /Spec id /,
    alsoTrips: [/Spec id /],
    mutate: (f) => replaceOnce(f, SPEC2, 'id: SPEC-002', 'id: SPEC-001'),
  },
  {
    rules: ['19'],
    name: 'forbidden integrity claim in a spec',
    severity: 'FAIL',
    expect: /forbidden integrity claim/,
    mutate: (f) => replaceOnce(f, SPEC1, 'Body.', 'The log is tamper-proof.'),
  },
  {
    rules: ['9'],
    name: 'spec citing a DR that does not exist',
    severity: 'WARN',
    expect: /ref-check .*DR-999/,
    mutate: (f) => replaceOnce(f, SPEC1, 'Body.', 'See DR-999 for why.'),
  },
  {
    rules: ['20'],
    name: 'DR without `## In plain terms`',
    severity: 'WARN',
    expect: /lacks a `## In plain terms` section/,
    mutate: (f) => replaceOnce(f, 'docs/decisions/DR-001.md', '## In plain terms\n\nPlain.\n', ''),
  },
  {
    rules: ['20'],
    name: 'DR carrying two frontmatter-shaped blocks',
    severity: 'WARN',
    expect: /doubled-frontmatter/,
    mutate: (f) => {
      f['docs/decisions/DR-001.md'] =
        '---\nid: DR-001\nstatus: accepted\n---\n' + f['docs/decisions/DR-001.md'];
    },
  },
  {
    rules: ['11'],
    name: 'unreadable spec status line (Rule 11b)',
    severity: 'WARN',
    expect: /status parity \(#968\)/,
    mutate: (f) => replaceOnce(f, SPEC1, '**Status:** New', '**Status:** 🙂 vibes'),
  },
  {
    rules: ['23'],
    name: 'status frontmatter carrying an inline comment',
    severity: 'WARN',
    expect: /status-annotation .*inline `#` comment/,
    mutate: (f) => replaceOnce(f, SPEC1, 'status: new\n', 'status: new  # waiting on review\n'),
  },
  {
    rules: ['24'],
    name: 'known limit admitted with no tracked issue',
    severity: 'FAIL',
    expect: /admits a known limit with no tracked issue/,
    mutate: (f) => replaceOnce(f, 'packages/demo/src/limit.ts', ' (#12)', ''),
  },
  {
    rules: ['25'],
    name: 'spec cites a delegation for an act its covers list omits',
    severity: 'FAIL',
    expect: /cites DLG-001 for "recorded", an act its covers list omits/,
    mutate: (f) =>
      replaceOnce(f, SPEC1, '\nBody.\n', '\nAn agent session recorded each option, under delegation DLG-001.\n'),
  },
];

// ---- Rules deliberately not mutated here ----------------------------------

const EXEMPT: Record<string, string> = {
  '7': 'covered as the declared side effect of the Rule 13 mutant (T3 dir with only requirements.md)',
  '10': 'needs a hash-bearing approval sidecar whose keyed path no longer classifies; covered by approval-store tests',
  '12': 'compares generated templates to this repo’s own CI stack; a scratch tree has no stack, so the rule is not applicable there by design (#871)',
  '14': 'needs a detected tool’s managed-region harness file; covered by managed-region-marker-gate.test.ts',
  '15': 'ships as warn behind a config ratchet and fires only on T3/T4 specs past Clarify; covered by ownership tests',
  '21': 'needs the rendered CLAUDE.md template to be doubled; covered by doubled-sections tests',
  '22': 'ships as warn behind a config ratchet; covered by implement-evidence tests',
};

// ---- Suites ----------------------------------------------------------------

describe('#1645 corpus rule mutants', () => {
  it('golden corpus lints to ZERO findings (an inert guard cannot hide behind a dirty control)', () => {
    const r = lint(GOLDEN);
    expect(r.fails).toEqual([]);
    expect(r.warns).toEqual([]);
    expect(r.status).toBe(0);
    expect(r.output).toContain('Frontmatter validation passed.');
  }, 60000);

  it.each(MUTANTS.map((m) => [`Rule ${m.rules.join('+')}: ${m.name}`, m] as const))(
    '%s fires, and only that rule',
    (_label, m) => {
      const files: Files = { ...GOLDEN };
      m.mutate(files);
      expect(files, 'mutation must change the corpus').not.toEqual(GOLDEN);

      const r = lint(files);
      const found = m.severity === 'FAIL' ? r.fails : r.warns;
      expect(found.some((l) => m.expect.test(l)), `expected ${m.expect} in:\n${r.output}`).toBe(true);
      if (m.severity === 'FAIL') expect(r.status).toBe(1);

      const allowed = [m.expect, ...(m.alsoTrips ?? [])];
      const stray = [...r.fails, ...r.warns].filter((l) => !allowed.some((re) => re.test(l)));
      expect(stray, `unexpected extra findings:\n${stray.join('\n')}`).toEqual([]);
    },
    60000,
  );

  it('replaceOnce refuses a mutation that did not land exactly once', () => {
    expect(() => replaceOnce({ a: 'x x' }, 'a', 'x', 'y')).toThrow(/occurs 2x/);
    expect(() => replaceOnce({ a: 'x' }, 'a', 'zzz', 'y')).toThrow(/occurs 0x/);
  });

  it('every rule the script names is mutated or explicitly exempt', () => {
    const script = fs.readFileSync(SCRIPT_PATH, 'utf-8');
    const named = new Set([...script.matchAll(/^\/\/ Rule (\d+)/gm)].map((m) => m[1]));
    // "Rule 1 + 3 + 4" and "Rule 2 + 5" are defined in one combined comment.
    for (const n of ['1', '3', '4', '2', '5']) named.add(n);
    const covered = new Set(MUTANTS.flatMap((m) => m.rules));
    const unaccounted = [...named].filter((n) => !covered.has(n) && !(n in EXEMPT));
    expect(unaccounted, 'add a mutant or an EXEMPT entry with a reason').toEqual([]);
    for (const n of Object.keys(EXEMPT)) {
      expect(covered.has(n), `Rule ${n} is both mutated and exempt`).toBe(false);
      expect(named.has(n), `EXEMPT names Rule ${n}, which the script no longer defines`).toBe(true);
    }
  });
});
