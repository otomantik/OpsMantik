import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';

export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toGoogleTime(ts: string): string {
  // Google CSV accepts local time; we export ISO-ish UTC to be deterministic.
  // Example: 2026-01-29 13:45:12+00:00
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}+00:00`;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const siteId = String(searchParams.get('siteId') || '');
    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    // RLS-based access check (owner/member/admin)
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, currency')
      .eq('id', siteId)
      .maybeSingle();
    if (siteError || !site) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const currency = (site as any)?.currency || 'TRY';
    const { fromIso, toIso } = getTodayTrtUtcRange();

    // Fetch sealed calls that are not yet exported (today window)
    const { data: calls, error: callsError } = await adminClient
      .from('calls')
      .select('id, created_at, confirmed_at, matched_session_id, click_id, oci_status')
      .eq('site_id', siteId)
      .in('status', ['confirmed', 'qualified', 'real'])
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .or('oci_status.is.null,oci_status.eq.sealed,oci_status.eq.failed');

    if (callsError) {
      return NextResponse.json({ error: 'Failed to load sealed calls', details: callsError.message }, { status: 500 });
    }

    const rows = Array.isArray(calls) ? calls : [];
    const sessionIds = Array.from(
      new Set(rows.map((r: any) => r.matched_session_id).filter((v: any) => typeof v === 'string' && v.length > 0))
    );

    // Pull click-ids from sessions (best effort; ids are globally unique UUIDs)
    let sessionMap = new Map<string, { gclid?: string | null; wbraid?: string | null; gbraid?: string | null }>();
    if (sessionIds.length > 0) {
      const { data: sessions, error: sessError } = await adminClient
        .from('sessions')
        .select('id, gclid, wbraid, gbraid')
        .eq('site_id', siteId)
        .in('id', sessionIds);
      if (sessError) {
        return NextResponse.json({ error: 'Failed to load sessions', details: sessError.message }, { status: 500 });
      }
      for (const s of (sessions || []) as any[]) {
        sessionMap.set(String(s.id), { gclid: s.gclid ?? null, wbraid: s.wbraid ?? null, gbraid: s.gbraid ?? null });
      }
    }

    const batchId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // Google Ads Offline Conversions CSV columns:
    // Google Click ID, GBRAID, WBRAID, Conversion Name, Conversion Time, Conversion Value, Conversion Currency
    const header = [
      'Google Click ID',
      'GBRAID',
      'WBRAID',
      'Conversion Name',
      'Conversion Time',
      'Conversion Value',
      'Conversion Currency',
    ];

    const conversionName = 'Sealed Lead';
    const conversionValue = 1;

    const exportedCallIds: string[] = [];
    const lines: string[] = [header.map(csvEscape).join(',')];

    for (const c of rows as any[]) {
      const sid = c.matched_session_id ? String(c.matched_session_id) : '';
      const sess = sid ? sessionMap.get(sid) : undefined;

      const gclid = (sess?.gclid || '').trim();
      const wbraid = (sess?.wbraid || '').trim();
      const gbraid = (sess?.gbraid || '').trim();

      // Fallback: if session ids missing but calls.click_id exists, place it into GCLID column.
      const fallbackClick = (c.click_id || '').toString().trim();

      const hasAnyClickId = Boolean(gclid || wbraid || gbraid || fallbackClick);
      if (!hasAnyClickId) continue;

      exportedCallIds.push(String(c.id));

      const conversionTime = toGoogleTime(String(c.confirmed_at || c.created_at));

      lines.push(
        [
          gclid || fallbackClick || '',
          gbraid || '',
          wbraid || '',
          conversionName,
          conversionTime,
          conversionValue,
          currency,
        ].map(csvEscape).join(',')
      );
    }

    // Mark exported calls as uploaded (exported) for OCI feedback loop
    if (exportedCallIds.length > 0) {
      const { error: updError } = await adminClient
        .from('calls')
        .update({
          oci_status: 'uploaded',
          oci_uploaded_at: nowIso,
          oci_status_updated_at: nowIso,
          oci_batch_id: batchId,
          oci_error: null,
        })
        .in('id', exportedCallIds)
        .eq('site_id', siteId);

      if (updError) {
        // Best-effort: still return CSV (user can upload), but surface failure in header
        const body = `# WARNING: exported but failed to mark uploaded: ${updError.message}\n` + lines.join('\n');
        return new NextResponse(body, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="opsmantik_oci_${siteId}.csv"`,
          },
        });
      }
    }

    const csv = lines.join('\n');
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="opsmantik_oci_${siteId}.csv"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Internal server error', details: e?.message || String(e) }, { status: 500 });
  }
}

