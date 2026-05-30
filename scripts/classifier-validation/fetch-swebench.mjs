#!/usr/bin/env node
/**
 * fetch-swebench.mjs — SPEC-004 / DR-009
 *
 * THE ONLY NETWORK-TOUCHING COMPONENT of the classifier-validation harness.
 *
 * Invariant #2 (tiered network consent, DR-004): this script lives OUTSIDE
 * `packages/minspec` and `packages/scroogellm`, is never imported by extension
 * code, and is run manually by a developer. The extension and its committed tests
 * never perform network I/O.
 *
 * Downloads a curated subset of SWE-bench-Verified (princeton-nlp/SWE-bench_Verified)
 * via the HuggingFace datasets-server API and writes:
 *
 *     scripts/classifier-validation/.data/instances.json
 *
 * as an array of { instanceId, repo, problemStatement, patch }.
 *
 * The .data/ directory is gitignored — patches are never committed (size +
 * upstream licensing). Only the hand-assigned tier labels in labels.json are.
 *
 * Usage:  node scripts/classifier-validation/fetch-swebench.mjs [count]
 *         count defaults to 50 (NFR-2: proportional subset, not all 500).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '.data');
const OUT = join(DATA_DIR, 'instances.json');

const DATASET = 'princeton-nlp/SWE-bench_Verified';
const CONFIG = 'default';
const SPLIT = 'test';
const API = 'https://datasets-server.huggingface.co/rows';
const PAGE = 100; // datasets-server max length per request

const count = Math.max(1, parseInt(process.argv[2] ?? '50', 10) || 50);

async function fetchRows(offset, length) {
  const url = `${API}?dataset=${encodeURIComponent(DATASET)}&config=${CONFIG}&split=${SPLIT}&offset=${offset}&length=${length}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HuggingFace API ${res.status} ${res.statusText} for offset=${offset}`);
  }
  const json = await res.json();
  return json.rows ?? [];
}

async function main() {
  console.log(`Fetching ${count} instances from ${DATASET} (${SPLIT})…`);
  const instances = [];
  for (let offset = 0; instances.length < count; offset += PAGE) {
    const length = Math.min(PAGE, count - instances.length);
    const rows = await fetchRows(offset, length);
    if (rows.length === 0) break; // dataset exhausted
    for (const { row } of rows) {
      if (!row || !row.patch) continue;
      instances.push({
        instanceId: row.instance_id,
        repo: row.repo,
        problemStatement: row.problem_statement ?? '',
        patch: row.patch,
      });
    }
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify(instances, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${instances.length} instances → ${OUT}`);
  console.log(`Next: hand-label tiers in scripts/classifier-validation/labels.json, then run`);
  console.log(`      npm run validate:classifier`);
}

main().catch((err) => {
  console.error('fetch-swebench failed:', err.message);
  process.exit(1);
});
