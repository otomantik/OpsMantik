import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { timingSafeCompare } from '@/lib/security/timing-safe-compare';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { logWarn } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HeartbeatBody = {
  site_id?: string;
  siteId?: string;
  script_version?: string;
  scriptVersion?: string;
  script_hash?: string | null;
  scriptHash?: string | null;
  last_modified?: string | null;
  lastModified?: string | null;
  feature_flags?: Record<string, unknown> | null;
  featureFlags?: Record<string, unknown> | null;
};

export async function POST(req: NextRequest) {
  const bearer = (req.headers.get('authorization') || '').trim();
  const apiKey = bearer.startsWith('Bearer ') ? bearer.slice(7).trim() : '';
  const body = (await req.json().catch(() => null)) as HeartbeatBody | null;
  const siteId = String(body?.site_id || body?.siteId || '').trim();

  if (!siteId || !apiKey) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  const { data: site, error: siteErr } = await adminClient
    .from('sites')
    .select('id, oci_api_key')
    .or(`id.eq.${siteId},public_id.eq.${siteId}`)
    .maybeSingle();

  if (siteErr || !site) {
    logWarn('OCI_SCRIPT_HEARTBEAT_SITE_LOOKUP_FAILED', { siteId, error: siteErr?.message ?? null });
    return NextResponse.json({ ok: false, error: 'Site not found' }, { status: 404, headers: getBuildInfoHeaders() });
  }

  const siteRow = site as { id: string; oci_api_key: string | null };
  if (!siteRow.oci_api_key || !timingSafeCompare(siteRow.oci_api_key, apiKey)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: getBuildInfoHeaders() });
  }

  const scriptVersion = String(body?.script_version || body?.scriptVersion || 'unknown').slice(0, 200);
  const featureFlags = body?.feature_flags || body?.featureFlags || {};
  const nowIso = new Date().toISOString();

  const { error: upsertErr } = await adminClient.from('oci_script_versions').upsert(
    {
      site_id: siteRow.id,
      script_version: scriptVersion,
      script_hash: body?.script_hash ?? body?.scriptHash ?? null,
      last_modified: body?.last_modified ?? body?.lastModified ?? null,
      feature_flags: featureFlags,
      last_seen_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: 'site_id' }
  );

  if (upsertErr) {
    logWarn('OCI_SCRIPT_HEARTBEAT_UPSERT_FAILED', { siteId: siteRow.id, error: upsertErr.message });
    return NextResponse.json({ ok: false, error: 'SERVER_ERROR' }, { status: 500, headers: getBuildInfoHeaders() });
  }

  return NextResponse.json({ ok: true, site_id: siteRow.id, script_version: scriptVersion }, { headers: getBuildInfoHeaders() });
}
