import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_CONFIG = {
  version: '1',
  specsDir: 'specs',
  decisionsDir: 'docs/decisions',
};

/**
 * Creates the .minspec/ directory structure in rootDir.
 * Idempotent — never overwrites existing config.json.
 */
export function scaffold(rootDir: string): void {
  const minspecDir = path.join(rootDir, '.minspec');
  fs.mkdirSync(minspecDir, { recursive: true });

  const configPath = path.join(minspecDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
  }
}
