/**
 * T3 — regression for the #1017 ai-review false positive.
 *
 * The panel gets Read/Glob/Grep but NO git, so a diff that changes only an approval
 * sidecar cannot show that the spec changed in an EARLIER commit. Facing that gap the
 * Architect and Skeptic both returned blocking findings calling a genuine human Alt+A
 * approval a possible "forged sign-off" / "unbacked approval". It was legitimate:
 * #1009 changed SPEC-040/requirements.md and the human re-approved 85 seconds later.
 *
 * approval-provenance.py computes the missing evidence. These tests drive it against
 * REAL temporary git repositories — the staleness question is inherently a history
 * question, so a stubbed git would prove nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SCRIPT = path.resolve(__dirname, '../../../scripts/approval-provenance.py');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e' },
  });
}

function report(cwd: string, base: string, head: string): string {
  return execFileSync('python3', [SCRIPT, base, head], { cwd, encoding: 'utf-8' });
}

const SPEC_REL = 'specs/minspec/SPEC-999-demo/requirements.md';
const SIDE_REL = '.minspec/approvals/specs/minspec/SPEC-999-demo/requirements.md.json';

function specBody(extra: string): string {
  return `---\nid: SPEC-999\ntype: requirements\nstatus: specifying\ntier: T3\n---\n\n# Demo\n\n${extra}\n`;
}

/** Canonical hash via the same hasher the approval system uses. */
function hashOf(repo: string, content: string): string {
  const tmp = path.join(repo, '.hash-input.md');
  fs.writeFileSync(tmp, content);
  const py = `import sys; sys.path.insert(0, ${JSON.stringify(path.resolve(__dirname, '../../../scripts/hooks'))}); from canonical import spec_hash; print(spec_hash(open(${JSON.stringify(tmp)}).read()))`;
  const h = execFileSync('python3', ['-c', py], { encoding: 'utf-8' }).trim();
  fs.unlinkSync(tmp);
  return h;
}

function writeSidecar(repo: string, hash: string, approvedAt: string): void {
  const p = path.join(repo, SIDE_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify({ specPath: SPEC_REL, specHash: hash, approvedAt, approvedBy: 'human@example.com' }, null, 2) + '\n',
  );
}

function writeSpec(repo: string, content: string): void {
  const p = path.join(repo, SPEC_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

let repo: string;
/** Explicit SHAs — relative refs would shift as later tests add commits. */
const C: Record<string, string> = {};

function commit(msg: string, key: string): void {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', msg);
  C[key] = git(repo, 'rev-parse', 'HEAD').trim();
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'commit.gpgsign', 'false');

  // c0 — empty root, so "the state before any approval existed" is addressable.
  commit('c0: root', 'c0');

  // c1 — first approval: spec + a matching record.
  const v1 = specBody('original requirement');
  writeSpec(repo, v1);
  writeSidecar(repo, hashOf(repo, v1), '2026-01-01T00:00:00.000Z');
  commit('c1: spec + approval', 'c1');

  // c2 — the spec CHANGES on its own, leaving the record stale. This is the commit
  // the reviewer cannot see from a later diff.
  const v2 = specBody('requirement was revised here');
  writeSpec(repo, v2);
  commit('c2: spec content changed (record now stale)', 'c2');

  // c3 — the human re-approves: only the sidecar changes. THE #1017 SHAPE.
  writeSidecar(repo, hashOf(repo, v2), '2026-01-03T00:00:00.000Z');
  commit('c3: re-approval (sidecar only)', 'c3');

  // c4 — a sidecar edited to a hash matching NOTHING (the real forgery shape).
  writeSidecar(repo, 'f'.repeat(64), '2026-01-04T00:00:00.000Z');
  commit('c4: sidecar hash with no backing content', 'c4');

  // c5 — a commit touching no sidecar at all (the common path).
  commit('c5: code only', 'c5');
});

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

describe('approval-provenance: the #1017 false positive', () => {
  it('reports a sidecar-only re-approval as BACKED when the record was already stale', () => {
    // c2..c3 is exactly the #1017 shape: the diff shows ONLY a hash+timestamp change,
    // and the content change that justified it is in an earlier commit.
    const out = report(repo, C.c2, C.c3);
    expect(out).toContain('ALREADY STALE');
    expect(out).toContain('re-approval, not an unbacked edit');
    expect(out).toContain('MATCHES');
  });

  it('names the earlier commit that invalidated the old record', () => {
    // The decisive fact the reviewer could not obtain.
    expect(report(repo, C.c2, C.c3)).toContain('c2: spec content changed');
  });

  it('still flags a genuinely unbacked hash as a MISMATCH', () => {
    // The fix must not blunt the panel: a hash matching no content is a real finding,
    // and this is the shape the reviewers were (wrongly) worried about on #1017.
    const out = report(repo, C.c3, C.c4);
    expect(out).toContain('MISMATCH');
    expect(out).toContain('a real finding');
    expect(out).not.toContain('re-approval, not an unbacked edit');
  });
});

describe('approval-provenance: shape and safety', () => {
  it('emits NOTHING when the range touches no approval sidecar', () => {
    // The common path (ordinary code PRs) must be completely unaffected.
    expect(report(repo, C.c4, C.c5).trim()).toBe('');
  });

  it('labels itself as trusted, machine-generated evidence', () => {
    // review-branch.sh puts this beside an UNTRUSTED diff; the distinction must be
    // stated in the payload itself, not only in the wrapper tag.
    const out = report(repo, C.c2, C.c3);
    expect(out).toContain('TRUSTED');
    expect(out).toContain('canonical.py');
  });

  it('reports a first-ever approval as such rather than as suspicious', () => {
    const out = report(repo, C.c0, C.c1);
    expect(out).toContain('first approval');
  });

  it('exits 2 on bad usage instead of emitting a partial report', () => {
    let code = 0;
    try {
      execFileSync('python3', [SCRIPT, 'only-one'], { cwd: repo, stdio: 'pipe' });
    } catch (e: unknown) {
      code = (e as { status?: number }).status ?? 1;
    }
    expect(code).toBe(2);
  });
});

describe('review-branch.sh wiring', () => {
  const sh = fs.readFileSync(path.resolve(__dirname, '../../../scripts/review-branch.sh'), 'utf-8');

  it('injects the provenance block into the review prompt', () => {
    expect(sh).toContain('approval-provenance.py');
    expect(sh).toContain('${PROVENANCE_BLOCK}');
  });

  it('keeps the trusted facts OUTSIDE the untrusted diff block', () => {
    // A prompt-injected diff must not be able to forge these facts by closing the
    // tag early — the provenance block is appended after </untrusted_diff>.
    const diffEnd = sh.indexOf('</untrusted_diff>');
    const provAt = sh.indexOf('${PROVENANCE_BLOCK}');
    expect(diffEnd).toBeGreaterThan(-1);
    expect(provAt).toBeGreaterThan(diffEnd);
  });

  it('never lets a provenance failure break the review', () => {
    // Facts are an aid, not a gate: the panel must still run if the helper errors.
    expect(sh).toMatch(/approval-provenance\.py[^\n]*\|\| true/);
  });
});
