export async function runPulseRecovery(): Promise<{
  processed: number;
  recovered: number;
  attempted: number;
  exhausted: number;
  missing_signal_checked: number;
  missing_signal_recovered: number;
  missing_signal_dropped: number;
  pv_checked: number;
  pv_requeued: number;
  pv_dropped: number;
}> {
  return {
    processed: 0,
    recovered: 0,
    attempted: 0,
    exhausted: 0,
    missing_signal_checked: 0,
    missing_signal_recovered: 0,
    missing_signal_dropped: 0,
    pv_checked: 0,
    pv_requeued: 0,
    pv_dropped: 0,
  };
}
