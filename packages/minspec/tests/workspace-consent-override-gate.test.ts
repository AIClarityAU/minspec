import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// The committed workspace file must not pin `minspec.pushOnApprove` at ANY value.
//
// VS Code resolves workspace settings ABOVE user settings, so this key in
// `.vscode/settings.json` silently overrides the personal `"always"` that DR-071
// directs a user to put in their own settings. The override is invisible at the
// point of failure: the approval still commits and still creates the
// `approvals/…` branch — only the push never runs, and nothing reports it.
//
// That is what stranded 9 local `approvals/*` branches between 2026-08-14 and
// 2026-08-19 on a machine whose user settings said `"always"` (#1021). Seven of
// them were pure cruft whose content had landed by another route, which
// camouflaged the two genuinely un-landed sign-offs.
//
// Pinning `"prompt"` looks harmless because `"prompt"` is also the declared
// default — that is exactly why it kept getting re-added. This gate exists
// because the prose comment in the settings file is model-trusted and drifts;
// the constitution's rule is enforce, don't trust the model.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKSPACE_SETTINGS = path.join(REPO_ROOT, '.vscode', 'settings.json');

/** Strip `//` line comments without mangling `//` that appears inside a string. */
function stripJsoncComments(src: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

function readWorkspaceSettings(): Record<string, unknown> {
  const raw = fs.readFileSync(WORKSPACE_SETTINGS, 'utf8');
  const noComments = stripJsoncComments(raw);
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailingCommas) as Record<string, unknown>;
}

describe('committed workspace settings do not override personal consent', () => {
  it('parses as JSONC', () => {
    expect(() => readWorkspaceSettings()).not.toThrow();
  });

  it('does not set minspec.pushOnApprove at any value', () => {
    const settings = readWorkspaceSettings();
    const present = Object.prototype.hasOwnProperty.call(settings, 'minspec.pushOnApprove');
    expect(
      present
        ? `.vscode/settings.json sets "minspec.pushOnApprove": ${JSON.stringify(
            settings['minspec.pushOnApprove'],
          )}. Remove the key. A workspace value outranks user settings, so ANY value here — "prompt" included, since it merely restates the default — silently disables the standing consent DR-071 tells users to configure personally (#1021, #1022).`
        : null,
    ).toBeNull();
  });
});
