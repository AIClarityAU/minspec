---
id: SPEC-066
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-066 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-002  # Signpost Integrity - a shipped file asserting a false fact is a false signpost
relates_to: [DR-090, DR-011, DR-037, DR-051, SPEC-033, SPEC-043, "#1108", "#1098", "#1486", "#3263"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-066 - Design: managed prose is true in the repo that receives it

Plan for [requirements.md](requirements.md). Citations of "today" are against `origin/main`
cdd0820b, the commit this plan was written on. New code is cited by symbol, because its line
numbers move.

## Approach in one paragraph

One new pure module, `prose-vantage.ts`, does two things over a string: it pulls every
path-shaped token out of the text a human reads (comments, docstrings, Markdown bodies), and
it reports the ones that name a file the adopter does not get and whose enclosing prose block
does not say "minspec repo". One new vitest suite runs that over `renderManagedFile(tpl)` for
every registry entry, against a set of paths built by actually scaffolding into an empty
directory. The registry gains a `localize` field so the one comment rewrite that exists today
(#1486) lives on its entry instead of in a second table in the portability suite. The seven
known false sentences are repaired by attribution before the live gate is switched on, so
every commit on the way is green.

## The Clarify recommendations this plan builds on

`phases.clarify` is `done` on requirements.md, but the three open questions carry
recommendations rather than recorded selections. This plan builds on each recommendation;
the rejected alternatives are recorded here because nobody sees them live (DR-086 section 4).

| Question | Built as | Rejected, and why |
|---|---|---|
| OQ-1 attribution pattern | Exactly `minspec(?:'s own)? repo`, case-insensitive | A wider closed set ("upstream", "MinSpec's tree"): reads better but is a vocabulary that drifts, and every added phrase is a new way to make the gate green without saying where the file lives |
| OQ-2 derive the generator's SOURCES list from the registry | Not in this spec | Doing it here widens the file allowlist to the generator, which requirements.md explicitly puts out of allowlist; the staleness check already gates the generator |
| OQ-3 also run the gate in `npm run validate` | vitest only | Validate is a frontmatter validator; wiring a scaffolding walk into it doubles its run time for a failure that the required `test` check already blocks at PR time |

If the founder later records a different selection, only the attribution regex (OQ-1) touches
code in this plan, and it is one constant in `prose-vantage.ts`.

## What Plan found that the spec did not know

Each checked against the code at cdd0820b. None changes a requirement.

1. **The measured line numbers have moved.** AC-4's table cites `agent-context.sh:61`,
   `reviewer.md:34-40` and similar. Today the "Enforced by" claims sit at lines 67 and 272 of
   the agent-context library, the architect role's provenance block is at line 60, and the
   docs-lane byte-identity claim is at line 109. The repair tasks therefore locate each
   instance by the gate's output and by the AC-4 row's description, never by line number.
2. **The corpus has grown since DR-090 measured seven.** The registry now ships the guard's
   unit suite (#871), the Claude Code hook templates and the slash-command shims, none of
   which existed when the seven were counted. The live gate (task 8) may report findings in a
   managed file outside requirements.md's allowlist. That is a `DEEPER:` stop, not a licence
   to widen the allowlist: widening it is an edit to requirements.md, which would void the
   founder's approval. The task records the extra findings in a new issue and stops
   without landing the live gate; see the risk section.
3. **`content` already holds the localized bytes.** The ai-review entry is built today as
   `content: localizeMachineryPathsComment(AI_REVIEW_WORKFLOW)` (template-registry.ts, the
   CI_REVIEW_STACK_TEMPLATES array). Other suites read `tpl.content` as the shipped body (the
   machinery-comment-localization suite's `shipped()` helper does exactly that). So FR-7 must
   keep `content` meaning "the shipped body"; see the registry section.
4. **The portability suite's second table is `CI_STACK`** in managed-region-templates.test.ts,
   whose `localize` field is applied at the comparison
   `const real = t.localize ? t.localize(onDisk) : onDisk`. That is the one line FR-7 retargets.
5. **"Every tool detected" has a concrete shape.** `generateHarnessFiles(rootDir)` calls
   `scaffold(rootDir)` itself and gates conditional templates on `DetectedTools`
   (tool-detector.ts), which is read from marker files: `CLAUDE.md`, `.cursorrules`,
   `.clinerules`, `AGENTS.md`, `.windsurfrules`, `CONVENTIONS.md`. Writing all six into the
   temp directory first is how FR-4's "every tool detected" is reached without enumerating
   templates.
6. **The generated embed passes the egress guard now.** Regenerating ci-review-templates.ts
   used to be blocked by the drain's egress guard as high-entropy content; #3207 (generated
   file rule) fixed that on cdd0820b, so the repair tasks can regenerate in a drain run.

## The module: `prose-vantage.ts`

Pure, Tier 0: imports nothing but the `CommentStyle` type, no `fs`, no `vscode` (INV-4). The
filesystem walk for FR-4 lives in the test suite, which is where the scaffold call is.

**Prose blocks (FR-2).** `extractProseRefs` first splits the shipped text into prose blocks,
each a list of `{ line, text }`:

- `hash`: a block is a maximal run of lines whose trimmed form starts with `#` (shebang
  included; it holds no path token in practice and excluding it would be a special case).
  Python triple-quoted strings are also blocks: from a line containing an opening `"""` or
  `'''` to the line that closes it, so `canonical.py`'s module docstring is one block.
- `slash`: maximal runs of `//` lines, and every `/* ... */` span (one block per span).
- `html`: the whole body is prose; blocks are Markdown paragraphs, split on blank lines.

Line numbers are 1-based over the shipped bytes, preamble and markers included (FR-1).

**Tokens (FR-3, FR-5).** Within a block, a candidate is a whitespace- or punctuation-delimited
run matching either a directory-qualified path (contains `/`, ends in `.ext` with an
extension of 1 to 5 characters) or a bare filename whose extension is one of `.ts .tsx .py
.sh .mjs .js .yml .yaml .json`. Surrounding backticks, quotes, brackets and trailing
punctuation are stripped; Markdown link targets `(path)` are read like any other token.
Rejected before resolution:

- bare `.md` names (FR-3);
- URLs (any token containing `://`), because a link target on github.com names no file in
  either repo;
- placeholder tokens: a segment equal to or containing `NNN`, `${`, `<...>`, or a segment that
  is exactly `X` before the extension (FR-5).

**Resolution.** A qualified token resolves to its repo-relative form (leading `./` removed;
a leading `/` removed). A bare filename resolves to itself and is matched by basename.

**Attribution (FR-6).** `attributed` is true when the joined text of the token's block
matches `/minspec(?:'s own)? repo/i`. The pattern is a module constant, exported for the
suite's positive control, and the only place it is spelled.

**Foreign (FR-3, FR-4).** `unattributedForeignRefs(shipped, style, universal)` returns the
refs that are not attributed and are not in `universal`: for a qualified token, `resolved` is
not a member; for a bare filename, no member's basename equals it. Directory-qualified tokens
that name a directory the scaffold creates but no file in it are foreign; that is correct,
because the prose claims a file.

## The registry: `localize` as a field (FR-7, FR-8)

`ManagedRegionTemplate` gains the optional `localize` field exactly as the contract in
requirements.md shows. To keep finding 3 true (`content` is the shipped body), the source
entry carries the raw text plus the hook, and one normalizing step applies the hook when the
exported arrays are built:

```ts
const applyLocalize = (t: ManagedRegionTemplate): ManagedRegionTemplate =>
  t.localize ? { ...t, content: t.localize(t.content) } : t;
```

applied to `CI_REVIEW_STACK_TEMPLATES` (the only array with a hook today) at its definition,
so `MANAGED_REGION_TEMPLATES` and `SELF_HOSTED_TEMPLATE_NAMES`, which spread it, see the
localized body unchanged. The ai-review entry becomes `content: AI_REVIEW_WORKFLOW,
localize: localizeMachineryPathsComment`. `localizeMachineryPathsComment` is unchanged
(FR-7: "moves onto its entry unchanged"), and its three throws already satisfy FR-8 for the
one hook that exists.

Rejected: applying the hook inside `renderManagedBlock`. It would leave `tpl.content` raw, so
every reader of `tpl.content` that means "what ships" (finding 3) would silently start reading
the upstream claim.

**The portability suite (AC-5).** `CI_STACK` loses its `localize` field; the comparison reads
`tpl.localize` from the registry entry. Because removing the hook from the registry would then
compare raw to raw and pass, two registry-driven assertions make the suite fail instead:

- for every entry with `localize`, `tpl.localize(onDisk) !== onDisk` (the hook is not a no-op
  on today's source) and `tpl.localize('')` throws (FR-8's "throws when the anchor is absent",
  checked for every hook, not only the #1486 one);
- the ai-review entry carries a `localize` hook. This is a named pin, not an enumeration of
  the set: it anchors the one hook #1486 requires, and AC-5 is phrased as exactly that removal.

## The suite: `managed-prose-vantage.test.ts`

Its header states FR-11's limit: a claim with no path token is invisible to this gate, and no
artifact may describe it as closing the class.

- **Unit cases** over synthetic strings, one per FR-2 style, FR-3 rule and FR-5 placeholder
  form, plus line numbering over a preamble.
- **Positive control (INV-3)** through the same `unattributedForeignRefs` call the live gate
  uses: an unattributed foreign ref in a synthetic `hash` block is rejected, and the same
  block with "in the minspec repo" added passes. Both directions.
- **Universal set (FR-4)**: `beforeAll` makes a temp directory, writes the six tool marker
  files, runs `generateHarnessFiles(tmp)`, and walks it from disk into a `Set` of
  repo-relative paths. The six marker files stay in the set: an adopter that uses that tool
  has the file, and none of them carries a code extension, so none can satisfy a bare-name
  reference by accident. Anti-vacuity: the set must contain the
  `outputPath` of every registry entry whose `condition` holds for all-true tools, read from
  the registry, so a broken walk cannot shrink the set to nothing.
- **Anti-vacuity (INV-2)**, before any pass/fail case: `extractProseRefs` over the shipped
  canonical-hasher template yields at least one ref on a line inside its module docstring, and
  over the shipped reviewer role yields at least one ref.
- **The live gate (INV-1, AC-3)**: `it.each` over `MANAGED_REGION_TEMPLATES`, one case per
  template name, asserting `unattributedForeignRefs(renderManagedFile(tpl), tpl.commentStyle,
  universal)` is empty. The failure message lists `name:line token` for each finding, so a new
  template whose prose names an unscaffolded sibling fails naming the template, line and token.
- **AC-4 cases**: one per row of requirements.md's AC-4 table, each asserting that the shipped
  text of that template carries no unattributed foreign ref and, for the canonical-hasher row,
  that its docstring no longer says "INV-2 fails" as a local consequence.

Rejected: a vitest snapshot of the current findings, so the live gate could land before the
repairs. A snapshot is an exception list by another name (FR-6, INV-6).

## Order of work and why

Synthetic helper first (green on its own), registry hook second (independent of the gate),
then the repairs, each with its AC-4 case, then the live gate last. Landing the live gate
first would put a red required check on `main` between tasks; landing it last means AC-1's
"fails before the repairs" is shown by running the finished suite against cdd0820b's tree and
quoting the output in that task's pull request, as requirements.md asks ("proven by running
it against the pre-repair tree").

## Risks

- **More findings than the allowlist covers** (finding 2). Handled as a stop, as above. The
  plan does not pre-measure them: the extractor that would measure them is task 1.
- **Machinery review.** The repair tasks edit `scripts/` and a workflow under
  `.github/workflows/`, so their pull requests are machinery pull requests: they land on the
  machinery path (bot `--admin` under DR-112 where it applies, otherwise the founder's merge),
  not the docs lane.
- **The generated embed.** Every task that edits a shipped source re-runs the generator in the
  same commit; `npm run validate` fails a stale embed, so a forgotten regeneration is caught.
