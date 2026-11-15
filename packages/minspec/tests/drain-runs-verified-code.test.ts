/**
 * #3747 — the drain must run the code that was verified. The service starts the drain from
 * the verified run dir, and the "current" line compares the executing script's own blob.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { useHostileAmbientDrainKnobs } from './helpers/drain-env';

useHostileAmbientDrainKnobs();

const SCRIPTS = path.resolve(__dirname, '../../../scripts');
const DRAIN = fs.readFileSync(path.join(SCRIPTS, 'drain-inbox.sh'), 'utf-8');
const SERVICE = fs.readFileSync(path.join(SCRIPTS, 'drain-service/drain-service.sh'), 'utf-8');

describe('drain runs the verified code (#3747)', () => {
  it('the verification line compares the executing script blob and says STALE on a difference', () => {
    expect(DRAIN).toContain('git -C "$DRAIN_RUN_DIR" hash-object -- "$DRAIN_SELF"');
    expect(DRAIN).toContain('HEAD:scripts/drain-inbox.sh');
    expect(DRAIN).toMatch(/\[drain\] STALE: run dir verified at origin\/main/);
    // "current" is only printed on the equal-blob arm
    const cur = DRAIN.indexOf('pipeline scripts are current');
    const eq = DRAIN.indexOf('"$self_blob" == "$main_blob"');
    const stale = DRAIN.indexOf('[drain] STALE: run dir verified');
    expect(eq).toBeGreaterThan(-1);
    expect(cur).toBeGreaterThan(eq);
    expect(stale).toBeGreaterThan(cur);
  });

  it('the service launches the drain from the refreshed run dir with the primary root pinned', () => {
    expect(SERVICE).toContain('run_dir_drain()');
    expect(SERVICE).toContain('--refresh-run-dir');
    expect(SERVICE).toMatch(/MINSPEC_DRAIN_PRIMARY_ROOT="\$PRIMARY" "\$drain" --continuous/);
    expect(SERVICE).not.toMatch(/"\$DRAIN" --continuous/);
  });
});
