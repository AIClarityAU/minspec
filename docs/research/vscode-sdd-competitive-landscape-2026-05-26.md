# VS Code Spec-Driven Development: Competitive Landscape Analysis

**Date:** 2026-05-26  
**Methodology:** Web search, VS Code Marketplace scraping, blog/discussion analysis  
**Scope:** Extensions, tools, and AI platforms supporting spec-driven and related methodologies

---

## Executive Summary

Spec-driven development (SDD) exploded from a niche methodology to a mainstream engineering practice between late 2025 and mid-2026. GitHub's Spec Kit (93K+ stars), AWS Kiro (standalone IDE), and community-built VS Code extensions now form a fragmented but rapidly growing ecosystem. The VS Code marketplace has approximately 15-20 extensions explicitly referencing SDD, nearly all created after September 2025. Total install counts remain modest (the largest SDD-specific extension has ~19K installs), indicating the market is early-stage with no dominant winner. Adjacent categories (OpenAPI editors, BDD tools, architecture-as-code) are far more mature with 1M+ installs but lack SDD-native workflows.

---

## 1. Direct Competitors: Spec-Driven Development VS Code Extensions

Extensions that explicitly support SDD workflows. Sorted by install count.

### Tier 1: Established (1K+ installs)

| Extension | Publisher | Installs | Rating | Last Updated | Pricing | What It Does |
|-----------|-----------|----------|--------|--------------|---------|--------------|
| **Kiro for Claude Code** | heisebaiyun | 19,189 | 5.0 (3) | 2025-09-21 | Free/MIT | Visual spec management for Claude Code. Sidebar for requirements/design/tasks. Sub-agent feature for parallel spec generation. Creates .claude directory structure. |
| **SpecKit Companion** | Alfredo Perez | 6,173 | 5.0 (1) | 2026-05-25 | Free/MIT | Companion for GitHub Spec Kit. Visual spec viewer with Specify/Plan/Tasks/Done phases. Inline commenting on spec lines. Persistent review comments in .spec-context.json. Supports 8 AI providers. |
| **OpenSpec for Copilot** | Atman Dev | 2,711 | N/A (0) | 2026-05-22 | Free | Bridges OpenSpec prompts with GitHub Copilot Chat. Visual management of Specs, Steering docs (AGENTS.md), custom prompts. GitHub issue creation from specs. |
| **Spec Kit Assistant** | Rafael Sales | 2,104 | 5.0 (4) | 2026-03-21 | Free | Five sequential phases (constitution, specification, planning, tasks, implementation) with review gates. Live console, interactive task checklist, stale-phase alerts, full DAG visualization. |

### Tier 2: Early Stage (100-1K installs)

| Extension | Publisher | Installs | Rating | Last Updated | Pricing | What It Does |
|-----------|-----------|----------|--------|--------------|---------|--------------|
| **specsmd** | fabriqaai | 701 | 5.0 (1) | 2026-02-08 | Free/MIT | Sidebar for monitoring AI execution. Tracks runs, progress, file changes. All data stored locally in markdown. Works across Cursor, Windsurf, Codespaces. |
| **Kiro-Style Copilot** | Jose Eduardo Teixeira | 527 | N/A (0) | 2025-11-26 | Free | Dual-mode: Vibe Coding for prototyping, Spec Mode for structured development with requirements planning. Brings Kiro's workflow to Copilot. |
| **Specly Code** | PreciseCode | 294 | N/A (0) | 2025-10-10 | Proprietary | AI coding agent with SDD workflow. Requirements, design, task breakdown, execution. Built-in file management, terminal, browser automation via MCP. |
| **Kiro for Copilot** | moonolgerd | 275 | N/A (0) | 2026-03-05 | Free | Spec lifecycle management, task tracking with completion visualization, traceability via CodeLens linking, Copilot integration, MCP server support. |

### Tier 3: Nascent (<100 installs)

| Extension | Publisher | Installs | Rating | Last Updated | Pricing | What It Does |
|-----------|-----------|----------|--------|--------------|---------|--------------|
| **SDD - Spec-Driven Development** | Joseph Jauregui | 29 | N/A (0) | 2026-03-12 | Free | Workspace console with .sdd folder initialization, structured prompt editor, DeepSeek-powered quality evaluation, token counting. |
| **MyIntern** | MyIntern | 11 | N/A (0) | 2026-03-27 | Free/Apache 2.0 | Enterprise-focused: HIPAA/PCI-DSS compliance, approval workflows, security scanning, guardrails. Requires separate CLI install. |

### Key Observations — Direct Competitors

1. **No dominant player.** The highest-install SDD extension (Kiro for Claude Code, ~19K) has 0.001% the installs of mature extensions like OpenAPI Editor (~1.5M).
2. **Fragmentation by AI provider.** Multiple extensions exist for the same base workflow (Kiro-style specs) but each targets a different AI backend: Claude Code, Copilot, Codex.
3. **Most are thin UI layers.** Nearly all extensions wrap GitHub Spec Kit or Kiro's 3-document pattern (requirements.md, design.md, tasks.md) with a visual sidebar.
4. **Quality signal is weak.** Most have 0-1 ratings. Only Spec Kit Assistant (4 reviews) shows meaningful community feedback.
5. **Rapid churn.** Several extensions haven't been updated in 6+ months despite the methodology evolving quickly. Specly Code last updated October 2025.
6. **All are free.** No extension has attempted paid pricing. The monetization model for SDD tooling is unproven in the VS Code extension market.

---

## 2. Adjacent Competitors: Overlapping but Differently Branded

### API Design-First / Contract-First Tools

| Extension | Publisher | Installs | Rating | Last Updated | What It Does |
|-----------|-----------|----------|--------|--------------|--------------|
| **OpenAPI (Swagger) Editor** | 42Crunch | 1,510,193 | 4.0 (44) | 2026-05-21 | Full OpenAPI creation, editing, preview. Security audit (300+ vulnerability checks). Dynamic API testing. Contract generation from Postman/HAR. |
| **Specmatic** | Specmatic | 922 | 5.0 (2) | 2025-04-02 | Contract-driven development: run contract tests from OpenAPI specs, GPT-4-powered example generation for test data. |
| **Spectral** | Stoplight | 62,687 | 5.0 (4) | 2024-11-25 | JSON/YAML linter with OpenAPI and custom ruleset support. Real-time API spec validation. |
| **SwaggerHub for VS Code** | SmartBear | 14,252 | 5.0 (7) | 2023-08-29 | View/edit OpenAPI definitions in SwaggerHub from VS Code. Cloud + on-prem. Last updated 2023 (potentially abandoned). |
| **TypeSpec** | Microsoft | 39,521 | 5.0 (2) | 2026-05-12 | Declarative API specification language by Microsoft. Write specs in code, generate OpenAPI. Used by Azure teams. |

### BDD / Test-First Tools

| Extension | Publisher | Installs | Rating | Last Updated | What It Does |
|-----------|-----------|----------|--------|--------------|--------------|
| **Cucumber (Gherkin) Full Support** | Alexander Krechik | 1,219,801 | 4.0 (30) | 2026-02-15 | Language support, autocomplete, formatting for Gherkin/Cucumber. The dominant BDD extension. |
| **Cucumber (Official)** | CucumberOpen | 414,773 | 3.5 (16) | 2025-05-18 | Official extension: autocomplete steps, go to definition, syntax highlighting. Multi-language (Java, Python, JS, Ruby, C#, Go). |
| **BDD AI Toolkit** | Jingping Liu | 372 | N/A (0) | 2026-03-13 | AI-assisted BDD automation. Record scenarios with AI, replay instantly. GitHub Copilot integration via MCP. Generates automation code from natural language. |

### Architecture-as-Code Tools

| Extension | Publisher | Installs | Rating | Last Updated | What It Does |
|-----------|-----------|----------|--------|--------------|--------------|
| **C4 DSL Extension** | systemticks | 58,522 | 4.0 (11) | 2025-01-31 | Structurizr DSL support for C4 architecture models. Diagram preview, syntax validation. |

### Key Observations — Adjacent Competitors

1. **Massive install gap.** Adjacent tools have 10x-1000x the installs of SDD-specific extensions. OpenAPI Editor alone has 1.5M installs.
2. **API design-first is mature but narrowly scoped.** These tools handle API contract validation but not full-lifecycle spec management (requirements, design, architecture, task breakdown).
3. **BDD tools are stale.** The dominant Cucumber extension has 1.2M installs but the methodology hasn't evolved meaningfully for AI-assisted workflows.
4. **No bridge exists.** There's no extension connecting API specs (OpenAPI), architecture docs (C4/Structurizr), behavior specs (Gherkin), and implementation tasks into a unified SDD workflow.
5. **Architecture-as-code is underserved.** Only one notable C4 extension with 58K installs. No integration with AI coding agents.

---

## 3. AI-Powered Competitors: Methodology Positioning

### Standalone IDEs with SDD Built-In

| Tool | Pricing | SDD Approach | Market Position |
|------|---------|--------------|-----------------|
| **Amazon Kiro** | Free (50 credits/mo), Pro $19/mo (1K credits), Pro+ $39/mo (3K credits) | Native SDD: EARS notation for acceptance criteria. Three-document system (requirements.md, design.md, tasks.md). Agent Hooks for automated validation. Steering files for project context. | The SDD-first IDE. Spec generation before any code. AWS ecosystem integration. Positioned against Cursor for teams who want planning rigor. |
| **Cursor** | Free (2K completions), Pro $20/mo, Business $40/user/mo | Partial SDD via Plan Mode + .cursorrules. Supports Spec Kit/OpenSpec via MCP. No formal spec format, no gated phase transitions, no contract validation. | "Execution environment, not an SDD system." Fastest AI coding experience but specs are advisory, not enforced. |
| **Intent (Augment Code)** | Indie $20/mo, Standard $60/mo, Max $200/mo | Living specs with bidirectional updates. Multi-agent orchestration (coordinator-specialist-verifier). Context engine across 400K+ files. Isolated git worktrees. | Most ambitious SDD approach. Specs update as implementation changes. Premium pricing reflects enterprise positioning. |

### VS Code Extensions with AI + Methodology Positioning

| Tool | Type | SDD Positioning | Installs/Stars |
|------|------|-----------------|----------------|
| **Cline** | VS Code extension | Per-action human approval. No explicit SDD workflow. Emphasizes developer control over methodology. | 5M+ installs, 58K+ GitHub stars |
| **Continue** | VS Code/JetBrains + CLI | Pivoted mid-2025 from IDE autocomplete to CLI-first CI/CD enforcement. No SDD branding. | Significant but pivoting away from IDE focus |
| **Aider** | CLI tool | Terminal-based, git-integrated. No SDD workflow. "Edit files" positioning. | CLI tool, not VS Code marketplace |

### Frameworks (Not VS Code Extensions, But Competing for Workflow)

| Framework | GitHub Stars | Approach |
|-----------|-------------|----------|
| **GitHub Spec Kit** | 93,000+ | Open-source CLI toolkit. Four phases: specify, plan, tasks, implement. Agent-agnostic (30+ agents). The de facto standard SDD framework. "Nearing 100" community extensions. |
| **BMAD-METHOD** | 46,200+ | Multi-agent framework with 21+ AI personas (Analyst, PM, Architect, Dev, QA). Agent-as-Code markdown files. IDE-agnostic. V6 shipped cross-platform agent team. |
| **OpenSpec** | 28,400+ | Three-phase state machine (proposal, apply, archive). Delta markers. Lightweight output (~250 lines vs. ~800 for Spec Kit). Supports 20+ AI assistants. |
| **Tessl Framework** | Private beta | Spec Registry (10K+ specs preventing API hallucinations). 1:1 spec-to-code mapping. Only tool pursuing "spec-as-source" (humans edit specs, never code). |
| **Specific** (YC F25) | Startup stage | Build backends entirely through natural-language specs. No code writing. Auto-deploys with infrastructure. Funded by Y Combinator. |

### Key Observations — AI Competitors

1. **Kiro owns the "spec-first IDE" narrative.** AWS backing, free tier, and purpose-built SDD workflow make it the default recommendation.
2. **Cursor is the anti-SDD champion by default.** Speed over rigor. Its users bolt on SDD via Spec Kit MCP rather than having it native.
3. **The framework layer is where the real competition is.** Spec Kit (93K stars) vs. BMAD (46K) vs. OpenSpec (28K). VS Code extensions are thin wrappers around these.
4. **No one has solved "living specs."** Intent claims bidirectional spec updates but is expensive. Tessl pursues spec-as-source but is in private beta. Everyone else produces static markdown that drifts.
5. **Cline's 5M installs dwarf everything.** But Cline has zero SDD methodology. The opportunity to add SDD workflow to a popular agent is wide open.

---

## 4. Methodology Trending Data

### Search Interest & Terminology

**"Spec-driven development" as a term:**
- Near-zero search volume before September 2025
- GitHub Spec Kit release (September 2025) was the inflection point
- Rapid growth through Q1-Q2 2026
- Now featured in Thoughtworks Technology Radar, InfoQ, Martin Fowler's blog, and arXiv papers

**Relative term popularity (estimated from content volume and discussion frequency):**

| Term | Relative Volume | Trend Direction | Notes |
|------|----------------|-----------------|-------|
| Test-Driven Development (TDD) | Very High (baseline) | Flat/declining | Established since ~2003. Still dominant in absolute terms but not growing. |
| Behavior-Driven Development (BDD) | High | Flat | Cucumber ecosystem mature. No major innovations since ~2018. |
| Design-First / API-First | Moderate | Stable | Enterprise API teams. OpenAPI/Swagger ecosystem. |
| Contract-First Development | Low-Moderate | Stable | Niche within API development. Specmatic, Pact, Spring Cloud Contract. |
| Spec-Driven Development (SDD) | Low but exploding | Steep upward | Near-zero to major topic in ~9 months. 2026's breakout methodology term. |

### Blog Post & Article Volume

**Major publications covering SDD in 2025-2026:**
- Thoughtworks: "Unpacking one of 2025's key new AI-assisted engineering practices" (Dec 2025)
- GitHub Blog: SDD listed as top blog topic of 2025 (Jan 2026)
- Martin Fowler / Birgitta Bockeler: Three-part deep analysis of SDD tools (2026)
- InfoQ: "When Architecture Becomes Executable" (2026)
- arXiv: Academic paper "Spec-Driven Development: From Code to Contract" (Feb 2026)
- Microsoft Learn: Official training module for Spec Kit (2026)
- BCMS: "The Definitive 2026 Guide" (May 2026)
- Augment Code: Multiple comparison guides and tool reviews (Apr-May 2026)

**Content volume estimate:** 50+ substantial articles/guides in a 9-month period. For a new methodology term, this is exceptionally high signal.

### Hacker News Discussion Volume

| Post | Points | Comments | Date | Sentiment |
|------|--------|----------|------|-----------|
| GitHub Spec Kit launch | High engagement | Active | Oct 2025 | Mixed: excitement + waterfall concerns |
| "Spec-Driven Development: The Waterfall Strikes Back" | 225 | 191 | ~Nov 2025 | Heavily debated. Top criticism: SDD reproduces waterfall's rigidity failure mode |
| Show HN: Specific (YC F25) | Active | Active | Oct 2025 | Positive reception for no-code backend approach |
| Show HN: Specil (minimal SDD tool) | Active | Active | Dec 2025 | "Workflow still feels unrefined" |
| Plain: The Language of SDD | Active | Active | 2025 | Interest in spec language formalization |

**Key community sentiment themes:**
1. "Is this just waterfall with AI?" — The #1 recurring criticism
2. Review overhead — Specs for small tasks feel excessive; 16 acceptance criteria for a bug fix
3. Spec drift — Static markdown specs diverge from implementation within hours
4. LLM non-determinism — Generative code requires exhausting manual validation
5. Excitement about rigor — Engineers who've been burned by "vibe coding" are enthusiastic adopters

### Conference Presence

- No confirmed dedicated SDD talks at QCon or DevOpsCon found in 2025 schedules
- SDD is likely appearing in 2026 conference tracks under broader AI/agentic development themes
- The methodology is too new (< 1 year mainstream) for dedicated conference tracks

---

## 5. Gap Analysis: What's Missing

### Gap 1: No Unified Spec Lifecycle Manager
**Problem:** Developers must choose between fragmented extensions that each handle one piece (spec writing, spec review, task tracking, implementation verification).  
**Evidence:** SpecKit Companion does review. Spec Kit Assistant does phases. OpenSpec for Copilot does generation. None does all.  
**Opportunity:** A single extension that manages the complete lifecycle: draft -> review -> approve -> implement -> verify -> archive.

### Gap 2: No Spec-to-Code Traceability
**Problem:** Once specs produce code, the link between spec requirements and code artifacts is lost. No extension provides bidirectional navigation from spec line to code line and back.  
**Evidence:** Only Kiro for Copilot mentions CodeLens traceability (275 installs). Intent claims "living specs" but is a $60+/mo standalone platform, not a VS Code extension.  
**Opportunity:** CodeLens-style annotations showing which spec requirement each function/test implements.

### Gap 3: No Spec Validation / Conformance Checking
**Problem:** Specs are advisory text. No tool in the VS Code marketplace validates that implementation actually satisfies the spec.  
**Evidence:** Augment Code's analysis: "None [of the VS Code SDD tools] validate against an authoritative spec. They check type signatures, test assertions, and the agent's own memory of the prompt."  
**Opportunity:** Automated conformance checking — does the code satisfy every requirement in the spec? Does the test coverage map to acceptance criteria?

### Gap 4: No Spec-Aware Diff/Review
**Problem:** When specs change, there's no tool that shows the impact on existing code and tests. When code changes, there's no tool that flags spec violations.  
**Evidence:** Martin Fowler's analysis notes "spec drift" as a fundamental unsolved problem. Static markdown specs diverge within hours.  
**Opportunity:** A "spec diff" view that shows spec changes alongside affected code, similar to how database migration tools show schema changes alongside data impact.

### Gap 5: No Cross-Methodology Bridge
**Problem:** SDD specs, OpenAPI contracts, Gherkin behaviors, and C4 architecture diagrams live in separate silos. No tool connects them.  
**Evidence:** 1.5M installs for OpenAPI Editor + 1.2M for Cucumber + 58K for C4 DSL, but zero integration between them.  
**Opportunity:** A meta-spec layer that links API contracts, behavior specs, architecture decisions, and implementation tasks.

### Gap 6: No Agent-Agnostic SDD with Enforcement
**Problem:** Most SDD extensions are locked to one AI provider. Those that are agent-agnostic (Spec Kit) have no enforcement — the agent can ignore the spec.  
**Evidence:** Cursor's rules are "injected as advisory text, so the model treats them as suggestions rather than gating constraints."  
**Opportunity:** Agent-agnostic SDD with hard gates: implementation cannot proceed without spec approval. Tests must map to acceptance criteria before merge.

### Gap 7: Spec Sizing / Complexity Calibration
**Problem:** Current tools apply the same heavyweight spec process to a 5-line bug fix and a 500-file feature. Martin Fowler's analysis: "Kiro generated 16 acceptance criteria for a simple bug fix."  
**Evidence:** HN community feedback consistently cites review overhead as the #1 adoption barrier.  
**Opportunity:** Intelligent spec sizing — auto-detect change scope and adjust ceremony accordingly.

### Gap 8: No Paid/Premium SDD Extension
**Problem:** All SDD VS Code extensions are free. No one has built a premium experience worth paying for.  
**Evidence:** 0/15+ SDD extensions charge money. Compare: GitLens (freemium, millions of installs), GitHub Copilot ($19/mo), Cursor ($20/mo).  
**Opportunity:** A polished, reliable, well-supported SDD extension with premium features could own the space. Current extensions feel like weekend projects.

---

## 6. Marketing Angles for a New Entrant

### Angle 1: "The Missing Layer Between Intent and Code"
**Positioning:** SDD tools produce markdown specs. AI tools produce code. Nothing in between validates that the code matches the intent. Position as the conformance layer.  
**Target:** Teams burned by AI-generated code that "looks right but doesn't match the spec."  
**Tagline:** "Specs that enforce, not just document."

### Angle 2: "Anti-Vibe Coding" (Ride the Wave)
**Positioning:** "Vibe coding" is already the established pejorative for unstructured AI coding. Position as the antidote without calling it SDD (which carries "waterfall" baggage).  
**Target:** Engineering leads and CTOs mandating development discipline.  
**Tagline:** "Stop vibing. Start shipping."  
**Evidence:** GitHub Spec Kit's own marketing: "Stop Vibe Coding." Visual Studio Magazine: "Antidote to piecemeal vibe coding."

### Angle 3: "Spec-Driven for Your Existing Workflow"
**Positioning:** Don't force developers to adopt a new methodology. Add spec discipline incrementally to existing tools they already use (Claude Code, Copilot, Cursor, Cline).  
**Target:** Individual developers and small teams who want rigor without ceremony.  
**Tagline:** "Your AI assistant. Your rules. Actually enforced."  
**Differentiation:** Unlike Kiro (new IDE), Spec Kit (CLI learning curve), or Intent ($60/mo), this works inside VS Code with zero migration.

### Angle 4: "The Right Amount of Spec"
**Positioning:** Address the #1 criticism (overhead). Intelligent spec sizing that scales ceremony to change complexity. A one-line fix gets a one-line spec. A major feature gets the full treatment.  
**Target:** Developers who tried SDD and abandoned it due to overhead.  
**Tagline:** "Just enough spec. Never too much."  
**Differentiation:** Every current tool applies uniform spec depth. This would be unique.

### Angle 5: "Spec-Driven Development for ScroogeLLM Users"
**Positioning:** If building an LLM proxy/gateway product, the natural angle is: specs as the control plane for AI code generation. The proxy enforces spec compliance across any AI provider.  
**Target:** Teams using multiple AI coding tools who need consistency.  
**Tagline:** "One spec. Any AI. Verified output."

### Angle 6: "Enterprise SDD" (Premium Play)
**Positioning:** Compliance, audit trails, approval workflows, role-based access. MyIntern attempted this (11 installs) but executed poorly.  
**Target:** Regulated industries (fintech, healthcare, defense) adopting AI coding.  
**Tagline:** "AI-assisted development your compliance team will approve."  
**Evidence:** MyIntern's HIPAA/PCI-DSS positioning shows demand signal despite failed execution.

---

## 7. Two-Extension Strategy: Marketplace SEO & Positioning

### Why two extensions, not one

Developer searching "spec driven development vscode" expects SDD tooling — not proxy injection via ANTHROPIC_BASE_URL. Developer searching "llm cost savings" doesn't want methodology ceremony. Single extension = confused positioning, poor conversion, marketplace reviews complaining about scope creep.

Two extensions + extension pack = 3 marketplace listings = 3× keyword surface = clean user journey.

### Non-Competing Methodology Keywords

SDD is our primary methodology. These are **complementary layers** (not competing workflows) we also implement — each is a legitimate marketplace keyword.

| Term | Layer | How we support it | Assigned to |
|---|---|---|---|
| **Harness Engineering** | Principles (how to build AI harnesses) | Hooks + CLAUDE.md + invariants IS a harness | MinSpec |
| **AGENTS.md** | Convention file (cross-tool) | `minspec init` generates AGENTS.md | MinSpec |
| **ADR / Architecture Decision Records** | Documentation format | `docs/decisions/DR-NNN.md` IS ADR standard | MinSpec |
| **TDD / Test-Driven Development** | Testing approach | T0-T4 test tiers, tests-before-implementation | MinSpec |
| **Kanban** | Flow management | Issue lifecycle (inbox → agent-ready → wip → done) | MinSpec |
| **SAFe / WSJF** | Prioritization framework | Backlog scoring uses WSJF | MinSpec |
| **Shape Up** | Scope management | Session discipline = appetite-based scope | MinSpec |
| **.cursorrules** | Convention file (Cursor-specific) | Generated alongside CLAUDE.md | MinSpec |
| **DESIGN.md** | Convention file (Google Stitch) | Generated alongside others | MinSpec |
| **Contract-Driven Development** | Testing approach (API contracts) | Zod schemas + contract tests at boundaries | MinSpec |
| **BDD / Behavior-Driven Development** | Specification approach | Acceptance criteria → BDD patterns | MinSpec |
| **Cost optimization** | Infrastructure | Model routing, compression, caching | ScroogeLLM |
| **Token savings** | Infrastructure | Prompt compression, cache hits | ScroogeLLM |
| **PII anonymization** | Security | LLM Guard + deterministic fake-name mapping | ScroogeLLM |
| **Spec conformance** | Enforcement (Phase 3) | Proxy validates output against spec | Extension Pack |

**Competing (same layer — do NOT tag):**
- Superpowers, GSD, AI-DLC — alternative dev workflows that conflict with SDD phases

### Extension A: MinSpec (top-of-funnel, free)

> **MinSpec — Just Enough Spec. Never Too Much.**
>
> Intelligent spec-driven development that scales ceremony to complexity. A one-line fix gets a one-line spec. A major feature gets the full treatment. Works with any AI coding tool.
>
> **Smart Spec Sizing:**
> - Auto-detects change scope (trivial / medium / large / architectural)
> - Skips unnecessary phases — no 16 acceptance criteria for a bug fix
> - Full SDD when you need it, minimal overhead when you don't
>
> **SDD Lifecycle:**
> - Constitution → Specify → Clarify → Plan → Tasks → Implement
> - Phase-skipping based on complexity classification
> - Review gates with approval tracking
> - Spec-to-code traceability via CodeLens annotations
>
> **Harness Engineering:**
> - Generates CLAUDE.md, AGENTS.md, .cursorrules, DESIGN.md
> - Session discipline with scope enforcement hooks
> - Architecture Decision Records (ADR) with per-file storage
> - WSJF-based backlog prioritization
> - Background agent dispatch from GitHub Issues
>
> **Works with:** Claude Code, GitHub Copilot, Cursor, Cline, Windsurf, Aider — any AI coding tool.
>
> **Methodology support:** Spec-Driven Development (SDD) · Harness Engineering · TDD · BDD · Kanban · ADR · Shape Up · SAFe/WSJF · Contract-Driven Development

**Marketplace Tags:**
```
spec-driven-development, sdd, harness-engineering, tdd, bdd, adr,
architecture-decision-records, kanban, wsjf, shape-up, agents-md,
cursorrules, design-md, claude-code, copilot, cursor, cline,
windsurf, aider, contract-testing, ai-development-methodology,
spec-kit, just-enough-spec, anti-vibe-coding, code-quality
```

### Extension B: ScroogeLLM (monetization, freemium)

> **ScroogeLLM — Every Token Counts. Save 40-70% on AI Coding Costs.**
>
> Local proxy that optimizes every LLM API call. Smart model routing, prompt compression, and caching — with a real-time savings dashboard so you see exactly what you're saving.
>
> **Free tier (visibility):**
> - Real-time cost ticker per request and running total
> - Model usage breakdown (which models, how often, cost each)
> - Savings estimator: "You could save $X/month with optimization"
>
> **Pro tier (optimization):**
> - Smart model routing (Haiku for trivial, Sonnet for medium, Opus for complex)
> - LLMLingua prompt compression (10-20x token reduction)
> - Automatic prompt caching optimization (90% savings on cache hits)
> - PII anonymization with deterministic fake-name mapping
> - Budget caps and rate limiting per project/team
> - Multi-provider fallback (100+ providers via LiteLLM)
>
> **Works with:** Any tool that accepts ANTHROPIC_BASE_URL or OpenAI-compatible base URL.

**Marketplace Tags:**
```
llm-proxy, cost-optimization, token-savings, model-routing,
prompt-compression, pii-anonymization, llm-gateway, api-proxy,
claude, openai, gemini, cost-tracking, budget-management,
ai-cost-reduction, litellm, prompt-caching, savings-dashboard
```

### Extension Pack: MinSpec Pro

> **MinSpec Pro — Specs That Scale. Costs That Shrink.**
>
> The complete AI development workflow: specs that scale to complexity + costs that scale down automatically.
>
> Includes MinSpec (methodology) + ScroogeLLM (optimization). Together, they unlock **Spec Conformance** — the proxy validates that AI-generated code satisfies your spec requirements before it reaches your editor.
>
> Installs both extensions. Each works independently; together they're more than the sum.

**Marketplace Tags:**
```
spec-driven-development, cost-optimization, spec-conformance,
ai-development, llm-proxy, sdd, full-stack-ai-workflow
```

### Keyword allocation summary

| Keyword surface | Extension | Installs feed into |
|---|---|---|
| SDD + methodology (12+ terms) | MinSpec | Free user base |
| Cost + optimization (10+ terms) | ScroogeLLM | Freemium conversion |
| Conformance + combined (5+ terms) | Extension Pack | Premium upsell |

Every tag maps to real functionality — no bait-and-switch. Developer searching any term finds genuine support in that specific extension.

---

## Appendix A: Complete Extension Registry

All SDD-related VS Code extensions identified as of 2026-05-26:

1. Kiro for Claude Code (heisebaiyun) — 19,189 installs
2. SpecKit Companion (alfredoperez) — 6,173 installs
3. OpenSpec for Copilot (atman-dev) — 2,711 installs
4. Spec Kit Assistant (rfsales) — 2,104 installs
5. specsmd (fabriqaai) — 701 installs
6. Kiro-Style Copilot (JosEduardoTeixeira) — 527 installs
7. Specly Code (precise-code) — 294 installs
8. Kiro for Copilot (moonolgerd) — 275 installs
9. SDD - Spec-Driven Development (jmjauregui) — 29 installs
10. MyIntern (MyIntern) — 11 installs
11. Kiro for Codex (atman-dev) — marketplace page returned 404 (possibly removed)
12. Caramelo — referenced in blog posts, marketplace listing not confirmed

**Total estimated SDD extension installs:** ~32,000 (across all extensions combined)

## Appendix B: Adjacent Extension Install Benchmarks

For scale comparison:

| Extension | Installs | Category |
|-----------|----------|----------|
| OpenAPI (Swagger) Editor | 1,510,193 | API Design-First |
| Cucumber (Gherkin) Full Support | 1,219,801 | BDD |
| Cucumber (Official) | 414,773 | BDD |
| Spectral | 62,687 | API Linting |
| C4 DSL Extension | 58,522 | Architecture-as-Code |
| TypeSpec | 39,521 | API Specification |
| SwaggerHub | 14,252 | API Design-First |
| Specmatic | 922 | Contract Testing |
| BDD AI Toolkit | 372 | BDD + AI |

## Appendix C: Key Sources

### Marketplace Links
- [SpecKit Companion](https://marketplace.visualstudio.com/items?itemName=alfredoperez.speckit-companion)
- [Specly Code](https://marketplace.visualstudio.com/items?itemName=precise-code.specly-code)
- [OpenAPI (Swagger) Editor](https://marketplace.visualstudio.com/items?itemName=42Crunch.vscode-openapi)
- [SDD Extension](https://marketplace.visualstudio.com/items?itemName=jmjauregui.sdd-yusepe)
- [specsmd](https://marketplace.visualstudio.com/items?itemName=fabriqaai.specsmd)
- [OpenSpec for Copilot](https://marketplace.visualstudio.com/items?itemName=atman-dev.openspec-for-copilot)
- [MyIntern](https://marketplace.visualstudio.com/items?itemName=MyIntern.myintern-vscode)
- [Kiro for Claude Code](https://marketplace.visualstudio.com/items?itemName=heisebaiyun.kiro-for-cc)
- [Kiro for Copilot](https://marketplace.visualstudio.com/items?itemName=moonolgerd.kiro-for-copilot)
- [Kiro-Style Copilot](https://marketplace.visualstudio.com/items?itemName=JosEduardoTeixeira.kiro-copilot-extension)
- [Spec Kit Assistant](https://marketplace.visualstudio.com/items?itemName=rfsales.speckit-assistant)
- [Specmatic](https://marketplace.visualstudio.com/items?itemName=Specmatic.specmatic-vscode-extension)
- [TypeSpec](https://marketplace.visualstudio.com/items?itemName=typespec.typespec-vscode)
- [Spectral](https://marketplace.visualstudio.com/items?itemName=stoplight.spectral)
- [Cucumber (Gherkin) Full Support](https://marketplace.visualstudio.com/items?itemName=alexkrechik.cucumberautocomplete)
- [Cucumber Official](https://marketplace.visualstudio.com/items?itemName=CucumberOpen.cucumber-official)
- [BDD AI Toolkit](https://marketplace.visualstudio.com/items?itemName=liujingping.bdd-ai-toolkit)
- [C4 DSL Extension](https://marketplace.visualstudio.com/items?itemName=systemticks.c4-dsl-extension)
- [SwaggerHub for VS Code](https://marketplace.visualstudio.com/items?itemName=SmartBearSoftware.vscode-swaggerhub)

### Analysis & Methodology Sources
- [Thoughtworks: Spec-driven development practices](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)
- [Martin Fowler: Understanding SDD - Kiro, spec-kit, Tessl](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [GitHub Blog: Top posts of 2025](https://github.blog/developer-skills/agentic-ai-mcp-and-spec-driven-development-top-blog-posts-of-2025/)
- [Augment Code: Cursor SDD analysis](https://www.augmentcode.com/guides/cursor-spec-driven-development)
- [Augment Code: 6 Best SDD Tools](https://www.augmentcode.com/tools/best-spec-driven-development-tools)
- [BCMS: SDD Definitive 2026 Guide](https://thebcms.com/blog/spec-driven-development)
- [InfoQ: When Architecture Becomes Executable](https://www.infoq.com/articles/spec-driven-development/)
- [arXiv: From Code to Contract](https://arxiv.org/html/2602.00180v1)
- [Microsoft Learn: Spec Kit training](https://learn.microsoft.com/en-us/training/modules/spec-driven-development-github-spec-kit-enterprise-developers/)
- [Kiro IDE](https://kiro.dev/)
- [Kiro Pricing](https://kiro.dev/pricing/)
- [GitHub Spec Kit](https://github.com/github/spec-kit)
- [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
- [Tessl SDD docs](https://docs.tessl.io/use/spec-driven-development-with-tessl)
- [HN: Waterfall Strikes Back (225pts, 191 comments)](https://news.ycombinator.com/item?id=45935763)
- [HN: Spec Kit launch](https://news.ycombinator.com/item?id=45154355)
- [HN: Specific YC F25](https://news.ycombinator.com/item?id=45595760)
- [Dev.to: Caramelo extension](https://dev.to/fabian_silva_/i-built-a-visual-spec-driven-development-extension-for-vs-code-that-works-with-any-llm-36ok)
- [Dev.to: SDD Stop Vibe Coding](https://dev.to/alfredoperez/spec-driven-development-stop-vibe-coding-af2)
- [Visual Studio Magazine: Spec Kit takes off](https://visualstudiomagazine.com/articles/2026/05/12/github-spec-kit-takes-off-as-antidote-to-piecemeal-vibe-coding.aspx)
- [MarkTechPost: 9 Best SDD Tools](https://www.marktechpost.com/2026/05/08/9-best-ai-tools-for-spec-driven-development-in-2026-kiro-bmad-gsd-and-more-compare/)
