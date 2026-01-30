'use client';

import { IntentCard, type IntentCardData } from './cards/IntentCard';

export interface IntentForQualification {
  id: string;
  created_at: string;
  intent_action: 'phone' | 'whatsapp' | 'form' | string | null;
  intent_target: string | null;
  intent_page_url: string | null;
  matched_session_id: string | null;
  lead_score: number | null;
  status: string | null;
  click_id: string | null;
  // P0: explainability + OCI feedback loop / evidence
  risk_level?: 'low' | 'high' | string | null;
  risk_reasons?: string[] | null;
  oci_stage?: 'pending' | 'sealed' | 'uploaded' | 'matched' | string | null;
  oci_status?: string | null;
  city?: string | null;
  district?: string | null;
  device_type?: string | null;
  ads_network?: string | null;
  ads_placement?: string | null;
  total_duration_sec?: number | null;
  event_count?: number | null;
  attribution_source?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  // Hunter AI (from session)
  ai_score?: number | null;
  ai_summary?: string | null;
  ai_tags?: string[] | null;
}

interface IntentQualificationCardProps {
  siteId: string;
  intent: IntentForQualification;
  onQualified?: () => void;  // Callback after successful qualification
  onOpenSession?: (intent: IntentForQualification) => void;  // Open session drawer
}

export function IntentQualificationCard({
  siteId,
  intent,
  onQualified,
  onOpenSession,
}: IntentQualificationCardProps) {
  const data: IntentCardData = intent;
  return (
    <IntentCard
      siteId={siteId}
      intent={data}
      onSkip={() => {
        // Parent manages skip behavior (stack)
      }}
      onQualified={() => onQualified?.()}
      onOpenSession={() => onOpenSession?.(intent)}
    />
  );
}
