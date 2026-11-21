# Proposed amendment to SPEC-035 - number-only card for offline issue refs

> **Status: PROPOSED, NOT APPROVED. This file is not part of SPEC-035.** It becomes part of
> the spec only if the founder signs it off ("MinSpec: Approve Spec") after it is folded into
> `specs/minspec/SPEC-035-approvable-ref-lozenges/requirements.md`. It lives outside the spec
> folder so the existing SPEC-035 approval (hash-locked, DR-012) stays valid until then.
>
> Founder answer (queue item i035): "n = number-only card: shows the number with 'no details
> offline' and opens the issue on GitHub."

**Amends FR8** (unknown/unresolvable -> plain text) and, by extension, **INV-graceful-degrade**,
for one case only: a GitHub issue reference such as `#500` that cannot be resolved offline.

**Current text being narrowed (quoted, not deleted):**

- FR8: "An unknown project/approvable/paragraph code, or a ref whose target cannot be found,
  renders as **plain text** (never an error, never a dead lozenge)".
- INV-graceful-degrade: "an unknown or unresolvable reference renders as plain text; it
  never errors, never breaks the view, never becomes a dead lozenge."

**Proposed behaviour.** When an issue reference (`#N`, or `PROJECT#N` such as `SCR#204`) is
well-formed but its details cannot be resolved offline (Tier-0 has no network and no local
issue data), the reference renders as a **number-only card** instead of plain text:

1. The lozenge shows the issue number (`#500`).
2. Its hover/focus card (FR3) shows the number and the words "no details offline". No title,
   status or summary is shown, and none is guessed (INV-live-status-deterministic holds).
3. Activating it (click/Enter, FR7) opens the issue on GitHub in the user's browser. This is
   an explicit user action, so Tier-0 detection and resolution still make no network call
   (INV-tier0-detection); the browser opens the URL, MinSpec does not fetch it. **Which
   repo:**
   - A bare `#N` points at **this workspace's own repo**, taken from the local git remote
     with the existing `githubSlug` (`packages/minspec/src/lib/git-remotes.ts:150`): the
     resolved remote's `owner/repo` (an `origin` wins over `upstream` in a fork), or, when
     several remotes exist and none is `origin`, the one slug they all agree on. This is the
     rule SPEC-035's design already names for the issue card (design.md, PQ3 option (a)).
   - **No unambiguous slug** (no GitHub remote, or several that disagree): there is no
     target repo, so the ref renders as plain text under FR8. It never guesses a repo.
   - `PROJECT#N` (`SCR#204`) points at the repo in the Repo column of
     `.minspec/project-prefixes.md` for that code (design.md, OQ2). An unknown code stays
     plain text.
4. The card is a live, activatable lozenge, so it is not "plain text" and not a dead lozenge:
   it always has a working target. Keyboard path per INV-keyboard.

**Unchanged.** Unknown project codes, unknown approvable ids and unresolvable paragraph refs
still render as plain text under FR8 and INV-graceful-degrade. Only well-formed issue refs
gain the number-only card.

**If approved,** FR8 and INV-graceful-degrade are edited to carve out this case and this
section is folded into FR8; an acceptance criterion is added under Acceptance Criteria.
Merging this proposal file changes nothing in SPEC-035 and voids no approval. The later step
does: a separate PR that folds this text into SPEC-035's `requirements.md` voids the
hash-locked approval (DR-012) until the founder re-approves it in the editor ("MinSpec:
Approve Spec").
