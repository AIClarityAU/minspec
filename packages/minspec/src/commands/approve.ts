import * as path from 'path';
import * as vscode from 'vscode';
import { listSpecs, type SpecSummary } from '../views/spec-tree-provider';
import { readSpecFile, advanceSpecToImplementing } from '../lib/spec';
import { loadConfig } from '../lib/config';
import { validateSpec } from '../lib/spec-validator';
import { epicRefSet } from '../lib/epic-manager';
import { readShardIdFiles } from '../lib/spec-layout';
import {
  approveSpec as recordApproval,
  revokeApproval as removeApproval,
  getApprovalStatus,
  gitConfigEmail,
  checkApprover,
  parseAgentIdentities,
  specRelPath,
  type ApprovalStatus,
} from '../lib/approval';
import { sidecarPath } from '../lib/approval-store';
import { resolveActiveSpecId } from '../lib/active-spec';
import { folderForFile, resolveTargetFolder } from '../lib/resolve-folder';
import { commitApprovalIfEnabled } from './commit-on-approve';
import { enqueuePhaseAdvance } from '../lib/phase-advance-queue';

/** A tree node carrying a SpecSummary (from the spec tree context menu). */
interface SpecNodeLike {
  readonly spec?: SpecSummary;
}

interface PickOptions {
  /** Keep a spec in the list only when its approval status passes this. */
  include: (status: ApprovalStatus) => boolean;
  /** Shown when specs exist but none survive the `include` filter. */
  emptyMessage: string;
}

/**
 * Resolve which spec to act on: from a tree node, else a quick-pick.
 *
 * The quick-pick is filtered by approval status so each command only offers
 * specs the action makes sense for — Approve hides already-approved specs,
 * Revoke hides unapproved ones. A tree-node invocation bypasses the filter: the
 * user picked that exact spec from the tree, so honour it.
 */
async function pickSpec(
  rootDir: string,
  node: SpecNodeLike | undefined,
  placeholder: string,
  opts: PickOptions,
): Promise<SpecSummary | undefined> {
  if (node?.spec) return node.spec;

  const specs = listSpecs(rootDir);
  if (specs.length === 0) {
    vscode.window.showInformationMessage('MinSpec: No specs found.');
    return undefined;
  }
  const openId = resolveActiveSpecId();
  const items = specs
    .map((s) => ({ spec: s, status: getApprovalStatus(rootDir, s.filePath) }))
    .filter((x) => opts.include(x.status))
    .map(({ spec, status }) => ({
      label: `${spec.id}: ${spec.title}`,
      description: `${spec.tier} · ${status}${spec.id === openId ? ' · open' : ''}`,
      spec,
    }));
  if (items.length === 0) {
    vscode.window.showInformationMessage(opts.emptyMessage);
    return undefined;
  }
  // Float the currently-open spec to the top so it is the default selection
  // (showQuickPick highlights the first item; Enter picks it).
  const openIdx = items.findIndex((i) => i.spec.id === openId);
  if (openIdx > 0) items.unshift(items.splice(openIdx, 1)[0]);

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: placeholder,
    ignoreFocusOut: true,
  });
  return picked?.spec;
}

/**
 * Resolve the approver's identity for the DR-056 gate. Prefers the user-scoped
 * `minspec.approverEmail` setting (the human's EXPLICIT identity, which follows
 * them across repos) over the ambient `git config user.email` — because this
 * repo's container commits author as the bot (DR-056), so the ambient identity is
 * the bot and would be denied. Falls back to `gitConfigEmail` when the setting is
 * unset/blank, preserving the pre-DR-056 behaviour for repos whose git identity is
 * already the human's. Tier-0/offline: `gitConfigEmail` reads local git config only.
 */
function resolveApproverEmail(rootDir: string): string {
  const configured = (
    vscode.workspace.getConfiguration('minspec').get<string>('approverEmail') ?? ''
  ).trim();
  return configured || gitConfigEmail(rootDir);
}

const ADVANCE_PHASE = 'Advance to next phase';
const ALWAYS = 'Always';

/**
 * Persisted "always enqueue a phase-advance request on approve" opt-in
 * (DR-057 §3). Written GLOBALLY: it's a personal workflow preference, not
 * project policy, so it follows the user across every project — same pattern
 * as `minspec.autoBackfillUseAi` (backfill-epics.ts).
 */
function advancePhaseOnApproveEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('minspec')
    .get<boolean>('advancePhaseOnApprove', false);
}
/**
 * Persist the "Always" choice. Never lets a pref-write failure surface as an
 * approval failure — same non-blocking contract as `enqueuePhaseAdvanceSafely`
 * below, and for the same reason: the approval itself already succeeded by the
 * time this runs, so a config-write error here must not throw into
 * `approveSpecCommand`'s catch and paint a false "Failed to approve" toast.
 */
async function enableAdvancePhaseOnApprove(): Promise<void> {
  try {
    await vscode.workspace
      .getConfiguration('minspec')
      .update('advancePhaseOnApprove', true, vscode.ConfigurationTarget.Global);
  } catch (err) {
    console.warn(`MinSpec: failed to persist advancePhaseOnApprove pref — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Enqueue the LLM-free phase-advance request (DR-057 §3 / #733) — writes only
 * a request file to `.minspec/queue/`; MUST NOT run `claude -p` (Tier-0
 * air-gap) and must not block on generation. A downstream consumer
 * (#732/#734/#735, not built here) dequeues it. Never lets a queue-write
 * failure surface as an approval failure — the approval itself already
 * succeeded by the time this runs.
 */
function enqueuePhaseAdvanceSafely(rootDir: string, specRel: string): void {
  try {
    enqueuePhaseAdvance(rootDir, specRel, 'alt-a-toast');
  } catch (err) {
    console.warn(`MinSpec: phase-advance enqueue failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Act on the follow-up toast's choice. "Always" additionally persists the
 * global pref so future approvals skip asking.
 */
async function handleAdvancePhaseChoice(
  rootDir: string,
  specRel: string,
  choice: string | undefined,
): Promise<void> {
  if (choice !== ADVANCE_PHASE && choice !== ALWAYS) return;
  if (choice === ALWAYS) await enableAdvancePhaseOnApprove();
  enqueuePhaseAdvanceSafely(rootDir, specRel);
}

/**
 * Command: Approve a spec for implementation.
 * Runs the completeness validator first — refuses approval if it has errors.
 */
export async function approveSpecCommand(
  node?: SpecNodeLike,
  state?: vscode.Memento,
): Promise<void> {
  // Multi-root safe: prefer the active editor's folder, else prompt (#123, #373).
  // A tree-node invocation carries the spec's file path, so we can pin the root
  // to the folder actually containing it — no prompt when the artifact is known.
  const rootDir = node?.spec?.filePath
    ? folderForFile(node.spec.filePath) ?? (await resolveTargetFolder())
    : await resolveTargetFolder();
  if (!rootDir) return;

  const spec = await pickSpec(rootDir, node, 'Select a spec to approve for implementation', {
    // Already-approved specs have nothing to do here; stale ones (edited since
    // approval) still need re-approval, so keep them.
    include: (status) => status !== 'approved',
    emptyMessage: 'MinSpec: No specs awaiting approval — all are already approved.',
  });
  if (!spec) return;

  let parsed;
  try {
    parsed = readSpecFile(spec.filePath);
  } catch (err) {
    vscode.window.showErrorMessage(
      `MinSpec: Cannot read ${spec.id} — ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const config = loadConfig(rootDir);
  const result = validateSpec(parsed, config, {
    knownEpicRefs: epicRefSet(rootDir),
    // #439: sibling shard files (design.md/tasks.md/…) in this spec's directory,
    // so a diverging shard id refuses approval as an error.
    siblingShardFiles: readShardIdFiles(path.dirname(spec.filePath)),
  });
  const errors = result.violations.filter((v) => v.severity === 'error');
  const warnings = result.violations.filter((v) => v.severity === 'warning');

  if (!result.complete) {
    // Refuse. Surface the blocking violations and offer to open the spec.
    const summary = errors.map((e) => `• ${e.message}`).join('\n');
    const choice = await vscode.window.showErrorMessage(
      `MinSpec: ${spec.id} is not complete — approval refused.\n\n${summary}`,
      { modal: true, detail: errors.map((e) => `${e.message}\n   ↳ ${e.fixHint}`).join('\n\n') },
      'Open Spec',
    );
    if (choice === 'Open Spec') {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(spec.filePath));
      await vscode.window.showTextDocument(doc);
    }
    return;
  }

  // DR-056 Decision 2: agent-proof approver gate — resolve the approver's identity
  // and refuse BEFORE any status flip if it isn't a provable human. `approverEmail`
  // (a user-scoped setting) is the human's EXPLICIT identity, used in preference to
  // the ambient `git config user.email` — because this repo's container commits
  // author as the bot (DR-056 Decisions 1/3), so the ambient identity is the bot
  // and would (correctly) be denied. A human sets `minspec.approverEmail` once and
  // approves under it; the commit that persists the approval is still bot-authored
  // tooling. The lib (`recordApproval`) re-checks — this pre-check only buys the
  // friendlier message and stops the flip from running for a denied identity.
  const email = resolveApproverEmail(rootDir);
  const approverCheck = checkApprover(
    email,
    parseAgentIdentities(process.env.MINSPEC_AGENT_IDENTITIES),
  );
  if (!approverCheck.ok) {
    await vscode.window.showErrorMessage(
      `MinSpec: Approval refused for ${spec.id} — ${approverCheck.reason}.`,
      {
        modal: true,
        detail:
          'DR-056: an approval must be an explicit human act, so MinSpec will not record it under an ' +
          'agent/bot or absent identity. Set "minspec.approverEmail" to your human email (Settings), ' +
          'or approve from a checkout whose git identity is yours — then re-run Approve.',
      },
    );
    return;
  }

  // Complete — approve directly. Selecting "Approve Spec" and picking this spec
  // IS the explicit act (DR-012); a second confirmation modal is redundant
  // friction (#104). Hard-blocking errors already stopped above; warnings never
  // gate approval — they are surfaced non-modally below, never as a focus-stealing
  // approve-anyway dialog (HITL: advisory over the visible artifact).
  try {
    // SPEC-022 (FR-3): the approval hash is canonical and EXCLUDES the lifecycle
    // fields, so the status flip no longer affects it — the old flip-then-hash
    // ordering dance is gone (ordering is now free). The literal `status:` line is
    // a tool-written mirror of the derived status; write it on approval. Guard:
    // only advance from a pre-implementation status — never downgrade done/archived
    // or re-flip an already-implementing spec being re-approved after an edit.
    // advanceSpecToImplementing also advances the `phases:` map (when present) so
    // the status line and the phases-derived status cannot diverge (#148).
    const wasPreImpl =
      parsed.frontmatter.status === 'new' || parsed.frontmatter.status === 'specifying';
    // mirror; phases-aware, no longer affects the hash. Returns the new derived status
    // (DR-067 / #886: 'planning' when the implement phase hasn't started, else 'implementing').
    const newStatus = wasPreImpl ? advanceSpecToImplementing(spec.filePath) : undefined;
    recordApproval(rootDir, spec.filePath, spec.tier, email);

    // Commit-on-approve (SPEC-022 FR-1): the flipped doc + attributed record
    // become ONE real commit so an approval is never left uncommitted in the
    // working tree (the Alt+A nuisance — project memory project_alt_a_no_autocommit).
    // Gated by `minspec.commitOnApprove` (default on); pathspec-safe (never bundles
    // another session's staged files). The suffix folds the commit outcome into the
    // single approval toast below.
    const specRel = specRelPath(rootDir, spec.filePath);
    const sidecar = sidecarPath(rootDir, specRel);
    const { suffix: commitSuffix } = await commitApprovalIfEnabled(
      rootDir,
      [spec.filePath, sidecar],
      `chore(approve): ${spec.id} approved for implementation`,
    );

    const base =
      (wasPreImpl
        ? `MinSpec: ✓ Approved ${spec.id} for implementation (status → ${newStatus ?? 'planning'}).`
        : `MinSpec: ✓ Approved ${spec.id} for implementation.`) + commitSuffix;

    // Refresh the tree BEFORE the follow-up toast: the toast carries action
    // buttons, so it persists on screen until the user dismisses it (an
    // `await` on it blocks well past the approval itself). A re-approval with
    // no `status:` change (sidecar under unwatched `.minspec/approvals/`) has
    // no other trigger for the tree's approval decoration to update, so it must
    // not wait on the toast's resolution.
    await vscode.commands.executeCommand('minspec.refreshTree');

    // DR-057 §3 follow-up toast: offer to enqueue a phase-advance request (or,
    // once the global pref is set, do it silently — no re-asking). Enqueue-only,
    // LLM-free: this never runs `claude -p` itself (Tier-0 air-gap); a downstream
    // consumer (#732/#734/#735) dequeues and generates.
    const alwaysAdvance = advancePhaseOnApproveEnabled();
    if (warnings.length > 0) {
      // Non-modal advisory: approved, but the gaps are surfaced so they are not
      // silently swallowed (never-wrong). Not a modal, not a blocking gate.
      const n = warnings.length;
      const warnText = `${base} ${n} advisory ${n === 1 ? 'warning' : 'warnings'} — ${warnings
        .map((w) => w.message)
        .join(' ')}`;
      if (alwaysAdvance) {
        vscode.window.showWarningMessage(warnText);
        enqueuePhaseAdvanceSafely(rootDir, specRel);
      } else {
        const choice = await vscode.window.showWarningMessage(warnText, ADVANCE_PHASE, ALWAYS);
        await handleAdvancePhaseChoice(rootDir, specRel, choice);
      }
    } else if (alwaysAdvance) {
      vscode.window.showInformationMessage(base);
      enqueuePhaseAdvanceSafely(rootDir, specRel);
    } else {
      const choice = await vscode.window.showInformationMessage(base, ADVANCE_PHASE, ALWAYS);
      await handleAdvancePhaseChoice(rootDir, specRel, choice);
    }

    // First-approve-only tip that editing revokes approval (#104 — show once, not
    // on every approve). Skipped entirely when no Memento is wired (e.g. tests).
    if (state) {
      const HINT_KEY = 'minspec.approveRevokeHintShown';
      if (!state.get<boolean>(HINT_KEY)) {
        void state.update(HINT_KEY, true);
        vscode.window.showInformationMessage(
          'MinSpec: Tip — editing an approved spec automatically revokes its approval; re-approve after edits.',
        );
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `MinSpec: Failed to approve — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Command: Revoke a spec's approval. */
export async function revokeApprovalCommand(node?: SpecNodeLike): Promise<void> {
  // Multi-root safe (see approveSpecCommand for the pattern).
  const rootDir = node?.spec?.filePath
    ? folderForFile(node.spec.filePath) ?? (await resolveTargetFolder())
    : await resolveTargetFolder();
  if (!rootDir) return;

  const spec = await pickSpec(rootDir, node, 'Select a spec to revoke approval', {
    // Only specs with an approval record (approved or stale) can be revoked.
    include: (status) => status !== 'unapproved',
    emptyMessage: 'MinSpec: No approved specs to revoke.',
  });
  if (!spec) return;

  const removed = removeApproval(rootDir, spec.filePath);
  vscode.window.showInformationMessage(
    removed
      ? `MinSpec: Revoked approval for ${spec.id}.`
      : `MinSpec: ${spec.id} was not approved.`,
  );
  await vscode.commands.executeCommand('minspec.refreshTree');
}
