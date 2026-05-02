/**
 * Single resolver for marketing_signals export economics (§0b four-conversions plan).
 * Upper-funnel rows must not rely on export-runtime NOW() for business time — see occurred-at +
 * conversion_time_source stamped at insert.
 *
 * **`loadMarketingSignalEconomics`** is the single async entry (one `sites.currency` read).
 * **`resolveMarketingSignalEconomics`** is pure (tests + callers that already know currency).
 */

import type { PipelineStage } from '@/lib/domain/mizan-mantik/types';
import type { OptimizationValueSnapshot } from '@/lib/oci/optimization-contract';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import { toExpectedValueCents } from '@/lib/oci/marketing-signal-hash';
import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';

/** Provenance for expected_value_cents / conversion_value at insert. */
export type MarketingSignalValueSource = 'stage_model' | 'fixed_junk_exclusion';

export type MarketingSignalConversionTimeSource = 'ledger_stage_event';

export interface MarketingSignalEconomics {
  expectedValueCents: number;
  /** Major units for conversion_value / optimization_value display fields on the row. */
  conversionValueMajor: number;
  valueSource: MarketingSignalValueSource;
  conversionTimeSource: MarketingSignalConversionTimeSource;
  currencyCode: string;
}

const JUNK_NOMINAL_CENTS = 10;
const JUNK_NOMINAL_MAJOR = 0.1;

/**
 * Resolves cents, currency, and provenance. Junk uses fixed 10¢ nominal (0.10 major) per product rule.
 */
export function resolveMarketingSignalEconomics(params: {
  stage: Exclude<PipelineStage, 'won'>;
  snapshot: OptimizationValueSnapshot;
  siteCurrency: string | null | undefined;
}): MarketingSignalEconomics {
  const currencyCode = normalizeCurrencyOrNeutral(params.siteCurrency);
  if (params.stage === 'junk') {
    return {
      expectedValueCents: JUNK_NOMINAL_CENTS,
      conversionValueMajor: JUNK_NOMINAL_MAJOR,
      valueSource: 'fixed_junk_exclusion',
      conversionTimeSource: 'ledger_stage_event',
      currencyCode,
    };
  }
  return {
    expectedValueCents: toExpectedValueCents(params.snapshot.optimizationValue),
    conversionValueMajor: params.snapshot.optimizationValue,
    valueSource: 'stage_model',
    conversionTimeSource: 'ledger_stage_event',
    currencyCode,
  };
}

/**
 * Canonical async load: reads `sites.currency` once then resolves economics.
 */
export async function loadMarketingSignalEconomics(params: {
  siteId: string;
  stage: Exclude<PipelineStage, 'won'>;
  snapshot: OptimizationValueSnapshot;
}): Promise<MarketingSignalEconomics> {
  const { data: siteRow } = await adminClient
    .from('sites')
    .select('currency')
    .eq('id', params.siteId)
    .maybeSingle();

  if (!siteRow) {
    logWarn('MARKETING_SIGNAL_SITE_ROW_MISSING_FOR_CURRENCY', {
      site_id: params.siteId,
      stage: params.stage,
    });
  }

  return resolveMarketingSignalEconomics({
    stage: params.stage,
    snapshot: params.snapshot,
    siteCurrency: (siteRow as { currency?: string | null } | null)?.currency,
  });
}
