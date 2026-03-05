/**
 * Singularity Protocol: Causal DNA (Decision Trace)
 *
 * Every transformation and branch leaves a sub-atomic trace.
 * Original state and transformed state coexist for non-repudiation.
 */

import type { OpsGear } from './types';

const MATH_VERSION = 'v1.0.4';

export interface CausalDnaBranch {
  input: string;
  gates_passed: string[];
  logic_branch: string;
  math_version: string;
  original_state?: Record<string, unknown>;
  transformed_state?: Record<string, unknown>;
  timestamp_iso: string;
}

export interface CausalDna {
  branches: CausalDnaBranch[];
  input_gear: OpsGear;
  math_version: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createCausalDna(gear: OpsGear): CausalDna {
  return {
    branches: [],
    input_gear: gear,
    math_version: MATH_VERSION,
  };
}

export function appendBranch(
  dna: CausalDna,
  logicBranch: string,
  gatesPassed: string[],
  originalState?: Record<string, unknown>,
  transformedState?: Record<string, unknown>
): CausalDna {
  return {
    ...dna,
    branches: [
      ...dna.branches,
      {
        input: dna.input_gear,
        gates_passed: gatesPassed,
        logic_branch: logicBranch,
        math_version: dna.math_version,
        ...(originalState && { original_state: originalState }),
        ...(transformedState && { transformed_state: transformedState }),
        timestamp_iso: nowIso(),
      },
    ],
  };
}

export function toJsonb(dna: CausalDna): Record<string, unknown> {
  return {
    input: dna.input_gear,
    gates_passed: dna.branches.flatMap((b) => b.gates_passed),
    logic_branch: dna.branches.length > 0 ? dna.branches[dna.branches.length - 1].logic_branch : 'unknown',
    math_version: dna.math_version,
    branches: dna.branches,
    branches_count: dna.branches.length,
  };
}

/** Singularity: Minimal causal DNA for non-orchestrator paths (seal enqueue, pipeline stage). */
export function buildMinimalCausalDna(
  input: string,
  gatesPassed: string[],
  logicBranch: string,
  originalState?: Record<string, unknown>,
  transformedState?: Record<string, unknown>
): Record<string, unknown> {
  const branch: Record<string, unknown> = {
    input,
    gates_passed: gatesPassed,
    logic_branch: logicBranch,
    math_version: MATH_VERSION,
    timestamp_iso: new Date().toISOString(),
  };
  if (originalState) branch.original_state = originalState;
  if (transformedState) branch.transformed_state = transformedState;
  return {
    input,
    gates_passed: gatesPassed,
    logic_branch: logicBranch,
    math_version: MATH_VERSION,
    branches: [branch],
    branches_count: 1,
  };
}
