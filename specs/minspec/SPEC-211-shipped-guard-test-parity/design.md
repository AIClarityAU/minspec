---
id: SPEC-211
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-211 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: specifying
product: minspec
epic: EPIC-006  # Trust, Consent & Supply Chain
relates_to: [DR-097, DR-066, SPEC-043, "#2371", "#2163", "#2901", "#1941", "#871"]
phases:
  specify: done
  clarify: done
  plan: done
  tasks: done
  implement: pending
---

# SPEC-211 - Design: the shipped guard suite carries its own coverage evidence

Plan for [requirements.md](requirements.md), built under the recorded Clarify selection
(DQ-1 option a: delete the two vitest files once ported). Citations of "today" are against
`origin/main` `23a58c2f`, the commit this plan was written on. New code is cited by symbol,
because its line numbers move.

## Approach in one paragraph

Everything new lives in `.github/scripts/ai-review-guard.test.js`, the one file that already
travels to adopters beside the guard. Two pure helpers go in first - one that lexes the
suite's own source down to code tokens and reports which function exports are never called
or member-accessed, and one that collects `ai-review-guard.test.js: "<title>"` citations
from the guard's source and reports which do not resolve to a test title. Each helper gets
synthetic-input cases that prove it can fail, then one live case that runs it on the real
files. With only those in place the live export case is red, naming exactly the six
unexempted functions, and the live citation case is red on zero citations: that is the T0
red-before. The 32 voter-reuse cases and the 13 protocol-token cases are then ported from
vitest one for one, the four guard comments are rewritten into the citation form, the
vitest files are deleted, DR-097's two citations are repointed, and the embedded copy is
regenerated. The guard's code does not change (INV-1).

## Re-measurement at 23a58c2f (what changed since the spec was written)

#2901 (closing #2897) merged between Specify and Plan and added shipped cases for
`isQuotaExhaustionStrict` and `wholeCheckRunListing`. Measured on this tree with
`Object.keys(require('./.github/scripts/ai-review-guard.js'))`, `typeof`, and FR-5's
call-or-member-access reading of the suite:

| Quantity | At f3850fde (spec) | At 23a58c2f (plan) |
|---|---|---|
| Exports / functions / constants | 62 / 41 / 21 | 62 / 41 / 21 |
| Shipped suite | 185 pass of 185 | 190 pass of 190 |
| Unused functions | 9 | 7: the #2163 four, `renderVerdictBlock`, `defangProtocolTokens`, `parseCliVerdict` |
| FR-5a exemptions | 3 | 1: `parseCliVerdict` (#1941) |
| T0 expected red (unused less exempted) | 6 | 6 |

requirements.md was amended in the same branch to say so (FR-5a list, two acceptance
criteria, the plain-terms cost, the test plan). Without that amendment FR-5a would be
self-contradictory: its stale-exemption rule fails on an exempted name that is referenced,
and two of the three original entries now are.

## Architecture

```
.github/scripts/ai-review-guard.test.js            (shipped, plain Node)
 |
 |-- existing 190 cases (unchanged)
 |
 |-- [A] coverage-gate helpers (pure)
 |      codeTokensOf(source)            -> string | null   lexer: drops comments, '..', "..", `..`, /re/
 |      findUnusedExports({exportNames, source, exemptions})
 |                                       -> { ok, error, missing[], stale[], unexported[] }
 |      collectTestTitles(source)       -> Set<string>     literal-titled test(...) calls only
 |      findUnresolvedCitations({guardSource, titles})
 |                                       -> { ok, error, citations[], unresolved[] }
 |      EXPORT_GATE_EXEMPTIONS          -> [{ name, issue, reason }]  (one entry)
 |
 |-- [B] helper self-tests (synthetic inputs, each proves a red is possible)
 |-- [C] live gates: export gate over the real guard + this file; citation gate over the real guard
 |-- [D] ported voter-reuse cases  (32, from voter-survivor-reuse.test.ts)
 |-- [E] ported protocol-token cases (13, from review-protocol-tokens.test.ts)
 |         reads siblings at path.resolve(__dirname, '..', '..', rel)
 v
.github/scripts/ai-review-guard.js                 (comments only change: four sites, FR-4)
 v
node scripts/gen-ci-templates.mjs  ->  packages/minspec/src/lib/ci-review-templates.ts (generated)
```

## The export gate (FR-5, FR-5a, FR-5b)

**Lexer, `codeTokensOf(source)`.** A single left-to-right scan that copies code characters
and replaces with a space every `//` line comment, `/* */` block comment, single- and
double-quoted string, template literal (the whole literal, `${...}` included), and regular
expression literal. A `/` opens a regex literal when the previous significant character is
one of `( , = : [ ! & | ? { } ; + - * % < > ~ ^` or start of input, or the previous token is
`return`, `typeof`, `case`, `in`, `of`, `delete`, `void`, `throw`, `new`, or the previous
significant character is a `)` that closes the head of an `if`, `while`, `for` or `with`
(tracked with a stack that records, for each `(`, whether the keyword before it was one of
those four); otherwise it is division. Inside a regex, `[...]` classes and `\` escapes are honoured. Returns `null` when
`source` is not a non-empty string, or when a string, template, block comment or regex is
still open at end of input (an unterminated construct means the lexer lost sync, so its
output proves nothing).

Why removing the whole template literal is safe in the fail direction: a call that exists
only inside `${...}` is not counted, which can only produce a false red, never a false green.
The same holds for every lexer mistake that swallows code. The mistakes that could produce
a false green are the ones that read literal text as code: a regex literal lexed as division
(its body, say `foo(`, then counts as a call), or a quote swallowed by a mis-opened regex so
that string text becomes code. The regex-opening rule above is the heuristic every
non-parsing JavaScript lexer uses, and it is not complete JavaScript grammar, so this design
claims no more than the [B] self-tests pin: `/x/.test(s)`, `a / b`, `(a) / b(c)` (division
after a plain `)`, so `b(` stays code), `if (x) /foo(/.test(s)` (regex after an `if` head,
so `foo(` is removed), and a regex containing a quote. Any other shape is unpinned, and the
suite's own source is the only input the live case lexes.

**Use test.** Over the lexed text, a name is used when a whole-word occurrence is
immediately followed by optional whitespace and `(`, or immediately preceded by `.` and
optional whitespace. The `const { a, b } = require('./ai-review-guard.js')` list has
neither shape, so an import is not use; test titles are strings, so a title is not use; the
exemption list stores names as strings, so declaring an exemption is not use.

**`findUnusedExports({ exportNames, source, exemptions })`.** Returns `ok: false` with an
`error` when `exportNames` is not a non-empty array or `codeTokensOf(source)` is `null`
(FR-5b); otherwise `missing` (unused, not exempted), `stale` (exempted and used), and
`unexported` (exempted but not in `exportNames`), with `ok` true only when all three are
empty. The live case's failure message lists every name in each set and the two fixes:
add a behavioural case that calls the function, or add an `EXPORT_GATE_EXEMPTIONS` entry
with `issue: 'AIClarityAU/minspec#N'`.

**Live case.** Loads the guard with `require('./ai-review-guard.js')` (a load failure fails
the case, FR-5b), keeps exports whose `typeof` is `function`, reads
`path.join(__dirname, path.basename(__filename))` with `fs.readFileSync` (a read failure
fails the case), and asserts `ok`. The gate's own code iterates names dynamically and never
spells a guard export as a call, so it cannot satisfy itself.

**Exemptions.** One commented array, `EXPORT_GATE_EXEMPTIONS`, with one entry:
`{ name: 'parseCliVerdict', issue: 'AIClarityAU/minspec#1941', reason: ... }`. Each entry's
`issue` is checked against `/^AIClarityAU\/minspec#\d+$/` so the ref means the same thing in
an adopter repo (Costly to Refactor 2).

## The citation gate (FR-4, FR-6)

**Form.** `ai-review-guard.test.js: "<exact title>"`, on one comment line. The parser is
`/ai-review-guard\.test\.js: "([^"\n]+)"/g` over the guard's raw source; the form and the
regex are defined next to each other in [A] (Costly to Refactor 1). Existing guard comments
that mention the suite without `: "` (header lines 6-9, line 242) are not citations and are
untouched.

**Titles.** `collectTestTitles(source)` reads the suite's own source and collects the first
argument of every `test(` call whose first argument is a single- or double-quoted literal,
taken verbatim from the source text. A templated title is not collected, so a citation of
one fails rather than passes; FR-4's targets all have literal titles.

**`findUnresolvedCitations({ guardSource, titles })`.** `ok: false` with `error` when the
source is unreadable or yields zero citations (FR-6); otherwise `unresolved` lists every
cited title not in `titles`. Self-tests plant an invented title and an empty source.

## The four comment rewrites (FR-4)

| Site at 23a58c2f | New text keeps | New citation |
|---|---|---|
| `isStructuralVerdictBlock` token note, 504-507 | why the tokens are exported (bash and a `run:` block cannot import them), and that a cross-file test pins them | the ported per-(site, token) cases for the three non-guard sites, e.g. `review protocol tokens: scripts/review-decide.sh still uses REVIEW_VERDICT_BEGIN`; never the token-shape case, which checks shape only and reads no other file |
| `selectVotersToRun` docblock, 636-637 | that the first version matched only the fingerprint and three voters caught it | the ported cross-SHA case |
| `selectVotersToRun` docblock, 652-653 | that recency was once satisfied only by fixture order | the ported recency and order-independence cases |
| panel-key note, 836 | which scripts are in the panel key | `#1688 panel key: an unreadable or incomplete listing yields NO key, so nothing carries`, stating only that it pins an incomplete listing to no key; the claim that a shipped test checks what `review-branch.sh` reads is removed |

The exact titles are fixed when the ported cases are written; the citation gate is what
proves each one resolves.

## The ports (FR-1, FR-2)

Titles are `<function>: <vitest title>`: `renderVoterRecord:` / `parseVoterRecords:` for the
round-trip group (by the function under test), `selectVotersToRun:` for the 15 selector
cases, `isStructuralVerdictBlock:` for the 12 structural cases, and `review protocol
tokens:` for the token group (its subjects are constants, plus `defangProtocolTokens:` for
the two defang cases). The ten (site, token) cases are written out, each with a literal title
of the form `review protocol tokens: <site> still uses <token value>`, and each calls one
shared helper with its site and token; the vitest file's templated loop over `SITES` is not
carried over, because `collectTestTitles` collects literal titles only and FR-4 cites these
cases. The ten are: `scripts/review-decide.sh` with `REVIEW_VERDICT_BEGIN`,
`REVIEW_VERDICT_END` and `REVIEW_UNAVAILABLE`; `scripts/review-branch.sh` with
`REVIEW_UNAVAILABLE`; `.github/workflows/ai-review.yml` with the three; and
`.github/scripts/ai-review-guard.js` with the three. The vitest `role` text moves into each
case's assertion message. A further [B]-style case asserts the ten literal titles equal the
product of the four sites and their token lists, so a site or token added later without a
case fails by name instead of drifting. vitest's `expect(x).toBe(y)` becomes `assert.equal`, `toEqual`
becomes `assert.deepEqual`, `toContain` becomes `assert.ok(x.includes(y))`; the
`priorRun` / `select` fixtures move over as plain functions. The digest-mismatch case uses
`node:crypto`, which FR-8 allows.

Each of the seven FR-1 guard rails maps to at least one ported title; the mapping table, all
32 voter-reuse titles and all 13 token titles go in the pull request body (FR-3). The mapping
is checked mechanically, never by eye: every quoted `it(` title in the two vitest files is
grepped for in the shipped suite under its prefix, so cases that map to no rail (app-slug
lower-casing, the auditable `notes`, no prior runs) are not dropped.

**Sibling reads.** The token cases read `scripts/review-decide.sh`,
`scripts/review-branch.sh`, `.github/workflows/ai-review.yml` and the guard at
`path.resolve(__dirname, '..', '..', rel)`. A read error fails the case with
`assert.fail` naming the path; nothing is skipped (FR-2, INV-2). All three non-guard
siblings are generator sources (`scripts/gen-ci-templates.mjs` `GENERATED_FILES`), so the
#871 scaffolded-repo run in `ai-review-guard-test-parity.test.ts` has them, and
memory-fabric has them on disk today.

## Deletion and DR-097 (FR-3)

After every case has a counterpart, `packages/minspec/tests/voter-survivor-reuse.test.ts`
and `packages/minspec/tests/review-protocol-tokens.test.ts` are deleted. DR-097 cites the
first at lines 43 and 151; both citations are repointed to the shipped suite and keep their
`#2163 @ <sha>` commit addresses. DR-097 stays `accepted`; only those two lines change.

## Registry comment

The `ai-review-guard-test` entry in `packages/minspec/src/lib/template-registry.ts` names the
suite's runtime siblings as `ai-review.yml` and `docs-lane.yml`. After the token port it also
reads `scripts/review-decide.sh` and `scripts/review-branch.sh`; both are managed templates,
so the scaffolded set stays dependency-closed, and the comment is updated to name all four.
Comment only; no registry value changes.

## Verification

- `node --test .github/scripts/ai-review-guard.test.js` - `# fail 0`, `# tests` at least
  190 + 45 + the gate cases.
- INV-1: `npx esbuild .github/scripts/ai-review-guard.js --minify-whitespace` at the merge
  base and at head, compared byte for byte; export-name lists compared.
- Scratch-copy mutations from the acceptance criteria, each beside an unmutated control.
- `node scripts/gen-ci-templates.mjs --check`, `npm run validate`, `npm test`,
  `npm run lint`, `npm run typecheck`.

## Dependency budget

Zero new dependencies. The suite stays `node:test`, `node:assert/strict`, `node:fs`,
`node:path`, `node:crypto` and `./ai-review-guard.js` (FR-8).

## Out of scope

As requirements.md: #2165 workflow wiring, #2059 adopter CI, #1941's deeper port, the
constants (backlog line dated 2026-10-18).
