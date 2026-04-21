export type WorkConservationCounters = {
  accepted: number;
  progressed: number;
  quarantined: number;
  terminal: number;
  rejected: number;
};

export function isWorkConserved(counters: WorkConservationCounters): boolean {
  return counters.accepted === counters.progressed + counters.quarantined + counters.terminal + counters.rejected;
}

export function assertWorkConservation(counters: WorkConservationCounters): void {
  if (!isWorkConserved(counters)) {
    throw new Error(
      `WORK_CONSERVATION_BREACH accepted=${counters.accepted} progressed=${counters.progressed} quarantined=${counters.quarantined} terminal=${counters.terminal} rejected=${counters.rejected}`
    );
  }
}
