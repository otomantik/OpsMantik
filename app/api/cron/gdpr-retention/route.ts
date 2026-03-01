/**
 * GET/POST /api/cron/gdpr-retention — Anonymize consent-less sessions/events older than retention.
 * Auth: Cron secret. Body (POST): { days?: number }. Query (GET): days=90.
 * Vercel Cron sends GET; POST kept for manual/Bearer calls.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBuildInfoHeaders } from '@/lib/build-info';
import { requireCronAuth } from '@/lib/cron/require-cron-auth';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runGdprRetention(req);
}

export async function POST(req: NextRequest) {
  const forbidden = requireCronAuth(req);
  if (forbidden) return forbidden;
  return runGdprRetention(req);
}

async function runGdprRetention(req: NextRequest) {
  try {
    const days = await parseDaysParam(req);

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

async function parseDaysParam(req: NextRequest): Promise<number> {
  if (req.method === 'GET') {
    const q = req.nextUrl.searchParams.get('days');
    if (q != null && q !== '') {
      const n = parseInt(q, 10);
      if (Number.isFinite(n) && n > 0) return Math.min(n, 365);
    }
    return 90;
  }
  const body = await req.json().catch(() => ({})) as { days?: number };
  return typeof body?.days === 'number' && body.days > 0 ? Math.min(body.days, 365) : 90;
}
