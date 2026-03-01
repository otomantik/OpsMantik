/**
 * Deterministik Geo Truth: upsertSessionGeo
 * ADS geo > IP geo. Rome/Amsterdam ghost karantina.
 */

import { adminClient } from '@/lib/supabase/admin';

const GHOST_GEO_CITIES = new Set(['rome', 'amsterdam', 'roma']);

export type GeoSource = 'ADS' | 'IP' | 'OPERATOR' | 'UNKNOWN';

export interface UpsertSessionGeoParams {
  siteId: string;
  sessionId: string;
  sessionMonth: string;
  city?: string | null;
  district?: string | null;
  source: GeoSource;
}

/**
 * Upsert session geo. Deterministik overwrite policy:
 * - ADS: her zaman yazar
 * - IP: sadece geo_source != 'ADS' ise; Rome/Amsterdam → UNKNOWN, city/district saklanmaz
 */
export async function upsertSessionGeo(params: UpsertSessionGeoParams): Promise<void> {
  const { siteId, sessionId, sessionMonth, city, district, source } = params;

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

  const updates: Record<string, unknown> = {
    geo_source: effectiveSource,
    geo_updated_at: new Date().toISOString(),
    geo_city: effectiveCity,
    geo_district: effectiveDistrict,
  };

  const { error } = await adminClient
    .from('sessions')
    .update(updates)
    .eq('id', sessionId)
    .eq('site_id', siteId)
    .eq('created_month', sessionMonth);

  if (error) throw error;
}
