/**
 * Types for call-event API (lead score, call record, insert error).
 * Used by /api/call-event and /api/call-event/v2.
 */

import type { PostgrestError } from '@supabase/supabase-js';

/** Lead score breakdown returned when matching a session. */
export interface ScoreBreakdown {
  conversionPoints: number;
  interactionPoints: number;
  bonuses: number;
  cappedAt100: boolean;
  rawScore: number;
  finalScore: number;
}

/** Event metadata from events table (e.g. lead_score). */
export interface EventMetadata {
  lead_score?: number | string | null;
  [key: string]: unknown;
}

/** Row from calls table (select after insert). */
export interface CallRecord {
  id: string;
  matched_session_id?: string | null;
  lead_score?: number | null;
  [key: string]: unknown;
}

/** Supabase insert/select error; use PostgrestError from SDK. */
export type CallInsertError = PostgrestError | null;
