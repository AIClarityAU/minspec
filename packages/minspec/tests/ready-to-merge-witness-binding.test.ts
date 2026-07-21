/**
 * ENFORCEMENT — constitution: "don't trust the model to follow a rule — enforce it."
 *
 * #810 — the `ready-to-merge` commit STATUS sat RED on every PR carrying a genuine
 * `ai-review:pass`, so native/auto-merge could never fire and every merge was an
 * `--admin` bypass — the same class as #560 (a required check pinned so it can
 * never be satisfied is not a gate, it is a permanent bypass).
 *
 * Root cause (mechanism): `ai-review.yml` posted the ONLY SHA-bound pass witness —
 * the `ai-review/pass` commit status — with a trailing `|| true`. The `minspec-sdd`
 * App installation lacks `statuses: write`, so EVERY post returned HTTP 403 and the
 * `|| true` swallowed it. The label landed, the witness never did, and
 * `ready-to-merge` (which fail-closes without a head-bound witness, #466) was red
 * forever on a stable head. Nothing re-evaluated the gate after a witness landed
 * either, because posting a status or a check-run emits no `pull_request` event.
 *
 * The fix has three structural halves, and each is only as durable as a test that
 * pins it — an English comment in a 700-line workflow is exactly what drifted:
 *
 *   (a) NON-SILENT WITNESS. The witness posts are no longer best-effort: they
 *       retry, read back, and a `pass` verdict with NO witness fails the run loudly
 *       instead of shipping an unusable label.
 *   (b) RE-EVALUATION. `ready-to-merge` also runs on the reviewer workflow's
 *       completion, so a witness that lands after the label cannot leave a stable
 *       head stuck red.
 *   (c) ORDERING (must NOT regress, #466). The status witness is still posted
 *       BEFORE the `ai-review:pass` label is applied. Reversing that re-opens the
 *       TOCTOU where the `labeled`-triggered gate reads the head before the witness
 *       exists — the exact hole the status-before-label ordering was built to close.
 *
 * These are structural properties of two YAML files that no unit test of the pure
 * guard module can see, so they are asserted here against the files themselves.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Locate the repo root by walking up to the dir holding the real workflows. */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.github/workflows/ready-to-merge.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate the repo root (no .github/workflows/ready-to-merge.yml)');
}

const ROOT = findRepoRoot();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const aiReview = read('.github/workflows/ai-review.yml');
const readyToMerge = read('.github/workflows/ready-to-merge.yml');

describe('#810 (a) — the SHA-bound pass witness must never fail silently', () => {
  it('the ai-review/pass status post is NOT best-effort (`|| true`) any more', () => {
    // The literal defect: `gh api .../statuses/... -f context="ai-review/pass" ... || true`.
    // Match the status-post command and assert no `|| true` swallows its exit code.
    // The whole command: its backslash-continued lines plus the terminating one.
    const post = aiReview.match(
      /gh api "repos\/\$REPO\/statuses\/\$PR_HEAD_SHA"(?:[^\n]*\\\n)*[^\n]*/,
    );
    expect(post, 'the ai-review/pass status post should still exist').not.toBeNull();
    expect(post![0]).not.toMatch(/\|\|\s*true/);
  });

  it('the status post retries and is read back before being believed', () => {
    expect(aiReview).toMatch(/for attempt in 1 2 3; do/);
    expect(aiReview).toMatch(/status_witness=/);
    // A 2xx is not proof: the effective status is re-read from the head SHA.
    expect(aiReview).toMatch(/commits\/\$HEAD_SHA\/statuses|commits\/\$PR_HEAD_SHA\/statuses/);
  });

  it('a pass verdict with NO witness fails the run loudly instead of shipping an unusable label', () => {
    // The witness-or-fail block: pass + neither witness ⇒ ::error:: and exit 1.
    expect(aiReview).toMatch(/STATUS_WITNESS:-no/);
    expect(aiReview).toMatch(/CHECK_WITNESS/);
    expect(aiReview).toMatch(/::error title=AI review passed but no SHA-bound witness/);
  });

  it('ready-to-merge declares every permission its witness reads need', () => {
    // `checks: read` was the missing scope for the second witness; a permissions
    // block without it silently returns 403 → unverified → red on genuine passes.
    const perms = readyToMerge.match(/\npermissions:\n(?:[ \t]+\S.*\n)+/);
    expect(perms, 'ready-to-merge must declare an explicit permissions block').not.toBeNull();
    expect(perms![0]).toMatch(/statuses:\s*write/);
    expect(perms![0]).toMatch(/checks:\s*read/);
  });
});

describe('#810 (b) — ready-to-merge must re-evaluate when a witness lands', () => {
  it('listens for the reviewer workflow completing, not only pull_request events', () => {
    // Posting a commit status or a check-run fires NO pull_request event, so
    // without this trigger a stable head stays stuck RED forever.
    expect(readyToMerge).toMatch(/^\s{2}workflow_run:/m);
    expect(readyToMerge).toMatch(/workflows:\s*\["ai-review-runner"\]/);
    expect(readyToMerge).toMatch(/types:\s*\[completed\]/);
  });

  it('the trigger names the ACTUAL reviewer workflow (a rename would silently kill it)', () => {
    const reviewerName = aiReview.match(/^name:\s*(.+)$/m)?.[1].trim();
    expect(reviewerName).toBeTruthy();
    expect(readyToMerge).toContain(`workflows: ["${reviewerName}"]`);
  });

  it('the re-evaluation path takes the VERIFY-ONLY branch (it can never revert/strip/forge)', () => {
    // `action` becomes a value that is neither 'labeled' nor 'synchronize', so
    // decideProvenanceRevert and decideStalenessStrip both decline by construction.
    expect(readyToMerge).toMatch(/action = 'workflow_run'/);
    expect(readyToMerge).not.toMatch(/action = 'labeled'/);
    expect(readyToMerge).not.toMatch(/action = 'synchronize'/);
  });

  it('still pins the guard checkout to a resolved trusted base commit (self-forge defence)', () => {
    expect(readyToMerge).toMatch(/ref:\s*\$\{\{\s*steps\.resolve\.outputs\.base_sha\s*\}\}/);
    expect(readyToMerge).toMatch(/refusing to run the guard against an unpinned tree/);
  });
});

describe('#810 (c) — the witness-BEFORE-label ordering must not regress (#466 TOCTOU)', () => {
  it('ai-review posts the ai-review/pass status BEFORE it applies the verdict label', () => {
    const statusPost = aiReview.indexOf('gh api "repos/$REPO/statuses/$PR_HEAD_SHA"');
    const labelApply = aiReview.indexOf('gh pr edit "$PR_NUMBER" --repo "$REPO" --add-label "$LABEL"');
    expect(statusPost, 'the ai-review/pass status post must exist').toBeGreaterThan(-1);
    expect(labelApply, 'the verdict label application must exist').toBeGreaterThan(-1);
    expect(statusPost).toBeLessThan(labelApply);
  });
});
