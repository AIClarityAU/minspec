/**
 * T0 — the autonomy axis (DR-086).
 *
 * The stop list IS the safety property. These assert it holds as CODE, because a
 * rule the model is merely asked to remember is one it will drift from
 * (constitution: enforce, don't trust the model). Every branch must fail closed:
 * stopping wrongly costs one round-trip, proceeding wrongly costs an unreviewed
 * action.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveAutonomy,
  readAutonomy,
  mayProceed,
  STOP_CLASSES,
  type StopClass,
  type ProposedAction,
} from '../../../scripts/lib/autonomy';

/** A well-formed action that SHOULD proceed under `act`, so each test can spoil exactly one thing. */
const clean = (over: Partial<ProposedAction> = {}): ProposedAction => ({
  summary: 'relabel an issue',
  stopClasses: [],
  verificationPending: false,
  rejectedAlternatives: ['leave it in inbox — slower, and it sits unowned'],
  ...over,
});

describe('resolveAutonomy — exact token, deny by default', () => {
  it('grants act ONLY for the exact token', () => {
    expect(resolveAutonomy('act')).toBe('act');
    expect(resolveAutonomy(' act ')).toBe('act'); // trimmed, per resolveMode's discipline
  });

  it.each([undefined, '', 'ask', 'Act', 'ACT', 'auto', 'true', 'yes', '1', 'act;', 'acting', 'garbage'])(
    'refuses to grant act for %o',
    (v) => {
      expect(resolveAutonomy(v as string | undefined)).toBe('ask');
    },
  );

  it('has no fail-open path: nothing unrecognised can ever enable autonomy', () => {
    const fuzz = ['ACT ', '\tact\n\t', 'act act', 'a c t', '"act"', "'act'", 'act=1', '0', 'null', 'undefined'];
    const granted = fuzz.filter((v) => resolveAutonomy(v) === 'act');
    // '\tact\n\t' trims to exactly 'act', which IS the token and SHOULD grant.
    expect(granted).toEqual(['\tact\n\t']);
  });
});

describe('readAutonomy — config is the source, not an env var (SPEC-065 FR-1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-'));
    fs.mkdirSync(path.join(dir, '.minspec'), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (obj: unknown) =>
    fs.writeFileSync(path.join(dir, '.minspec', 'config.json'), JSON.stringify(obj));

  it('reads act from config with NO env var set — the #183 property', () => {
    // A profile that does not survive a fresh session is not a profile.
    write({ version: '1', autonomy: 'act' });
    expect(readAutonomy(dir, {})).toBe('act');
  });

  it('defaults to ask when the key is absent', () => {
    write({ version: '1' });
    expect(readAutonomy(dir, {})).toBe('ask');
  });

  it.each([
    ['no config file at all', null],
    ['malformed JSON', 'not json {{{'],
  ])('fails closed on %s', (_label, content) => {
    if (content === null) fs.rmSync(path.join(dir, '.minspec', 'config.json'), { force: true });
    else fs.writeFileSync(path.join(dir, '.minspec', 'config.json'), content as string);
    expect(readAutonomy(dir, {})).toBe('ask');
  });

  it('fails closed when autonomy is the wrong TYPE, not merely the wrong value', () => {
    for (const v of [true, 1, ['act'], { value: 'act' }, null]) {
      write({ version: '1', autonomy: v });
      expect(readAutonomy(dir, {})).toBe('ask');
    }
  });

  it('an env override still goes through the exact-token resolver', () => {
    write({ version: '1', autonomy: 'ask' });
    expect(readAutonomy(dir, { MINSPEC_AUTONOMY: 'act' })).toBe('act');
    expect(readAutonomy(dir, { MINSPEC_AUTONOMY: 'yes' })).toBe('ask');
    // An empty override is a value, and it is not the token.
    expect(readAutonomy(dir, { MINSPEC_AUTONOMY: '' })).toBe('ask');
  });
});

describe('mayProceed — the stop list outranks the setting', () => {
  it('proceeds on a clean action under act', () => {
    const v = mayProceed('act', clean());
    expect(v.proceed).toBe(true);
    expect(v.reason).toBe('proceed');
  });

  it('never proceeds under ask, however clean the action', () => {
    const v = mayProceed('ask', clean());
    expect(v.proceed).toBe(false);
    expect(v.reason).toBe('autonomy-is-ask');
  });

  it.each(STOP_CLASSES.map((s) => s.id))('stops on %s even under act', (id) => {
    const v = mayProceed('act', clean({ stopClasses: [id as StopClass] }));
    expect(v.proceed).toBe(false);
    expect(v.reason).toBe('stop-class-applies');
    expect(v.detail).toContain(id);
  });

  it('names the DR section for the class that blocked it, so the code is checkable against the DR', () => {
    const v = mayProceed('act', clean({ stopClasses: ['approval-or-acceptance'] }));
    expect(v.detail).toMatch(/DR-086/);
  });

  it('stops while the premise is still being verified (DR-086 §3)', () => {
    const v = mayProceed('act', clean({ verificationPending: true }));
    expect(v.proceed).toBe(false);
    expect(v.reason).toBe('verification-pending');
  });

  it('stops when no rejected alternatives were recorded (DR-086 §4)', () => {
    // Under act the human is not watching, so the record is the only review path.
    const v = mayProceed('act', clean({ rejectedAlternatives: [] }));
    expect(v.proceed).toBe(false);
    expect(v.reason).toBe('no-rejected-alternatives-recorded');
  });

  it('a stop class outranks a missing-alternatives defect — the more serious blocker is reported', () => {
    const v = mayProceed('act', clean({ stopClasses: ['irreversible-or-outward-facing'], rejectedAlternatives: [] }));
    expect(v.reason).toBe('stop-class-applies');
  });

  it('an unknown stop class is still honoured, and flagged rather than ignored', () => {
    // Forward-compatibility: a class added to the DR but not yet to STOP_CLASSES
    // must never silently become permission.
    const v = mayProceed('act', clean({ stopClasses: ['not-a-real-class' as StopClass] }));
    expect(v.proceed).toBe(false);
    expect(v.detail).toContain('UNKNOWN CLASS');
  });
});

describe('STOP_CLASSES — the list itself', () => {
  it('carries all six classes DR-086 §2 enumerates', () => {
    expect(STOP_CLASSES.map((s) => s.id).sort()).toEqual(
      [
        'approval-or-acceptance',
        'edits-the-autonomy-rules',
        'evidence-incomplete',
        'genuine-tie',
        'irreversible-or-outward-facing',
        'spend-above-threshold',
      ].sort(),
    );
  });

  it('does NOT contain a "stuck" class — self-judged competence is not a stop rule', () => {
    // DR-086 §2: unenumerable and self-judged, the same self-certification
    // defect the machinery merge gate exists to prevent (#509).
    expect(STOP_CLASSES.map((s) => s.id).join(' ')).not.toMatch(/stuck|blocked|confus|unsure/i);
  });

  it('every class cites where it is defined, so the code can be audited against the DR', () => {
    for (const s of STOP_CLASSES) expect(s.source).toMatch(/DR-086/);
  });

  it('is frozen — the list cannot be edited at runtime (DR-086 §2.6)', () => {
    expect(Object.isFrozen(STOP_CLASSES)).toBe(true);
  });
});
