export type TimelineSourceKind = 'event' | 'ledger';

export interface SessionTimelineItem {
  id: string;
  created_at: string;
  event_category: string;
  event_action: string;
  event_label: string | null;
  url: string | null;
  metadata: Record<string, unknown>;
  source_kind: TimelineSourceKind;
  ledger_action_type: string | null;
}
