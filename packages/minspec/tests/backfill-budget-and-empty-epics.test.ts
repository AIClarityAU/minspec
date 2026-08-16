/**
 * T3 regression — two defects found when the vsix ran an epic assignment on this
 * repo and reported "AI pass unavailable — using the heuristic proposal".
 *
 * #1570 — the AI pass was cut off, not unavailable. `proposeAI` gave `claude -p`
 * a flat 120 s while the prompt it builds scales with the corpus. MEASURED on
 * this repo: 179 artifacts / 76,937-char prompt returned valid JSON in 313 s
 * (exit 0). The budget must scale with the size of the ask, and a failure must
 * name which mode fired instead of collapsing every mode into `null`.
 *
 * #1571 — the heuristic proposed 97 mappings whose artifacts already carried
 * `epic:` (every one a no-op at apply) and 54 new epics seeded from folders
 * named after the single spec inside them. Apply created all 54 epics and tagged
 * nothing. The review surface had promised "tag 97 artifact(s)".
 *
 * child_process.execFile is mocked — nothing shells a real binary.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'child_process';
import {
  proposeAI,
  proposeHeuristic,
  applyBackfill,
  withoutAlreadyTagged,
  aiTimeoutMs,
  AI_TIMEOUT_FLOOR_MS,
  collectArtifacts,
  type BackfillProposal,
} from '../src/lib/epic-backfill';
import { listEpics, readArtifactEpic, createEpic } from '../src/lib/epic-manager';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

function invoke(opts: unknown, cb: unknown, err: Error | null, stdout: string): void {
  const callback = (typeof opts === 'function' ? opts : cb) as (e: Error | null, r?: unknown) => void;
  if (err) callback(err);
  else callback(null, { stdout, stderr: '' });
}
const isVersion = (args: unknown): boolean => Array.isArray(args) && args.includes('--version');
const isDispatch = (args: unknown): boolean => Array.isArray(args) && args.includes('-p');

function writeConfig(root: string): void {
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify({ version: '1' }));
}

/** Write a spec at specs/<relDir>/<file>.md. `epic` stamps an existing tag. */
function writeSpec(
  root: string,
  relDir: string,
  id: string,
  title: string,
  opts: { epic?: string; file?: string } = {},
): string {
  const dir = path.join(root, 'specs', relDir);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${opts.file ?? id}.md`);
  fs.writeFileSync(fp, [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'tier: T2',
    'status: new',
    'created: 2026-08-16',
    ...(opts.epic ? [`epic: ${opts.epic}`] : []),
    'phases:',
    '  specify: done',
    '---',
    '',
    `# ${title}`,
    '',
    'Some prose about the feature.',
    '',
  ].join('\n'));
  return fp;
}

describe('backfill — AI budget + empty-epic gate', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-backfill-reg-'));
    writeConfig(tmp);
    mockExecFile.mockReset();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // ─── #1570 — the budget must scale with the ask ──────────────────────

  describe('#1570 — AI budget scales, failures name themselves', () => {
    it('T3: the execFile timeout grows with the number of artifacts asked about', async () => {
      // 40 untagged specs — the old code passed a flat 120_000 no matter what.
      for (let i = 1; i <= 40; i++) {
        writeSpec(tmp, `group-${i}`, `SPEC-${String(i).padStart(3, '0')}`, `Feature ${i}`);
      }
      mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
        if (isVersion(args)) return invoke(opts, cb, null, 'claude 2.1.0\n');
        return invoke(opts, cb, null, '{"epics":[],"mappings":[]}');
      });

      await proposeAI(tmp);

      const dispatch = mockExecFile.mock.calls.find((c: unknown[]) => isDispatch(c[1]));
      expect(dispatch).toBeDefined();
      const passed = (dispatch![2] as { timeout: number }).timeout;
      // The distinguishing assertion: the old flat ceiling is exceeded.
      expect(passed).toBeGreaterThan(AI_TIMEOUT_FLOOR_MS);
      expect(passed).toBe(aiTimeoutMs(40));
    });

    it('T3: a small corpus still gets at least the floor', () => {
      expect(aiTimeoutMs(0)).toBeGreaterThanOrEqual(AI_TIMEOUT_FLOOR_MS);
      expect(aiTimeoutMs(1)).toBeGreaterThanOrEqual(AI_TIMEOUT_FLOOR_MS);
    });

    it('T3: the budget is bounded — it cannot grow without limit', () => {
      expect(aiTimeoutMs(100_000)).toBeLessThanOrEqual(aiTimeoutMs(1_000_000));
      expect(Number.isFinite(aiTimeoutMs(1_000_000))).toBe(true);
      expect(aiTimeoutMs(1_000_000)).toBeLessThanOrEqual(30 * 60_000);
    });

    it('T3: the real 179-artifact / 313 s case fits inside the budget', () => {
      // The measured failure: 313 s of work against a 120 s ceiling.
      expect(aiTimeoutMs(179)).toBeGreaterThan(313_000);
    });

    it('T3: a killed child reports reason "timeout", not a bare null', async () => {
      writeSpec(tmp, 'alpha', 'SPEC-001', 'Alpha');
      const killed = Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' });
      mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
        if (isVersion(args)) return invoke(opts, cb, null, 'claude 2.1.0\n');
        return invoke(opts, cb, killed, '');
      });

      const res = await proposeAI(tmp);

      expect(res.proposal).toBeNull();
      // The distinguishing assertion: the caller can tell WHY, so the toast can
      // stop saying "unavailable" about a binary that answered fine.
      expect(res.failure?.reason).toBe('timeout');
      expect(res.failure?.detail).toMatch(/timed out|timeout/i);
    });

    it('T3: an absent binary reports "claude-absent" — distinct from a timeout', async () => {
      writeSpec(tmp, 'alpha', 'SPEC-001', 'Alpha');
      mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
        if (isVersion(args)) return invoke(opts, cb, new Error('command not found'), '');
        return invoke(opts, cb, null, '{}');
      });

      const res = await proposeAI(tmp);

      expect(res.proposal).toBeNull();
      expect(res.failure?.reason).toBe('claude-absent');
    });

    it('T3: unparseable output reports "non-json" — distinct from a timeout', async () => {
      writeSpec(tmp, 'alpha', 'SPEC-001', 'Alpha');
      mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
        if (isVersion(args)) return invoke(opts, cb, null, 'claude 2.1.0\n');
        return invoke(opts, cb, null, 'I am afraid I cannot do that.');
      });

      const res = await proposeAI(tmp);

      expect(res.proposal).toBeNull();
      expect(res.failure?.reason).toBe('non-json');
    });

    it('T3: a mapping onto an EXISTING epic is accepted without re-declaring it', async () => {
      // The prompt tells the model to reuse existing slugs, so on an organized
      // project the correct reply is mappings referencing epics it never lists
      // under "epics". That used to be rejected as "no usable epics" — found
      // when the fixed pass was first run against this repo.
      writeSpec(tmp, 'beta', 'SPEC-002', 'Needs An Epic');
      createEpic(tmp, 'SDD Core Methodology', 'sdd-core');
      mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
        if (isVersion(args)) return invoke(opts, cb, null, 'claude 2.1.0\n');
        return invoke(opts, cb, null, JSON.stringify({
          epics: [], // deliberately empty — the model reused an existing epic
          mappings: [{ artifactId: 'SPEC-002', epicSlug: 'sdd-core', confidence: 0.8, rationale: 'core work' }],
        }));
      });

      const res = await proposeAI(tmp);

      expect(res.failure).toBeUndefined();
      expect(res.proposal?.mappings).toHaveLength(1);
      expect(res.proposal?.epics).toHaveLength(1);
      // Carries the registry id, so apply reuses it instead of allocating a duplicate.
      expect(res.proposal?.epics[0].id).toMatch(/^EPIC-\d+$/);
      expect(res.proposal?.epics[0].slug).toBe('sdd-core');
    });

    it('T3: the prompt asks only about UNASSIGNED artifacts', async () => {
      writeSpec(tmp, 'alpha', 'SPEC-001', 'Already Sorted', { epic: 'EPIC-001' });
      writeSpec(tmp, 'beta', 'SPEC-002', 'Needs An Epic');
      mockExecFile.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: unknown) => {
        if (isVersion(args)) return invoke(opts, cb, null, 'claude 2.1.0\n');
        return invoke(opts, cb, null, '{"epics":[],"mappings":[]}');
      });

      await proposeAI(tmp);

      const dispatch = mockExecFile.mock.calls.find((c: unknown[]) => isDispatch(c[1]));
      const prompt = (dispatch![1] as string[])[1];
      // The tagged spec may appear as taxonomy context, but the ask itself must
      // not include it — every such mapping is discarded at apply (FR-6), so
      // generating one only burns the budget that then runs out.
      // The bullet list under the ask heading — not the trailing JSON schema
      // example, whose placeholder literally reads "SPEC-001".
      const askLines = prompt
        .slice(prompt.indexOf('ARTIFACTS TO ASSIGN'))
        .split('\n')
        .filter(l => l.startsWith('- '));
      expect(askLines.join('\n')).toContain('SPEC-002');
      expect(askLines.join('\n')).not.toContain('SPEC-001');
      // ...and it IS still offered as taxonomy context, so the model reuses epics.
      expect(prompt.slice(0, prompt.indexOf('ARTIFACTS TO ASSIGN'))).toContain('SPEC-001');
    });
  });

  // ─── #1571 — no epic is born empty ───────────────────────────────────

  describe('#1571 — a spec\'s own folder is not an epic, and no epic is born empty', () => {
    it('T3: a folder named after the spec inside it does NOT seed an epic', () => {
      // The real layout: specs/minspec/SPEC-019-execution-substrate/requirements.md.
      // Seeding from it yields one epic per spec — the opposite of grouping.
      writeSpec(tmp, 'minspec/SPEC-019-execution-substrate', 'SPEC-019', 'Execution Substrate', {
        file: 'requirements',
      });

      const p = proposeHeuristic(tmp);

      expect(p.epics.some(e => e.slug === 'spec-019-execution-substrate')).toBe(false);
    });

    it('T3: a genuine multi-spec feature folder still seeds an epic', () => {
      // Guard against over-correcting: real feature folders must keep working.
      writeSpec(tmp, 'minspec/payment-flow', 'SPEC-001', 'Payment Flow Spec');
      writeSpec(tmp, 'minspec/payment-flow', 'SPEC-002', 'Payment Tasks');

      const p = proposeHeuristic(tmp);

      expect(p.epics.some(e => e.slug === 'payment-flow')).toBe(true);
    });

    it('T3: withoutAlreadyTagged drops no-op mappings so the reviewed count is the real count', () => {
      writeSpec(tmp, 'minspec/payment-flow', 'SPEC-001', 'Payment Flow Spec', { epic: 'EPIC-001' });
      writeSpec(tmp, 'minspec/payment-flow', 'SPEC-002', 'Payment Tasks', { epic: 'EPIC-001' });

      const raw = proposeHeuristic(tmp);
      expect(raw.mappings.length).toBeGreaterThan(0); // engine still proposes

      const honest = withoutAlreadyTagged(raw);

      // Every mapping was a no-op, so the honest proposal is empty — the command
      // then says "nothing to backfill" instead of promising N tags.
      expect(honest.mappings).toHaveLength(0);
      expect(honest.epics).toHaveLength(0);
    });

    it('T3 (the gate): applyBackfill never creates an epic whose every mapping is skipped', () => {
      const fp = writeSpec(tmp, 'minspec/payment-flow', 'SPEC-001', 'Payment Flow Spec', {
        epic: 'EPIC-001',
      });
      // A hand-built proposal that WOULD have created an empty epic: the mapping
      // is doomed (the artifact already carries `epic:`) but the epic is new.
      const proposal: BackfillProposal = {
        epics: [{ slug: 'ghost-epic', title: 'Ghost Epic', rationale: 'nothing will join it' }],
        mappings: [{
          artifactId: 'SPEC-001',
          kind: 'spec',
          filePath: fp,
          epicSlug: 'ghost-epic',
          confidence: 0.9,
          rationale: 'doomed',
        }],
        source: 'heuristic',
      };

      const res = applyBackfill(tmp, proposal);

      expect(res.artifactsTagged).toBe(0);
      expect(res.skipped).toBe(1);
      // The distinguishing assertion: pre-fix this was 1, and a ghost epic file
      // plus an INDEX row were written for an epic nothing belongs to.
      expect(res.epicsCreated).toBe(0);
      expect(listEpics(tmp).some(e => e.slug === 'ghost-epic')).toBe(false);
      expect(readArtifactEpic(fp)).toBe('EPIC-001'); // untouched
    });

    it('T3: an epic with at least one real mapping IS still created', () => {
      // The gate must not block legitimate work.
      const fp = writeSpec(tmp, 'minspec/payment-flow', 'SPEC-001', 'Payment Flow Spec');
      const proposal: BackfillProposal = {
        epics: [{ slug: 'payment-flow', title: 'Payment Flow', rationale: 'real' }],
        mappings: [{
          artifactId: 'SPEC-001',
          kind: 'spec',
          filePath: fp,
          epicSlug: 'payment-flow',
          confidence: 0.9,
          rationale: 'real',
        }],
        source: 'heuristic',
      };

      const res = applyBackfill(tmp, proposal);

      expect(res.epicsCreated).toBe(1);
      expect(res.artifactsTagged).toBe(1);
      expect(readArtifactEpic(fp)).toMatch(/^EPIC-\d+$/);
    });

    it('T3: end-to-end on a fully-tagged corpus — zero epics created, zero tags', () => {
      // The exact shape of the real repo: everything already carries `epic:`.
      for (let i = 1; i <= 6; i++) {
        const id = `SPEC-${String(i).padStart(3, '0')}`;
        writeSpec(tmp, `minspec/${id}-thing-${i}`, id, `Thing ${i}`, {
          epic: 'EPIC-001',
          file: 'requirements',
        });
      }
      const before = fs.existsSync(path.join(tmp, 'docs', 'epics'))
        ? fs.readdirSync(path.join(tmp, 'docs', 'epics')).length
        : 0;

      const honest = withoutAlreadyTagged(proposeHeuristic(tmp));
      const res = applyBackfill(tmp, honest);

      expect(collectArtifacts(tmp)).toHaveLength(6);
      expect(res.epicsCreated).toBe(0);
      expect(res.artifactsTagged).toBe(0);
      const after = fs.existsSync(path.join(tmp, 'docs', 'epics'))
        ? fs.readdirSync(path.join(tmp, 'docs', 'epics')).filter(f => /^EPIC-/.test(f)).length
        : 0;
      expect(after).toBe(before);
    });
  });
});
