---
id: SPEC-137
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity - the review comment is the surface a human reads to decide; it must be readable AND must not lie
aspects: [ai-review, review-comment, markdown, escaping, prompt-injection, untrusted-output, no-silent-gate, machinery]
relates_to: [SPEC-031, SPEC-044, DR-033, DR-003, "#502", "#479", "#1135", "#1157", "#458"]
# Ownership declared in Specify (SPEC-038). No NEW files: every change lands in an
# existing file. All are review machinery, so the implementing PR is forced to human
# review by the self-edit guard (that is correct, not a defect). ci-review-templates.ts
# embeds byte-exact base64 copies of ai-review.yml and ai-review-guard.js for adopters
# (template-registry.ts:2370-2389), so it must be regenerated in the same PR (INV-5).
affects: [.github/scripts/ai-review-guard.js, .github/scripts/ai-review-guard.test.js, .github/workflows/ai-review.yml, scripts/dispatch-issue.sh, packages/minspec/src/lib/ci-review-templates.ts]
phases:
  specify: done
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# SPEC-137 — Readable ai-review verdicts: wrapped markdown, rendered inert

**Issue:** #502 (render ai-review verdict blocks as readable wrapped markdown).
**Rests on:** DR-033 (the gate decides from consequence: the AI review gates merge, and the
human reads the comment), and DR-003 (root cause before fix; a signpost must not lie).

## Problem

`ai-review.yml` posts each voter's verdict as the raw `REVIEW_VERDICT_BEGIN … END` block
inside a triple-backtick fence. Code fences do not wrap. They scroll sideways, so a finding
longer than the viewport cannot be read without scrolling, and the human who holds the
merge keystroke (DR-033) reads exactly this comment. `scripts/dispatch-issue.sh` posts its
advisory review the same way.

The fence is not only formatting, it is also a **neutraliser**. The verdict text is
semi-tainted: the voter read an untrusted diff and can be prompt-injected into writing
markdown or HTML of the attacker's choosing. Inside a fence, that text renders as literal
characters. If we take the fence away, something else has to do the neutralising.

### What changed since the issue was filed (observed on the base checkout, 2026-10-16)

The issue cites "lines ~340-346" and "the two fenced dumps". The code has moved on:

- There are now **four** voters, each with its own fenced dump: Reviewer, Security,
  Architect and Skeptic (`.github/workflows/ai-review.yml:917-941`). The property applies
  to all four, not only the two named in the issue.
- The voters' raw blocks pass through `extract_block | redact`
  (`.github/workflows/ai-review.yml:493-515, 723-753`) before they are posted.
- **The posted comment is also an input.** The shepherd fix-agent path in
  `scripts/dispatch-issue.sh:1753-1757` takes the last `REVIEW_VERDICT_BEGIN … END` span
  from trusted PR comments as its feedback. A plain swap of the raw block for rendered
  markdown would remove those markers. The feedback would then be silently empty, the fix
  agent would get no review findings, and no check would go red (invariant 2, no silent gate).
- `scripts/review-decide.sh:155-190` records a known way the comment can lie: the comment
  shows `pass, blocking: 0` while the label says `changes`, because the gate counts markers
  over the voter's *raw* output (#1157). A header derived only from parsing the displayed
  block would print that contradiction in bold.

## Functional requirements

### The renderer

- **FR-1 — Pure helper.** `.github/scripts/ai-review-guard.js` exports a pure function
  that turns one voter's (already redacted) verdict block into a markdown fragment. It has
  no I/O, no network and no environment reads, and the same input always gives the same
  output. The name must not be confused with the existing `renderVerdictBlock`, which
  goes the other way (structured to raw). `renderVerdictMarkdown` is suggested, and the
  name is the plan's call.
- **FR-2 — Header from the gate's decision.** The header's pass/changes state comes from
  the label that `review-decide.sh` already computed for that voter. The renderer takes it
  as an input. It is not re-derived from the displayed text. Shape:
  `**✅ pass · 0 blocking**` or `**🔴 changes · N blocking**`. N is the parsed `blocking:`
  integer.
  - **FR-2a — Disagreement is shown, never smoothed over.** If the parsed block says
    `pass` (or `blocking: 0`) but the decided label is `changes`, the header shows
    `changes` and adds one plain line saying the gate refused the block as displayed (for
    example, ambiguous or more than one verdict marker, see #1157). The comment must never
    show a bold "pass" next to a `changes` label.
  - **FR-2b — Blocked is distinct.** A voter whose output was the could-not-run marker
    (`ai-review:blocked`) keeps today's separate blocked rendering. The renderer never
    turns blocked into pass or into changes.
- **FR-3 — Summary as wrapped prose.** `summary:` renders as one escaped paragraph, so it
  wraps at the viewport.
- **FR-4 — Findings as a list.** Each `findings:` entry renders as one bullet with three
  parts:
  - **FR-4a — Severity.** Severity is bold (`**MAJOR**`) only if, normalised, it is in a
    closed vocabulary that the plan fixes (at least `blocker`, `critical`, `major`, `minor`,
    `note`, `info`). Anything else is shown escaped and not bold. Untrusted text never gets
    to choose its own emphasis.
  - **FR-4b — Location.** The `file:line` location goes in an inline code span, with any
    backtick removed first (the `sanitizeLogin` pattern,
    `.github/scripts/ai-review-guard.js:1956-1958`), so the span cannot be closed early.
  - **FR-4c — Description.** The description renders as escaped prose (FR-6).
- **FR-5 — Unparseable falls back to the fence.** If the block is not exactly one
  well-formed verdict block, the renderer returns today's fenced rendering of the raw text.
  "Well-formed" uses the existing `isStructuralVerdictBlock`. The fallback covers an empty
  block, the fail-closed placeholder `(… emitted no verdict block — fail-closed to
  changes)`, a missing or non-integer `blocking:`, and a block that throws while parsing.
  The fallback fence is robust: it is longer than the longest backtick run in the content,
  or it uses `~` fencing. Failing to render readably must never fail open to unescaped
  output.

### Neutralisation of untrusted text

- **FR-6 — One escape function.** Every piece of model-written text (summary, severity
  that falls outside the vocabulary, description) goes through one escape function before
  it is put into markdown. After escaping, the text renders as literal characters on
  GitHub:
  - **FR-6a — Backslash first.** The backslash is escaped first, so later escapes cannot
    be undone.
  - **FR-6b — Characters with markdown meaning.** Every CommonMark ASCII punctuation
    character that has meaning is backslash-escaped, wherever it sits in the line:
    `` ` * _ [ ] ( ) < > # + - ! | ~ { } ``. That covers code spans and fences, emphasis,
    links and images (`![](…)` anywhere in the line, not only at the start), raw HTML,
    headings, block quotes, list markers, tables and strikethrough. `&` is escaped (or
    encoded as `&amp;`), so an entity cannot smuggle a character past the filter.
  - **FR-6c — Newlines.** CR and LF become single spaces, so one field is always one line
    and cannot open a new block.
  - **FR-6d — GitHub's own linking.** `@login` and `@org/team` mentions must not notify
    anyone. `#N`, `owner/repo#N` and `GH-N` references must not create a cross-reference
    on another issue or PR's timeline. Bare `http(s)://` URLs must not become links. The
    plan picks the method and checks it with a real GitHub rendering (D-2).
  - **FR-6e — Spoofing characters.** Bidirectional-override and zero-width characters are
    removed or made visible, so the displayed text cannot hide or reorder content (for
    example, a fake `✅ pass` inside a finding).
- **FR-7 — Protocol tokens stay defanged.** Rendered text still goes through
  `defangProtocolTokens`, so the rendered comment never contains a bare
  `REVIEW_VERDICT_BEGIN/END`, `REVIEW_UNAVAILABLE` or a line-anchored `ESCALATE:` that came
  from model text. The only exception is the raw block FR-11 keeps on purpose.
- **FR-8 — Size limits.** Each field stays clamped to `MAX_FIELD` (500 characters, via
  `clampField`). The number of findings shown is capped by the plan, with a "+K more"
  line, so a voter cannot push the comment past GitHub's 65,536-character body limit and
  get the post rejected. A post that fails is a silent gate. Clamping changes only the
  display, never the verdict or the blocking count.

### Wiring

- **FR-9 — Workflow.** `ai-review.yml` builds the comment from renderer output for all four
  voter sections (Reviewer, Security, Architect, Skeptic). The raw block and the decided
  label reach `node` through an **environment variable or stdin**. They are never placed
  in the script text by shell interpolation or by a `${{ … }}` expression.
- **FR-10 — Order.** The order is `extract_block`, then `redact`, then render. The
  renderer never sees unredacted text, and its output is a subset of what it was given,
  plus fixed scaffolding.
- **FR-11 — The fix agent's feedback keeps working.** The shepherd path at
  `scripts/dispatch-issue.sh:1753-1757` must still get the same verdict text after this
  change, from a trusted author, exactly as it does today. D-1 decides how. Whichever
  option is chosen, a test fails if the feedback read gives an empty result for a comment
  the new renderer produced.
- **FR-12 — Advisory review in dispatch.** The advisory review body in
  `scripts/dispatch-issue.sh` (`:1321-1328`) uses the same renderer, from the same module.
  There is no second escape implementation in bash. The egress scan
  (`scripts/egress-scan.sh`, `:1336-1350`) still runs on the **final rendered** body, and
  still withholds the body if the scan fails or matches anything.
- **FR-13 — Renderer crash.** If `node` fails or prints nothing, that voter's section falls
  back to today's fenced raw block, and the run log says the fallback happened. A crash
  never posts an empty section, and never posts unescaped text.

## Acceptance criteria

- **AC-1.** Unit tests in `.github/scripts/ai-review-guard.test.js` cover pass and changes
  headers, and a summary and three findings rendered as wrapped markdown.
- **AC-2 — Injection fixtures render inert.** For each of these, placed in the summary and
  in a finding description, the test asserts that the output contains no unescaped
  construct:
  - a triple-backtick fence, and a `~~~` fence
  - `<img src=x onerror=…>`, `<details>`, `</details>`, `<!--`
  - `# heading` and `> quote`
  - `![x](https://attacker.example/p.png)` in the middle of a line
  - `[click](https://…)`
  - `| a | b |`
  - `@AIClarityAU/maintainers`, `@harvest316`
  - `AIClarityAU/minspec#1`, `#1`
  - a U+202E bidi override
  - an embedded `REVIEW_VERDICT_BEGIN`, and an `ESCALATE:` at the start of a line
  - an entity `&#96;&#96;&#96;`
- **AC-3 — Escape cannot be undone.** A description ending in `\` followed by a backtick
  stays escaped (backslash-first order).
- **AC-4 — Header follows the gate.** A block that says `verdict: pass, blocking: 0`, with
  decided label `ai-review:changes`, renders a `changes` header plus the disagreement line.
- **AC-5 — Fallbacks.** The fail-closed placeholder, an empty block, a block with two
  begin markers, and a non-integer `blocking:` each give a fenced fallback that the
  content cannot break out of.
- **AC-6 — Fix agent still gets its feedback.** Run a comment body produced by the new
  workflow rendering through the same awk/`--trusted-comment-bodies` pipeline as
  `scripts/dispatch-issue.sh:1753`. The result is non-empty and equals the voter's raw
  block. This is a test, not a reading of the code. Mutation check: delete the D-1
  carrier and the test goes red.
- **AC-7 — No interpolation.** A test (or a check of the workflow's text structure) proves
  that the raw block reaches `node` only through the environment or stdin, and that no
  `${{` appears in the renderer's script text.
- **AC-8 — Dispatch body is scanned.** The advisory body built from renderer output still
  goes through `egress-scan.sh`. A fixture with a secret-shaped string (the shape only,
  never a real credential) is still withheld.
- **AC-9 — Rendered on GitHub, once.** The plan records one rendering on GitHub of the
  AC-2 fixture set (for example, through the markdown render API or a comment on a
  throwaway PR, both done by a human). It shows that mentions, cross-references, images
  and links did not fire. An offline unit test cannot see GitHub's autolinker, so AC-2
  alone does not prove FR-6d.
- **AC-10 — Existing tests stay green.** The existing verdict-channel, panel and
  voter-record tests (`packages/minspec/tests/verdict-channel.test.ts`,
  `ai-review-parallel-panel.test.ts`, `voter-survivor-reuse.test.ts`,
  `ai-review-verdict-carry.test.ts`, `dispatch-ready-check.test.ts`) stay green, run the
  way CI runs them (`npx vitest`).

## Invariants this change must not break

- **INV-1 — The decision does not move.** `review-decide.sh` stays the single definition
  of a verdict's meaning. The renderer is display-only and never changes a label, the
  blocking count, a voter record, or the `ready-to-merge` witness.
- **INV-2 — No silent gate** (constitution invariant 2). A failure to render, to post, or
  to read back fails visibly (FR-5, FR-11, FR-13). None of the new code may add
  `|| true` on a path whose output a gate reads.
- **INV-3 — Redaction comes first.** No reviewer text reaches the comment without passing
  through `redact` in the workflow, or the egress scan in dispatch.
- **INV-4 — Offline / Tier 0** (constitution invariant 1). The renderer makes no network
  call. The only network use is the existing posting of the comment.
- **INV-5 — Blast radius and adopter parity** (constitution invariant 3). `ai-review.yml`
  and `ai-review-guard.js` are **shipped to adopters**. `ci-review-templates.ts` embeds
  byte-exact base64 copies, and a portability test checks that they match the repo's own
  files (`packages/minspec/src/lib/template-registry.ts:2370-2389`). The plan regenerates
  those copies in the same PR, so the portability test stays green. Adopters receive the
  change only through the managed-region refresh they opted into with `.minspec/`, which
  is within the blast radius. The workflow part must use no value that only exists in
  minspec. The `dispatch-issue.sh` part (FR-12) does not ship; it is dev-time only.
- **INV-6 — Machinery review.** The implementing PR touches `.github/` and `scripts/`, so
  it is forced into `needs-human-review` and `machinery-review-required`. That is correct
  and expected.

## Decisions needed (Clarify)

### D-1 — How the fix agent keeps getting the raw verdict (FR-11)

- **(a) Raw block in a collapsed `<details>` under the rendered view (rec).** The fence
  inside it uses `~~~~` or a backtick run longer than any in the content.
  - For: the existing awk reader works unchanged. The comment keeps an audit copy. The
    change is smallest.
  - **Cost:** the raw dump stays in the comment (collapsed, so out of sight), and the body
    is roughly twice as long, which uses up the FR-8 size budget sooner.
- **(b) Base64 in an HTML comment** (`<!-- review-verdict-raw:<role>:<b64> -->`), with the
  dispatch reader changed to decode it.
  - For: there is no visible duplicate. Base64 cannot contain `-->`, so the content cannot
    break out of the HTML comment.
  - Cost: the reader in `dispatch-issue.sh` changes, along with its tests. The raw text is
    no longer visible to a human.
- **(c) The fix agent reads voter records from the check-run output** (the base64
  `voter-record:` already there, `.github/scripts/ai-review-guard.js:564-580`), and the
  comment drops the raw block.
  - For: cleanest. The comment is purely for humans.
  - Cost: the largest change. The shepherd needs a check-run read it does not do today,
    and that read is tied to the App's identity (#1135's trust filter would have to be
    designed again for check runs).
- Rejected: an HTML comment holding the raw text. A `-->` anywhere in the content closes
  it, which is an injection path.

### D-2 — How mentions, cross-references and bare URLs are neutralised (FR-6d)

- **(a) Insert U+2060 WORD JOINER after `@` and `#`, and inside `://` (rec).**
  - For: the text reads the same and copies almost the same.
  - **Cost:** depends on GitHub's autolinker not ignoring U+2060. That is unverified; AC-9
    is what checks it. Copied text carries an invisible character.
- **(b) Put every `@word`, `#N` and URL in an inline code span.**
  - For: mentions and autolinks do not fire inside code spans (I believe; this is what
    today's fence relies on, and it is unverified for spans).
  - Cost: looks noisier, and backticks inside must be stripped.
- **(c) Backslash-escape only.**
  - Cost: GitHub's handling of `\@` and `\#` for mentions and cross-references is not
    documented as a guarantee. Not recommended without AC-9 evidence.

### D-3 — Scope of the dispatch advisory path (FR-12)

- **(a) Include it in this spec (rec, the issue asks for it).**
  - **Cost:** `dispatch-issue.sh` becomes a second caller of the guard module, which is a
    runtime coupling from `scripts/` to `.github/scripts/`.
- **(b) Split it into its own issue.**
  - For: a smaller machinery PR.
  - Cost: for a while, the two review surfaces render differently.

## Alternatives rejected (DR-086 §4 record)

- **A wider fence, or `white-space` wrapping.** GitHub markdown has no wrapping control for
  fences, so this does not solve readability.
- **Rendering in bash with `sed`.** That would be a second escape implementation in two
  places (workflow and dispatch), free to drift. That is the duplicated-predicate failure
  the memory index records.
- **Taking the header from the displayed block.** It would print #1157's contradiction in
  bold (FR-2).
- **Escaping only the characters the issue lists (backtick, `<`, `>` and characters at the
  start of a line).** That leaves images and links in the middle of a line, mentions,
  cross-references and entities live (FR-6b, FR-6d). The issue's list is a minimum.

## Out of scope

- Changing what the voters emit, the verdict schema, or `review-decide.sh`.
- Rendering the `REVIEW_UNAVAILABLE` and quota sections (`ai-review.yml:870-905`). Their
  fenced detail stays as it is.
- Any adopter-facing change beyond regenerating the byte-exact parity copies (INV-5).
