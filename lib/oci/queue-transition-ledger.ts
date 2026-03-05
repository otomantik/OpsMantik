import type { SupabaseClient } from '@supabase/supabase-js';

import type { ProviderErrorCategory, QueueStatus } from '@/lib/domain/oci/queue-types';
import { chunkArray } from '@/lib/utils/batch';

export type QueueTransitionActor =
  | 'SCRIPT'
  | 'WORKER'
  | 'RPC_CLAIM'
  | 'SWEEPER'
  | 'MANUAL'
  | 'SYSTEM_BACKFILL';

export const QUEUE_TRANSITION_CLEARABLE_FIELDS = [
  'last_error',
  'provider_error_code',
  'provider_error_category',
  'next_retry_at',
  'uploaded_at',
  'claimed_at',
  'provider_request_id',
  'provider_ref',
] as const;

export type QueueTransitionClearableField = (typeof QUEUE_TRANSITION_CLEARABLE_FIELDS)[number];

export type QueueTransitionPatch = {
  last_error?: string;
  provider_error_code?: string;
  provider_error_category?: ProviderErrorCategory | 'PERMANENT' | 'DETERMINISTIC_SKIP';
  attempt_count?: number;
  retry_count?: number;
  next_retry_at?: string;
  uploaded_at?: string;
  claimed_at?: string;
  provider_request_id?: string;
  provider_ref?: string;
  clear_fields?: QueueTransitionClearableField[];
};

export type QueueSnapshotUpdatePayload = {
  status: QueueStatus;
  updated_at?: string;
  last_error?: string | null;
  provider_error_code?: string | null;
  provider_error_category?: QueueTransitionPatch['provider_error_category'] | null;
  attempt_count?: number | null;
  retry_count?: number | null;
  next_retry_at?: string | null;
  uploaded_at?: string | null;
  claimed_at?: string | null;
  provider_request_id?: string | null;
  provider_ref?: string | null;
};

export type QueueTransitionInsert = {
  queue_id: string;
  new_status: QueueStatus;
  error_payload: Record<string, unknown> | null;
  actor: QueueTransitionActor;
  created_at?: string;
};

function pushPatchValue(payload: Record<string, unknown>, patch: QueueTransitionPatch, key: keyof QueueTransitionPatch): void {
  const value = patch[key];
  if (value !== undefined && value !== null && key !== 'clear_fields') {
    payload[key] = value;
  }
}

export function buildQueueTransitionErrorPayload(patch: QueueTransitionPatch = {}): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};

  pushPatchValue(payload, patch, 'last_error');
  pushPatchValue(payload, patch, 'provider_error_code');
  pushPatchValue(payload, patch, 'provider_error_category');
  pushPatchValue(payload, patch, 'attempt_count');
  pushPatchValue(payload, patch, 'retry_count');
  pushPatchValue(payload, patch, 'next_retry_at');
  pushPatchValue(payload, patch, 'uploaded_at');
  pushPatchValue(payload, patch, 'claimed_at');
  pushPatchValue(payload, patch, 'provider_request_id');
  pushPatchValue(payload, patch, 'provider_ref');

  const clearFields = Array.from(new Set((patch.clear_fields ?? []).filter(Boolean)));
  if (clearFields.length > 0) {
    payload.clear_fields = clearFields;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

export function queueSnapshotPayloadToTransition(
  queueId: string,
  payload: QueueSnapshotUpdatePayload,
  actor: QueueTransitionActor
): QueueTransitionInsert {
  const clearFields: QueueTransitionClearableField[] = [];

  const maybeClear = (field: QueueTransitionClearableField, value: unknown): void => {
    if (value === null) clearFields.push(field);
  };

  maybeClear('last_error', payload.last_error);
  maybeClear('provider_error_code', payload.provider_error_code);
  maybeClear('provider_error_category', payload.provider_error_category);
  maybeClear('next_retry_at', payload.next_retry_at);
  maybeClear('uploaded_at', payload.uploaded_at);
  maybeClear('claimed_at', payload.claimed_at);
  maybeClear('provider_request_id', payload.provider_request_id);
  maybeClear('provider_ref', payload.provider_ref);

  return {
    queue_id: queueId,
    new_status: payload.status,
    actor,
    created_at: payload.updated_at,
    error_payload: buildQueueTransitionErrorPayload({
      last_error: payload.last_error ?? undefined,
      provider_error_code: payload.provider_error_code ?? undefined,
      provider_error_category: payload.provider_error_category ?? undefined,
      attempt_count: payload.attempt_count ?? undefined,
      retry_count: payload.retry_count ?? undefined,
      next_retry_at: payload.next_retry_at ?? undefined,
      uploaded_at: payload.uploaded_at ?? undefined,
      claimed_at: payload.claimed_at ?? undefined,
      provider_request_id: payload.provider_request_id ?? undefined,
      provider_ref: payload.provider_ref ?? undefined,
      clear_fields: clearFields,
    }),
  };
}

export async function insertQueueTransitions(
  client: SupabaseClient,
  transitions: QueueTransitionInsert[],
  chunkSize = 500
): Promise<number> {
  if (transitions.length === 0) return 0;

  let inserted = 0;
  for (const chunk of chunkArray(transitions, chunkSize)) {
    const { data, error } = await client
      .from('oci_queue_transitions')
      .insert(chunk)
      .select('id');

    if (error) {
      throw error;
    }

    inserted += Array.isArray(data) ? data.length : chunk.length;
  }

  return inserted;
}
