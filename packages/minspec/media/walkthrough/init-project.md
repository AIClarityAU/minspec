# Initialize Your Project

Run the **MinSpec: Initialize SDD Structure** command to set up SDD in your workspace.

## What gets created

```
your-project/
├── .minspec/
│   └── config.json          # Tier thresholds & phase mappings
├── specs/
│   └── (your spec files)    # Markdown specs live here
└── docs/
    └── decisions/           # Architecture Decision Records
```

## The config file

`.minspec/config.json` controls:

- **Tier thresholds** — complexity score boundaries for T1/T2/T3/T4
- **Phase mappings** — which SDD phases each tier requires
- **Directory paths** — where specs and decisions are stored

Defaults work well for most projects. Customize when needed.

## Spec files are just markdown

Every spec is a standard markdown file with YAML frontmatter. No proprietary format, no lock-in. You can read and edit them with any tool.

**Ready?** Click the button below to initialize your project.
