/**
 * Conversion Truth OS — Source Truth Engine ledger types (v2).
 */

export type TrafficChannel =
  | 'paid_search'
  | 'paid_social'
  | 'organic_search'
  | 'organic_shopping'
  | 'local_maps'
  | 'organic_social'
  | 'referral'
  | 'ai_referral'
  | 'email'
  | 'dark_social'
  | 'dark_return'
  | 'fraudulent_signal'
  | 'direct'
  | 'unknown';

export type IdentityGrade =
  | 'click_id_strong'
  | 'click_id_ios'
  | 'click_id_assisted'
  | 'utm_only'
  | 'referrer_only'
  | 'direct_unknown';

export type ConfidenceLabel = 'certain' | 'strong' | 'medium' | 'weak' | 'unknown';

export interface TrafficClassificationV2 {
  traffic_source: string;
  traffic_medium: string;
  channel: TrafficChannel;
  is_paid: boolean;
  classifier_version: 'source_truth_v2';
  reason_code: string;
  confidence_score: number;
  confidence_label: ConfidenceLabel;
  selected_evidence: string[];
  ignored_evidence: string[];
  contradiction_reasons: string[];
  contradiction_score: number;
  decision_trace: string[];
  signal_entropy_score: number;
  is_fraud_suspected: boolean;
  identity_grade: IdentityGrade;
  primary_credit: number;
  assist_channels: TrafficChannel[];
}

export type PreviousSessionContext = {
  channel: TrafficChannel;
  timestamp: number;
};
