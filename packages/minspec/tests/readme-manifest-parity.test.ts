/**
 * readme-manifest-parity — pins the README's command/setting/shortcut tables to
 * `package.json` (#2395).
 *
 * The gap this closes: nothing checked `packages/minspec/README.md`'s tables
 * against the manifest, so they drifted — the README was down to 15 of 45
 * commands and 3 of 18 settings before #2393 rewrote the listing text.
 *
 * What "appears" means here (deliberately cheap, see #2395's "Decide what
 * 'appears' means" note): a literal substring match of the user-facing string
 * — a command's exact `title`, a setting's backticked key, or a keybinding's
 * normalized shortcut text — inside the raw README text. This catches a
 * command/setting/shortcut being added, renamed or removed. It does NOT catch
 * a description that has gone stale next to a correct title, and it does not
 * try to.
 *
 * Two directions, both checked:
 *   1. manifest -> README: every palette-visible command, every configuration
 *      key, and every keybinding named in the manifest must be named in the
 *      README. A row for a feature that exists and isn't documented is a gap.
 *   2. README -> manifest: every `MinSpec: ...` command title and every
 *      `minspec.*` setting key the README names must exist in the manifest. A
 *      row for a command/setting that no longer exists is a promise the
 *      extension no longer keeps (this is the half that guards a removal,
 *      e.g. #2205 / SPEC-086).
 *
 * Known, documented exception to direction 1 (NOT a gap, and not something
 * this test should ask to be "fixed" by adding a row):
 *   - Commands/menu entries whose `commandPalette` `when` is literally
 *     "false" are intentionally hidden from the palette (context-menu-only
 *     commands), so the README correctly does not list them as commands a
 *     user finds via the palette.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MINSPEC_DIR = path.join(REPO_ROOT, 'packages', 'minspec');
const README_PATH = path.join(MINSPEC_DIR, 'README.md');
const PACKAGE_JSON_PATH = path.join(MINSPEC_DIR, 'package.json');

interface CommandContribution {
  command: string;
  title: string;
  category?: string;
}

interface KeybindingContribution {
  command: string;
  key: string;
  mac?: string;
  when?: string;
}

interface MenuEntry {
  command: string;
  when?: string;
}

interface PackageManifest {
  contributes: {
    commands: CommandContribution[];
    configuration: { properties: Record<string, unknown> };
    keybindings?: KeybindingContribution[];
    menus?: { commandPalette?: MenuEntry[] };
  };
}

function readManifest(): PackageManifest {
  const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8');
  return JSON.parse(raw) as PackageManifest;
}

function readReadme(): string {
  return fs.readFileSync(README_PATH, 'utf-8');
}

/**
 * Commands hidden from the Command Palette entirely (context-menu-only),
 * per a literal `"when": "false"` commandPalette menu entry — the standard
 * VS Code convention for this. Anything else (compound `when` clauses,
 * enablement, etc.) is treated as palette-visible; the README is not
 * expected to track conditional visibility beyond this one binary case.
 */
function paletteHiddenCommandIds(pkg: PackageManifest): Set<string> {
  const entries = pkg.contributes.menus?.commandPalette ?? [];
  return new Set(entries.filter((e) => e.when === 'false').map((e) => e.command));
}

/** "ctrl+k ctrl+p" -> "Ctrl+K Ctrl+P"; "alt+a" -> "Alt+A". */
function normalizeKeyCombo(key: string): string {
  return key
    .split(' ')
    .map((chord) =>
      chord
        .split('+')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('+'),
    )
    .join(' ');
}

describe('README command/setting/shortcut tables match package.json (#2395)', () => {
  const pkg = readManifest();
  const readme = readReadme();
  const hiddenCommandIds = paletteHiddenCommandIds(pkg);

  describe('direction 1: every manifest entry the README is expected to document, is documented', () => {
    const requiredCommands = pkg.contributes.commands.filter(
      (cmd) =>
        !hiddenCommandIds.has(cmd.command),
    );

    it.each(requiredCommands.map((cmd) => [cmd.command, cmd.title] as const))(
      'command %s has its title "%s" in the README',
      (_command, title) => {
        expect(readme.includes(title)).toBe(true);
      },
    );

    const requiredSettingKeys = Object.keys(pkg.contributes.configuration.properties);

    it.each(requiredSettingKeys.map((key) => [key] as const))(
      'setting %s is named in the README',
      (key) => {
        expect(readme.includes('`' + key + '`')).toBe(true);
      },
    );

    const keybindings = pkg.contributes.keybindings ?? [];
    it.each(keybindings.map((kb) => [kb.command, kb.key, kb.mac] as const))(
      'keybinding for %s (%s) is shown in the README',
      (_command, key, mac) => {
        const forms = [normalizeKeyCombo(key)];
        if (mac) forms.push(normalizeKeyCombo(mac));
        expect(forms.some((form) => readme.includes(form))).toBe(true);
      },
    );
  });

  describe('direction 2: every manifest-shaped reference the README makes, resolves to a real manifest entry', () => {
    it('every bolded "MinSpec: ..." title the README names is a real command title', () => {
      const matches = readme.match(/\*\*MinSpec: [^*]+\*\*/g) ?? [];
      const titles = matches.map((m) => m.slice(2, -2));
      expect(titles.length).toBeGreaterThan(0);
      const realTitles = new Set(pkg.contributes.commands.map((c) => c.title));
      const unknown = titles.filter((t) => !realTitles.has(t));
      expect(unknown).toEqual([]);
    });

    it('every backticked `minspec.*` key the README names is a real setting or command id', () => {
      const matches = readme.match(/`minspec\.[a-zA-Z][a-zA-Z0-9._]*`/g) ?? [];
      const keys = matches.map((m) => m.slice(1, -1));
      expect(keys.length).toBeGreaterThan(0);
      const realKeys = new Set([
        ...Object.keys(pkg.contributes.configuration.properties),
        ...pkg.contributes.commands.map((c) => c.command),
      ]);
      const unknown = keys.filter((k) => !realKeys.has(k));
      expect(unknown).toEqual([]);
    });
  });
});
