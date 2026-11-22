# Proposed amendment to SPEC-035 - number-only card for offline issue refs

> **Status: PROPOSED, NOT APPROVED. This file is not part of SPEC-035.** It becomes part of
> the spec only if the founder signs it off ("MinSpec: Approve Spec") after it is folded into
> `specs/minspec/SPEC-035-approvable-ref-lozenges/requirements.md`. It lives outside the spec
> folder so the existing SPEC-035 approval (hash-locked, DR-012) stays valid until then.
>
> Founder answer (queue item i035): "n = number-only card: shows the number with 'no details
> offline' and opens the issue on GitHub."

**Amends four requirements: FR3, FR8, AC2 and INV-graceful-degrade**, each only for one case:
a bare GitHub issue reference such as `#500` that cannot be resolved offline. A card with no
title, status or summary contradicts FR3 and AC2 as well as FR8; design.md PQ3 already names
FR3 and AC2 as the requirements in conflict.

**Current text being narrowed (quoted, not deleted):**

- FR3: "On hover **or keyboard focus**, the lozenge shows a card with the target's **title,
  current status, and summary**."
- AC2: "Hovering **or** keyboard-focusing a lozenge opens a card with title, status, summary;
  every action is reachable without a mouse."
- FR8: "An unknown project/approvable/paragraph code, or a ref whose target cannot be found,
  renders as **plain text** (never an error, never a dead lozenge)".
- INV-graceful-degrade: "an unknown or unresolvable reference renders as plain text; it
  never errors, never breaks the view, never becomes a dead lozenge."

**Proposed replacement wording** (scoped to the offline number-only case; every other case keeps
the current text):

- FR3, add: "Exception: a bare issue ref (`#N`) that cannot be resolved offline shows a
  number-only card: the number and the words 'no details offline'. No title, status or summary
  is shown or guessed."
- AC2, add: "A number-only card (FR3 exception) opens on hover or keyboard focus with the
  number and 'no details offline'; it is still reachable and activatable without a mouse."
- FR8, add: "Exception: a well-formed bare `#N` issue ref with an unambiguous repo slug renders
  as a number-only card, not plain text."
- INV-graceful-degrade, add: "...except a well-formed bare `#N` issue ref, which renders as a
  number-only card with a working target; that is neither plain text nor a dead lozenge."

**Cross-project refs (FR5) - choice (b): excluded.** `PROJECT#N` (e.g. `SCR#204`) is not part
of the number-only case, so FR5 and design.md OQ2 stay as they are: the motivating case is a
bare `#500`, and a title-less card for `SCR#204` would reverse OQ2's "a code-only card is NOT
FR5-compliant". A cross-project issue ref has no title source offline, so it stays plain text
under FR8.

**Proposed behaviour.** When a bare issue reference (`#N`) is
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
   - `PROJECT#N` (`SCR#204`) is out of scope (see the FR5 choice above) and stays plain text.
4. The card is a live, activatable lozenge, so it is not "plain text" and not a dead lozenge:
   it always has a working target. Keyboard path per INV-keyboard.

**Unchanged.** Unknown project codes, unknown approvable ids and unresolvable paragraph refs
still render as plain text under FR8 and INV-graceful-degrade. Only well-formed bare `#N` issue refs
gain the number-only card.

**If approved,** a later adoption PR (separate from this proposal PR) edits SPEC-035's
`requirements.md` in four places: FR3, FR8, AC2 and INV-graceful-degrade, using the replacement
wording above, and adds one new acceptance criterion (AC2b): "A bare `#N` ref that cannot be
resolved offline renders as a number-only card ('no details offline') that opens the issue on
GitHub from the local git remote slug; with no unambiguous slug it renders as plain text."
`design.md` PQ3 is then marked answered (option (a)); OQ2 and FR5 are untouched under choice (b).
Merging this proposal file changes nothing in SPEC-035 and voids no approval. The adoption PR
voids the hash-locked approval (DR-012) until the founder re-approves it in the editor
("MinSpec: Approve Spec").
