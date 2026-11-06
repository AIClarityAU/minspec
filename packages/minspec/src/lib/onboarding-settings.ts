/**
 * SPEC-042 - the pure view model behind `MinSpec: Getting Started`.
 *
 * No `vscode` import and no network: it is a faithful, offline view onto the settings
 * `contributes.configuration` already declares, plus per-click actions. The webview and
 * the command layer inject everything that touches the editor or the machine, so this
 * file can be tested without either.
 *
 * Nothing here models a progress meter or a completion tally: a score over items the page
 * itself calls optional trains the rubber-stamping the constitution forbids (INV-2).
 */

export type RowKind = 'toggle' | 'field' | 'multi' | 'action';
export type RowTier = 'required' | 'recommended' | 'optional';

export interface OnboardingRow {
  /** Stable key for the DOM and for webview messages. */
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** The real contributed key, e.g. `minspec.commitOnApprove`. Undefined for pure actions. */
  readonly settingId?: string;
  /** The real registered command an `action` row dispatches on click. */
  readonly commandId?: string;
  /** Extra argument forwarded after the folder when the command is dispatched. */
  readonly commandArg?: unknown;
  /** A page-owned action that is not a registered command (the GitHub PR extension install). */
  readonly actionId?: 'installGitHubPrExtension';
  /** A second control on the row (the approver row's "Verify against GitHub"). */
  readonly secondaryActionId?: 'verifyGitHub';
  readonly buttonLabel?: string;
  readonly tier: RowTier;
  readonly kind: RowKind;
  /** True: rendered disabled with a "Planned" tag, never as a live no-op (INV-5). */
  readonly planned?: boolean;
  readonly plannedRef?: string;
  /** Shown beside the row when a keybinding exists. Never invented. */
  readonly hotkey?: string;
  /** Derived (D7): true only for a non-planned single boolean toggle with no second control. */
  readonly rowClickToggles: boolean;
  /** The current value: boolean for a toggle, number for coverage, string for the email. */
  readonly value?: boolean | number | string;
  /** The preference key a "Not now" on this row is remembered under (#883). */
  readonly dismissKey?: DismissKey;
}

/** The two rows whose offers have a state signature in `BOOTSTRAP_STEPS`. */
export type DismissKey = 'skipRefreshPrompt' | 'skipBackfillPrompt';

export interface OnboardingModel {
  readonly hero: { readonly commandId: 'minspec.init'; readonly label: 'Initialize SDD structure'; readonly hotkey?: string };
  /** The four-point framing. There is deliberately no progress field (INV-2). */
  readonly primer: readonly [string, string, string, string];
  readonly rows: readonly OnboardingRow[];
  /** Footer controls (FR-13). */
  readonly footer: readonly OnboardingRow[];
  readonly showSettingIds: boolean;
}

export const PRIMER: OnboardingModel['primer'] = [
  'Ceremony matches blast radius: a one-line fix needs one sentence of spec.',
  'Verify the signal, not the content: MinSpec suggests, you decide.',
  'One next step, never a list: the signpost computes it the same way every time.',
  'Decisions are deterministic: the same state gives the same answer.',
];

/**
 * Verbatim to the contributed description of `minspec.coverage.minimumPercentage` (FR-11),
 * so the page never implies enforcement the extension does not perform. A test pins the
 * equality against `package.json`.
 */
export const COVERAGE_HELPER =
  "Recommended minimum code coverage percentage. This setting only sets the pre-selected value in the 'MinSpec: Initialize SDD Structure' onboarding prompt (e.g. set it in a committed .vscode/settings.json to encode a team policy) — it does NOT itself change an already-initialized project's enforced threshold. The value CI and vitest actually enforce lives in .minspec/config.json's coverage.minimumPercentage; change an existing project by editing that file directly, or by re-running the onboarding prompt.";

/**
 * The fallback used when a setting is unreadable. Pinned to `package.json` by a test, so a
 * default changed in the manifest cannot drift from what the page shows.
 */
export const SETTING_DEFAULTS = {
  'minspec.autoClassifyOnCommit': false,
  'minspec.commitOnApprove': true,
  'minspec.advancePhaseOnApprove': true,
  'minspec.autoBootstrap.enabled': true,
  'minspec.coverage.minimumPercentage': 80,
  'minspec.approverEmail': '',
} as const;

export interface OnboardingInputs {
  /** Reads the EFFECTIVE value of a contributed setting (the caller applies project-local precedence). */
  readonly readSetting: <T>(settingId: string, fallback: T) => T;
  /** Offline `resolveApproverEmail` result (`minspec.approverEmail`, else local git config). */
  readonly approverSeed: string;
  /** command id -> key label, built from the manifest's real `keybindings`. */
  readonly hotkeys?: Readonly<Record<string, string>>;
  /** `answeredSignatures` from `.minspec/preferences.json` (#883). */
  readonly answered?: Readonly<Record<string, string>>;
  /** The CURRENT state signature for a dismissable offer. */
  readonly signatureFor?: (key: DismissKey) => string;
  readonly showSettingIds?: boolean;
}

/** D7: only a non-planned single boolean toggle with no second control is whole-row clickable. */
export function deriveRowClickToggles(row: {
  readonly kind: RowKind;
  readonly planned?: boolean;
  readonly secondaryActionId?: string;
  readonly commandId?: string;
  readonly actionId?: string;
}): boolean {
  return (
    row.kind === 'toggle' &&
    !row.planned &&
    !row.secondaryActionId &&
    !row.commandId &&
    !row.actionId
  );
}

type RowSpec = Omit<OnboardingRow, 'rowClickToggles'>;

function withClick(spec: RowSpec): OnboardingRow {
  return { ...spec, rowClickToggles: deriveRowClickToggles(spec) };
}

/** Whether a dismissed offer is still dismissed: its state signature has not moved (INV-3). */
export function isDismissed(
  key: DismissKey,
  answered: Readonly<Record<string, string>> | undefined,
  signatureFor: ((key: DismissKey) => string) | undefined,
): boolean {
  if (!answered || !signatureFor) return false;
  const recorded = answered[key];
  return recorded !== undefined && recorded === signatureFor(key);
}

export function buildOnboardingModel(inputs: OnboardingInputs): OnboardingModel {
  const { readSetting, hotkeys = {}, answered, signatureFor } = inputs;
  const bool = (id: keyof typeof SETTING_DEFAULTS): boolean =>
    readSetting<boolean>(id, SETTING_DEFAULTS[id] as boolean);
  const hot = (commandId: string | undefined): string | undefined =>
    commandId ? hotkeys[commandId] : undefined;

  const rows: OnboardingRow[] = [];

  // FR-4: silentRefresh is planned (#186) and is not a contributed setting, so it is never writable.
  rows.push(
    withClick({
      id: 'silentRefresh',
      label: 'Silent harness refresh',
      description: 'Refresh harness files automatically when templates change.',
      settingId: 'minspec.silentRefresh',
      tier: 'recommended',
      kind: 'toggle',
      planned: true,
      plannedRef: '#186',
    }),
  );

  // FR-16: a manual per-click refresh, distinct from the planned silentRefresh switch.
  if (!isDismissed('skipRefreshPrompt', answered, signatureFor)) {
    rows.push(
      withClick({
        id: 'refreshNow',
        label: 'Refresh harness now',
        description: 'Merge the latest harness templates into this project.',
        commandId: 'minspec.initRefresh',
        buttonLabel: 'Refresh now',
        tier: 'recommended',
        kind: 'action',
        hotkey: hot('minspec.initRefresh'),
        dismissKey: 'skipRefreshPrompt',
      }),
    );
  }

  rows.push(
    withClick({
      id: 'autoClassifyOnCommit',
      label: 'Classify on commit',
      description: 'Run Classify Task Complexity after each commit.',
      settingId: 'minspec.autoClassifyOnCommit',
      tier: 'recommended',
      kind: 'toggle',
      value: bool('minspec.autoClassifyOnCommit'),
      hotkey: hot('minspec.classify'),
    }),
    withClick({
      id: 'commitOnApprove',
      label: "Commit MinSpec's own changes",
      description:
        "Commit MinSpec's own changes (approvals + harness refreshes); never pushed automatically. " +
        'Approvals are covered today; harness-refresh coverage is tracked in #758.',
      settingId: 'minspec.commitOnApprove',
      tier: 'recommended',
      kind: 'toggle',
      value: bool('minspec.commitOnApprove'),
    }),
    withClick({
      id: 'advancePhaseOnApprove',
      label: 'Advance phase on approve',
      description: 'Enqueue a phase-advance request when you approve a spec. Enqueue-only.',
      settingId: 'minspec.advancePhaseOnApprove',
      tier: 'recommended',
      kind: 'toggle',
      value: bool('minspec.advancePhaseOnApprove'),
    }),
    withClick({
      id: 'approverEmail',
      label: 'Approver email',
      description: 'Your explicit human identity for recording approvals.',
      settingId: 'minspec.approverEmail',
      tier: 'recommended',
      kind: 'field',
      value: inputs.approverSeed,
      secondaryActionId: 'verifyGitHub',
      buttonLabel: 'Verify against GitHub',
    }),
  );

  // FR-8: a per-click button. `minspec.autoBackfillUseAi` is deliberately never a row.
  if (!isDismissed('skipBackfillPrompt', answered, signatureFor)) {
    rows.push(
      withClick({
        id: 'backfillEpics',
        label: 'Backfill epics with AI',
        description:
          'Runs your own `claude` command, which sends the ids and titles of your specs, decisions and epics to the model provider it is set up with. Fires only when you click.',
        commandId: 'minspec.backfillEpics',
        commandArg: { aiConsent: true },
        buttonLabel: 'Backfill with AI',
        tier: 'optional',
        kind: 'action',
        hotkey: hot('minspec.backfillEpics'),
        dismissKey: 'skipBackfillPrompt',
      }),
    );
  }

  rows.push(
    withClick({
      id: 'installGitHubPrExtension',
      label: 'Install GitHub PR extension',
      description: 'Review and merge pull requests from the editor. Installs only when you click.',
      actionId: 'installGitHubPrExtension',
      buttonLabel: 'Install',
      tier: 'optional',
      kind: 'action',
    }),
    withClick({
      id: 'coverageMinimum',
      label: 'Coverage minimum %',
      description: COVERAGE_HELPER,
      settingId: 'minspec.coverage.minimumPercentage',
      tier: 'optional',
      kind: 'field',
      value: readSetting<number>(
        'minspec.coverage.minimumPercentage',
        SETTING_DEFAULTS['minspec.coverage.minimumPercentage'],
      ),
    }),
  );

  const footer: OnboardingRow[] = [
    withClick({
      id: 'autoBootstrapEnabled',
      label: 'Offer setup automatically on activation',
      description: 'Off = this page opens only on demand.',
      settingId: 'minspec.autoBootstrap.enabled',
      tier: 'optional',
      kind: 'toggle',
      value: bool('minspec.autoBootstrap.enabled'),
    }),
  ];

  return {
    hero: { commandId: 'minspec.init', label: 'Initialize SDD structure', hotkey: hot('minspec.init') },
    primer: PRIMER,
    rows,
    footer,
    showSettingIds: inputs.showSettingIds ?? false,
  };
}

// ─── Approver identity (D4) ──────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** What `gh api user` returned, after a click on "Verify against GitHub". */
export interface GhIdentity {
  readonly login: string;
  readonly id?: number;
  /** Null when the account keeps its email private. */
  readonly email?: string | null;
}

/** Parse `gh api user` stdout. Null on anything that is not a login-bearing object. */
export function parseGhUser(stdout: string): GhIdentity | null {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.login !== 'string' || !parsed.login) {
      return null;
    }
    return {
      login: parsed.login,
      id: typeof parsed.id === 'number' ? parsed.id : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : null,
    };
  } catch {
    return null;
  }
}

export interface ApproverIdentity {
  /** Render-time value: the offline seed, or what the user has typed since. */
  readonly value: string;
  /** Null until the user clicks "Verify against GitHub", and null again if that read failed. */
  readonly ghLogin: string | null;
  readonly valid: boolean;
  /** Valid, verified, and not any email GitHub knows this login by. Non-blocking, never a rejection. */
  readonly divergesFromGh: boolean;
}

/**
 * Does `email` belong to the verified GitHub account? An email never equals a login, so the
 * comparison is against the addresses GitHub itself attributes to that account: its public
 * email, and its two noreply forms.
 */
export function emailMatchesGh(email: string, gh: GhIdentity): boolean {
  const e = email.trim().toLowerCase();
  const login = gh.login.toLowerCase();
  const known = [`${login}@users.noreply.github.com`];
  if (gh.id !== undefined) known.push(`${gh.id}+${login}@users.noreply.github.com`);
  if (gh.email) known.push(gh.email.toLowerCase());
  return known.includes(e);
}

export function computeApproverIdentity(value: string, gh: GhIdentity | null): ApproverIdentity {
  const valid = isValidEmail(value);
  return {
    value,
    ghLogin: gh ? gh.login : null,
    valid,
    divergesFromGh: gh !== null && valid && !emailMatchesGh(value, gh),
  };
}

/** `gitConfigEmail` answers the literal 'unknown' when there is no identity; the field shows blank. */
export function seedForField(resolved: string): string {
  return resolved === 'unknown' ? '' : resolved;
}
