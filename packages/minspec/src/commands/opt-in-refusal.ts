import * as vscode from 'vscode';
import { NotOptedInError } from '../lib/opt-in';

/**
 * Show a store's opt-in refusal as MinSpec's own error message (SPEC-096 FR-8).
 *
 * Returns true when `err` was a {@link NotOptedInError} and its message was
 * shown; the caller then returns without a success message. Returns false,
 * having shown nothing, for any other error, so the caller can rethrow it.
 *
 * Lives outside `lib/` because it imports `vscode`; `lib/opt-in.ts` must stay
 * free of it (SPEC-096 FR-1).
 */
export function showedOptInRefusal(err: unknown): boolean {
  if (!(err instanceof NotOptedInError)) return false;
  vscode.window.showErrorMessage(err.message);
  return true;
}
