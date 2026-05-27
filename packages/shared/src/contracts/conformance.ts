/**
 * Conformance Contract — Phase 10.2
 *
 * Defines the shared contract between MinSpec and ScroogeLLM for
 * spec conformance checking. MinSpec exports traceability data in
 * this format; ScroogeLLM consumes it to verify LLM outputs
 * conform to spec requirements.
 *
 * This file lives in @aiclarity/shared so both extensions
 * reference the same types.
 */

/** A location in source code (file + line range) */
export interface CodeLocation {
  file: string;
  startLine: number;
  endLine: number;
}

/** A single requirement with its traceability mappings */
export interface ConformanceRequirement {
  key: string;
  description: string;
  acceptanceCriteria: string[];
  codeLocations: CodeLocation[];
  testLocations: CodeLocation[];
}

/** The full conformance contract exported by MinSpec */
export interface ConformanceContract {
  version: '1.0';
  specId: string;
  requirements: ConformanceRequirement[];
}

/** A conformance check result produced by ScroogeLLM */
export interface ConformanceResult {
  specId: string;
  requirementKey: string;
  status: 'pass' | 'fail' | 'partial' | 'untested';
  evidence: string;
  timestamp: string;
}
