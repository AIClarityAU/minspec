/**
 * T0 — INVARIANT (#1545): resolving "the" git remote must not assume it is named
 * `origin`, and "I cannot resolve one" must never be representable as "there is none".
 *
 * `origin` is what `git clone` happens to pick, not a rule. A repo whose remote was
 * added by hand carries whatever name the user typed, and MinSpec collapsed that into
 * "no remote" in ten independent places — telling a user to add a remote they already
 * had, and (worse) letting the scaffolded protected-branch guard conclude that nothing
 * was push-protected and pass silently.
 *
 * The three-state result is the whole point. `none` and `ambiguous` are different
 * answers with different consequences, and a caller that cannot tell them apart is the
 * bug. These tests pin that distinction, not just the happy path.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  parseRemoteConfig,
  chooseRemote,
  githubSlug,
  githubSlugFromUrl,
  renameToOriginCandidate,
  resolveRemotes,
  CONVENTIONAL_REMOTE,
} from '../src/lib/git-remotes';
import type { CommandRunner } from '../src/lib/ruleset-advisor';

const ok = (stdout: string): CommandRunner => vi.fn(async () => ({ code: 0, stdout, stderr: '' }));

describe('parseRemoteConfig', () => {
  it('reads name and url from git config output', () => {
    expect(parseRemoteConfig('remote.origin.url https://github.com/o/r.git\n')).toEqual([
      { name: 'origin', url: 'https://github.com/o/r.git' },
    ]);
  });

  it('keeps dots inside a remote name', () => {
    // A naive split('.') truncates `my.fork` to `my` and resolves the WRONG remote.
    expect(parseRemoteConfig('remote.my.fork.url git@github.com:o/r.git\n')).toEqual([
      { name: 'my.fork', url: 'git@github.com:o/r.git' },
    ]);
  });

  it('ignores blank lines and non-url keys', () => {
    const out = [
      '',
      'remote.origin.url https://github.com/o/r.git',
      'remote.origin.fetch +refs/heads/*:refs/remotes/origin/*',
      '   ',
    ].join('\n');
    expect(parseRemoteConfig(out)).toEqual([{ name: 'origin', url: 'https://github.com/o/r.git' }]);
  });
});

describe('chooseRemote', () => {
  it('returns none when there are no remotes', () => {
    expect(chooseRemote([])).toEqual({ kind: 'none' });
  });

  it('prefers origin when present, so existing repos are unaffected', () => {
    const all = [
      { name: 'upstream', url: 'https://github.com/up/r.git' },
      { name: CONVENTIONAL_REMOTE, url: 'https://github.com/o/r.git' },
    ];
    const r = chooseRemote(all);
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.remote.name).toBe('origin');
  });

  it('resolves a sole remote under any name — the reported case', () => {
    const all = [{ name: 'voip-sms-inbox', url: 'https://github.com/harvest316/voip-sms-inbox.git' }];
    const r = chooseRemote(all);
    expect(r.kind).toBe('resolved');
    expect(r.kind === 'resolved' && r.remote.name).toBe('voip-sms-inbox');
  });

  it('is AMBIGUOUS — never none — with several remotes and no origin', () => {
    // The distinction the old code collapsed. `none` would let a gate conclude
    // "nothing to push to" and pass; `ambiguous` forces the caller to decide.
    const all = [
      { name: 'fork', url: 'https://github.com/a/r.git' },
      { name: 'mirror', url: 'https://github.com/b/r.git' },
    ];
    expect(chooseRemote(all).kind).toBe('ambiguous');
  });
});

describe('githubSlug', () => {
  it('reads https and ssh forms', () => {
    expect(githubSlugFromUrl('https://github.com/o/r.git')).toBe('o/r');
    expect(githubSlugFromUrl('git@github.com:o/r.git')).toBe('o/r');
    expect(githubSlugFromUrl('https://gitlab.com/o/r.git')).toBeNull();
  });

  it('uses ORIGIN on a fork checkout, where remotes disagree by design', () => {
    // origin = your fork, upstream = theirs. The answer is unambiguously origin.
    // Deduping across all remotes here returns null and breaks every fork checkout
    // — a regression the old `git remote get-url origin` never had.
    const state = chooseRemote([
      { name: 'upstream', url: 'https://github.com/theirs/r.git' },
      { name: 'origin', url: 'https://github.com/mine/r.git' },
    ]);
    expect(githubSlug(state)).toBe('mine/r');
  });

  it('resolves a sole remote under any name', () => {
    const state = chooseRemote([
      { name: 'voip-sms-inbox', url: 'https://github.com/harvest316/voip-sms-inbox.git' },
    ]);
    expect(githubSlug(state)).toBe('harvest316/voip-sms-inbox');
  });

  it('accepts agreement when resolution is ambiguous but every remote names one repo', () => {
    // Several remotes, no origin — unresolvable, but they all point at the same
    // place, so "which repo is this?" still has an obvious answer.
    const state = chooseRemote([
      { name: 'a', url: 'https://github.com/o/r.git' },
      { name: 'b', url: 'git@github.com:o/r.git' },
    ]);
    expect(state.kind).toBe('ambiguous');
    expect(githubSlug(state)).toBe('o/r');
  });

  it('refuses to guess when ambiguous remotes DISAGREE', () => {
    const state = chooseRemote([
      { name: 'a', url: 'https://github.com/mine/r.git' },
      { name: 'b', url: 'https://github.com/theirs/r.git' },
    ]);
    expect(githubSlug(state)).toBeNull();
  });

  it('is null when there is no github remote at all', () => {
    expect(githubSlug(chooseRemote([]))).toBeNull();
    expect(githubSlug(chooseRemote([{ name: 'gl', url: 'https://gitlab.com/o/r.git' }]))).toBeNull();
  });
});

describe('renameToOriginCandidate', () => {
  it('offers on the one safe shape: a single, GitHub, non-origin remote', () => {
    const state = chooseRemote([
      { name: 'voip-sms-inbox', url: 'https://github.com/harvest316/voip-sms-inbox.git' },
    ]);
    expect(renameToOriginCandidate(state)?.name).toBe('voip-sms-inbox');
  });

  it('stays silent when the remote is already conventionally named', () => {
    const state = chooseRemote([{ name: 'origin', url: 'https://github.com/o/r.git' }]);
    expect(renameToOriginCandidate(state)).toBeNull();
  });

  it('stays silent for a non-GitHub remote', () => {
    const state = chooseRemote([{ name: 'gl', url: 'https://gitlab.com/o/r.git' }]);
    expect(renameToOriginCandidate(state)).toBeNull();
  });

  it('stays silent with several remotes — an offer there is a prompt to break something', () => {
    const state = chooseRemote([
      { name: 'a', url: 'https://github.com/o/r.git' },
      { name: 'b', url: 'https://github.com/o2/r.git' },
    ]);
    expect(renameToOriginCandidate(state)).toBeNull();
  });

  it('stays silent when there are no remotes', () => {
    expect(renameToOriginCandidate(chooseRemote([]))).toBeNull();
  });
});

describe('resolveRemotes', () => {
  it('resolves the reported repo shape end to end', async () => {
    const run = ok('remote.voip-sms-inbox.url https://github.com/harvest316/voip-sms-inbox.git\n');
    const state = await resolveRemotes(run);
    expect(state.kind).toBe('resolved');
    expect(githubSlug(state)).toBe('harvest316/voip-sms-inbox');
  });

  it('treats git exit 1 with no output as a repo with no remotes', async () => {
    const run: CommandRunner = vi.fn(async () => ({ code: 1, stdout: '', stderr: '' }));
    expect((await resolveRemotes(run)).kind).toBe('none');
  });

  it('never throws when the runner does', async () => {
    const run: CommandRunner = vi.fn(async () => {
      throw new Error('git missing');
    });
    expect((await resolveRemotes(run)).kind).toBe('none');
  });

  it('scopes the read to the given cwd', async () => {
    const run = ok('');
    await resolveRemotes(run, '/some/repo');
    expect(run).toHaveBeenCalledWith('git', [
      '-C',
      '/some/repo',
      'config',
      '--get-regexp',
      '^remote\\..*\\.url$',
    ]);
  });
});
