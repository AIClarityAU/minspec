/**
 * T3 — REGRESSION (#1549): an adopter must be able to learn which build is running.
 *
 * Two stale-install incidents in one day, in a project that was NOT the MinSpec
 * checkout. Both times a gate fix had shipped, the version string had not changed
 * (the extension installs from a locally-built vsix), and the running build silently
 * predated the fix — so a bug that was already fixed upstream kept reproducing.
 *
 * `detectBuildSkew` could not help: it returns `not-applicable` for any workspace that
 * is not a MinSpec checkout, because proving "you are behind" needs MinSpec's own git
 * ancestry. That is correct, and it leaves every adopter with no signal at all.
 *
 * Harness-drift detection cannot help either, and the reason is worth stating: it
 * compares the project's scaffolded files against the templates carried by the RUNNING
 * build, so a stale build's templates look current to it. Staleness is invisible to
 * every derived signal; only the build's own identity escapes the circularity.
 *
 * So the requirement under test is deliberately weak and unconditional: `Show SDD
 * Status` must name the build on EVERY path, including the no-spec paths a freshly
 * initialized project always takes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: { showInformationMessage: vi.fn(), showTextDocument: vi.fn() },
  workspace: { openTextDocument: vi.fn().mockRejectedValue(new Error('no editor in tests')) },
}));

vi.mock('../src/lib/active-spec', () => ({
  findActiveSpec: vi.fn(),
  summarizeActiveSpec: vi.fn(),
}));

import * as vscode from 'vscode';
import { statusCommand } from '../src/commands/status';
import { findActiveSpec, summarizeActiveSpec } from '../src/lib/active-spec';
import { buildLabel, buildSha } from '../src/lib/build-provenance';

/** The single message this invocation produced. */
function lastMessage(): string {
  const calls = vi.mocked(vscode.window.showInformationMessage).mock.calls;
  expect(calls.length, 'status produced no message at all').toBeGreaterThan(0);
  return String(calls[calls.length - 1][0]);
}

describe('Show SDD Status reports the running build (#1549)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names the build when there is no workspace', async () => {
    await statusCommand('')();
    expect(lastMessage()).toContain(buildLabel());
  });

  it('names the build when the project has no active spec', async () => {
    // The path a freshly-initialized project takes — and precisely when an adopter is
    // most likely to be on a build older than the fix they are hunting.
    vi.mocked(findActiveSpec).mockResolvedValue(undefined as never);
    await statusCommand('/tmp/ws')();
    expect(lastMessage()).toContain(buildLabel());
  });

  it('names the build alongside a real spec summary', async () => {
    vi.mocked(findActiveSpec).mockResolvedValue('/tmp/ws/specs/SPEC-001.md' as never);
    vi.mocked(summarizeActiveSpec).mockReturnValue({
      id: 'SPEC-001',
      tier: 'T3',
      phase: 'implement',
      progress: '2/5',
    } as never);
    await statusCommand('/tmp/ws')();
    const msg = lastMessage();
    expect(msg).toContain('SPEC-001');
    expect(msg).toContain(buildLabel());
  });

  it('names the build even when the spec cannot be summarized', async () => {
    // A malformed spec is a diagnosis case, so this is the LAST path that should go
    // quiet about the build.
    vi.mocked(findActiveSpec).mockResolvedValue('/tmp/ws/specs/SPEC-001.md' as never);
    vi.mocked(summarizeActiveSpec).mockReturnValue(undefined as never);
    await statusCommand('/tmp/ws')();
    expect(lastMessage()).toContain(buildLabel());
  });
});

describe('buildLabel()', () => {
  it('is honest about an unpackaged build rather than inventing a sha', () => {
    // Under vitest the esbuild define is absent, so this is the real value — the label
    // must say so instead of showing a fabricated or empty identifier.
    expect(buildSha()).toBe('dev');
    expect(buildLabel()).toBe('dev build');
  });

  it('is short enough to sit inside a toast', () => {
    expect(buildLabel().length).toBeLessThanOrEqual(16);
  });
});
