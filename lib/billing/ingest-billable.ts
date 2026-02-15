import type { ValidIngestPayload } from '@/lib/types/ingest';

export type BillableDecision =
  | { billable: true; reason: 'conversion' | 'interaction_view' | 'default_billable' }
  | { billable: false; reason: 'system' | 'scroll_depth' };

/**
 * "Karma" billing model:
 * - billable: conversion/*, interaction/view
 * - non-billable: system/* (heartbeat/session_end), interaction/scroll_depth
 * - default: billable (back-compat; prevents silently dropping new event types from billing)
 */
export function classifyIngestBillable(payload: ValidIngestPayload): BillableDecision {
  const p = payload as Record<string, unknown>;
  const ec = typeof p.ec === 'string' ? p.ec : '';
  const ea = typeof p.ea === 'string' ? p.ea : '';

  if (ec === 'conversion') return { billable: true, reason: 'conversion' };
  if (ec === 'interaction' && ea === 'view') return { billable: true, reason: 'interaction_view' };
  if (ec === 'interaction' && ea === 'scroll_depth') return { billable: false, reason: 'scroll_depth' };
  if (ec === 'system') return { billable: false, reason: 'system' };

  return { billable: true, reason: 'default_billable' };
}

