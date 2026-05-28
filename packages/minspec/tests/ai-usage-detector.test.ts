import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectAITools,
  HOME_DIR_SIGNALS,
  VSCODE_EXTENSION_SIGNALS,
} from '../src/lib/ai-usage-detector';

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn(() => undefined),
  },
}));

describe('ai-usage-detector', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'minspec-aiusage-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns empty when no signals present', () => {
    const result = detectAITools(tmpHome);
    expect(result.tools).toEqual([]);
    expect(result.heavyUsage).toBe(false);
  });

  it('detects ~/.claude directory as Claude Code', () => {
    fs.mkdirSync(path.join(tmpHome, '.claude'));
    const result = detectAITools(tmpHome);
    expect(result.tools).toContain('Claude Code');
  });

  it('detects ~/.cursor directory as Cursor', () => {
    fs.mkdirSync(path.join(tmpHome, '.cursor'));
    const result = detectAITools(tmpHome);
    expect(result.tools).toContain('Cursor');
  });

  it('flags heavy usage with 2+ tools', () => {
    fs.mkdirSync(path.join(tmpHome, '.claude'));
    fs.mkdirSync(path.join(tmpHome, '.cursor'));
    const result = detectAITools(tmpHome);
    expect(result.heavyUsage).toBe(true);
    expect(result.tools.length).toBe(2);
  });

  it('returns sorted tool list', () => {
    fs.mkdirSync(path.join(tmpHome, '.cursor'));
    fs.mkdirSync(path.join(tmpHome, '.claude'));
    const result = detectAITools(tmpHome);
    expect(result.tools).toEqual([...result.tools].sort());
  });

  it('detects VSCode extension when getExtension returns truthy', async () => {
    const vscode = await import('vscode');
    (vscode.extensions.getExtension as ReturnType<typeof vi.fn>).mockImplementation((id: string) =>
      id === 'github.copilot' ? ({ id } as unknown) : undefined,
    );
    const result = detectAITools(tmpHome);
    expect(result.tools).toContain('GitHub Copilot');
  });

  it('exposes signal lists for inspection', () => {
    expect(HOME_DIR_SIGNALS.length).toBeGreaterThan(0);
    expect(VSCODE_EXTENSION_SIGNALS.length).toBeGreaterThan(0);
    expect(HOME_DIR_SIGNALS.some(s => s.name === 'Claude Code')).toBe(true);
    expect(VSCODE_EXTENSION_SIGNALS.some(s => s.id === 'github.copilot')).toBe(true);
  });
});
