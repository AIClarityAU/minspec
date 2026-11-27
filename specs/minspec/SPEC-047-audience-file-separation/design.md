---
id: SPEC-047
type: design
# tier lives on requirements.md, the single tier-carrying approvable. A tier on a sibling
# document is read by spec-gate.py as a second, unapproved spec. (SPEC-047 is T3.)
# status and phases mirror requirements.md. This file has no approval record of its own:
# only requirements.md is signed, so these two fields describe and never seal.
status: planning
product: minspec
epic: EPIC-009  # Team Readiness
relates_to: [DR-068, SPEC-013, SPEC-038, SPEC-045, SPEC-046, SPEC-048, "#1138"]
phases:
  specify: done
  clarify: done
  plan: in-progress
  tasks: pending
  implement: pending
---

# SPEC-047 - Plan

**Reads:** [requirements.md](requirements.md), hash-locked by its approval and not edited by
this plan. **Tasks:** [tasks.md](tasks.md). Evidence below was read on `main` at 989fdc61 on
2026-10-31.

## Approach

Two slices, because one open item (below) stops only one of them.

- **The scaffold-the-split slice (FR-6, AC-4, plus FR-5's cut-off).** Teach the existing
  `tasks.md` scaffolding to emit `design.md` too, and tell the `/minspec-specify` and
  `/minspec-plan` prompts to keep each audience in its own file. Needs no audience map.
- **The map-and-warning slice (FR-1 to FR-5, AC-1 to AC-3, RD-2).** The audience map, the
  mixed-file detector, the warning rule and the CODEOWNERS drift check. All of it waits for
  the open item, since RD-1 says where the map and its heading data may live.

## Open item, not decided here: RD-1's registry does not exist

FR-1 and RD-1 are approved sentences: audience is "an attribute on SPEC-013's existing section
registry", "not a parallel registry". SPEC-013's own frontmatter records that registry as
unbuilt (`implements: none`, with `SECTION_REGISTRY` and `core-end` absent from all code), and
its specified entries are keyed on section headings, so a file cannot be one of its entries.
The same approved file declares `audience-map.ts` as owned and says "all new logic is isolated"
there. This plan cannot choose between those without overriding an approved sentence, so it
does not. Every task it blocks says so in `tasks.md`.

## Decisions

Each one below was **chosen by the planning agent on its recommendation; not a founder
decision**. Each can be undone in under a day and none changes an approved sentence. They answer
the questions on #1138 (SPEC-047's open design contradictions), except its RD-1 item above.

### D-1 - The warning covers new specs, cut off by spec number (FR-3, FR-5, AC-1, AC-3)

**Evidence.** The `## Contracts`/`## Invariants` heading or `**INV-` bullet of AC-1 occurs in 177
of the 181 `requirements.md` files on `main` (regex count across `specs/`). A rule with no cut-off
adds about 177 warnings to a validator whose warnings already go unread (#1006, its flood of
workspace warnings). Only 6 of those 181 files carry `created:`, so a cut-off by date would
exempt any new spec that omits the field.

**Chosen.** A config key `audienceSeparation.grandfatherBelow: <number>`. A spec whose `SPEC-NNN`
number is below it is pre-rule, and no warning or design scaffolding offer applies to it. New ids
only grow, so a new spec is covered without its author's help. AC-1 is pinned by a fixture above
the cut-off. This reads AC-1 under FR-3 ("new specs") and the Context's "keeps new specs
conformant"; setting the key to `0` gives the unscoped reading back in one line.

A missing or non-numeric key means no cut-off: everything is checked at warning severity, and the
message names the key. A spec id that does not parse is checked, never skipped.

**Rejected.** Warn across the whole corpus: literally allowed by AC-3, but it buries every other
warning. Cut-off by `created:`: exempts by omission. A list of grandfathered ids: this repo's list
means nothing to an adopter.

### D-2 - AC-4 is met by scaffolding code plus prompt text (FR-6, AC-4)

**Evidence.** `MinSpec: Specify` is the `specify` entry of `COMMAND_GUIDANCE`
(`slash-commands.ts:127`), a prompt rather than a registered command. `createSpec`
(`spec-manager.ts:356`) has no production caller and writes a flat file or a spec-kit `spec.md`,
never `requirements.md`. The approved `affects:` comment already names the route: "SPEC-043's #225
tasks.md machinery that FR-6 extends to design.md".

**Chosen.** `scaffoldDesignMd` beside `scaffoldTasksMd` (`scaffold.ts:184`), offered by widening
the existing bootstrap step (`auto-bootstrap.ts:757`), and prompt text for the rest. Only specs at
or above the cut-off get a `design.md` offer, so FR-5's no-retrofit holds. With no key set there is
no `design.md` offer at all, unlike the warning in D-1: a warning reports and an offer writes.
`tasks.md` offers keep their present reach.

**Rejected.** Prompt text alone: not deterministically testable. A second bootstrap step with its
own skip preference: needs `preferences.ts`, outside the declared `affects:`. Changing `createSpec`:
nothing calls it, so `spec-manager.ts` stays untouched although declared.

### D-3 - SPEC-045 owns the CODEOWNERS file, SPEC-047 owns its globs (FR-1, RD-2)

**Evidence.** SPEC-045 FR-1 says "maintained" and lists `CODEOWNERS` in its `implements:`; its
frontmatter comment says "SPEC-047 still owns the audience→file MAP". SPEC-047 RD-2 says the globs
are generated from the map and drift-validated. No `CODEOWNERS` exists on `main`.

**Chosen.** Both hold. SPEC-045 creates and owns the file. This spec adds two pure functions in
`audience-map.ts`: `renderCodeownersBlock(map)`, which emits the audience lines, and
`codeownersDrift(map, text)`, which compares globs only, since team handles are SPEC-045's. The
validator reports drift as a warning and prints the expected block. A missing file prints a visible
note, not a silent pass.

**Rejected.** A `scripts/gen-codeowners.mjs` writer: a third owned path, so it would void the
approval, for a file that changes when a role is added. Hand-maintained globs: RD-2 rules them out.

### D-4 - No DR-053 paragraph-type branch yet (FR-2)

**Evidence.** FR-2 uses that signal "where present". No code table exists: #679 (DR-053 v2 grammar)
is open, and DR-068 decision 1 removed the dependency on it.

**Chosen.** Headings and the literal `INV-` bullet that AC-1 names. Add the branch when #679 lands.

**Rejected.** A branch that always falls through: untestable code.

### D-5 - The heuristic starts with what AC-1 names (FR-2)

**Chosen, subject to the open item, which governs where this data lives.** Headings `Contracts` and
`Invariants`, and bullets opening `INV-`, outside code fences. Widening is a data edit.

**Rejected.** DR-068's fuller list of engineering content: this spec's own approved
`requirements.md` has a `Resolved Decisions` section, so that entry would flag the spec defining the
rule, and false alarms teach readers to ignore a warning.

### D-6 - A separate config key from SPEC-046's `audiences` (FR-1)

**Evidence.** SPEC-046's `design.md` defines `audiences.<name> = { approval, enabledBy, enabledAt,
policyVersion, policyRef }`, with a human-only authorship gate on `audiences.<name>.approval`.

**Chosen.** SPEC-047 extends the map through `audienceFiles.<name> = { files, role? }`, and its
other settings sit under `audienceSeparation`. A routine edit to file names then never trips
SPEC-046's gate, and neither spec has to land first.

**Rejected.** Sharing `audiences`: couples two specs in different epics, and mixes a policy record
with routing data.

### D-7 - T2 is exempt, along with T1 (FR-4)

FR-4 leaves T2 optional and says the rule applies at T3/T4. **Chosen:** exempt T2, with no setting.
**Rejected:** a per-project T2 switch, which no one has asked for.

## Invariants

- **Offline (constitution invariant 1).** Everything is pure file reading. No network call.
- **No silent gate (invariant 2).** The rule is a warning. If a project promotes it to `error`, an
  unreadable config or id widens what is checked and never narrows it (D-1).
- **Blast radius (invariant 3).** The offer stays behind `isMinspecInitialized`.
- **No import from `spec-validator.ts` or `spec.ts` in `audience-map.ts`.** Those modules are
  wholesale `vi.mock()`'d in command tests (see the comment at `spec-layout.ts:168`), and the
  validator imports this module, so the import runs one way.

## Out of scope

SPEC-046's `audience:` frontmatter rule, which its CQ-7 records as unhomed: this spec's approved body
has no such field. Rewriting existing specs (FR-5). The jargon rule (SPEC-048).
