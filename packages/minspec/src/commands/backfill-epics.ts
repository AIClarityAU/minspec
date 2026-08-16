import * as vscode from 'vscode';
import {
  proposeHeuristic,
  proposeAI,
  isClaudeAvailable,
  applyBackfill,
  renderProposalMarkdown,
  withoutAlreadyTagged,
  backfillScope,
  type BackfillProposal,
  type ProposedEpic,
} from '../lib/epic-backfill';
import { resolveTargetFolder } from '../lib/resolve-folder';
import { slugify } from '../lib/spec-manager';
import { listEpics } from '../lib/epic-manager';
import {
  loadPreferences,
  savePreferences,
  resolveProjectPreference,
} from '../lib/preferences';

/** Options threaded in from an upstream caller (e.g. the auto-bootstrap offer). */
export interface BackfillOptions {
  /**
   * AI consent already obtained upstream. The bootstrap offer's toast promises
   * "AI-enhanced if Claude Code is installed", so clicking it IS consent — the
   * command must not re-ask (AIClarityAU/minspec#213).
   */
  readonly aiConsent?: boolean;
}

/**
 * Persisted "always use the AI pass for backfill" opt-in (#213).
 *
 * Read order is DR-078 §4: the PROJECT-LOCAL preference first, then the VS Code
 * setting. It remains a personal cost/privacy/quota choice — it is simply scoped
 * to the project it was made in, rather than following the user into projects
 * that never consented to an AI pass.
 */
function alwaysUseAi(rootDir: string): boolean {
  const setting = vscode.workspace
    .getConfiguration('minspec')
    .get<boolean>('autoBackfillUseAi', false);
  return resolveProjectPreference(
    loadPreferences(rootDir).autoBackfillUseAi,
    setting,
  );
}
/**
 * Persist the "Always" choice to the PROJECT-LOCAL store.
 *
 * This used to write `ConfigurationTarget.Global`, which constitution invariant
 * 3 (DR-074) forbids. It mattered more here than anywhere else: a global value
 * silently enabled an AI/network code path in every OTHER MinSpec project on the
 * machine — including projects whose maintainers chose MinSpec for its offline
 * Tier-0 posture (invariant 1) and never consented to `claude -p` running there.
 * DR-078 §1 names `.minspec/preferences.json` as the correct store. Fixed in
 * #1319.
 */
function enableAlwaysUseAi(rootDir: string): void {
  try {
    savePreferences(rootDir, { autoBackfillUseAi: true });
  } catch (err) {
    console.warn(`MinSpec: failed to persist autoBackfillUseAi pref — ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Rename-in-flow (AIClarityAU/minspec#218). A keyboard single-select loop layered
 * on top of the drop step: pick a NEW proposed epic, edit its title in an
 * InputBox (pre-filled, two-key edit), and the slug is re-derived via the shared
 * `slugify`. Every mapping that pointed at the old slug is repointed at the new
 * one so nothing is orphaned (an orphaned mapping is silently dropped at apply).
 *
 * Only NEW epics (no `id`) are renamable: `applyBackfill` prefers the registry's
 * canonical title for already-registered epics and never renames on disk, so an
 * in-flow "rename" of an existing epic would silently no-op — we omit them rather
 * than offer a no-op. Nothing is written here; the rename mutates the in-flight
 * proposal and is persisted by `applyBackfill` → `createEpic` on Apply.
 *
 * Mutates `epics`/`mappings` in place and returns them (a thin convenience).
 */
async function renameEpicsInFlow(
  folder: string,
  epics: ProposedEpic[],
  mappings: BackfillProposal['mappings'],
): Promise<void> {
  // Slugs that already exist on disk — a new epic must not collide into one
  // (that would silently merge it into an unrelated registered epic at apply).
  const registeredSlugs = new Set(listEpics(folder).map((e) => e.slug));

  type RenameItem = vscode.QuickPickItem & {
    epic?: ProposedEpic;
    rename?: 'done';
  };

  for (;;) {
    // Renamable = new epics only. Recompute each pass so labels reflect renames.
    const renamable = epics.filter((e) => !e.id);
    if (renamable.length === 0) return;

    const items: RenameItem[] = [
      { label: '$(check) Done — apply changes', rename: 'done' },
      { label: 'Epics', kind: vscode.QuickPickItemKind.Separator },
      ...renamable.map((e) => ({
        label: `$(pencil) ${e.title}`,
        description: e.slug,
        epic: e,
      })),
    ];

    const pick = (await vscode.window.showQuickPick(items, {
      title: 'Backfill — rename an epic, or Done to apply',
      placeHolder: 'Pick an epic to rename · Enter · Esc/Done finishes',
    })) as RenameItem | undefined;

    if (!pick || pick.rename === 'done' || !pick.epic) return;

    const target = pick.epic;
    const newTitle = await vscode.window.showInputBox({
      title: `Rename epic — ${target.title}`,
      prompt: 'New epic title (the slug is derived automatically)',
      value: target.title,
      validateInput: (raw: string): string | undefined => {
        const title = raw.trim();
        if (title === '') return 'Title cannot be empty.';
        const slug = slugify(title);
        if (slug === '') return 'Title must contain at least one letter or number.';
        // Renaming an epic to a slug it already has is a no-op — allow it.
        if (slug === target.slug) return undefined;
        if (registeredSlugs.has(slug)) {
          return `An existing epic already uses the slug "${slug}". Choose a different title.`;
        }
        if (epics.some((e) => e !== target && e.slug === slug)) {
          return `Another proposed epic already uses the slug "${slug}". Choose a different title.`;
        }
        return undefined;
      },
    });

    if (newTitle === undefined) continue; // Esc → leave this epic untouched

    const title = newTitle.trim();
    const slug = slugify(title);
    if (title === '' || slug === '') continue; // defensive; validateInput blocks this
    if (slug === target.slug && title === target.title) continue; // nothing changed

    const oldSlug = target.slug;
    const targetIndex = epics.indexOf(target);
    if (targetIndex !== -1) epics[targetIndex] = { ...target, title, slug };
    // Repoint every mapping that referenced the old slug — no orphans.
    if (oldSlug !== slug) {
      for (let i = 0; i < mappings.length; i++) {
        if (mappings[i].epicSlug === oldSlug) {
          mappings[i] = { ...mappings[i], epicSlug: slug };
        }
      }
    }
  }
}

/**
 * Per-item review: a keyboard QuickPick of every proposed epic + mapping, all
 * pre-checked. Uncheck to drop; Enter applies the rest (AIClarityAU/minspec#213).
 * After the drop step, a rename-in-flow loop lets you edit a kept epic's
 * title/slug (AIClarityAU/minspec#218). Returns the filtered proposal, or
 * `undefined` if the drop picker was dismissed (the caller then keeps the
 * un-tweaked proposal). No markdown round-trip parsing — the proposal object is
 * the source of truth.
 */
async function tweakProposal(
  folder: string,
  proposal: BackfillProposal,
): Promise<BackfillProposal | undefined> {
  type Item = vscode.QuickPickItem & { ref?: { kind: 'epic' | 'mapping'; i: number } };
  const items: Item[] = [];

  items.push({ label: 'Epics', kind: vscode.QuickPickItemKind.Separator });
  proposal.epics.forEach((e, i) =>
    items.push({
      label: e.title,
      description: `${e.slug}${e.id ? ' · existing' : ' · new'}`,
      detail: e.rationale,
      picked: true,
      ref: { kind: 'epic', i },
    }),
  );

  items.push({ label: 'Mappings', kind: vscode.QuickPickItemKind.Separator });
  proposal.mappings.forEach((m, i) =>
    items.push({
      label: m.artifactId,
      description: `→ ${m.epicSlug} · ${(m.confidence * 100).toFixed(0)}%`,
      detail: m.rationale,
      picked: true,
      ref: { kind: 'mapping', i },
    }),
  );

  const sel = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: 'Backfill — uncheck anything to drop',
    placeHolder: 'Space toggles · Enter confirms · Esc keeps the original proposal',
  });
  if (!sel) return undefined; // dismissed → caller keeps the prior proposal

  const keptEpicIdx = new Set(
    sel.filter((s) => s.ref?.kind === 'epic').map((s) => s.ref!.i),
  );
  const keptEpics = proposal.epics.filter((_, i) => keptEpicIdx.has(i));
  const keptSlugs = new Set(keptEpics.map((e) => e.slug));

  const keptMapIdx = new Set(
    sel.filter((s) => s.ref?.kind === 'mapping').map((s) => s.ref!.i),
  );
  // A mapping can't apply without its epic: dropping an epic drops its mappings
  // (applyBackfill would otherwise silently skip them — confusing).
  const keptMappings = proposal.mappings.filter(
    (m, i) => keptMapIdx.has(i) && keptSlugs.has(m.epicSlug),
  );

  // Mutable copies so rename-in-flow can edit titles/slugs and repoint mappings
  // without touching the caller's original proposal (kept on QuickPick dismiss).
  const epics = keptEpics.map((e) => ({ ...e }));
  const mappings = keptMappings.map((m) => ({ ...m }));
  await renameEpicsInFlow(folder, epics, mappings);

  return { epics, mappings, source: proposal.source };
}

/**
 * Command: Backfill epics (DR-016 / SPEC-011).
 *
 * Builds a Tier-0 heuristic proposal; if `claude` is available, runs the Tier-1
 * AI-enhanced pass (consent inherited from the bootstrap offer, persisted via
 * "Always", or asked once — falls back to heuristic on any failure). Opens the
 * proposal so it stays visible, then a NON-modal toast (Apply / Tweak / Cancel)
 * — the proposal is readable while you decide, and Tweak filters it per-item.
 * Never writes without confirmation (AIClarityAU/minspec#213).
 */
export async function backfillEpicsCommand(
  folderArg?: string,
  opts?: BackfillOptions,
): Promise<void> {
  const folder = folderArg ?? (await resolveTargetFolder());
  if (!folder) return;

  // Nothing without an `epic:` means nothing this command can change. Say so
  // before the consent prompt and the AI call, rather than asking to spend
  // minutes producing mappings that apply would skip anyway (#1570, #1571).
  const scope = backfillScope(folder);
  if (scope.pending === 0) {
    vscode.window.showInformationMessage(
      scope.total === 0
        ? 'MinSpec: Nothing to backfill — no specs or decisions found yet.'
        : 'MinSpec: Nothing to backfill — every spec and decision already carries an epic.',
    );
    return;
  }

  let proposal: BackfillProposal = proposeHeuristic(folder);

  // Tier-1 AI pass. Consent may already be given upstream (the bootstrap offer
  // promised it) or persisted ("Always"); otherwise ask once — with an "Always"
  // affordance so direct Command-Palette runs aren't re-asked every time.
  if (await isClaudeAvailable()) {
    let useAi = opts?.aiConsent === true || alwaysUseAi(folder);
    if (!useAi) {
      const USE_AI = 'AI-enhanced';
      const ALWAYS = 'Always';
      const HEURISTIC = 'Heuristic only';
      const choice = await vscode.window.showInformationMessage(
        'MinSpec: Claude Code detected. Use AI to propose the epic taxonomy? (Runs `claude -p` locally; the extension makes no network calls.)',
        ALWAYS,
        USE_AI,
        HEURISTIC,
      );
      if (choice === undefined) return; // dismissed
      if (choice === ALWAYS) {
        enableAlwaysUseAi(folder);
        useAi = true;
      } else if (choice === USE_AI) {
        useAi = true;
      }
    }
    if (useAi) {
      // Cancellable: the budget now scales with the corpus (up to 15 minutes on
      // a large one), and a wait that long must be interruptible (#1570).
      const ai = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'MinSpec: asking Claude to propose epics…',
          cancellable: true,
        },
        (_progress, token) => {
          const ac = new AbortController();
          token.onCancellationRequested(() => ac.abort());
          return proposeAI(folder, { signal: ac.signal });
        },
      );
      if (ai?.proposal) {
        proposal = ai.proposal;
      } else if (ai?.failure?.reason !== 'cancelled') {
        // Name the mode that actually fired. This used to read "AI pass
        // unavailable" for every failure, which blamed a missing binary for a
        // call that had in fact answered fine and simply been cut off (#1570).
        vscode.window.showWarningMessage(
          `MinSpec: the AI pass ${ai?.failure?.detail ?? 'did not produce a proposal'} — using the heuristic proposal.`,
        );
      }
    }
  }

  // Only what apply will really write, so the counts below are the truth (#1571).
  proposal = withoutAlreadyTagged(proposal);

  if (proposal.epics.length === 0 || proposal.mappings.length === 0) {
    vscode.window.showInformationMessage('MinSpec: Nothing to backfill — no confident epic mappings found.');
    return;
  }

  // HITL review: open the proposal so it stays on screen, then a NON-modal toast
  // (a modal would steal focus and hide the proposal behind it — #213). Loop so
  // Tweak re-renders the filtered proposal and returns to the Apply prompt.
  const showProposal = async (p: BackfillProposal): Promise<void> => {
    const doc = await vscode.workspace.openTextDocument({
      content: renderProposalMarkdown(p),
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  };
  await showProposal(proposal);

  const APPLY = 'Apply';
  const TWEAK = 'Tweak…';
  const CANCEL = 'Cancel';
  for (;;) {
    const choice = await vscode.window.showInformationMessage(
      `MinSpec: Apply ${proposal.epics.length} epic(s) and tag ${proposal.mappings.length} artifact(s)? Already-tagged artifacts are left untouched.`,
      APPLY,
      TWEAK,
      CANCEL,
    );
    if (choice === APPLY) break;
    if (choice === TWEAK) {
      const tweaked = await tweakProposal(folder, proposal);
      if (tweaked) {
        proposal = tweaked;
        await showProposal(proposal);
      }
      continue; // re-show the Apply prompt (filtered counts, or unchanged on dismiss)
    }
    return; // Cancel or dismissed
  }

  if (proposal.epics.length === 0 || proposal.mappings.length === 0) {
    vscode.window.showInformationMessage('MinSpec: Nothing left to apply after tweaking.');
    return;
  }

  try {
    const res = applyBackfill(folder, proposal);
    vscode.window.showInformationMessage(
      `MinSpec: Backfill done — ${res.epicsCreated} epic(s) created, ${res.artifactsTagged} tagged, ${res.skipped} skipped.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`MinSpec: Backfill failed — ${message}`);
  }
}
