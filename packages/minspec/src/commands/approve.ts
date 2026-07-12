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
  specRelPath,
  type ApprovalStatus,
} from '../lib/approval';
import { sidecarPath } from '../lib/approval-store';
import { resolveActiveSpecId } from '../lib/active-spec';
import { folderForFile, resolveTargetFolder } from '../lib/resolve-folder';
import { commitApprovalIfEnabled } from './commit-on-approve';

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
    const email = gitConfigEmail(rootDir);
    if (wasPreImpl) {
      advanceSpecToImplementing(spec.filePath); // mirror; phases-aware, no longer affects the hash
    }
    recordApproval(rootDir, spec.filePath, spec.tier, email);

    // Commit-on-approve (SPEC-022 FR-1): the flipped doc + attributed record
    // become ONE real commit so an approval is never left uncommitted in the
    // working tree (the Alt+A nuisance — project memory project_alt_a_no_autocommit).
    // Gated by `minspec.commitOnApprove` (default on); pathspec-safe (never bundles
    // another session's staged files). The suffix folds the commit outcome into the
    // single approval toast below.
    const sidecar = sidecarPath(rootDir, specRelPath(rootDir, spec.filePath));
    const { suffix: commitSuffix } = await commitApprovalIfEnabled(
      rootDir,
      [spec.filePath, sidecar],
      `chore(approve): ${spec.id} approved for implementation`,
    );

    const base =
      (wasPreImpl
        ? `MinSpec: ✓ Approved ${spec.id} for implementation (status → implementing).`
        : `MinSpec: ✓ Approved ${spec.id} for implementation.`) + commitSuffix;
    if (warnings.length > 0) {
      // Non-modal advisory: approved, but the gaps are surfaced so they are not
      // silently swallowed (never-wrong). Not a modal, not a blocking gate.
      const n = warnings.length;
      vscode.window.showWarningMessage(
        `${base} ${n} advisory ${n === 1 ? 'warning' : 'warnings'} — ${warnings
          .map((w) => w.message)
          .join(' ')}`,
      );
    } else {
      vscode.window.showInformationMessage(base);
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

    await vscode.commands.executeCommand('minspec.refreshTree');
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
