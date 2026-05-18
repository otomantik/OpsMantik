import type { TrafficChannel, TrafficClassificationV2 } from './truth-engine-types';

/** Legacy projection for panel / RPC compat. */
export function projectLegacyTrafficFields(
  channel: TrafficChannel,
  is_paid: boolean
): { traffic_source: string; traffic_medium: string } {
  switch (channel) {
    case 'paid_search':
      return { traffic_source: 'Google Ads', traffic_medium: 'cpc' };
    case 'paid_social':
      return { traffic_source: 'Paid Social', traffic_medium: 'cpc' };
    case 'organic_shopping':
      return { traffic_source: 'Google Shopping', traffic_medium: 'organic' };
    case 'local_maps':
      return { traffic_source: 'Google Maps', traffic_medium: 'maps' };
    case 'dark_social':
      return { traffic_source: 'Dark Social', traffic_medium: 'social' };
    case 'dark_return':
      return { traffic_source: 'Google Ads', traffic_medium: 'cpc' };
    case 'ai_referral':
      return { traffic_source: 'AI Research', traffic_medium: 'ai' };
    case 'email':
      return { traffic_source: 'Email', traffic_medium: 'email' };
    case 'organic_search':
      return { traffic_source: 'SEO', traffic_medium: 'organic' };
    case 'organic_social':
      return { traffic_source: 'Social', traffic_medium: 'social' };
    case 'referral':
      return { traffic_source: 'Referral', traffic_medium: 'referral' };
    case 'fraudulent_signal':
      return { traffic_source: 'Fraudulent', traffic_medium: 'invalid' };
    case 'direct':
      return { traffic_source: 'Direct', traffic_medium: 'direct' };
    case 'unknown':
    default:
      return { traffic_source: 'Unknown', traffic_medium: is_paid ? 'cpc' : 'unknown' };
  }
}

export function applyLegacyProjection(v: TrafficClassificationV2): TrafficClassificationV2 {
  const legacy = projectLegacyTrafficFields(v.channel, v.is_paid);
  return {
    ...v,
    traffic_source: legacy.traffic_source,
    traffic_medium: legacy.traffic_medium,
  };
}
