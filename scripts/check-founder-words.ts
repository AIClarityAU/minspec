/**
 * check-founder-words - does a spec carry every line of a founder answer?
 *
 * Run before filing a re-approval ask for a spec whose Clarify answer came from a
 * runner-queue item (SPEC-033 D-11 incident, 2026-11-26: the founder's second line was a
 * later update to the item and never reached the spec).
 *
 *   npx tsx scripts/check-founder-words.ts --spec <file> --queue <tasks.jsonl> --key <item> [--quote "<text>"]...
 *
 * Quotes come from every record of the item (each one marked `verbatim: '...'`) plus any
 * `--quote` given, for words the item holds unmarked (an AskUserQuestion pick in `text`).
 * `--queue`/`--key` may be left out when `--quote` names every line.
 *
 * Exit 0  the spec carries every quote
 * Exit 1  at least one quote is missing; each is printed
 * Exit 2  cannot check (unreadable file, key with no records, or no quote at all): never a pass
 */
import { readFileSync } from 'node:fs';
import { itemRecords, extractVerbatimQuotes, missingQuotes } from './lib/founder-words';

function fail(msg: string): never {
  console.error(`check-founder-words: cannot check - ${msg}`);
  process.exit(2);
}

function main(argv: string[]): void {
  let spec: string | undefined;
  let queue: string | undefined;
  let key: string | undefined;
  const extra: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--spec' || a === '--queue' || a === '--key' || a === '--quote') {
      if (v === undefined) fail(`${a} needs a value`);
      if (a === '--spec') spec = v;
      else if (a === '--queue') queue = v;
      else if (a === '--key') key = v;
      else extra.push(v);
      i++;
    } else {
      fail(`unknown argument ${a}`);
    }
  }
  if (!spec) fail('--spec is required');
  if ((queue === undefined) !== (key === undefined)) fail('--queue and --key go together');

  let specText: string;
  try {
    specText = readFileSync(spec, 'utf8');
  } catch (e) {
    fail(`cannot read spec ${spec}: ${(e as Error).message}`);
  }

  const quotes = [...extra];
  if (queue !== undefined && key !== undefined) {
    let jsonl: string;
    try {
      jsonl = readFileSync(queue, 'utf8');
    } catch (e) {
      fail(`cannot read queue ${queue}: ${(e as Error).message}`);
    }
    const recs = itemRecords(jsonl, key);
    if (recs.length === 0) fail(`queue item ${key} has no records in ${queue}`);
    for (const q of extractVerbatimQuotes(recs)) if (!quotes.includes(q)) quotes.push(q);
  }
  if (quotes.length === 0) {
    fail('no founder quote found (mark his words `verbatim: \'...\'` in the item, or pass --quote)');
  }

  const missing = missingQuotes(specText, quotes);
  if (missing.length > 0) {
    console.log(`MISSING ${missing.length} of ${quotes.length} founder line(s) from ${spec}:`);
    for (const q of missing) console.log(`  - ${q}`);
    process.exit(1);
  }
  console.log(`OK: ${spec} carries all ${quotes.length} founder line(s).`);
}

main(process.argv.slice(2));
