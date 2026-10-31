/**
 * T0 invariants for the #1206 gate: no issue template may grant a gate-output label.
 * Follows #1134 (the data fix that removed `agent-ready` from agent-task.yml).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GATE_OUTPUT_LABELS,
  checkTemplate,
  extractLabels,
} from '../../../scripts/lib/issue-template-labels';

const REPO = join(__dirname, '../../..');
const form = (labels: string) => `name: T\ndescription: d\n${labels}\nbody:\n  - type: markdown\n`;

describe('checkTemplate', () => {
  it('names agent-ready as a gate-output label', () => {
    expect(GATE_OUTPUT_LABELS).toContain('agent-ready');
  });
  it('rejects agent-ready in flow, block and scalar forms', () => {
    expect(checkTemplate('a.yml', form('labels: ["inbox", "agent-ready"]'))).toHaveLength(1);
    expect(checkTemplate('a.yml', form('labels:\n  - inbox\n  - "agent-ready"'))).toHaveLength(1);
    expect(checkTemplate('a.yml', form('labels: inbox, agent-ready'))).toHaveLength(1);
  });
  it('is case-insensitive and covers every listed label', () => {
    for (const l of GATE_OUTPUT_LABELS) {
      expect(checkTemplate('a.yml', form(`labels: ["${l.toUpperCase()}"]`))).toHaveLength(1);
    }
  });
  it('accepts clean and label-less templates', () => {
    expect(checkTemplate('a.yml', form('labels: ["bug", "inbox"]'))).toEqual([]);
    expect(checkTemplate('a.yml', form('# none'))).toEqual([]);
  });
  it('fails closed on unparseable input', () => {
    expect(checkTemplate('a.yml', 'garbage')).toHaveLength(1);
    expect(checkTemplate('a.yml', form('labels: ["a", "b"'))).toHaveLength(1);
    expect(checkTemplate('a.yml', form('labels: [a, {b: c}]'))).toHaveLength(1);
    expect(extractLabels('labels: [a]\nlabels: [b]').ok).toBe(false);
  });
  it('honours an injected list', () => {
    expect(checkTemplate('a.yml', form('labels: [x]'), ['x'])).toHaveLength(1);
  });
});

describe('real tree', () => {
  const run = (dir?: string) =>
    execFileSync('npx', ['tsx', 'scripts/check-issue-template-labels.ts', ...(dir ? ['--dir', dir] : [])], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  it('every committed template is clean', () => {
    expect(run()).toMatch(/grant no gate-output label/);
  }, 30_000);
  it('exits non-zero on a violating template', () => {
    const d = mkdtempSync(join(tmpdir(), 'tpl-'));
    writeFileSync(join(d, 'x.yml'), form('labels: ["agent-ready"]'));
    expect(() => run(d)).toThrow();
  }, 30_000);
  it('exits non-zero when the directory has no templates', () => {
    expect(() => run(mkdtempSync(join(tmpdir(), 'tpl-')))).toThrow();
  }, 30_000);
});
