# Issue label vocabulary — minspec-monorepo

The labels MinSpec's triage step classifies against. **This file is documentation and a
copy-paste script — MinSpec never creates, edits, or reads any of these labels on a
forge.** Core functionality works offline and makes no network call without your explicit
consent, so applying these is always a command *you* run.

One label is not in this vocabulary, and it is the single exception: `docs-lane`, the
label MinSpec's docs-lane workflow auto-merges on. When an approval you consented to push
is eligible for that lane, MinSpec opens its pull request with the label, and creates the
label first if this repository carries the docs-lane workflow but does not have the label
yet. It never edits a `docs-lane` label that already exists.

Triage reads an issue's **type label** as one of its inputs. A type it is told to
recognise but that does not exist as a label is an input that is always absent — the
classification then rests on body text alone. That is the gap this file closes.

## Type — what kind of work is this?

Exactly one per issue.

| Label | Meaning | Auto-buildable? |
|---|---|---|
| `bug` | Something is broken | ✅ |
| `feat` | New capability | ✅ |
| `chore` | Maintenance, no behaviour change | ✅ |
| `refactor` | Structure changes, behaviour does not | ✅ |
| `test` | Test coverage or harness | ✅ |
| `ci` | Build or CI pipeline | ✅ |
| `docs` | Developer-facing documentation | ✅ |
| `idea` | Not yet a decision | ❌ human-only |
| `decide` | Asks for a product or architecture decision | ❌ human-only |
| `copy` | User-facing wording | ❌ human-only |
| `marketing` | Marketing content | ❌ human-only |
| `positioning` | Product positioning, public claims | ❌ human-only |
| `legal` | Legal, licensing, compliance | ❌ human-only |
| `monetization` / `billing` | Pricing, billing, revenue | ❌ human-only |

> **These names are not stylistic.** They are the exact tokens the triage step classifies
> against, so a rename here silently removes a classification input rather than tidying a
> label. In particular it is `docs`, **not** GitHub's default `documentation` — shipping the
> latter recreated the very "declared type with no label" gap this file exists to close, and
> a test that hardcoded the wrong name passed green while it did.

**Human-only is about AUTHORSHIP, not difficulty.** It says who may *write* the work, never
who may permit it — so no approval, keystroke, or configuration value lifts it. A trivial
one-word copy change is still human-only; a large mechanical refactor is not.

## Priority

`P1` (now) · `P2` (next) · `P3` (someday). Absent means untriaged.

## Lifecycle

`inbox` (awaiting triage) · `needs-review` (a human must look before work starts) ·
`needs-info` (cannot be sized yet) · `agent-ready` (cleared to build).

**`agent-ready` is the gate's OUTPUT, never its input.** Do not pre-apply it — from an
issue template, an automation, or by hand. A label that anyone can set is not a permission,
and treating it as one is how unreviewed work gets built.

## Create them

Run once, in the repo:

```bash
gh label create bug --color d73a4a --description "Something is broken" --force
gh label create feat --color a2eeef --description "New capability" --force
gh label create chore --color cfd3d7 --description "Maintenance, no behaviour change" --force
gh label create refactor --color cfd3d7 --description "Structure changes, behaviour does not" --force
gh label create test --color cfd3d7 --description "Test coverage or harness" --force
gh label create ci --color cfd3d7 --description "Build or CI pipeline" --force
gh label create docs --color 0075ca --description "Developer-facing documentation" --force
gh label create idea --color d4c5f9 --description "Not yet a decision" --force
gh label create decide --color b60205 --description "Human-only: asks for a product or architecture decision" --force
gh label create copy --color b60205 --description "Human-only: user-facing wording" --force
gh label create marketing --color b60205 --description "Human-only: marketing content" --force
gh label create positioning --color b60205 --description "Human-only: positioning, public claims" --force
gh label create legal --color b60205 --description "Human-only: legal, licensing, compliance" --force
gh label create monetization --color b60205 --description "Human-only: pricing, billing, revenue" --force
gh label create billing --color b60205 --description "Human-only: billing (sibling of monetization)" --force
gh label create P1 --color b60205 --description "Now" --force
gh label create P2 --color fbca04 --description "Next" --force
gh label create P3 --color 0e8a16 --description "Someday" --force
gh label create inbox --color ededed --description "Awaiting triage" --force
gh label create needs-review --color fbca04 --description "A human must look before work starts" --force
gh label create needs-info --color fbca04 --description "Cannot be sized yet" --force
gh label create agent-ready --color 0e8a16 --description "Cleared to build — the gate's output, never its input" --force
```

`--force` updates a label that already exists rather than failing, so the block is safe to
re-run after editing a description.

## Changing this file

Edit it freely. Refresh preserves sections you add and updates the ones above; a section
MinSpec does not know about is kept as-is at the end.
