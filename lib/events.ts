/**
 * Event Normalization Utility
 * 
 * Extracts event data from Supabase JOIN response structure.
 * Used by Live Feed to normalize nested JOIN results.
 */

export interface Event {
  id: string;
  session_id: string;
  session_month: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  event_value: number | null;
  metadata: any;
  created_at: string;
  url?: string;
}

/**
 * Normalize event data from Supabase JOIN structure.
 * 
 * Supabase JOIN queries return nested structures like:
 * { id: '...', session_id: '...', sessions: { site_id: '...' }, url: '...' }
 * 
 * This function extracts the flat Event interface.
 * 
 * @param item - Raw event data from Supabase JOIN query
 * @returns Normalized Event object
 */
export function normalizeEvent(item: any): Event {
  return {
    id: item.id,
    session_id: item.session_id,
    session_month: item.session_month,
    event_category: item.event_category,
    event_action: item.event_action,
    event_label: item.event_label,
    event_value: item.event_value,
    metadata: item.metadata,
    created_at: item.created_at,
    url: item.url,
  };
}
