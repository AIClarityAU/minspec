import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scaffold, DEFAULT_CONFIG } from '../src/lib/scaffold';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('scaffold()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .minspec directory', () => {
    scaffold(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.minspec'))).toBe(true);
  });

  it('creates config.json with defaults', () => {
    scaffold(tmpDir);
    const configPath = path.join(tmpDir, '.minspec', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.version).toBe(DEFAULT_CONFIG.version);
    expect(config.specsDir).toBe(DEFAULT_CONFIG.specsDir);
    expect(config.decisionsDir).toBe(DEFAULT_CONFIG.decisionsDir);
  });

  it('does not overwrite existing config.json', () => {
    scaffold(tmpDir);
    const configPath = path.join(tmpDir, '.minspec', 'config.json');
    // Simulate user customization
    const custom = { version: '1', specsDir: 'my-specs', decisionsDir: 'docs/decisions' };
    fs.writeFileSync(configPath, JSON.stringify(custom, null, 2));
    // Re-run scaffold — must not overwrite
    scaffold(tmpDir);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.specsDir).toBe('my-specs');
  });

  it('is idempotent — multiple calls do not throw', () => {
    expect(() => {
      scaffold(tmpDir);
      scaffold(tmpDir);
      scaffold(tmpDir);
    }).not.toThrow();
  });
});
