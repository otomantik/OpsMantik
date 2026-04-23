/**
 * Deterministik Geo Truth: upsertSessionGeo
 * ADS geo > IP geo. Rome/Amsterdam ghost karantina.
 */

import { adminClient } from '@/lib/supabase/admin';
import type { GeoDecisionReasonCode } from '@/lib/geo/decision-engine';

const GHOST_GEO_CITIES = new Set([
  'rome', 'amsterdam', 'roma',
  'düsseldorf', 'dusseldorf', 'ashburn', 'frankfurt', 'london',
]);

export type GeoSource = 'ADS' | 'IP' | 'OPERATOR' | 'UNKNOWN';

export interface UpsertSessionGeoParams {
  siteId: string;
  sessionId: string;
  sessionMonth: string;
  city?: string | null;
  district?: string | null;
  source: GeoSource;
  reasonCode?: GeoDecisionReasonCode | null;
  confidence?: number | null;
}

/**
 * Upsert session geo. Deterministik overwrite policy:
 * - ADS: her zaman yazar
 * - IP: sadece geo_source != 'ADS' ise; Rome/Amsterdam → UNKNOWN, city/district saklanmaz
 */
export async function upsertSessionGeo(params: UpsertSessionGeoParams): Promise<void> {
  const { siteId, sessionId, sessionMonth, city, district, source, reasonCode, confidence } = params;

  const cityNorm = (city || '').toString().trim().toLowerCase();
  const districtNorm = (district || '').toString().trim().toLowerCase();
  const isGhost = GHOST_GEO_CITIES.has(cityNorm) || GHOST_GEO_CITIES.has(districtNorm);

  if (source === 'IP' || source === 'UNKNOWN') {
    const { data: existing } = await adminClient
      .from('sessions')
      .select('geo_source')
      .eq('id', sessionId)
      .eq('site_id', siteId)
      .eq('created_month', sessionMonth)
      .maybeSingle();

    if ((existing as { geo_source?: string } | null)?.geo_source === 'ADS') {
      return; // Don't overwrite ADS with IP
    }
  }

  let effectiveSource: GeoSource = source;
  let effectiveCity: string | null = city?.trim() || null;
  let effectiveDistrict: string | null = district?.trim() || null;

  if (source === 'IP' && isGhost) {
    effectiveSource = 'UNKNOWN';
    effectiveCity = null;
    effectiveDistrict = null;
  }

  // Sentinel 'Unknown' must map to NULL in DB so reports never show literal "Unknown" as city
  if (effectiveCity?.toLowerCase() === 'unknown') effectiveCity = null;
  if (effectiveDistrict?.toLowerCase() === 'unknown') effectiveDistrict = null;

  const updates: Record<string, unknown> = {
    geo_source: effectiveSource,
    geo_updated_at: new Date().toISOString(),
    geo_city: effectiveCity,
    geo_district: effectiveDistrict,
    geo_reason_code: reasonCode ?? null,
    geo_confidence:
      typeof confidence === 'number' && Number.isFinite(confidence)
        ? Math.max(0, Math.min(100, Math.round(confidence)))
        : null,
  };

  let { error } = await adminClient
    .from('sessions')
    .update(updates)
    .eq('id', sessionId)
    .eq('site_id', siteId)
    .eq('created_month', sessionMonth);

  // Backward-compat for environments where geo_reason_code / geo_confidence
  // migration has not landed yet.
  if (
    error &&
    ((error.code === '42703' || error.code === 'PGRST204') &&
      ((error.message || '').includes('geo_reason_code') || (error.message || '').includes('geo_confidence')))
  ) {
    const fallbackUpdates: Record<string, unknown> = {
      geo_source: updates.geo_source,
      geo_updated_at: updates.geo_updated_at,
      geo_city: updates.geo_city,
      geo_district: updates.geo_district,
    };
    const fallback = await adminClient
      .from('sessions')
      .update(fallbackUpdates)
      .eq('id', sessionId)
      .eq('site_id', siteId)
      .eq('created_month', sessionMonth);
    error = fallback.error;
  }

  if (error) throw error;
}
