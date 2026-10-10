/**
 * #2580 — unit coverage for the pure helpers in
 * scripts/verify-sealed-claude-start.ts. That script spawns the real `claude`
 * binary and reads/writes `~/.claude/projects`; it cannot run in CI (no
 * `claude`, no login — see its own docstring) and is not driven here. What IS
 * pure, and so IS tested here, is arg parsing and the two textual checks that
 * decide whether a row passed: did a canary value leak into some text, and
 * how many `"type":"file"` attachments does a transcript show.
 */

import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  countFileAttachments,
  canaryHits,
  buildDirectPrompt,
} from '../../../scripts/verify-sealed-claude-start';

describe('parseArgs', () => {
  it('defaults to haiku, no --settings, no --reminders-file', () => {
    expect(parseArgs([])).toEqual({ help: false, model: 'haiku', settingsJson: null, remindersFile: null });
  });

  it('parses --model, --settings and --reminders-file', () => {
    const parsed = parseArgs([
      '--model', 'opus',
      '--settings', '{"disableAllHooks":true}',
      '--reminders-file', '/tmp/reminders.jsonl',
    ]);
    expect(parsed).toEqual({
      help: false,
      model: 'opus',
      settingsJson: '{"disableAllHooks":true}',
      remindersFile: '/tmp/reminders.jsonl',
    });
  });

  it('recognizes -h and --help without needing the other flags', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true });
    expect(parseArgs(['-h'])).toEqual({ help: true });
  });

  it('rejects an unrecognized option rather than silently ignoring it', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unrecognized option: --bogus/);
  });
});

describe('countFileAttachments', () => {
  it('counts "type":"file" with or without the space JSON.stringify omits', () => {
    expect(countFileAttachments('{"type":"file"}\n{"type": "file"}')).toBe(2);
  });

  it('is 0 on a transcript with no file attachments', () => {
    expect(countFileAttachments('{"type":"assistant","text":"hello"}')).toBe(0);
  });

  it('does not count a "file" that is not the value of a "type" field', () => {
    expect(countFileAttachments('{"kind":"file","note":"a file was mentioned"}')).toBe(0);
  });
});

describe('canaryHits', () => {
  const canaries = { alpha: 'aaa111', bravo: 'bbb222' };

  it('reports false for every canary absent from the text', () => {
    expect(canaryHits('nothing to see here', canaries)).toEqual({ alpha: false, bravo: false });
  });

  it('reports true only for the canaries actually present', () => {
    expect(canaryHits('the value was aaa111', canaries)).toEqual({ alpha: true, bravo: false });
  });
});

describe('buildDirectPrompt', () => {
  it('asks for the canary file three ways: relative, absolute, and @', () => {
    const canaries = { alpha: 'secretA', bravo: 'secretB', charlie: 'secretC' };
    const prompt = buildDirectPrompt('/tmp/canary-dir', canaries);

    expect(prompt).toContain('canary-alpha.txt'); // relative — no directory prefix
    expect(prompt).toContain('/tmp/canary-dir/canary-bravo.txt'); // absolute
    expect(prompt).toContain('@/tmp/canary-dir/canary-charlie.txt'); // @ reference

    // The prompt names the FILES, never the canary VALUES — a model that just
    // echoed the question back would not make a row pass by accident.
    expect(prompt).not.toContain('secretA');
    expect(prompt).not.toContain('secretB');
    expect(prompt).not.toContain('secretC');
  });
});
