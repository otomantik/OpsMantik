export type OciLane = 'INGEST' | 'OUTBOX' | 'OCI_ACK' | 'EXPORT';

const ENV_BY_LANE: Record<OciLane, string> = {
  INGEST: 'INGEST_HARD_PAUSE',
  OUTBOX: 'OUTBOX_HARD_PAUSE',
  OCI_ACK: 'OCI_ACK_HARD_PAUSE',
  EXPORT: 'EXPORT_HARD_PAUSE',
};

export function isLanePaused(lane: OciLane): boolean {
  const envKey = ENV_BY_LANE[lane];
  const value = process.env[envKey];
  return value === '1' || value === 'true';
}

export function assertLaneActive(lane: OciLane): { ok: true } | { ok: false; code: string } {
  if (isLanePaused(lane)) {
    return { ok: false, code: `${lane}_HARD_PAUSED` };
  }
  return { ok: true };
}
