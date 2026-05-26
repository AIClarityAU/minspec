# Integrate with AI Tools

MinSpec works seamlessly with AI coding assistants by injecting your active spec context into their configuration files.

## Supported tools

MinSpec detects and integrates with:

- **Claude Code** — injects into `CLAUDE.md`
- **Cursor** — injects into `.cursorrules`
- **Other AI tools** — any tool that reads project-level markdown config

## How context injection works

1. Run **MinSpec: Inject Active Spec Context**
2. Enter the spec ID and title for your current task
3. MinSpec writes a fenced section into each detected AI tool's config file

The injected context tells your AI assistant:
- What spec you're working on
- The current tier and phase
- Session scope boundaries

This keeps AI suggestions aligned with your specification — no more AI-generated code that drifts from the plan.

## Removing context

When you finish a task, run **MinSpec: Remove Active Spec Context** to clean up the injected sections. MinSpec only touches its own fenced blocks — your other config content is preserved.

## No AI required

MinSpec itself never calls any AI service. Context injection is a convenience for developers who use AI tools — but MinSpec works perfectly without any AI tooling installed.
