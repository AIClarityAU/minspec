import { describe, expect, it, vi } from 'vitest';
import { retryCommand } from '../scripts/retry-e2e.mjs';

// #1509 — `test:e2e` used to shell out to `vscode-test` bare, with no retry
// and no cache, so one transient ETIMEDOUT while resolving the VS Code
// download failed the whole job outright and reddened main. These tests pin
// the retry behaviour that replaced the bare invocation: retry up to N times,
// stop at the first success, log every attempt (so a "passed on attempt 3"
// run stays visible rather than reading as a clean first-try pass), and
// surface the final exit code when every attempt is exhausted.

describe('retryCommand', () => {
  it('returns 0 on the first successful attempt without sleeping or extra logging', async () => {
    const spawnFn = vi.fn().mockReturnValue({ status: 0 });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const logFn = vi.fn();

    const code = await retryCommand({
      command: 'vscode-test',
      attempts: 3,
      spawnFn,
      sleepFn,
      logFn,
    });

    expect(code).toBe(0);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
    // First-try success is not a retry — nothing to surface.
    expect(logFn).not.toHaveBeenCalled();
  });

  it('retries a transient failure and succeeds, logging every attempt including the eventual pass', async () => {
    const spawnFn = vi
      .fn()
      .mockReturnValueOnce({ status: 1 }) // simulated ETIMEDOUT
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0 });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const logFn = vi.fn();

    const code = await retryCommand({
      command: 'vscode-test',
      attempts: 3,
      spawnFn,
      sleepFn,
      logFn,
    });

    expect(code).toBe(0);
    expect(spawnFn).toHaveBeenCalledTimes(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);
    // Two failure lines plus the "passed on attempt 3/3" line — a retried
    // pass must stay visible, not look identical to a clean first try.
    expect(logFn).toHaveBeenCalledTimes(3);
    expect(logFn.mock.calls.at(-1)?.[0]).toMatch(/passed on attempt 3\/3/);
  });

  it('exhausts all attempts and returns the last exit code when every attempt fails', async () => {
    const spawnFn = vi.fn().mockReturnValue({ status: 124 });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const logFn = vi.fn();

    const code = await retryCommand({
      command: 'vscode-test',
      attempts: 3,
      spawnFn,
      sleepFn,
      logFn,
    });

    expect(code).toBe(124);
    expect(spawnFn).toHaveBeenCalledTimes(3);
    // Sleeps only happen between attempts, never after the last one.
    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(logFn).toHaveBeenCalledTimes(4); // 3 per-attempt failures + 1 final summary
    expect(logFn.mock.calls.at(-1)?.[0]).toMatch(/failed after 3 attempts/);
  });

  it('treats a launch failure (no numeric status, e.g. ENOENT) as a failed attempt rather than success', async () => {
    const spawnFn = vi.fn().mockReturnValue({ status: null, error: new Error('ENOENT') });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const logFn = vi.fn();

    const code = await retryCommand({
      command: 'vscode-test',
      attempts: 1,
      spawnFn,
      sleepFn,
      logFn,
    });

    expect(code).toBe(1);
    expect(logFn.mock.calls.at(-1)?.[0]).toMatch(/failed after 1 attempts/);
  });

  it('rejects a missing command and an attempts count below 1', async () => {
    await expect(retryCommand({ command: '' })).rejects.toThrow(/command is required/);
    await expect(retryCommand({ command: 'vscode-test', attempts: 0 })).rejects.toThrow(
      /attempts must be >= 1/,
    );
  });
});
