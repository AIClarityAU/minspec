import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { assembleContext } from '../src/lib/constitution-context';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-ctx-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writePkg(dir: string, pkg: object): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

describe('assembleContext (FR-1)', () => {
  it('no network deps → hasNetworkDeps=false + a no-network-deps Invariant signal', () => {
    writePkg(tmp, {
      name: 'plain-app',
      engines: { node: '>=18' },
      dependencies: { lodash: '^4.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    });
    const m = assembleContext(tmp);
    expect(m.hasNetworkDeps).toBe(false);
    const sig = m.signals.find((s) => s.kind === 'no-network-deps');
    expect(sig).toBeDefined();
    expect(sig!.section).toBe('Invariants');
  });

  it('network dep (axios) → hasNetworkDeps=true and no no-network-deps signal', () => {
    writePkg(tmp, { name: 'net-app', dependencies: { axios: '^1.0.0' } });
    const m = assembleContext(tmp);
    expect(m.hasNetworkDeps).toBe(true);
    expect(m.signals.find((s) => s.kind === 'no-network-deps')).toBeUndefined();
  });

  it('a vscode-free shared workspace package → tier0-package signal targeting Constraints', () => {
    writePkg(tmp, { name: 'mono', workspaces: ['packages/*'] });
    writePkg(path.join(tmp, 'packages', 'shared'), {
      name: '@aiclarity/shared',
      dependencies: {},
    });
    const m = assembleContext(tmp);
    expect(m.tier0Packages).toContain('@aiclarity/shared');
    const sig = m.signals.find((s) => s.kind === 'tier0-package');
    expect(sig).toBeDefined();
    expect(sig!.section).toBe('Constraints');
  });

  it('engines.node present → node-engine signal; CLAUDE.md/docs/decisions reflected in proseDocs', () => {
    writePkg(tmp, { name: 'app', engines: { node: '>=20' } });
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# instructions\n');
    fs.mkdirSync(path.join(tmp, 'docs', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs', 'decisions', 'DR-001.md'), '# DR-001\n');
    fs.writeFileSync(path.join(tmp, 'docs', 'decisions', 'DR-002.md'), '# DR-002\n');

    const m = assembleContext(tmp);
    expect(m.engines?.node).toBe('>=20');
    expect(m.signals.find((s) => s.kind === 'node-engine')).toBeDefined();
    expect(m.proseDocs.claudeMd).toBe(true);
    expect(m.proseDocs.decisions).toBe(2);
  });

  it('missing package.json degrades gracefully (no throw, empty/false fields)', () => {
    // tmp has no package.json
    expect(() => assembleContext(tmp)).not.toThrow();
    const m = assembleContext(tmp);
    expect(m.packageName).toBeUndefined();
    expect(m.hasNetworkDeps).toBe(false);
    expect(m.isMonorepo).toBe(false);
    expect(m.tier0Packages).toEqual([]);
  });
});
