/**
 * POST /api/cron/gdpr-retention — Anonymize consent-less sessions/events older than retention.
 * Auth: Cron secret. Body: { days?: number } (default 90).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;

  try {
    const body = await req.json().catch(() => ({}));
    const days = typeof body?.days === 'number' && body.days > 0 ? body.days : 90;

    const { data: rows, error } = await adminClient.rpc('anonymize_consent_less_data', {
      p_days: days,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: getBuildInfoHeaders() }
      );
    }

    const row = Array.isArray(rows) && rows[0] ? rows[0] : { sessions_affected: 0, events_affected: 0 };
    const sessionsAffected = Number(row.sessions_affected ?? 0);
    const eventsAffected = Number(row.events_affected ?? 0);

    return NextResponse.json(
      {
        ok: true,
        days,
        sessions_affected: sessionsAffected,
        events_affected: eventsAffected,
      },
      { headers: getBuildInfoHeaders() }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500, headers: getBuildInfoHeaders() }
    );
  }
}
