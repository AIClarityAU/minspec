// The corpus rules (SPEC-136 FR-3, design.md "validate: the corpus rules"). Each "Yes" row of
// that table is ONE call to the function the script `scripts/validate-frontmatter.ts` calls,
// reported at the script's severity (`fail` -> error, `warn` -> warning). No rule is defined
// here (FR-2). Rules the table leaves out (epic gate, 12, 19, 24) are absent on purpose.
import * as fs from 'fs';
import * as path from 'path';
import {
  validateDrSequence,
  validateDrIndexStatus,
  validateDrAmendments,
  validatePendingDrAmendments,
  detectDoubledFrontmatter,
} from '../../minspec/src/lib/adr-manager';
import { validateSplitLayoutCoverage, type SplitLayoutFile } from '../../minspec/src/lib/spec-validator';
import { DEFAULT_CONFIG, loadConfig, type Tier } from '../../minspec/src/lib/config';
import { checkReferences, type ReferenceRegistry } from '../../minspec/src/lib/reference-checker';
import { listOrphanedRecords } from '../../minspec/src/lib/approval-store';
import { checkStatusParity, inspectStatusLine, inspectAllStatusClaims } from '../../minspec/src/lib/status-parity';
import { checkManagedRegionMarkers } from '../../minspec/src/lib/scaffold';
import {
  SELF_HOSTED_TEMPLATE_NAMES,
  TEMPLATE_NAMES,
  TEMPLATE_OUTPUT_PATHS,
} from '../../minspec/src/lib/template-registry';
import { detectTools } from '../../minspec/src/lib/tool-detector';
import { buildContext, renderTemplate } from '../../minspec/src/lib/template-engine';
import { parseSections, PREAMBLE_HEADING, detectDoubledTemplateHeadings } from '../../minspec/src/lib/merge-refresh';
import { walkOptionalRoot } from '../../../scripts/lib/corpus-walk';
import { drsMissingPlainTerms } from '../../../scripts/lib/dr-required-sections';
import { checkDeclaredDrIds } from '../../../scripts/lib/dr-id-collision';
import { checkDeclaredSpecIds } from '../../../scripts/lib/spec-id-collision';
import { parseFrontmatter, domainDocFailures, specIdFailure } from '../../../scripts/lib/domain-doc-rules';

export interface CorpusFinding {
  file: string;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Collects findings; `rel` renders a path the way the per-spec pass does (root-relative, `/`). */
class Sink {
  readonly findings: CorpusFinding[] = [];
  constructor(readonly root: string) {}
  rel(file: string): string {
    return path.relative(this.root, file).split(path.sep).join('/') || '.';
  }
  add(rule: string, file: string, severity: 'error' | 'warning', message: string): void {
    this.findings.push({ file: this.rel(file), rule, severity, message });
  }
  /** A rule that could not run says so at the severity its failure would have (invariant 2). */
  unrunnable(rule: string, subject: string, err: unknown, failClosed: boolean, target: string): void {
    this.add(
      `${rule}.unrunnable`,
      target,
      failClosed ? 'error' : 'warning',
      `${subject} (${msg(err)}) - ${rule} validated NOTHING for it; do not read the green as a clean corpus.`,
    );
  }
  /** Files under `dir`; `[]` only for an absent root; a walk that throws is reported. */
  list(rule: string, dir: string, failClosed: boolean, keep: (f: string) => boolean = () => true): string[] {
    try {
      return walkOptionalRoot(dir, '.md').filter(keep);
    } catch (err) {
      this.unrunnable(rule, `the corpus ${this.rel(dir)} could not be listed`, err, failClosed, dir);
      return [];
    }
  }
  each(rule: string, files: readonly string[], failClosed: boolean, fn: (file: string) => void): void {
    for (const file of files) {
      try {
        fn(file);
      } catch (err) {
        this.unrunnable(rule, `${rule} could not run on this file`, err, failClosed, file);
      }
    }
  }
}

/** Run every "Yes" corpus rule over `root`. Never throws; a rule that cannot run is a finding. */
export function runCorpusRules(root: string): CorpusFinding[] {
  const s = new Sink(root);
  const config = loadConfig(root);
  const specsDir = path.join(root, 'specs');
  const decisionsDir = path.join(root, config.decisionsDir);
  const read = (f: string): string => fs.readFileSync(f, 'utf-8');

  // Rule 1+3+4: docs/domain/*.md (FATAL).
  s.each('corpus.domain-doc', s.list('corpus.domain-doc', path.join(root, 'docs', 'domain'), true), true, (file) => {
    for (const m of domainDocFailures(read(file))) s.add('corpus.domain-doc', file, 'error', m);
  });

  // Rule 2: spec `id:` (FATAL). validateSpec only warns on a MISSING id and never checks the format.
  s.each('corpus.spec-id', s.list('corpus.spec-id', specsDir, true), true, (file) => {
    const m = specIdFailure(read(file));
    if (m) s.add('corpus.spec-id', file, 'error', m);
  });

  // Rule 7: split-layout coverage (warn).
  {
    const byDir = new Map<string, SplitLayoutFile[]>();
    s.each('corpus.split-coverage', s.list('corpus.split-coverage', specsDir, false), false, (file) => {
      const fm = parseFrontmatter(read(file));
      const dir = path.dirname(file);
      const tierToken = (fm['tier'] ?? '').split(/\s+/)[0];
      const tier = /^T[1-4]$/.test(tierToken) ? (tierToken as Tier) : undefined;
      const list = byDir.get(dir) ?? [];
      list.push({ type: (fm['type'] ?? '').toLowerCase(), ...(tier ? { tier } : {}) });
      byDir.set(dir, list);
    });
    s.each('corpus.split-coverage', [...byDir.keys()], false, (dir) => {
      for (const v of validateSplitLayoutCoverage(byDir.get(dir) ?? [], DEFAULT_CONFIG).violations) {
        s.add('corpus.split-coverage', dir, 'warning', `split-coverage ${s.rel(dir)}: ${v.message}`);
      }
    });
  }

  // Rule 6: DR sequence health (warn).
  try {
    for (const w of validateDrSequence(decisionsDir)) s.add('corpus.dr-sequence', decisionsDir, 'warning', `DR-sequence: ${w.message}`);
  } catch (err) {
    s.unrunnable('corpus.dr-sequence', 'the DR sequence check could not run', err, false, decisionsDir);
  }

  // Rule 17: DR id collision, offline half (FATAL); also the DR `id:` presence/format check.
  try {
    const drFiles = walkOptionalRoot(decisionsDir, '.md').map((f) => ({ file: s.rel(f), content: read(f) }));
    for (const d of checkDeclaredDrIds(drFiles)) s.add('corpus.dr-id', path.join(root, d.files[0]), 'error', `DR id ${d.kind} - ${d.message}`);
  } catch (err) {
    s.unrunnable('corpus.dr-id', 'the DR id uniqueness check could not run', err, false, decisionsDir);
  }

  // Rule 20: `## In plain terms` (warn).
  try {
    const drs = walkOptionalRoot(decisionsDir, '.md').map((f) => ({ file: s.rel(f), content: read(f) }));
    for (const f of drsMissingPlainTerms(drs)) {
      s.add('corpus.dr-plain-terms', path.join(root, f), 'warning', `${f}: decision record lacks a \`## In plain terms\` section (#2921).`);
    }
  } catch (err) {
    s.unrunnable('corpus.dr-plain-terms', 'the DR required-section check could not run', err, false, decisionsDir);
  }

  // Rule 18: spec id collision (FATAL).
  try {
    const specFiles = walkOptionalRoot(specsDir, '.md')
      .filter((f) => f.endsWith('requirements.md'))
      .map((f) => ({ file: s.rel(f), content: read(f) }));
    for (const d of checkDeclaredSpecIds(specFiles)) s.add('corpus.spec-id-collision', path.join(root, d.files[0]), 'error', `Spec id ${d.kind} - ${d.message}`);
  } catch (err) {
    s.unrunnable('corpus.spec-id-collision', 'the spec id uniqueness check could not run', err, false, specsDir);
  }

  // Rule 8: INDEX.md status vs DR status (FATAL).
  try {
    for (const d of validateDrIndexStatus(decisionsDir)) {
      s.add('corpus.dr-index-status', path.join(decisionsDir, 'INDEX.md'), 'error', `DR-index status drift - ${d.message}`);
    }
  } catch (err) {
    s.unrunnable('corpus.dr-index-status', 'the DR index status check could not run', err, true, path.join(decisionsDir, 'INDEX.md'));
  }

  // Rule 16 (FATAL) and its advisory twin (warn): an amendment the target never mentions.
  try {
    for (const g of validateDrAmendments(decisionsDir)) {
      s.add('corpus.dr-amendment', path.join(decisionsDir, `${g.target}.md`), 'error', `DR amendment not carried out - ${g.message}`);
    }
  } catch (err) {
    s.unrunnable('corpus.dr-amendment', 'the DR-amendment check could not run', err, false, decisionsDir);
  }
  try {
    for (const g of validatePendingDrAmendments(decisionsDir)) {
      s.add(
        'corpus.dr-amendment-pending',
        path.join(decisionsDir, `${g.target}.md`),
        'warning',
        `DR amendment pending - ${g.source} (proposed) ${g.relation} ${g.target}, but ${g.target} never mentions ${g.source}.`,
      );
    }
  } catch (err) {
    s.unrunnable('corpus.dr-amendment-pending', 'the pending DR-amendment check could not run', err, false, decisionsDir);
  }

  // Rule 9: dangling references (warn).
  referenceRule(s, specsDir, decisionsDir);

  // Rule 10: orphaned approval sidecars (warn).
  try {
    for (const o of listOrphanedRecords(root)) {
      s.add('corpus.orphaned-approval', o.sidecarFile, 'warning', `orphaned approval sidecar for "${o.specPath}" (no longer an approvable spec)`);
    }
  } catch (err) {
    s.unrunnable('corpus.orphaned-approval', 'the orphaned-approval check could not run', err, false, root);
  }

  // Rule 11 (FATAL) and 11b (warn): body status line vs frontmatter `status:`.
  {
    const files: { file: string; kind: 'spec' | 'dr' }[] = [
      ...s.list('corpus.status-parity', specsDir, true).map((file) => ({ file, kind: 'spec' as const })),
      ...s.list('corpus.status-parity', decisionsDir, true).map((file) => ({ file, kind: 'dr' as const })),
    ];
    const kindOf = new Map(files.map((p) => [p.file, p.kind] as const));
    const unreadable: string[] = [];
    s.each('corpus.status-parity', files.map((p) => p.file), true, (file) => {
      const kind = kindOf.get(file) as 'spec' | 'dr';
      const content = read(file);
      const fm = parseFrontmatter(content);
      const finding = checkStatusParity(content, fm.status, kind);
      if (finding) {
        s.add(
          'corpus.status-parity',
          file,
          'error',
          `status parity (#626) - frontmatter \`status: ${finding.frontmatter}\` disagrees with the body status line "${finding.body}" (line ${finding.line}).`,
        );
      }
      const fmToken = (fm.status ?? '').trim().split(/\s+/)[0]?.replace(/#.*$/, '').toLowerCase();
      if (fmToken) {
        for (const claim of inspectAllStatusClaims(content, kind)) {
          if (claim.kind !== 'comparable' || claim.token === fmToken) continue;
          if (finding && finding.line === claim.line) continue;
          s.add(
            'corpus.status-parity',
            file,
            'error',
            `status parity (#1223) - frontmatter \`status: ${fmToken}\` disagrees with a SECOND status claim "${claim.token}" (line ${claim.line}).`,
          );
        }
      }
      const shape = inspectStatusLine(content, kind);
      if (shape.kind === 'unparseable') unreadable.push(`${s.rel(file)}:${shape.line} "${shape.text}"`);
    });
    if (unreadable.length > 0) {
      s.add(
        'corpus.status-parity-unreadable',
        root,
        'warning',
        `status parity (#968) - ${unreadable.length} status line(s) exist but could not be read, so rule 11 is NOT checking them: ${unreadable.slice(0, 5).join('; ')}`,
      );
    }
  }

  // Rule 14: managed-region markers (FATAL when the body diverged, warn when auto-healable).
  try {
    for (const v of checkManagedRegionMarkers(root, detectTools(root), { exclude: SELF_HOSTED_TEMPLATE_NAMES })) {
      s.add('corpus.managed-region', path.join(root, v.outputPath), v.severity === 'error' ? 'error' : 'warning', v.message);
    }
  } catch (err) {
    s.unrunnable('corpus.managed-region', 'the managed-region marker check could not run', err, false, root);
  }

  // Rule 20b: doubled frontmatter in decision and epic records (warn).
  for (const { dir, label } of [
    { dir: decisionsDir, label: 'decision' },
    { dir: path.join(root, 'docs', 'epics'), label: 'epic' },
  ]) {
    s.each('corpus.doubled-frontmatter', s.list('corpus.doubled-frontmatter', dir, false), false, (file) => {
      const f = detectDoubledFrontmatter(read(file));
      if (f) {
        s.add(
          'corpus.doubled-frontmatter',
          file,
          'warning',
          `doubled-frontmatter ${s.rel(file)}: this ${label} record carries TWO frontmatter-shaped blocks - the first closes at line ${f.firstBlockEndLine}, and a second \`---\` block opens at line ${f.secondBlockStartLine} (#2467).`,
        );
      }
    });
  }

  // Rule 21: a template heading occurring twice in a generated harness file (warn).
  try {
    const context = buildContext(root, config);
    for (const name of TEMPLATE_NAMES) {
      const outputPath = path.join(root, TEMPLATE_OUTPUT_PATHS[name]);
      if (!fs.existsSync(outputPath)) continue;
      try {
        const headings = parseSections(renderTemplate(name, context))
          .map((h) => h.heading)
          .filter((h) => h !== PREAMBLE_HEADING);
        const doubled = detectDoubledTemplateHeadings(read(outputPath), headings);
        if (doubled.length > 0) {
          const more = doubled.length > 5 ? ` (+${doubled.length - 5} more)` : '';
          s.add(
            'corpus.doubled-sections',
            outputPath,
            'warning',
            `doubled-sections ${s.rel(outputPath)}: ${doubled.length} template heading(s) appear twice - ${doubled.slice(0, 5).join(', ')}${more} (#2467).`,
          );
        }
      } catch (err) {
        s.unrunnable('corpus.doubled-sections', 'the doubled-section check could not run on this file', err, false, outputPath);
      }
    }
  } catch (err) {
    s.unrunnable('corpus.doubled-sections', 'the harness-file doubled-section check could not run', err, false, root);
  }

  return s.findings;
}

/** Rule 9: the registry the dangling-reference checker resolves against, then the scan. */
function referenceRule(s: Sink, specsDir: string, decisionsDir: string): void {
  const root = s.root;
  const read = (f: string): string => fs.readFileSync(f, 'utf-8');
  const registry: ReferenceRegistry = { specs: new Set(), decisions: new Set(), epics: new Set(), fileExists: () => false };
  try {
    for (const file of walkOptionalRoot(specsDir, '.md')) {
      try {
        const id = parseFrontmatter(read(file))['id'];
        if (id && /^SPEC-\d+$/.test(id)) registry.specs.add(id);
      } catch (err) {
        s.unrunnable('corpus.reference', 'the reference registry could not read this spec', err, false, file);
      }
      for (const seg of s.rel(file).split('/')) {
        const m = seg.match(/^(SPEC-\d+)/);
        if (m) registry.specs.add(m[1]);
      }
    }
    for (const file of walkOptionalRoot(decisionsDir, '.md')) {
      const m = path.basename(file).match(/^(DR-\d+)/);
      if (m) registry.decisions.add(m[1]);
    }
    for (const file of walkOptionalRoot(path.join(root, 'docs', 'epics'), '.md')) {
      try {
        const id = parseFrontmatter(read(file))['id'];
        if (id && /^EPIC-\d+$/.test(id)) registry.epics.add(id);
      } catch (err) {
        s.unrunnable('corpus.reference', 'the reference registry could not read this epic', err, false, file);
      }
      const m = path.basename(file).match(/^(EPIC-\d+)/);
      if (m) registry.epics.add(m[1]);
    }
  } catch (err) {
    s.unrunnable('corpus.reference', 'the reference registry could not be built', err, false, root);
    return;
  }
  const files = [...s.list('corpus.reference', specsDir, false), ...s.list('corpus.reference', decisionsDir, false)];
  s.each('corpus.reference', files, false, (file) => {
    const dir = path.dirname(file);
    const scoped: ReferenceRegistry = {
      ...registry,
      fileExists: (rel) => fs.existsSync(path.join(dir, rel)) || fs.existsSync(path.join(root, rel)),
    };
    for (const v of checkReferences(read(file), scoped)) {
      s.add('corpus.reference', file, 'warning', `ref-check ${s.rel(file)}: ${v.message}`);
    }
  });
}

