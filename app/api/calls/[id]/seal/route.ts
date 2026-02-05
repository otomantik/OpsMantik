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
import { logInfo, logError } from '@/lib/log';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

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
    // lead_score: 0-100 scale (frontend sends score * 20); optional for backward compatibility
    const leadScoreRaw = body.lead_score != null ? Number(body.lead_score) : null;
    const leadScore =
      leadScoreRaw != null && Number.isFinite(leadScoreRaw) && leadScoreRaw >= 0 && leadScoreRaw <= 100
        ? Math.round(leadScoreRaw)
        : null;

    if (saleAmount != null && (Number.isNaN(saleAmount) || saleAmount < 0)) {
      return NextResponse.json(
        { error: 'sale_amount must be a non-negative number' },
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

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!userClient) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logInfo('seal request', { request_id: requestId, route, user_id: user.id });

    // Lookup: admin only for id+site_id (do not trust client). Then gate by access; update with user client (RLS).
    const { data: call, error: fetchError } = await adminClient
      .from('calls')
      .select('id, site_id')
      .eq('id', callId)
      .maybeSingle();

    if (fetchError || !call) {
      return NextResponse.json({ error: 'Call not found or access denied' }, { status: 404 });
    }

    const siteId = call.site_id;
    const access = await validateSiteAccess(siteId, user.id, userClient);
    if (!access.allowed) {
      return NextResponse.json({ error: 'Call not found or access denied' }, { status: 404 });
    }

    const updatePayload: Record<string, unknown> = {
      sale_amount: saleAmount,
      currency,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: user.id,
      oci_status: 'sealed',
      oci_status_updated_at: new Date().toISOString(),
    };
    if (leadScore != null) {
      updatePayload.lead_score = leadScore;
    }

    // Apply via DB RPC to guarantee audit log + revert snapshot
    const { data: updated, error: updateError } = await userClient.rpc('apply_call_action_v1', {
      p_call_id: callId,
      p_action_type: 'seal',
      p_payload: updatePayload,
      p_actor_type: 'user',
      p_actor_id: null,
      p_metadata: { route, request_id: requestId },
    });

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || 'Update failed' },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Call not updated (may already be confirmed)' },
        { status: 409 }
      );
    }

    // RPC returns jsonb → normalize shape for response
    const callObj = Array.isArray(updated) && updated.length === 1 ? updated[0] : updated;

    return NextResponse.json({
      success: true,
      call: {
        id: callObj.id,
        sale_amount: callObj.sale_amount,
        currency: callObj.currency,
        status: callObj.status,
        confirmed_at: callObj.confirmed_at,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logError(message, { request_id: requestId, route });
    Sentry.captureException(err, { tags: { request_id: requestId, route } });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
