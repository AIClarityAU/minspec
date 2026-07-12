# Project Prefixes

Short, stable codes that disambiguate references across the workspace. Per-repo-local
ids stay unprefixed — DR-027 keeps a separate SDD register per repo, so a bare
`SP1` / `SPEC-001` always means *this* repo's (see
[DR-053](../docs/decisions/DR-053.md)). A reference that **spans projects** carries
its target project's code.

**Reference grammar (DR-053 v2 — proposed).** Every referenceable item has a
slash-joined, zero-padding-free id of up to three segments that **elide**
left-to-right when context implies them:

```
PROJECT / APPROVABLE / PARAGRAPH
MIN/SP19/FR3   cross-project   → FR3 of minspec SPEC-19
   SP19/FR3    intra-project   → same repo
        FR3    intra-document  → same doc
MIN/SP19       the approvable itself
```

- **PROJECT** — 3 uppercase letters (table below), default = first 3 of the repo name.
- **APPROVABLE** — `SP` spec · `DR` decision · `EP` epic · `PR` pull request ·
  `IS` issue, + number, no leading zeros (`SP19`, not `SP019`).
- **PARAGRAPH** — a type code + number: `FR OQ R AC INV AL CR CQ FU M G RD DV`
  (full table in DR-053 §3). Numbers restart per document, per type.

> **v2 is `proposed`, not yet applied — do not wire this table to the resolver yet.**
> The codes below are updated to the proposed 3-letter form (nothing in the corpus used
> the 2-letter codes). But the shipped `@aiclarity/shared` `project-prefix` module still
> *joins with a dash* and reads only 2-letter codes, so against this 3-letter table it
> would emit `MIN-SPEC-019` — a chimera in **neither** the v1 register (`MS-SPEC-019`)
> **nor** v2 (`MIN/SP19`). This is **latent only** (no runtime loader wires this file
> today). The module update ([#679](https://github.com/AIClarityAU/minspec/issues/679))
> is a **hard predecessor** to any runtime use of this table and must add a version-aware
> gate (dash ⇒ 2-letter, slash ⇒ 3-letter) so the chimera is rejected. An unknown code
> is **advisory**, never a hard failure.

To add a project, add a row. Codes are **UPPERCASE, 3 letters, unique**.

| Prefix | Project | Repo                    |
|--------|---------|-------------------------|
| MIN    | minspec | AIClarityAU/minspec     |
| SCR    | scrooge | AIClarityAU/scroogellm  |
| SEA    | sealbox | AIClarityAU/sealbox     |
| MMO    | mmo     | harvest316/mmo-platform |
