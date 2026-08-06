import * as vscode from 'vscode';
import { commitApproval, isUntrackedAtHead, type CommitApprovalResult } from '../lib/approve-commit';
import { pushApproval, type PushApprovalResult } from '../lib/approve-push';
import { recoverProtectedBranchApproval, type RecoverResult } from '../lib/approval-recover';
import {
  branchChangedPaths,
  buildApprovalPrBody,
  defaultExecRun,
  laneLabelsFor,
  openPullRequest,
  resolveHeadSha,
  type ExecRun,
  type OpenPrResult,
} from '../lib/approval-pr';
import { readRecord, toPosixRel } from '../lib/approval-store';

/**
 * `.minspec/preferences.json` accessors, loaded LAZILY and deliberately.
 *
 * `loadPreferences`/`savePreferences` live in `lib/auto-bootstrap.ts`, and they
 * are the real #883 one-time-prompt store — re-implementing that JSON read/merge
 * here would make TWO writers of one file with different merge semantics, which
 * is precisely the hazard `recordAnsweredSignature`'s own comment warns about.
 * So this uses that API unchanged.
 *
 * But a STATIC import of it would drag `auto-bootstrap`'s whole transitive graph
 * — `template-registry`, `slash-commands`, `merge-refresh`, `epic-backfill` (and
 * with it the `claude -p` scaffolding) — into every module that merely commits an
 * approval. That is real weight on a hot path for two ~10-line fs helpers, and it
 * also makes the approval bridge's module graph enormously wider than its job.
 * A dynamic import keeps the graph as narrow as it was and evaluates that module
 * only when the FR-8 offer is genuinely being made or answered.
 *
 * That is not hypothetical tidiness: the static version broke `approve-action`
 * and `multi-root-command-scope`, which mock `lib/spec` with a partial factory
 * that the newly-reachable `slash-commands.ts` then tripped over at module-eval
 * time. The `.js` specifier and the shape of this helper follow the repo's
 * existing precedent at `commands/classify.ts:163`; `import-cycle-check.ts`
 * deliberately does not count a dynamic import as a graph edge, for this reason.
 */
async function preferencesApi(): Promise<typeof import('../lib/auto-bootstrap.js')> {
  return import('../lib/auto-bootstrap.js');
}

/**
 * Bridge between the approve/accept commands and the Tier-0 {@link commitApproval}
 * helper. Reads the `minspec.commitOnApprove` setting and folds the commit outcome
 * into a short suffix the caller appends to its own success toast — so an approval
 * produces ONE message stating both the approval and whether it was committed
 * (SPEC-022 FR-1; project memory `project_alt_a_no_autocommit`).
 */

/** Is auto-commit-on-approve enabled? Default on (opt-out via settings). */
export function commitOnApproveEnabled(): boolean {
  return vscode.workspace.getConfiguration('minspec').get<boolean>('commitOnApprove', true);
}

/**
 * Commit the approval paths when the setting is on, returning a toast suffix.
 *
 *   ''                                        — setting off, not a repo, or no net change
 *   ' · committed'                            — the doc (+ record) were committed
 *   ' · not committed (detached HEAD)'        — refused so the approval isn't lost on next checkout
 *   ' · commit failed — approval saved …'     — git/hook rejected; approval on disk, uncommitted, unstaged
 *
 * Never rejects (delegates to `commitApproval`, which never rejects). A failed or
 * refused commit is surfaced (never-wrong: the user must know the approval is
 * uncommitted), with the full git/hook stderr logged for diagnosis.
 */
/** Offer labels — worded to match #1054's harness-commit offer, so the two
 *  destination guards read as one behaviour rather than two dialects. */
const SHOW_FILES_ACTION = 'Show me the files';
/** #1115 — the consent click that authorizes recovery's network step. */
const RECOVER_ACTION = 'Save it on a branch';
// OPEN_PR_ACTION is declared once, below, with the SPEC-050 actions — both #1115's
// recovery toast and FR-1's legacy `manual` surface use the same label, and two
// declarations of one string is how the two surfaces drift apart.

/**
 * #1115 — try to rescue an approval the destination guard refused, by committing it
 * on a side branch and pushing. Returns the toast suffix on success, or `undefined`
 * to mean "fall back to the honest warning" (consent withheld, or recovery failed).
 *
 * CONSENT (constitution invariant #1). Recovery pushes, so it is gated on the SAME
 * `minspec.pushOnApprove` setting that governs every other approval push — not a new
 * one. `never` ⇒ no network, ever, and no prompt. `prompt` ⇒ one click, which is the
 * consent. `always` ⇒ the user set it deliberately; the setting is the consent.
 * Reusing the existing tri-state matters: a second consent surface for the same
 * network act is how a user ends up believing they have opted out when they have not.
 *
 * Never throws — `recoverProtectedBranchApproval` is typed-result-only, and anything
 * unexpected degrades to `undefined` (the pre-#1115 behaviour).
 */
async function recoverOnProtectedBranch(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
  current: string,
  baseBranch: string | undefined,
): Promise<{ suffix: string } | 'declined' | undefined> {
  const mode = pushOnApproveMode();
  if (mode === 'never') return undefined;
  if (mode === 'prompt') {
    // Non-modal (project preference: never steal focus from the artifact being
    // approved). Names the destination, so the click is informed consent.
    const choice = await vscode.window.showWarningMessage(
      `Approval written but NOT committed: '${current}' is the default branch. ` +
        `Save it on a branch and push, so the sign-off is not stranded here?`,
      RECOVER_ACTION,
      'Not now',
    );
    // 'declined', NOT undefined: the caller must not then show its own
    // near-identical "NOT committed / default branch" warning. The user has just
    // read that sentence and answered it — repeating it is the nagging the
    // constitution warns about, and it makes a deliberate choice look like an
    // error. The suffix still reports the honest state (#1255 review nit).
    if (choice !== RECOVER_ACTION) return 'declined';
  }

  const slug = (absPaths[0] ?? message).split(/[\\/]/).slice(-2).join('-').replace(/\.[a-z]+$/i, '');
  let res: RecoverResult;
  try {
    // baseBranch MUST be the branch the guard actually refused, not a hardcoded
    // 'main'. The destination guard fires on whatever `origin/HEAD` resolves to —
    // and its fallback list is `main master trunk` — so on a `master`- or
    // `trunk`-default repo, defaulting to `main` would `fetch origin main`, fail,
    // and silently degrade to the honest warning. Recovery would be inert for a
    // whole class of repos while appearing to be built. Caught in review on #1255.
    res = await recoverProtectedBranchApproval(rootDir, absPaths, message, { slug, baseBranch });
  } catch (err) {
    // Defensive: the seam documents never-throws, but relying on that transitively
    // would let a future change there break an approval toast that has nothing to
    // do with recovery (the same reasoning as pushApprovalIfEnabled's guard).
    console.warn(`MinSpec: approval recovery threw — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }

  if (res.outcome !== 'recovered') {
    // Every non-success falls back to the honest warning, with the reason logged.
    // NOT surfaced as a success suffix: the files really are still only local.
    console.warn(`MinSpec: approval recovery ${res.outcome} — ${res.error ?? 'no detail'}`);
    return undefined;
  }

  // Success. Non-blocking: the operation is COMPLETE, so the notification carries a
  // convenience action, never one required to finish the job.
  if (res.compareUrl) {
    const url = res.compareUrl;
    void vscode.window
      .showInformationMessage(`Approval saved on '${res.branch}' and pushed.`, OPEN_PR_ACTION)
      .then((c) => {
        if (c === OPEN_PR_ACTION) void vscode.env.openExternal(vscode.Uri.parse(url));
      });
  }
  return { suffix: ` · committed on ${res.branch} and pushed` };
}

export async function commitApprovalIfEnabled(
  rootDir: string,
  absPaths: readonly string[],
  message: string,
): Promise<{ suffix: string; result?: CommitApprovalResult }> {
  if (!commitOnApproveEnabled()) return { suffix: '' };
  const result = await commitApproval(rootDir, absPaths, message);
  switch (result.outcome) {
    case 'committed': {
      // Push from HERE, not from each caller: spec-approve, ADR-accept and
      // epic-accept all funnel through this helper, so wiring it once means no
      // approval path can silently miss it as new ones are added.
      const slug = (result.paths?.[0] ?? message).replace(/\.[a-z]+$/i, '');
      // SPEC-050 FR-2: thread the approval's own facts through, so a `pushed-branch`
      // outcome can open a titled, labelled PR without re-deriving anything. Both
      // are required for the auto path (see `openApprovalPr`) — `paths` is what
      // PROVES the change is docs-only (INV-2), and `subject` is the PR title.
      const { suffix: pushSuffix } = await pushApprovalIfEnabled(rootDir, slug, {
        subject: message,
        paths: result.paths,
      });
      return { suffix: ` · committed${pushSuffix}`, result };
    }
    case 'protected-branch': {
      // #1064: the default branch is push-protected, so a commit there could never
      // be pushed and #1041's hook refuses it. NOTHING was staged. The defect this
      // closes is the SILENCE — the maintainer saw the doc read `accepted` and
      // reasonably believed it had landed. So say plainly what happened, what
      // state the files are in, and what to do; never a bare console.warn.
      //
      // #1115 / DR-080 — RECOVERY IS NOW ATTEMPTED, in a throwaway worktree off
      // origin/<default>. See docs/decisions/DR-080.md for the recorded decision:
      // it supersedes the deferral that used to stand here, states why SPEC-050's
      // arm could not reach this case, and dates the duplicated-push-logic loan.
      // The comment that stood here said auto-recovery belonged in SPEC-050. That
      // was wrong in an instructive way: SPEC-050 fires on `pushed-branch`, which
      // is produced by `pushApproval` — and `pushApproval` only ever runs from the
      // `committed` arm above. On a repo where `main` IS the default branch, this
      // arm returns first, so SPEC-050's payload was unreachable for exactly the
      // case it was supposed to cover. Measured 2026-08-05: six ratifications
      // stranded in one sitting while SPEC-050 was "the fix".
      //
      // Recovery still never moves the shared checkout's HEAD (rule #8 / DR-051
      // §4a) — approval-recover.ts copies into a separate worktree with a separate
      // index, and this arm still stages nothing in the primary.
      const current = result.branch?.current ?? 'the default branch';
      const recovery = await recoverOnProtectedBranch(
        rootDir,
        absPaths,
        message,
        current,
        result.branch?.current,
      );
      if (recovery === 'declined') {
        // The user was asked and said no. Report the state honestly in the suffix,
        // but do NOT re-show the warning they just dismissed.
        return {
          suffix: ` · NOT committed (on ${current} — files left in your working tree)`,
          result,
        };
      }
      if (recovery) return { ...recovery, result };

      // Fallback — unchanged: consent withheld, or recovery failed. Say plainly what
      // happened and what state the files are in; never a bare console.warn.
      void vscode.window.showWarningMessage(
        `Approval written but NOT committed: '${current}' is the default branch, ` +
          `so a commit there could not be pushed. Your files are saved in the working ` +
          `tree — commit them on a branch to keep them.`,
        SHOW_FILES_ACTION,
      ).then((choice) => {
        if (choice === SHOW_FILES_ACTION) void vscode.commands.executeCommand('workbench.view.scm');
      });
      return {
        suffix: ` · NOT committed (on ${current} — files left in your working tree)`,
        result,
      };
    }
    case 'detached-head':
      // A commit here would be orphaned by the next checkout — refuse and say so.
      return { suffix: ' · not committed (detached HEAD — switch to a branch)', result };
    case 'failed':
      // Log the detail (incl. hook stderr); keep the toast short. The approval
      // record is already on disk — only the git commit failed.
      //
      // Says "in your working tree", NOT "files staged": `commitApproval`
      // unstages these exact paths on failure (invariant 3), so the files are
      // deliberately NOT left in the index. The old wording described the
      // behaviour before that invariant existed and had become false.
      console.warn(`MinSpec: commit-on-approve failed — ${result.error ?? 'git error'}`);
      return { suffix: ' · commit failed — approval saved in your working tree (see console)', result };
    default:
      // 'not-a-repo' | 'nothing-to-commit' — no net change worth reporting.
      return { suffix: '', result };
  }
}

/** How aggressively an approval commit should be pushed. Default `prompt`. */
export type PushOnApproveMode = 'never' | 'prompt' | 'always';

export function pushOnApproveMode(): PushOnApproveMode {
  const v = vscode.workspace.getConfiguration('minspec').get<string>('pushOnApprove', 'prompt');
  return v === 'never' || v === 'always' ? v : 'prompt';
}

/**
 * SPEC-050 FR-1 — what to do once an approval has ALREADY been pushed to a side
 * branch because the current branch is protected.
 *
 * A DIFFERENT axis from {@link pushOnApproveMode} (OQ-3): that one answers
 * "should this leave the machine?", this one answers "now that it has, who
 * finishes the job?". Folding them into one enum would produce an incoherent
 * `never | prompt | always | auto` whose last member answers a different
 * question from its siblings.
 *
 * Defaults to `auto` (the contributed default). An unrecognised value resolves
 * to `auto` too — the setting only ever chooses WHO opens a PR for a branch that
 * is already on the remote, so a typo cannot cause a push, a network call the
 * user did not consent to, or a lost approval. Compare `pushOnApprove`, which
 * fails to its SAFEST value because a typo there could otherwise send bytes.
 */
export type ApprovalPrMode = 'auto' | 'manual';

export function approvalPrMode(): ApprovalPrMode {
  const v = vscode.workspace.getConfiguration('minspec').get<string>('approvalPr', 'auto');
  return v === 'manual' ? 'manual' : 'auto';
}

/** The push prompt's actions. Named constants so the tests assert the SAME strings the UI shows. */
const PUSH_ACTION = 'Push';
const ALWAYS_PUSH_ACTION = 'Always push from now on';
const NOT_NOW_ACTION = 'Not now';
/** The legacy `manual` surface's only action (FR-1/FR-5 must reproduce it byte-for-byte). */
const OPEN_PR_ACTION = 'Open PR';

/**
 * The ref the INV-2 diff is taken against. `openPullRequest` passes no `--base`,
 * so `gh` uses the base repo's own default branch — and `origin/HEAD` is the
 * local symbolic ref for exactly that. Using it keeps the label's evidence and
 * the PR's actual base the SAME branch; hardcoding `origin/main` would silently
 * measure the wrong range on a `master`- or `trunk`-default repo, which is the
 * mistake #1255 had to fix in the sibling recovery path.
 *
 * When `origin/HEAD` is absent the diff simply fails, `branchChangedPaths`
 * returns undefined, and the PR is opened UNLABELLED — the fail-closed direction.
 */
const PR_BASE = 'origin/HEAD';

/**
 * `answeredSignatures` key for the FR-8 standing-consent offer (#883 model).
 *
 * The VALUE is a CONSTANT sentinel, not a derived state signature: unlike the
 * harness-drift prompts — which legitimately re-arm when the underlying state
 * moves — "would you like to stop being asked?" has no state that could make it
 * a fair question a second time. A constant makes the memory a genuine
 * show-once (`auto-bootstrap.ts`'s `() => 'uninit'` precedent).
 */
const PUSH_ALWAYS_OFFER_KEY = 'pushAlwaysOffer';
const PUSH_ALWAYS_OFFER_SHOWN = 'offered';

/**
 * Has the one-time "Always push from now on" offer already been made?
 *
 * Reads `.minspec/preferences.json` — machine-local and gitignored, which is the
 * right home: DR-071's corollary is that standing consent is a PERSONAL decision,
 * so neither the offer's memory nor the setting it writes belongs to the repo.
 * Any read failure answers "not yet offered", which at worst repeats one prompt;
 * the opposite default would silently swallow the one moment the developer learns
 * what MinSpec can do for them.
 */
async function pushAlwaysOfferAlreadyMade(rootDir: string): Promise<boolean> {
  try {
    const { loadPreferences } = await preferencesApi();
    return (
      loadPreferences(rootDir).answeredSignatures?.[PUSH_ALWAYS_OFFER_KEY] ===
      PUSH_ALWAYS_OFFER_SHOWN
    );
  } catch {
    return false;
  }
}

/**
 * Remember that the offer was shown, whatever the answer was (#883: recording on
 * EVERY resolution — including a dismiss — is what stops the re-nag).
 *
 * SPREADS the existing map: `savePreferences` merges TOP-LEVEL keys only, so a
 * bare `{ answeredSignatures: { … } }` would REPLACE the whole map and wipe the
 * bootstrap steps' answers. Same hazard, same fix, as `recordAnsweredSignature`.
 *
 * Swallows every failure (read-only checkout, unwritable root, full disk): a
 * preference write must never turn a SUCCESSFUL approval into a visible error.
 */
async function recordPushAlwaysOfferMade(rootDir: string): Promise<void> {
  try {
    const { loadPreferences, savePreferences } = await preferencesApi();
    const current = loadPreferences(rootDir);
    savePreferences(rootDir, {
      answeredSignatures: {
        ...(current.answeredSignatures ?? {}),
        [PUSH_ALWAYS_OFFER_KEY]: PUSH_ALWAYS_OFFER_SHOWN,
      },
    });
  } catch (err) {
    console.warn(
      `MinSpec: could not remember the push-always offer — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The key standing push consent is stored under in `.minspec/preferences.json`. */
const PUSH_ALWAYS_PREF_KEY = 'pushOnApprove';

/**
 * FR-8: record the user's standing consent — PROJECT-LOCAL, per DR-080's sibling
 * [DR-078](../../../../docs/decisions/DR-078.md) (accepted 2026-08-05).
 *
 * NOT `ConfigurationTarget.Global`, which is what FR-8's approved text says. That
 * lands in `~/.config/Code/User/settings.json`, and constitution invariant #3
 * (DR-074, in force 2026-07-31 — four days before SPEC-050 was approved) names
 * `~/.config/**` as out of bounds for a per-project write. Clicking "from now on"
 * in project A would have silently changed behaviour in project B, which never
 * opted in.
 *
 * DR-078 found the two decisions were never actually in conflict: DR-071's
 * corollary rules out a SHARED location (a committed `.vscode/settings.json`),
 * invariant #3 rules out a MACHINE-WIDE one. `.minspec/preferences.json` is
 * neither — gitignored, so never imposed on a co-contributor, and inside the
 * `.minspec/` opt-in marker. It also already holds this feature's own one-time
 * offer memory, so the offer and the consent it grants now share one scope; they
 * previously disagreed (offer per-repo, setting global), which is the asymmetry
 * the #1224 audit flagged.
 *
 * SPEC-050 is hash-locked, so its "(Global)" parenthetical cannot be corrected
 * without voiding the sign-off (#1179). DR-078 is the authority; the spec text is
 * the stale artifact.
 *
 * Swallow-and-warn on failure (the `approve.ts` precedent): the approval has
 * already succeeded and the caller pushes regardless — losing the PREFERENCE must
 * never look like losing the approval.
 */
async function enableAlwaysPush(rootDir: string): Promise<void> {
  try {
    const { loadPreferences, savePreferences } = await preferencesApi();
    const current = loadPreferences(rootDir);
    savePreferences(rootDir, {
      ...current,
      [PUSH_ALWAYS_PREF_KEY]: 'always',
    } as Parameters<typeof savePreferences>[1]);
  } catch (err) {
    console.warn(
      `MinSpec: failed to persist pushOnApprove=always — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * The SINGLE accessor for the effective push mode (DR-078 §4). No call site reads
 * either store directly — a two-source read is how silent disagreements start, and
 * `minspec.protectedBranches` (#1111) is a live example of that in this codebase.
 *
 * Project-local preference wins, then the VS Code setting (and its `prompt`
 * default). The project preference is a narrower, more recently expressed intent
 * than a global default; absent one, existing configurations keep working exactly
 * as before.
 */
async function effectivePushOnApproveMode(rootDir: string): Promise<PushOnApproveMode> {
  try {
    const { loadPreferences } = await preferencesApi();
    const stored = (loadPreferences(rootDir) as Record<string, unknown>)[PUSH_ALWAYS_PREF_KEY];
    if (stored === 'never' || stored === 'prompt' || stored === 'always') return stored;
  } catch {
    // Unreadable preferences file → fall through to the VS Code setting. Not a
    // failure worth surfacing: the setting still answers, and its default prompts.
  }
  return pushOnApproveMode();
}

/**
 * Branches the REMOTE will reject a direct push to — used only by the push step.
 *
 * ⚠️ This is NOT the list the commit-destination guard uses. `minspec.protectedBranches`
 * currently names TWO separate settings: this VS Code array (default
 * `['main','master']`), and a git config string (default `main master trunk`) read
 * by the #1041 pre-commit hook and by {@link resolveBranchDestination}. A shell hook
 * cannot read VS Code settings, which is how the split arose. Setting one does not
 * set the other, and their defaults disagree over `trunk`.
 *
 * Do not "unify" these by pointing one at the other in passing — that changes a
 * published setting's meaning and needs its own decision. Tracked at #1111.
 */
function protectedBranches(): string[] {
  return vscode.workspace
    .getConfiguration('minspec')
    .get<string[]>('protectedBranches', ['main', 'master', 'trunk']);
}

/**
 * What the approval flow knows about the commit it just made, handed to the push
 * step so a `pushed-branch` outcome can finish into a PR (SPEC-050 FR-2).
 *
 * Every field is OPTIONAL and the whole object defaults to `{}`, so the eleven
 * existing two-argument call sites keep compiling — but the auto path REQUIRES
 * `subject` and `paths`, and refuses to run without them (see
 * {@link openApprovalPr}). Optional-in-the-type, mandatory-in-the-behaviour is
 * the right shape here: a caller that cannot say what it committed has not
 * proven the change is docs-only, and must not get the auto-merge label.
 */
export interface ApprovalPushContext {
  /** The approval commit's subject — becomes the PR title verbatim (FR-2). */
  readonly subject?: string;
  /** Repo-relative paths the approval commit carried (INV-2's evidence). */
  readonly paths?: readonly string[];
  /** Injected git/gh runner; production uses {@link defaultExecRun}. Tests pass a stub. */
  readonly run?: ExecRun;
}

/**
 * The pre-SPEC-050 surface, extracted verbatim: a non-modal notification whose
 * `Open PR` action opens the compare URL, plus the status suffix.
 *
 * It is a FUNCTION rather than duplicated prose because FR-1 (`manual`) and all
 * four FR-5 degrade paths must be the SAME surface, not five similar ones. With
 * `reason` omitted the message and the suffix are byte-identical to what shipped
 * before this spec — which is what makes "`manual` preserves today's behaviour
 * exactly" a property of the code instead of a claim in a doc comment.
 */
function manualPrSurface(result: PushApprovalResult, reason?: string): string {
  const because = reason ? ` — ${reason}` : '';
  if (result.compareUrl) {
    const url = result.compareUrl;
    // INV-5 — the notification is fire-and-forget, so BOTH failure modes have to be
    // handled here or they escape as unhandled rejections: the thenable rejecting
    // (`.catch`), and `showInformationMessage` throwing synchronously (`try`).
    // This surface is now reached from FIVE call sites — FR-1 `manual`, all four
    // FR-5 degrade paths, and the INV-5 backstop itself — so a throw here would
    // take down an approval that was already committed and pushed. It was extracted
    // verbatim from the pre-SPEC-050 code, where it had one caller; the widened
    // reach is what makes hardening it necessary. Caught on #1224.
    try {
      // Promise.resolve(...) because vscode hands back a `Thenable`, which has no
      // `.catch` — chaining one directly is a type error, and without it a rejected
      // toast becomes an unhandled rejection.
      void Promise.resolve(
        vscode.window.showInformationMessage(
          `Approval pushed on '${result.branch}' (this branch is protected, so it needs a PR)${because}.`,
          OPEN_PR_ACTION,
        ),
      )
        .then((c) => {
          if (c === OPEN_PR_ACTION) void vscode.env.openExternal(vscode.Uri.parse(url));
        })
        .catch(() => {
          // The toast is advisory; the suffix below already tells the truth.
        });
    } catch {
      // Same reasoning — never let the advisory surface fail the approval.
    }
  }
  return ` · pushed on ${result.branch} (open a PR${because})`;
}

/** Short, fixed reason per failed {@link openPullRequest} outcome (FR-5). */
const PR_FAILURE_REASON: Record<string, string> = {
  'gh-absent': 'the gh CLI is not installed',
  'gh-unauthenticated': 'gh is not signed in',
  offline: 'GitHub was unreachable',
  failed: 'opening the PR failed (see console)',
};

/**
 * Which of the committed paths is the APPROVABLE document (never the sidecar)?
 *
 * The sidecar is keyed BY the document's path, so `readRecord` must be given the
 * document. Falls back to the first path when the commit is sidecar-only, which
 * simply yields no record — and {@link buildApprovalPrBody} then omits those
 * lines rather than inventing them.
 */
function approvableRelPath(paths: readonly string[]): string {
  const rels = paths.map((p) => toPosixRel(p));
  return rels.find((p) => !p.startsWith('.minspec/approvals/')) ?? rels[0];
}

/**
 * SPEC-050's payload: open the docs-lane PR for an already-pushed approval branch.
 *
 * Reads as a sequence of refusals before it does anything, and every refusal
 * lands on the SAME `manual` surface with a stated reason — never silence, never
 * a throw (FR-5 / INV-5):
 *
 *   1. `approvalPr: manual` — the developer opted out. No `gh` runs at all.
 *   2. No branch name — the push seam could not name what it pushed, so there is
 *      no `--head` to give `gh`.
 *   3. No `subject`/`paths` — FAIL CLOSED. INV-2 says MinSpec labels `docs-lane`
 *      only for a branch PROVEN docs-only, and `paths` is that proof. A caller
 *      that did not supply them has proven nothing, so it does not get the auto
 *      path. (Constitution invariant #2: an unproven absolute fails closed AND
 *      visibly — hence the `console.warn`, never a quiet downgrade.)
 *
 * Past those, note what is deliberately NOT here:
 *   - No push, fetch, or checkout move (INV-1/INV-3). The only `git` call is
 *     `rev-parse HEAD`, read-only, inside {@link resolveHeadSha}.
 *   - No write of any kind (INV-4). `readRecord` reads the sidecar that
 *     **MinSpec: Approve Spec** already wrote; nothing here writes a record, a
 *     sidecar, or a `status:` line.
 *   - No `base`/`slug` argument to `gh`: it resolves the base repo and ITS
 *     default branch from `rootDir`'s `origin`, which is correct in a repo whose
 *     default branch is not `main` and costs no extra local git call.
 *   - No completing action on the success toast (FR-3/AC-3). The reported defect
 *     is precisely that the last step gets handed back to the human, so the happy
 *     path's notification takes ONE argument and carries no button. VS Code
 *     linkifies the URL in the message text.
 */
async function openApprovalPr(
  rootDir: string,
  result: PushApprovalResult,
  ctx: ApprovalPushContext,
): Promise<{ suffix: string; pr?: OpenPrResult }> {
  // INV-5 — the guard opens HERE, before the first vscode call, not after the
  // early returns. `approvalPrMode()` reads configuration and `manualPrSurface()`
  // shows a notification; both were previously OUTSIDE the try, so a synchronous
  // throw from either escaped this function, propagated through the unguarded
  // awaits in `pushApprovalIfEnabled` and `commitApprovalIfEnabled`, and broke the
  // latter's documented never-rejects contract — surfacing as a failed APPROVAL
  // rather than a failed PR-opening. Caught by the invariant audit on #1224.
  try {
    if (approvalPrMode() === 'manual') return { suffix: manualPrSurface(result) };

    if (!result.branch) {
      console.warn('MinSpec: approval PR skipped — the push seam reported no branch name.');
      return { suffix: manualPrSurface(result, 'branch name unavailable') };
    }
    if (!ctx.subject || !ctx.paths || ctx.paths.length === 0) {
      console.warn(
        'MinSpec: approval PR skipped — the committed paths/subject were not supplied, so the ' +
          'docs-only property (SPEC-050 INV-2) is unproven. Falling back to the manual surface.',
      );
      return { suffix: manualPrSurface(result, 'approval details unavailable') };
    }

    const run = ctx.run ?? defaultExecRun();
    // Normalize ONCE so the label decision, the sidecar lookup and the body all
    // reason over the same strings — on Windows `commitApproval` hands back
    // `path.relative` output with `\` separators, and three call sites each
    // normalizing separately is how they drift apart. Purely a canonicalization:
    // an absolute path or a `..` segment is still refused downstream.
    const paths = ctx.paths.map((p) => toPosixRel(p));
    // INV-2 — the label is decided from what the PR ACTUALLY changes, not from
    // what this approval commit touched. Those differ: the branch is created at
    // local HEAD, so its diff against the base is merge-base..head and may carry
    // earlier local commits. Labelling from `paths` could mark a PR docs-only
    // while it genuinely changed code (#1224 review). `undefined` (range not
    // resolvable) → no label → no auto-merge → a human merges. Fails closed.
    const changed = await branchChangedPaths(run, rootDir, PR_BASE, result.branch);
    const labels = laneLabelsFor(changed);
    const record = readRecord(rootDir, approvableRelPath(paths));
    const sha = await resolveHeadSha(run, rootDir);

    const pr = await openPullRequest({
      run,
      cwd: rootDir,
      head: result.branch,
      title: ctx.subject,
      body: buildApprovalPrBody({ paths, record, sha, labels }),
      labels,
      // FR-6: if an open PR already exists for this head, adopt it rather than
      // fanning out a second one.
      //
      // HONEST SCOPE (#1224 review). The spec's risk table cites FR-6 as the
      // mitigation for R2, "a branch reused across re-approvals fans out duplicate
      // PRs". FR-6 as written does NOT mitigate that, because the premise is false:
      // `approvalBranchName` (approve-push.ts) appends a millisecond-precision
      // stamp specifically so two approvals can never collide, so approval branches
      // are never reused and this probe can never match one. Re-approve the same
      // spec twice and you still get two branches and two PRs.
      //
      // What FR-6 DOES buy is real but narrower: it makes PR-opening idempotent for
      // one head — a retry after a partial failure, or `gh pr create` losing a race
      // — which is why it stays. R2 itself is unmitigated and belongs in a
      // follow-up, not in a comment that quietly implies otherwise.
      adoptExisting: true,
    });

    // A PR whose paths are NOT all docs is still opened — the branch is already
    // pushed, and leaving the developer without a PR would be the worse failure —
    // but it goes UNLABELLED and the suffix says so, so "no auto-merge" is never
    // a silent surprise.
    const laneNote = labels.length === 0 ? ' — not docs-only, so no docs-lane label' : '';

    switch (pr.outcome) {
      case 'created':
        void vscode.window.showInformationMessage(`MinSpec: approval PR opened — ${pr.url}`);
        return { suffix: ` · pushed on ${result.branch} · PR opened${laneNote} (${pr.url})`, pr };
      case 'adopted':
        void vscode.window.showInformationMessage(`MinSpec: approval PR already open — ${pr.url}`);
        return {
          suffix: ` · pushed on ${result.branch} · PR already open (${pr.url})`,
          pr,
        };
      default: {
        if (pr.error) console.warn(`MinSpec: approval PR not opened — ${pr.error}`);
        const reason = PR_FAILURE_REASON[pr.outcome] ?? 'the PR could not be opened';
        return { suffix: manualPrSurface(result, reason), pr };
      }
    }
  } catch (err) {
    // INV-5 backstop. `openPullRequest` never rejects, but `defaultExecRun`,
    // `readRecord` and the body builder are outside its guard — and an approval
    // that IS committed and IS pushed must never be reported as lost because the
    // convenience step threw.
    console.warn(
      `MinSpec: approval PR step threw — ${err instanceof Error ? err.message : String(err)}`,
    );
    // The backstop must not itself be able to throw. `manualPrSurface` touches the
    // vscode API, and if THAT is what failed above, calling it again here would
    // rethrow straight out of the backstop — a guard that fails exactly when it is
    // needed. Fall back to a plain string, which cannot.
    try {
      return { suffix: manualPrSurface(result, 'the PR step failed (see console)') };
    } catch {
      return { suffix: ` · pushed on ${result.branch} (open a PR — the PR step failed)` };
    }
  }
}

/**
 * Push the approval commit, so a sign-off cannot be stranded on one machine
 * (the Alt+A stranding bug: commit-on-approve commits but never pushes, approvals
 * are made on protected `main`, and a direct push there is rejected).
 *
 * OFFLINE INVARIANT (constitution #1). A push is a network call, so:
 *   • `never`  — returns immediately; no git, no network.
 *   • `prompt` — DEFAULT. Shows a NON-MODAL notification and pushes only if the user
 *                clicks. The click is the explicit consent. Dismissing is a no-op,
 *                and the approval is already safely committed locally either way.
 *   • `always` — the user set this deliberately; the setting is the consent.
 *
 * SPEC-050 adds two things on top of that, neither of which widens the boundary:
 *   • FR-8 — the `prompt` notification offers "Always push from now on" ONCE. The
 *     click is the user's own deliberate act of setting `always` in their Global
 *     settings, which is exactly the route DR-071 condition 1 permits; the
 *     CONTRIBUTED default stays `prompt`.
 *   • FR-1/FR-2 — a `pushed-branch` outcome finishes into a docs-lane PR. That
 *     runs strictly AFTER a successful push, so it adds no network act this
 *     function had not already been authorized to perform (INV-1). With `never`,
 *     or a declined prompt, this function returns before any of it.
 *
 * Never rejects: a push failure is surfaced in the suffix, never swallowed, because
 * the user must know the record is still local-only.
 */
export async function pushApprovalIfEnabled(
  rootDir: string,
  slug: string,
  ctx: ApprovalPushContext = {},
): Promise<{ suffix: string; result?: PushApprovalResult; pr?: OpenPrResult }> {
  let mode: PushOnApproveMode;
  try {
    // DR-078 §4: ONE accessor. Project-local preference first, then the VS Code
    // setting — never both read directly at a call site.
    mode = await effectivePushOnApproveMode(rootDir);
  } catch (err) {
    // INV-5 — reading configuration touches the vscode host, which this function's
    // never-rejects contract cannot assume is healthy. Found by the #1224 INV-5
    // regression test, which showed the hole was WIDER than the audit reported:
    // hardening `openApprovalPr` alone still let a throw escape from here.
    //
    // Fails toward `never`: with the host unreadable we cannot prove the user
    // consented, and constitution invariant #1 makes "cannot prove consent" mean
    // "send nothing". A push we are unsure about is the costlier error.
    console.warn(
      `MinSpec: could not read pushOnApprove — treating as 'never'. ${err instanceof Error ? err.message : String(err)}`,
    );
    return { suffix: '' };
  }
  if (mode === 'never') return { suffix: '' };

  if (mode === 'prompt') {
    // Non-modal (project preference: never steal focus from the artifact being
    // approved). `showInformationMessage` with actions is notification-area only.
    //
    // FR-8: the FIRST time only, the standing-consent option rides along. `Push`
    // stays the LEAD action deliberately — DR-071 condition 1 requires the shipped
    // behaviour to be the prompting one, so the escape from prompting must be a
    // deliberate, named, second choice rather than the reflex target.
    const alreadyOffered = await pushAlwaysOfferAlreadyMade(rootDir);
    const actions = alreadyOffered
      ? [PUSH_ACTION, NOT_NOW_ACTION]
      : [PUSH_ACTION, ALWAYS_PUSH_ACTION, NOT_NOW_ACTION];
    const choice = await vscode.window.showInformationMessage(
      'Approval committed locally. Push it so the sign-off is not stranded on this machine?',
      ...actions,
    );
    // Record on EVERY resolution, dismiss included (#883) — that is what makes it
    // show-once rather than show-until-answered-a-particular-way. Deliberate
    // trade-off: if `enableAlwaysPush` below fails to persist, the offer is still
    // spent and the user keeps clicking `Push` per approval. That is a degradation
    // the console warning explains, and it is the lesser evil against re-nagging
    // someone who has already answered.
    if (!alreadyOffered) await recordPushAlwaysOfferMade(rootDir);

    if (choice === ALWAYS_PUSH_ACTION) {
      // Write the standing consent, then FALL THROUGH and push. Returning here
      // would drop the very approval whose prompt the user just answered `yes` to.
      await enableAlwaysPush(rootDir);
    } else if (choice !== PUSH_ACTION) {
      return { suffix: ' · not pushed' };
    }
  }

  // Defensive guard so "never rejects" is a LOCAL guarantee, not one borrowed from
  // pushApproval. `commitApprovalIfEnabled` documents never-rejects and now awaits this
  // function; relying on the seam's contract transitively means a future change there
  // could silently break an approval toast that has nothing to do with pushing.
  let result: PushApprovalResult;
  try {
    result = await pushApproval(rootDir, { protectedBranches: protectedBranches(), slug });
  } catch (err) {
    console.warn(`MinSpec: push-on-approve threw — ${err instanceof Error ? err.message : String(err)}`);
    return { suffix: ' · push failed — still local only (see console)' };
  }
  switch (result.outcome) {
    case 'pushed':
      return { suffix: ' · pushed', result };
    case 'pushed-branch': {
      // SPEC-050: the branch is on the remote and the developer is one browser
      // round-trip plus a PR form away from a record they already signed. Finish
      // the job (FR-2) unless they asked to hand-drive it (FR-1 `manual`), and
      // degrade to exactly the old surface whenever we cannot (FR-5).
      const { suffix, pr } = await openApprovalPr(rootDir, result, ctx);
      return { suffix, result, pr };
    }
    case 'failed':
      console.warn(`MinSpec: push-on-approve failed — ${result.error ?? 'git error'}`);
      return { suffix: ' · push failed — still local only (see console)', result };
    default:
      // 'skipped' | 'not-a-repo' — nothing was pushable; the commit path already
      // reported the relevant condition.
      return { suffix: '', result };
  }
}

/**
 * Give `filePath` its OWN commit right now, if (and only if) it has no
 * committed version at HEAD — used before an ADR acceptance (issue #577).
 *
 * `applyStatus` (commands/adr.ts) flips a DR's frontmatter to a terminal
 * status (e.g. `accepted`) BEFORE the accept commit runs. If the DR was
 * created but never committed, that accept commit would stage it as a
 * brand-new ADDED file already claiming the terminal status — exactly what
 * the DR-029 born-proposed pre-commit gate (`.githooks/pre-commit`) exists to
 * reject (a DR must be born `proposed`/`draft`; acceptance is a separate,
 * later act). Committing the file's CURRENT (pre-flip) content here first
 * turns the later accept commit into a legitimate Modify instead of the
 * file's first-ever commit.
 *
 * The git hook is the actual arbiter, not this function: if the pre-flip
 * content isn't a validly-born DR, the hook rejects this commit too and the
 * caller's own commit attempt fails exactly as it would without this helper —
 * no gate logic is duplicated here.
 *
 * No-op (returns undefined, no git call) when the setting is off or the file
 * already has a HEAD version.
 */
export async function commitBornIfUntracked(
  rootDir: string,
  filePath: string,
  message: string,
): Promise<CommitApprovalResult | undefined> {
  if (!commitOnApproveEnabled()) return undefined;
  if (!(await isUntrackedAtHead(rootDir, filePath))) return undefined;
  const result = await commitApproval(rootDir, [filePath], message);
  if (result.outcome === 'failed') {
    console.warn(`MinSpec: born commit failed — ${result.error ?? 'git error'}`);
  }
  return result;
}
