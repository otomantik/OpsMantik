import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

/**
 * Monitoring endpoint (legacy name kept for compatibility).
 * Queue-only model: scans `offline_conversion_queue` for stale `PROCESSING` rows.
 * 
 * Returns counts grouped by site_id.
 * Used for operational observability to detect processing stalls.
 */
export async function GET() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data, error } = await adminClient
    .from('offline_conversion_queue')
    .select('site_id')
    .eq('status', 'PROCESSING')
    .lt('updated_at', twoHoursAgo);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Group by site manually
  const stats = (data || []).reduce((acc: Record<string, number>, curr: { site_id: string }) => {
    acc[curr.site_id] = (acc[curr.site_id] || 0) + 1;
    return acc;
  }, {});

  const total = Object.values(stats).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    ok: true,
    total_stale: total,
    by_site: stats,
    threshold_hours: 2,
    timestamp: new Date().toISOString(),
  });
}

// Ensure this route is not statically optimized
export const dynamic = 'force-dynamic';
