// The operation table (SPEC-136 design: "The operation table"). One entry per operation; no
// entry holds a rule of its own (FR-2) - each calls the library function the extension calls.
// `validate`, `hash`, `status` and `next` are wired so far; later SPEC-136 tasks add the rest to the same table.
import * as fs from 'fs';
import * as path from 'path';
import { specHash } from '@aiclarity/shared';
import {
  approveSpec,
  checkApprover,
  getApprovalRecord,
  getApprovalStatus,
  gitConfigEmail,
  parseAgentIdentities,
} from '../../minspec/src/lib/approval';
import { assertOwnershipDeclaredForAdvance } from '../../minspec/src/lib/ownership-advance-guard';
import { isTerminalSpecStatus } from '../../minspec/src/lib/spec-vocabulary';
import { formatNextTaskLabel, resolveNextTask } from '../../shared/src/next-task';
import { buildArtifactGraph } from '../../minspec/src/lib/artifact-graph';
import { approvalAdvancesPhaseMap, deriveStatus, explicitTerminalOf } from '../../minspec/src/lib/lifecycle';
import { advanceSpecToImplementing, parseSpec, readSpecFile } from '../../minspec/src/lib/spec';
import { loadConfig } from '../../minspec/src/lib/config';
import { epicRefSet } from '../../minspec/src/lib/epic-manager';
import { readShardIdFiles } from '../../minspec/src/lib/spec-layout';
import { validateSpec } from '../../minspec/src/lib/spec-validator';
import { listSpecs } from '../../minspec/src/lib/spec-catalog';
import { runCorpusRules } from './corpus-rules';
import { hasOptInMarker, notOptedInMessage } from '../../minspec/src/lib/opt-in';

declare const __MINSPEC_CORE_VERSION__: string | undefined;

/** The stamped build version, or `0.0.0+unstamped` when the bundle was not built by buildCore. */
export function coreVersion(): string {
  return typeof __MINSPEC_CORE_VERSION__ === 'string' ? __MINSPEC_CORE_VERSION__ : '0.0.0+unstamped';
}

export type Effect = 'read-only' | 'git-config' | 'approval';
export type Outcome = 'pass' | 'fail' | 'refused' | 'error';
export type RefusalCode =
  | 'not-a-minspec-project'
  | 'unknown-operation'
  | 'bad-argument'
  | 'spec-outside-project'
  | 'already-approved'
  | 'terminal-status'
  | 'incomplete'
  | 'not-ready-for-advance'
  | 'approver-denied';

export interface Finding {
  file: string;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  fixHint?: string;
}

export interface CoreResult<T = unknown> {
  schema: 'minspec-core/0';
  coreVersion: string;
  operation: string;
  root: string;
  authority: 'advice';
  outcome: Outcome;
  data?: T;
  findings?: Finding[];
  refusal?: { code: RefusalCode; message: string };
  error?: { message: string; file?: string };
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, { type: 'string'; description: string }>;
  required?: string[];
  additionalProperties: false;
}

/** What a run returns before the envelope fields are stamped on. */
export type OperationReturn = Omit<CoreResult, 'schema' | 'coreVersion' | 'operation' | 'root' | 'authority'>;

export interface CoreContext {
  root: string;
}

export interface Operation {
  name: 'validate' | 'hash' | 'status' | 'next' | 'activate' | 'approve';
  summary: string;
  input: JsonSchemaObject;
  effect: Effect;
  run(ctx: CoreContext, args: Record<string, unknown>): Promise<OperationReturn>;
}

/** Derived, never stored: a tool cannot be listed without a declaration (FR-26). */
export const toolAnnotations = (op: Operation) => ({
  readOnlyHint: op.effect === 'read-only',
  destructiveHint: op.effect !== 'read-only',
});

/** Derived, never stored: approve can never become a tool (FR-20). */
export const offeredAsTool = (op: Operation): boolean => op.effect !== 'approval';

/** Exit codes (FR-9): every non-pass outcome is non-zero. */
export const EXIT_CODES: Record<Outcome, number> = { pass: 0, fail: 1, refused: 2, error: 3 };

/** The opt-in refusal (FR-8): a folder without `.minspec/` is refused, never reported clean. */
export function requireOptedIn(root: string): OperationReturn | null {
  if (hasOptInMarker(root)) return null;
  return { outcome: 'refused', refusal: { code: 'not-a-minspec-project', message: notOptedInMessage(root) } };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const hashOperation: Operation = {
  name: 'hash',
  summary: 'Approval hash of one spec file, with its recorded approval status',
  input: {
    type: 'object',
    properties: { spec: { type: 'string', description: 'Path of the spec file, relative to the project root' } },
    required: ['spec'],
    additionalProperties: false,
  },
  effect: 'read-only',
  async run(ctx, args) {
    const spec = args.spec;
    if (typeof spec !== 'string' || spec === '') {
      return { outcome: 'refused', refusal: { code: 'bad-argument', message: 'hash needs --spec <path>' } };
    }
    const file = path.resolve(ctx.root, spec);
    const rel = path.relative(ctx.root, file);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return {
        outcome: 'refused',
        refusal: { code: 'spec-outside-project', message: `${spec} is outside the project root ${ctx.root}` },
      };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      return { outcome: 'error', error: { message: errorMessage(e), file } };
    }
    const record = getApprovalRecord(ctx.root, file);
    return {
      outcome: 'pass',
      data: {
        spec: rel.split(path.sep).join('/'),
        hash: specHash(raw),
        ...(record ? { approvedHash: record.specHash } : {}),
        approval: getApprovalStatus(ctx.root, file),
      },
    };
  },
};

const noArgs: JsonSchemaObject = { type: 'object', properties: {}, additionalProperties: false };

const statusOperation: Operation = {
  name: 'status',
  summary: 'Each spec\'s derived status, with its approval state',
  input: noArgs,
  effect: 'read-only',
  async run(ctx) {
    const specs = listSpecs(ctx.root).map((s) => {
      // Same derivation as buildArtifactGraph: the literal `status:` line is never the answer.
      const fm = parseSpec(fs.readFileSync(s.filePath, 'utf8')).frontmatter;
      const approval = getApprovalStatus(ctx.root, s.filePath);
      return {
        id: s.id,
        title: s.title,
        tier: s.tier,
        status: deriveStatus(fm.phases, approval, explicitTerminalOf(fm.status)),
        literalStatus: fm.status,
        approval,
        currentPhase: s.currentPhase,
        file: path.relative(ctx.root, s.filePath).split(path.sep).join('/'),
      };
    });
    return { outcome: 'pass', data: { specs } };
  },
};

const nextOperation: Operation = {
  name: 'next',
  summary: 'The one next human action for this project',
  input: noArgs,
  effect: 'read-only',
  async run(ctx) {
    const task = resolveNextTask(buildArtifactGraph(ctx.root));
    return { outcome: 'pass', data: { task, label: formatNextTaskLabel(task) } };
  },
};

const validateOperation: Operation = {
  name: 'validate',
  summary: 'Completeness findings for every spec, from the same validator the extension runs',
  input: noArgs,
  effect: 'read-only',
  async run(ctx) {
    const config = loadConfig(ctx.root);
    const knownEpicRefs = epicRefSet(ctx.root);
    const findings: Finding[] = [];
    for (const s of listSpecs(ctx.root)) {
      const file = path.relative(ctx.root, s.filePath).split(path.sep).join('/');
      try {
        const parsed = readSpecFile(s.filePath);
        // Same option assembly as commands/validate.ts: the rules live in validateSpec (FR-2).
        const result = validateSpec(parsed, config, {
          knownEpicRefs,
          approvalState: getApprovalStatus(ctx.root, s.filePath),
          explicitTerminal: explicitTerminalOf(parsed.frontmatter.status),
          siblingShardFiles: readShardIdFiles(path.dirname(s.filePath)),
          pathExists: (relPath) => fs.existsSync(path.join(ctx.root, relPath)),
        });
        for (const v of result.violations) {
          findings.push({ file, rule: v.rule, severity: v.severity, message: v.message, fixHint: v.fixHint });
        }
      } catch (e) {
        findings.push({ file, rule: 'spec.unreadable', severity: 'error', message: `Cannot read ${file} - ${errorMessage(e)}` });
      }
    }
    // The corpus rules (FR-3): one call per "Yes" row of design.md, at the script's severity.
    for (const c of runCorpusRules(ctx.root)) findings.push(c);
    const failed = findings.some((f) => f.severity === 'error');
    return { outcome: failed ? 'fail' : 'pass', findings };
  },
};

const refuse = (code: RefusalCode, message: string): OperationReturn => ({ outcome: 'refused', refusal: { code, message } });

/**
 * FR-19: the editor's approve sequence (commands/approve.ts) with the UI removed, in its order.
 * No commit and no phase-advance enqueue: those are editor preferences, and the queue writes a
 * record FR-25 forbids. Step 1 (opt-in) is also enforced by runOperation; repeated so the
 * entry is safe to call on its own.
 */
const approveOperation: Operation = {
  name: 'approve',
  summary: 'Record a human approval of one spec (never offered as a tool; refuses agent identities)',
  input: {
    type: 'object',
    properties: { spec: { type: 'string', description: 'Spec file path (relative to the project root) or spec id' } },
    required: ['spec'],
    additionalProperties: false,
  },
  effect: 'approval',
  async run(ctx, args) {
    const optIn = requireOptedIn(ctx.root);
    if (optIn) return optIn;
    const ref = args.spec;
    if (typeof ref !== 'string' || ref === '') return refuse('bad-argument', 'approve needs --spec <path|id>');
    const specs = listSpecs(ctx.root);
    const asPath = path.resolve(ctx.root, ref);
    const rel = path.relative(ctx.root, asPath);
    let summary = specs.find((s) => path.resolve(s.filePath) === asPath);
    if (!summary) {
      summary = specs.find((s) => s.id === ref);
    }
    if (!summary) {
      if (fs.existsSync(asPath) && (rel === '' || rel.startsWith('..') || path.isAbsolute(rel))) {
        return refuse('spec-outside-project', `${ref} is outside the project root ${ctx.root}`);
      }
      return refuse('bad-argument', `no spec matches ${ref}`);
    }
    const file = summary.filePath;
    const parsed = readSpecFile(file);
    // 2. Already approved / terminal: the editor's picker filter.
    if (getApprovalStatus(ctx.root, file) === 'approved') return refuse('already-approved', `${summary.id} is already approved`);
    if (isTerminalSpecStatus(parsed.frontmatter.status)) {
      return refuse('terminal-status', `${summary.id} has status ${parsed.frontmatter.status}, past the approve-before-implement gate`);
    }
    // 3. Completeness, with the approve command's options.
    const result = validateSpec(parsed, loadConfig(ctx.root), {
      knownEpicRefs: epicRefSet(ctx.root),
      siblingShardFiles: readShardIdFiles(path.dirname(file)),
      pathExists: (relPath) => fs.existsSync(path.join(ctx.root, relPath)),
    });
    if (!result.complete) {
      const relFile = path.relative(ctx.root, file).split(path.sep).join('/');
      const findings: Finding[] = result.violations
        .filter((v) => v.severity === 'error')
        .map((v) => ({ file: relFile, rule: v.rule, severity: v.severity, message: v.message, fixHint: v.fixHint }));
      return { ...refuse('incomplete', `${summary.id} is not complete - approval refused`), findings };
    }
    // 4. What the advance would introduce - only for a spec this approval will advance.
    const advances = approvalAdvancesPhaseMap(parsed.frontmatter.status);
    if (advances) {
      try {
        assertOwnershipDeclaredForAdvance(file, parsed);
      } catch (e) {
        return refuse('not-ready-for-advance', errorMessage(e));
      }
    }
    // 5. Approver identity: the clone's git user.email, checked before any write.
    const email = gitConfigEmail(ctx.root);
    const check = checkApprover(email, parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES));
    if (!check.ok) return refuse('approver-denied', `Approval refused for ${summary.id} - ${check.reason}`);
    // 6. Status/phases mirror, only from a pre-implementation status.
    if (advances) advanceSpecToImplementing(file);
    // 7. The record.
    const record = approveSpec(ctx.root, file, summary.tier, email);
    const specRel = path.relative(ctx.root, file).split(path.sep).join('/');
    return {
      outcome: 'pass',
      data: { spec: specRel, record, status: getApprovalStatus(ctx.root, file) },
    };
  },
};

export const OPERATIONS: readonly Operation[] = [
  validateOperation,
  hashOperation,
  statusOperation,
  nextOperation,
  approveOperation,
];

/** Run one operation and wrap its return in the stamped envelope. Never throws. */
export async function runOperation(op: Operation, root: string, args: Record<string, unknown>): Promise<CoreResult> {
  let ret: OperationReturn;
  try {
    ret = requireOptedIn(root) ?? (await op.run({ root }, args));
  } catch (e) {
    ret = { outcome: 'error', error: { message: errorMessage(e) } };
  }
  return { schema: 'minspec-core/0', coreVersion: coreVersion(), operation: op.name, root, authority: 'advice', ...ret };
}

/** An envelope for a request that never reached an operation (unknown name, bad flag). */
export function refusedResult(operation: string, root: string, code: RefusalCode, message: string): CoreResult {
  return {
    schema: 'minspec-core/0',
    coreVersion: coreVersion(),
    operation,
    root,
    authority: 'advice',
    outcome: 'refused',
    refusal: { code, message },
  };
}
