/**
 * GET /api/gdpr/export — KVKK/GDPR veri dışa aktarma
 * Query: site_id, identifier_type, identifier_value
 * Auth: Site owner/admin. Rate limit: 10/hour per site+user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { validateSiteAccess } from '@/lib/security/validate-site-access';
import { RateLimitService } from '@/lib/services/rate-limit-service';

const IDENTIFIER_TYPES = ['email', 'fingerprint', 'session_id'] as const;
const RL_LIMIT = 10;
const RL_WINDOW_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const site_id = url.searchParams.get('site_id')?.trim() ?? '';
    const identifier_type = url.searchParams.get('identifier_type')?.trim().toLowerCase() ?? '';
    const identifier_value = url.searchParams.get('identifier_value')?.trim() ?? '';

    if (!site_id || !identifier_type || !identifier_value) {
      return NextResponse.json(
        { error: 'site_id, identifier_type, and identifier_value are required (query params)' },
        { status: 400 }
      );
    }

    if (!IDENTIFIER_TYPES.includes(identifier_type as (typeof IDENTIFIER_TYPES)[number])) {
      return NextResponse.json(
        { error: `identifier_type must be one of: ${IDENTIFIER_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

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

    const rlKey = `gdpr_export:${user.id}:${siteUuid}`;
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

    const { data: exportData, error } = await adminClient.rpc('export_data_for_identifier', {
      p_site_id: siteUuid,
      p_identifier_type: identifier_type,
      p_identifier_value: identifier_value,
    });

    if (error) {
      const { logError } = await import('@/lib/logging/logger');
      logError('GDPR_EXPORT_FAILED', { code: (error as { code?: string })?.code });
      return NextResponse.json({ error: 'Something went wrong', code: 'SERVER_ERROR' }, { status: 500 });
    }

    const data = exportData as Record<string, unknown> | null;
    const sessions = (data?.sessions ?? []) as unknown[];
    const events = (data?.events ?? []) as unknown[];
    const calls = (data?.calls ?? []) as unknown[];
    const conversations = (data?.conversations ?? []) as unknown[];
    const sales = (data?.sales ?? []) as unknown[];
    const totalRecords = sessions.length + events.length + calls.length + conversations.length + sales.length;

    await adminClient.from('audit_log').insert({
      actor_type: 'user',
      actor_id: user.id,
      action: 'EXPORT',
      resource_type: 'gdpr_export',
      resource_id: null,
      site_id: siteUuid,
      payload: {
        identifier_type,
        total_records: totalRecords,
        sessions_count: sessions.length,
        events_count: events.length,
        calls_count: calls.length,
        conversations_count: conversations.length,
        sales_count: sales.length,
      },
    });

    return NextResponse.json({
      ok: true,
      data: {
        sessions,
        events,
        calls,
        conversations,
        sales,
      },
      meta: {
        total_records: totalRecords,
        exported_at: new Date().toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
