/**
 * PipelineService — Dynamic Sector Playbooks (Tier 1/2/3 funnel stages).
 *
 * Processes an operator's click on any dynamic funnel stage (e.g., 'sealed', 'junk', 'photo_received')
 * and queues it for Google Ads OCI using synthetic values from sites.pipeline_stages.
 */

import { adminClient } from '@/lib/supabase/admin';
import { PipelineStage } from '@/lib/types/database';
import { getPrimarySource } from '@/lib/conversation/primary-source';
import { hasMarketingConsentForCall } from '@/lib/gdpr/consent-check';

export interface ProcessStageActionResult {
  success: boolean;
  oci_enqueued: boolean;
  reason?: 'junk_or_zero_value' | 'no_click_id' | 'duplicate' | 'marketing_consent_required';
  stage?: string;
  value?: number;
}

export class PipelineService {
  /**
   * Processes a dynamic stage action triggered by an operator in the War Room.
   */
  static async processStageAction(
    siteId: string,
    callId: string,
    stageId: string,
    customAmountCents?: number
  ): Promise<ProcessStageActionResult> {
    // 1. Fetch the site's dynamic playbook (pipeline_stages) and config for currency
    const { data: site, error: siteErr } = await adminClient
      .from('sites')
      .select('pipeline_stages, config')
      .eq('id', siteId)
      .single();

    if (siteErr || !site) {
      throw new Error(`Site not found or DB error: ${siteErr?.message}`);
    }

    const stages: PipelineStage[] = (site.pipeline_stages || []) as PipelineStage[];
    const stage = stages.find((s) => s.id === stageId);

    if (!stage) {
      throw new Error(`Stage '${stageId}' is not defined in the site's playbook.`);
    }

    // 2. Determine the conversion value
    const finalValueCents = customAmountCents ?? stage.value_cents;

    // 3. Update the `calls` table with the new dynamic status
    const isJunk = stage.id === 'junk';
    const newOciStatus = isJunk ? 'skipped' : 'sealed';

    const { error: updateErr } = await adminClient
      .from('calls')
      .update({
        status: stage.id,
        oci_status: newOciStatus,
        oci_status_updated_at: new Date().toISOString(),
        sale_amount: finalValueCents > 0 ? finalValueCents / 100 : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', callId)
      .eq('site_id', siteId);

    if (updateErr) {
      throw new Error(`Failed to update call: ${updateErr.message}`);
    }

    // 4. If it's Junk or value is 0, we STOP here. Do not send to Google Ads OCI.
    if (isJunk || finalValueCents === 0) {
      return { success: true, oci_enqueued: false, reason: 'junk_or_zero_value' };
    }

    // 5. Fetch Click IDs (GCLID, WBRAID, GBRAID) from the session
    const source = await getPrimarySource(siteId, { callId });
    const gclid = source?.gclid?.trim() || null;
    const wbraid = source?.wbraid?.trim() || null;
    const gbraid = source?.gbraid?.trim() || null;

    if (!gclid && !wbraid && !gbraid) {
      return { success: true, oci_enqueued: false, reason: 'no_click_id' };
    }

    const hasMarketing = await hasMarketingConsentForCall(siteId, callId);
    if (!hasMarketing) {
      return { success: true, oci_enqueued: false, reason: 'marketing_consent_required' };
    }

    // 6. Resolve currency from site config
    const config = (site.config || {}) as { currency?: string };
    const currency = config.currency?.trim() || 'TRY';

    // 7. Enqueue to Google Ads OCI with the synthetic or custom value
    const { error: ociErr } = await adminClient.from('offline_conversion_queue').insert({
      site_id: siteId,
      call_id: callId,
      sale_id: null,
      provider_key: 'google_ads',
      action: stage.id,
      gclid,
      wbraid,
      gbraid,
      conversion_time: new Date().toISOString(),
      value_cents: finalValueCents,
      currency,
      status: 'QUEUED',
    });

    if (ociErr) {
      if (ociErr.code === '23505') {
        return { success: true, oci_enqueued: false, reason: 'duplicate' };
      }
      throw new Error(`Failed to enqueue OCI: ${ociErr.message}`);
    }

    return {
      success: true,
      oci_enqueued: true,
      stage: stage.label,
      value: finalValueCents,
    };
  }
}
