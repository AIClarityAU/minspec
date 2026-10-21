/**
 * SPEC-042 T1 (contract) - the pure onboarding view model.
 *
 * The row inventory is checked against the REAL manifest (`package.json`), not a hand-copied
 * list, so a renamed setting or command, or a default changed in one place only, fails here.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildOnboardingModel,
  computeApproverIdentity,
  deriveRowClickToggles,
  emailMatchesGh,
  isDismissed,
  isValidEmail,
  parseGhUser,
  seedForField,
  COVERAGE_HELPER,
  SETTING_DEFAULTS,
  type OnboardingRow,
} from '../src/lib/onboarding-settings';

const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
) as {
  contributes: {
    commands: Array<{ command: string }>;
    configuration: { properties: Record<string, { default?: unknown; description?: string }> };
  };
};
const SETTINGS = MANIFEST.contributes.configuration.properties;
const COMMANDS = new Set(MANIFEST.contributes.commands.map((c) => c.command));

const model = (over: Partial<Parameters<typeof buildOnboardingModel>[0]> = {}) =>
  buildOnboardingModel({
    readSetting: (_id, fallback) => fallback,
    approverSeed: 'dev@example.com',
    ...over,
  });
const allRows = (m = model()): OnboardingRow[] => [...m.rows, ...m.footer];

describe('buildOnboardingModel - row inventory maps to real ids (T1)', () => {
  it('every settingId is a contributed setting, except the planned silentRefresh (#186)', () => {
    for (const row of allRows()) {
      if (!row.settingId) continue;
      if (row.planned) {
        expect(row.settingId).toBe('minspec.silentRefresh');
        expect(SETTINGS[row.settingId], 'silentRefresh must stay uncontributed until #186').toBeUndefined();
      } else {
        expect(SETTINGS[row.settingId], `${row.settingId} is not contributed`).toBeDefined();
      }
    }
  });

  it('every commandId is a registered, contributed command', () => {
    const ids = allRows().flatMap((r) => (r.commandId ? [r.commandId] : []));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of [...ids, model().hero.commandId]) {
      expect(COMMANDS.has(id), `${id} is not contributed`).toBe(true);
    }
  });

  it('tiers are required|recommended|optional and the hero is minspec.init', () => {
    const m = model();
    for (const row of allRows(m)) expect(['required', 'recommended', 'optional']).toContain(row.tier);
    expect(m.hero).toMatchObject({ commandId: 'minspec.init', label: 'Initialize SDD structure' });
    expect(m.primer).toHaveLength(4);
  });

  it('has no progress or completion field anywhere in the model (INV-2)', () => {
    expect(Object.keys(model()).sort()).toEqual(['footer', 'hero', 'primer', 'rows', 'showSettingIds']);
  });

  it('never surfaces the unbuilt, niche or superseded settings (FR-8, FR-15, SPEC-086)', () => {
    const ids = allRows().flatMap((r) => (r.settingId ? [r.settingId] : []));
    expect(ids).not.toContain('minspec.autoBackfillUseAi');
    expect(ids.join(' ')).not.toMatch(/conformance|scroogellm/i);
    expect(allRows().some((r) => /reading[- ]time/i.test(r.label))).toBe(false);
  });

  it('the shown default for each setting equals the manifest default (D5)', () => {
    for (const [id, shown] of Object.entries(SETTING_DEFAULTS)) {
      expect(SETTINGS[id]?.default, id).toBe(shown);
    }
    expect(SETTING_DEFAULTS['minspec.advancePhaseOnApprove']).toBe(true);
  });

  it('the coverage helper is the manifest description verbatim (FR-11)', () => {
    expect(COVERAGE_HELPER).toBe(SETTINGS['minspec.coverage.minimumPercentage'].description);
    expect(COVERAGE_HELPER).toMatch(/does NOT itself change/);
  });

  it('shows ONE commit consent bound to commitOnApprove (FR-7)', () => {
    const commit = allRows().filter((r) => /commit.*(own changes|approv|refresh)/i.test(`${r.label} ${r.description}`));
    expect(commit.map((r) => r.settingId)).toEqual(['minspec.commitOnApprove']);
    expect(commit[0].description).toMatch(/approvals \+ harness refreshes.*never pushed automatically/);
  });

  it('reads the effective value through readSetting', () => {
    const m = model({ readSetting: <T,>(id: string, fb: T) => (id === 'minspec.commitOnApprove' ? (false as T) : fb) });
    expect(allRows(m).find((r) => r.settingId === 'minspec.commitOnApprove')?.value).toBe(false);
    expect(allRows(m).find((r) => r.settingId === 'minspec.advancePhaseOnApprove')?.value).toBe(true);
  });

  it('shows a keybinding only where one was supplied, never invents one (FR-9)', () => {
    expect(allRows().filter((r) => r.hotkey)).toEqual([]);
    const m = model({ hotkeys: { 'minspec.backfillEpics': 'Alt+B' } });
    expect(allRows(m).filter((r) => r.hotkey).map((r) => r.id)).toEqual(['backfillEpics']);
  });

  it('showSettingIds defaults to off (FR-9)', () => {
    expect(model().showSettingIds).toBe(false);
    expect(model({ showSettingIds: true }).showSettingIds).toBe(true);
  });
});

describe('rowClickToggles truth table (AC-7, D7)', () => {
  const byId = (id: string) => allRows().find((r) => r.id === id)!;

  it.each([
    ['email row (field)', 'approverEmail', false],
    ['coverage row (field)', 'coverageMinimum', false],
    ['refresh row (secondary action)', 'refreshNow', false],
    ['backfill row (action)', 'backfillEpics', false],
    ['install row (action)', 'installGitHubPrExtension', false],
    ['planned silentRefresh row', 'silentRefresh', false],
    ['plain toggle row', 'commitOnApprove', true],
    ['footer toggle row', 'autoBootstrapEnabled', true],
  ])('%s -> %s is %s', (_name, id, expected) => {
    expect(byId(id).rowClickToggles).toBe(expected);
  });

  it('is true ONLY for a non-planned toggle with no second control', () => {
    const base = { kind: 'toggle' as const };
    expect(deriveRowClickToggles(base)).toBe(true);
    expect(deriveRowClickToggles({ ...base, planned: true })).toBe(false);
    expect(deriveRowClickToggles({ ...base, secondaryActionId: 'verifyGitHub' })).toBe(false);
    expect(deriveRowClickToggles({ ...base, commandId: 'minspec.initRefresh' })).toBe(false);
    for (const kind of ['field', 'multi', 'action'] as const) {
      expect(deriveRowClickToggles({ kind })).toBe(false);
    }
  });
});

describe('dismissal visibility (INV-3)', () => {
  const sig = { current: 'a' };
  const build = (answered: Record<string, string>) =>
    model({ answered, signatureFor: () => sig.current });

  it('hides a dismissed offer while its signature is unchanged, and returns it when it moves', () => {
    expect(allRows(build({})).some((r) => r.id === 'refreshNow')).toBe(true);
    expect(allRows(build({ skipRefreshPrompt: 'a' })).some((r) => r.id === 'refreshNow')).toBe(false);
    expect(allRows(build({ skipRefreshPrompt: 'old' })).some((r) => r.id === 'refreshNow')).toBe(true);
  });

  it('a dismissal never hides a different offer (keyed by the unique pref key)', () => {
    const rows = allRows(build({ skipRefreshPrompt: 'a' }));
    expect(rows.some((r) => r.id === 'backfillEpics')).toBe(true);
  });

  it('isDismissed is false with no memory or no signature source', () => {
    expect(isDismissed('skipRefreshPrompt', undefined, () => 'a')).toBe(false);
    expect(isDismissed('skipRefreshPrompt', { skipRefreshPrompt: 'a' }, undefined)).toBe(false);
  });
});

describe('ApproverIdentity truth table (AC-5, AC-14, INV-4)', () => {
  const gh = { login: 'octo', id: 42, email: 'octo@corp.com' };

  it('value is carried through and format-checked purely', () => {
    expect(computeApproverIdentity('dev@example.com', null)).toEqual({
      value: 'dev@example.com',
      ghLogin: null,
      valid: true,
      divergesFromGh: false,
    });
    expect(computeApproverIdentity('not an email', null).valid).toBe(false);
    expect(isValidEmail(' a@b.co ')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
  });

  it('divergesFromGh is FALSE whenever ghLogin is null, whatever the value', () => {
    for (const v of ['dev@example.com', 'x', '', 'octo@corp.com']) {
      expect(computeApproverIdentity(v, null).divergesFromGh).toBe(false);
    }
  });

  it('is true only for a valid email GitHub does not attribute to the verified account', () => {
    expect(computeApproverIdentity('other@example.com', gh).divergesFromGh).toBe(true);
    expect(computeApproverIdentity('octo@corp.com', gh).divergesFromGh).toBe(false);
    expect(computeApproverIdentity('OCTO@corp.com', gh).divergesFromGh).toBe(false);
    expect(computeApproverIdentity('42+octo@users.noreply.github.com', gh).divergesFromGh).toBe(false);
    expect(computeApproverIdentity('octo@users.noreply.github.com', gh).divergesFromGh).toBe(false);
    // an invalid value is a format error, not a divergence
    expect(computeApproverIdentity('nope', gh).divergesFromGh).toBe(false);
  });

  it('a private GitHub email still matches the noreply forms', () => {
    expect(emailMatchesGh('42+octo@users.noreply.github.com', { login: 'octo', id: 42, email: null })).toBe(true);
    expect(emailMatchesGh('octo@corp.com', { login: 'octo', id: 42, email: null })).toBe(false);
  });

  it('parseGhUser accepts a login-bearing object and nothing else', () => {
    expect(parseGhUser('{"login":"octo","id":42,"email":null}')).toEqual({ login: 'octo', id: 42, email: null });
    for (const bad of ['', 'not json', '[]', '{}', '{"login":""}', '{"login":7}']) {
      expect(parseGhUser(bad)).toBeNull();
    }
  });

  it("the seed field is blank rather than git's literal 'unknown'", () => {
    expect(seedForField('unknown')).toBe('');
    expect(seedForField('dev@example.com')).toBe('dev@example.com');
  });
});
