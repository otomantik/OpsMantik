/**
 * POST /api/gdpr/erase — KVKK/GDPR silme talebi
 * Auth: Site owner/admin. Rate limit: 10/hour per site+user. RPC: erase_pii_for_identifier.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { RateLimitService } from '@/lib/services/rate-limit-service';

const IDENTIFIER_TYPES = ['email', 'fingerprint', 'session_id'] as const;
const RL_LIMIT = 10;
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const site_id = typeof body.site_id === 'string' ? body.site_id.trim() : '';
    const identifier_type = typeof body.identifier_type === 'string' ? body.identifier_type.trim().toLowerCase() : '';
    const identifier_value = typeof body.identifier_value === 'string' ? body.identifier_value.trim() : '';

    if (!site_id || !identifier_type || !identifier_value) {
      return NextResponse.json(
        { error: 'site_id, identifier_type, and identifier_value are required' },
        { status: 400 }
      );
    }

    if (!IDENTIFIER_TYPES.includes(identifier_type as (typeof IDENTIFIER_TYPES)[number])) {
      return NextResponse.json(
        { error: `identifier_type must be one of: ${IDENTIFIER_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Resolve site UUID (accept id or public_id)
    const { data: byId } = await adminClient.from('sites').select('id').eq('id', site_id).maybeSingle();
    let siteUuid = byId?.id;
    if (!siteUuid) {
      const { data: byPublicId } = await adminClient
        .from('sites')
        .select('id')
        .eq('public_id', site_id)
        .maybeSingle();
      siteUuid = byPublicId?.id;
    }
    if (!siteUuid) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const access = await validateSiteAccess(siteUuid, user.id, supabase);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Access denied to site' }, { status: 403 });
    }

    // Rate limit: 10/hour per site+user
    const rlKey = `gdpr_erase:${user.id}:${site_id}`;
    const rl = await RateLimitService.checkWithMode(rlKey, RL_LIMIT, RL_WINDOW_MS, {
      mode: 'fail-closed',
      namespace: 'gdpr',
    });
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    // Insert erase request (PENDING)
    const { data: eraseRow, error: insertErr } = await adminClient
      .from('gdpr_erase_requests')
      .insert({
        site_id: siteUuid,
        identifier_type,
        identifier_value: identifier_value.slice(0, 512), // cap length
        status: 'PENDING',
      })
      .select('id')
      .single();

    if (insertErr || !eraseRow?.id) {
      return NextResponse.json(
        { error: 'Failed to record erase request' },
        { status: 500 }
      );
    }

    // Call RPC
    const { data: rpcRows, error: rpcErr } = await adminClient.rpc('erase_pii_for_identifier', {
      p_site_id: siteUuid,
      p_identifier_type: identifier_type,
      p_identifier_value: identifier_value,
    });

    const counts = Array.isArray(rpcRows) && rpcRows[0] ? rpcRows[0] : null;
    const totalAffected = counts
      ? Number(counts.sessions_affected ?? 0) +
        Number(counts.events_affected ?? 0) +
        Number(counts.calls_affected ?? 0) +
        Number(counts.conversations_affected ?? 0) +
        Number(counts.sales_affected ?? 0) +
        Number(counts.ociq_affected ?? 0) +
        Number(counts.sync_dlq_affected ?? 0) +
        Number(counts.ingest_fallback_affected ?? 0)
      : 0;

    if (rpcErr) {
      await adminClient
        .from('gdpr_erase_requests')
        .update({ status: 'FAILED', completed_at: new Date().toISOString() })
        .eq('id', eraseRow.id);
      return NextResponse.json(
        { error: 'Erase failed', details: rpcErr.message },
        { status: 500 }
      );
    }

    await adminClient
      .from('gdpr_erase_requests')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
      .eq('id', eraseRow.id);

    // Audit log (NO PII in payload)
    await adminClient.from('audit_log').insert({
      actor_type: 'user',
      actor_id: user.id,
      action: 'ERASE',
      resource_type: 'gdpr_erase_request',
      resource_id: eraseRow.id,
      site_id: siteUuid,
      payload: {
        request_id: eraseRow.id,
        identifier_type,
        total_records_affected: totalAffected,
        sessions: counts?.sessions_affected ?? 0,
        events: counts?.events_affected ?? 0,
        calls: counts?.calls_affected ?? 0,
        conversations: counts?.conversations_affected ?? 0,
        sales: counts?.sales_affected ?? 0,
        ociq: counts?.ociq_affected ?? 0,
        sync_dlq: counts?.sync_dlq_affected ?? 0,
        ingest_fallback: counts?.ingest_fallback_affected ?? 0,
      },
    });

    return NextResponse.json({
      ok: true,
      request_id: eraseRow.id,
      total_records_affected: totalAffected,
      breakdown: counts
        ? {
            sessions: Number(counts.sessions_affected ?? 0),
            events: Number(counts.events_affected ?? 0),
            calls: Number(counts.calls_affected ?? 0),
            conversations: Number(counts.conversations_affected ?? 0),
            sales: Number(counts.sales_affected ?? 0),
            offline_conversion_queue: Number(counts.ociq_affected ?? 0),
            sync_dlq: Number(counts.sync_dlq_affected ?? 0),
            ingest_fallback: Number(counts.ingest_fallback_affected ?? 0),
          }
        : undefined,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
