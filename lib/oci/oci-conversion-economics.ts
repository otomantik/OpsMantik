/**
 * OCI journal conversion economics (`offline_conversion_queue` value fields).
 * Upper-funnel rows must not rely on export-runtime NOW() for business time — see occurred-at +
 * conversion_time_source stamped at insert.
 */

import type { PipelineStage } from '@/lib/oci/signal-types';
import type { OptimizationValueSnapshot } from '@/lib/oci/optimization-contract';
import { normalizeCurrencyOrNeutral } from '@/lib/i18n/site-locale';
import { adminClient } from '@/lib/supabase/admin';
import { logWarn } from '@/lib/logging/logger';
import { OPSMANTIK_CONVERSION_NAMES } from '@/lib/oci/conversion-names';

export const CONVERSION_VALUE_POLICY_VERSION = 'oci_conversion_value_policy_v1';

export type OciConversionValueSource =
  | 'stage_model'
  | 'fixed_junk_exclusion'
  | 'won_stage_model_fallback'
  | 'won_stage_model_with_actual_revenue';

export type OciConversionTimeSource = 'ledger_stage_event';

export interface OciConversionEconomics {
  expectedValueCents: number;
  conversionValueMajor: number;
  conversionName: string;
  valueSource: OciConversionValueSource;
  conversionTimeSource: OciConversionTimeSource;
  currencyCode: string;
  policyVersion: string;
  policyReason: string;
  fallbackAllowed: boolean;
  fallbackUsed: boolean;
  actualRevenueRequired: boolean;
}

const JUNK_NOMINAL_CENTS = 10;
const JUNK_NOMINAL_MAJOR = 0.1;

export function toExpectedValueCents(optimizationValue: number): number {
  return Math.max(Math.round(optimizationValue * 100), 1);
}

export function resolveOciConversionEconomics(params: {
  stage: Exclude<PipelineStage, 'won'>;
  snapshot: OptimizationValueSnapshot;
  siteCurrency: string | null | undefined;
}): OciConversionEconomics {
  const currencyCode = normalizeCurrencyOrNeutral(params.siteCurrency);
  if (params.stage === 'junk') {
    return {
      expectedValueCents: JUNK_NOMINAL_CENTS,
      conversionValueMajor: JUNK_NOMINAL_MAJOR,
      conversionName: OPSMANTIK_CONVERSION_NAMES.junk,
      valueSource: 'fixed_junk_exclusion',
      conversionTimeSource: 'ledger_stage_event',
      currencyCode,
      policyVersion: CONVERSION_VALUE_POLICY_VERSION,
      policyReason: 'junk_exclusion_nominal_fixed_10c',
      fallbackAllowed: false,
      fallbackUsed: false,
      actualRevenueRequired: false,
    };
  }
  return {
    expectedValueCents: toExpectedValueCents(params.snapshot.optimizationValue),
    conversionValueMajor: params.snapshot.optimizationValue,
    conversionName: OPSMANTIK_CONVERSION_NAMES[params.stage],
    valueSource: 'stage_model',
    conversionTimeSource: 'ledger_stage_event',
    currencyCode,
    policyVersion: CONVERSION_VALUE_POLICY_VERSION,
    policyReason: `stage_model_${params.stage}`,
    fallbackAllowed: false,
    fallbackUsed: false,
    actualRevenueRequired: false,
  };
}

export function resolveWonConversionEconomics(params: {
  snapshot: OptimizationValueSnapshot;
  siteCurrency: string | null | undefined;
}): OciConversionEconomics {
  const currencyCode = normalizeCurrencyOrNeutral(params.siteCurrency);
  const hasActualRevenue =
    params.snapshot.actualRevenue != null &&
    Number.isFinite(params.snapshot.actualRevenue) &&
    params.snapshot.actualRevenue > 0;
  return {
    expectedValueCents: toExpectedValueCents(params.snapshot.optimizationValue),
    conversionValueMajor: params.snapshot.optimizationValue,
    conversionName: OPSMANTIK_CONVERSION_NAMES.won,
    valueSource: hasActualRevenue ? 'won_stage_model_with_actual_revenue' : 'won_stage_model_fallback',
    conversionTimeSource: 'ledger_stage_event',
    currencyCode,
    policyVersion: CONVERSION_VALUE_POLICY_VERSION,
    policyReason: hasActualRevenue ? 'won_stage_model_actual_revenue_present' : 'won_stage_model_actual_revenue_missing',
    fallbackAllowed: true,
    fallbackUsed: !hasActualRevenue,
    actualRevenueRequired: false,
  };
}

export async function loadOciConversionEconomics(params: {
  siteId: string;
  stage: Exclude<PipelineStage, 'won'>;
  snapshot: OptimizationValueSnapshot;
}): Promise<OciConversionEconomics> {
  const { data: siteRow } = await adminClient
    .from('sites')
    .select('currency')
    .eq('id', params.siteId)
    .maybeSingle();

  if (!siteRow) {
    logWarn('OCI_CONVERSION_SITE_ROW_MISSING_FOR_CURRENCY', {
      site_id: params.siteId,
      stage: params.stage,
    });
  }

  return resolveOciConversionEconomics({
    stage: params.stage,
    snapshot: params.snapshot,
    siteCurrency: (siteRow as { currency?: string | null } | null)?.currency,
  });
}
