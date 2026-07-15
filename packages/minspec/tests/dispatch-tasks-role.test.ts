/**
 * T2 — feature: `tasks` doc-phase generation role exists and is model-routed
 * through `dispatch-issue.sh` (DR-057 "Doc-phase generation role", #732).
 *
 * Root cause: n/a — pure feature. Before this change `scripts/roles/` had no
 * generation role for plan→tasks, and `dispatch-issue.sh`'s per-role MODEL
 * `case` had no branch for one, so a future `--role tasks` dispatch would fall
 * through to the `*) MODEL="sonnet"` default with no role prompt loaded — a
 * "Warning: no role file" degrade (see the `ROLE_FILE` load branch at
 * `dispatch-issue.sh` ~:108-115).
 *
 * These are wiring/content assertions against the static files, matching the
 * sibling `dispatch-*.test.ts` style (read the script text, strip comments,
 * assert the pattern exists) — there is no `claude -p` invocation in CI.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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

const scriptsDir = findScriptsDir();
const dispatchContent = fs.readFileSync(path.join(scriptsDir, 'dispatch-issue.sh'), 'utf-8');
const dispatchCode = dispatchContent
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');

describe('scripts/roles/tasks.md — doc-phase generation role (#732)', () => {
  const rolePath = path.join(scriptsDir, 'roles', 'tasks.md');

  it('exists', () => {
    expect(fs.existsSync(rolePath)).toBe(true);
  });

  const roleContent = fs.existsSync(rolePath) ? fs.readFileSync(rolePath, 'utf-8') : '';

  it('declares tasks.md as the only file it may write', () => {
    expect(roleContent).toMatch(/## File allowlist/);
    expect(roleContent).toMatch(/specs\/<target-spec-dir>\/tasks\.md/);
  });

  it('forbids editing requirements.md or design.md, and writing packages/ code', () => {
    expect(roleContent).toMatch(/MUST NOT edit `requirements\.md` or `design\.md`/);
    expect(roleContent).toMatch(/MUST NOT write anything under `packages\/`/);
  });

  it('requires generated status: specifying, never mirroring requirements.md status (DR-057 §5)', () => {
    expect(roleContent).toMatch(/status:\s*specifying/);
  });

  it('carries the standard DR-355 escalation clause', () => {
    expect(roleContent).toMatch(/^ESCALATE: <one-line reason>$/m);
  });
});

describe('dispatch-issue.sh — model routing includes the tasks role (#732)', () => {
  it('routes ROLE=tasks to a named model in the per-role MODEL case', () => {
    const caseBlockMatch = dispatchCode.match(/case "\$ROLE" in[\s\S]*?\nesac/);
    expect(caseBlockMatch, 'MODEL case statement not found in dispatch-issue.sh').toBeTruthy();
    const caseBlock = caseBlockMatch![0];
    expect(caseBlock).toMatch(/\btasks\)\s+MODEL="\w+"/);
  });

  it('still loads a role prompt generically by role name (no tasks-specific special-case needed)', () => {
    expect(dispatchCode).toMatch(/ROLE_FILE="\$\{ROLES_DIR\}\/\$\{ROLE\}\.md"/);
  });
});
