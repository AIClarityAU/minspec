/**
 * ENFORCEMENT — constitution: "don't trust the model to follow a rule — enforce it."
 *
 * The `ai-review:<verdict>` LABEL set and the `ai-review/pass` STATUS-CONTEXT are the
 * SINGLE contract between the reviewer that WRITES a verdict and the `ready-to-merge`
 * gate that READS it — but they are re-typed as bare string literals across producer
 * files in two languages (workflow YAML + shell), none of which import the canonical
 * definitions in `.github/scripts/ai-review-guard.js`. Nothing binds those restated
 * literals to the guard, so a rename on one producer silently diverges from the reader.
 * Two failure modes this test closes (#822):
 *
 *   A3 — LABEL DRIFT. Rename a verdict label on a producer (`ai-review:pass` →
 *        `ai-review:passs`, or a "consistent" repo-wide rename to some new word) while
 *        `ready-to-merge` still reads `guard.PASS`. The gate never recognises the applied
 *        label ⇒ a genuinely-passed PR never greens ⇒ every merge deadlocks (fail-closed).
 *
 *   A4 — COLON / SLASH CONFUSION. The LABEL is colon-joined (`ai-review:pass`); the
 *        SHA-bound commit-STATUS context is slash-joined (`ai-review/pass`, #466). They
 *        share a prefix and suffix and differ by ONE character, so a one-key typo on the
 *        `-f context=` in ai-review.yml (slash → colon) makes `verifyHeadPassStatus` never
 *        find the head-SHA witness ⇒ `ready-to-merge` stays red on real passes. The colon
 *        form is a VALID label, so a generic label check waves it through — only a
 *        position-aware check catches a status posted with the label's separator.
 *
 * The canonical source (SSOT) is `ai-review-guard.js`'s exports: PASS / CHANGES / BLOCKED
 * (labels) + PASS_STATUS_CONTEXT (status). `ai-review:pending` is an ai-review.yml-only
 * in-progress marker with no guard constant, so it is the one plain-string member of the
 * allowed LABEL set. This test asserts every producer's restated literal agrees with the
 * guard — a mismatch fails CI, not an LLM reviewer.
 *
 * SCOPE: this is the ENFORCEMENT GATE half of #822. The SSOT-REFACTOR half (make the
 * shell/YAML producers READ the literals from guard.js via `node -e` so they can no longer
 * restate them) edits `.github/` + `scripts/` — machinery the self-edit guard blocks from a
 * clean auto-merge — and is tracked separately. This test guards the invariant meanwhile.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);

/** Locate the repo root by walking up to the dir holding the real ai-review workflow. */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, '.github/workflows/ai-review.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate repo root (…/.github/workflows/ai-review.yml)');
}

/** Recursively collect files under `dir` whose name ends with one of `exts`. */
function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => entry.name.endsWith(e))) acc.push(full);
  }
  return acc;
}

/**
 * Every file that RESTATES an `ai-review:<x>` / `ai-review/<x>` verdict literal, EXCEPT the
 * SSOT itself (`ai-review-guard.js`) and its unit test — those DEFINE the constants; binding
 * them to themselves is vacuous. Discovery is dynamic (glob, not a hand-roster) so a NEW
 * producer added later is auto-covered — the roster cannot silently drift out of date.
 */
function discoverProducers(root: string): string[] {
  const files: string[] = [];
  walk(path.join(root, '.github/workflows'), ['.yml', '.yaml'], files);
  walk(path.join(root, 'scripts'), ['.sh', '.md'], files);
  for (const f of walk(path.join(root, '.github/scripts'), ['.js'])) {
    const base = path.basename(f);
    if (base === 'ai-review-guard.js' || base === 'ai-review-guard.test.js') continue;
    files.push(f);
  }
  return files.filter((f) => /ai-review[:/][a-z]+/.test(fs.readFileSync(f, 'utf8')));
}

// Any distinct colon-form verdict LABEL literal, e.g. `ai-review:pass`.
const LABEL_RE = /ai-review:[a-z]+/g;
// Any distinct slash-form STATUS-CONTEXT literal, e.g. `ai-review/pass`.
const STATUS_RE = /ai-review\/[a-z]+/g;
// A literal used AT a `gh` label-application call site (add/remove/create). Captures the
// value even if it is (wrongly) slash-joined, so a slash-form applied as a label is caught.
const LABEL_APPLY_RE =
  /(?:--add-label|--remove-label|gh label create)\s+["']?(ai-review[:/][a-z]+)["']?/g;
// A literal used AT a commit-status context site: `gh api … -f context=…` or a
// github-script `context:` key. Captures either separator so a colon-joined status is caught.
const STATUS_CTX_RE = /(?:-f\s+context=|context\s*:\s*)["']?(ai-review[:/][a-z]+)["']?/g;

function distinct(text: string, re: RegExp): string[] {
  return [...new Set(text.match(new RegExp(re.source, 'g')) ?? [])];
}
function captures(text: string, re: RegExp): string[] {
  return [...text.matchAll(new RegExp(re.source, 'g'))].map((m) => m[1]);
}
function rel(root: string, f: string): string {
  return path.relative(root, f);
}

describe('ENFORCE: ai-review verdict labels + status context cannot drift from guard.js (#822)', () => {
  const root = findRepoRoot();
  const guard = requireCjs(
    path.resolve(root, '.github/scripts/ai-review-guard.js'),
  ) as {
    PASS: string;
    CHANGES: string;
    BLOCKED: string;
    PASS_STATUS_CONTEXT: string;
  };
  const producers = discoverProducers(root);

  // The guard-sanctioned LABEL set. `ai-review:pending` has no guard constant (it is the
  // ai-review.yml-only in-progress marker) so it is included as a plain string.
  const PENDING = 'ai-review:pending';
  const ALLOWED_LABELS = new Set([guard.PASS, guard.CHANGES, guard.BLOCKED, PENDING]);

  it('the SSOT (guard.js) exports the expected colon-form labels + slash-form status', () => {
    // Anchor the contract: if an EXPORT is renamed/removed, this fails first with a clear
    // message rather than the downstream binding tests failing cryptically.
    expect(guard.PASS).toBe('ai-review:pass');
    expect(guard.CHANGES).toBe('ai-review:changes');
    expect(guard.BLOCKED).toBe('ai-review:blocked');
    expect(guard.PASS_STATUS_CONTEXT).toBe('ai-review/pass');
  });

  it('discovers the producer files (glob is not broken — includes the primary ai-review.yml)', () => {
    expect(producers.length).toBeGreaterThan(0);
    expect(producers.map((f) => rel(root, f))).toContain('.github/workflows/ai-review.yml');
  });

  it('A3 — every restated LABEL literal is a guard-sanctioned verdict label (no drift/typo)', () => {
    // A rename on ANY producer (`ai-review:pass` → `ai-review:passs`, or a repo-wide rename
    // to a word guard.js does not sanction) yields a literal outside the allowed set → fail.
    const violations: string[] = [];
    for (const f of producers) {
      const text = fs.readFileSync(f, 'utf8');
      for (const lit of distinct(text, LABEL_RE)) {
        if (!ALLOWED_LABELS.has(lit)) {
          violations.push(
            `${rel(root, f)}: unsanctioned verdict label ${JSON.stringify(lit)} — not in ` +
              `guard.js {PASS,CHANGES,BLOCKED} ∪ {${PENDING}}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('A4 — every restated slash-form STATUS-CONTEXT literal equals guard.PASS_STATUS_CONTEXT', () => {
    const violations: string[] = [];
    for (const f of producers) {
      const text = fs.readFileSync(f, 'utf8');
      for (const lit of distinct(text, STATUS_RE)) {
        if (lit !== guard.PASS_STATUS_CONTEXT) {
          violations.push(
            `${rel(root, f)}: status-context ${JSON.stringify(lit)} ≠ guard.PASS_STATUS_CONTEXT ` +
              `(${JSON.stringify(guard.PASS_STATUS_CONTEXT)})`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('A3 — every `gh` LABEL-application literal is a colon-form sanctioned label (never slash-form)', () => {
    // Position-aware: a value passed to --add-label / --remove-label / `gh label create`
    // that begins `ai-review` MUST be a sanctioned colon-label. A slash-joined value here
    // (`ai-review/pass` applied AS a label) is not in the label set → fail.
    const applied: string[] = [];
    const violations: string[] = [];
    for (const f of producers) {
      const text = fs.readFileSync(f, 'utf8');
      for (const cap of captures(text, LABEL_APPLY_RE)) {
        applied.push(cap);
        if (!ALLOWED_LABELS.has(cap)) {
          violations.push(`${rel(root, f)}: applies label ${JSON.stringify(cap)} — not a sanctioned verdict label`);
        }
      }
    }
    // Non-vacuous: at least one real label-application site must exist, or a broken regex
    // would let this pass while catching nothing (and the RCDD drift proof would be a no-op).
    expect(applied.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    // A4 direction: the SLASH-form (a status context) must NEVER be applied as a label.
    expect(applied.filter((c) => c === guard.PASS_STATUS_CONTEXT)).toEqual([]);
  });

  it('A4 — every commit-status `context=` literal equals guard.PASS_STATUS_CONTEXT (never the colon-label)', () => {
    // Position-aware: a value posted as a commit-status context (`gh api … -f context=…`)
    // MUST be the slash-joined `ai-review/pass`. This is the ONE check that catches the
    // slash→colon typo: `ai-review:pass` is a valid LABEL, so the generic label check
    // (A3 above) waves it through — only reading it AT the context position rejects it.
    const posted: string[] = [];
    const violations: string[] = [];
    for (const f of producers) {
      const text = fs.readFileSync(f, 'utf8');
      for (const cap of captures(text, STATUS_CTX_RE)) {
        posted.push(cap);
        if (cap !== guard.PASS_STATUS_CONTEXT) {
          violations.push(
            `${rel(root, f)}: posts status context ${JSON.stringify(cap)} ≠ ` +
              `guard.PASS_STATUS_CONTEXT (${JSON.stringify(guard.PASS_STATUS_CONTEXT)}) — ` +
              `the colon/slash confusion #822 A4 guards against`,
          );
        }
      }
    }
    // Non-vacuous: ai-review.yml posts the SHA-bound `ai-review/pass` status — if this is 0
    // the regex is broken and the colon-flip RCDD proof would silently pass. Guard it.
    expect(posted.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    // A4 direction: the COLON-form (a label) must NEVER be posted as a status context.
    expect(posted.filter((c) => c === guard.PASS)).toEqual([]);
  });

  it('A4 — the LABEL and STATUS-CONTEXT differ by exactly the separator (structural invariant)', () => {
    // The whole colon/slash hazard exists because these two strings are one char apart.
    // Pin that relationship so a future refactor can't accidentally collapse them into one.
    expect(guard.PASS).toContain(':');
    expect(guard.PASS).not.toContain('/');
    expect(guard.PASS_STATUS_CONTEXT).toContain('/');
    expect(guard.PASS_STATUS_CONTEXT).not.toContain(':');
    expect(guard.PASS.startsWith('ai-review')).toBe(true);
    expect(guard.PASS_STATUS_CONTEXT.startsWith('ai-review')).toBe(true);
    // Same prefix, same suffix, different join char.
    expect(guard.PASS.split(':')).toEqual(['ai-review', 'pass']);
    expect(guard.PASS_STATUS_CONTEXT.split('/')).toEqual(['ai-review', 'pass']);
    expect(guard.PASS.replace(':', '/')).toBe(guard.PASS_STATUS_CONTEXT);
    expect(guard.PASS).not.toBe(guard.PASS_STATUS_CONTEXT);
  });
});
