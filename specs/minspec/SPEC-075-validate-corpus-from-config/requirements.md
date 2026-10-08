---
id: SPEC-075
type: requirements
status: specifying
tier: T3
product: minspec
epic: EPIC-002  # Signpost Integrity — a gate that validates a corpus the project does not have is a false signpost
aspects: [harness, managed-files, gate, no-silent-gate, config, tier-0, downstream]
relates_to: [DR-037, DR-066, DR-090, SPEC-038, SPEC-066, SPEC-068]
implements: [packages/minspec/tests/validate-py-corpus-config.test.ts]  # NEW — the T0 this spec owns
affects: [packages/minspec/src/lib/template-registry.ts, .minspec/hooks/validate.py, .minspec/config.json, packages/minspec/tests/shipped-ownership-gate-2250.test.ts]  # template-registry.ts is claimed by no spec's implements:; SPEC-066 and SPEC-063 both list it under affects: only, and this spec follows that precedent (one owner per file). shipped-ownership-gate-2250.test.ts is declared now, before approval, because FR-2 reverses one case it pins (see Test)
phases:
  specify: in-progress
  clarify: pending
  plan: pending
  tasks: pending
  implement: pending
---

# MinSpec — The managed validator reads its corpora from config, so a project can extend it without editing managed code (Requirements)

**What you are approving.** One change to `.minspec/hooks/validate.py`, the commit-gate
script MinSpec scaffolds into every project: it will take the list of folders it checks from
`.minspec/config.json` instead of a list written into the script, so a project can add a
folder without editing a file that *Refresh Harness Files* overwrites. The requirements are
the ones you approved on 2026-10-01. That approval does not carry over, because the text has
changed in four ways since. The three Clarify answers the spec already recommended are now
written down by an agent, and stand only if you approve: a new `validatedCorpora` config key,
no project-editable block inside the script, and this repository's own copy brought into line
afterwards as issue #2390 (declare this repo's corpora in config). A count the old text got
wrong is corrected: since #2264 (the shipped ownership rule), merged three minutes before
your first approval, the shipped script already reads the config for one setting. Because of
that, FR-2 now says outright that a config file which exists but cannot be read or parsed
fails the whole script, replacing that rule's warn-and-carry-on. And the spec now says what
it does not fix: the check that issue #1698 (refresh deleted a project's commit gate)
reported lost. What it costs: once this is built, a broken config file blocks every commit
the script checks until the file is fixed, where the shipped script today at most prints a
warning; and an edit a project makes inside the managed part of a file, the check #1698 lost
included, is still overwritten without notice on refresh, which needs a separate spec (issue
#2615, the refresh half of #1698). Nothing is left open for you to answer: five choices are
recorded with the alternatives not taken, and approving accepts all five.

> **This is a SPECIFICATION ONLY.** No code, script, template, or test is created by this
> document. It is the Specify-phase artifact for #1698 (harness refresh silently deletes a
> project's commit gate), which triage classified `T3` · `role:architect` · `hold:specify`,
> so the spec is the gate, not the fix. It covers one half of that issue; the other half is
> named under [What this spec does not close](#what-this-spec-does-not-close). Each Clarify
> question carries an agent-recorded selection under
> **[Clarify selections](#clarify-selections-recorded-by-an-agent-2026-10-01-and-2026-10-09-ratified-only-by-approval-of-this-spec)**;
> the human answers by approving this spec with those in place, or by changing them first.
> Every requirement below is written under those selections, so approving the spec as it
> stands accepts them and leaves no Clarify question open.

## Changes since the approved text

The text approved on 2026-10-01 is the one on `main` at `901fea36`. Its canonical hash is
`04311d22048f6c4b48efd6123d6855f5104202068887d18265df6ad5f10c545f`, the hash all three
approval records of this spec carry. Every change from it is listed here; a line no item
names is byte-identical to that text.

1. **Clarify selections recorded for CQ-1, CQ-2 and CQ-3,** each taking the option the
   approved text already recommended. Source: #2392 (the Clarify-selections pull request).
   Its three selection lines are carried word for word. Its introductory paragraph is
   extended to cover CQ-4 and CQ-5, and its five code citations are read again at
   `901fea36`, where one range had moved (`resolveStatus`, `:483-490` to `:489-496`).
2. **A stale measurement corrected.** The approved text said neither copy of the validator
   reads `.minspec/config.json`. The shipped template has read it for one key since #2264
   (the shipped ownership rule). Corrected in "The defect, measured" and in the three later
   passages that leaned on the count: two list items under "Why this is invariant 2", and
   "config-blind" in the drift section, which becomes "hard-coded". Source: #2391 (the stale
   config-blind measurement), first reported in a comment on #2344 (the second approval
   pull request).
3. **FR-2's reach stated, and one outcome fixed where FR-2 and the shipped template
   disagree.** FR-2 gains a paragraph, FR-1 loses the word "unreadable", AC-7 is new, CQ-5
   is new and carries a recorded selection, and the test that pins the old outcome is named
   under Test and declared under `affects:` (with SPEC-038, the ownership rule's spec, added
   to `relates_to:`). Source: #2391.
4. **What this spec does not close is said outright.** A new Context section; AC-5 and CQ-1
   option `b` no longer read as if this spec closed #1698; CQ-2 states the cost of not
   taking `c`; CQ-4 is new and carries a recorded selection. Source: #2303 (the drain-written
   rewrite of this spec).
5. **Citations that had moved are read again at `901fea36`** in "The drift this repo
   currently carries proves the point". Source: this consolidation.
6. **The top of the document:** the opening paragraph, this section, the wording of the note
   under them, and a Prior-art entry for the config read the template already has. Source:
   this consolidation.

Not carried:

- **From #2303, the refresh half:** FR-7 to FR-14, AC-7 to AC-14 and INV-5 to INV-7 of that
  draft, its three further Clarify questions, its second owned test and its new title. It
  widens the approved scope to a second mechanism in `scaffold.ts` and to every
  managed-region template instead of one file, none of its three questions is answered and
  one of them is a tracked-format choice its own text reserves for the founder, its
  recommended design waits on SPEC-068 (harness refresh direction gate), which is not built,
  and its last review asked for changes. It is tracked as #2615 (the refresh half of #1698)
  and needs a spec id of its own.
- **From #2311, #2344 and #2385 (the three approval pull requests):** nothing. Each changes
  only `status:`, `phases:` and an approval record, and none changes a word of the body.
  Approval is the founder's act, made on this text once it is on `main`; nothing in this
  change records, implies or stands in for one.

## One-Sentence Scope

`.minspec/hooks/validate.py` must derive which document corpora it validates from
`.minspec/config.json` instead of hard-coding them, so a project can add, move, or drop a
validated corpus without editing a fully-managed file that *Refresh Harness Files* will
overwrite.

## Context

### The defect, measured

`.minspec/hooks/validate.py` is a managed-region template
(`template-registry.ts`, `name: 'validate-py'`, `outputPath: ${MINSPEC_HOOKS_DIR}/validate.py`),
so its region is rewritten byte-for-byte on every refresh. It hard-codes its corpora:

```python
# .minspec/hooks/validate.py:92
targets = all_md(root, "specs") + all_md(root, os.path.join("docs", "domain"))
# :105
is_domain = norm.startswith("docs/domain/") and norm.endswith(".md")
```

`.minspec/config.json` **already declares those paths**, and neither copy of the validator
reads them:

| config key | value in this repo | read by validate.py? |
|---|---|---|
| `specsDir` | `specs` | no |
| `decisionsDir` | `docs/decisions` | no |

Measured at `901fea36`, as occurrences of each term:

| copy | `config.json` | `import json` | `specsDir` | `decisionsDir` |
|---|---:|---:|---:|---:|
| this repository's, `.minspec/hooks/validate.py` | 0 | 0 | 0 | 0 |
| the shipped template, `VALIDATE_PY`, `template-registry.ts:1759-2163` | 5 | 1 | 0 | 0 |

The two copies differ on whether they read the config at all, and agree that the corpora do
not come from it. This repository's copy reads no config. The shipped template has read
`.minspec/config.json` for one key, `ownershipDeclaration`, since #2264 (the shipped
ownership rule; `ownership_declaration`, `template-registry.ts:1880-1897`), and still
hard-codes its corpus list (`:2080-2084`). The text approved on 2026-10-01 said both copies
had zero occurrences of `config.json` and of `import json`. That was true of the template
until #2264 merged, three minutes before the first approval, and it is corrected here
(#2391, the stale config-blind measurement).

So the extension point does not need inventing. It needs **wiring to configuration the
project already has**, and in the shipped template to a config read that is already there,
which is why this is a repair rather than a new feature surface.

### Why this is invariant 2, not a preference

#1698 filed this as a silent-gate fault and that reading is correct. The failure is not
"a project cannot customise the validator". It is:

1. Nothing ties the hard-coded corpus list to `.minspec/config.json`'s `specsDir`/
   `decisionsDir`: measured above as zero `specsDir` and zero `decisionsDir` occurrences
   in either copy. The two can drift from each other, silently, in either
   direction.
2. *Refresh Harness Files* rewrites the managed region from the template, overwriting
   whatever corpus list the live file currently carries with the template's — whichever one
   that happens to be.
3. **The hook still exits 0** whichever list wins. Nothing reports the difference, because a
   validator that never reads its corpora from config has no way to notice its list
   disagrees with config, and a
   validator that checks fewer files passes more often either way.

That is the shape invariant 2 names: a gate whose coverage can silently diverge from what the
project's own config declares. A red check is a working gate; a gate that quietly stops
looking — or never looked at the declared truth in the first place — is the defect.

### The drift this repo currently carries proves the point

The live file and its own template diverge on corpora today, measured at `901fea36`
(`.minspec/hooks/validate.py:92` vs. `template-registry.ts:2080-2084`):

- live validates `specs` + `docs/domain`
- the template validates `specs` + `docs/decisions` + `docs/domain` — a strict superset,
  including the DR-frontmatter check (`DR_ID_RE`, `template-registry.ts:1784`) the live file
  lacks entirely

So today's drift runs one way: a refresh here would **add** `docs/decisions` coverage and
remove nothing, since `docs/domain` is already in both copies. That the direction happens to
be benign today is not a property of the mechanism, only of which copy was edited last: the
same hard-coded, hand-edited, uncompared pair could just as easily drift the other way on a
future edit, and nothing would catch that either. That drift is waived (not fixed) by the
#1888 self-application gate, whose waiver for this path names this spec's design question as
the reason it is waived rather than reconciled.

### What this spec does not close

#1698's report names the check that was deleted: a project-added rule in `validate.py`
asserting that a decision record's frontmatter `status:` agrees with the `- **Status:**`
line in its body. That is a comparison between two places in one document. The shape this
spec gives a corpus (FR-4; under CQ-1's recorded selection, a path mapped to a required
frontmatter key and pattern) can say that a key must exist or must match a pattern. It has
nowhere to name a second location, so it cannot express that rule. None of FR-4's examples
and none of the acceptance criteria below compares two places in a document.

So this spec closes one class of silent loss: a corpus the project needs checked lives in
config, which a refresh does not own, instead of in a list a refresh rewrites. It does not
give the project that filed #1698 a home for the check it lost (CQ-4), and it does not change
what a refresh does to an edit made inside a managed region. At `901fea36`
`refreshManagedRegionTemplates` (`packages/minspec/src/lib/scaffold.ts:1100`) splices the
template into the region and writes whenever the bytes differ (`:1141-1146`), and returns a
warning only for a file it left untouched (`:1092-1094`), so a replaced region is reported
nowhere.

That second half of #1698 (report every replacement, detect an edited region and hold it,
correct the command description that promises to preserve edits) was drafted inside this
document by #2303 (the drain-written rewrite of this spec) and is not carried here, for the
reasons under Changes since the approved text. It is tracked as #2615 (the refresh half of
#1698), and #1698 stays open for it. **Approving this spec does not close #1698.**

### Prior art this spec must reuse, not duplicate

- **`specsDir` / `decisionsDir` already exist** in `.minspec/config.json` and are consumed
  elsewhere in the extension. This spec must not introduce a second, parallel way to name the
  specs directory.
- **DR-090 (managed prose is judged from the consumer's vantage)** governs every comment this
  change writes into the template: the docstring currently asserts
  `docs/domain/*.md must have type: domain`, which is a fact about *this* repo, not about an
  adopter. Any corpus list that becomes configurable must stop being asserted as universal
  prose in the shipped file.
- **DR-037** owns the hook-scaffolding chain this validator sits in; the config read must not
  change the hook's detection or install contract.
- **The shipped template already reads `.minspec/config.json`,** for `ownershipDeclaration`
  (`template-registry.ts:1880-1897`). The corpora must come from that same read, not from a
  second one beside it with a failure rule of its own (FR-2, CQ-5).

### Why no new DR

The decision "extend by configuration, not by an unmanaged code region" is not novel here — it
is the existing posture of every managed template (bytes held identical by construction,
behaviour parameterised by `.minspec/config.json`). This spec applies that posture to one file.
If Clarify selects an unmanaged-code-region design instead (CQ-2 below), that **would** need a
DR, because a sanctioned edit point inside a managed file is a new and hard-to-reverse public
contract.

## Functional Requirements

- **FR-1 (corpora come from config, with the current behaviour as the default).** `validate.py`
  MUST derive its validated corpora from `.minspec/config.json`. When the config is absent,
  or parses and declares no corpora, it MUST validate exactly what it validates today, so an
  adopter who never opens the config sees no behaviour change. A config that exists and
  cannot be read is FR-2's case, not this one (CQ-5). *Rationale: a gate that changes
  coverage on upgrade is the very fault this spec repairs; the default must be continuity.*

- **FR-2 (config parse failure fails CLOSED and visibly).** A malformed `.minspec/config.json`
  MUST cause a non-zero exit with a message naming the file and the parse error. It MUST NOT
  fall back to the default corpora silently. *Rationale: invariant 2 — the failure mode this
  spec exists to remove must not be reintroduced at the config-read step. A silent fallback
  would make a typo in the config look like a passing gate.*

  **Reach (CQ-5).** This holds for the whole script, on both entry points and whatever is
  staged: one read of the config, made before the validator decides which files are in scope
  (FR-6 needs the config to decide that), and one outcome when that read fails. Every rule
  that needs a config value MUST take it from that read, and none may carry on at a default
  after it fails. A config that exists and cannot be opened is the same case as one that
  cannot be parsed. This replaces the outcome the shipped ownership rule has today for the
  same file: a `WARN` line, after which the rule runs at its default, with the read deferred
  to the first spec so that a commit which stages none never hears about a broken config
  (`template-registry.ts:1890-1895`, `:2093-2095`, `:2125-2126`). An absent config is not a
  failure and keeps today's default for every rule (FR-1; `:1885-1886`). What else counts as
  malformed (a file that parses to something other than an object, a `validatedCorpora`
  entry of the wrong type) is for Plan, bounded by INV-1: an entry the validator cannot
  interpret MUST NOT be skipped silently.

- **FR-3 (Tier 0 — no new dependency, no network).** The config read MUST use only the Python
  standard library (`json`), and MUST NOT add a dependency, a subprocess, or any network call.
  *Rationale: this hook runs pre-commit on every developer machine; MinSpec's core works
  offline (invariant 1).*

- **FR-4 (declared corpora carry their own rule, not a hard-coded one).** Each configured
  corpus MUST carry the frontmatter requirement that applies to it, so a project can add a
  corpus without a code change teaching the validator what that corpus requires. The
  `specs` → `id: SPEC-NNN` and `docs/decisions` → `id: DR-NNN` rules MUST be expressible in
  the same form as any project-added rule, with no privileged built-in path.

- **FR-5 (the docstring stops asserting this repo's corpora).** The shipped file's header MUST
  describe the *mechanism* (corpora and their required frontmatter are read from
  `.minspec/config.json`) rather than listing `specs` and `docs/domain` as universal facts
  (DR-090). Any example MUST be marked as an example.

- **FR-6 (`--pre-commit` path unchanged in scope).** The staged-file path
  (`validate.py:89-90`) MUST apply the same configured rule set to staged files. A file is
  validated if and only if it falls under a configured corpus — so the two entry points can
  never disagree about what is in scope. *Rationale: a pre-commit gate that checks a different
  set than CI is two gates with one name.*

## Acceptance Criteria

- **AC-1.** With no `.minspec/config.json` present, the validator's exit code and reported
  errors are byte-identical to today's for a fixture corpus containing one valid and one
  invalid spec.
- **AC-2.** With a config declaring an additional corpus, a file in that corpus with missing
  required frontmatter causes a non-zero exit, and the message names the file.
- **AC-3.** With a config declaring a corpus the project does not have, the validator exits
  zero and does not error on the absent directory.
- **AC-4.** With a malformed config (truncated JSON), the validator exits non-zero and names
  the config file. It does NOT validate the default corpora and exit zero.
- **AC-5.** After *Refresh Harness Files* over a project whose config declares an extra
  corpus, that corpus is still validated: coverage declared in config survives a refresh.
  This is the corpus class only, not the check #1698 lost (see What this spec does not
  close).
- **AC-6.** `--pre-commit` and the full-corpus run agree on scope for the same fixture: a
  staged file outside every configured corpus is skipped by both.
- **AC-7.** With a config that does not parse, `--pre-commit` over a commit that stages no
  Markdown file exits non-zero and names the config file, and prints no line saying a rule
  is carrying on at its default. The same holds for a config that exists and cannot be
  opened. This is FR-2's reach: the case the shipped read handles the other way today.

## Invariants

- **INV-1 (no silent narrowing).** No code path may reduce the set of validated corpora
  without a non-zero exit or an explicit configured instruction. Coverage may shrink only
  because the project said so.
- **INV-2 (managed bytes stay identical).** The file remains fully managed. This spec does NOT
  introduce an unmanaged region inside it; the extension surface is the config file, which
  refresh does not own.
- **INV-3 (offline, Tier 0).** No dependency beyond the Python standard library.
- **INV-4 (one owner per file).** This spec owns only the new test; `template-registry.ts`
  stays `affects:`, consistent with SPEC-066 and SPEC-063.

## Clarify selections (recorded by an agent 2026-10-01 and 2026-10-09; ratified only by approval of this spec)

CQ-1 to CQ-5 each carry a **Recorded selection** line. An agent session wrote the lines for
CQ-1, CQ-2 and CQ-3 on 2026-10-01, each naming the option this document already recommended.
A second agent session wrote CQ-4 and CQ-5, the questions and their lines, on 2026-10-09
(AEDT; 2026-10-08 UTC) while consolidating this text. No human chose any of them. This
repository runs with `"autonomy": "act"` (`.minspec/config.json:58`), under which an agent
proceeds on a stated recommendation and leaves the options it did not take on record (DR-086
§2 and §4), which is why the options stay below with their costs. Approving a T3 spec is the
second class on that section's stop list (`scripts/lib/autonomy.ts:68-70`), so nothing here
stands in for that approval: the lines propose, and approving this spec is what ratifies
them. An approval records a canonical hash that covers this body
(`packages/minspec/src/lib/approval.ts:4-8`) and reads as stale once the hash stops matching
(`resolveStatus`, `:489-496`), so an approval of this text covers these selections and
changing one afterwards voids it. When the lines were written no approval of this spec had
landed on `main` (`status: specifying`, `clarify: pending`). A question in this section with
no **Recorded selection** line is still open.

### CQ-1 (shape) — how the corpora are expressed in config

**Recorded selection: `a`,** the `validatedCorpora` map. Its cost stands as written: Plan
must define whether `specsDir` or a corpus entry for the same directory wins, and assert that
in a test.

- **`a` — a `validatedCorpora` map of path → required frontmatter key/pattern (rec).**
  Reuses `specsDir`/`decisionsDir` as the defaults that seed it, and satisfies FR-4 with no
  privileged built-in path.
  **Cost:** it introduces a second place the specs directory can be named, so
  `specsDir: specs` plus a corpus entry for `specs` can disagree. The plan must define which
  wins and assert it in a test, or the config becomes its own drift surface — the exact class
  of fault this spec is repairing one level up.
- **`b` — reuse only the existing `specsDir`/`decisionsDir` keys, no new key.**
  Smallest change, zero new config surface.
  **Cost:** it cannot express a *third* corpus, so this repo's own `docs/domain` still has
  nowhere to live and the corpus drift this spec repairs stays open.

### CQ-2 (shape, needs a DR if chosen) — an unmanaged region instead of config

**Recorded selection: `c` is not taken,** as recommended below. `validate.py` gets no
unmanaged region (INV-2), so the decision record this heading mentions is not written: it
was conditional on choosing `c`.
**Cost of not taking it:** `c` is #1698's own first suggested fix. Without it, a project
whose check cannot be written as config (CQ-4) has no sanctioned place to keep it: inside the
managed region it is overwritten by the next refresh, without notice, until the refresh half
(#2615) is built.

- **`c` — a sanctioned unmanaged region inside `validate.py`** (e.g. a clearly marked
  project-rules block the refresh preserves).
  **Cost:** it makes an edit point inside a managed file a public contract that cannot be
  withdrawn without breaking adopters, and it reintroduces the merge problem managed regions
  exist to avoid. Recommended **against**; recorded because #1698's wording ("no sanctioned
  extension point") invites it, and rejecting it deliberately is worth more than not
  considering it.

### CQ-3 (scope) — does this spec reconcile this repo's own drift

**Recorded selection: `d`,** out of scope. Declaring this repo's `docs/domain` and
`docs/decisions` corpora in its own config is the follow-up tracked as #2390. Until that
lands the waiver at `packages/minspec/tests/managed-region-self-application.test.ts:74-75`
stays in place.

- **`d` — no, out of scope (rec).** This spec makes the corpora configurable; setting this
  repo's config to declare `docs/domain` and `docs/decisions` is a follow-up.
  **Cost:** the #1888 waiver for `validate.py` stays open after this spec lands, so the drift
  remains visible-but-unfixed and someone must remember to close it. Mitigated by the waiver
  self-retiring: it asserts the path still drifts, so it cannot be quietly forgotten.
- **`e` — yes, reconcile in the same change.** Closes the waiver too.
  **Cost:** it couples a template change to editing this repo's own hook, and the two have
  different review stakes — a wrong template ships to every adopter.

### CQ-4 (scope) - does this spec cover a check that compares two places in a document

**Recorded selection: `f`,** out of scope. FR-4 stays a map from a corpus to one required
frontmatter key and pattern. The check #1698 lost cannot be written in it (see What this
spec does not close). A home for that kind of rule is one of the questions put to the spec
for the refresh half, #2615, and #1698 stays open.

- **`f` - no, out of scope (rec).** This spec closes the corpus-list class only. A rule that
  compares a frontmatter value with a line in the body needs a small expression grammar that
  a key-to-pattern map cannot carry, and "Why no new DR" frames this spec as applying the
  posture managed files already have, not as inventing a rule language.
  **Cost:** the incident that triggered #1698 is not addressed by this spec, so #1698 cannot
  be closed when this spec lands.
- **`g` - yes, extend FR-4 now to a small cross-field grammar.**
  **Cost:** it turns `.minspec/config.json` into a rule language inside a spec justified as a
  repair, is harder to keep plainly offline and reviewable, and holds the corpus fix behind
  the design of that grammar.

### CQ-5 (policy) - what a config that cannot be read or parsed does to the rest of the script

Raised by #2391 (the stale config-blind measurement). When this document was first written
the shipped validator did not read the config, so FR-2 had nothing to collide with. Since
#2264 (the shipped ownership rule) it has a read with the opposite outcome (see FR-2), and
one test pins that outcome: `packages/minspec/tests/shipped-ownership-gate-2250.test.ts:284-290`
expects exit 0 on a config containing `{ not json`. AC-4 expects non-zero for the same input,
so both cannot hold.

**Recorded selection: `h`,** one read and one outcome: FR-2 as approved, applied to the
whole script. It is the only option that leaves FR-2, AC-4 and INV-1 as they were approved.
It also matches the fail direction recorded for the scaffolded hook, where a missing
prerequisite fails open and an error inside the hook fails closed
(`template-registry.ts:1200-1206`): an absent config is the missing prerequisite (FR-1), and
a config that is present and broken is the error. That match is a reading by analogy, since
the comment speaks of a missing tool and of a tooling bug and does not mention the config.
And the selection settles one word. FR-1 as approved listed "unreadable" among the cases
that keep today's corpora, while INV-1 forbids narrowing coverage without a non-zero exit,
and the shipped read uses "unreadable" for a parse failure too (`:1890-1892`). FR-1 now
keeps the default for an absent config and for one that parses and declares no corpora, and
nothing else.

- **`h` - FR-2 governs the whole script (rec).** One read, before scoping; every rule takes
  its config value from it; a config that exists and cannot be read or parsed exits non-zero
  on every run.
  **Cost:** it withdraws a leniency #2264 chose on purpose, "a broken config does not nag on
  every unrelated commit" (`:2093-2094`). After this spec such a config fails every run of
  the script, so it blocks every commit the script checks, whatever is staged, until the
  file is fixed or the gate is bypassed by name (`MINSPEC_GATE_OFF=1`, `:1210`). It also
  makes the script stricter than the extension, whose `loadConfig` falls back to defaults on
  the same file (`packages/minspec/src/lib/config.ts:189-191`).
- **`i` - fail closed only when a staged file could be in scope** (for example, only when a
  Markdown file is staged), so a commit that touches no document is never blocked.
  **Cost:** FR-2 as approved carries no such condition, so this narrows an approved
  requirement, which is not an agent's to do. It also lets a broken config go unreported
  until someone next stages a document. Not taken; a reader who prefers it changes FR-2 and
  this selection before approving.
- **`j` - warn and carry on, for the corpora as for the ownership rule:** a broken config
  validates the default corpora.
  **Cost:** it reverses FR-2 and AC-4 and breaks INV-1: a project that declared an extra
  corpus loses that coverage to a typo, with exit 0. A project that set `ownershipDeclaration`
  to `error`, as this repository has (`.minspec/config.json:57`), would also go on having
  that rule downgraded to a warning by the same typo. Not taken.

## Test

T0 (owned by this spec): `packages/minspec/tests/validate-py-corpus-config.test.ts` — drives
the real `VALIDATE_PY` template against fixture repos, one per acceptance criterion, asserting
exit codes and messages. It must include a **control** in which the configured corpus is
absent from the fixture, so the suite cannot pass by never finding any file to validate — the
vacuous-pass shape a coverage-shrinking gate produces by construction.

One existing case changes with it, which is why its file is declared under `affects:`:
`packages/minspec/tests/shipped-ownership-gate-2250.test.ts:284-290` pins the outcome FR-2
replaces (exit 0 and a warning on a config that does not parse). It is rewritten to AC-4's
outcome in the same change, not deleted, so the old outcome cannot come back unnoticed.
