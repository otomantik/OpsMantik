/**
 * POST /api/oci/adjustments — Conversion Adjustment Pipeline
 *
 * Modül 1: Dönüşüm Düzeltmeleri (Restate & Retract)
 *
 * Creates a RETRACTION or RESTATEMENT record for a previously exported canonical `satis`
 * conversion. The adjustment is picked up by /api/oci/google-ads-export in the
 * `adjustments` block, uploaded by Google Ads Script, and ACK'd via /api/oci/ack.
 *
 * Key invariant: orderId in the adjustment MUST match the original conversion's
 * orderId. Because buildStableOrderId() excludes valueCents, this is guaranteed
 * even after the value changes.
 *
 * Auth: Bearer session_token or x-api-key (same as google-ads-export)
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { verifySessionToken } from '@/lib/oci/session-auth';
import { RateLimitService } from '@/lib/services/rate-limit-service';
import { logError, logInfo, logWarn } from '@/lib/logging/logger';
import { getConversionActionConfig, parseExportConfig } from '@/lib/oci/site-export-config';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AdjustmentRequestSchema = z.object({
  siteId: z.string().min(1),
  orderId: z.string().min(1).max(64),
  adjustmentType: z.enum(['RETRACTION', 'RESTATEMENT']),
  /** Required for RESTATEMENT; must be null/absent for RETRACTION */
  newValueCents: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const bearer = (req.headers.get('authorization') || '').trim();
    const sessionToken = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
    const apiKey = (req.headers.get('x-api-key') || '').trim();

    let siteIdFromToken = '';

    if (sessionToken) {
      const parsed = await verifySessionToken(sessionToken);
      if (parsed) {
        siteIdFromToken = parsed.siteId;
      }
    }

    const hasAuthAttempt = !!siteIdFromToken || !!apiKey;

    if (!hasAuthAttempt) {
      const clientId = RateLimitService.getClientId(req);
      await RateLimitService.checkWithMode(clientId, 10, 60 * 1000, {
        mode: 'fail-closed',
        namespace: 'oci-adjustments-authfail',
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = AdjustmentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { siteId: siteIdBody, orderId, adjustmentType, newValueCents, reason } = parsed.data;
    const siteId = siteIdFromToken || siteIdBody;

    // Validate RESTATEMENT requires newValueCents
    if (adjustmentType === 'RESTATEMENT' && !newValueCents) {
      return NextResponse.json(
        { error: 'newValueCents is required for RESTATEMENT' },
        { status: 400 }
      );
    }
    if (adjustmentType === 'RETRACTION' && newValueCents != null) {
      return NextResponse.json(
        { error: 'newValueCents must not be set for RETRACTION' },
        { status: 400 }
      );
    }

    // Resolve site
    const { data: byId } = await adminClient
      .from('sites')
      .select('id, public_id, oci_api_key, oci_config')
      .eq('id', siteId)
      .maybeSingle();

    let site = byId as {
      id: string;
      public_id?: string | null;
      oci_api_key?: string | null;
      oci_config?: unknown;
    } | null;

    if (!site) {
      const { data: byPublic } = await adminClient
        .from('sites')
        .select('id, public_id, oci_api_key, oci_config')
        .eq('public_id', siteId)
        .maybeSingle();
      site = byPublic as typeof site;
    }

    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Auth verification
    if (apiKey) {
      const siteKey = site.oci_api_key ?? '';
      if (!siteKey || !timingSafeCompare(siteKey, apiKey)) {
        return NextResponse.json({ error: 'Unauthorized: Invalid API key' }, { status: 401 });
      }
    } else if (siteIdFromToken) {
      if (siteIdFromToken !== site.id) {
        return NextResponse.json({ error: 'Forbidden: Token site mismatch' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const siteUuid = site.id;
    const exportConfig = parseExportConfig(site.oci_config);

    // Check adjustments are enabled for this site
    if (!exportConfig.adjustments.enabled) {
      return NextResponse.json(
        { error: 'Adjustments not enabled for this site', code: 'ADJUSTMENTS_DISABLED' },
        { status: 403 }
      );
    }

    // Check adjustment type is supported
    if (!exportConfig.adjustments.supported_types.includes(adjustmentType)) {
      return NextResponse.json(
        { error: `Adjustment type ${adjustmentType} not enabled for this site`, code: 'ADJUSTMENT_TYPE_DISABLED' },
        { status: 403 }
      );
    }

    // Find the original conversion queue row by orderId to validate and get metadata
    // The orderId is stored in the external_id or we match by the stable order ID
    const { data: originalRows, error: origError } = await adminClient
      .from('offline_conversion_queue')
      .select('id, value_cents, action, currency, created_at')
      .eq('site_id', siteUuid)
      .eq('external_id', orderId)
      .in('status', ['COMPLETED', 'UPLOADED', 'COMPLETED_UNVERIFIED'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (origError) {
      logError('OCI_ADJUSTMENTS_FETCH_ORIGINAL_ERROR', { error: origError.message, site_id: siteUuid });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const originalRow = Array.isArray(originalRows) && originalRows.length > 0
      ? (originalRows[0] as { id: string; value_cents?: number | null; action?: string | null; currency?: string | null; created_at: string })
      : null;

    // Validate adjustment age limit
    if (originalRow) {
      const ageMs = Date.now() - new Date(originalRow.created_at).getTime();
      const ageDays = ageMs / 86400000;
      if (ageDays > exportConfig.adjustments.max_adjustment_age_days) {
        logWarn('OCI_ADJUSTMENTS_TOO_OLD', {
          site_id: siteUuid,
          order_id: orderId,
          age_days: Math.round(ageDays),
          max_days: exportConfig.adjustments.max_adjustment_age_days,
        });
        return NextResponse.json(
          {
            error: 'Conversion is too old for adjustment',
            code: 'ADJUSTMENT_EXPIRED',
            age_days: Math.round(ageDays),
            max_days: exportConfig.adjustments.max_adjustment_age_days,
          },
          { status: 422 }
        );
      }
    }

    const conversionActionName = getConversionActionConfig(exportConfig, 'phone', 'won')?.action_name
      ?? originalRow?.action
      ?? 'OpsMantik_Won';

    const v5ActionConfig = getConversionActionConfig(exportConfig, 'phone', 'won');
    if (v5ActionConfig && !v5ActionConfig.adjustable) {
      return NextResponse.json(
        { error: 'Conversion action is not marked as adjustable in site config', code: 'ACTION_NOT_ADJUSTABLE' },
        { status: 403 }
      );
    }

    // Insert adjustment record
    const { data: inserted, error: insertError } = await adminClient
      .from('conversion_adjustments')
      .insert({
        site_id: siteUuid,
        order_id: orderId,
        original_queue_id: originalRow?.id ?? null,
        adjustment_type: adjustmentType,
        original_value_cents: originalRow?.value_cents ?? null,
        new_value_cents: adjustmentType === 'RESTATEMENT' ? (newValueCents ?? null) : null,
        reason: reason ?? null,
        status: 'PENDING',
        conversion_action_name: conversionActionName,
        channel: 'phone',
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      logError('OCI_ADJUSTMENTS_INSERT_ERROR', {
        error: insertError?.message ?? 'No row returned',
        site_id: siteUuid,
        order_id: orderId,
      });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    logInfo('OCI_ADJUSTMENT_CREATED', {
      site_id: siteUuid,
      adjustment_id: (inserted as { id: string }).id,
      order_id: orderId,
      adjustment_type: adjustmentType,
      new_value_cents: newValueCents ?? null,
    });

    return NextResponse.json({
      ok: true,
      adjustmentId: (inserted as { id: string }).id,
      status: 'PENDING',
      message: `${adjustmentType} queued for export. Will be sent on next Google Ads Script run.`,
    });

  } catch (e: unknown) {
    logError('OCI_ADJUSTMENTS_FATAL', { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal server error', code: 'SERVER_ERROR' }, { status: 500 });
  }
}
