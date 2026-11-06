import * as crypto from 'crypto';
import * as vscode from 'vscode';
import {
  buildOnboardingModel,
  computeApproverIdentity,
  isValidEmail,
  type ApproverIdentity,
  type DismissKey,
  type GhIdentity,
  type OnboardingModel,
  type OnboardingRow,
} from '../lib/onboarding-settings';

/**
 * SPEC-042 - the `MinSpec: Getting Started` page.
 *
 * Three layers, so the invariants can be tested without an editor:
 *   - `renderGettingStartedHtml`: a pure string builder. Strict CSP, theme tokens only, no
 *     remote resource, so zero network on render holds by construction (INV-1).
 *   - `OnboardingPage`: the controller. Every effect (config write, command dispatch,
 *     `gh`, preferences) is injected through `PageDeps`, and none runs until a message
 *     asks for it. Rendering reads and never writes.
 *   - `GettingStartedPanel`: the thin `vscode.WebviewPanel` wrapper.
 */

// ─── Messages from the webview ───────────────────────────────────────────────

export type PageMessage =
  | { readonly type: 'run'; readonly rowId?: string; readonly hero?: boolean }
  | { readonly type: 'toggle'; readonly settingId: string; readonly value: boolean }
  | { readonly type: 'setField'; readonly settingId: string; readonly value: string }
  | { readonly type: 'verifyGitHub' }
  | { readonly type: 'openSetting'; readonly settingId: string }
  | { readonly type: 'dismiss'; readonly rowId: string }
  | { readonly type: 'showIds'; readonly value: boolean };

/** Everything that touches the editor or the machine. Injected; nothing runs on render. */
export interface PageDeps {
  readonly rootDir: string;
  readonly readSetting: <T>(settingId: string, fallback: T) => T;
  readonly writeSetting: (settingId: string, value: boolean | number | string) => Promise<void>;
  readonly runCommand: (commandId: string, ...args: unknown[]) => Promise<unknown>;
  readonly installGitHubPrExtension: () => Promise<void>;
  /** Offline: `resolveApproverEmail` (setting, else local git config). */
  readonly seedEmail: () => string;
  /**
   * The click-gated `gh api user` read. Null when `gh` is absent, signed out, or offline.
   * OPTIONAL: the production command does not supply it yet (a new `gh` caller needs a README
   * network row and a spawn-allowlist entry, both outside SPEC-042's file allowlist), and with
   * no lookup the page renders no "Verify against GitHub" button rather than a dead one.
   */
  readonly lookupGhIdentity?: () => Promise<GhIdentity | null>;
  /** Open the Settings editor at one setting. Navigation only: it writes nothing. */
  readonly openSettingsEditor: (settingId: string) => Promise<void>;
  readonly hotkeys: Readonly<Record<string, string>>;
  readonly signatureFor: (key: DismissKey) => string;
  /** `answeredSignatures` from `.minspec/preferences.json`. */
  readonly loadAnswered: () => Readonly<Record<string, string>>;
  /** Persist one answered signature through the #883 store. */
  readonly saveAnswered: (key: DismissKey, signature: string) => void;
  /** Whether the folder has opted in (`.minspec/`). A dismissal is only remembered when it has. */
  readonly isOptedIn: () => boolean;
}

export interface PageView {
  readonly model: OnboardingModel;
  readonly identity: ApproverIdentity;
  /** Format error shown under the email field. */
  readonly emailError?: string;
  readonly fieldError?: string;
  readonly notice?: string;
  readonly canDismiss: boolean;
  readonly canVerify: boolean;
  readonly verified: boolean;
}

export const DIVERGENCE_COPY =
  "differs from your GitHub login — approvals under this email can't be auto-verified.";

export class OnboardingPage {
  private emailDraft: string | undefined;
  private gh: GhIdentity | null = null;
  private verified = false;
  private emailError: string | undefined;
  private fieldError: string | undefined;
  private notice: string | undefined;
  private showIds = false;

  constructor(private readonly deps: PageDeps) {}

  /** Build the current view. Reads settings and the offline seed; performs no write and no network. */
  view(): PageView {
    const model = buildOnboardingModel({
      readSetting: this.deps.readSetting,
      approverSeed: this.emailValue(),
      hotkeys: this.deps.hotkeys,
      answered: this.deps.loadAnswered(),
      signatureFor: this.deps.signatureFor,
      showSettingIds: this.showIds,
    });
    return {
      model,
      identity: computeApproverIdentity(this.emailValue(), this.gh),
      emailError: this.emailError,
      fieldError: this.fieldError,
      notice: this.notice,
      canDismiss: this.deps.isOptedIn(),
      canVerify: this.deps.lookupGhIdentity !== undefined,
      verified: this.verified,
    };
  }

  private emailValue(): string {
    return this.emailDraft ?? this.deps.seedEmail();
  }

  private rowById(id: string): OnboardingRow | undefined {
    const { model } = this.view();
    return [...model.rows, ...model.footer].find((r) => r.id === id);
  }

  /** Handle one message from the webview. Unknown or malformed messages are ignored. */
  async handle(message: unknown): Promise<void> {
    this.notice = undefined;
    this.fieldError = undefined;
    const msg = message as Partial<PageMessage> & { type?: string };
    switch (msg?.type) {
      case 'run':
        return this.run(msg as Extract<PageMessage, { type: 'run' }>);
      case 'toggle':
        return this.toggle(msg as Extract<PageMessage, { type: 'toggle' }>);
      case 'setField':
        return this.setField(msg as Extract<PageMessage, { type: 'setField' }>);
      case 'verifyGitHub':
        return this.verify();
      case 'openSetting':
        return this.openSetting(msg as Extract<PageMessage, { type: 'openSetting' }>);
      case 'dismiss':
        return this.dismiss(msg as Extract<PageMessage, { type: 'dismiss' }>);
      case 'showIds':
        this.showIds = (msg as { value?: unknown }).value === true;
        return;
      default:
        return;
    }
  }

  private async run(msg: Extract<PageMessage, { type: 'run' }>): Promise<void> {
    if (msg.hero === true) {
      await this.deps.runCommand('minspec.init', this.deps.rootDir);
      return;
    }
    const row = typeof msg.rowId === 'string' ? this.rowById(msg.rowId) : undefined;
    if (!row || row.kind !== 'action') return;
    if (row.actionId === 'installGitHubPrExtension') {
      // The click is the consent (FR-17): the install runs with no second prompt.
      await this.deps.installGitHubPrExtension();
      return;
    }
    if (row.commandId) {
      const args: unknown[] = [this.deps.rootDir];
      if (row.commandArg !== undefined) args.push(row.commandArg);
      await this.deps.runCommand(row.commandId, ...args);
    }
  }

  private async toggle(msg: Extract<PageMessage, { type: 'toggle' }>): Promise<void> {
    if (typeof msg.value !== 'boolean') return;
    // The webview is not trusted to name an arbitrary key: only a toggle row this model owns.
    const row = [...this.view().model.rows, ...this.view().model.footer].find(
      (r) => r.settingId === msg.settingId,
    );
    if (!row || row.kind !== 'toggle' || row.planned || !row.settingId) return;
    await this.deps.writeSetting(row.settingId, msg.value);
  }

  private async setField(msg: Extract<PageMessage, { type: 'setField' }>): Promise<void> {
    if (typeof msg.value !== 'string') return;
    if (msg.settingId === 'minspec.approverEmail') {
      // `minspec.approverEmail` is `scope: application`, so setting it is a machine-wide write, and
      // constitution invariant 3 (DR-078 section 3) forbids MinSpec making one - a click does not
      // change that. The field therefore checks what you type (format, and the GitHub comparison
      // when a lookup exists) and hands the actual save to the Settings editor. It writes nothing,
      // and it never touches an approval record (INV-4); DR-056 still adjudicates at approve time.
      const value = msg.value.trim();
      this.emailDraft = value;
      this.emailError =
        value !== '' && !isValidEmail(value)
          ? 'Enter a valid email address, e.g. you@example.com.'
          : undefined;
      if (!this.emailError && value !== '' && value !== this.deps.seedEmail()) {
        this.notice =
          'Not saved here: this is a personal, machine-wide setting, which MinSpec does not write. ' +
          'Use "Open in Settings" to save it.';
      }
      return;
    }
    if (msg.settingId === 'minspec.coverage.minimumPercentage') {
      const n = Number(msg.value);
      if (msg.value.trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
        this.fieldError = 'Enter a number from 0 to 100.';
        return;
      }
      await this.deps.writeSetting('minspec.coverage.minimumPercentage', n);
    }
  }

  private async openSetting(msg: Extract<PageMessage, { type: 'openSetting' }>): Promise<void> {
    // Only the one field this page edits on the user's behalf; the webview names no other key.
    if (msg.settingId !== 'minspec.approverEmail') return;
    await this.deps.openSettingsEditor(msg.settingId);
  }

  private async verify(): Promise<void> {
    if (!this.deps.lookupGhIdentity) return;
    let result: GhIdentity | null = null;
    try {
      result = await this.deps.lookupGhIdentity();
    } catch {
      result = null;
    }
    this.gh = result;
    this.verified = result !== null;
    if (result === null) {
      this.notice = 'Could not reach GitHub through gh. The offline value stands.';
    }
  }

  private async dismiss(msg: Extract<PageMessage, { type: 'dismiss' }>): Promise<void> {
    const row = typeof msg.rowId === 'string' ? this.rowById(msg.rowId) : undefined;
    if (!row?.dismissKey || !this.deps.isOptedIn()) return;
    // The #883 store: remember the CURRENT state signature, so the row returns when that state moves.
    this.deps.saveAnswered(row.dismissKey, this.deps.signatureFor(row.dismissKey));
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hotkeyHtml(row: { hotkey?: string }): string {
  return row.hotkey ? ` <kbd class="hotkey" title="Keyboard shortcut">${escapeHtml(row.hotkey)}</kbd>` : '';
}

function idHtml(row: OnboardingRow): string {
  const id = row.settingId ?? row.commandId;
  return id ? ` <code class="setting-id">${escapeHtml(id)}</code>` : '';
}

function renderRow(row: OnboardingRow, view: PageView): string {
  const label = `<span class="label">${escapeHtml(row.label)}</span>${hotkeyHtml(row)}${idHtml(row)}`;
  const desc = row.description ? `<div class="desc">${escapeHtml(row.description)}</div>` : '';
  const clickable = row.rowClickToggles ? ' data-rowclick="1"' : '';
  const open = `<div class="row" data-row="${escapeHtml(row.id)}"${clickable}>`;

  if (row.planned) {
    return (
      `${open}<div class="main">${label} <span class="tag planned">Planned${
        row.plannedRef ? ` · ${escapeHtml(row.plannedRef)}` : ''
      }</span>${desc}</div>` +
      `<button class="switch" role="switch" aria-checked="false" aria-disabled="true" disabled></button></div>`
    );
  }

  if (row.kind === 'toggle') {
    const on = row.value === true;
    return (
      `${open}<div class="main">${label}${desc}</div>` +
      `<button class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(row.label)}" ` +
      `data-act="toggle" data-setting="${escapeHtml(row.settingId)}"></button></div>`
    );
  }

  if (row.kind === 'action') {
    const dismiss =
      row.dismissKey && view.canDismiss
        ? ` <button class="link" data-act="dismiss" data-row-id="${escapeHtml(row.id)}">Not now</button>`
        : '';
    return (
      `${open}<div class="main">${label}${desc}</div>` +
      `<div class="controls"><button data-act="run" data-row-id="${escapeHtml(row.id)}">${escapeHtml(row.buttonLabel ?? row.label)}</button>${dismiss}</div></div>`
    );
  }

  if (row.id === 'approverEmail') {
    const { identity } = view;
    const err = view.emailError ? `<div class="error" role="alert">${escapeHtml(view.emailError)}</div>` : '';
    const amber =
      identity.divergesFromGh && !view.emailError
        ? `<div class="amber" role="status">⚠ ${escapeHtml(DIVERGENCE_COPY)}</div>`
        : '';
    const ok = view.verified && !identity.divergesFromGh && identity.valid
      ? `<div class="ok" role="status">Matches your GitHub account (${escapeHtml(identity.ghLogin)}).</div>`
      : '';
    const note = view.notice ? `<div class="desc" role="status">${escapeHtml(view.notice)}</div>` : '';
    return (
      `${open}<div class="main">${label}${desc}` +
      `<input type="email" id="approverEmail" data-act="field" data-setting="minspec.approverEmail" value="${escapeHtml(identity.value)}" aria-label="Approver email" />` +
      `${err}${amber}${ok}${note}</div>` +
      `<div class="controls"><button data-act="openSetting" data-setting="minspec.approverEmail">Open in Settings</button>` +
      (view.canVerify
        ? ` <button data-act="verifyGitHub">${escapeHtml(row.buttonLabel ?? 'Verify against GitHub')}</button>`
        : '') +
      `</div></div>`
    );
  }

  // Remaining field row: the coverage seed.
  const err = view.fieldError ? `<div class="error" role="alert">${escapeHtml(view.fieldError)}</div>` : '';
  return (
    `${open}<div class="main">${label}<div class="desc">${escapeHtml(row.description ?? '')}</div>` +
    `<input type="number" min="0" max="100" data-act="field" data-setting="${escapeHtml(row.settingId)}" value="${escapeHtml(row.value)}" aria-label="${escapeHtml(row.label)}" />${err}</div></div>`
  );
}

const TIER_TITLES: Record<string, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
};

const STYLE = `
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 1rem 1.5rem; max-width: 52rem; }
h1 { font-size: 1.4em; margin: 0 0 .25rem; }
h2 { font-size: .8em; letter-spacing: .08em; text-transform: uppercase; opacity: .75; margin: 1.5rem 0 .4rem; }
.banner { opacity: .7; font-size: .85em; margin-bottom: .75rem; }
.primer { margin: .5rem 0 1rem; padding-left: 1.2rem; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .5rem .6rem; border-bottom: 1px solid var(--vscode-widget-border, transparent); }
.row[data-rowclick="1"] { cursor: pointer; }
.row[data-rowclick="1"]:hover { background: var(--vscode-list-hoverBackground); }
.hero { font-size: 1.05em; }
.desc { opacity: .75; font-size: .85em; margin-top: .15rem; }
.tag.planned { border: 1px solid var(--vscode-descriptionForeground); border-radius: 3px; padding: 0 .35rem; font-size: .75em; }
.amber { color: var(--vscode-editorWarning-foreground); margin-top: .25rem; font-size: .85em; }
.error { color: var(--vscode-errorForeground); margin-top: .25rem; font-size: .85em; }
.ok { opacity: .8; margin-top: .25rem; font-size: .85em; }
.setting-id { display: none; opacity: .7; font-size: .8em; }
body.show-ids .setting-id { display: inline; }
kbd.hotkey { border: 1px solid var(--vscode-widget-border, var(--vscode-descriptionForeground)); border-radius: 3px; padding: 0 .3rem; font-size: .8em; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: .3rem .7rem; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
button.link { background: none; color: var(--vscode-textLink-foreground); padding: .3rem .4rem; }
button.switch { width: 2.4rem; height: 1.2rem; border-radius: .6rem; background: var(--vscode-input-background); border: 1px solid var(--vscode-focusBorder); padding: 0; flex: none; }
button.switch.on { background: var(--vscode-button-background); }
button:disabled { opacity: .5; cursor: not-allowed; }
input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: .25rem .4rem; margin-top: .3rem; min-width: 16rem; }
.footer { margin-top: 1.5rem; border-top: 1px solid var(--vscode-widget-border, transparent); }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
function post(m) { vscode.postMessage(m); }
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const btn = t.closest('button[data-act]');
  if (btn && !btn.disabled) {
    const act = btn.dataset.act;
    if (act === 'toggle') post({ type: 'toggle', settingId: btn.dataset.setting, value: btn.getAttribute('aria-checked') !== 'true' });
    else if (act === 'run') post({ type: 'run', rowId: btn.dataset.rowId });
    else if (act === 'hero') post({ type: 'run', hero: true });
    else if (act === 'verifyGitHub') post({ type: 'verifyGitHub' });
    else if (act === 'openSetting') post({ type: 'openSetting', settingId: btn.dataset.setting });
    else if (act === 'dismiss') post({ type: 'dismiss', rowId: btn.dataset.rowId });
    else if (act === 'showIds') {
      const on = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(on));
      btn.classList.toggle('on', on);
      document.body.classList.toggle('show-ids', on);
      post({ type: 'showIds', value: on });
    }
    return;
  }
  // Whole-row click: only rows the model marked as a single boolean toggle (FR-10).
  const row = t.closest('.row[data-rowclick="1"]');
  if (row && !t.closest('input, button, a')) {
    const sw = row.querySelector('button[data-act="toggle"]');
    if (sw) sw.click();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.dataset.act === 'field') {
    post({ type: 'setField', settingId: t.dataset.setting, value: t.value });
  }
});
`;

/** Pure: the whole page. No script or style comes from anywhere but this string (strict CSP). */
export function renderGettingStartedHtml(view: PageView, nonce: string, cspSource = ''): string {
  const { model } = view;
  const csp =
    `default-src 'none'; style-src 'nonce-${nonce}'${cspSource ? ` ${cspSource}` : ''}; ` +
    `script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; font-src 'none'`;

  const primer = model.primer.map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  const section = (tier: 'recommended' | 'optional') => {
    const rows = model.rows.filter((r) => r.tier === tier).map((r) => renderRow(r, view));
    return rows.length
      ? `<section aria-label="${TIER_TITLES[tier]}"><h2>${TIER_TITLES[tier]}</h2>${rows.join('')}</section>`
      : '';
  };
  const showIds = model.showSettingIds;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MinSpec · Getting Started</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body${showIds ? ' class="show-ids"' : ''}>
<h1>MinSpec · Getting Started</h1>
<div class="banner">Phase-2 · public polish. Every choice here is also a setting you can change later.</div>
<div><strong>How MinSpec works</strong><ul class="primer">${primer}</ul></div>
<section aria-label="Required"><h2>Required</h2>
<div class="row hero" data-row="hero"><div class="main"><span class="label">${escapeHtml(model.hero.label)}</span>${hotkeyHtml(model.hero)} <code class="setting-id">${escapeHtml(model.hero.commandId)}</code>
<div class="desc">Creates .minspec/, the specs folder and the default configuration.</div></div>
<div class="controls"><button data-act="hero">Run</button></div></div></section>
${section('recommended')}
${section('optional')}
<section class="footer" aria-label="Page controls">
${model.footer.map((r) => renderRow(r, view)).join('')}
<div class="row" data-row="showSettingIds"><div class="main"><span class="label">Show setting ids</span></div>
<button class="switch${showIds ? ' on' : ''}" role="switch" aria-checked="${showIds}" aria-label="Show setting ids" data-act="showIds"></button></div>
</section>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

export function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (const b of crypto.randomBytes(32)) out += chars.charAt(b % chars.length);
  return out;
}

// ─── The panel ───────────────────────────────────────────────────────────────

/** One re-openable panel (FR-1): reveal it if it is open, create it if not. Never a modal. */
export class GettingStartedPanel {
  private panel: vscode.WebviewPanel | undefined;
  /** The page the panel currently shows; the message listener reads this, never a captured arg. */
  private page: OnboardingPage | undefined;
  private disposables: vscode.Disposable[] = [];

  show(page: OnboardingPage): void {
    this.page = page;
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'minspecGettingStarted',
        'MinSpec: Getting Started',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.page = undefined;
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
      });
      this.panel.webview.onDidReceiveMessage(
        async (message) => {
          const current = this.page;
          if (!current) return;
          try {
            await current.handle(message);
          } catch (err) {
            void vscode.window.showErrorMessage(
              `MinSpec: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          this.render(current);
        },
        undefined,
        this.disposables,
      );
    }
    this.render(page);
  }

  private render(page: OnboardingPage): void {
    if (!this.panel) return;
    this.panel.webview.html = renderGettingStartedHtml(
      page.view(),
      makeNonce(),
      this.panel.webview.cspSource,
    );
  }
}
