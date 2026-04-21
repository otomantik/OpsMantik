export type ConvergenceSnapshot = {
  uncontrolledBacklogGrowth: number;
  orphanUnits: number;
  untypedTerminalFailures: number;
  replayParityPercent: number;
};

export function isConverged(snapshot: ConvergenceSnapshot): boolean {
  return (
    snapshot.uncontrolledBacklogGrowth === 0 &&
    snapshot.orphanUnits === 0 &&
    snapshot.untypedTerminalFailures === 0 &&
    snapshot.replayParityPercent >= 100
  );
}

export function summarizeConvergence(snapshot: ConvergenceSnapshot): {
  ok: boolean;
  reason: string;
} {
  if (isConverged(snapshot)) return { ok: true, reason: 'CONVERGED' };
  return {
    ok: false,
    reason: `DRIFT backlog=${snapshot.uncontrolledBacklogGrowth} orphan=${snapshot.orphanUnits} untyped=${snapshot.untypedTerminalFailures} replay=${snapshot.replayParityPercent}`,
  };
}
