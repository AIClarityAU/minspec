/**
 * #1380 — `transitionPhase` (the phase-map writer a queue consumer will call, DR-057 §2)
 * is gated at the lib boundary like `approveSpec`/`advanceSpecToImplementing`, and never
 * stamps the approval-blind preview status into frontmatter.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { transitionPhase } from '../src/lib/spec-manager';

let tmp: string;
const FM = (clarify: string, plan: string) =>
  `---\nid: SPEC-901\ntype: requirements\ntier: T4\nstatus: specifying\nproduct: minspec\n` +
  `phases:\n  specify: done\n  clarify: ${clarify}\n  plan: ${plan}\n  tasks: pending\n  implement: pending\n---\n# Thing\n\nBody.\n`;

function setup(config: object, clarify = 'in-progress', plan = 'pending'): string {
  fs.mkdirSync(path.join(tmp, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.minspec', 'config.json'), JSON.stringify({ version: '1', ...config }));
  const p = path.join(tmp, 'specs', 'SPEC-901-thing.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, FM(clarify, plan));
  return p;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-transition-gate-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('#1380 transitionPhase lib-boundary gate', () => {
  it('refuses clarify→done / plan→in-progress on an undeclared spec under ownershipDeclaration:error, writing nothing', () => {
    const p = setup({ ownershipDeclaration: 'error' });
    const before = fs.readFileSync(p, 'utf-8');
    expect(() => transitionPhase(tmp, 'SPEC-901', 'advance')).toThrow(/implements|ownership/i);
    expect(fs.readFileSync(p, 'utf-8')).toBe(before);
  });

  it('does not refuse on the default (warn) config', () => {
    setup({});
    expect(transitionPhase(tmp, 'SPEC-901', 'advance').success).toBe(true);
  });

  it('writes the approval-aware status (not `implementing`) for an UNAPPROVED spec in the plan band', () => {
    const p = setup({}, 'done', 'in-progress');
    expect(transitionPhase(tmp, 'SPEC-901', 'advance').success).toBe(true);
    const text = fs.readFileSync(p, 'utf-8');
    expect(text).toMatch(/^status: specifying$/m);
    expect(text).not.toMatch(/^status: implementing$/m);
  });
});
