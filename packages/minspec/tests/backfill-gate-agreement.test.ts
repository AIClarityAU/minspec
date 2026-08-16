/**
 * T3 regression — two defects an adversarial review found in the #1572 fix,
 * both reproduced by executing the real code before being fixed here.
 *
 * #1575 — `applyBackfill` held TWO notions of "which mappings apply": the gate
 * computed `effective` once from a pre-write snapshot, while the tagging loop
 * re-read each file after every write. Two mappings naming the same artifact let
 * the second epic pass the gate and be created, while the loop then refused it a
 * member — an epic born empty through the very gate meant to stop that.
 *
 * #1576 — `normalizeAiProposal` judged emptiness BEFORE filtering epics down to
 * those a surviving mapping references, so a degenerate reply returned a
 * non-null, fully empty proposal. That reads as success everywhere downstream:
 * `unusable` became unreachable and the command discarded its good heuristic
 * proposal for the empty one, telling the user there was nothing to backfill.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  normalizeAiProposal,
  withoutAlreadyTagged,
  applyBackfill,
  collectArtifacts,
  type BackfillProposal,
} from '../src/lib/epic-backfill';
import { listEpics } from '../src/lib/epic-manager';

function writeConfig(root: string): void {
  fs.mkdirSync(path.join(root, '.minspec'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minspec', 'config.json'), JSON.stringify({ version: '1' }));
}

function writeSpec(root: string, id: string, title: string): string {
  const dir = path.join(root, 'specs', 'alpha');
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${id}.md`);
  fs.writeFileSync(fp, [
    '---', `id: ${id}`, `title: ${title}`, 'tier: T2', 'status: new',
    'created: 2026-08-16', 'phases:', '  specify: done', '---', '',
    `# ${title}`, '', 'Prose.', '',
  ].join('\n'));
  return fp;
}

describe('backfill — the gate and the loop must agree', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-gate-agree-'));
    writeConfig(tmp);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  describe('#1575 — one artifact joins exactly one epic', () => {
    /** The AI reply that reproduced it: one artifact, two epics, two mappings. */
    function doubleMappedProposal(root: string): BackfillProposal {
      writeSpec(root, 'SPEC-001', 'A Thing');
      const arts = collectArtifacts(root);
      return normalizeAiProposal({
        epics: [
          { slug: 'alpha', title: 'Alpha', rationale: 'r' },
          { slug: 'beta', title: 'Beta', rationale: 'r' },
        ],
        mappings: [
          { artifactId: 'SPEC-001', epicSlug: 'alpha', confidence: 0.9, rationale: 'r' },
          { artifactId: 'SPEC-001', epicSlug: 'beta', confidence: 0.9, rationale: 'r' },
        ],
      }, arts)!;
    }

    it('T3: normalizeAiProposal keeps one mapping per artifact', () => {
      const p = doubleMappedProposal(tmp);

      // Pre-fix: 2 mappings for 1 artifact — the prompt's "exactly one epic per
      // artifact" existed only as prose, never as validation.
      expect(p.mappings).toHaveLength(1);
      expect(p.mappings[0].artifactId).toBe('SPEC-001');
      // The unreferenced epic is dropped with it.
      expect(p.epics.map(e => e.slug)).toEqual(['alpha']);
    });

    it('T3 (the gate): apply creates no epic that the tagging loop will refuse', () => {
      writeSpec(tmp, 'SPEC-001', 'A Thing');
      const fp = path.join(tmp, 'specs', 'alpha', 'SPEC-001.md');
      // Hand-built, bypassing normalize — the gate must hold on its own.
      const proposal: BackfillProposal = {
        epics: [
          { slug: 'alpha', title: 'Alpha', rationale: 'r' },
          { slug: 'beta', title: 'Beta', rationale: 'r' },
        ],
        mappings: [
          { artifactId: 'SPEC-001', kind: 'spec', filePath: fp, epicSlug: 'alpha', confidence: 0.9, rationale: 'r' },
          { artifactId: 'SPEC-001', kind: 'spec', filePath: fp, epicSlug: 'beta', confidence: 0.9, rationale: 'r' },
        ],
        source: 'ai',
      };

      const res = applyBackfill(tmp, proposal);

      // Pre-fix: created=2, tagged=1 — EPIC-002 written with zero members.
      expect(res.epicsCreated).toBe(1);
      expect(res.artifactsTagged).toBe(1);
      expect(res.skipped).toBe(1);
      expect(listEpics(tmp).map(e => e.slug)).toEqual(['alpha']);
      // Never more epics created than artifacts tagged, for any input.
      expect(res.epicsCreated).toBeLessThanOrEqual(res.artifactsTagged);
    });

    it('T3: the reviewed count never exceeds the number of real artifacts', () => {
      writeSpec(tmp, 'SPEC-001', 'A Thing');
      const fp = path.join(tmp, 'specs', 'alpha', 'SPEC-001.md');
      const honest = withoutAlreadyTagged({
        epics: [
          { slug: 'alpha', title: 'Alpha', rationale: 'r' },
          { slug: 'beta', title: 'Beta', rationale: 'r' },
        ],
        mappings: [
          { artifactId: 'SPEC-001', kind: 'spec', filePath: fp, epicSlug: 'alpha', confidence: 0.9, rationale: 'r' },
          { artifactId: 'SPEC-001', kind: 'spec', filePath: fp, epicSlug: 'beta', confidence: 0.9, rationale: 'r' },
        ],
        source: 'ai',
      });

      // The toast quotes these numbers. Pre-fix it promised "tag 2 artifact(s)"
      // on a repo containing exactly one artifact.
      expect(honest.mappings).toHaveLength(1);
      expect(honest.mappings.length).toBeLessThanOrEqual(collectArtifacts(tmp).length);
      expect(honest.epics).toHaveLength(1);
    });
  });

  describe('#1576 — an empty result is a failure, not a success', () => {
    it('T3: a reply whose mappings are all dropped returns null', () => {
      writeSpec(tmp, 'SPEC-001', 'A Thing');
      const arts = collectArtifacts(tmp);

      // Every mapping names an artifact that does not exist.
      const r = normalizeAiProposal({
        epics: [{ slug: 'alpha', title: 'Alpha', rationale: 'r' }],
        mappings: [{ artifactId: 'SPEC-999', epicSlug: 'alpha', confidence: 0.9, rationale: 'r' }],
      }, arts);

      // Pre-fix: {epics: [], mappings: [], source: 'ai'} — truthy, so the caller
      // treated it as a usable proposal and dropped the heuristic one.
      expect(r).toBeNull();
    });

    it('T3: a reply with epics but no mappings returns null', () => {
      writeSpec(tmp, 'SPEC-001', 'A Thing');
      const arts = collectArtifacts(tmp);

      const r = normalizeAiProposal({
        epics: [{ slug: 'alpha', title: 'Alpha', rationale: 'r' }],
        mappings: [],
      }, arts);

      expect(r).toBeNull();
    });

    it('T3: a genuinely usable reply is still accepted', () => {
      writeSpec(tmp, 'SPEC-001', 'A Thing');
      const arts = collectArtifacts(tmp);

      const r = normalizeAiProposal({
        epics: [{ slug: 'alpha', title: 'Alpha', rationale: 'r' }],
        mappings: [{ artifactId: 'SPEC-001', epicSlug: 'alpha', confidence: 0.9, rationale: 'r' }],
      }, arts);

      expect(r).not.toBeNull();
      expect(r!.mappings).toHaveLength(1);
      expect(r!.epics).toHaveLength(1);
    });

    it('T3 (the contract): a non-null proposal is never empty', () => {
      writeSpec(tmp, 'SPEC-001', 'A Thing');
      const arts = collectArtifacts(tmp);

      for (const reply of [
        { epics: [{ slug: 'a', title: 'A', rationale: '' }], mappings: [] },
        { epics: [{ slug: 'a', title: 'A', rationale: '' }], mappings: [{ artifactId: 'NOPE', epicSlug: 'a', confidence: 1, rationale: '' }] },
        { epics: [], mappings: [{ artifactId: 'SPEC-001', epicSlug: 'ghost', confidence: 1, rationale: '' }] },
      ]) {
        const r = normalizeAiProposal(reply, arts);
        if (r !== null) {
          expect(r.epics.length).toBeGreaterThan(0);
          expect(r.mappings.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
