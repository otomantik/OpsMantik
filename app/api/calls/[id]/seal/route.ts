/**
 * POST /api/calls/[id]/seal — Seal a call with sale amount (Casino Kasa).
 * Lookup: admin client (site_id only, no client input). Access: validateSiteAccess. Update: user client (RLS).
 * Accepts cookie session or Authorization: Bearer <access_token> (smoke tests).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { logInfo, logError, logWarn } from '@/lib/logging/logger';
import * as Sentry from '@sentry/nextjs';
import { hasCapability } from '@/lib/auth/rbac';
import { normalizeToE164 } from '@/lib/dic/e164';
import { hashPhoneForEC } from '@/lib/dic/identity-hash';
import { parseWithinTemporalSanityWindow } from '@/lib/utils/temporal-sanity';
import { resolveSealOccurredAt } from '@/lib/oci/occurred-at';
import { getChronologyFloorForCall } from '@/lib/oci/chronology-guard';
import { appendAuditLog } from '@/lib/audit/audit-log';

export const dynamic = 'force-dynamic';
const BACKDATE_APPROVAL_MS = 48 * 60 * 60 * 1000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = req.headers.get('x-request-id') ?? undefined;
  const route = '/api/calls/[id]/seal';
  try {
    const { id: callId } = await params;
    if (!callId) {
      return NextResponse.json({ error: 'Missing call id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const saleAmount = body.sale_amount != null ? Number(body.sale_amount) : null;
    const currency = typeof body.currency === 'string' ? body.currency.trim() || 'TRY' : 'TRY';
    const saleOccurredAtRaw = typeof body.sale_occurred_at === 'string' ? body.sale_occurred_at.trim() : '';
    const entryReason = typeof body.entry_reason === 'string' ? body.entry_reason.trim().slice(0, 500) : '';
    // lead_score: 0-100 scale (frontend sends score * 20); optional for backward compatibility
    const leadScoreRaw = body.lead_score != null ? Number(body.lead_score) : null;
    const version = body.version != null ? Number(body.version) : null;
    let leadScore =
      leadScoreRaw != null && Number.isFinite(leadScoreRaw) && leadScoreRaw >= 0 && leadScoreRaw <= 100
        ? Math.round(leadScoreRaw)
        : null;

    // Calibrate scaling: If leadScore is 1-5, interpolate to 20-100 for backward compatibility
    if (leadScore != null && leadScore > 0 && leadScore <= 5) {
      leadScore = leadScore * 20;
    }

    // Relaxed check: Humans can seal a lead with 0 value if they choose.
    // OCI worker will still use a floor if configured, or export as 0.
    if (saleAmount != null && (Number.isNaN(saleAmount) || saleAmount < 0)) {
      return NextResponse.json(
        { error: 'sale_amount must be a non-negative number' },
        { status: 400 }
      );
    }
    if (saleOccurredAtRaw && !parseWithinTemporalSanityWindow(saleOccurredAtRaw)) {
      return NextResponse.json(
        { error: 'sale_occurred_at outside temporal sanity window [now - 90 days, now + 1 hour]' },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    let userClient: SupabaseClient | undefined;
    let user: { id: string } | null = null;

    if (bearerToken) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anonKey) {
        return NextResponse.json({ error: 'Server config missing' }, { status: 500 });
      }
      userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
        auth: { persistSession: false },
      });
      const { data: sessionData } = await userClient.auth.setSession({
        access_token: bearerToken,
        refresh_token: '',
      });
      user = sessionData?.user ?? (await userClient.auth.getUser(bearerToken)).data.user ?? null;
    }

    if (!user) {
      userClient = await createServerClient();
      const { data: { user: u } } = await userClient.auth.getUser();
      user = u ?? null;
    }

    if (!user || !userClient) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logInfo('seal request', { request_id: requestId, route, user_id: user.id });

    // Lookup: admin only for id+site_id+created_at (do not trust client). Then gate by access; update with user client (RLS).
    const { data: call, error: fetchError } = await adminClient
      .from('calls')
      .select('id, site_id, version, created_at')
      .eq('id', callId)
      .maybeSingle();

    if (fetchError || !call) {
      return NextResponse.json({ error: 'Call not found or access denied' }, { status: 404 });
    }

    const siteId = call.site_id;
    const access = await validateSiteAccess(siteId, user.id, userClient);
    if (!access.allowed || !access.role || !hasCapability(access.role, 'queue:operate')) {
      return NextResponse.json({ error: 'Call not found or access denied' }, { status: 404 });
    }

    // Determine lifecycle state for OCI pipeline
    // lead_score 100 = V5 SEAL (Aggressive)
    // lead_score >= 10 = V4 INTENT (Standard)
    // lead_score < 10 or null = ignored by OCI worker
    const ociStatus = leadScore === 100 ? 'sealed' : leadScore != null && leadScore >= 10 ? 'intent' : 'skipped';

    const confirmedAtIso = new Date().toISOString();
    const occurredAtMeta = resolveSealOccurredAt({
      saleOccurredAt: saleOccurredAtRaw || null,
      fallbackConfirmedAt: confirmedAtIso,
    });
    const chronologyFloor = saleOccurredAtRaw ? await getChronologyFloorForCall(siteId, callId) : null;
    if (chronologyFloor && new Date(occurredAtMeta.occurredAt).getTime() < new Date(chronologyFloor.observedAt).getTime()) {
      return NextResponse.json(
        {
          error: 'sale_occurred_at cannot be earlier than the attributed click/session time',
          code: 'SALE_OCCURRED_AT_BEFORE_CLICK_TIME',
          floor_at: chronologyFloor.observedAt,
          floor_source: chronologyFloor.source,
        },
        { status: 409 }
      );
    }
    const backdatedMs = Math.max(0, new Date(confirmedAtIso).getTime() - new Date(occurredAtMeta.occurredAt).getTime());
    const approvalRequired = saleOccurredAtRaw.length > 0 && backdatedMs > BACKDATE_APPROVAL_MS;
    const effectiveOciStatus = approvalRequired ? 'pending_approval' : ociStatus;
    const updatePayload: Record<string, unknown> = {
      sale_amount: saleAmount,
      currency,
      status: 'confirmed',
      confirmed_at: confirmedAtIso,
      confirmed_by: user.id,
      oci_status: effectiveOciStatus,
      oci_status_updated_at: confirmedAtIso,
      lead_score: leadScore,
      sale_occurred_at: occurredAtMeta.occurredAt,
      sale_source_timestamp: occurredAtMeta.sourceTimestamp,
      sale_time_confidence: occurredAtMeta.timeConfidence,
      sale_occurred_at_source: occurredAtMeta.occurredAtSource,
      sale_is_backdated: backdatedMs > 0,
      sale_backdated_seconds: Math.floor(backdatedMs / 1000),
      sale_review_status: approvalRequired ? 'PENDING_APPROVAL' : 'NONE',
      sale_review_requested_at: approvalRequired ? confirmedAtIso : null,
    };
    if (entryReason) updatePayload.sale_entry_reason = entryReason;

    // Operator-verified caller phone (optional): trim, max 64; empty after trim = don't send
    const callerPhoneRaw = typeof body.caller_phone === 'string' ? body.caller_phone.trim().slice(0, 64) : '';
    if (callerPhoneRaw) {
      try {
        const { data: siteRow } = await adminClient
          .from('sites')
          .select('default_country_iso')
          .eq('id', siteId)
          .maybeSingle();
        const countryIso = siteRow?.default_country_iso ?? 'TR';
        if (!siteRow?.default_country_iso) {
          logInfo('CALLER_PHONE_COUNTRY_ISO_FALLBACK', { call_id: callId, site_id: siteId });
        }
        const salt = process.env.OCI_PHONE_HASH_SALT ?? '';
        const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
        if (isProd && !salt) {
          logError('OCI_PHONE_HASH_SALT_EMPTY_PRODUCTION', { call_id: callId });
          Sentry.captureMessage('OCI_PHONE_HASH_SALT_EMPTY_PRODUCTION', 'error');
        }
        const normalized = normalizeToE164(callerPhoneRaw, countryIso);
        if (!normalized) {
          logWarn('CALLER_PHONE_NORMALIZATION_FAILED', { call_id: callId, raw: callerPhoneRaw });
          updatePayload.caller_phone_raw = callerPhoneRaw;
          // e164 and hash stay null; seal continues (fail-soft)
        } else {
          const hash = hashPhoneForEC(normalized, salt);
          updatePayload.caller_phone_raw = callerPhoneRaw;
          updatePayload.caller_phone_e164 = normalized;
          updatePayload.caller_phone_hash_sha256 = hash;
          updatePayload.phone_source_type = 'operator_verified';
        }
      } catch (e) {
        logWarn('CALLER_PHONE_PROCESSING_ERROR', {
          call_id: callId,
          error: String((e as Error)?.message ?? e),
        });
        updatePayload.caller_phone_raw = callerPhoneRaw;
      }
    }

    // Apply via DB RPC to guarantee audit log + revert snapshot
    const { data: updated, error: updateError } = await userClient.rpc('apply_call_action_v1', {
      p_call_id: callId,
      p_action_type: 'seal',
      p_payload: updatePayload,
      p_actor_type: 'user',
      p_actor_id: null,
      p_metadata: { route, request_id: requestId },
      p_version: version ?? call.version, // NEW: Optimistic Locking (enforced even if frontend omits version)
    });

    if (updateError) {
      // Sprint 1: State machine — cannot seal from junk or cancelled (DB-level guard)
      if (updateError.code === 'P0003' || updateError.message?.includes('cannot_seal_from_junk_or_cancelled')) {
        return NextResponse.json(
          { error: 'Cannot seal: call is junk or cancelled. Restore to queue first.' },
          { status: 409 }
        );
      }
      // Concurrency conflict (e.g., version mismatch — record was updated by another process)
      if (updateError.code === 'P0002' || updateError.message?.includes('version mismatch')) {
        return NextResponse.json(
          { error: 'Concurrency conflict: Call was updated by another user. Please refresh and try again.' },
          { status: 409 }
        );
      }
      const { sanitizeErrorForClient } = await import('@/lib/security/sanitize-error');
      return NextResponse.json(
        { error: sanitizeErrorForClient(updateError) || 'Update failed' },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Call not updated (may already be confirmed)' },
        { status: 409 }
      );
    }

    // RPC returns jsonb → normalize shape for response.
    // Phase 1 Outbox: V3/V4/V5 are no longer written here; IntentSealed was written to outbox_events
    // in the same transaction as the call update. The outbox worker cron processes them.
    const callObj = Array.isArray(updated) && updated.length === 1 ? updated[0] : updated;
    const confirmedAt = (callObj as { confirmed_at?: string }).confirmed_at ?? new Date().toISOString();
    if (approvalRequired) {
      await appendAuditLog(adminClient, {
        actor_type: 'user',
        actor_id: user.id,
        action: 'call_sale_time_pending_approval',
        resource_type: 'call',
        resource_id: callId,
        site_id: siteId,
        payload: {
          sale_occurred_at: occurredAtMeta.occurredAt,
          entry_reason: entryReason || null,
          backdated_ms: backdatedMs,
          floor_at: chronologyFloor?.observedAt ?? null,
          floor_source: chronologyFloor?.source ?? null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      approval_required: approvalRequired,
      call: {
        id: (callObj as { id?: string }).id,
        sale_amount: (callObj as { sale_amount?: number | null }).sale_amount,
        currency: (callObj as { currency?: string }).currency,
        status: (callObj as { status?: string }).status,
        confirmed_at: confirmedAt,
        sale_occurred_at: (callObj as { sale_occurred_at?: string | null }).sale_occurred_at ?? occurredAtMeta.occurredAt,
        oci_status: (callObj as { oci_status?: string | null }).oci_status ?? effectiveOciStatus,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    Sentry.captureException(err, { tags: { request_id: requestId, route } });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
