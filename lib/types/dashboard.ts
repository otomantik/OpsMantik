/**
 * Shared dashboard intent type (used by LazySessionDrawer / QualificationQueue).
 */
export type LiveInboxIntent = {
  id: string;
  created_at: string;
  intent_action: 'phone' | 'whatsapp' | string | null;
  intent_target: string | null;
  intent_stamp: string | null;
  intent_page_url: string | null;
  matched_session_id: string | null;
  lead_score: number | null;
  status: string | null;
  click_id: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
};
