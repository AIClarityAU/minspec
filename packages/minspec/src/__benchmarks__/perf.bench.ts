/**
 * Performance benchmarks for MinSpec extension (Phase 9.3).
 *
 * Targets:
 *   - Classification < 500ms (20 files, 500 lines, mixed types)
 *   - Tree view getChildren() < 200ms (50 spec files)
 *   - Spec parsing — realistic spec with frontmatter + 5 phases + 20 tasks
 *   - Traceability lookup — findRequirementsForFile with 100 mappings
 *
 * Run: vitest bench
 */

import { bench, describe, vi } from 'vitest';

// --- Mock vscode before any import that touches it ---
vi.mock('vscode', () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
    description?: string;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;
    tooltip?: string;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  ThemeIcon: class {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
  Uri: { file: (p: string) => ({ fsPath: p, scheme: 'file' }) },
}));

import { classify } from '../lib/classifier';
import type { ClassificationSignal } from '../lib/classifier';
import type { MinspecConfig, Tier } from '../lib/config';
import { DEFAULT_CONFIG } from '../lib/config';
import { parseSpec } from '../lib/spec';
import { SpecTreeProvider } from '../views/spec-tree-provider';
import type { SpecSummary } from '../views/spec-tree-provider';
import type { TraceabilityData } from '../lib/traceability';
import { findRequirementsForFile, addFileMapping, addTestMapping } from '../lib/traceability';

// ============================================================
// Test data generators
// ============================================================

/**
 * Generate realistic classification signals for a 20-file, 500-line,
 * mixed-type diff. Mirrors what analyzeGitDiff() would produce for
 * a medium-to-large change spanning src/, tests/, and config.
 */
function buildRealisticSignals(): ClassificationSignal[] {
  return [
    // 20 files changed -> T4 tier contribution
    { name: 'files_changed', value: 20, weight: 0.3, tierContribution: 'T4' },
    // 500 lines changed -> T3 tier contribution (101-500 range)
    { name: 'lines_changed', value: 500, weight: 0.25, tierContribution: 'T3' },
    // 5 different file types (ts, tsx, json, md, css) -> T3
    { name: 'file_types', value: 5, weight: 0.15, tierContribution: 'T3' },
    // 6 directories touched -> T3
    { name: 'cross_directory', value: 6, weight: 0.15, tierContribution: 'T3' },
    // 4 new files -> T3
    { name: 'new_files', value: 4, weight: 0.1, tierContribution: 'T3' },
    // package.json with new dependencies -> T3
    { name: 'dependency_change', value: true, weight: 0.2, tierContribution: 'T3' },
  ];
}

/**
 * Build 50 realistic SpecSummary objects for tree view benchmarking.
 * Distributes across statuses: 30 active, 12 done, 8 archived.
 */
function build50Specs(): SpecSummary[] {
  const statuses: Array<{ status: SpecSummary['status']; phase: SpecSummary['currentPhase'] }> = [];

  // 10 new, 10 specifying, 10 implementing (active)
  for (let i = 0; i < 10; i++) statuses.push({ status: 'new', phase: 'specify' });
  for (let i = 0; i < 10; i++) statuses.push({ status: 'specifying', phase: 'clarify' });
  for (let i = 0; i < 10; i++) statuses.push({ status: 'implementing', phase: 'implement' });
  // 12 done
  for (let i = 0; i < 12; i++) statuses.push({ status: 'done', phase: null });
  // 8 archived
  for (let i = 0; i < 8; i++) statuses.push({ status: 'archived', phase: null });

  const tiers: Tier[] = ['T1', 'T2', 'T3', 'T4'];

  return statuses.map((s, i): SpecSummary => ({
    id: `SPEC-${String(i + 1).padStart(3, '0')}`,
    title: `Feature ${i + 1}: ${['Rate limiting', 'Auth flow', 'Dashboard', 'API gateway', 'Search index', 'Notification service', 'Caching layer', 'File uploads', 'Audit logging', 'Health checks'][i % 10]}`,
    tier: tiers[i % tiers.length],
    status: s.status,
    currentPhase: s.phase,
    filePath: `/workspace/specs/SPEC-${String(i + 1).padStart(3, '0')}.md`,
    phasesDone: s.phase === null ? 2 : 0,
    phasesTotal: 2,
  }));
}

/**
 * Generate a realistic spec markdown string with frontmatter, preamble,
 * 5 phase sections, and 20 tasks distributed across phases.
 */
function buildRealisticSpecContent(): string {
  const tasks = (count: number, doneCount: number): string => {
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      const done = i < doneCount;
      lines.push(`- [${done ? 'x' : ' '}] Task item ${i + 1}: ${done ? 'Completed' : 'Implement'} the ${['validation logic', 'error handling', 'unit tests', 'integration test', 'documentation', 'API endpoint', 'database migration', 'cache invalidation', 'retry mechanism', 'rate limiter'][i % 10]}`);
    }
    return lines.join('\n');
  };

  return `---
id: SPEC-042
title: Distributed Rate Limiting with Redis Backend
tier: T3
status: implementing
created: 2026-05-20
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: pending
---

# Distributed Rate Limiting with Redis Backend

This spec covers the implementation of a distributed rate limiting system
using Redis as the shared state backend. The system must support sliding
window counters, token bucket algorithms, and per-tenant configuration.

Key requirements:
- Sub-millisecond local cache lookups
- Redis fallback with circuit breaker
- Per-tenant rate limit configuration via admin API
- Prometheus metrics for rate limit hits/misses

## Specify

The rate limiter sits between the API gateway and the service mesh.
All inbound requests pass through it. Configuration is loaded from
the tenant database at startup and refreshed every 60 seconds.

${tasks(4, 4)}

## Clarify

Clarification items resolved with stakeholders:
- Confirmed: sliding window (not fixed window) for fairness
- Confirmed: 429 responses include Retry-After header
- Open: whether to support burst allowance (decided: yes, up to 2x)

${tasks(3, 3)}

## Plan

Architecture decisions:
- Redis Cluster for HA (3 primaries, 3 replicas)
- Local LRU cache (1000 entries, 5s TTL) for hot paths
- Circuit breaker: open after 5 failures in 10s window
- Fallback: allow traffic when Redis is unreachable (fail-open)

Component breakdown:
1. RateLimitMiddleware - Express middleware entry point
2. SlidingWindowCounter - Redis-backed counter implementation
3. TokenBucket - Alternative algorithm for bursty workloads
4. TenantConfigLoader - Periodic config refresh from DB
5. CircuitBreaker - Wraps Redis client with failure detection

${tasks(5, 5)}

## Tasks

Implementation tasks for the rate limiting system:

${tasks(5, 2)}

## Implement

Implementation notes and progress tracking:

${tasks(3, 0)}
`;
}

/**
 * Build a TraceabilityData map with 100 requirement mappings spread
 * across 10 specs, each with 10 requirements, each pointing to
 * realistic file paths with line ranges.
 */
function build100MappingTraceability(): TraceabilityData {
  let data: TraceabilityData = {};

  const filePaths = [
    'src/middleware/rate-limit.ts',
    'src/services/auth.ts',
    'src/controllers/user.ts',
    'src/models/tenant.ts',
    'src/utils/cache.ts',
    'src/routes/api.ts',
    'src/middleware/cors.ts',
    'src/services/notification.ts',
    'src/controllers/dashboard.ts',
    'src/models/session.ts',
    'src/middleware/logging.ts',
    'src/services/search.ts',
    'src/controllers/admin.ts',
    'src/models/audit.ts',
    'src/utils/retry.ts',
    'tests/middleware/rate-limit.test.ts',
    'tests/services/auth.test.ts',
    'tests/controllers/user.test.ts',
    'tests/models/tenant.test.ts',
    'tests/utils/cache.test.ts',
  ];

  for (let specIdx = 0; specIdx < 10; specIdx++) {
    const specId = `SPEC-${String(specIdx + 1).padStart(3, '0')}`;
    for (let reqIdx = 0; reqIdx < 10; reqIdx++) {
      const reqKey = `req-${specIdx}-${reqIdx}`;
      const fileIdx = (specIdx * 10 + reqIdx) % filePaths.length;
      const startLine = (reqIdx + 1) * 10;
      const endLine = startLine + 15;
      const fileLoc = `${filePaths[fileIdx]}:${startLine}-${endLine}`;
      const testLoc = `${filePaths[(fileIdx + 15) % filePaths.length]}:${startLine}-${endLine + 10}`;

      data = addFileMapping(data, specId, reqKey, fileLoc);
      data = addTestMapping(data, specId, reqKey, testLoc);
    }
  }

  return data;
}

// ============================================================
// Benchmarks
// ============================================================

describe('Classification performance', () => {
  const signals = buildRealisticSignals();
  const config: MinspecConfig = DEFAULT_CONFIG;

  bench('classify() with 20-file, 500-line mixed diff signals', () => {
    classify(signals, config);
  }, { time: 2000 });

  // Also benchmark with more signals to test scaling — simulate
  // a large monorepo diff producing 50 signals
  const largeSignals: ClassificationSignal[] = [];
  const tiers: Tier[] = ['T1', 'T2', 'T3', 'T4'];
  for (let i = 0; i < 50; i++) {
    largeSignals.push({
      name: `signal_${i}`,
      value: i * 10,
      weight: 0.1 + (i % 5) * 0.05,
      tierContribution: tiers[i % 4],
    });
  }

  bench('classify() with 50 signals (monorepo scale)', () => {
    classify(largeSignals, config);
  }, { time: 2000 });
});

describe('Tree view performance', () => {
  const specs = build50Specs();
  const mockListSpecs = () => specs;

  bench('SpecTreeProvider.getChildren() root with 50 specs', () => {
    const provider = new SpecTreeProvider('/workspace', mockListSpecs);
    const groups = provider.getChildren(undefined);
    // Also expand each group to simulate full tree render
    for (const group of groups) {
      provider.getChildren(group);
    }
  }, { time: 2000 });

  // Benchmark just the root call (status grouping)
  bench('SpecTreeProvider.getChildren() root only (grouping)', () => {
    const provider = new SpecTreeProvider('/workspace', mockListSpecs);
    provider.getChildren(undefined);
  }, { time: 2000 });
});

describe('Spec parsing performance', () => {
  const specContent = buildRealisticSpecContent();

  bench('parseSpec() — realistic spec (frontmatter + 5 phases + 20 tasks)', () => {
    parseSpec(specContent);
  }, { time: 2000 });

  // Benchmark with a minimal T1 spec for comparison
  const minimalSpec = `---
id: SPEC-001
title: Fix typo in readme
tier: T1
status: done
created: 2026-05-26
phases:
  specify: done
  clarify: skipped
  plan: skipped
  tasks: skipped
  implement: done
---

## Specify

Fix the typo in README.md line 42.

- [x] Fix typo
`;

  bench('parseSpec() — minimal T1 spec (baseline)', () => {
    parseSpec(minimalSpec);
  }, { time: 2000 });

  // Benchmark with a very large spec (stress test)
  const sections: string[] = [];
  for (let i = 0; i < 10; i++) {
    const sectionTasks: string[] = [];
    for (let j = 0; j < 20; j++) {
      sectionTasks.push(`- [${j < 10 ? 'x' : ' '}] Task ${i * 20 + j + 1}: Implement feature component ${j + 1} with comprehensive error handling, validation, and integration test coverage for the ${['authentication', 'authorization', 'caching', 'logging', 'monitoring'][j % 5]} subsystem`);
    }
    sections.push(`## Section ${i + 1}\n\nDetailed description of section ${i + 1} with multiple paragraphs of context explaining the rationale, constraints, and acceptance criteria for this phase of the implementation.\n\n${sectionTasks.join('\n')}`);
  }
  const largeSpec = `---
id: SPEC-099
title: Large Enterprise Feature with Many Tasks
tier: T4
status: implementing
created: 2026-05-20
phases:
  specify: done
  clarify: done
  plan: done
  tasks: in-progress
  implement: pending
---

# Large Enterprise Feature

This is a comprehensive spec with 10 sections and 200 tasks total, representing
a worst-case scenario for spec parsing performance.

${sections.join('\n\n')}
`;

  bench('parseSpec() — large spec (10 sections, 200 tasks, stress test)', () => {
    parseSpec(largeSpec);
  }, { time: 2000 });
});

describe('Traceability lookup performance', () => {
  const data = build100MappingTraceability();

  // Look up a file that appears in many mappings
  bench('findRequirementsForFile() — 100 mappings, matching file', () => {
    findRequirementsForFile(data, 'src/middleware/rate-limit.ts');
  }, { time: 2000 });

  // Look up a file that does NOT match (worst case: scans everything, finds nothing)
  bench('findRequirementsForFile() — 100 mappings, no match (full scan)', () => {
    findRequirementsForFile(data, 'src/components/sidebar.tsx');
  }, { time: 2000 });

  // Look up a test file
  bench('findRequirementsForFile() — 100 mappings, test file match', () => {
    findRequirementsForFile(data, 'tests/services/auth.test.ts');
  }, { time: 2000 });

  // Build larger dataset: 500 mappings (50 specs x 10 reqs)
  let largeData: TraceabilityData = {};
  const paths = [
    'src/api/routes.ts', 'src/api/middleware.ts', 'src/api/auth.ts',
    'src/core/engine.ts', 'src/core/pipeline.ts', 'src/core/scheduler.ts',
    'src/db/models.ts', 'src/db/migrations.ts', 'src/db/seeds.ts',
    'src/utils/helpers.ts',
  ];
  for (let s = 0; s < 50; s++) {
    const specId = `SPEC-${String(s + 1).padStart(3, '0')}`;
    for (let r = 0; r < 10; r++) {
      const loc = `${paths[(s + r) % paths.length]}:${r * 5 + 1}-${r * 5 + 10}`;
      largeData = addFileMapping(largeData, specId, `req-${r}`, loc);
    }
  }

  bench('findRequirementsForFile() — 500 mappings (scale test)', () => {
    findRequirementsForFile(largeData, 'src/core/engine.ts');
  }, { time: 2000 });
});
