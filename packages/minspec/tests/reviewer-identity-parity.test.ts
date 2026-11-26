/**
 * T0 (#4078, PR #4086 architect finding) - the reviewer identity has ONE rule.
 *
 * The gating workflows (ai-review.yml, ready-to-merge.yml) decide who may write an
 * `ai-review` verdict with `guard.resolveReviewerAllowlist`, fed
 * `vars.AI_REVIEW_BOT_LOGINS || 'minspec-sdd[bot]'` and `vars.AI_REVIEW_APP`. The delegated
 * approval and merge paths (`judgeHeadReviewPass`) must trust EXACTLY the same writers for
 * the same configuration, or merging a mode change fail-closes one path while the other
 * still trusts the builder (or worse, the reverse).
 *
 * This test drives `judgeHeadReviewPass` through its DEFAULT (process environment) path,
 * and compares it with the workflow's computation, for every configuration and writer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

import {
  AI_REVIEW_WORKFLOW_PATH,
  judgeHeadReviewPass,
  type ReviewEvidence,
} from '../../../scripts/lib/delegated-approval';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const guard = createRequire(__filename)('../../../.github/scripts/ai-review-guard.js') as {
  resolveReviewerAllowlist(o: { mode?: string; raw?: string }): { allowlist: string[]; fault: string };
  isAuthorizedReviewer(login: string, allowlist: readonly string[]): boolean;
};

const BUILDER = 'minspec-sdd[bot]';
const REVIEW_APP = 'aiclarity-minspec-review[bot]';
const HEAD = 'b'.repeat(40);

/** A complete, CI-bound pass written by `writer` (both the check-run and the comment). */
function passBy(writer: string, extraChecks: ReviewEvidence['checkRuns'] = []): ReviewEvidence {
  return {
    pull: { number: 41, merged: true, headSha: HEAD, headRef: 'feat/x', authorLogin: BUILDER, files: ['specs/a.md'] },
    artifactAtHead: '',
    comments: [
      {
        id: 200,
        url: 'https://github.com/AIClarityAU/minspec/pull/41#issuecomment-200',
        login: writer,
        body: '## 🤖 AI review — `ai-review:pass`\n\nOK.',
        createdAt: '2026-11-26T10:05:00Z',
      },
    ],
    checkRuns: [
      { name: 'ai-review', status: 'completed', conclusion: 'success', appSlug: writer.replace(/\[bot\]$/, ''), headSha: HEAD, completedAt: '2026-11-26T10:05:10Z' },
      ...extraChecks,
    ],
    workflowRuns: [
      { path: AI_REVIEW_WORKFLOW_PATH, event: 'pull_request', status: 'completed', headSha: HEAD, runStartedAt: '2026-11-26T10:00:00Z', updatedAt: '2026-11-26T10:06:00Z' },
    ],
  };
}

/** What the workflows compute for this configuration (their env expressions, verbatim). */
function workflowTrusts(vars: { AI_REVIEW_APP?: string; AI_REVIEW_BOT_LOGINS?: string }, writer: string): boolean {
  const r = guard.resolveReviewerAllowlist({ mode: vars.AI_REVIEW_APP, raw: vars.AI_REVIEW_BOT_LOGINS || BUILDER });
  if (r.fault) return false;
  return guard.isAuthorizedReviewer(writer, r.allowlist);
}

const CONFIGS: Array<{ name: string; vars: { AI_REVIEW_APP?: string; AI_REVIEW_BOT_LOGINS?: string } }> = [
  { name: 'default (both unset)', vars: {} },
  { name: 'builder, explicit', vars: { AI_REVIEW_APP: 'builder' } },
  { name: 'empty logins variable', vars: { AI_REVIEW_BOT_LOGINS: '' } },
  { name: 'review mode, review App only', vars: { AI_REVIEW_APP: 'review', AI_REVIEW_BOT_LOGINS: REVIEW_APP } },
  { name: 'review mode, mixed case/space', vars: { AI_REVIEW_APP: ' Review ', AI_REVIEW_BOT_LOGINS: ' Aiclarity-Minspec-Review[bot] ' } },
  { name: 'review mode, builder still listed', vars: { AI_REVIEW_APP: 'review', AI_REVIEW_BOT_LOGINS: `${REVIEW_APP},${BUILDER}` } },
  { name: 'review mode, logins unset', vars: { AI_REVIEW_APP: 'review' } },
  { name: 'unknown mode', vars: { AI_REVIEW_APP: 'reveiw', AI_REVIEW_BOT_LOGINS: REVIEW_APP } },
];

function stub(vars: { AI_REVIEW_APP?: string; AI_REVIEW_BOT_LOGINS?: string }): void {
  vi.stubEnv('AI_REVIEW_APP', vars.AI_REVIEW_APP);
  vi.stubEnv('AI_REVIEW_BOT_LOGINS', vars.AI_REVIEW_BOT_LOGINS);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('T0 #4078 - delegated-approval trusts exactly the writers the gating workflows trust', () => {
  for (const { name, vars } of CONFIGS) {
    for (const writer of [BUILDER, REVIEW_APP]) {
      it(`${name}: a pass written by ${writer}`, () => {
        stub(vars);
        const judged = judgeHeadReviewPass(passBy(writer));
        expect({ writer, delegatedTrusts: judged.ok }).toEqual({ writer, delegatedTrusts: workflowTrusts(vars, writer) });
      });
    }
  }

  it('default: a builder pass clears, exactly as on main (no fail-closed window at merge)', () => {
    stub({});
    expect(judgeHeadReviewPass(passBy(BUILDER)).ok).toBe(true);
  });

  it('review mode: a builder-token verdict is rejected and the review App verdict clears', () => {
    stub({ AI_REVIEW_APP: 'review', AI_REVIEW_BOT_LOGINS: REVIEW_APP });
    expect(judgeHeadReviewPass(passBy(BUILDER)).ok).toBe(false);
    expect(judgeHeadReviewPass(passBy(REVIEW_APP)).ok).toBe(true);
  });

  it('an unknown or builder-naming review configuration fails CLOSED for every writer', () => {
    for (const vars of [{ AI_REVIEW_APP: 'reveiw' }, { AI_REVIEW_APP: 'review', AI_REVIEW_BOT_LOGINS: BUILDER }, { AI_REVIEW_APP: 'review' }]) {
      stub(vars);
      for (const writer of [BUILDER, REVIEW_APP]) {
        const r = judgeHeadReviewPass(passBy(writer));
        expect(r.ok).toBe(false);
        expect(!r.ok && r.reason).toBe('reviewer-identity-unresolved');
      }
    }
  });

  it('stale session (env says builder, repository writes with the review App): the builder pass is refused, not believed', () => {
    stub({});
    const reviewAppCheck = { name: 'ai-review', status: 'completed', conclusion: 'changes' as string | null, appSlug: 'aiclarity-minspec-review', headSha: HEAD, completedAt: '2026-11-26T10:04:00Z' };
    const r = judgeHeadReviewPass(passBy(BUILDER, [{ ...reviewAppCheck, conclusion: 'failure' }]));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('reviewer-identity-mismatch');
  });

  it("the Actions runner's own implicit job check is not a foreign verdict", () => {
    stub({});
    const runnerCheck = { name: 'ai-review', status: 'completed', conclusion: 'success' as string | null, appSlug: 'github-actions', headSha: HEAD, completedAt: '2026-11-26T10:03:00Z' };
    expect(judgeHeadReviewPass(passBy(BUILDER, [runnerCheck])).ok).toBe(true);
  });
});

describe('T0 #4078 - the workflows feed the guard the inputs this test models', () => {
  for (const wf of ['.github/workflows/ai-review.yml', '.github/workflows/ready-to-merge.yml']) {
    it(`${wf} passes AI_REVIEW_APP and the defaulted AI_REVIEW_BOT_LOGINS`, () => {
      const text = fs.readFileSync(path.join(REPO_ROOT, wf), 'utf-8');
      expect(text).toContain("AI_REVIEW_BOT_LOGINS: ${{ vars.AI_REVIEW_BOT_LOGINS || 'minspec-sdd[bot]' }}");
      expect(text).toContain('AI_REVIEW_APP: ${{ vars.AI_REVIEW_APP }}');
      expect(text).toMatch(/resolveReviewerAllowlist\(\{\s*mode: process\.env\.AI_REVIEW_APP,\s*raw: process\.env\.AI_REVIEW_BOT_LOGINS/);
    });
  }
});
