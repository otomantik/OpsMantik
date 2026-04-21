/**
 * Pipeline FSM (deterministic, monotonic by default).
 * Regressions are intentionally excluded from this transition contract and must
 * be handled in explicit audited reversal flows.
 */
export type PipelineStage = 'junk' | 'contacted' | 'offered' | 'won';

export type PipelineState =
  | { tag: 'junk' }
  | { tag: 'contacted' }
  | { tag: 'offered' }
  | { tag: 'won' };

export type PipelineEvent =
  | { type: 'advance_to_contacted' }
  | { type: 'advance_to_offered' }
  | { type: 'advance_to_won' }
  | { type: 'noop' };

export const PIPELINE_STAGES: readonly PipelineStage[] = ['junk', 'contacted', 'offered', 'won'] as const;

export const STAGE_ORDINAL: Readonly<Record<PipelineStage, number>> = {
  junk: 0,
  contacted: 1,
  offered: 2,
  won: 3,
};

export type ValidTransitions = {
  junk: 'junk' | 'contacted';
  contacted: 'contacted' | 'offered';
  offered: 'offered' | 'won';
  won: 'won';
};

export function pipelineTransition<From extends PipelineStage>(
  from: From,
  to: ValidTransitions[From]
): ValidTransitions[From] {
  return to;
}

export function reducePipelineState(state: PipelineState, event: PipelineEvent): PipelineState {
  switch (state.tag) {
    case 'junk':
      switch (event.type) {
        case 'advance_to_contacted':
          return { tag: 'contacted' };
        case 'noop':
          return state;
        case 'advance_to_offered':
        case 'advance_to_won':
          return state;
        default:
          return assertNeverEvent(event);
      }
    case 'contacted':
      switch (event.type) {
        case 'advance_to_offered':
          return { tag: 'offered' };
        case 'noop':
        case 'advance_to_contacted':
          return state;
        case 'advance_to_won':
          return state;
        default:
          return assertNeverEvent(event);
      }
    case 'offered':
      switch (event.type) {
        case 'advance_to_won':
          return { tag: 'won' };
        case 'noop':
        case 'advance_to_offered':
          return state;
        case 'advance_to_contacted':
          return state;
        default:
          return assertNeverEvent(event);
      }
    case 'won':
      return state;
    default:
      return assertNeverState(state);
  }
}

export function isValidTransition(from: PipelineStage, to: PipelineStage): boolean {
  if (STAGE_ORDINAL[to] < STAGE_ORDINAL[from]) return false;
  if (from === 'junk') return to === 'junk' || to === 'contacted';
  if (from === 'contacted') return to === 'contacted' || to === 'offered';
  if (from === 'offered') return to === 'offered' || to === 'won';
  return to === 'won';
}

export function assertTransition(from: PipelineStage, to: PipelineStage): void {
  if (!isValidTransition(from, to)) {
    throw new PipelineTransitionError(from, to);
  }
}

export function stageOrdinal(stage: PipelineStage): number {
  return STAGE_ORDINAL[stage];
}

export function isAdvancement(from: PipelineStage, to: PipelineStage): boolean {
  return STAGE_ORDINAL[to] > STAGE_ORDINAL[from];
}

export function isRegression(from: PipelineStage, to: PipelineStage): boolean {
  return STAGE_ORDINAL[to] < STAGE_ORDINAL[from];
}

export function assertNeverStage(stage: never): never {
  throw new Error(`Unhandled pipeline stage: ${String(stage)}`);
}

function assertNeverState(value: never): never {
  throw new Error(`Unhandled pipeline state: ${JSON.stringify(value)}`);
}

function assertNeverEvent(value: never): never {
  throw new Error(`Unhandled pipeline event: ${JSON.stringify(value)}`);
}

export class PipelineTransitionError extends Error {
  public readonly from: PipelineStage;
  public readonly to: PipelineStage;

  constructor(from: PipelineStage, to: PipelineStage) {
    super(`Illegal pipeline transition: '${from}' -> '${to}'`);
    this.name = 'PipelineTransitionError';
    this.from = from;
    this.to = to;
  }
}
