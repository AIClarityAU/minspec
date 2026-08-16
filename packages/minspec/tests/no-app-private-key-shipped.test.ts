/**
 * T0 — INVARIANT (SPEC-034 AC-5, task 0.3): the GitHub App private key must appear
 * ONLY in the broker's secret store. Nothing MinSpec ships or scaffolds may carry it.
 *
 * This is the invariant the whole broker exists to protect. An App private key mints
 * installation tokens for EVERY repository that has ever installed the App — so one
 * copy in a published artifact is not a leak of one project's credential, it is a
 * total compromise of every adopter at once. DR-054 records the ruling in those
 * terms: a vendor-operated token-broker, or shipping a shared secret — "catastrophic
 * — out".
 *
 * That makes this test unusual: it guards a state that is currently CORRECT and must
 * never stop being so. It is written now, at the start of the broker work, precisely
 * because the broker is the change most likely to break it — the private key is about
 * to become something a developer on this repo handles routinely, and routine handling
 * is how a key ends up pasted into a fixture, a wrangler config, or a workflow.
 *
 * Scope, deliberately: MinSpec's OWN tree and the artifacts it produces. What the
 * vendor's Worker holds in Cloudflare's secret store is out of scope by design — that
 * is the one place the key is allowed to be.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  AI_REVIEW_WORKFLOW,
  READY_TO_MERGE_WORKFLOW,
  AI_REVIEW_RETRY_WORKFLOW,
  DOCS_LANE_WORKFLOW,
} from '../src/lib/ci-review-templates';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * A PEM private key header, in any of the forms GitHub or openssl emit.
 *
 * Built at runtime from fragments so this test file does not itself contain a string
 * that a secret scanner would flag — the file asserting "no keys are committed" must
 * not be the reason a scan goes red.
 */
const PEM_MARKERS: readonly RegExp[] = [
  new RegExp(['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')),
  new RegExp(['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')),
  new RegExp(['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ')),
];

/** Files git actually tracks — the set that can reach a published artifact. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

/** Read a tracked file as text; binaries and unreadable paths yield null. */
function readText(rel: string): string | null {
  try {
    const full = path.join(REPO_ROOT, rel);
    if (fs.statSync(full).size > 2 * 1024 * 1024) return null;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return null; // binary
    return buf.toString('utf-8');
  } catch {
    return null;
  }
}

describe('SPEC-034 AC-5 — the App private key is never shipped', () => {
  it('no tracked file contains a PEM private key', () => {
    const tracked = trackedFiles();

    // Non-vacuity: if this ever reads zero files the assertion below is meaningless.
    expect(tracked.length, 'git ls-files returned nothing — the scan would be vacuous').toBeGreaterThan(
      100,
    );

    const offenders: string[] = [];
    for (const rel of tracked) {
      // This file names the markers on purpose; excluding it keeps the guard honest
      // without weakening it for anything else.
      if (rel.endsWith('no-app-private-key-shipped.test.ts')) continue;
      const text = readText(rel);
      if (text === null) continue;
      if (PEM_MARKERS.some((re) => re.test(text))) offenders.push(rel);
    }

    expect(offenders, `these tracked files contain a private key:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('the scan can actually detect a key (control)', () => {
    // Proves the matcher works. A guard that cannot fail is indistinguishable from a
    // guard that passes, and this file's whole value is that it would go red.
    const planted = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ') + '\nMIIEow…\n';
    expect(PEM_MARKERS.some((re) => re.test(planted))).toBe(true);
  });

  it('the packaged extension carries no private key', () => {
    // .vscodeignore decides what reaches the vsix, so a file could be tracked-and-clean
    // yet still ship something generated. Assert against the built bundle when present;
    // skip cleanly when it has not been built, rather than passing vacuously.
    const bundle = path.join(REPO_ROOT, 'packages/minspec/out/extension.js');
    if (!fs.existsSync(bundle)) return;
    const text = fs.readFileSync(bundle, 'utf-8');
    for (const re of PEM_MARKERS) {
      expect(re.test(text), `the built bundle matches ${re}`).toBe(false);
    }
  });

  it('scaffolded harness output carries no private key — only the public app id', () => {
    // What MinSpec WRITES into an adopter's repo. The workflows legitimately name
    // MINSPEC_APP_ID and reference the key by secret NAME; neither is key material.
    const corpus = [
      AI_REVIEW_WORKFLOW,
      READY_TO_MERGE_WORKFLOW,
      AI_REVIEW_RETRY_WORKFLOW,
      DOCS_LANE_WORKFLOW,
    ].join('\n');

    expect(corpus.length, 'templates failed to load — the scan would be vacuous').toBeGreaterThan(
      1000,
    );
    for (const re of PEM_MARKERS) {
      expect(re.test(corpus), `a scaffolded workflow matches ${re}`).toBe(false);
    }
    // The reference-by-name is what SHOULD be there — assert it, so a future refactor
    // that drops the secret reference entirely does not read as "no key, all good".
    expect(corpus).toContain('MINSPEC_APP_PRIVATE_KEY');
  });
});
