// The operation table (SPEC-136 design: "The operation table"). One entry per operation; no
// entry holds a rule of its own (FR-2) - each calls the library function the extension calls.
// `hash`, `status` and `next` are wired so far; later SPEC-136 tasks add the rest to the same table.
import * as fs from 'fs';
import * as path from 'path';
import { specHash } from '@aiclarity/shared';
import { getApprovalRecord, getApprovalStatus } from '../../minspec/src/lib/approval';
import { formatNextTaskLabel, resolveNextTask } from '../../shared/src/next-task';
import { buildArtifactGraph } from '../../minspec/src/lib/artifact-graph';
import { deriveStatus, explicitTerminalOf } from '../../minspec/src/lib/lifecycle';
import { parseSpec } from '../../minspec/src/lib/spec';
import { listSpecs } from '../../minspec/src/lib/spec-catalog';
import { hasOptInMarker, notOptedInMessage } from '../../minspec/src/lib/opt-in';

declare const __MINSPEC_CORE_VERSION__: string | undefined;

/** The stamped build version, or `0.0.0+unstamped` when the bundle was not built by buildCore. */
export function coreVersion(): string {
  return typeof __MINSPEC_CORE_VERSION__ === 'string' ? __MINSPEC_CORE_VERSION__ : '0.0.0+unstamped';
}

export type Effect = 'read-only' | 'git-config' | 'approval';
export type Outcome = 'pass' | 'fail' | 'refused' | 'error';
export type RefusalCode = 'not-a-minspec-project' | 'unknown-operation' | 'bad-argument' | 'spec-outside-project';

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

export const OPERATIONS: readonly Operation[] = [hashOperation, statusOperation, nextOperation];

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
