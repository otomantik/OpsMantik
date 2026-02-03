import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { getTodayTrtUtcRange } from '@/lib/time/today-range';

export const dynamic = 'force-dynamic';

/**
 * GET /api/oci/export-batch?siteId=<uuid>
 *
 * OCI "Pull" strategy: Google Ads Script calls this with x-api-key.
 * Returns JSON array for bulk upload. No cookie/session; API key only.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. GÜVENLİK: API Key Kontrolü (Cookie/Session yerine)
    const apiKey = req.headers.get('x-api-key');
    const envKey = process.env.OCI_API_KEY;

    if (!envKey || apiKey !== envKey) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing API Key' },
        { status: 401 }
      );
    }

    // 2. PARAMETRELER
    const { searchParams } = new URL(req.url);
    const siteId = String(searchParams.get('siteId') || '');

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
    }

    const { data: site, error: siteError } = await adminClient
      .from('sites')
      .select('id, currency')
      .eq('id', siteId)
      .maybeSingle();

    if (siteError || !site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const currency = (site as { currency?: string })?.currency || 'TRY';
    const { fromIso, toIso } = getTodayTrtUtcRange();

    // 3. VERİ ÇEKME (Calls tablosu – mevcut export ile aynı mantık)
    const { data: calls, error: callsError } = await adminClient
      .from('calls')
      .select('id, created_at, confirmed_at, matched_session_id, click_id, oci_status')
      .eq('site_id', siteId)
      .in('status', ['confirmed', 'qualified', 'real'])
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .or('oci_status.is.null,oci_status.eq.sealed,oci_status.eq.failed');

    if (callsError) {
      return NextResponse.json(
        { error: 'Failed to load calls', details: callsError.message },
        { status: 500 }
      );
    }

    const rows = Array.isArray(calls) ? calls : [];

    if (rows.length === 0) {
      return NextResponse.json([]);
    }

    // 4. SESSION EŞLEŞTİRME (GCLID/WBRAID/GBRAID)
    const sessionIds = Array.from(
      new Set(
        rows
          .map((r: { matched_session_id?: string | null }) => r.matched_session_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
      )
    );

    const sessionMap = new Map<
      string,
      { gclid?: string | null; wbraid?: string | null; gbraid?: string | null }
    >();

    if (sessionIds.length > 0) {
      const { data: sessions, error: sessError } = await adminClient
        .from('sessions')
        .select('id, gclid, wbraid, gbraid')
        .eq('site_id', siteId)
        .in('id', sessionIds);

      if (sessError) {
        return NextResponse.json(
          { error: 'Failed to load sessions', details: sessError.message },
          { status: 500 }
        );
      }

      for (const s of sessions || []) {
        const row = s as { id: string; gclid?: string | null; wbraid?: string | null; gbraid?: string | null };
        sessionMap.set(String(row.id), {
          gclid: row.gclid ?? null,
          wbraid: row.wbraid ?? null,
          gbraid: row.gbraid ?? null,
        });
      }
    }

    // 5. JSON HAZIRLAMA (Google Ads Script formatı)
    const batchId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    // Conversion name: Google Ads’teki Offline Conversion aksiyon adıyla birebir aynı olmalı.
    const conversionName = process.env.OCI_CONVERSION_NAME || 'Sealed Lead';
    const conversionValue = 1;

    const exportedCallIds: string[] = [];
    const jsonOutput: Array<{
      gclid: string;
      gbraid: string;
      wbraid: string;
      conversion_name: string;
      conversion_time: string;
      value: number;
      currency: string;
    }> = [];

    for (const c of rows) {
      const row = c as {
        id: string;
        matched_session_id?: string | null;
        click_id?: string | null;
        confirmed_at?: string | null;
        created_at?: string | null;
      };
      const sid = row.matched_session_id ? String(row.matched_session_id) : '';
      const sess = sid ? sessionMap.get(sid) : undefined;

      const gclid = (sess?.gclid || '').trim();
      const wbraid = (sess?.wbraid || '').trim();
      const gbraid = (sess?.gbraid || '').trim();
      const fallbackClick = (row.click_id || '').toString().trim();

      const hasAnyClickId = Boolean(gclid || wbraid || gbraid || fallbackClick);
      if (!hasAnyClickId) continue;

      exportedCallIds.push(String(row.id));
      const rawTime = String(row.confirmed_at || row.created_at || '');

      jsonOutput.push({
        gclid: gclid || fallbackClick || '',
        gbraid: gbraid || '',
        wbraid: wbraid || '',
        conversion_name: conversionName,
        conversion_time: rawTime,
        value: conversionValue,
        currency,
      });
    }

    // 6. DURUM GÜNCELLEME (Mark as uploaded – script tekrar aynı satırları çekmesin)
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
        console.error('[OCI export-batch] Update error:', updError);
      }
    }

    return NextResponse.json(jsonOutput);
  } catch (e: unknown) {
    const details = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Internal server error', details }, { status: 500 });
  }
}
