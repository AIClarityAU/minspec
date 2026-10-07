/**
 * T1 regression (#1890) — the "Pre-Commit Checks" table in `CLAUDE_MD_TEMPLATE`
 * lists one row per gate the `pre-commit` / `commit-msg` managed regions
 * actually implement.
 *
 * WHY THIS EXISTS. The `docs/decisions/DR-*.md` frontmatter case inside
 * `minspec_shell_gate` (added alongside the `specs/*.md` case it mirrors, and
 * matched by `validate.py`'s `DR_ID_RE` tier) had no row in the prose table.
 * The table and the hooks are two producers of the same fact — "what does
 * pre-commit refuse" — with nothing reconciling them, so the omission was
 * invisible to every test that read only one side. #1884 was the same shape.
 *
 * WHAT THIS PINS: a fixed list of gate anchors, each naming a stable string in
 * the RENDERED hook source and the keyword its table row must carry. Removing
 * a gate's anchor from the hook without dropping its table row, or adding a
 * table row for a gate the hooks don't implement, breaks this test.
 */
import { describe, it, expect } from 'vitest';
import { MANAGED_REGION_TEMPLATES, renderManagedFile, TEMPLATES } from '../src/lib/template-registry';
import { parseSections } from '../src/lib/merge-refresh';

const byPath = (p: string) => MANAGED_REGION_TEMPLATES.find((t) => t.outputPath === p)!;
const PRE_COMMIT = renderManagedFile(byPath('.minspec/hooks/pre-commit'));
const COMMIT_MSG = renderManagedFile(byPath('.minspec/hooks/commit-msg'));

interface GateSpec {
  name: string;
  hook: string;
  source: string;
  /** A stable string that must exist in the rendered hook — proves the gate is still implemented. */
  sourceAnchor: RegExp;
  /** A keyword the table's row for this gate must carry. */
  tableKeyword: RegExp;
}

const GATES: GateSpec[] = [
  {
    name: 'Protected-branch guard',
    hook: 'pre-commit',
    source: PRE_COMMIT,
    sourceAnchor: /Stage 0: protected-branch guard/,
    tableKeyword: /authored commit on the default branch/i,
  },
  {
    name: 'Author identity gate',
    hook: 'pre-commit',
    source: PRE_COMMIT,
    sourceAnchor: /Stage 1: author identity gate/,
    tableKeyword: /commit author email/i,
  },
  {
    name: 'Secret scan',
    hook: 'pre-commit',
    source: PRE_COMMIT,
    sourceAnchor: /Stage 2: secret scan/,
    tableKeyword: /detected secret/i,
  },
  {
    name: 'Spec frontmatter',
    hook: 'pre-commit',
    source: PRE_COMMIT,
    sourceAnchor: /id: SPEC-NNN/,
    tableKeyword: /id: SPEC-NNN/,
  },
  {
    name: 'Decision frontmatter',
    hook: 'pre-commit',
    source: PRE_COMMIT,
    sourceAnchor: /id: DR-NNN/,
    tableKeyword: /id: DR-NNN/,
  },
  {
    name: 'Deferred-work gate',
    hook: 'commit-msg',
    source: COMMIT_MSG,
    sourceAnchor: /Follow-up materialization gate \(DR-023 \/ DR-059\)/,
    tableKeyword: /defers work/i,
  },
  {
    name: 'Root-cause gate',
    hook: 'commit-msg',
    source: COMMIT_MSG,
    sourceAnchor: /marker \(case-insensitive, space or hyphen\) in the body/,
    tableKeyword: /Root cause:/,
  },
];

/** The Gate/Hook/Refuses table inside the "Pre-Commit Checks" section, header row included. */
function gateTable(): string {
  const section = parseSections(TEMPLATES['CLAUDE.md']).find((s) => s.heading === 'Pre-Commit Checks');
  expect(section, 'CLAUDE.md template must still carry a Pre-Commit Checks section').toBeTruthy();
  const match = section!.body.match(/\| Gate \| Hook \| Refuses \|\n\|---\|---\|---\|\n((?:\|.*\|\n?)+)/);
  expect(match, 'Pre-Commit Checks section must carry the Gate/Hook/Refuses table').toBeTruthy();
  return match![0];
}

describe('CLAUDE.md gate table matches what pre-commit/commit-msg actually implement', () => {
  it.each(GATES)('$name ($hook) is still implemented, and the table still has a matching row', (gate) => {
    expect(
      gate.source,
      `${gate.name}: expected anchor not found in the rendered ${gate.hook} hook — this gate spec is stale, update it`,
    ).toMatch(gate.sourceAnchor);
    expect(
      gateTable(),
      `${gate.name}: no table row matches ${gate.tableKeyword} — the gate is implemented but the prose table doesn't say so`,
    ).toMatch(gate.tableKeyword);
  });

  it('has exactly one data row per known gate — no gate is un-tabled, no row is undocumented', () => {
    const table = gateTable();
    const rows = table
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('|') && !line.startsWith('|---'));
    // +1 for the header row ("| Gate | Hook | Refuses |").
    expect(rows.length, `table rows:\n${rows.join('\n')}`).toBe(GATES.length + 1);
  });
});
