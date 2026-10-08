# Explore the Sidebar

MinSpec adds several UI elements to help you track your SDD workflow. Together they're the
day-to-day home of the ways-of-working shift: not a dashboard to survey, but a pointer to the
one thing you should do next.

## The signpost loop: one task, never a backlog

This is the part that differs most from a typical project-tracking panel. The sidebar and
status bar do not hand you a prioritized list to triage — they compute and surface **a single
deterministic next human task**, the same way every time given the same state. No judgment
call about what's most urgent, no backlog grooming session. You finish that one task, and the
next one appears.

That determinism is deliberate: the signpost is never a guess dressed up as a recommendation.
If MinSpec can't compute a confident next step, it says so rather than inventing one.

## Spec Tree View

In the **Explorer** sidebar, you'll find the **MinSpec** panel. It shows:

- All spec files in your workspace, organized by status
- The current tier and phase for each spec
- Task completion progress within each spec

Click any spec to open it. Right-click for actions like classifying or reclassifying.

Use **MinSpec: Refresh Spec Tree** (or the refresh icon) to update the view after changes.

## Status Bar

The bottom status bar shows your current active spec at a glance:

- Spec ID and tier badge
- Current phase
- Quick click to open the spec panel

## Active Spec Panel

Run **MinSpec: Show Active Spec Panel** to open a detailed view of your current spec. The
panel shows:

- All SDD phases as a visual stepper
- Task checklists you can toggle directly
- Phase status indicators (pending, in-progress, done)

The panel updates live as you edit spec files.

## Session Scope

Use **MinSpec: Declare Session Scope** to set boundaries for your current work session.
MinSpec will warn you if you edit files outside your declared scope — helping you avoid scope
drift.
