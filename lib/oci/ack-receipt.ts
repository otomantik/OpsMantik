import { createHash } from 'node:crypto';
import { adminClient } from '@/lib/supabase/admin';

export type AckReceiptKind = 'ACK' | 'ACK_FAILED';

export type AckReceiptRegistration = {
  receiptId: string | null;
  replayed: boolean;
  inProgress: boolean;
  resultSnapshot: Record<string, unknown> | null;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`).join(',')}}`;
}

export function buildAckPayloadHash(input: {
  siteId: string;
  kind: AckReceiptKind;
  queueIds: string[];
  skippedIds?: string[];
  fatalErrorIds?: string[];
  pendingConfirmation?: boolean;
  errorCode?: string;
  errorMessage?: string;
  errorCategory?: string;
}): string {
  const canonical = stableStringify({
    siteId: input.siteId,
    kind: input.kind,
    queueIds: [...input.queueIds].sort(),
    skippedIds: [...(input.skippedIds ?? [])].sort(),
    fatalErrorIds: [...(input.fatalErrorIds ?? [])].sort(),
    pendingConfirmation: input.pendingConfirmation === true,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    errorCategory: input.errorCategory ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export async function registerAckReceipt(params: {
  siteId: string;
  kind: AckReceiptKind;
  payloadHash: string;
  requestFingerprint: string;
  requestPayload: Record<string, unknown>;
}): Promise<AckReceiptRegistration> {
  const { data, error } = await adminClient.rpc('register_ack_receipt_v1', {
    p_site_id: params.siteId,
    p_kind: params.kind,
    p_payload_hash: params.payloadHash,
    p_request_fingerprint: params.requestFingerprint,
    p_request_payload: params.requestPayload,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    receiptId: typeof row?.receipt_id === 'string' ? row.receipt_id : null,
    replayed: row?.replayed === true,
    inProgress: row?.in_progress === true,
    resultSnapshot:
      row?.result_snapshot && typeof row.result_snapshot === 'object'
        ? (row.result_snapshot as Record<string, unknown>)
        : null,
  };
}

export async function completeAckReceipt(params: {
  receiptId: string;
  resultSnapshot: Record<string, unknown>;
}): Promise<void> {
  const { error } = await adminClient.rpc('complete_ack_receipt_v1', {
    p_receipt_id: params.receiptId,
    p_result_snapshot: params.resultSnapshot,
  });
  if (error) throw error;
}
