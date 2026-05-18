import { computeAttribution, type AttributionInput, type AttributionResult } from '@/lib/attribution';
import {
  determineTrafficSource,
  type TrafficClassification,
} from '@/lib/analytics/source-classifier';
import { classifyTraffic } from './truth-engine-core';
import type { PreviousSessionContext, TrafficClassificationV2, TrafficChannel } from './truth-engine-types';
import { loadPreviousSessionContext } from './temporal-context';

export type SourceTruthShadowInput = {
  site_id: string;
  url: string;
  referrer: string | null;
  user_agent: string;
  fingerprint?: string | null;
  exclude_session_id?: string | null;
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  utm?: AttributionInput['utm'];
  has_past_valid_click_id?: boolean;
  /** When true, skip DB temporal lookup (tests). */
  previous_session_override?: PreviousSessionContext;
};

export type SourceTruthShadowDrift = {
  is_paid_mismatch: boolean;
  channel_mismatch: boolean;
  attribution_vs_v2_paid_delta: boolean;
};

export type SourceTruthShadowResult = {
  legacy: {
    attribution: AttributionResult;
    traffic: TrafficClassification;
  };
  v2: TrafficClassificationV2;
  drift: SourceTruthShadowDrift;
};

function legacyChannelHint(traffic: TrafficClassification, attribution: AttributionResult): TrafficChannel {
  if (attribution.isPaid && traffic.traffic_source === 'Google Ads') return 'paid_search';
  if (attribution.isPaid) return 'paid_social';
  const ts = (traffic.traffic_source ?? '').toLowerCase();
  if (ts.includes('maps')) return 'local_maps';
  if (ts === 'seo') return 'organic_search';
  if (ts === 'direct') return 'direct';
  if (traffic.traffic_medium === 'social') return 'organic_social';
  return 'unknown';
}

function channelMismatch(v2: TrafficChannel, legacyHint: TrafficChannel): boolean {
  if (v2 === legacyHint) return false;
  if (v2 === 'paid_search' && legacyHint === 'paid_social' && legacyHint) return true;
  if (v2 === 'organic_search' && legacyHint === 'local_maps') return true;
  if (v2 === 'local_maps' && legacyHint === 'organic_search') return true;
  return v2 !== legacyHint;
}

export async function evaluateSourceTruthShadow(
  input: SourceTruthShadowInput
): Promise<SourceTruthShadowResult> {
  const params = {
    utm_source: input.utm?.source ?? null,
    utm_medium: input.utm?.medium ?? null,
    gclid: input.gclid ?? null,
    wbraid: input.wbraid ?? null,
    gbraid: input.gbraid ?? null,
  };

  const attribution = computeAttribution({
    gclid: input.gclid ?? null,
    utm: input.utm ?? null,
    referrer: input.referrer ?? null,
    fingerprint: input.fingerprint ?? null,
    hasPastGclid: input.has_past_valid_click_id ?? false,
  });

  const traffic = determineTrafficSource(input.url, input.referrer ?? '', params);

  const previousSession =
    input.previous_session_override ??
    (await loadPreviousSessionContext({
      siteId: input.site_id,
      fingerprint: input.fingerprint,
      excludeSessionId: input.exclude_session_id,
    }));

  const v2 = classifyTraffic(
    input.url,
    input.referrer ?? '',
    input.user_agent ?? '',
    previousSession
  );

  const legacyHint = legacyChannelHint(traffic, attribution);
  const drift: SourceTruthShadowDrift = {
    is_paid_mismatch: attribution.isPaid !== v2.is_paid,
    channel_mismatch: channelMismatch(v2.channel, legacyHint),
    attribution_vs_v2_paid_delta: attribution.isPaid !== v2.is_paid,
  };

  return { legacy: { attribution, traffic }, v2, drift };
}
