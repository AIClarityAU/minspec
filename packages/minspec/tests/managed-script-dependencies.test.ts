import { describe, it, expect } from 'vitest';
import * as posix from 'node:path/posix';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MANAGED_REGION_TEMPLATES, renderManagedFile } from '../src/lib/template-registry';

/**
 * Invariant (RCDD / DR-003 Phase 4): a managed script may only invoke files that
 * are THEMSELVES managed templates.
 *
 * The scaffolded set is an enumeration, and enumerations drift. `scripts/review-branch.sh`
 * gained a `python3 "${SCRIPT_DIR}/approval-provenance.py"` call (#1026) without the
 * callee being added to the registry, so every consuming repo received the caller
 * alone. The caller guards on the file existing and degrades to an empty provenance
 * block, so the #1017 fix was permanently inert everywhere but this repo — and NOTHING
 * reported it: the parity check byte-compares its own enumerated list, which likewise
 * did not name the missing file. Caught only by a reviewer reading
 * AIClarityAU/sealbox#32 by hand.
 *
 * Missing gate: nothing asserted that the dependency graph BETWEEN managed files is
 * closed. This is that gate. Same class as the drift-enforcement roster (#820-826):
 * a rule the author must remember to apply is a rule that eventually is not applied.
 */

/** Managed templates keyed by the repo-relative path they are scaffolded to. */
const managedPaths = new Set(MANAGED_REGION_TEMPLATES.map((t) => t.outputPath));

/** Only files that EXECUTE can have a runtime dependency on a sibling. */
const scriptTemplates = MANAGED_REGION_TEMPLATES.filter(
  (t) => t.executable === true || /\.(sh|py|js)$/.test(t.outputPath),
);

/**
 * Runtime sibling references of the form `${SCRIPT_DIR}/<path>`. Split into
 * literal (fully resolvable now) and dynamic (contains a further `${…}`, e.g.
 * `roles/${ROLE}.md`, where only the directory is knowable statically).
 */
function siblingRefs(content: string): { literal: string[]; dynamic: string[] } {
  const literal: string[] = [];
  const dynamic: string[] = [];
  const re = /\$\{SCRIPT_DIR\}\/([^"'\s)]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const ref = m[1];
    (ref.includes('${') ? dynamic : literal).push(ref);
  }
  return { literal, dynamic };
}

/** Resolve a `${SCRIPT_DIR}`-relative reference against the template's own location. */
function resolveRef(outputPath: string, ref: string): string {
  return posix.normalize(posix.join(posix.dirname(outputPath), ref));
}

describe('managed scripts have no unmanaged dependencies', () => {
  it('finds the scripts it is meant to be checking (guard against a vacuous pass)', () => {
    // If the extraction ever silently matches nothing, every assertion below
    // passes without testing anything. Anchor on the known callers.
    const withRefs = scriptTemplates.filter((t) => {
      const { literal, dynamic } = siblingRefs(t.content);
      return literal.length + dynamic.length > 0;
    });
    expect(withRefs.length).toBeGreaterThan(0);
    expect(scriptTemplates.map((t) => t.outputPath)).toContain('scripts/review-branch.sh');
  });

  it.each(scriptTemplates.map((t) => [t.outputPath, t] as const))(
    '%s invokes only managed files',
    (outputPath, template) => {
      const { literal } = siblingRefs(template.content);
      const unmanaged = [...new Set(literal.map((ref) => resolveRef(outputPath, ref)))].filter(
        (p) => !managedPaths.has(p),
      );
      expect(
        unmanaged,
        `${outputPath} invokes ${unmanaged.join(', ')}, which no managed template scaffolds — ` +
          'a consuming repo would get the caller without the callee. Add it to ' +
          'MANAGED_REGION_TEMPLATES (and to gen-ci-templates.mjs SOURCES).',
      ).toEqual([]);
    },
  );

  it.each(scriptTemplates.map((t) => [t.outputPath, t] as const))(
    '%s resolves dynamic references into a directory that IS scaffolded',
    (outputPath, template) => {
      const { dynamic } = siblingRefs(template.content);
      for (const ref of dynamic) {
        // `roles/${ROLE}.md` → the concrete filename is only known at runtime, but the
        // DIRECTORY must still be populated by managed templates or the lookup fails.
        const dir = posix.dirname(resolveRef(outputPath, ref.replace(/\$\{[^}]+\}/g, 'X')));
        const populated = [...managedPaths].some((p) => posix.dirname(p) === dir);
        expect(populated, `${outputPath} reads from ${dir}/, which no managed template fills`).toBe(
          true,
        );
      }
    },
  );

  it('scaffolds approval-provenance.py alongside its caller (the #1026 regression)', () => {
    expect(managedPaths.has('scripts/approval-provenance.py')).toBe(true);
    expect(managedPaths.has('scripts/review-branch.sh')).toBe(true);
  });
});

/**
 * The static check above reads `${SCRIPT_DIR}` references, so it only sees the
 * dependency forms it was taught. It did NOT see that approval-provenance.py
 * `sys.path.insert`s a sibling directory and imports `canonical` from it — a repo
 * scaffolded with the static gate alone still died with ModuleNotFoundError on the
 * first real invocation.
 *
 * So: scaffold the managed set into an empty directory and actually LOAD it. A
 * runtime load is language-agnostic and needs no parser per import syntax — it fails
 * on whatever the script genuinely cannot find, which is the property under test.
 */
describe('the scaffolded set runs standalone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-scaffold-'));

  for (const tpl of MANAGED_REGION_TEMPLATES) {
    const dest = path.join(root, tpl.outputPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, renderManagedFile(tpl), 'utf8');
  }

  it('scaffolds approval-provenance.py and its transitive import', () => {
    // Anti-vacuity: if the render loop ever wrote nothing, the load below would
    // fail for the wrong reason (or the file would be absent and skipped).
    expect(fs.existsSync(path.join(root, 'scripts/approval-provenance.py'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts/hooks/canonical.py'))).toBe(true);
  });

  it('approval-provenance.py imports cleanly with only scaffolded files present', () => {
    // No args → the script prints usage and exits 1, but ONLY after its imports have
    // resolved. An unshipped dependency fails earlier, at module load.
    const run = spawnSync('python3', [path.join(root, 'scripts/approval-provenance.py')], {
      encoding: 'utf8',
      cwd: root,
    });
    const stderr = run.stderr ?? '';
    expect(
      stderr,
      `approval-provenance.py could not load from a freshly scaffolded tree:\n${stderr}`,
    ).not.toMatch(/ModuleNotFoundError|ImportError|No such file or directory/);
    // Positive assertion — it got far enough to reach its own argument handling.
    expect(stderr).toMatch(/Usage/i);
  });
});
