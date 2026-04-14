/**
 * API Route: Universal Gear Shift
 * 
 * Target: /api/intents/[id]/stage
 * Body: { gear_id: string, phone_hash?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logError, logWarn } from '@/lib/logging/logger';
import { hasCapability } from '@/lib/auth/rbac';
import { buildMinimalCausalDna } from '@/lib/domain/mizan-mantik/causal-dna';
import type { PipelineStage } from '@/lib/types/database';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const route = '/api/intents/[id]/stage';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { gear_id, phone } = body;
    const { id: callId } = await params;

    if (!gear_id) {
      return NextResponse.json({ error: 'gear_id is required' }, { status: 400 });
    }

    const { data: call, error: callError } = await adminClient
      .from('calls')
      .select('id, site_id, matched_session_id')
      .eq('id', callId)
      .single();

    if (callError || !call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 });
    }

    const siteId = call.site_id;
    const access = await validateSiteAccess(siteId, user.id, supabase);
    if (!access.allowed || !access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { data: site } = await adminClient
      .from('sites')
      .select('pipeline_stages, oci_config, default_aov, currency')
      .eq('id', siteId)
      .single();

    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });

    const pipelineStages = (site.pipeline_stages || []) as PipelineStage[];
    const stage = pipelineStages.find(s => s.id === gear_id);

    if (!stage) {
      return NextResponse.json({ error: 'Invalid gear_id for this site' }, { status: 400 });
    }

    if (stage.action === 'discard' || stage.id === 'g_trash' || stage.id === 'junk') {
      await adminClient.rpc('apply_call_action_v1', {
        p_call_id: callId,
        p_action_type: 'junk',
        p_actor_type: 'system',
        p_actor_id: user.id,
        p_metadata: { route, request_id: requestId, user_id: user.id },
      });
      return NextResponse.json({ success: true, discarded: true });
    }

    // Hash phone if provided
    let phoneHash: string | null = null;
    if (phone && phone.trim()) {
      const normalizedPhone = phone.replace(/[^\d+]/g, '');
      phoneHash = crypto.createHash('sha256').update(normalizedPhone).digest('hex');
      
      // Update the call with the phone hash
      await adminClient.from('calls').update({ caller_phone_hash_sha256: phoneHash }).eq('id', callId);
    }

    const baseValueTry = (site.oci_config as Record<string, unknown>)?.base_deal_value_try as number || site.default_aov || 1000;
    const multiplier = typeof stage.multiplier === 'number' ? stage.multiplier : (stage.value_cents ? stage.value_cents / 100 / baseValueTry : 0.05);
    const valueCents = Math.round(baseValueTry * multiplier * 100);
    const currencySafe = site.currency || 'TRY';

    // The Unique OCI Deduplication ID incorporating gear_id
    const sessionId = call.matched_session_id;
    const externalId = `google_ads:${gear_id}:${callId}:${sessionId || 'no-session'}`;

    // Mark call as confirmed locally
    await adminClient.rpc('apply_call_action_v1', {
      p_call_id: callId,
      p_action_type: 'confirm',
      p_payload: { status: gear_id },
      p_actor_type: 'system',
      p_actor_id: user.id,
      p_metadata: { route, gear_id },
    });

    const nowIso = new Date().toISOString();

    const causalDna = buildMinimalCausalDna(
      'UNIVERSAL_GEAR_SHIFT',
      ['usage'],
      stage.label,
      { baseValueTry, multiplier },
      { valueCents, currency: currencySafe }
    );

    const { data: qResult, error: insertError } = await adminClient
      .from('offline_conversion_queue')
      .insert({
        site_id: siteId,
        call_id: callId,
        session_id: sessionId,
        provider_key: 'google_ads',
        external_id: externalId,
        conversion_time: nowIso,
        occurred_at: nowIso,
        value_cents: valueCents,
        currency: currencySafe,
        status: 'QUEUED',
        causal_dna: causalDna,
        entropy_score: 0,
        uncertainty_bit: false,
      })
      .select('id')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
         // It's a duplicate for EXACTLY this gear on this call. Just return 200.
         return NextResponse.json({ success: true, duplicate: true });
      }
      logWarn('gear_shift_oci_failed', { callId, gear_id, error: insertError.message });
      return NextResponse.json({ error: 'Failed to enqueue OCI' }, { status: 500 });
    }

    // Fast-track the worker to process it immediately without waiting for cron
    if (qResult && qResult.id) {
       try {
         const { publishToQStash } = await import('@/lib/ingest/publish');
         await publishToQStash({ lane: 'conversion', deduplicationId: `oci_export_${qResult.id}`, body: { kind: 'oci_export', queue_id: qResult.id } });
       } catch (err) {
         logWarn('gear_shift_fast_track_failed', { queue_id: qResult.id, error: err });
       }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
