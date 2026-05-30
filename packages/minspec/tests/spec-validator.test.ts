import { describe, it, expect } from 'vitest';
import { validateSpec } from '../src/lib/spec-validator';
import { parseSpec } from '../src/lib/spec';
import { DEFAULT_CONFIG } from '../src/lib/config';

function spec(fm: Record<string, string>, body: string): string {
  const phases = fm.phases ?? 'specify: done\n  clarify: pending\n  plan: done\n  tasks: done\n  implement: in-progress';
  const front = [
    '---',
    `id: ${fm.id ?? 'SPEC-001'}`,
    `title: ${fm.title ?? 'Test Spec'}`,
    `tier: ${fm.tier ?? 'T3'}`,
    `status: ${fm.status ?? 'implementing'}`,
    `created: 2026-05-30`,
    fm.aspects ? `aspects: ${fm.aspects}` : '',
    'phases:',
    '  ' + phases,
    '---',
    '',
  ].filter((l) => l !== '').join('\n');
  return front + '\n' + body;
}

const FULL_T3 = `## Specify
Build the thing.
- [ ] criterion one
- [ ] criterion two

## Plan
Do it in steps.

## Tasks
- [ ] task a

## Implement
code goes here.
`;

describe('validateSpec — required sections', () => {
  it('T3 complete spec with criteria passes', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T3' }, FULL_T3)), DEFAULT_CONFIG);
    expect(r.complete).toBe(true);
    expect(r.violations.filter((v) => v.severity === 'error')).toHaveLength(0);
  });

  it('T3 missing plan section is an error → incomplete', () => {
    const body = `## Specify\nthing\n- [ ] c1\n\n## Tasks\n- [ ] t\n\n## Implement\nx\n`;
    const r = validateSpec(parseSpec(spec({ tier: 'T3' }, body)), DEFAULT_CONFIG);
    expect(r.complete).toBe(false);
    expect(r.violations.some((v) => v.rule === 'section.plan.empty' && v.severity === 'error')).toBe(true);
  });

  it('T1 missing optional sections does not error', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T1' }, `## Specify\none liner\n`)), DEFAULT_CONFIG);
    expect(r.complete).toBe(true);
  });
});

describe('validateSpec — acceptance criteria', () => {
  it('T3 without acceptance criteria errors', () => {
    const body = `## Specify\nprose only no checkboxes\n\n## Plan\np\n\n## Tasks\n- [ ] t\n\n## Implement\ni\n`;
    const r = validateSpec(parseSpec(spec({ tier: 'T3' }, body)), DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule === 'acceptance.missing')).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('explicit Acceptance Criteria section satisfies', () => {
    const body = FULL_T3.replace('- [ ] criterion one\n- [ ] criterion two', 'prose') +
      '\n## Acceptance Criteria\n- must work\n';
    const r = validateSpec(parseSpec(spec({ tier: 'T3' }, body)), DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule === 'acceptance.missing')).toBe(false);
  });
});

describe('validateSpec — aspect: ux', () => {
  const uxBody = FULL_T3.replace('Build the thing.', 'Build the new settings screen with a toggle button.');

  it('declared ux aspect without mockup errors at T3', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T3', aspects: 'ux' }, uxBody)), DEFAULT_CONFIG);
    expect(r.effectiveAspects).toContain('ux');
    expect(r.violations.some((v) => v.rule === 'aspect.ux.no-mockup' && v.severity === 'error')).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('detected-only ux aspect softens to warning (still complete)', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T3' }, uxBody)), DEFAULT_CONFIG);
    expect(r.detectedAspects).toContain('ux');
    const v = r.violations.find((x) => x.rule === 'aspect.ux.no-mockup');
    expect(v?.severity).toBe('warning');
    expect(r.complete).toBe(true);
  });

  it('ux aspect WITH an image mockup passes', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T3', aspects: 'ux' },
      uxBody + '\n## UX\n![wireframe](./mock.png)\n')), DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule === 'aspect.ux.no-mockup')).toBe(false);
  });

  it('ux aspect WITH a mermaid diagram passes', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T3', aspects: 'ux' },
      uxBody + '\n## UX\n```mermaid\nflowchart TD\n A-->B\n```\n')), DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule === 'aspect.ux.no-mockup')).toBe(false);
  });
});

describe('validateSpec — aspect: api', () => {
  const apiBody = FULL_T3.replace('Build the thing.', 'Add a POST /users endpoint returning a response payload.');

  it('declared api aspect without schema errors at T4', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T4', aspects: 'api' }, apiBody)), DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule === 'aspect.api.no-schema' && v.severity === 'error')).toBe(true);
  });

  it('api aspect WITH a json fence passes', () => {
    const r = validateSpec(parseSpec(spec({ tier: 'T4', aspects: 'api' },
      apiBody + '\n## API\n```json\n{ "id": 1 }\n```\n')), DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule === 'aspect.api.no-schema')).toBe(false);
  });
});

describe('validateSpec — aspect: architecture', () => {
  it('declared architecture aspect without diagram errors at T4', () => {
    const body = FULL_T3.replace('Build the thing.', 'Introduce a new broker service and message queue subsystem.');
    const r = validateSpec(parseSpec(spec({ tier: 'T4', aspects: 'architecture' }, body)), DEFAULT_CONFIG);
    expect(r.violations.some((v) => v.rule === 'aspect.architecture.no-diagram' && v.severity === 'error')).toBe(true);
  });
});
