import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/lib/auth/isAdmin';
import { StatsService } from '@/lib/services/stats-service';
import { SiteService } from '@/lib/services/site-service';
import { adminClient } from '@/lib/supabase/admin';
import { getTodayTrtDateKey, trtDateKeyToUtcRange } from '@/lib/time/today-range';

function monthStartFromDateKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

export async function GET(req: NextRequest) {
  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('siteId'); // public_id used by Redis keys
  const dateKey = searchParams.get('date') || getTodayTrtDateKey();

  if (!siteId) {
    return NextResponse.json({ error: 'siteId required' }, { status: 400 });
  }

  try {
    const { fromIso, toIso } = trtDateKeyToUtcRange(dateKey);
    const monthStart = monthStartFromDateKey(dateKey);

    // Redis (hot counters)
    const redis = await StatsService.getRealtimeStats(siteId, dateKey);

    // Map public siteId -> DB site uuid
    const { valid, site } = await SiteService.validateSite(siteId);
    if (!valid || !site) {
      return NextResponse.json({ error: 'invalid siteId' }, { status: 400 });
    }

    // DB (cold truth) — best-effort
    let dbCaptured: number | null = null;
    let dbMethod: 'events.site_id' | 'sessions->events' | 'unknown' = 'unknown';

    // 1) Preferred: events.site_id if column exists
    const direct = await adminClient
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', site.id)
      .eq('session_month', monthStart)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .neq('event_action', 'heartbeat');

    if (!direct.error && typeof direct.count === 'number') {
      dbCaptured = direct.count;
      dbMethod = 'events.site_id';
    } else {
      const msg = String(direct.error?.message || '');
      const looksLikeMissingColumn = /column .*site_id.*does not exist/i.test(msg);

      if (!looksLikeMissingColumn) {
        // If it's not a schema mismatch, surface as a 500 (so operator knows).
        throw direct.error || new Error('DB count failed');
      }

      // 2) Fallback: join via sessions (more expensive, but robust)
      const sessions = await adminClient
        .from('sessions')
        .select('id')
        .eq('site_id', site.id)
        .eq('created_month', monthStart)
        .gte('created_at', fromIso)
        .lt('created_at', toIso)
        .limit(5000);

      if (sessions.error) throw sessions.error;

      const sessionIds = (sessions.data || []).map((s: any) => s.id).filter(Boolean);
      if (sessionIds.length === 0) {
        dbCaptured = 0;
        dbMethod = 'sessions->events';
      } else {
        const events = await adminClient
          .from('events')
          .select('id', { count: 'exact', head: true })
          .in('session_id', sessionIds)
          .eq('session_month', monthStart)
          .gte('created_at', fromIso)
          .lt('created_at', toIso)
          .neq('event_action', 'heartbeat');

        if (events.error) throw events.error;
        dbCaptured = typeof events.count === 'number' ? events.count : null;
        dbMethod = 'sessions->events';
      }
    }

    const drift = typeof dbCaptured === 'number'
      ? { captured: redis.captured - dbCaptured }
      : { captured: null as any };

    return NextResponse.json({
      ok: true,
      siteId,
      date: dateKey,
      rangeUtc: { fromIso, toIso },
      redis,
      db: { captured: dbCaptured, method: dbMethod, monthStart },
      drift,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'reconcile_failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

